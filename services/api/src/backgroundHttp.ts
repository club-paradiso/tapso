/**
 * The collector's HTTP surface, separated from its wiring so it can be tested
 * against an injected coordinator. `backgroundServer.ts` builds the real
 * dependencies from the environment and listens; this file only routes.
 *
 * Everything but `/health` requires the operator bearer token, except the
 * `/beta/*` tester routes, which take a scoped beta-tester credential instead
 * (see `betaHttp.ts`).
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import {
  BackgroundRideCaptureError,
  type BackgroundCaptureStartInput,
  type BackgroundRideCaptureCoordinator,
} from "./backgroundRideCapture.ts";
import {
  campaignFor,
  FIELD_VALIDATION_CAMPAIGN_ID,
  FieldValidationError,
  submitCompletedCapture,
  type FieldValidationStore,
} from "./fieldValidation.ts";
import { createBetaLimits, routeBeta, type BetaLimits, type BetaTesterMode } from "./betaHttp.ts";
import type { BetaService } from "./betaService.ts";
import { BetaTesterError } from "./betaTester.ts";
import { operatorTokenMatches, readBearerToken, type OperatorCredential } from "./operatorAuth.ts";

const MAX_BODY_BYTES = 16 * 1_024;
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ROUTE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CITY_CODE = /^[0-9]{1,6}$/;

/**
 * What an operator-side request is allowed to do. Every route names exactly one,
 * and the operator token holds all of them.
 *
 * Beta testers never pass through this seam. Their credential is checked by
 * `BetaService.authenticate` on the `/beta/*` tester routes only, which act on
 * the tester's own rides; it holds none of these capabilities, so it can never
 * read a raw capture, a campaign, or administer invites. See
 * docs/exec-plans/BETA_FIELD_TESTER.md.
 */
export type CollectorCapability =
  | "capture:start"
  | "capture:read"
  | "capture:write"
  | "capture:raw"
  | "capture:submit"
  | "campaign:read"
  | "beta:admin";

/** Throws a 401/503 `httpError` when the request may not exercise `capability`. */
export type CollectorAuthorizer = (request: IncomingMessage, capability: CollectorCapability) => void;

export interface BackgroundHttpDependencies {
  captures: Pick<
    BackgroundRideCaptureCoordinator,
    "start" | "status" | "completedCapture" | "recordPassedStop" | "recordEvent" | "recordNote" | "alight"
  >;
  operator: Pick<OperatorCredential, "configured" | "token">;
  allowedOrigins: string[];
  /** The public `/health` payload. Must never carry a credential. */
  health: () => Record<string, unknown>;
  /** One JSON line per request: route, method, status, duration. Never a body. */
  log?: (line: string) => void;
  /** Durable submission storage. Absent means submit answers 503 and manual export remains. */
  fieldValidation?: { store: FieldValidationStore; campaignId?: string };
  /** Overrides operator-only auth for the operator routes. Tests use this. */
  authorize?: CollectorAuthorizer;
  /** Beta-tester invites and rides. Used only when `betaMode` is `enabled`. */
  beta?: BetaService;
  /** `disabled` when absent: every `/beta/*` route answers 503 BETA_DISABLED. */
  betaMode?: BetaTesterMode;
  /**
   * Whether a session belongs to a beta tester, available whenever beta
   * records exist in storage, even with beta disabled, so an operator can
   * never count a beta ride in v1.
   */
  isBetaCapture?: (sessionId: string) => Promise<boolean>;
  betaLimits?: BetaLimits;
}

export type BackgroundRequestHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

