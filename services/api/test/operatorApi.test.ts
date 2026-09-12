import test from "node:test";
import assert from "node:assert/strict";
import { createTransitApiHandler, type TransitApiHandler } from "../src/apiRouter.ts";
import { readTransitApiConfig, type ServerEnv } from "../src/apiConfig.ts";
import { CachedTransitProvider } from "../src/cachedTransitProvider.ts";
import { createBurstLimiter } from "../src/rateLimit.ts";
import { operatorTokenMatches, readBearerToken, resolveOperatorToken } from "../src/operatorAuth.ts";
import type { TransitProvider } from "../src/provider.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { RIDE_CAPTURE_SCHEMA_VERSION, type RideCapture } from "../src/rideCapture.ts";

const CITY = "39";
const ROUTE = "JEB405244701";
const SERVICE_KEY = "synthetic-decoding-key-value";
const TOKEN = "operator-token-for-tests-0123456789";
const EPOCH = new Date(0).toISOString();

class CountingProvider implements TransitProvider {
  vehicleCalls = 0;

  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    return [
      { stopId: "JEB405002104", name: "농림축산검역본부[남]", sequence: 27 },
      { stopId: "S28", name: "중간", sequence: 28 },
      { stopId: "JEB405000334", name: "관덕정[남]", sequence: 34 },
    ];
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    this.vehicleCalls += 1;
    return [
      {
        vehicleId: "제주79자3696",
        routeId: request.routeId,
        observedAt: EPOCH,
        receivedAt: `2026-09-12T00:00:${String(this.vehicleCalls).padStart(2, "0")}.000Z`,
        timestampSource: "unavailable",
        stopId: "JEB405002104",
        stopName: "농림축산검역본부[남]",
        stopSequence: 27,
        latitude: 33.48,
        longitude: 126.48,
        receiveType: "TAGO_SNAPSHOT",
      },
    ];
  }
}

function harness(env: ServerEnv = {}) {
  const config = readTransitApiConfig(
    { TAGO_SERVICE_KEY: SERVICE_KEY, RIDE_CAPTURE_OPERATOR_TOKEN: TOKEN, ...env },
    { nodeVersion: "v22.0.0" },
  );
  const upstream = new CountingProvider();
  const provider = new CachedTransitProvider(upstream, {
    stopTtlMs: config.cachePolicy.stopTtlMs,
    vehicleTtlMs: config.cachePolicy.vehicleTtlMs,
  });
  const operator = resolveOperatorToken({ RIDE_CAPTURE_OPERATOR_TOKEN: TOKEN, ...env });
  const handler = createTransitApiHandler({
    config,
    discovery: {
      async cities() {
        return [{ cityCode: CITY, name: "제주특별자치도" }];
      },
      async routes(_cityCode: string, routeNumber: string) {
        return [{ routeId: ROUTE, routeNumber }];
      },
    },
    provider,
    directProvider: upstream,
    limiter: config.rateLimit.enabled
      ? createBurstLimiter(config.rateLimit.limit, config.rateLimit.windowSeconds)
      : undefined,
    operatorLimiter: config.operator.rateLimitPerMinute > 0
      ? createBurstLimiter(config.operator.rateLimitPerMinute, 60)
      : undefined,
    ...(operator.configured ? { operatorToken: operator.token } : {}),
    log: () => {},
  });
  return { handler, upstream, config };
}

function snapshot(handler: TransitApiHandler, init: RequestInit = {}, query = `?routeId=${ROUTE}&cityCode=${CITY}`) {
  return handler(new Request(`http://api.test/operator/snapshot${query}`, init));
}

function bearer(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } };
}

function syntheticCapture(overrides: Partial<RideCapture> = {}): RideCapture {
  const stops: StopOnRoute[] = [
    { stopId: "JEB405002104", name: "농림축산검역본부[남]", sequence: 27 },
    { stopId: "S28", name: "중간", sequence: 28 },
    { stopId: "JEB405000334", name: "관덕정[남]", sequence: 34 },
  ];
  return {
    schemaVersion: RIDE_CAPTURE_SCHEMA_VERSION,
    source: "web-controller",
    startedAt: "2026-09-12T09:00:00.000Z",
    endedAt: "2026-09-12T09:10:00.000Z",
    routeId: ROUTE,
    cityCode: CITY,
    boardingStopSequence: 27,
    destinationStopSequence: 34,
    boardedVehicleId: "제주79자3696",
    intervalMs: 5_000,
    stops,
    snapshots: [
      {
        capturedAt: "2026-09-12T09:00:00.000Z",
        vehicles: [{ vehicleId: "제주79자3696", routeId: ROUTE, observedAt: EPOCH, stopSequence: 27 }],
      },
      {
        capturedAt: "2026-09-12T09:00:05.000Z",
        vehicles: [{ vehicleId: "제주79자3696", routeId: ROUTE, observedAt: EPOCH, stopSequence: 28 }],
      },
    ],
    markers: [{ at: "2026-09-12T09:00:01.000Z", kind: "boarded", stopSequence: 27 }],
    events: [{ at: "2026-09-12T09:02:00.000Z", kind: "hidden" }, { at: "2026-09-12T09:03:00.000Z", kind: "visible" }],
    ...overrides,
  };
}

