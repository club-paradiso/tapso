/**
 * TAGO burst rate limiting (`docs/validation/TAPSO_V4_FIRST_BUS_CHECK_2026-11-09.md`):
 * on 2026-11-09 a burst of 16 parallel `/v1/vehicles` reads drew HTTP 429 from
 * TAGO, which TAPSO used to report as a generic 502 PROVIDER_UNAVAILABLE,
 * while one request every 5 s was answered 12/12. A 429 is now its own code,
 * never retried, and one instance sends TAGO at most a few requests at once.
 *
 * Every response here is SYNTHETIC.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { readTransitApiConfig } from "../src/apiConfig.ts";
import { createTransitApiHandler } from "../src/apiRouter.ts";
import { CachedTransitProvider } from "../src/cachedTransitProvider.ts";
import { ProviderRateLimitedError, ProviderTimeoutError } from "../src/provider.ts";
import type { ProviderRequestRecord } from "../src/providerHealth.ts";
import { TAGO_MAX_CONCURRENT_REQUESTS, TAGO_RATE_LIMIT_RETRY_AFTER_SECONDS, TagoTransitProvider } from "../src/tagoProvider.ts";

const route = { routeId: "JEB405136521", cityCode: "39" };

function empty(): Response {
  return new Response(JSON.stringify({ response: { header: { resultCode: "00" }, body: { totalCount: 0, pageNo: 1, items: "" } } }));
}

test("TAGO HTTP 429 is PROVIDER_RATE_LIMITED, never retried, with a bounded Retry-After", async () => {
  for (const [header, expected] of [[null, TAGO_RATE_LIMIT_RETRY_AFTER_SECONDS], ["7", 7], ["3600", 60], ["soon", TAGO_RATE_LIMIT_RETRY_AFTER_SECONDS], ["0", 1]] as const) {
    let calls = 0;
    const records: ProviderRequestRecord[] = [];
    const provider = new TagoTransitProvider({
      serviceKey: "test-key",
      fetchImplementation: async () => {
        calls += 1;
        return new Response("Too Many Requests", { status: 429, headers: header === null ? {} : { "retry-after": header } });
      },
      onRequest: (record) => records.push(record),
    });
    await assert.rejects(provider.vehicles(route), (error: unknown) => {
      assert.ok(error instanceof ProviderRateLimitedError);
      assert.equal(error.code, "PROVIDER_RATE_LIMITED");
      assert.equal(error.retryAfterSeconds, expected, `Retry-After ${header}`);
      return true;
    });
    assert.equal(calls, 1, "a rate-limited request is not retried: another would only add to the load");
    assert.equal(records[0]!.outcome, "PROVIDER_RATE_LIMITED");
    assert.equal(records[0]!.httpStatus, 429);
  }
});

test("the API answers a rate-limited feed with 503, the code and Retry-After, never as 'no bus'", async () => {
  const handler = createTransitApiHandler({
    config: readTransitApiConfig({}, { nodeVersion: "v22.0.0" }),
    provider: new CachedTransitProvider({
      async stops() { return []; },
      async vehicles() { throw new ProviderRateLimitedError("TAGO provider returned HTTP 429", 15); },
    }, { stopTtlMs: 1_000, vehicleTtlMs: 20_000 }),
    discovery: { async cities() { return []; }, async routes() { return []; } },
    log: () => {},
  });
  const response = await handler(new Request("http://transit.invalid/v1/vehicles?routeId=JEB405136521&cityCode=39"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "15");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.error, "PROVIDER_RATE_LIMITED");
});

test("one instance never has more than the allowed number of TAGO requests in flight", async () => {
  let inFlight = 0;
  let peak = 0;
  let calls = 0;
  const provider = new TagoTransitProvider({
    serviceKey: "test-key",
    fetchImplementation: async () => {
      calls += 1;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return empty();
    },
  });
  const reads = Array.from({ length: 16 }, (_, index) => provider.vehicles({ routeId: `JEB4051365${String(index).padStart(2, "0")}`, cityCode: "39" }));
  const results = await Promise.all(reads);
  assert.equal(calls, 16, "every request is still made, only spread out");
  assert.ok(results.every((rows) => rows.length === 0));
  assert.equal(peak, TAGO_MAX_CONCURRENT_REQUESTS);
});

test("waiting for a slot counts against the request's deadline", async () => {
  let calls = 0;
  const provider = new TagoTransitProvider({
    serviceKey: "test-key",
    maxConcurrentRequests: 1,
    deadlineMs: 150,
    attemptTimeoutMs: 150,
    fetchImplementation: async () => {
      calls += 1;
      // Ignores its abort signal and holds the only slot past the second request's deadline.
      await new Promise((resolve) => setTimeout(resolve, 400));
      return empty();
    },
  });
  const first = provider.vehicles(route).catch(() => "first done");
  const started = Date.now();
  await assert.rejects(provider.vehicles({ ...route, routeId: "JEB405136522" }), ProviderTimeoutError);
  assert.ok(Date.now() - started < 380, "gave up at its own deadline, not when the slot freed");
  assert.equal(calls, 1, "the second request never reached TAGO");
  await first;
});
