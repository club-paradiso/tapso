/**
 * TAGO failure modes seen in production (`docs/KNOWN_ISSUES.md`): envelopes
 * without `body` or `response`, 12–14 s answers, and 502 from `/v1/vehicles`
 * and `/v1/stops`. One logical request now has one deadline, a retry only when
 * enough of it is left, a jittered pause, and one telemetry record that never
 * carries the service key or a vehicle number.
 *
 * Every response here is SYNTHETIC; a fake clock stands in for time.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ProviderResponseError, ProviderTimeoutError, ProviderUnavailableError } from "../src/provider.ts";
import { ProviderHealth, type ProviderRequestRecord } from "../src/providerHealth.ts";
import { TAGO_ATTEMPT_TIMEOUT_MS, TAGO_REQUEST_DEADLINE_MS, TagoTransitProvider } from "../src/tagoProvider.ts";

const route = { routeId: "JEB405136521", cityCode: "39" };
const SECRET = "synthetic-service-key-do-not-log";

function ok(items: unknown[]): Response {
  return new Response(JSON.stringify({ response: {
    header: { resultCode: "00" },
    body: { totalCount: items.length, pageNo: 1, items: items.length ? { item: items } : "" },
  } }));
}

/** A provider on a fake clock: each fetch advances it by the scripted latency. */
function harness(script: Array<{ latencyMs: number; answer: () => Response | Promise<Response> }>) {
  let clock = 0;
  const records: ProviderRequestRecord[] = [];
  const sleeps: number[] = [];
  let calls = 0;
  const fetchImplementation: typeof fetch = async () => {
    const step = script[Math.min(calls, script.length - 1)]!;
    calls += 1;
    clock += step.latencyMs;
    return step.answer();
  };
  const provider = new TagoTransitProvider({
    serviceKey: SECRET,
    fetchImplementation,
    clock: () => clock,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); clock += milliseconds; },
    random: () => 0.5,
    onRequest: (record) => records.push(record),
    now: () => new Date("2026-10-02T00:00:00.000Z"),
  });
  return { provider, records, sleeps, calls: () => calls };
}

const timeout = () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); };

test("the defaults bound one logical request well inside the app's 20 s request timeout", () => {
  assert.ok(TAGO_REQUEST_DEADLINE_MS <= 10_000);
  assert.ok(TAGO_ATTEMPT_TIMEOUT_MS < TAGO_REQUEST_DEADLINE_MS);
});

test("a body-less envelope is retried once after a jittered pause, and recorded once", async () => {
  const { provider, records, sleeps } = harness([
    { latencyMs: 300, answer: () => new Response(JSON.stringify({ response: { header: { resultCode: "00" } } })) },
    { latencyMs: 200, answer: () => ok([{ vehicleno: "SYN70가0001", nodeord: 3 }]) },
  ]);
  const vehicles = await provider.vehicles(route);
  assert.equal(vehicles.length, 1);
  assert.deepEqual(sleeps, [375], "250 ms × (1 + jitter)");
  assert.equal(records.length, 1);
  assert.equal(records[0]!.outcome, "ok");
  assert.equal(records[0]!.attempts, 2);
  assert.equal(records[0]!.operation, "getRouteAcctoBusLcList");
  assert.equal(records[0]!.latencyMs, 875);
});

test("a slow first attempt leaves no time for a retry: one timeout, not two stacked", async () => {
  const { provider, records, calls } = harness([
    { latencyMs: 7_500, answer: timeout },
    { latencyMs: 100, answer: () => ok([]) },
  ]);
  await assert.rejects(provider.vehicles(route), ProviderTimeoutError);
  assert.equal(calls(), 1, "7.5 s of 9 s spent: under 2 s is left, so no retry starts");
  assert.equal(records[0]!.outcome, "PROVIDER_TIMEOUT");
  assert.ok(records[0]!.latencyMs <= TAGO_REQUEST_DEADLINE_MS);
});

test("a timeout with enough budget left is retried, and the whole request still ends by the deadline", async () => {
  const { provider, records, calls } = harness([
    { latencyMs: 6_000, answer: timeout },
    { latencyMs: 2_600, answer: timeout },
  ]);
  await assert.rejects(provider.vehicles(route), ProviderTimeoutError);
  assert.equal(calls(), 2);
  assert.ok(records[0]!.latencyMs <= TAGO_REQUEST_DEADLINE_MS, `${records[0]!.latencyMs} ms`);
  assert.equal(records[0]!.attempts, 2);
});

