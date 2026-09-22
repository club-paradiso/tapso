/**
 * The transit API, expressed once, over the Web `Request`/`Response` types.
 *
 * Every transport binds to this module: the local Node server in `server.ts`
 * and the Vercel Functions in `services/api/api/`. Routing, validation, cache
 * headers, abuse limits, error shape, and logging therefore cannot drift
 * between local development and production.
 *
 * Two rules survive every change here:
 *  - the TAGO service key never reaches a response, a header, or a log line;
 *  - TAGO exposes no source observation timestamp, so anything that would need
 *    one fails closed instead of treating receipt time as freshness.
 */

import type { MatchRequest } from "./domain.ts";
import { matchVehicle } from "./matching.ts";
import { analyzeRideCapture, classifyTopology, RideCaptureInputError, type RideCapture } from "./rideCapture.ts";
import { operatorTokenMatches, readBearerToken } from "./operatorAuth.ts";
import type { CachedTransitProvider } from "./cachedTransitProvider.ts";
import type { TransitProvider } from "./provider.ts";
import type { TagoCity, TagoRoute, TagoTransitProvider } from "./tagoProvider.ts";
import type { JourneySessionCoordinator } from "./journeySession.ts";
import type { TransitApiConfig } from "./apiConfig.ts";
import type { BurstLimiter } from "./rateLimit.ts";
import { maskClientAddress } from "./rateLimit.ts";
import { TtlCache } from "./ttlCache.ts";
import { logEvent } from "./observability.ts";
import { TAGO_CADENCE_POLICY_V1 } from "./sourceFreshness.ts";

/**
 * The single source of the freshness posture every surface publishes.
 *
 * Three separate claims live here and must stay separable:
 *
 * 1. `providerObservationTimestamp` — TAGO exposes none. `observedAt` on a TAGO
 *    record is the epoch sentinel and `timestampSource` is `unavailable`.
 * 2. `policy` — what TAPSO does instead: a conservative liveness surrogate
 *    built from repeated server receipts of *changing* provider content. It
 *    never claims to know when TAGO observed the vehicle.
 * 3. `automaticMatching` — whether the server may pick a rider's bus. It is a
 *    product-safety decision gated on field evidence, not on either of the
 *    above being solved.
 */
function freshnessPosture(config: TransitApiConfig): Record<string, unknown> {
  return {
    providerObservationTimestamp: "unavailable",
    policy: "server_observed_cadence_v1",
    automaticMatching: config.matching.automaticMatchingEnabled
      ? "enabled_by_explicit_operator_opt_in"
      : "shadow_only_pending_field_validation",
    /**
     * Why it is withheld, in full, because a one-word status invites the wrong
     * guess. Durable session storage is a real and separate gap; it is not the
     * reason automatic matching is off. The key is absent, rather than empty,
     * once nothing is being withheld.
     */
    ...(config.matching.automaticMatchingEnabled
      ? {}
      : { automaticMatchingWithheldBecause: config.matching.fieldValidationGate.requirement }),
    fieldValidationGate: config.matching.fieldValidationGate,
    /**
     * Seconds, and every one of them a conservative operational gate on TAPSO's
     * own receipts. None of these is a provider timestamp threshold, and none
     * is calibrated against real boardings yet.
     */
    cadencePolicy: {
      historyWindowSeconds: TAGO_CADENCE_POLICY_V1.historyWindowMs / 1_000,
      minimumSamples: TAGO_CADENCE_POLICY_V1.minimumSamples,
      minimumSpanSeconds: TAGO_CADENCE_POLICY_V1.minimumSpanMs / 1_000,
      maximumReceiptAgeSeconds: TAGO_CADENCE_POLICY_V1.maximumReceiptAgeMs / 1_000,
      maximumReceiptGapSeconds: TAGO_CADENCE_POLICY_V1.maximumReceiptGapMs / 1_000,
      requiresProviderContentChange: true,
      calibration: "provisional",
    },
  };
}

export const MAX_BODY_BYTES = 64 * 1_024;
/**
 * A completed ride capture is the one legitimately large body this API accepts.
 * It is analysed and discarded in the same request — never stored, never
 * logged — so the cap only has to stay inside the platform's own request limit.
 */
