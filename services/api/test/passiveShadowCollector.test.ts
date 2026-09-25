import assert from "node:assert/strict";
import test from "node:test";

import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { ProviderResponseError, type TransitProvider } from "../src/provider.ts";
import { collectPassiveStreams, preflightRoutes, safeError } from "../src/passiveShadowCollector.ts";
import { validatePassiveStream } from "../src/passiveShadow.ts";
import { TapsoPublicApiProvider } from "../src/tapsoPublicApiProvider.ts";
import { syntheticStops } from "./syntheticPassive.ts";

/** SYNTHETIC provider: invented route ids and vehicle numbers. */
function fakeProvider(options: {
  now: () => Date;
  fail?: (call: number) => boolean;
  cachedReceipt?: boolean;
}): TransitProvider & { vehicleCalls: number } {
  const provider = {
    vehicleCalls: 0,
    async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
      return syntheticStops(10);
    },
    async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
      provider.vehicleCalls += 1;
      if (options.fail?.(provider.vehicleCalls)) throw new ProviderResponseError("SYNTHETIC failure serviceKey=abc123");
      const receivedAt = options.cachedReceipt
        ? new Date(Math.floor(options.now().getTime() / 20_000) * 20_000).toISOString()
        : options.now().toISOString();
      return [{
        vehicleId: `SYN-${request.routeId}-BUS`,
        routeId: request.routeId,
        observedAt: new Date(0).toISOString(),
        receivedAt,
        timestampSource: "unavailable",
        stopSequence: 1 + (provider.vehicleCalls % 9),
      }];
    },
  };
  return provider;
}

function clock(start = Date.parse("2026-09-25T01:00:00.000Z")) {
  let nowMs = start;
  return {
    now: () => new Date(nowMs),
    sleep: async (milliseconds: number) => { nowMs += milliseconds; },
  };
}

const ROUTES: RouteRequest[] = [
  { routeId: "SYN-A", cityCode: "999" },
  { routeId: "SYN-B", cityCode: "999" },
];

test("collection is bounded by duration and every stream is traceable and synthetic-labelled", async () => {
  const time = clock();
  const provider = fakeProvider({ now: time.now });
  const result = await collectPassiveStreams({
    provider,
    providerPath: "synthetic",
    collectorEngine: "test",
    collectionId: "syn-run",
    routes: ROUTES,
    intervalMs: 5_000,
    durationMs: 60_000,
    maxProviderCalls: 1_000,
    ...time,
  });
  assert.equal(result.stopReason, "DURATION_REACHED");
  assert.equal(result.streams.length, 2);
  for (const stream of result.streams) {
    validatePassiveStream(stream);
    assert.equal(stream.sourceClass, "SYNTHETIC_OR_PERTURBED");
    assert.equal(stream.collectionId, "syn-run");
    assert.ok(stream.snapshots.length >= 11 && stream.snapshots.length <= 13);
  }
});

test("the call budget is a hard stop, stops reads included", async () => {
  const time = clock();
  const provider = fakeProvider({ now: time.now });
  const result = await collectPassiveStreams({
    provider,
    providerPath: "synthetic",
    collectorEngine: "test",
    collectionId: "syn-run",
    routes: ROUTES,
    intervalMs: 5_000,
    durationMs: 3_600_000,
    maxProviderCalls: 10,
    ...time,
  });
  assert.equal(result.providerCalls, 10);
  assert.equal(result.stopReason, "CALL_BUDGET_EXHAUSTED");
  assert.equal(provider.vehicleCalls, 8);
});

test("the interval floor and the 90-minute cap cannot be configured away", async () => {
  const time = clock();
  const provider = fakeProvider({ now: time.now });
  const result = await collectPassiveStreams({
    provider,
    providerPath: "synthetic",
    collectorEngine: "test",
    collectionId: "syn-run",
    routes: [ROUTES[0]!],
    intervalMs: 1,
    durationMs: 10 * 3_600_000,
    maxProviderCalls: 100_000,
    ...time,
  });
  assert.equal(result.streams[0]!.intervalMs, 3_000);
  assert.ok(provider.vehicleCalls <= 90 * 20 + 1);
});

