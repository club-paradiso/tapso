import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { ActiveRideSnapshotProvider, ACTIVE_RIDE_SNAPSHOT_POLICY_V1 } from "../src/activeRideSnapshot.ts";
import { CachedTransitProvider } from "../src/cachedTransitProvider.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { JourneySessionCoordinator } from "../src/journeySession.ts";
import { ProviderUnavailableError, type TransitProvider } from "../src/provider.ts";

/**
 * Synthetic test fixtures, not observations. Every row is built here; nothing
 * is evidence that a bus was seen. Route and stop ids are placeholders.
 */

const route: RouteRequest = { routeId: "SYN-ROUTE-1", cityCode: "39" };
const otherRoute: RouteRequest = { routeId: "SYN-ROUTE-2", cityCode: "39" };

const stops: StopOnRoute[] = [1, 2, 3, 4, 5].map((sequence) => ({
  stopId: `SYN-S${sequence}`,
  name: `Synthetic ${sequence}`,
  sequence,
  latitude: 33.5 + (sequence - 1) * 0.001,
  longitude: 126.5,
}));

/** Stamps `receivedAt` like `TagoTransitProvider` does: TAPSO receipt, never provider time. */
class ClockedProvider implements TransitProvider {
  vehicleCalls = 0;
  stopCalls = 0;
  sequence = 1;
  failNext = 0;
  gate?: Promise<void>;

  private readonly clock: () => number;

  constructor(clock: () => number) {
    this.clock = clock;
  }

  async stops(): Promise<StopOnRoute[]> {
    this.stopCalls += 1;
    return stops.map((stop) => ({ ...stop }));
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    this.vehicleCalls += 1;
    if (this.gate) await this.gate;
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new ProviderUnavailableError("synthetic upstream failure");
    }
    return [{
      vehicleId: "SYN-BUS",
      routeId: request.routeId,
      observedAt: new Date(0).toISOString(),
      receivedAt: new Date(this.clock()).toISOString(),
      timestampSource: "unavailable",
      directionCode: "1",
      stopSequence: this.sequence,
      latitude: 33.5 + (this.sequence - 1) * 0.001,
      longitude: 126.5,
    }];
  }
}

test("concurrent riders on one route share a single upstream read", async () => {
  let now = 1_000_000;
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  const results = await Promise.all([1, 2, 3, 4].map(() => provider.vehiclesResult(route)));
  assert.equal(upstream.vehicleCalls, 1);
  assert.deepEqual(results.map((result) => result.outcome).sort(), ["coalesced", "coalesced", "coalesced", "upstream"]);
  assert.ok(results.every((result) => result.value[0]!.receivedAt === results[0]!.value[0]!.receivedAt));
});

test("a read inside the share window is shared, one at the window edge is new", async () => {
  let now = 1_000_000;
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  await provider.vehicles(route);
  now += ACTIVE_RIDE_SNAPSHOT_POLICY_V1.shareWindowMs - 1;
  const shared = await provider.vehiclesResult(route);
  assert.equal(shared.outcome, "shared");
  assert.equal(shared.receiptAgeMs, ACTIVE_RIDE_SNAPSHOT_POLICY_V1.shareWindowMs - 1);
  assert.equal(upstream.vehicleCalls, 1);
  now += 1;
  assert.equal((await provider.vehiclesResult(route)).outcome, "upstream");
  assert.equal(upstream.vehicleCalls, 2);
});

test("one rider polling at the fastest foreground cadence always gets a new read", async () => {
  let now = 1_000_000;
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  for (let poll = 0; poll < 6; poll += 1) {
    assert.equal((await provider.vehiclesResult(route)).outcome, "upstream");
    now += 10_000;
  }
  assert.equal(upstream.vehicleCalls, 6);
});

test("a shared row keeps its original receipt time: stale data is never relabelled fresh", async () => {
  let now = Date.parse("2026-10-06T03:00:00Z");
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  const first = await provider.vehicles(route);
  now += 4_000;
  const shared = await provider.vehicles(route);
  assert.equal(shared[0]!.receivedAt, first[0]!.receivedAt);
  assert.equal(shared[0]!.receivedAt, new Date(now - 4_000).toISOString());
  assert.equal(shared[0]!.observedAt, new Date(0).toISOString(), "no provider observation time is invented");
});