export const MAX_CAPTURE_BYTES = 4 * 1_024 * 1_024;

/** Official identifiers are narrow on purpose: junk never reaches TAGO. */
const CITY_CODE_PATTERN = /^[0-9]{1,6}$/;
const ROUTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ROUTE_NUMBER_PATTERN = /^[A-Za-z0-9가-힣-]{1,16}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | undefined>;

export interface RequestContext {
  /** Peer address for the local Node adapter; proxy headers win when present. */
  clientAddress?: string;
}

export interface TransitApiDependencies {
  config: TransitApiConfig;
  /**
   * Discovery calls (`cities`, `routes`) are not part of `TransitProvider`.
   * `allRoutes` is optional because whether the provider will list a whole city
   * is the provider's answer to give, not this module's to assume.
   */
  discovery: Pick<TagoTransitProvider, "cities" | "routes"> & Partial<Pick<TagoTransitProvider, "allRoutes">>;
  provider: CachedTransitProvider;
  /**
   * The uncached upstream, used only by the operator ride-capture path. Task B
   * measures how often TAGO's own content changes, so polling the shared
   * 20-second cache would measure the cache instead of the provider.
   */
  directProvider?: Pick<TransitProvider, "vehicles">;
  sessions?: JourneySessionCoordinator;
  limiter?: BurstLimiter;
  /** Separate budget so a ride never spends the public API's burst allowance. */
  operatorLimiter?: BurstLimiter;
  /** The shared operator secret. Deliberately not part of `config`, which `/health` echoes. */
  operatorToken?: string;
  now?: () => Date;
  log?: (level: LogLevel, event: string, fields: LogFields) => void;
}

export type TransitApiHandler = (request: Request, context?: RequestContext) => Promise<Response>;

type Route =
  | "health"
  | "cities"
  | "routes"
  | "stops"
  | "vehicles"
  | "matches"
  | "session_create"
  | "session_read"
  | "session_confirm"
  | "operator_snapshot"
  | "operator_analyze";

type Resolved = { route: Route; methods: string[]; sessionId?: string };

export function createTransitApiHandler(dependencies: TransitApiDependencies): TransitApiHandler {
  const { config } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const log = dependencies.log ?? defaultLog;
  const cityCache = new TtlCache<TagoCity[]>({ ttlMs: config.cachePolicy.discoveryTtlMs });
  const routeCache = new TtlCache<TagoRoute[]>({ ttlMs: config.cachePolicy.discoveryTtlMs });

  return async function handle(request: Request, context: RequestContext = {}): Promise<Response> {
    const startedAt = Date.now();
    const url = safeUrl(request.url);
    const path = url ? normalizePath(url.pathname) : "/";
    const origin = request.headers.get("origin");
    const cors = corsHeaders(config, origin);
    const resolved = url ? resolve(path) : undefined;

    if (request.method === "OPTIONS") {
      return preflight(config, resolved, cors);
    }

    let cache = "none";
    let response: Response;
    try {
      if (!url) throw apiError("INVALID_INPUT", "request URL is not valid");
      if (!resolved) throw apiError("NOT_FOUND", "no such endpoint");
      if (!resolved.methods.includes(request.method)) {
        throw apiError("METHOD_NOT_ALLOWED", `allowed: ${resolved.methods.join(", ")}`);
      }

      enforceRateLimit(dependencies, clientAddress(request, context), resolved.route);
      if (isOperatorRoute(resolved.route)) requireOperator(dependencies, request);

      const result = await dispatch(dependencies, { cityCache, routeCache, now }, resolved, request, url);
      cache = result.cache ?? "none";
      response = withHeaders(result.response, cors);
    } catch (error) {
      response = withHeaders(errorResponse(error, log), cors);
    }

    const status = response.status;
    log(status >= 500 ? "error" : "info", "transit_api_request", {
      route: resolved ? resolved.route : "unknown",
      path,
      method: request.method,
      status,
      cache,
      provider: config.transitProvider,
      durationMs: Date.now() - startedAt,
      client: maskClientAddress(clientAddress(request, context)),
      ...safeQueryFields(url),
    });
    return response;
  };
}

