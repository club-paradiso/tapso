import test from "node:test";
import assert from "node:assert/strict";
import { createTransitApiHandler, normalizePath, type TransitApiHandler } from "../src/apiRouter.ts";
import { readTransitApiConfig, type ServerEnv } from "../src/apiConfig.ts";
import { CachedTransitProvider } from "../src/cachedTransitProvider.ts";
import { JourneySessionCoordinator } from "../src/journeySession.ts";
import { createBurstLimiter } from "../src/rateLimit.ts";
import { ProviderConfigurationError, ProviderResponseError, type TransitProvider } from "../src/provider.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";

const CITY = "39";
const ROUTE = "JEB405136521";
const EPOCH = new Date(0).toISOString();

class StubProvider implements TransitProvider {
  stopCalls = 0;
  vehicleCalls = 0;
  stopFailure: Error | undefined;
  vehicleFailure: Error | undefined;

  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    this.stopCalls += 1;
    if (this.stopFailure) throw this.stopFailure;
    return [
      { stopId: "S1", name: "제주대학교", sequence: 1, latitude: 33.4, longitude: 126.5 },
      { stopId: "S2", name: "아라초등학교", sequence: 2, latitude: 33.41, longitude: 126.51 },
      { stopId: "S3", name: "제주한라대학교", sequence: 3, latitude: 33.42, longitude: 126.52 },
    ];
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

function harness(env: ServerEnv = {}, overrides: { discoveryFailure?: Error } = {}): Harness {
  const config = readTransitApiConfig({ TAGO_SERVICE_KEY: "synthetic-key", ...env }, { nodeVersion: "v22.0.0" });
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
    sessions: new JourneySessionCoordinator(provider),
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
  assert.equal(body.freshness.automaticMatching, "withheld_pending_source_freshness_rule");
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
  assert.equal(body.meta.providerObservationTimestamp, "unavailable");
  assert.equal(body.meta.freshnessPolicy, "fail_closed");
  assert.equal(body.meta.automaticMatching, "withheld_pending_source_freshness_rule");
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
  const created = await postJson(handler, "/v1/sessions", {
    routeId: ROUTE,
    cityCode: CITY,
    boardingStopSequence: 1,
    destinationStopSequence: 3,
  });
  assert.equal(created.status, 201);
  const session = await created.json();
  assert.equal(session.state, "awaiting_match");
  assert.equal(session.selectedVehicleId, undefined);
  assert.equal(session.matchConfidence, "unknown");

  const refreshed = await get(handler, `/v1/sessions/${session.id}`);
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).state, "awaiting_match");

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
  const response = await postJson(handler, "/v1/matches", {
    routeId: ROUTE,
    boardingStopSequence: 1,
    now: "2026-09-12T00:00:10.000Z",
    candidates: [
      { vehicleId: "A", routeId: ROUTE, observedAt: EPOCH, timestampSource: "unavailable", stopSequence: 1 },
    ],
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "unavailable");
  assert.equal(body.confidence, "unknown");
  assert.deepEqual(body.ranked[0].rejectedReasons, ["stale_or_invalid_timestamp"]);
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

test("the canonical name reaches the real provider through the wiring", async () => {
  const { createTransitApi } = await import("../src/apiRuntime.ts");
  const api = createTransitApi({ VERCEL: "1", TAGO_SERVICE_KEY: "canonical-key" });
  assert.equal(api.config.liveTransitConfigured, true);
  assert.equal(api.config.credential.source, "canonical");

  const health = await (await api.handler(new Request("http://api.test/health"))).json();
  assert.equal(health.liveTransitConfigured, true);
  assert.ok(!JSON.stringify(health).includes("canonical-key"));
});