test("a failed read is a failed snapshot, never an empty route, and a failure spike stops the run", async () => {
  const time = clock();
  const provider = fakeProvider({ now: time.now, fail: (call) => call > 4 });
  const result = await collectPassiveStreams({
    provider,
    providerPath: "synthetic",
    collectorEngine: "test",
    collectionId: "syn-run",
    routes: [ROUTES[0]!],
    intervalMs: 5_000,
    durationMs: 3_600_000,
    maxProviderCalls: 1_000,
    ...time,
  });
  assert.equal(result.stopReason, "CONSECUTIVE_PROVIDER_FAILURES");
  assert.ok(result.incidents.some((incident) => incident.kind === "CONSECUTIVE_PROVIDER_FAILURES"));
  const failed = result.streams[0]!.snapshots.filter((snapshot) => snapshot.error);
  assert.equal(failed.length, 10);
  for (const snapshot of failed) {
    assert.deepEqual(snapshot.vehicles, []);
    assert.equal(snapshot.error!.includes("abc123"), false, "a credential-looking parameter is redacted");
  }
});

test("a cached re-serve of the same receipt is dropped, not counted as a new observation", async () => {
  const time = clock();
  const provider = fakeProvider({ now: time.now, cachedReceipt: true });
  const result = await collectPassiveStreams({
    provider,
    providerPath: "synthetic",
    collectorEngine: "test",
    collectionId: "syn-run",
    routes: [ROUTES[0]!],
    intervalMs: 5_000,
    durationMs: 60_000,
    maxProviderCalls: 1_000,
    ...time,
  });
  const stream = result.streams[0]!;
  assert.ok(stream.duplicateReceiptsDropped >= 8);
  const receipts = stream.snapshots.map((snapshot) => snapshot.capturedAt);
  assert.equal(new Set(receipts).size, receipts.length);
});

test("preflight prefers routes with more active vehicles and spends from the same budget", async () => {
  const counts: Record<string, number> = { "SYN-A": 1, "SYN-B": 4, "SYN-C": 0 };
  const provider: TransitProvider = {
    async stops() { return syntheticStops(5); },
    async vehicles(request) {
      return Array.from({ length: counts[request.routeId] ?? 0 }, (_, index) => ({
        vehicleId: `SYN-${index}`,
        routeId: request.routeId,
        observedAt: new Date(0).toISOString(),
        timestampSource: "unavailable" as const,
      }));
    },
  };
  const result = await preflightRoutes({
    provider,
    discovery: { routes: async () => [{ routeId: "SYN-C" }] },
    cityCode: "999",
    routeIds: ["SYN-A", "SYN-B"],
    routeNumbers: ["000"],
    maxRoutes: 2,
    maxCalls: 10,
  });
  assert.deepEqual(result.selected.map((route) => route.routeId), ["SYN-B", "SYN-A"]);
  assert.equal(result.calls, 4);
});

test("safeError strips control characters and credential parameters", () => {
  assert.equal(safeError(new Error("bad\nserviceKey=SECRET&x=1")), "bad serviceKey=<redacted>&x=1");
});

/* ------------------------------------------------- public API adapter */

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

test("the public API adapter accepts only TAGO-shaped vehicle rows for the requested route", async () => {
  const good = {
    vehicleId: "SYN-1",
    routeId: "SYN-A",
    observedAt: new Date(0).toISOString(),
    receivedAt: "2026-09-25T01:00:00.000Z",
    timestampSource: "unavailable",
    stopSequence: 3,
  };
  const ok = new TapsoPublicApiProvider({ baseUrl: "https://example.invalid", fetchImplementation: jsonFetch({ items: [good] }) });
  const [row] = await ok.vehicles({ routeId: "SYN-A", cityCode: "999" });
  assert.equal(row!.timestampSource, "unavailable");
  assert.equal(row!.stopSequence, 3);

  for (const bad of [
    { ...good, routeId: "SYN-B" },
    { ...good, timestampSource: "provider" },
    { ...good, receivedAt: undefined },
    { ...good, vehicleId: "" },
  ]) {
    const provider = new TapsoPublicApiProvider({ baseUrl: "https://example.invalid", fetchImplementation: jsonFetch({ items: [bad] }) });
    await assert.rejects(provider.vehicles({ routeId: "SYN-A", cityCode: "999" }), ProviderResponseError);
  }
  const down = new TapsoPublicApiProvider({ baseUrl: "https://example.invalid", fetchImplementation: jsonFetch({ error: "x" }, 503) });
  await assert.rejects(down.vehicles({ routeId: "SYN-A", cityCode: "999" }), /HTTP 503/);
  assert.throws(() => new TapsoPublicApiProvider({ baseUrl: "http://example.invalid" }), /https/);
});