export function createBackgroundRequestHandler(deps: BackgroundHttpDependencies): BackgroundRequestHandler {
  const { captures, operator, allowedOrigins, health } = deps;
  const log = deps.log ?? ((line: string) => console.info(line));

  function corsHeaders(origin: string | undefined): Record<string, string> {
    if (!origin || !allowedOrigins.includes(origin)) return { vary: "Origin" };
    return { vary: "Origin", "access-control-allow-origin": origin };
  }

  const authorize: CollectorAuthorizer = deps.authorize ?? ((request) => requireOperator(request));
  const betaLimits = deps.betaLimits ?? createBetaLimits();

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

  return async (request, response) => {
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
        writeJson(response, 200, health(), cors);
        return;
      }

      const betaRoute = await routeBeta(request, path, {
        beta: deps.beta,
        mode: deps.betaMode ?? "disabled",
        authorize,
        allowedOrigins,
        readJson,
        respond: (code, body) => {
          status = code;
          writeJson(response, code, body, cors);
        },
        limits: betaLimits,
      });
      if (betaRoute) {
        route = betaRoute;
        return;
      }

      authorize(request, capabilityFor(request.method, path));

      if (request.method === "GET" && path === "/field-validation/campaign") {
        route = "campaign_status";
        const store = deps.fieldValidation?.store;
        if (!store) throw httpError(503, "FIELD_VALIDATION_UNAVAILABLE", "field-validation storage is not configured on this collector");
        const summary = await campaignFor(store, deps.fieldValidation?.campaignId ?? FIELD_VALIDATION_CAMPAIGN_ID);
        status = 200;
        writeJson(response, status, summary, cors);
        return;
      }

      if (request.method === "POST" && path === "/capture/start") {
        route = "capture_start";
        const body = await readJson(request) as Partial<BackgroundCaptureStartInput>;
        const input = parseStart(body);
        const result = await captures.start(input);
        status = 201;
        writeJson(response, status, result, cors);
        return;
      }

      const match = /^\/capture\/([^/]+)(?:\/(marker|note|alight|event|raw|submit))?$/.exec(path);
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

      if (request.method === "GET" && action === "raw") {
        route = "capture_raw";
        // Raw vehicle identifiers and coordinates. Operator-authenticated above,
        // one exact session id, never listed, never cached, never logged: the
        // request log below records the route and status only.
        const capture = captures.completedCapture(sessionId);
        status = 200;
        writeJson(response, status, capture, {
          ...cors,
          "cache-control": "no-store, private, max-age=0",
          pragma: "no-cache",
          "content-disposition": "attachment",
        });
        return;
      }

      if (request.method === "POST" && action === "submit") {
        route = "capture_submit";
        // No request body is read: the server never accepts a client report.
        // The only input is this session's own completed raw capture.
        const store = deps.fieldValidation?.store;
        if (!store) {
          throw httpError(503, "FIELD_VALIDATION_UNAVAILABLE",
            "field-validation storage is not configured; export the raw capture manually");
        }
        // A beta ride is submitted automatically into the beta campaign, and
        // only there; it must never be counted in v1 as well.
        const isBeta = deps.isBetaCapture ?? (deps.beta ? (id: string) => deps.beta!.isBetaCapture(id) : undefined);
        if (isBeta && await isBeta(sessionId)) {
          throw httpError(409, "BETA_CAPTURE", "this is a beta-tester ride; it is submitted to the beta campaign automatically");
        }
        const raw = captures.completedCapture(sessionId);
        const rideTimeReport = captures.status(sessionId).report;
        const receipt = await submitCompletedCapture(raw, rideTimeReport, {
          store,
          campaignId: deps.fieldValidation?.campaignId ?? FIELD_VALIDATION_CAMPAIGN_ID,
        });
        status = receipt.duplicate ? 200 : 201;
        writeJson(response, status, receipt, cors);
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
      log(JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "ride_collector_request",
        route,
        method: request.method,
        status,
        durationMs: Date.now() - started,
      }));
    }
  };
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

function capabilityFor(method: string | undefined, path: string): CollectorCapability {
  if (path === "/field-validation/campaign") return "campaign:read";
  if (path === "/capture/start") return "capture:start";
  if (/^\/capture\/[^/]+\/raw$/.test(path)) return "capture:raw";
  if (/^\/capture\/[^/]+\/submit$/.test(path)) return "capture:submit";
  if (method === "GET") return "capture:read";
  return "capture:write";
}

function mapError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof BetaTesterError) return { status: error.status, code: error.code, message: error.message };
  if (error instanceof FieldValidationError) {
    // The session is untouched by a failed submit, so the message says what
    // still works rather than implying the ride is gone.
    return error.kind === "invalid"
      ? { status: 400, code: "SUBMISSION_INVALID", message: error.message }
      : {
        status: 503,
        code: "SUBMISSION_FAILED",
        message: "the submission did not complete; the collector still holds the raw capture, so retry or export it manually",
      };
  }
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
