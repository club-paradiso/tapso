import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  BackgroundRideCaptureCoordinator,
  BackgroundRideCaptureError,
  type BackgroundCaptureStartInput,
} from "./backgroundRideCapture.ts";
import { operatorTokenMatches, readBearerToken, resolveOperatorToken } from "./operatorAuth.ts";
import { resolveTagoServiceKey, serviceKeyWarning } from "./serviceKey.ts";
import { TagoTransitProvider } from "./tagoProvider.ts";
import { backgroundAcceptanceVerdict, createWebPushSender } from "./webPush.ts";

const port = Number(process.env.PORT ?? 8788);
const host = process.env.HOST?.trim() || "0.0.0.0";
const MAX_BODY_BYTES = 16 * 1_024;
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ROUTE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CITY_CODE = /^[0-9]{1,6}$/;

const credential = resolveTagoServiceKey(process.env);
const operator = resolveOperatorToken(process.env);
const warning = serviceKeyWarning(credential);
if (warning) console.warn(JSON.stringify({ level: "warn", event: "transit_credential_name", message: warning }));
if (operator.problem) console.warn(JSON.stringify({ level: "warn", event: "ride_capture_operator_token", message: operator.problem }));

const provider = new TagoTransitProvider({ serviceKey: credential.key });
const push = createWebPushSender(process.env);
const captures = new BackgroundRideCaptureCoordinator(provider, {
  onComplete: async ({ mode, report, pushSubscription, sessionId }) => {
    if (mode !== "background_acceptance") return;
    const verdict = backgroundAcceptanceVerdict(report);
    try {
      await push.sendAcceptanceResult(pushSubscription, report, verdict);
      console.info(JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "ride_capture_acceptance_completed",
        sessionId,
        verdict,
        pushAttempted: Boolean(pushSubscription && push.config.configured),
      }));
    } catch (error) {
      console.warn(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        event: "ride_capture_push_failed",
        sessionId,
        verdict,
        message: error instanceof Error ? error.message.slice(0, 240) : "push failed",
      }));
    }
  },
});
const allowedOrigins = originList(process.env.TRANSIT_ALLOWED_ORIGINS);

