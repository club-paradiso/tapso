/**
 * What the HTTP surface says when TAGO fails (SYNTHETIC provider): a stop list
 * may answer from its last success, labelled and uncacheable; vehicles answer
 * the failure; `/health` shows this instance's provider outcomes.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { readTransitApiConfig } from "../src/apiConfig.ts";
import { createTransitApiHandler } from "../src/apiRouter.ts";
import { CachedTransitProvider } from "../src/cachedTransitProvider.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { ProviderResponseError, type TransitProvider } from "../src/provider.ts";
import { ProviderHealth } from "../src/providerHealth.ts";

class Flaky implements TransitProvider {
  fail = false;
  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    if (this.fail) throw new ProviderResponseError("TAGO payload has no body object");
    return [{ stopId: "S1", name: "합성 정류장", sequence: 1 }, { stopId: "S2", name: "합성 정류장 2", sequence: 2 }];
  }
  async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> {
    if (this.fail) throw new ProviderResponseError("TAGO payload has no body object");
    return [];
  }
}

function setup() {
  let now = 0;
  const config = readTransitApiConfig({ TAGO_SERVICE_KEY: "synthetic-key" }, { nodeVersion: "v22.0.0" });
  const upstream = new Flaky();
  const provider = new CachedTransitProvider(upstream, { stopTtlMs: 1_000, vehicleTtlMs: 1_000, now: () => now });
  const health = new ProviderHealth();
  health.record({ provider: "tago", operation: "getRouteAcctoBusLcList", outcome: "PROVIDER_RESPONSE_INVALID", latencyMs: 812, attempts: 2, detail: "TAGO payload has no body object", at: "2026-10-02T00:00:00.000Z" });
  const handler = createTransitApiHandler({
    config,
    discovery: { async cities() { return []; }, async routes() { return []; } },
    provider,
    providerHealth: health,
    log: () => {},
  });
  return { handler, upstream, advance: (ms: number) => { now += ms; } };
}

const query = "routeId=JEB405136521&cityCode=39";

test("a stop list TAGO fails to refresh is served from the last success, labelled and never cached downstream", async () => {
  const { handler, upstream, advance } = setup();
  const fresh = await handler(new Request(`http://api.test/v1/stops?${query}`));
  assert.equal(fresh.status, 200);
  assert.match(fresh.headers.get("cache-control") ?? "", /s-maxage/);
  upstream.fail = true;
  advance(5_000);
  const stale = await handler(new Request(`http://api.test/v1/stops?${query}`));
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get("cache-control"), "no-store");
  const body = await stale.json() as { items: unknown[]; meta: { servedStale?: { reason: string } } };
  assert.equal(body.items.length, 2);
  assert.deepEqual(body.meta.servedStale, { reason: "provider_error" });
});

test("vehicles never answer from an old read: the failure is the answer", async () => {
  const { handler, upstream, advance } = setup();
  assert.equal((await handler(new Request(`http://api.test/v1/vehicles?${query}`))).status, 200);
  upstream.fail = true;
  advance(5_000);
  const failed = await handler(new Request(`http://api.test/v1/vehicles?${query}`));
  assert.equal(failed.status, 502);
  assert.equal((await failed.json() as { error: string }).error, "PROVIDER_RESPONSE_INVALID");
});

test("/health shows this instance's provider outcomes, scoped as such", async () => {
  const { handler } = setup();
  const body = await (await handler(new Request("http://api.test/health"))).json() as { providerHealth?: { scope: string; outcomes: Record<string, number>; lastFailure?: { detail?: string } } };
  assert.equal(body.providerHealth?.scope, "this_instance");
  assert.deepEqual(body.providerHealth?.outcomes, { PROVIDER_RESPONSE_INVALID: 1 });
  assert.equal(body.providerHealth?.lastFailure?.detail, "TAGO payload has no body object");
});