/* ------------------------------------------------------------------ routing */

/**
 * Accepts both the root contract (`/v1/vehicles`) used by the local server and
 * documented production rewrites, and the underlying `/api/...` function path
 * Vercel resolves those rewrites to.
 */
export function normalizePath(pathname: string): string {
  let path = pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/api") return "/";
  if (path.startsWith("/api/")) path = path.slice(4);
  return path === "" ? "/" : path;
}

function resolve(path: string): Resolved | undefined {
  if (path === "/health") return { route: "health", methods: ["GET"] };
  if (path === "/v1/cities") return { route: "cities", methods: ["GET"] };
  if (path === "/v1/routes") return { route: "routes", methods: ["GET"] };
  if (path === "/v1/stops") return { route: "stops", methods: ["GET"] };
  if (path === "/v1/vehicles") return { route: "vehicles", methods: ["GET"] };
  if (path === "/v1/matches") return { route: "matches", methods: ["POST"] };
  if (path === "/v1/sessions") return { route: "session_create", methods: ["POST"] };

  // Operator-only ride capture. Authenticated, uncached, and never linked from
  // anything public; see `docs/RIDE_CAPTURE_CONTROLLER.md`.
  if (path === "/operator/snapshot") return { route: "operator_snapshot", methods: ["GET"] };
  if (path === "/operator/analyze") return { route: "operator_analyze", methods: ["POST"] };

  // Rewrite targets: the session identifier arrives as a query parameter.
  if (path === "/v1/session") return { route: "session_read", methods: ["GET"] };
  if (path === "/v1/session-confirm") return { route: "session_confirm", methods: ["POST"] };

  const confirm = /^\/v1\/sessions\/([^/]+)\/confirm$/.exec(path);
  if (confirm) return { route: "session_confirm", methods: ["POST"], sessionId: decodeSegment(confirm[1]) };

  const read = /^\/v1\/sessions\/([^/]+)$/.exec(path);
  if (read) return { route: "session_read", methods: ["GET"], sessionId: decodeSegment(read[1]) };

  return undefined;
}

