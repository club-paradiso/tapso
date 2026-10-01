import test from "node:test";
import assert from "node:assert/strict";
import { createTransitApiHandler, normalizePath, type TransitApiHandler } from "../src/apiRouter.ts";
import { readTransitApiConfig, type ServerEnv } from "../src/apiConfig.ts";
import { CachedTransitProvider } from "../src/cachedTransitProvider.ts";
import { JourneySessionCoordinator } from "../src/journeySession.ts";
import { MATCHER_POLICY_VERSION } from "../src/matching.ts";
import type { ReadinessLevel } from "../src/matcherSafetyGate.ts";
import { createBurstLimiter } from "../src/rateLimit.ts";
import { ProviderConfigurationError, ProviderResponseError, type TransitProvider } from "../src/provider.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";

const CITY = "39";
const ROUTE = "JEB405136521";
const EPOCH = new Date(0).toISOString();

/**
 * Synthetic fixture: the route's stops as every stub provider here publishes
 * them. The coordinates are invented, evenly spaced points, and every vehicle
 * number in this file is invented too.
 */
const STOPS: StopOnRoute[] = [
  { stopId: "S1", name: "제주대학교", sequence: 1, latitude: 33.4, longitude: 126.5 },
  { stopId: "S2", name: "아라초등학교", sequence: 2, latitude: 33.41, longitude: 126.51 },
  { stopId: "S3", name: "제주한라대학교", sequence: 3, latitude: 33.42, longitude: 126.52 },
];

class StubProvider implements TransitProvider {
  stopCalls = 0;
  vehicleCalls = 0;
  stopFailure: Error | undefined;
  vehicleFailure: Error | undefined;

  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    this.stopCalls += 1;
    if (this.stopFailure) throw this.stopFailure;
    return STOPS.map((stop) => ({ ...stop }));
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    this.vehicleCalls += 1;
    if (this.vehicleFailure) throw this.vehicleFailure;
    return [
      {
        vehicleId: "제주70자1234",
        routeId: request.routeId,
        observedAt: EPOCH,
        receivedAt: "2026-09-12T00:00:00.000Z",
        timestampSource: "unavailable",
        stopId: "S1",
        stopName: "제주대학교",
        stopSequence: 1,
        latitude: 33.4,
        longitude: 126.5,
        receiveType: "TAGO_SNAPSHOT",
      },
    ];
  }
}

type Harness = {
  handler: TransitApiHandler;
  upstream: StubProvider;
  discoveryCalls: { cities: number; routes: number };
};

function harness(
  env: ServerEnv = {},
  overrides: { discoveryFailure?: Error; demonstratedReadiness?: ReadinessLevel } = {},
): Harness {
  const config = readTransitApiConfig(
    { TAGO_SERVICE_KEY: "synthetic-key", ...env },
    { nodeVersion: "v22.0.0", ...(overrides.demonstratedReadiness ? { demonstratedReadiness: overrides.demonstratedReadiness } : {}) },
  );
  const upstream = new StubProvider();
  const provider = new CachedTransitProvider(upstream, {
    stopTtlMs: config.cachePolicy.stopTtlMs,
    vehicleTtlMs: config.cachePolicy.vehicleTtlMs,
  });
  const discoveryCalls = { cities: 0, routes: 0 };
  const discovery = {
    async cities() {
      discoveryCalls.cities += 1;
      if (overrides.discoveryFailure) throw overrides.discoveryFailure;
      return [{ cityCode: CITY, name: "제주특별자치도" }];
    },
    async routes(cityCode: string, routeNumber: string) {
      discoveryCalls.routes += 1;
      if (overrides.discoveryFailure) throw overrides.discoveryFailure;
      return [
        { routeId: "JEB405136521", routeNumber, startStopName: `${cityCode}-A`, endStopName: "B" },
        { routeId: "JEB405136522", routeNumber, startStopName: "B", endStopName: `${cityCode}-A` },
      ];
    },
  };
  const handler = createTransitApiHandler({
    config,
    discovery,
    provider,
    // Mirrors `createTransitApi`: the coordinator is told the rollout decision
    // the config made, so these tests exercise the wiring production uses.
    sessions: new JourneySessionCoordinator(provider, {
      automaticMatchingEnabled: config.matching.automaticMatchingEnabled,
    }),
    limiter: config.rateLimit.enabled
      ? createBurstLimiter(config.rateLimit.limit, config.rateLimit.windowSeconds)
      : undefined,
    log: () => {},
  });
  return { handler, upstream, discoveryCalls };
}

function get(handler: TransitApiHandler, path: string, init: RequestInit = {}): Promise<Response> {
  return handler(new Request(`http://api.test${path}`, init));
}