export const backgroundServer = createServer(async (request, response) => {
  const started = Date.now();
  let status = 500;
  let route = "unknown";
  try {
    const origin = request.headers.origin;
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") {
      if (!origin || !allowedOrigins.includes(origin)) {
        writeJson(response, 403, { error: "CORS_FORBIDDEN", message: "origin is not allowed" }, { vary: "Origin" });
        return;
      }
      response.writeHead(204, {
        ...cors,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-max-age": "600",
        "cache-control": "no-store",
      });
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", "http://collector.invalid");
    const path = normalizePath(url.pathname);

    if (request.method === "GET" && path === "/health") {
      route = "health";
      status = 200;
      writeJson(response, 200, {
        ok: true,
        service: "tapso-ride-collector",
        liveTransitConfigured: credential.source !== "missing",
        operatorEnabled: operator.configured,
        webPushConfigured: push.config.configured,
        ...(push.config.publicKey ? { webPushPublicKey: push.config.publicKey } : {}),
        stateStore: "process_memory",
        processRestartLosesActiveCapture: true,
        providerObservationTimestamp: "unavailable",
      }, cors);
      return;
    }

    requireOperator(request);

    if (request.method === "POST" && path === "/capture/start") {
      route = "capture_start";
      const body = await readJson(request) as Partial<BackgroundCaptureStartInput>;
      const input = parseStart(body);
      const result = await captures.start(input);
      status = 201;
      writeJson(response, status, result, cors);
      return;
    }

    const match = /^\/capture\/([^/]+)(?:\/(marker|note|alight|event))?$/.exec(path);
    if (!match) throw httpError(404, "NOT_FOUND", "no such endpoint");
    const sessionId = decodeURIComponent(match[1] ?? "");
    if (!SESSION_ID.test(sessionId)) throw httpError(400, "INVALID_INPUT", "session id is invalid");
    const action = match[2];

    if (request.method === "GET" && action === undefined) {
      route = "capture_status";
      const result = captures.status(sessionId);
      status = 200;
      writeJson(response, status, result, cors);
      return;
    }

    if (request.method !== "POST") throw httpError(405, "METHOD_NOT_ALLOWED", "method is not allowed");
    const body = await readJson(request) as Record<string, unknown>;

    if (action === "marker") {
      route = "capture_marker";
      const sequence = body.stopSequence;
      if (!Number.isInteger(sequence)) throw httpError(400, "INVALID_INPUT", "stopSequence must be an integer");
      const result = captures.recordPassedStop(
        sessionId,
        sequence as number,
        optionalTimestamp(body.at),
        body.allowDuplicate === true,
      );
      status = 200;
      writeJson(response, status, result, cors);
      return;
    }

    if (action === "event") {
      route = "capture_event";
      if (typeof body.kind !== "string") throw httpError(400, "INVALID_INPUT", "kind must be a string");
      if (body.detail !== undefined && typeof body.detail !== "string") {
        throw httpError(400, "INVALID_INPUT", "detail must be a string when present");
      }
      const result = captures.recordEvent(
        sessionId,
        body.kind,
        optionalTimestamp(body.at),
        typeof body.detail === "string" ? body.detail : undefined,
      );
      status = 200;
      writeJson(response, status, result, cors);
      return;
    }

    if (action === "note") {
      route = "capture_note";
      if (typeof body.note !== "string") throw httpError(400, "INVALID_INPUT", "note must be a string");
      const result = captures.recordNote(sessionId, body.note, optionalTimestamp(body.at));
      status = 200;
      writeJson(response, status, result, cors);
      return;
    }

    if (action === "alight") {
      route = "capture_alight";
      const result = captures.alight(sessionId, optionalTimestamp(body.at));
      status = 200;
      writeJson(response, status, result, cors);
      return;
    }

    throw httpError(404, "NOT_FOUND", "no such endpoint");
  } catch (error) {
    const mapped = mapError(error);
    status = mapped.status;
    writeJson(response, mapped.status, { error: mapped.code, message: mapped.message }, corsHeaders(request.headers.origin));
  } finally {
    console.info(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "ride_collector_request",
      route,
      method: request.method,
      status,
      durationMs: Date.now() - started,
    }));
  }
});

function requireOperator(request: IncomingMessage): void {
  if (!operator.configured || !operator.token) {
    throw httpError(503, "OPERATOR_DISABLED", "ride collector is not enabled on this deployment");
  }
  const header = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;
  const presented = readBearerToken(header ?? null);
  if (!operatorTokenMatches(operator.token, presented)) {
    throw httpError(401, "UNAUTHORIZED", "operator authorization required");
  }
}

function parseStart(input: Partial<BackgroundCaptureStartInput>): BackgroundCaptureStartInput {
  const routeId = typeof input.routeId === "string" ? input.routeId.trim() : "";
  const cityCode = typeof input.cityCode === "string" ? input.cityCode.trim() : "";
  const boardedVehicleId = typeof input.boardedVehicleId === "string" ? input.boardedVehicleId.trim() : "";
  if (!ROUTE_ID.test(routeId)) throw httpError(400, "INVALID_INPUT", "routeId is invalid");
  if (!CITY_CODE.test(cityCode)) throw httpError(400, "INVALID_INPUT", "cityCode is invalid");
  if (!boardedVehicleId || boardedVehicleId.length > 128) throw httpError(400, "INVALID_INPUT", "boardedVehicleId is invalid");
  if (!Number.isInteger(input.boardingStopSequence) || !Number.isInteger(input.destinationStopSequence)) {
    throw httpError(400, "INVALID_INPUT", "boarding and destination sequences must be integers");
  }
  return {
    routeId,
    cityCode,
    boardedVehicleId,
    boardingStopSequence: input.boardingStopSequence as number,
    destinationStopSequence: input.destinationStopSequence as number,
    ...(Number.isInteger(input.intervalMs) ? { intervalMs: input.intervalMs } : {}),
    ...(input.mode === "background_acceptance" ? { mode: "background_acceptance" as const } : {}),
    ...(input.pushSubscription ? { pushSubscription: parsePushSubscription(input.pushSubscription) } : {}),
  };
}