function decodeSegment(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/* ----------------------------------------------------------------- dispatch */

type Support = {
  cityCache: TtlCache<TagoCity[]>;
  routeCache: TtlCache<TagoRoute[]>;
  now: () => Date;
};

type Dispatched = { response: Response; cache?: string };

async function dispatch(
  dependencies: TransitApiDependencies,
  support: Support,
  resolved: Resolved,
  request: Request,
  url: URL,
): Promise<Dispatched> {
  const { config, provider, discovery } = dependencies;

  if (resolved.route === "health") {
    return { response: json(healthPayload(config, support.now()), 200, { "cache-control": "no-store" }) };
  }

  if (resolved.route === "cities") {
    const result = await support.cityCache.readThrough("cities", () => discovery.cities());
    return {
      cache: result.cache,
      response: json(
        { items: result.value, meta: { provider: config.transitProvider, count: result.value.length } },
        200,
        sharedCacheControl(config.cachePolicy.discoveryTtlMs),
      ),
    };
  }

  if (resolved.route === "routes") {
    const cityCode = requiredParam(url, "cityCode", CITY_CODE_PATTERN);
    // `routeNo` is optional: without it this lists every route the provider
    // will name for the city, which is what a client needs to offer a browsable
    // catalog instead of demanding the operator already know the number.
    const routeNumber = optionalParam(url, "routeNo", ROUTE_NUMBER_PATTERN);
    if (routeNumber === undefined && !discovery.allRoutes) {
      throw apiError("INVALID_INPUT", "routeNo is required");
    }
    const result = await support.routeCache.readThrough(
      `${cityCode}:${routeNumber ?? "*"}`,
      () => (routeNumber === undefined ? discovery.allRoutes!(cityCode) : discovery.routes(cityCode, routeNumber)),
    );
    return {
      cache: result.cache,
      response: json(
        {
          items: result.value,
          meta: {
            provider: config.transitProvider,
            cityCode,
            ...(routeNumber === undefined ? { catalog: true } : { routeNo: routeNumber }),
            count: result.value.length,
            // One route number is several official routes. Collapsing them
            // would destroy direction and endpoint identity.
            variantsPreserved: true,
          },
        },
        200,
        sharedCacheControl(config.cachePolicy.discoveryTtlMs),
      ),
    };
  }

  if (resolved.route === "stops") {
    const route = routeRequestFrom(url);
    const result = await provider.stopsResult(route);
    return {
      cache: result.cache,
      response: json(
        {
          items: result.value,
          meta: {
            provider: config.transitProvider,
            cityCode: route.cityCode,
            routeId: route.routeId,
            count: result.value.length,
            // TAGO route IDs are direction-specific; `sequence` is `nodeord`.
            directionScope: "route_id",
            sequenceSource: "provider_node_order",
            /**
             * Classified here so one implementation decides route shape for the
             * analyzer and for any client. A client that cannot read this field
             * must assume `linear`, which is the choice that refuses wrap-around.
             */
            topology: classifyTopology(result.value),
          },
        },
        200,
        sharedCacheControl(config.cachePolicy.stopTtlMs),
      ),
    };
  }

  if (resolved.route === "vehicles") {
    const route = routeRequestFrom(url);
    const result = await provider.vehiclesResult(route);
    return {
      cache: result.cache,
      response: json(
        {
          items: result.value,
          meta: {
            provider: config.transitProvider,
            cityCode: route.cityCode,
            routeId: route.routeId,
            count: result.value.length,
            /**
             * `receivedAt` is when TAPSO read the snapshot. TAGO publishes no
             * source observation timestamp, so `observedAt` carries the epoch
             * sentinel and nothing downstream may treat receipt as freshness.
             */
            receivedAt: latestReceivedAt(result.value),
            freshness: freshnessPosture(config),
            snapshotCacheTtlSeconds: Math.round(config.cachePolicy.vehicleTtlMs / 1_000),
          },
        },
        200,
        sharedCacheControl(config.cachePolicy.vehicleTtlMs),
      ),
    };
  }

  if (resolved.route === "matches") {
    const payload = parseMatchRequest(await readJsonBody(request));
    logEvent("vehicle_candidates_found", {
      routeId: payload.routeId,
      candidateCount: payload.candidates.length,
    });
    const result = matchVehicle(payload);
    logEvent(
      result.status !== "matched"
        ? "vehicle_match_confirmation_required"
        : result.confidence === "high"
          ? "vehicle_match_high_confidence"
          : "vehicle_match_selected",
      {
        routeId: payload.routeId,
        status: result.status,
        confidence: result.confidence,
        selectedVehicleId: result.selectedVehicleId,
      },
    );
    return { response: json(result, 200, { "cache-control": "no-store" }) };
  }

  if (resolved.route === "operator_snapshot") {
    const route = routeRequestFrom(url);
    const direct = dependencies.directProvider;
    if (!direct) throw apiError("OPERATOR_DISABLED", "the operator snapshot path is not wired on this deployment");
    // Straight to the provider: no read-through cache, no CDN window, one
    // upstream request per successful poll. That is the whole point of the
    // endpoint, so it is asserted in the payload as `snapshotCache: "bypassed"`.
    const items = await direct.vehicles(route);
    return {
      cache: "bypassed",
      response: json(
        {
          items,
          meta: {
            provider: config.transitProvider,
            cityCode: route.cityCode,
            routeId: route.routeId,
            count: items.length,
            receivedAt: latestReceivedAt(items),
            freshness: freshnessPosture(config),
            snapshotCache: "bypassed",
            purpose: "controlled_ride_capture",
          },
        },
        200,
        { "cache-control": "no-store" },
      ),
    };
  }

  if (resolved.route === "operator_analyze") {
    const body = await readJsonBody(request, MAX_CAPTURE_BYTES);
    let report: unknown;
    try {
      // The capture itself is never stored and never logged: it arrives, it is
      // analysed, and only the pseudonymised report goes back out.
      report = analyzeRideCapture(body as RideCapture);
    } catch (error) {
      if (error instanceof RideCaptureInputError) throw apiError("INVALID_INPUT", error.message);
      throw error;
    }
    return { response: json(report, 200, { "cache-control": "no-store" }) };
  }

  const sessions = requireSessions(dependencies);

  if (resolved.route === "session_create") {
    const session = await sessions.create(await readJsonBody(request));
    logEvent("journey_session_created", {
      sessionId: session.id,
      routeId: session.routeId,
      state: session.state,
      selectedVehicleId: session.selectedVehicleId,
    });
    return { response: json(session, 201, { "cache-control": "no-store" }) };
  }

  const sessionId = sessionIdentifier(resolved, url);

  if (resolved.route === "session_read") {
    return { response: json(await sessions.refresh(sessionId), 200, { "cache-control": "no-store" }) };
  }

  const session = await sessions.confirm(sessionId, await readJsonBody(request));
  logEvent("vehicle_match_confirmed", {
    sessionId: session.id,
    routeId: session.routeId,
    selectedVehicleId: session.selectedVehicleId,
  });
  return { response: json(session, 200, { "cache-control": "no-store" }) };
}

/* ------------------------------------------------------------------- health */

function healthPayload(config: TransitApiConfig, now: Date): Record<string, unknown> {
  return {
    ok: true,
    service: "tapso-transit-api",
    time: now.toISOString(),
    transitProvider: config.transitProvider,
    // Presence only. The key itself is never echoed anywhere.
    liveTransitConfigured: config.liveTransitConfigured,
    /**
     * Category, not name and never value. `missing` together with
     * `deprecatedNamePresent` is the signature of the migration mistake: the
     * retired variable set on a deployment that ignores it.
     */
    credential: config.credential,
    routeCache: {
      stopTtlMs: config.cachePolicy.stopTtlMs,
      vehicleTtlMs: config.cachePolicy.vehicleTtlMs,
    },
    cachePolicy: config.cachePolicy,
    sessionStore: config.sessions.store,
    sessions: config.sessions,
    rateLimit: config.rateLimit,
    cors: { allowedOriginCount: config.cors.allowedOrigins.length },
    // Presence and policy only. The operator token is never part of `config`.
    operator: config.operator,
    runtime: config.runtime,
    build: config.build,
    matching: config.matching,
    freshness: freshnessPosture(config),
  };
}

/* --------------------------------------------------------------- validation */

function routeRequestFrom(url: URL): { routeId: string; cityCode: string } {
  // `stdgCd` and `regionCode` belonged to a different provider whose Jeju data
  // was empty. Accepting them would silently query the wrong identifier space.
  return {
    routeId: requiredParam(url, "routeId", ROUTE_ID_PATTERN),
    cityCode: requiredParam(url, "cityCode", CITY_CODE_PATTERN),
  };
}

function optionalParam(url: URL, name: string, pattern: RegExp): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  if (!value) return undefined;
  if (!pattern.test(value)) throw apiError("INVALID_INPUT", `${name} is not a valid official identifier`);
  return value;
}