test("the operator snapshot endpoint stays closed until a token is configured", async () => {
  const { handler, upstream } = harness({ RIDE_CAPTURE_OPERATOR_TOKEN: "" });
  const response = await snapshot(handler, bearer(TOKEN));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "OPERATOR_DISABLED");
  assert.equal(upstream.vehicleCalls, 0, "an unconfigured deployment must not call TAGO");
});

test("a token shorter than the minimum is refused rather than accepted quietly", () => {
  const short = resolveOperatorToken({ RIDE_CAPTURE_OPERATOR_TOKEN: "too-short" });
  assert.equal(short.configured, false);
  assert.equal(short.token, "");
  assert.match(short.problem ?? "", /at least 24 characters/);

  const config = readTransitApiConfig(
    { TAGO_SERVICE_KEY: SERVICE_KEY, RIDE_CAPTURE_OPERATOR_TOKEN: "too-short" },
    { nodeVersion: "v22.0.0" },
  );
  assert.equal(config.operator.enabled, false);
  assert.equal(JSON.stringify(config).includes("too-short"), false, "the rejected value must not survive in config");
});

test("missing, malformed, and wrong credentials all fail the same way and never reach TAGO", async () => {
  const { handler, upstream } = harness();
  for (const init of [
    {},
    { headers: { authorization: TOKEN } },
    { headers: { authorization: "Basic " + TOKEN } },
    { headers: { authorization: "Bearer" } },
    bearer("operator-token-for-tests-012345678X"),
    bearer(TOKEN.slice(0, -1)),
    bearer(`${TOKEN}extra`),
  ] as RequestInit[]) {
    const response = await snapshot(handler, init);
    assert.equal(response.status, 401, JSON.stringify(init));
    const body = await response.json();
    assert.equal(body.error, "UNAUTHORIZED");
    assert.equal(body.message, "operator authorization required", "the reply must not say which part was wrong");
  }
  assert.equal(upstream.vehicleCalls, 0);
});

test("an authorized snapshot bypasses the vehicle cache and says so", async () => {
  const { handler, upstream } = harness();
  const first = await snapshot(handler, bearer(TOKEN));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");

  const body = await first.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.meta.snapshotCache, "bypassed");
  assert.equal(body.meta.providerObservationTimestamp, "unavailable");
  assert.equal(body.meta.freshnessPolicy, "fail_closed");
  assert.equal(body.meta.routeId, ROUTE);
  assert.equal(body.items[0].observedAt, EPOCH, "the epoch sentinel is never replaced by a receipt time");
  assert.equal(body.items[0].timestampSource, "unavailable");
  assert.ok(body.items[0].receivedAt);

  // Three polls inside the 20-second vehicle TTL: the public path would answer
  // twice from cache, the operator path must reach TAGO every time.
  await snapshot(handler, bearer(TOKEN));
  await snapshot(handler, bearer(TOKEN));
  assert.equal(upstream.vehicleCalls, 3);

  await handler(new Request(`http://api.test/v1/vehicles?routeId=${ROUTE}&cityCode=${CITY}`));
  await handler(new Request(`http://api.test/v1/vehicles?routeId=${ROUTE}&cityCode=${CITY}`));
  assert.equal(upstream.vehicleCalls, 4, "the public path still shares one upstream read across its TTL");
});

test("the snapshot response never carries the service key or the operator token", async () => {
  const { handler } = harness();
  const response = await snapshot(handler, bearer(TOKEN));
  const text = await response.text();
  assert.equal(text.includes(SERVICE_KEY), false);
  assert.equal(text.includes(TOKEN), false);
  for (const [, value] of response.headers) {
    assert.equal(value.includes(SERVICE_KEY), false);
    assert.equal(value.includes(TOKEN), false);
  }

  const health = await handler(new Request("http://api.test/health"));
  const payload = await health.json();
  assert.deepEqual(payload.operator, { enabled: true, rateLimitPerMinute: 30 });
  assert.equal(JSON.stringify(payload).includes(TOKEN), false);
});