function postJson(handler: TransitApiHandler, path: string, body: unknown): Promise<Response> {
  return handler(
    new Request(`http://api.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("normalizePath accepts both the public contract and the function path", () => {
  assert.equal(normalizePath("/v1/vehicles"), "/v1/vehicles");
  assert.equal(normalizePath("/api/v1/vehicles"), "/v1/vehicles");
  assert.equal(normalizePath("/api//v1///vehicles/"), "/v1/vehicles");
  assert.equal(normalizePath("/api"), "/");
  assert.equal(normalizePath("/apiary/thing"), "/apiary/thing");
});

test("health reports configuration without revealing the credential", async () => {
  const { handler } = harness();
  const response = await get(handler, "/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.transitProvider, "tago");
  assert.equal(body.liveTransitConfigured, true);
  assert.equal(body.sessionStore, "memory");
  assert.equal(body.freshness.providerObservationTimestamp, "unavailable");
  assert.equal(body.freshness.policy, "server_observed_cadence_v1");
  assert.equal(body.freshness.automaticMatching, "shadow_only_pending_matching_readiness");
  assert.equal(body.freshness.cadencePolicy.historyWindowSeconds, 90);
  assert.equal(body.freshness.cadencePolicy.minimumSamples, 3);
  assert.equal(body.freshness.cadencePolicy.requiresProviderContentChange, true);
  assert.equal(body.freshness.cadencePolicy.calibration, "provisional");
  assert.equal(body.freshness.fieldValidationGate.status, "superseded");
  assert.equal(body.freshness.fieldValidationGate.supersededBy, "matcher-passive-safety-v4");
  assert.equal(body.freshness.fieldValidationGate.requiredBoardings, 30);
  assert.equal(body.freshness.matchingReadiness.demonstrated, "READY_FOR_SHADOW");
  assert.match(body.freshness.automaticMatchingWithheldBecause, /matcher-passive-safety-v4 has demonstrated READY_FOR_SHADOW/);
  assert.match(body.freshness.automaticMatchingWithheldBecause, /needs READY_FOR_BOUNDED_AUTOMATION/);
  assert.equal(body.matching.automaticMatchingEnabled, false);
  assert.equal(body.matching.automaticMatchingRequested, false);
  assert.equal(body.matching.mode, "shadow");
  assert.equal(body.matching.matcherPolicy, "directed-route-progress-v1");
  assert.equal(body.matching.withheldReason, "matching_readiness_below_bounded_automation");
  assert.equal(body.matching.readiness.demonstrated, "READY_FOR_SHADOW");
  assert.equal(body.matching.readiness.requiredForAutomaticMatching, "READY_FOR_BOUNDED_AUTOMATION");
  assert.equal(body.credential.source, "canonical");
  assert.ok(!JSON.stringify(body).includes("synthetic-key"));
  // The payload reports a category, never a variable name a scraper could use.
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes("TAGO_SERVICE_KEY"));
  assert.ok(!serialized.includes("PUBLIC_DATA_SERVICE_KEY"));
  assert.ok(!/serviceKey/i.test(serialized));
});

test("health surfaces a deployment left on the retired credential name", async () => {
  const { handler } = harness({ VERCEL: "1", TAGO_SERVICE_KEY: "", PUBLIC_DATA_SERVICE_KEY: "legacy" });
  const body = await (await get(handler, "/health")).json();
  assert.equal(body.liveTransitConfigured, false);
  assert.equal(body.credential.source, "missing");
  assert.equal(body.credential.deprecatedNamePresent, true);
  assert.ok(!JSON.stringify(body).includes("legacy"));
});

test("health reports an unconfigured deployment as not live", async () => {
  const config = readTransitApiConfig({}, { nodeVersion: "v22.0.0" });
  assert.equal(config.liveTransitConfigured, false);
});

test("discovery endpoints answer with official identifiers and are cached", async () => {
  const { handler, discoveryCalls } = harness();

  const cities = await get(handler, "/v1/cities");
  assert.equal(cities.status, 200);
  assert.deepEqual((await cities.json()).items, [{ cityCode: CITY, name: "제주특별자치도" }]);

  await get(handler, "/v1/cities");
  assert.equal(discoveryCalls.cities, 1, "a second read is served from the discovery cache");

  const routes = await get(handler, `/v1/routes?cityCode=${CITY}&routeNo=365`);
  const routeBody = await routes.json();
  assert.equal(routes.status, 200);
  assert.deepEqual(routeBody.items.map((item: { routeId: string }) => item.routeId), [
    "JEB405136521",
    "JEB405136522",
  ]);
  assert.equal(routeBody.meta.variantsPreserved, true);
  assert.match(routes.headers.get("cache-control") ?? "", /^public, max-age=0, s-maxage=\d+, must-revalidate$/);
});

test("stops preserve direction-specific order and set a shared cache window", async () => {
  const { handler, upstream } = harness();
  const response = await get(handler, `/v1/stops?routeId=${ROUTE}&cityCode=${CITY}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.items.map((stop: { sequence: number }) => stop.sequence), [1, 2, 3]);
  assert.equal(body.meta.routeId, ROUTE);
  assert.equal(body.meta.directionScope, "route_id");
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, s-maxage=21600, must-revalidate");

  await get(handler, `/v1/stops?routeId=${ROUTE}&cityCode=${CITY}`);
  assert.equal(upstream.stopCalls, 1);
});