test("routes are keyed separately", async () => {
  let now = 1_000_000;
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  await Promise.all([provider.vehicles(route), provider.vehicles(otherRoute)]);
  assert.equal(upstream.vehicleCalls, 2);
});

test("variants and cities are keyed apart", async () => {
  let now = 1_000_000;
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  // Two variant routeIds of one route number, and one routeId under another city.
  const requests: RouteRequest[] = [
    { routeId: "SYN-VARIANT-A", cityCode: "39" },
    { routeId: "SYN-VARIANT-B", cityCode: "39" },
    { routeId: "SYN-VARIANT-A", cityCode: "38" },
  ];
  const results = await Promise.all(requests.map((request) => provider.vehiclesResult(request)));
  assert.equal(upstream.vehicleCalls, 3);
  assert.deepEqual(results.map((result) => result.outcome), ["upstream", "upstream", "upstream"]);
  results.forEach((result, index) => assert.equal(result.value[0]!.routeId, requests[index]!.routeId));
  // Inside the share window each key answers only its own snapshot.
  now += 1_000;
  const shared = await Promise.all(requests.map((request) => provider.vehiclesResult(request)));
  assert.deepEqual(shared.map((result) => result.outcome), ["shared", "shared", "shared"]);
  assert.equal(upstream.vehicleCalls, 3);
});

