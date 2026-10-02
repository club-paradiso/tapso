import test from "node:test";
import assert from "node:assert/strict";
import { CachedTransitProvider } from "../src/cachedTransitProvider.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import type { TransitProvider } from "../src/provider.ts";

/**
 * Synthetic test fixtures, not observations: every provider response below is
 * constructed by the test, and nothing here is evidence that a bus was seen.
 * Values that look real (public TAGO route and stop ids, stop names and
 * coordinates, and vehicle numbers carried over from earlier fixtures) are
 * used only as inputs.
 */

const request: RouteRequest = { routeId: "route-365", cityCode: "999" };

class CountingProvider implements TransitProvider {
  stopCalls = 0;
  vehicleCalls = 0;

  async stops(): Promise<StopOnRoute[]> {
    this.stopCalls += 1;
    return [{ stopId: "A", name: "A", sequence: 1 }];
  }

  async vehicles(): Promise<VehicleObservation[]> {
    this.vehicleCalls += 1;
    return [{ vehicleId: "BUS-1", routeId: request.routeId, observedAt: "2026-09-10T05:00:00Z" }];
  }
}

test("coalesces concurrent route vehicle misses", async () => {
  const upstream = new CountingProvider();
  const cached = new CachedTransitProvider(upstream, { vehicleTtlMs: 20_000 });
  const [left, middle, right] = await Promise.all([
    cached.vehicles(request),
    cached.vehicles(request),
    cached.vehicles(request),
  ]);
  assert.equal(upstream.vehicleCalls, 1);
  assert.equal(left[0].vehicleId, "BUS-1");
  assert.equal(middle[0].vehicleId, "BUS-1");
  assert.equal(right[0].vehicleId, "BUS-1");
});

test("reuses successful results only until the route TTL expires", async () => {
  let now = 1_000;
  const upstream = new CountingProvider();
  const cached = new CachedTransitProvider(upstream, { vehicleTtlMs: 20_000, now: () => now });

  await cached.vehicles(request);
  now = 20_999;
  await cached.vehicles(request);
  assert.equal(upstream.vehicleCalls, 1);

  now = 21_000;
  await cached.vehicles(request);
  assert.equal(upstream.vehicleCalls, 2);
});

test("does not cache upstream failures", async () => {
  let calls = 0;
  const upstream: TransitProvider = {
    async stops() { return []; },
    async vehicles() {
      calls += 1;
      if (calls === 1) throw new Error("temporary failure");
      return [];
    },
  };
  const cached = new CachedTransitProvider(upstream);
  await assert.rejects(cached.vehicles(request), /temporary failure/);
  await cached.vehicles(request);
  assert.equal(calls, 2);
});

class FlakyProvider implements TransitProvider {
  fail = false;
  async stops(): Promise<StopOnRoute[]> {
    if (this.fail) throw Object.assign(new Error("TAGO payload has no body object"), { code: "PROVIDER_RESPONSE_INVALID" });
    return [{ stopId: "A", name: "A", sequence: 1 }];
  }
  async vehicles(): Promise<VehicleObservation[]> {
    if (this.fail) throw Object.assign(new Error("TAGO payload has no body object"), { code: "PROVIDER_RESPONSE_INVALID" });
    return [{ vehicleId: "BUS-1", routeId: request.routeId, observedAt: "2026-09-10T05:00:00Z" }];
  }
}

test("a stop list that fails to refresh answers from its last success for a day, labelled stale", async () => {
  let now = 0;
  const upstream = new FlakyProvider();
  const cached = new CachedTransitProvider(upstream, { stopTtlMs: 1_000, vehicleTtlMs: 1_000, now: () => now });
  assert.equal((await cached.stopsResult(request)).cache, "miss");
  upstream.fail = true;
  now = 2_000;
  const stale = await cached.stopsResult(request);
  assert.equal(stale.cache, "stale");
  assert.deepEqual(stale.value, [{ stopId: "A", name: "A", sequence: 1 }]);
  now = 1_000 + 24 * 60 * 60 * 1_000 + 1;
  await assert.rejects(cached.stopsResult(request), /no body object/, "older than a day is not served");
});

test("vehicle positions are never served stale: a failure is a failure", async () => {
  let now = 0;
  const upstream = new FlakyProvider();
  const cached = new CachedTransitProvider(upstream, { vehicleTtlMs: 1_000, now: () => now });
  await cached.vehiclesResult(request);
  upstream.fail = true;
  now = 1_500;
  await assert.rejects(cached.vehiclesResult(request), /no body object/);
});

test("callers that joined a failing refresh get the same stale stop list as the one that started it", async () => {
  let now = 0;
  let release: (() => void) | undefined;
  class Slow implements TransitProvider {
    fail = false;
    async stops(): Promise<StopOnRoute[]> {
      if (!this.fail) return [{ stopId: "A", name: "A", sequence: 1 }];
      await new Promise<void>((resolve) => { release = resolve; });
      throw new Error("TAGO payload has no body object");
    }
    async vehicles(): Promise<VehicleObservation[]> { return []; }
  }
  const upstream = new Slow();
  const cached = new CachedTransitProvider(upstream, { stopTtlMs: 1_000, now: () => now });
  await cached.stopsResult(request);
  upstream.fail = true;
  now = 2_000;
  const first = cached.stopsResult(request);
  const second = cached.stopsResult(request);
  await new Promise((resolve) => setImmediate(resolve));
  release!();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.cache), ["stale", "stale"]);
});