function requiredParam(url: URL, name: string, pattern: RegExp): string {
  const value = url.searchParams.get(name)?.trim();
  if (!value) throw apiError("INVALID_INPUT", `${name} is required`);
  if (!pattern.test(value)) throw apiError("INVALID_INPUT", `${name} is not a valid official identifier`);
  return value;
}

function sessionIdentifier(resolved: Resolved, url: URL): string {
  const value = resolved.sessionId ?? url.searchParams.get("sessionId") ?? url.searchParams.get("id") ?? "";
  const trimmedValue = value.trim();
  if (!trimmedValue) throw apiError("INVALID_INPUT", "session id is required");
  if (!SESSION_ID_PATTERN.test(trimmedValue)) throw apiError("INVALID_INPUT", "session id is not valid");
  return trimmedValue;
}

async function readJsonBody(request: Request, maxBytes: number = MAX_BODY_BYTES): Promise<unknown> {
  const limitText = maxBytes >= 1_024 * 1_024 ? `${Math.round(maxBytes / (1_024 * 1_024))} MiB` : `${Math.round(maxBytes / 1_024)} KiB`;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw apiError("PAYLOAD_TOO_LARGE", `request body exceeds ${limitText}`);
  }
  // A form-encoded post is never a legitimate call here, and refusing it keeps
  // this API out of reach of a simple cross-site form submission.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw apiError("INVALID_INPUT", "content-type must be application/json");
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw apiError("INVALID_INPUT", "request body could not be read");
  }
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw apiError("PAYLOAD_TOO_LARGE", `request body exceeds ${limitText}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw apiError("INVALID_INPUT", "request body must be valid JSON");
  }
}

function parseMatchRequest(value: unknown): MatchRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw apiError("INVALID_INPUT", "JSON object required");
  const input = value as Record<string, unknown>;
  if (typeof input.routeId !== "string" || !input.routeId.trim()) throw apiError("INVALID_INPUT", "routeId is required");
  if (typeof input.boardingStopSequence !== "number" || !Number.isInteger(input.boardingStopSequence)) {
    throw apiError("INVALID_INPUT", "boardingStopSequence must be an integer");
  }
  if (typeof input.now !== "string" || Number.isNaN(new Date(input.now).valueOf())) {
    throw apiError("INVALID_INPUT", "now must be an ISO timestamp");
  }
  if (!Array.isArray(input.candidates) || input.candidates.length > 500) {
    throw apiError("INVALID_INPUT", "candidates must be an array of at most 500 items");
  }
  for (const candidate of input.candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw apiError("INVALID_INPUT", "candidate must be an object");
    }
    const record = candidate as Record<string, unknown>;
    if (typeof record.vehicleId !== "string" || typeof record.routeId !== "string" || typeof record.observedAt !== "string") {
      throw apiError("INVALID_INPUT", "candidate vehicleId, routeId, and observedAt are required");
    }
  }
  return input as unknown as MatchRequest;
}

/* ------------------------------------------------------------------- limits */

function isOperatorRoute(route: Route): boolean {
  return route === "operator_snapshot" || route === "operator_analyze";
}

function enforceRateLimit(dependencies: TransitApiDependencies, address: string, route: Route): void {
  const { limiter, operatorLimiter, config } = dependencies;
  // The operator budget is separate in both directions: a ride cannot exhaust
  // the public allowance, and public traffic cannot starve a ride in progress.
  const selected = isOperatorRoute(route) ? operatorLimiter : limiter;
  if (!selected) return;
  if (!isOperatorRoute(route) && !config.rateLimit.enabled) return;
  const verdict = selected.consume(`${address}:${bucketFor(route)}`);
  if (verdict.allowed) return;
  throw Object.assign(apiError("RATE_LIMITED", "too many requests"), {
    retryAfterSeconds: verdict.retryAfterSeconds,
  });
}

function bucketFor(route: Route): string {
  if (isOperatorRoute(route)) return "operator";
  return route === "health" ? "health" : "api";
}

/**
 * Rejects before any upstream call. The reply says only that authorisation
 * failed: whether the token was absent, malformed, or simply wrong is not
 * something an unauthenticated caller gets to learn.
 */
function requireOperator(dependencies: TransitApiDependencies, request: Request): void {
  const { operatorToken, config } = dependencies;
  if (!config.operator.enabled || !operatorToken) {
    throw apiError("OPERATOR_DISABLED", "ride capture endpoints are not enabled on this deployment");
  }
  const presented = readBearerToken(request.headers.get("authorization"));
  if (!operatorTokenMatches(operatorToken, presented)) {
    throw apiError("UNAUTHORIZED", "operator authorization required");
  }
}

function requireSessions(dependencies: TransitApiDependencies): JourneySessionCoordinator {
  const { sessions, config } = dependencies;
  if (sessions && config.sessions.enabled) return sessions;
  throw apiError(
    "SESSIONS_UNAVAILABLE",
    "ride sessions are held in one process's memory and are disabled on this deployment",
  );
}

function clientAddress(request: Request, context: RequestContext): string {
  // Only trustworthy because Vercel's proxy rewrites these headers. The local
  // adapter passes the peer address instead and sets no headers.
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return context.clientAddress?.trim() || "unknown";
}

/* --------------------------------------------------------------------- CORS */

function corsHeaders(config: TransitApiConfig, origin: string | null): Record<string, string> {
  // Native iOS is not a CORS client. A browser origin is allowed only when an
  // operator listed it, so the default deployment answers no browser at all.
  if (config.cors.allowedOrigins.length === 0) return { vary: "Origin" };
  if (!origin || !config.cors.allowedOrigins.includes(origin)) return { vary: "Origin" };
  return {
    vary: "Origin",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "600",
  };
}

function preflight(
  config: TransitApiConfig,
  resolved: Resolved | undefined,
  cors: Record<string, string>,
): Response {
  const allowed = config.cors.allowedOrigins.length > 0 && "access-control-allow-origin" in cors;
  const headers: Record<string, string> = { ...baseHeaders(), ...cors, "cache-control": "no-store" };
  if (resolved) headers.allow = [...resolved.methods, "OPTIONS"].join(", ");
  return new Response(null, { status: allowed ? 204 : 403, headers });
}

/* ---------------------------------------------------------------- responses */

function baseHeaders(): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...baseHeaders(),
      ...headers,
    },
  });
}

/**
 * The shared CDN, not the browser, is what bounds upstream fan-out across
 * serverless instances, so `s-maxage` mirrors the in-process TTL exactly and no
 * stale-while-revalidate window is granted to freshness-sensitive data.
 */
function sharedCacheControl(ttlMs: number): Record<string, string> {
  const seconds = Math.max(0, Math.round(ttlMs / 1_000));
  if (seconds === 0) return { "cache-control": "no-store" };
  return { "cache-control": `public, max-age=0, s-maxage=${seconds}, must-revalidate` };
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

function latestReceivedAt(items: Array<{ receivedAt?: string }>): string | undefined {
  let latest: string | undefined;
  for (const item of items) {
    if (!item.receivedAt) continue;
    if (latest === undefined || item.receivedAt > latest) latest = item.receivedAt;
  }
  return latest;
}

function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value, "http://transit.invalid");
  } catch {
    return undefined;
  }
}

/** Only official public identifiers are logged; never a credential or a query blob. */
function safeQueryFields(url: URL | undefined): LogFields {
  if (!url) return {};
  const fields: LogFields = {};
  const cityCode = url.searchParams.get("cityCode");
  const routeId = url.searchParams.get("routeId");
  const routeNumber = url.searchParams.get("routeNo");
  if (cityCode && CITY_CODE_PATTERN.test(cityCode)) fields.cityCode = cityCode;
  if (routeId && ROUTE_ID_PATTERN.test(routeId)) fields.routeId = routeId;
  if (routeNumber && ROUTE_NUMBER_PATTERN.test(routeNumber)) fields.routeNo = routeNumber;
  return fields;
}

/* ------------------------------------------------------------------- errors */

export interface ApiError extends Error {
  code: string;
  retryAfterSeconds?: number;
}

export function apiError(code: string, message: string): ApiError {
  return Object.assign(new Error(message), { code });
}

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  SESSION_EXPIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  PROVIDER_RESPONSE_INVALID: 502,
  BLOCKED_BY_CREDENTIALS: 503,
  SESSIONS_UNAVAILABLE: 503,
  OPERATOR_DISABLED: 503,
};

function errorResponse(
  error: unknown,
  log: (level: LogLevel, event: string, fields: LogFields) => void,
): Response {
  const code = error && typeof error === "object" && "code" in error ? String((error as ApiError).code) : "INTERNAL_ERROR";
  const status = STATUS_BY_CODE[code] ?? 500;
  // Only messages this service wrote are published. An unexpected throw could
  // carry upstream detail, so it is logged and answered generically.
  const message = status >= 500 && !(code in STATUS_BY_CODE)
    ? "internal error"
    : error instanceof Error
      ? error.message
      : "request failed";
  if (status >= 500) {
    log("error", "transit_api_unhandled", {
      code,
      message: error instanceof Error ? error.message : "unknown error",
    });
  }
  const headers: Record<string, string> = { "cache-control": "no-store" };
  const retryAfter = error && typeof error === "object" ? (error as ApiError).retryAfterSeconds : undefined;
  if (retryAfter !== undefined) headers["retry-after"] = String(retryAfter);
  return json({ error: code, message }, status, headers);
}

function defaultLog(level: LogLevel, event: string, fields: LogFields): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
