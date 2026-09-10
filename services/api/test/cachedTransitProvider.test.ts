import test from "node:test";
import assert from "node:assert/strict";
import { CachedTransitProvider } from "../src/cachedTransitProvider.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import type { TransitProvider } from "../src/provider.ts";

const request: RouteRequest = { routeId: "route-365", standardRegionCode: "50110" };

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