test("vehicles never claim a provider observation timestamp", async () => {
  const { handler } = harness();
  const response = await get(handler, `/v1/vehicles?routeId=${ROUTE}&cityCode=${CITY}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, s-maxage=20, must-revalidate");
  const body = await response.json();
  assert.equal(body.meta.freshness.providerObservationTimestamp, "unavailable");
  assert.equal(body.meta.freshness.policy, "server_observed_cadence_v1");
  assert.equal(body.meta.freshness.automaticMatching, "shadow_only_pending_matching_readiness");
  assert.equal(body.meta.freshness.fieldValidationGate.status, "superseded");
  assert.equal(body.meta.freshness.fieldValidationGate.requiredBoardings, 30);
  assert.equal(body.meta.freshness.cadencePolicy.maximumReceiptGapSeconds, 30);
  assert.equal(body.meta.freshness.cadencePolicy.requiresProviderContentChange, true);
  assert.equal(body.meta.freshness.cadencePolicy.calibration, "provisional");
  // The blocker is matcher evidence. Saying "durable storage" here would make
  // the feature sound one infrastructure task away from shipping to passengers.
  assert.match(body.meta.freshness.automaticMatchingWithheldBecause, /demonstrated READY_FOR_SHADOW/);
  assert.doesNotMatch(body.meta.freshness.automaticMatchingWithheldBecause, /durable|storage|session/i);
  assert.doesNotMatch(JSON.stringify(body.meta.freshness), /durable|session_store/i);
  assert.equal(body.meta.receivedAt, "2026-09-12T00:00:00.000Z");
  assert.equal(body.items[0].observedAt, EPOCH);
  assert.equal(body.items[0].timestampSource, "unavailable");
});

test("official identifiers are validated before any upstream call", async () => {
  const { handler, upstream } = harness();
  const cases = [
    `/v1/stops?routeId=${ROUTE}`,
    `/v1/stops?cityCode=${CITY}`,
    `/v1/stops?routeId=${ROUTE}&cityCode=not-a-city`,
    `/v1/stops?routeId=${"x".repeat(65)}&cityCode=${CITY}`,
    `/v1/stops?routeId=../../etc/passwd&cityCode=${CITY}`,
    `/v1/stops?stdgCd=${CITY}&routeId=${ROUTE}`,
    `/v1/stops?regionCode=${CITY}&routeId=${ROUTE}`,
    `/v1/vehicles?routeId=${ROUTE}&cityCode=3900000`,
    "/v1/routes?cityCode=39",
  ];
  for (const path of cases) {
    const response = await get(handler, path);
    assert.equal(response.status, 400, `${path} must be rejected`);
    assert.equal((await response.json()).error, "INVALID_INPUT");
  }
  assert.equal(upstream.stopCalls, 0);
  assert.equal(upstream.vehicleCalls, 0);
});

test("unknown paths and wrong methods are answered without touching upstream", async () => {
  const { handler, upstream } = harness();
  for (const path of ["/v1/nope", "/v1/sessions/a/b/c", "/v1", "/not-found", "/api/not-found"]) {
    const notFound = await get(handler, path);
    assert.equal(notFound.status, 404, path);
    assert.equal((await notFound.json()).error, "NOT_FOUND", path);
  }

  const wrongMethod = await postJson(handler, `/v1/vehicles?routeId=${ROUTE}&cityCode=${CITY}`, {});
  assert.equal(wrongMethod.status, 405);
  assert.equal((await wrongMethod.json()).error, "METHOD_NOT_ALLOWED");
  assert.equal(upstream.vehicleCalls, 0);
});

test("provider failures map to safe statuses and are never cached as success", async () => {
  const { handler, upstream } = harness();
  upstream.vehicleFailure = new ProviderConfigurationError("TAGO_SERVICE_KEY is required for TAGO live transit calls");
  const blocked = await get(handler, `/v1/vehicles?routeId=${ROUTE}&cityCode=${CITY}`);
  assert.equal(blocked.status, 503);
  assert.equal((await blocked.json()).error, "BLOCKED_BY_CREDENTIALS");
  assert.equal(blocked.headers.get("cache-control"), "no-store");

  upstream.vehicleFailure = new ProviderResponseError("TAGO provider error 03");
  const invalid = await get(handler, `/v1/vehicles?routeId=${ROUTE}&cityCode=${CITY}`);
  assert.equal(invalid.status, 502);
  assert.equal((await invalid.json()).error, "PROVIDER_RESPONSE_INVALID");

  upstream.vehicleFailure = undefined;
  const recovered = await get(handler, `/v1/vehicles?routeId=${ROUTE}&cityCode=${CITY}`);
  assert.equal(recovered.status, 200);
  assert.equal(upstream.vehicleCalls, 3, "failures were retried rather than served from cache");
});

test("an unexpected failure is answered generically", async () => {
  const { handler, upstream } = harness();
  upstream.vehicleFailure = new Error("postgres://user:hunter2@db.internal/transit is unreachable");
  const response = await get(handler, `/v1/vehicles?routeId=${ROUTE}&cityCode=${CITY}`);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, "INTERNAL_ERROR");
  assert.equal(body.message, "internal error");
  assert.ok(!JSON.stringify(body).includes("hunter2"));
});

test("session endpoints fail closed when memory-only sessions are disabled", async () => {
  const { handler } = harness({ TRANSIT_SESSIONS_ENABLED: "false" });
  for (const [method, path] of [
    ["POST", "/v1/sessions"],
    ["GET", "/v1/sessions/abc"],
    ["POST", "/v1/sessions/abc/confirm"],
  ] as const) {
    const response = method === "GET"
      ? await get(handler, path)
      : await postJson(handler, path, { routeId: ROUTE, cityCode: CITY, boardingStopSequence: 1, destinationStopSequence: 3 });
    assert.equal(response.status, 503, `${method} ${path}`);
    assert.equal((await response.json()).error, "SESSIONS_UNAVAILABLE");
  }
});

test("an enabled session withholds automatic tracking while freshness is unknown", async () => {
  const { handler } = harness({ TRANSIT_SESSIONS_ENABLED: "true" });
  // The stub bus reports the stop before the rider's: approaching, the only
  // zone a waiting rider's bus may be selected from. What stands in the way is
  // its cadence, which no receipt history has established.
  const created = await postJson(handler, "/v1/sessions", {
    routeId: ROUTE,
    cityCode: CITY,
    boardingStopSequence: 2,
    destinationStopSequence: 3,
  });
  assert.equal(created.status, 201);
  const session = await created.json();
  // The bus is offered to the rider for explicit confirmation, never chosen
  // for them, and the matcher itself would not have chosen it either.
  assert.equal(session.state, "confirmation_required");
  assert.equal(session.selectedVehicleId, undefined);
  assert.equal(session.matchConfidence, "unknown");
  assert.equal(session.sourceFreshness?.["제주70자1234"]?.state, "unknown");
  assert.equal(session.shadowSelection?.status, "unavailable");
  assert.equal(session.shadowSelection?.wouldSelectVehicleId, undefined);
  assert.deepEqual(
    (session.candidates ?? []).map((candidate: { vehicleId: string; rejectedReasons: string[] }) =>
      [candidate.vehicleId, candidate.rejectedReasons]),
    [["제주70자1234", ["source_cadence_not_fresh"]]],
  );

  const refreshed = await get(handler, `/v1/sessions/${session.id}`);
  assert.equal(refreshed.status, 200);
  const refreshedSession = await refreshed.json();
  assert.equal(refreshedSession.state, "confirmation_required");
  assert.equal(refreshedSession.selectedVehicleId, undefined);

  const rewritten = await get(handler, `/v1/session?sessionId=${session.id}`);
  assert.equal(rewritten.status, 200, "the production rewrite target resolves the same session");
  assert.equal((await rewritten.json()).id, session.id);

  const missing = await get(handler, "/v1/sessions/00000000-0000-4000-8000-000000000000");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, "SESSION_NOT_FOUND");

  const badId = await get(handler, "/v1/sessions/not%2Fa%2Fvalid%20id");
  assert.equal(badId.status, 400);
});

test("explicit confirmation stays degraded because TAGO freshness is unknown", async () => {
  const { handler } = harness({ TRANSIT_SESSIONS_ENABLED: "true" });
  const created = await postJson(handler, "/v1/sessions", {
    routeId: ROUTE,
    cityCode: CITY,
    boardingStopSequence: 1,
    destinationStopSequence: 3,
  });
  const session = await created.json();

  const confirmed = await postJson(handler, `/v1/sessions/${session.id}/confirm`, { vehicleId: "제주70자1234" });
  assert.equal(confirmed.status, 200);
  const body = await confirmed.json();
  assert.equal(body.selectionMode, "explicit");
  assert.equal(body.state, "degraded");
  assert.equal(body.progress, undefined);

  const rewritten = await postJson(handler, `/v1/session-confirm?sessionId=${session.id}`, { vehicleId: "제주70자1234" });
  assert.equal(rewritten.status, 200, "the production rewrite target confirms the same session");
});

test("matching withholds selection for candidates without a provider timestamp", async () => {
  const { handler } = harness();
  // Approaching from the stop before the boarding stop, on a route whose stops
  // are given: the missing timestamp is the only thing in the way.
  const response = await postJson(handler, "/v1/matches", {
    routeId: ROUTE,
    boardingStopSequence: 2,
    now: "2026-09-12T00:00:10.000Z",
    stops: STOPS,
    candidates: [
      { vehicleId: "A", routeId: ROUTE, observedAt: EPOCH, timestampSource: "unavailable", stopSequence: 1 },
    ],
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "unavailable");
  assert.equal(body.confidence, "unknown");
  assert.equal(body.selectedVehicleId, undefined);
  assert.deepEqual(body.ranked[0].rejectedReasons, ["stale_or_invalid_timestamp"]);
  assert.deepEqual(body.abstentionReasons, []);
  assert.equal(body.matchingMode, "shadow");
  assert.equal(body.automaticSelection, "withheld");
});

test("matching rejects an unknown rider state, and a stateless match stays advisory by default", async () => {
  const { handler } = harness();
  // One stop before the boarding stop, with a provider timestamp five seconds
  // old: everything a waiting rider's match needs except the route's stops,
  // which each request below adds or leaves out on purpose.
  const request = {
    routeId: ROUTE,
    boardingStopSequence: 2,
    now: "2026-09-12T00:00:10.000Z",
    candidates: [
      { vehicleId: "A", routeId: ROUTE, observedAt: "2026-09-12T00:00:05.000Z", timestampSource: "provider", stopSequence: 1 },
    ],
  };

  const sideways = await postJson(handler, "/v1/matches", { ...request, stops: STOPS, riderState: "sideways" });
  assert.equal(sideways.status, 400);
  const refusal = await sideways.json();
  assert.equal(refusal.error, "INVALID_INPUT");
  assert.match(refusal.message, /riderState/);

  const response = await postJson(handler, "/v1/matches", { ...request, stops: STOPS });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "matched");
  // Still advice: this deployment never opted in, so the pick is never offered
  // as a selection. It is published as what the matcher would have chosen.
  assert.equal(body.selectedVehicleId, undefined);
  assert.deepEqual(body.shadowSelection, { status: "matched", wouldSelectVehicleId: "A", confidence: body.confidence });
  assert.equal(body.riderState, "waiting_at_stop", "an absent rider state is a rider waiting at the stop");
  assert.equal(body.policyVersion, MATCHER_POLICY_VERSION);
  assert.deepEqual(body.abstentionReasons, []);
  assert.equal(body.matchingMode, "shadow");
  assert.equal(body.automaticSelection, "withheld");

  // Without the route's stops a loop seam or a repeated stop cannot be ruled
  // out, so the same candidate is withheld.
  const unverified = await (await postJson(handler, "/v1/matches", request)).json();
  assert.equal(unverified.status, "ambiguous");
  assert.equal(unverified.selectedVehicleId, undefined);
  assert.deepEqual(unverified.abstentionReasons, ["route_topology_unverified"]);

  // An operator's opt-in cannot exceed the demonstrated readiness: at
  // READY_FOR_SHADOW the flag is refused and the answer stays advice.
  const optedIn = harness({ TRANSIT_AUTOMATIC_MATCHING_ENABLED: "true" });
  const refused = await (await postJson(optedIn.handler, "/v1/matches", { ...request, stops: STOPS })).json();
  assert.equal(refused.selectedVehicleId, undefined);
  assert.equal(refused.shadowSelection.wouldSelectVehicleId, "A");
  assert.equal(refused.matchingMode, "shadow");
  assert.equal(refused.automaticSelection, "withheld");

  // Only once the evidence demonstrates bounded automation does the opt-in
  // take effect. The readiness here is injected; no deployment can do that.
  const ready = harness({ TRANSIT_AUTOMATIC_MATCHING_ENABLED: "true" }, { demonstratedReadiness: "READY_FOR_BOUNDED_AUTOMATION" });
  const permitted = await (await postJson(ready.handler, "/v1/matches", { ...request, stops: STOPS })).json();
  assert.equal(permitted.selectedVehicleId, "A");
  assert.equal(permitted.shadowSelection, undefined);
  assert.equal(permitted.matchingMode, "automatic");
  assert.equal(permitted.automaticSelection, "permitted");
});

test("a stateless match carries no session memory: passage and declaredAt from a caller are ignored, never a 500", async () => {
  const { handler } = harness();
  const request = {
    routeId: ROUTE,
    boardingStopSequence: 2,
    now: "2026-09-12T00:00:10.000Z",
    stops: STOPS,
    candidates: [
      { vehicleId: "A", routeId: ROUTE, observedAt: "2026-09-12T00:00:05.000Z", timestampSource: "provider", stopSequence: 1 },
    ],
  };
  const baseline = await (await postJson(handler, "/v1/matches", request)).json();
  // A malformed memory used to reach the matcher and crash it; a well-formed
  // one would have let a caller steer a stateless answer.
  for (const extra of [
    { passage: { offsets: { A: null } } },
    { passage: { offsets: {}, withheld: { reason: "caller_supplied", at: "2026-09-12T00:00:00.000Z" } } },
    { declaredAt: "not a time" },
  ]) {
    const response = await postJson(handler, "/v1/matches", { ...request, ...extra });
    assert.equal(response.status, 200, JSON.stringify(extra));
    const body = await response.json();
    assert.equal(body.status, baseline.status, JSON.stringify(extra));
    assert.deepEqual(body.shadowSelection, baseline.shadowSelection, JSON.stringify(extra));
  }
  const badDirection = await postJson(handler, "/v1/matches", { ...request, directionCode: 7 });
  assert.equal(badDirection.status, 400);
});

test("bodies must be JSON, bounded, and well formed", async () => {
  const { handler } = harness({ TRANSIT_SESSIONS_ENABLED: "true" });

  const formPost = await handler(new Request("http://api.test/v1/matches", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "routeId=x",
  }));
  assert.equal(formPost.status, 400);
  assert.equal((await formPost.json()).error, "INVALID_INPUT");

  const malformed = await handler(new Request("http://api.test/v1/matches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  }));
  assert.equal(malformed.status, 400);

  const oversized = await handler(new Request("http://api.test/v1/matches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(70_000) }),
  }));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, "PAYLOAD_TOO_LARGE");
});

test("no browser origin is allowed unless an operator lists one", async () => {
  const closed = harness();
  const denied = await get(closed.handler, "/health", { headers: { origin: "https://evil.example" } });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.equal(denied.headers.get("vary"), "Origin");

  const preflightDenied = await get(closed.handler, "/health", {
    method: "OPTIONS",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(preflightDenied.status, 403);

  const open = harness({ TRANSIT_ALLOWED_ORIGINS: "https://tapso-nu.vercel.app" });
  const allowed = await get(open.handler, "/health", { headers: { origin: "https://tapso-nu.vercel.app" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://tapso-nu.vercel.app");

  const other = await get(open.handler, "/health", { headers: { origin: "https://tapso-nu.vercel.app.evil.example" } });
  assert.equal(other.headers.get("access-control-allow-origin"), null);

  const preflightAllowed = await get(open.handler, `/v1/vehicles?routeId=${ROUTE}&cityCode=${CITY}`, {
    method: "OPTIONS",
    headers: { origin: "https://tapso-nu.vercel.app" },
  });
  assert.equal(preflightAllowed.status, 204);
  assert.equal(preflightAllowed.headers.get("allow"), "GET, OPTIONS");
});

test("a burst of requests from one caller is rejected with retry-after", async () => {
  const { handler, upstream } = harness({ TRANSIT_RATE_LIMIT_PER_MINUTE: "3" });
  const headers = { "x-forwarded-for": "203.0.113.7" };
  const statuses: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    statuses.push((await get(handler, `/v1/stops?routeId=${ROUTE}&cityCode=${CITY}`, { headers })).status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 429, 429]);

  const limited = await get(handler, `/v1/stops?routeId=${ROUTE}&cityCode=${CITY}`, { headers });
  assert.equal((await limited.json()).error, "RATE_LIMITED");
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);

  const otherCaller = await get(handler, `/v1/stops?routeId=${ROUTE}&cityCode=${CITY}`, {
    headers: { "x-forwarded-for": "203.0.113.8" },
  });
  assert.equal(otherCaller.status, 200);
  assert.equal(upstream.stopCalls, 1, "the route cache absorbed every allowed read");
});

test("a serverless deployment carrying only the retired name fails closed end to end", async () => {
  // Exercises the real wiring, not the stub: createTransitApi builds the actual
  // TAGO provider, which must refuse before it ever reaches the network.
  const { createTransitApi } = await import("../src/apiRuntime.ts");
  const api = createTransitApi({ VERCEL: "1", PUBLIC_DATA_SERVICE_KEY: "legacy-name-only" });

  assert.equal(api.config.liveTransitConfigured, false);
  const vehicles = await api.handler(new Request(`http://api.test/v1/vehicles?routeId=${ROUTE}&cityCode=${CITY}`));
  assert.equal(vehicles.status, 503);
  const body = await vehicles.json();
  assert.equal(body.error, "BLOCKED_BY_CREDENTIALS");
  assert.match(body.message, /TAGO_SERVICE_KEY/);
  assert.ok(!JSON.stringify(body).includes("legacy-name-only"));
});

test("the wired session coordinator runs exactly the matching mode the configuration granted", async () => {
  // The real composition: an operator's opt-in at READY_FOR_SHADOW is refused,
  // and the coordinator that decides journey sessions must be told the refusal,
  // not the request. /health reports what the coordinator actually runs.
  const { createTransitApi } = await import("../src/apiRuntime.ts");
  for (const env of [{}, { TRANSIT_AUTOMATIC_MATCHING_ENABLED: "true" }, { VERCEL: "1", TRANSIT_AUTOMATIC_MATCHING_ENABLED: "true" }]) {
    const api = createTransitApi({ TAGO_SERVICE_KEY: "synthetic-key", ...env });
    const health = await (await api.handler(new Request("http://api.test/health"))).json();
    assert.equal(health.matching.automaticMatchingEnabled, false, JSON.stringify(env));
    assert.equal(health.matching.sessionMatchingMode, "shadow", JSON.stringify(env));
  }
});

test("the canonical name reaches the real provider through the wiring", async () => {
  const { createTransitApi } = await import("../src/apiRuntime.ts");
  const api = createTransitApi({ VERCEL: "1", TAGO_SERVICE_KEY: "canonical-key" });
  assert.equal(api.config.liveTransitConfigured, true);
  assert.equal(api.config.credential.source, "canonical");

  const health = await (await api.handler(new Request("http://api.test/health"))).json();
  assert.equal(health.liveTransitConfigured, true);
  assert.ok(!JSON.stringify(health).includes("canonical-key"));
});

test("the real wiring refuses an automatic-matching opt-in below the readiness it needs, and logs it once", async () => {
  const { createTransitApi } = await import("../src/apiRuntime.ts");
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (line: unknown) => { warnings.push(String(line)); };
  let api: Awaited<ReturnType<typeof createTransitApi>>;
  try {
    api = createTransitApi({ VERCEL: "1", TAGO_SERVICE_KEY: "canonical-key", TRANSIT_AUTOMATIC_MATCHING_ENABLED: "true" });
  } finally {
    console.warn = original;
  }
  assert.equal(api.config.matching.automaticMatchingEnabled, false);
  const refusals = warnings.map((line) => JSON.parse(line)).filter((entry) => entry.event === "automatic_matching_refused");
  assert.equal(refusals.length, 1);
  assert.match(refusals[0].message, /READY_FOR_SHADOW/);
  assert.ok(!warnings.join("\n").includes("canonical-key"));
});


/* ------------------------------------- the automatic-matching rollout gate */

/**
 * An end-to-end pair for the one claim that matters most in this PR: turning
 * ride sessions on must not turn automatic vehicle selection on with them.
 *
 * Both handlers see the same provider, the same clock, and a candidate whose
 * server-observed cadence is unambiguously fresh, approaching the rider's stop
 * from the stop before it — the only place a waiting rider's bus is ever
 * selected from. The only difference is `TRANSIT_AUTOMATIC_MATCHING_ENABLED`.
 */
function cadenceHarness(
  env: ServerEnv,
  demonstratedReadiness?: ReadinessLevel,
): { handler: TransitApiHandler; tick: () => void } {
  let now = new Date("2026-09-22T11:00:00Z");
  let latitude = 33.4;
  const config = readTransitApiConfig(
    { TAGO_SERVICE_KEY: "synthetic-key", ...env },
    { nodeVersion: "v22.0.0", ...(demonstratedReadiness ? { demonstratedReadiness } : {}) },
  );
  const provider: TransitProvider = {
    async stops() {
      return STOPS.map((stop) => ({ ...stop }));
    },
    async vehicles(request: RouteRequest) {
      return [{
        vehicleId: "제주70자1234",
        routeId: request.routeId,
        observedAt: EPOCH,
        receivedAt: now.toISOString(),
        timestampSource: "unavailable" as const,
        stopSequence: 1,
        latitude,
        longitude: 126.5,
        receiveType: "TAGO_SNAPSHOT",
      }];
    },
  };
  const handler = createTransitApiHandler({
    config,
    discovery: {
      async cities() { return [{ cityCode: CITY, name: "제주특별자치도" }]; },
      async routes() { return [{ routeId: ROUTE, routeNumber: "365", startStopName: "A", endStopName: "B" }]; },
    },
    provider,
    sessions: new JourneySessionCoordinator(provider, {
      now: () => now,
      automaticMatchingEnabled: config.matching.automaticMatchingEnabled,
    }),
    log: () => {},
  });
  // Five seconds on, and the vehicle actually moved: the cadence surrogate
  // needs changed provider content, not merely another receipt.
  return {
    handler,
    tick: () => {
      now = new Date(now.getTime() + 5_000);
      latitude += 0.0002;
    },
  };
}

async function driveToFreshCadence(handler: TransitApiHandler, tick: () => void) {
  // The bus reports stop 1 and the rider waits at stop 2. A bus reporting the
  // rider's own stop may be dwelling there or may have left, so it is never
  // selected automatically; this one has not reached it yet.
  const created = await postJson(handler, "/v1/sessions", {
    routeId: ROUTE,
    cityCode: CITY,
    boardingStopSequence: 2,
    destinationStopSequence: 3,
  });
  assert.equal(created.status, 201);
  const session = await created.json();
  assert.equal(session.riderState, "waiting_at_stop", "no riderState in the body means a rider waiting at the stop");
  let latest = session;
  for (let poll = 0; poll < 3; poll += 1) {
    tick();
    const response = await get(handler, `/v1/sessions/${session.id}`);
    assert.equal(response.status, 200);
    latest = await response.json();
  }
  return latest;
}

test("enabling sessions alone never enables automatic vehicle selection", async () => {
  const { handler, tick } = cadenceHarness({ TRANSIT_SESSIONS_ENABLED: "true" });
  const view = await driveToFreshCadence(handler, tick);

  assert.equal(view.matchingMode, "shadow");
  assert.equal(view.selectedVehicleId, undefined, "no bus is chosen for the rider");
  assert.equal(view.selectionMode, undefined);
  // The evidence that would have justified a match is published anyway, which
  // is the whole point of shadow mode.
  assert.equal(view.sourceFreshness?.["제주70자1234"]?.state, "fresh");
  assert.equal(view.shadowSelection?.status, "matched");
  assert.equal(view.shadowSelection?.wouldSelectVehicleId, "제주70자1234");
  assert.equal(view.state, "confirmation_required");
});

test("an operator's opt-in is refused below the readiness automatic selection needs", async () => {
  const { handler, tick } = cadenceHarness({
    TRANSIT_SESSIONS_ENABLED: "true",
    TRANSIT_AUTOMATIC_MATCHING_ENABLED: "true",
  });
  const view = await driveToFreshCadence(handler, tick);

  assert.equal(view.matchingMode, "shadow");
  assert.equal(view.selectedVehicleId, undefined, "the flag alone never picks a rider's bus");
  assert.equal(view.shadowSelection?.wouldSelectVehicleId, "제주70자1234");
  assert.equal(view.state, "confirmation_required");

  const body = await (await get(handler, "/health")).json();
  assert.equal(body.matching.automaticMatchingRequested, true);
  assert.equal(body.matching.automaticMatchingEnabled, false);
  assert.equal(body.matching.withheldReason, "matching_readiness_below_bounded_automation");
  assert.equal(body.freshness.automaticMatching, "shadow_only_pending_matching_readiness");
});

test("the same evidence does select once readiness permits it and an operator opts in", async () => {
  const { handler, tick } = cadenceHarness({
    TRANSIT_SESSIONS_ENABLED: "true",
    TRANSIT_AUTOMATIC_MATCHING_ENABLED: "true",
  }, "READY_FOR_BOUNDED_AUTOMATION");
  const view = await driveToFreshCadence(handler, tick);

  assert.equal(view.matchingMode, "automatic");
  assert.equal(view.selectedVehicleId, "제주70자1234");
  assert.equal(view.selectionMode, "automatic");
  assert.equal(view.state, "tracking");
  // Even here the epoch sentinel survives: opting in changes who selects, not
  // what TAGO published.
  assert.equal(view.progress?.observedAt, EPOCH);
  assert.equal(view.progress?.evidenceAtIs, "tapso_server_receipt");

  const health = await get(handler, "/health");
  const body = await health.json();
  assert.equal(body.freshness.automaticMatching, "enabled_by_explicit_operator_opt_in");
});

test("health reports the session store by category and never its credentials", async () => {
  const { handler } = harness({
    TRANSIT_SESSION_STORE: "redis",
    UPSTASH_REDIS_REST_URL: "https://synthetic.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "synthetic-upstash-token",
  });
  const response = await get(handler, "/health");
  const body = await response.json();

  assert.equal(body.sessionStore, "redis");
  assert.equal(body.sessions.store, "redis");
  assert.equal(body.sessions.durableStoreConfigured, true);

  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes("synthetic-upstash-token"));
  assert.ok(!serialized.includes("synthetic.upstash.io"));
  // Durable storage changes where sessions live. It does not change who is
  // allowed to pick a rider's bus.
  assert.equal(body.freshness.automaticMatching, "shadow_only_pending_matching_readiness");
  assert.equal(body.matching.automaticMatchingEnabled, false);
});