test("identifiers are validated before anything upstream is called", async () => {
  const { handler, upstream } = harness();
  for (const query of [
    "",
    `?routeId=${ROUTE}`,
    `?cityCode=${CITY}`,
    `?routeId=${ROUTE}&cityCode=not-a-code`,
    `?routeId=${encodeURIComponent("../../etc/passwd")}&cityCode=${CITY}`,
    `?routeId=${encodeURIComponent("JEB4052 44701")}&cityCode=${CITY}`,
  ]) {
    const response = await snapshot(handler, bearer(TOKEN), query);
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).error, "INVALID_INPUT");
  }
  assert.equal(upstream.vehicleCalls, 0);

  const wrongMethod = await handler(
    new Request(`http://api.test/operator/snapshot?routeId=${ROUTE}&cityCode=${CITY}`, { method: "POST", ...bearer(TOKEN) }),
  );
  assert.equal(wrongMethod.status, 405);
});

test("the operator budget is separate from the public one", async () => {
  const { handler } = harness({ RIDE_CAPTURE_OPERATOR_RATE_LIMIT_PER_MINUTE: "2" });
  assert.equal((await snapshot(handler, bearer(TOKEN))).status, 200);
  assert.equal((await snapshot(handler, bearer(TOKEN))).status, 200);

  const limited = await snapshot(handler, bearer(TOKEN));
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));

  const publicRead = await handler(new Request(`http://api.test/v1/vehicles?routeId=${ROUTE}&cityCode=${CITY}`));
  assert.equal(publicRead.status, 200, "a spent ride budget must not close the public API");
});

test("analyze turns a capture into the sanitized report and nothing else", async () => {
  const { handler } = harness();
  const capture = syntheticCapture();
  const response = await handler(
    new Request("http://api.test/operator/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(capture),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const text = await response.text();
  assert.equal(text.includes("제주79자3696"), false, "the raw vehicle number must not survive analysis");
  assert.equal(text.includes(SERVICE_KEY), false);

  const report = JSON.parse(text);
  assert.equal(report.routeId, ROUTE);
  assert.equal(report.tracked.present, true);
  assert.equal(report.lifecycle.source, "web-controller");
  assert.equal(report.lifecycle.hiddenPeriods, 1);
  assert.equal(report.lifecycle.hiddenSeconds, 60);
  assert.equal(report.evidenceCompleteness.verdict, "INSUFFICIENT_EVIDENCE");
  assert.ok(report.warnings.some((warning: string) => warning.includes("backgrounded")));
});

test("analyze refuses an unauthenticated call and an invalid capture", async () => {
  const { handler } = harness();
  const unauthenticated = await handler(
    new Request("http://api.test/operator/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(syntheticCapture()),
    }),
  );
  assert.equal(unauthenticated.status, 401);

  const reversed = await handler(
    new Request("http://api.test/operator/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(syntheticCapture({ boardingStopSequence: 34, destinationStopSequence: 27 })),
    }),
  );
  assert.equal(reversed.status, 400);
  assert.match((await reversed.json()).message, /after boardingStopSequence/);

  const badEvent = await handler(
    new Request("http://api.test/operator/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(syntheticCapture({ events: [{ at: "2026-09-12T09:00:00.000Z", kind: "teleported" } as never] })),
    }),
  );
  assert.equal(badEvent.status, 400);

  const oversized = await handler(
    new Request("http://api.test/operator/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
        "content-length": String(8 * 1_024 * 1_024),
      },
      body: JSON.stringify(syntheticCapture()),
    }),
  );
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).message, /4 MiB/);
});

test("bearer parsing and comparison behave", () => {
  assert.equal(readBearerToken("Bearer abc"), "abc");
  assert.equal(readBearerToken("bearer\tabc"), "abc");
  assert.equal(readBearerToken("  Bearer   abc  "), "abc");
  assert.equal(readBearerToken("Bearer a b"), undefined);
  assert.equal(readBearerToken("Token abc"), undefined);
  assert.equal(readBearerToken(null), undefined);

  assert.equal(operatorTokenMatches(TOKEN, TOKEN), true);
  assert.equal(operatorTokenMatches(TOKEN, `${TOKEN} `), false);
  assert.equal(operatorTokenMatches(TOKEN, undefined), false);
  assert.equal(operatorTokenMatches("", ""), false);
});