/** A promise the test resolves by hand: a slow upstream read. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("a slow upstream read longer than the share window is still one read, and its window starts at completion", async () => {
  const t0 = 1_000_000;
  let now = t0;
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  const slow = deferred();
  upstream.gate = slow.promise;
  const first = provider.vehiclesResult(route);
  // Longer than the 5 s share window, still in flight: the late caller waits on it.
  now += 7_000;
  const late = provider.vehiclesResult(route);
  slow.resolve();
  upstream.gate = undefined;
  const [a, b] = await Promise.all([first, late]);
  assert.equal(upstream.vehicleCalls, 1);
  assert.equal(a.outcome, "upstream");
  assert.equal(b.outcome, "coalesced");
  // Both carry the completion receipt, not the request start.
  assert.equal(a.value[0]!.receivedAt, new Date(t0 + 7_000).toISOString());
  assert.equal(b.value[0]!.receivedAt, new Date(t0 + 7_000).toISOString());
  assert.equal(a.receiptAgeMs, 0);
  assert.equal(b.receiptAgeMs, 0);
  // The share window is counted from completion.
  now += ACTIVE_RIDE_SNAPSHOT_POLICY_V1.shareWindowMs - 1;
  assert.equal((await provider.vehiclesResult(route)).outcome, "shared");
  now += 1;
  assert.equal((await provider.vehiclesResult(route)).outcome, "upstream");
  assert.equal(upstream.vehicleCalls, 2);
});

test("a slow upstream failure rejects the late waiter too, and the next read retries", async () => {
  let now = 1_000_000;
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  const slow = deferred();
  upstream.gate = slow.promise;
  upstream.failNext = 1;
  const first = provider.vehicles(route);
  now += 7_000;
  const late = provider.vehicles(route);
  slow.resolve();
  upstream.gate = undefined;
  const outcomes = await Promise.allSettled([first, late]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["rejected", "rejected"]);
  assert.ok(outcomes.every((outcome) => outcome.status === "rejected" && outcome.reason instanceof ProviderUnavailableError));
  assert.equal(upstream.vehicleCalls, 1);
  assert.equal((await provider.vehiclesResult(route)).outcome, "upstream", "nothing in flight or stored from the failure");
  assert.equal(upstream.vehicleCalls, 2);
});

test("callers waiting on a slow read consume no upstream budget", async () => {
  let now = 1_000_000;
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, {
    now: () => now,
    policy: { upstreamReadsPerMinute: 2 },
  });
  const slow = deferred();
  upstream.gate = slow.promise;
  const first = provider.vehiclesResult(route);
  now += 7_000;
  const waiters = [1, 2, 3].map(() => provider.vehiclesResult(route));
  slow.resolve();
  upstream.gate = undefined;
  await Promise.all([first, ...waiters]);
  assert.equal(upstream.vehicleCalls, 1);
  // Three waiters, yet one budget slot is left: the next read past the window goes upstream.
  now += ACTIVE_RIDE_SNAPSHOT_POLICY_V1.shareWindowMs;
  assert.equal((await provider.vehiclesResult(route)).outcome, "upstream");
  assert.equal(upstream.vehicleCalls, 2);
  // Now the budget is spent.
  now += ACTIVE_RIDE_SNAPSHOT_POLICY_V1.shareWindowMs;
  assert.equal((await provider.vehiclesResult(route)).outcome, "budget_shared");
  assert.equal(provider.stats().coalesced, 3);
});

test("a failed read is not stored and rejects every caller that shared it", async () => {
  let now = 1_000_000;
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  upstream.failNext = 1;
  const outcomes = await Promise.allSettled([provider.vehicles(route), provider.vehicles(route)]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["rejected", "rejected"]);
  assert.equal(upstream.vehicleCalls, 1);
  // Nothing cached from the failure: the next read goes upstream again.
  assert.equal((await provider.vehiclesResult(route)).outcome, "upstream");
  assert.equal(upstream.vehicleCalls, 2);
});

test("a failure after a success never replays the old snapshot past the share window", async () => {
  let now = 1_000_000;
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  await provider.vehicles(route);
  now += ACTIVE_RIDE_SNAPSHOT_POLICY_V1.shareWindowMs;
  upstream.failNext = 1;
  await assert.rejects(provider.vehicles(route), ProviderUnavailableError);
});

test("over budget: a recent snapshot answers with its true age, an old one is refused", async () => {
  let now = 1_000_000;
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, {
    now: () => now,
    policy: { upstreamReadsPerMinute: 2 },
  });
  await provider.vehicles(route);
  now += 5_000;
  await provider.vehicles(route);
  now += 6_000;
  const fallback = await provider.vehiclesResult(route);
  assert.equal(fallback.outcome, "budget_shared");
  assert.equal(fallback.receiptAgeMs, 6_000);
  assert.equal(fallback.value[0]!.receivedAt, new Date(now - 6_000).toISOString(), "the fallback keeps its original receipt time");
  assert.equal(upstream.vehicleCalls, 2);
  now += 10_000; // 16 s since the last receipt: past the fallback bound.
  await assert.rejects(provider.vehicles(route), /budget exhausted/);
  assert.equal(upstream.vehicleCalls, 2);
  // A route with no snapshot at all is refused outright while over budget.
  await assert.rejects(provider.vehicles(otherRoute), ProviderUnavailableError);
  assert.equal(provider.stats().budget_refused, 2);
  // The budget is a rolling minute: it recovers.
  now += 60_000;
  assert.equal((await provider.vehiclesResult(route)).outcome, "upstream");
});

test("over budget: the fallback bound is inclusive at exactly 15 s and refused 1 ms later", async () => {
  let now = 1_000_000;
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, {
    now: () => now,
    policy: { upstreamReadsPerMinute: 1 },
  });
  await provider.vehicles(route);
  const receivedAt = new Date(now).toISOString();
  now += ACTIVE_RIDE_SNAPSHOT_POLICY_V1.budgetFallbackMaxAgeMs;
  const edge = await provider.vehiclesResult(route);
  assert.equal(edge.outcome, "budget_shared");
  assert.equal(edge.receiptAgeMs, 15_000);
  assert.equal(edge.value[0]!.receivedAt, receivedAt);
  now += 1;
  await assert.rejects(provider.vehicles(route), /budget exhausted/);
  assert.equal(upstream.vehicleCalls, 1);
});

test("rapid manual refreshes by one rider cost one upstream read per share window", async () => {
  let now = 1_000_000;
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  for (let press = 0; press < 10; press += 1) {
    await provider.vehicles(route);
    now += 1_000;
  }
  assert.equal(upstream.vehicleCalls, 2);
});

test("policy refuses a share window that would replay one rider's own previous receipt", () => {
  const upstream = new ClockedProvider(() => 0);
  assert.throws(() => new ActiveRideSnapshotProvider(upstream, { policy: { shareWindowMs: 10_000 } }), RangeError);
  assert.throws(() => new ActiveRideSnapshotProvider(upstream, { policy: { shareWindowMs: 20_000 } }), RangeError);
  assert.throws(() => new ActiveRideSnapshotProvider(upstream, { policy: { budgetFallbackMaxAgeMs: 31_000 } }), RangeError);
  assert.throws(() => new ActiveRideSnapshotProvider(upstream, { policy: { upstreamReadsPerMinute: 0 } }), RangeError);
  // Just below the 10 s foreground poll is still accepted.
  assert.doesNotThrow(() => new ActiveRideSnapshotProvider(upstream, { policy: { shareWindowMs: 9_999 } }));
});

test("the generic public vehicle path keeps its own 20 s cache, untouched", async () => {
  let now = 1_000_000;
  const upstream = new ClockedProvider(() => now);
  const cached = new CachedTransitProvider(upstream, { now: () => now });
  const active = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  await cached.vehicles(route);
  now += 10_000;
  assert.equal((await cached.vehiclesResult(route)).cache, "hit");
  assert.equal((await active.vehiclesResult(route)).outcome, "upstream", "an active ride never reads the public cache");
  assert.equal(cached.policy.vehicleTtlMs, 20_000);
});

test("two sessions on one route coalesce, and a shared receipt is recorded once per session", async () => {
  let now = Date.parse("2026-10-06T03:00:00Z");
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  let id = 0;
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => new Date(now),
    idFactory: () => `synthetic-session-${++id}`,
  });
  const input = { routeId: route.routeId, cityCode: route.cityCode, boardingStopSequence: 1, destinationStopSequence: 5, directionCode: "1" };
  const [left, right] = await Promise.all([sessions.create(input), sessions.create(input)]);
  assert.equal(upstream.vehicleCalls, 1, "two riders starting together cost one read");

  // The same rider refreshing inside the window: the receipt is not new evidence.
  now += 2_000;
  const repeated = await sessions.refresh(left.id);
  assert.equal(upstream.vehicleCalls, 1);
  assert.equal(repeated.sourceFreshness?.["SYN-BUS"]?.sampleCount, 1, "a shared receipt is never counted twice");
  assert.equal(repeated.sourceFreshness?.["SYN-BUS"]?.latestReceiptAgeSeconds, 2, "its true age is visible");

  // Ten seconds on, both riders refresh together: one new upstream read.
  now += 10_000;
  upstream.sequence = 2;
  const [leftNext, rightNext] = await Promise.all([sessions.refresh(left.id), sessions.refresh(right.id)]);
  assert.equal(upstream.vehicleCalls, 2);
  assert.equal(leftNext.sourceFreshness?.["SYN-BUS"]?.sampleCount, 2);
  assert.equal(rightNext.sourceFreshness?.["SYN-BUS"]?.sampleCount, 2);
});

test("an upstream failure during a ride degrades the session rather than serving old rows as new", async () => {
  let now = Date.parse("2026-10-06T03:00:00Z");
  const upstream = new ClockedProvider(() => now);
  const provider = new ActiveRideSnapshotProvider(upstream, { now: () => now });
  const sessions = new JourneySessionCoordinator(provider, { now: () => new Date(now), idFactory: () => "synthetic-session" });
  await sessions.create({ routeId: route.routeId, cityCode: route.cityCode, boardingStopSequence: 1, destinationStopSequence: 5, directionCode: "1" });
  now += 10_000;
  upstream.failNext = 1;
  const view = await sessions.refresh("synthetic-session");
  assert.equal(view.state, "degraded");
  assert.equal(view.providerRead?.state, "failed");
});

test("the real wiring gives sessions the active-ride path and /health reports its policy, not identifiers", async () => {
  const { createTransitApi } = await import("../src/apiRuntime.ts");
  const api = createTransitApi({ TAGO_SERVICE_KEY: "synthetic-key" });
  const health = await (await api.handler(new Request("http://api.test/health"))).json();
  assert.deepEqual(health.activeRideReads.policy, ACTIVE_RIDE_SNAPSHOT_POLICY_V1);
  assert.deepEqual(Object.keys(health.activeRideReads.outcomes).sort(), ["budget_refused", "budget_shared", "coalesced", "shared", "upstream"]);
  assert.equal(health.cachePolicy.vehicleTtlMs, 20_000, "the public vehicle cache is unchanged");
  assert.ok(!JSON.stringify(health.activeRideReads).includes("synthetic-key"));
});

/**
 * A synthetic TAGO envelope, not an observation: every row is built here and
 * no bus was seen. Only the operations a session and `/v1/vehicles` need.
 */