function del(handler: TransitApiHandler, path: string): Promise<Response> {
  return handler(new Request(`http://api.test${path}`, { method: "DELETE" }));
}

test("a rider ends a session: the row is gone, a second end is 404, and the rewrite target ends it too", async () => {
  const { handler } = harness({ TRANSIT_SESSIONS_ENABLED: "true" });
  const create = () => postJson(handler, "/v1/sessions", {
    routeId: ROUTE,
    cityCode: CITY,
    boardingStopSequence: 2,
    destinationStopSequence: 3,
  });

  const session = await (await create()).json();
  const ended = await del(handler, `/v1/sessions/${session.id}`);
  assert.equal(ended.status, 204);
  assert.equal(ended.headers.get("cache-control"), "no-store");
  assert.equal(await ended.text(), "");

  const afterwards = await get(handler, `/v1/sessions/${session.id}`);
  assert.equal(afterwards.status, 404, "an ended session is gone, not expired");
  assert.equal((await afterwards.json()).error, "SESSION_NOT_FOUND");

  const again = await del(handler, `/v1/sessions/${session.id}`);
  assert.equal(again.status, 404);
  assert.equal((await again.json()).error, "SESSION_NOT_FOUND");

  const rewritten = await (await create()).json();
  const viaRewrite = await del(handler, `/v1/session?sessionId=${rewritten.id}`);
  assert.equal(viaRewrite.status, 204, "the production rewrite target ends the same session");
  assert.equal((await get(handler, `/v1/sessions/${rewritten.id}`)).status, 404);

  assert.equal((await del(handler, "/v1/sessions/not%2Fa%2Fvalid%20id")).status, 400);
  assert.equal((await del(handler, "/v1/sessions")).status, 405, "the collection itself cannot be deleted");
  const confirm = await handler(new Request(`http://api.test/v1/sessions/${rewritten.id}/confirm`, { method: "DELETE" }));
  assert.equal(confirm.status, 405);
});