test("HTTP 502 twice is PROVIDER_UNAVAILABLE with the status recorded; a 4xx is never retried", async () => {
  const twice = harness([{ latencyMs: 100, answer: () => new Response("bad gateway", { status: 502 }) }]);
  await assert.rejects(twice.provider.stops(route), ProviderUnavailableError);
  assert.equal(twice.calls(), 2);
  assert.equal(twice.records[0]!.httpStatus, 502);
  assert.equal(twice.records[0]!.outcome, "PROVIDER_UNAVAILABLE");

  const once = harness([{ latencyMs: 100, answer: () => new Response("forbidden", { status: 403 }) }]);
  await assert.rejects(once.provider.stops(route), ProviderUnavailableError);
  assert.equal(once.calls(), 1);
});

test("a malformed envelope that persists fails closed as PROVIDER_RESPONSE_INVALID, never an empty list", async () => {
  const { provider, records } = harness([{ latencyMs: 100, answer: () => new Response(JSON.stringify({ nope: true })) }]);
  await assert.rejects(provider.vehicles(route), (error: unknown) => error instanceof ProviderResponseError
    && !(error instanceof ProviderTimeoutError) && !(error instanceof ProviderUnavailableError));
  assert.equal(records[0]!.outcome, "PROVIDER_RESPONSE_INVALID");
  assert.equal(records[0]!.detail, "TAGO payload has no response object");
});

test("telemetry never carries the service key or a vehicle number", async () => {
  const { provider, records } = harness([{ latencyMs: 50, answer: () => ok([{ vehicleno: "SYN70가9876", nodeord: 2 }]) }]);
  await provider.vehicles(route);
  const text = JSON.stringify(records);
  assert.ok(!text.includes(SECRET));
  assert.ok(!text.includes("9876"));
  assert.ok(!text.includes("serviceKey"));
});

test("provider health summarises outcomes and latency for this instance only", () => {
  const health = new ProviderHealth(4);
  const at = "2026-10-02T00:00:00.000Z";
  for (const [outcome, latencyMs, attempts] of [
    ["ok", 100, 1], ["ok", 300, 2], ["PROVIDER_TIMEOUT", 9_000, 2], ["ok", 200, 1], ["PROVIDER_RESPONSE_INVALID", 400, 2],
  ] as const) {
    health.record({ provider: "tago", operation: "getRouteAcctoBusLcList", outcome, latencyMs, attempts, at, ...(outcome === "ok" ? {} : { detail: "x" }) });
  }
  const snapshot = health.snapshot();
  assert.equal(snapshot.scope, "this_instance");
  assert.equal(snapshot.window, 4, "bounded");
  assert.deepEqual(snapshot.outcomes, { ok: 2, PROVIDER_TIMEOUT: 1, PROVIDER_RESPONSE_INVALID: 1 });
  assert.equal(snapshot.retried, 3);
  assert.deepEqual(snapshot.latencyMs, { p50: 300, p95: 9_000, max: 9_000 });
  assert.equal(snapshot.lastFailure?.outcome, "PROVIDER_RESPONSE_INVALID");
});

test("a missing credential is recorded by class only: the record never names the variable", async () => {
  const records: ProviderRequestRecord[] = [];
  const provider = new TagoTransitProvider({ serviceKey: "", onRequest: (record) => records.push(record) });
  await assert.rejects(provider.vehicles(route));
  assert.equal(records[0]!.outcome, "BLOCKED_BY_CREDENTIALS");
  assert.equal(records[0]!.detail, undefined);
  assert.equal(records[0]!.attempts, 0);
});

test("one logical request retries once in total, not once per page", async () => {
  let call = 0;
  let clock = 0;
  const page = (no: number) => new Response(JSON.stringify({ response: {
    header: { resultCode: "00" },
    body: { totalCount: 200, pageNo: no, items: { item: Array.from({ length: 100 }, (_, index) => ({ vehicleno: `SYN${no}-${index}`, nodeord: 1 })) } },
  } }));
  const broken = () => new Response(JSON.stringify({ response: { header: { resultCode: "00" } } }));
  // Page 1 fails once, then answers; page 2 fails once: a second retry would rescue it.
  const script = [broken, () => page(1), broken, () => page(2)];
  const records: ProviderRequestRecord[] = [];
  const provider = new TagoTransitProvider({
    serviceKey: SECRET,
    fetchImplementation: async () => { const answer = script[call++]!; clock += 100; return answer(); },
    clock: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    random: () => 0,
    onRequest: (record) => records.push(record),
  });
  await assert.rejects(provider.stops(route), ProviderResponseError);
  assert.equal(call, 3, "page 2 got no retry of its own");
  assert.equal(records[0]!.attempts, 3);
});