function syntheticTagoFetch(calls: { vehicles: number; stops: number }): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    let item: object[];
    if (url.pathname.endsWith("getRouteAcctoThrghSttnList")) {
      calls.stops += 1;
      item = stops.map((stop) => ({ nodeid: stop.stopId, nodenm: stop.name, nodeord: stop.sequence, updowncd: "1", gpslati: stop.latitude, gpslong: stop.longitude }));
    } else if (url.pathname.endsWith("getRouteAcctoBusLcList")) {
      calls.vehicles += 1;
      item = [{ vehicleno: "SYN-BUS", nodeid: "SYN-S1", nodenm: "Synthetic 1", nodeord: 1, gpslati: 33.5, gpslong: 126.5 }];
    } else {
      throw new Error(`unexpected synthetic TAGO operation ${url.pathname}`);
    }
    return new Response(JSON.stringify({ response: {
      header: { resultCode: "00" },
      body: { totalCount: item.length, pageNo: 1, items: { item } },
    } }));
  };
}

test("through the real wiring, /v1/vehicles is served by its 20 s cache and sessions read through the active-ride path", async () => {
  const realFetch = globalThis.fetch;
  const calls = { vehicles: 0, stops: 0 };
  // Both are captured at wiring time (`fetchImplementation ?? fetch`, `now ?? Date.now`),
  // so the stub and the mocked clock go in before `createTransitApi`.
  globalThis.fetch = syntheticTagoFetch(calls);
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-06T03:00:00Z") });
  try {
    const { createTransitApi } = await import("../src/apiRuntime.ts");
    const api = createTransitApi({ TAGO_SERVICE_KEY: "synthetic-key" });
    const outcomes = async () => (await (await api.handler(new Request("http://api.test/health"))).json()).activeRideReads.outcomes;
    const vehicles = () => api.handler(new Request(`http://api.test/v1/vehicles?cityCode=${route.cityCode}&routeId=${route.routeId}`));

    // (a) Two public reads: one upstream fetch, the shared CDN header, and the
    // active-ride path untouched.
    const first = await vehicles();
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "public, max-age=0, s-maxage=20, must-revalidate");
    const second = await vehicles();
    assert.equal(second.status, 200);
    assert.equal(second.headers.get("cache-control"), "public, max-age=0, s-maxage=20, must-revalidate");
    assert.equal(calls.vehicles, 1, "the second public read is a 20 s cache hit");
    assert.deepEqual(await outcomes(), { upstream: 0, coalesced: 0, shared: 0, budget_shared: 0, budget_refused: 0 });

    // (b) A session on the same route while that cache entry is warm still
    // goes upstream, through `ActiveRideSnapshotProvider`.
    const created = await api.handler(new Request("http://api.test/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ routeId: route.routeId, cityCode: route.cityCode, boardingStopSequence: 1, destinationStopSequence: 5, directionCode: "1" }),
    }));
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal(calls.vehicles, 2, "a session never reads the public 20 s cache");
    assert.equal((await outcomes()).upstream, 1);

    // Past the 5 s share window, still inside the 20 s public TTL: the session
    // refresh is a new upstream read, the public path is still a cache hit.
    mock.timers.tick(6_000);
    const refreshed = await api.handler(new Request(`http://api.test/v1/sessions/${id}`));
    assert.equal(refreshed.status, 200);
    assert.equal(calls.vehicles, 3);
    assert.equal((await outcomes()).upstream, 2);
    assert.equal((await vehicles()).status, 200);
    assert.equal(calls.vehicles, 3, "the public cache entry is still warm and was not refreshed by the session");
    assert.deepEqual(await outcomes(), { upstream: 2, coalesced: 0, shared: 0, budget_shared: 0, budget_refused: 0 });
  } finally {
    mock.timers.reset();
    globalThis.fetch = realFetch;
  }
});