test("ending a session fails closed like every session route when sessions are disabled", async () => {
  const { handler } = harness({ TRANSIT_SESSIONS_ENABLED: "false" });
  const response = await del(handler, "/v1/sessions/abc");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "SESSIONS_UNAVAILABLE");
});

test("a browser origin an operator listed may end a session; the preflight names DELETE", async () => {
  const { handler } = harness({ TRANSIT_SESSIONS_ENABLED: "true", TRANSIT_ALLOWED_ORIGINS: "https://tapso-nu.vercel.app" });
  const preflight = await handler(new Request("http://api.test/v1/sessions/abc", {
    method: "OPTIONS",
    headers: { origin: "https://tapso-nu.vercel.app", "access-control-request-method": "DELETE" },
  }));
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /\bDELETE\b/);
  assert.match(preflight.headers.get("allow") ?? "", /\bDELETE\b/);
});

test("a production deployment serves sessions only from the production namespace, and says why when it cannot", async () => {
  const durable = {
    VERCEL: "1",
    TRANSIT_SESSION_STORE: "redis",
    UPSTASH_REDIS_REST_URL: "https://synthetic.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "synthetic-upstash-token",
  };
  const cases: Array<{ env: ServerEnv; enabled: boolean; namespace: string }> = [
    { env: { ...durable, VERCEL_ENV: "production", TRANSIT_SESSION_KEY_PREFIX: "tapso:prod:journey-session:" }, enabled: true, namespace: "production" },
    { env: { ...durable, VERCEL_ENV: "production" }, enabled: false, namespace: "default" },
    { env: { ...durable, VERCEL_ENV: "production", TRANSIT_SESSION_KEY_PREFIX: "tapso:preview:journey-session:" }, enabled: false, namespace: "preview" },
    { env: { ...durable, VERCEL_ENV: "preview", TRANSIT_SESSION_KEY_PREFIX: "tapso:prod:journey-session:" }, enabled: false, namespace: "production" },
    { env: { ...durable, VERCEL_ENV: "preview", TRANSIT_SESSION_KEY_PREFIX: "tapso:preview:journey-session:" }, enabled: true, namespace: "preview" },
    { env: { ...durable, VERCEL_ENV: "preview", TRANSIT_SESSION_KEY_PREFIX: "tapso:verify:journey-session:" }, enabled: false, namespace: "verification" },
  ];
  for (const { env, enabled, namespace } of cases) {
    const label = `${env.VERCEL_ENV} ${env.TRANSIT_SESSION_KEY_PREFIX ?? "(default)"}`;
    const { handler } = harness(env);
    const health = await (await get(handler, "/health")).json();
    assert.equal(health.sessions.enabled, enabled, label);
    assert.equal(health.sessions.namespace, namespace, label);
    assert.equal(health.sessions.problem === undefined, enabled, label);
    assert.ok(!JSON.stringify(health).includes("journey-session:"), `${label}: the prefix itself never reaches /health`);
    const response = await postJson(handler, "/v1/sessions", { routeId: ROUTE, cityCode: CITY, boardingStopSequence: 2, destinationStopSequence: 3 });
    if (enabled) {
      assert.notEqual(response.status, 503, label);
    } else {
      assert.equal(response.status, 503, label);
      const body = await response.json();
      assert.equal(body.error, "SESSIONS_UNAVAILABLE", label);
      assert.match(body.message, /namespace/, label);
    }
  }
});
