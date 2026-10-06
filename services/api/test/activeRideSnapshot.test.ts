import test from "node:test";
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
