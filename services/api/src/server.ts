import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { CachedTransitProvider } from "./cachedTransitProvider.ts";
import { matchVehicle } from "./matching.ts";
import type { MatchRequest } from "./domain.ts";
import { TagoTransitProvider } from "./publicDataProvider.ts";
import { JourneySessionCoordinator } from "./journeySession.ts";
import { logEvent } from "./observability.ts";

const upstreamProvider = new TagoTransitProvider();
const provider = new CachedTransitProvider(upstreamProvider, {
  stopTtlMs: envDuration("PUBLIC_DATA_STOP_TTL_MS"),
  vehicleTtlMs: envDuration("PUBLIC_DATA_VEHICLE_TTL_MS"),
});
const sessions = new JourneySessionCoordinator(provider);
const port = Number(process.env.PORT ?? 8787);

export const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, {
        ok: true,
        liveTransitConfigured: Boolean(process.env.PUBLIC_DATA_SERVICE_KEY),
        routeCache: provider.policy,
        sessionStore: "memory",
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/matches") {
      const payload = parseMatchRequest(await readJSON(request));
      logEvent("vehicle_candidates_found", { routeId: payload.routeId, candidateCount: payload.candidates.length });
      const result = matchVehicle(payload);
      const matchEvent = result.status !== "matched"
        ? "vehicle_match_confirmation_required"
        : result.confidence === "high" ? "vehicle_match_high_confidence" : "vehicle_match_selected";
      logEvent(matchEvent, {
        routeId: payload.routeId,
        status: result.status,
        confidence: result.confidence,
        selectedVehicleId: result.selectedVehicleId,
      });
      return json(response, 200, result);
    }
    if (request.method === "GET" && url.pathname === "/v1/cities") {
      return json(response, 200, { items: await upstreamProvider.cities() });
    }
    if (request.method === "GET" && url.pathname === "/v1/routes") {
      const cityCode = url.searchParams.get("cityCode")?.trim();
      const routeNo = url.searchParams.get("routeNo")?.trim();
      if (!cityCode || !routeNo) throw invalidInput("cityCode and routeNo are required");
      return json(response, 200, { items: await upstreamProvider.routes(cityCode, routeNo) });
    }
    if (request.method === "GET" && url.pathname === "/v1/stops") {
      const route = parseRouteQuery(url);
      return json(response, 200, { items: await provider.stops(route) });
    }
    if (request.method === "GET" && url.pathname === "/v1/vehicles") {
      const route = parseRouteQuery(url);
      return json(response, 200, { items: await provider.vehicles(route) });
    }
    if (request.method === "POST" && url.pathname === "/v1/sessions") {
      const session = await sessions.create(await readJSON(request));
      logEvent("journey_session_created", {
        sessionId: session.id,
        routeId: session.routeId,
        state: session.state,
        selectedVehicleId: session.selectedVehicleId,
      });
      return json(response, 201, session);
    }

    const confirmMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/confirm$/);
    if (request.method === "POST" && confirmMatch) {
      const session = await sessions.confirm(decodeURIComponent(confirmMatch[1]), await readJSON(request));
      logEvent("vehicle_match_confirmed", {
        sessionId: session.id,
        routeId: session.routeId,
        selectedVehicleId: session.selectedVehicleId,
      });
      return json(response, 200, session);
    }

    const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)$/);
    if (request.method === "GET" && sessionMatch) {
      const session = await sessions.refresh(decodeURIComponent(sessionMatch[1]));
      return json(response, 200, session);
    }

    return json(response, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "INTERNAL_ERROR";
    const status = statusForCode(code);
    return json(response, status, { error: code, message });
  }
});

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJSON(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
    if (chunks.reduce((sum, item) => sum + item.length, 0) > 64 * 1024) {
      throw invalidInput("request body exceeds 64 KiB");
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw invalidInput("request body must be valid JSON");
  }
}

function parseRouteQuery(url: URL): { routeId: string; cityCode: string } {
  const routeId = url.searchParams.get("routeId")?.trim();
  const cityCode = url.searchParams.get("cityCode")?.trim();
  if (!routeId || !cityCode) throw invalidInput("routeId and cityCode are required");
  return { routeId, cityCode };
}

function parseMatchRequest(value: unknown): MatchRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidInput("JSON object required");
  const input = value as Record<string, unknown>;
  if (typeof input.routeId !== "string" || !input.routeId.trim()) throw invalidInput("routeId is required");
  if (typeof input.boardingStopSequence !== "number" || !Number.isInteger(input.boardingStopSequence)) {
    throw invalidInput("boardingStopSequence must be an integer");
  }
  if (typeof input.now !== "string" || Number.isNaN(new Date(input.now).valueOf())) throw invalidInput("now must be an ISO timestamp");
  if (!Array.isArray(input.candidates) || input.candidates.length > 500) throw invalidInput("candidates must be an array of at most 500 items");
  for (const candidate of input.candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw invalidInput("candidate must be an object");
    const record = candidate as Record<string, unknown>;
    if (typeof record.vehicleId !== "string" || typeof record.routeId !== "string" || typeof record.observedAt !== "string") {
      throw invalidInput("candidate vehicleId, routeId, and observedAt are required");
    }
  }
  return input as unknown as MatchRequest;
}

function invalidInput(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: "INVALID_INPUT" });
}

function statusForCode(code: string): number {
  if (code === "INVALID_INPUT") return 400;
  if (code === "SESSION_NOT_FOUND") return 404;
  if (code === "SESSION_EXPIRED") return 410;
  if (code === "BLOCKED_BY_CREDENTIALS") return 503;
  if (code === "PROVIDER_RESPONSE_INVALID") return 502;
  return 500;
}

function envDuration(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

if (process.env.NODE_ENV !== "test") {
  server.listen(port, "127.0.0.1", () => console.info(`TAPSO API listening on http://127.0.0.1:${port}`));
}