function parsePushSubscription(value: unknown): NonNullable<BackgroundCaptureStartInput["pushSubscription"]> {
  if (!value || typeof value !== "object") throw httpError(400, "INVALID_INPUT", "pushSubscription is invalid");
  const row = value as Record<string, unknown>;
  const endpoint = typeof row.endpoint === "string" ? row.endpoint.trim() : "";
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw httpError(400, "INVALID_INPUT", "pushSubscription endpoint is invalid");
  }
  const applePushHost = url.hostname === "push.apple.com" || url.hostname.endsWith(".push.apple.com");
  if (url.protocol !== "https:" || !applePushHost) {
    throw httpError(400, "INVALID_INPUT", "only Apple Web Push subscriptions are accepted");
  }
  if (!row.keys || typeof row.keys !== "object") throw httpError(400, "INVALID_INPUT", "pushSubscription keys are required");
  const keys = row.keys as Record<string, unknown>;
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys.auth === "string" ? keys.auth.trim() : "";
  if (!p256dh || p256dh.length > 256 || !auth || auth.length > 128) {
    throw httpError(400, "INVALID_INPUT", "pushSubscription keys are invalid");
  }
  return {
    endpoint,
    ...(typeof row.expirationTime === "number" ? { expirationTime: row.expirationTime } : {}),
    keys: { p256dh, auth },
  };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"] ?? "";
  if (!String(contentType).toLowerCase().includes("application/json")) {
    throw httpError(400, "INVALID_INPUT", "content-type must be application/json");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw httpError(413, "PAYLOAD_TOO_LARGE", "request body is too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError(400, "INVALID_INPUT", "request body must be valid JSON");
  }
}

function optionalTimestamp(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw httpError(400, "INVALID_INPUT", "at must be an ISO timestamp");
  }
  return value;
}

function normalizePath(value: string): string {
  const compact = value.replace(/\/{2,}/g, "/");
  return compact.length > 1 && compact.endsWith("/") ? compact.slice(0, -1) : compact;
}

function originList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const result: string[] = [];
  for (const part of value.split(",")) {
    try {
      const origin = new URL(part.trim()).origin;
      if (!result.includes(origin)) result.push(origin);
    } catch {
      // Fail closed for malformed entries. The health endpoint stays available
      // so the operator can diagnose the deployment without opening CORS.
    }
  }
  return result;
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin || !allowedOrigins.includes(origin)) return { vary: "Origin" };
  return { vary: "Origin", "access-control-allow-origin": origin };
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

type HttpError = Error & { status: number; code: string };

function httpError(status: number, code: string, message: string): HttpError {
  return Object.assign(new Error(message), { status, code });
}

function mapError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof BackgroundRideCaptureError) {
    const status = error.kind === "not_found" ? 404
      : error.kind === "conflict" ? 409
      : error.kind === "unavailable" ? 503
      : 400;
    return { status, code: `CAPTURE_${error.kind.toUpperCase()}`, message: error.message };
  }
  const candidate = error as Partial<HttpError>;
  if (typeof candidate?.status === "number" && typeof candidate?.code === "string") {
    return { status: candidate.status, code: candidate.code, message: error instanceof Error ? error.message : "request failed" };
  }
  console.error(JSON.stringify({ level: "error", event: "ride_collector_error", message: error instanceof Error ? error.message : "unknown error" }));
  return { status: 500, code: "INTERNAL_ERROR", message: "internal error" };
}

if (process.env.NODE_ENV !== "test") {
  backgroundServer.listen(port, host, () => {
    console.info(`TAPSO ride collector listening on http://${host}:${port}`);
  });
}
