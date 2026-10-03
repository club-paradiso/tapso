/**
 * Milestone 5 (`docs/exec-plans/LIVE_ACTIVITY_PUSH.md`): the push index, the
 * operator tick that refreshes and pushes indexed rides, and the collector's
 * ticker that calls it. SYNTHETIC route, buses, ids and tokens; APNs and the
 * network are fakes.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createTransitApiHandler } from "../src/apiRouter.ts";
import { readTransitApiConfig } from "../src/apiConfig.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { JourneySessionCoordinator, LIVE_ACTIVITY_TICK_MIN_AGE_MS, type JourneySessionView } from "../src/journeySession.ts";
import {
  LIVE_ACTIVITY_TICK_PAUSE_MS,
  LiveActivityTicker,
  readTickerConfig,
  type TickerConfig,
} from "../src/liveActivityTicker.ts";
import type { TransitProvider } from "../src/provider.ts";
import { MemoryJourneySessionStore } from "../src/sessionStore.ts";
import { PUSH_INDEX_KEY_SUFFIX, UpstashJourneySessionStore } from "../src/upstashSessionStore.ts";

const routeId = "SYN-ROUTE-TICK";
const stops: StopOnRoute[] = Array.from({ length: 10 }, (_, index) => ({ stopId: `S${index + 1}`, name: `합성 정류장 ${index + 1}`, sequence: index + 1 }));
const PUSH_TOKEN = "cd".repeat(32);
const OPERATOR = "synthetic-operator-token-0123456789";

class Provider implements TransitProvider {
  reads = 0;
  at = new Date(0);
  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    return stops.map((stop) => ({ ...stop }));
  }
  async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> {
    this.reads += 1;
    return [{ vehicleId: "SYN70가0001", routeId, observedAt: new Date(0).toISOString(), receivedAt: this.at.toISOString(), timestampSource: "unavailable", stopSequence: 2 }];
  }
}

function world() {
  const provider = new Provider();
  const store = new MemoryJourneySessionStore();
  let now = new Date("2026-10-03T06:00:00.000Z");
  let next = 0;
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, store, idFactory: () => `syn-tick-${++next}` });
  const create = () => sessions.create({ routeId, cityCode: "999", boardingStopSequence: 3, destinationStopSequence: 8 });
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
    provider.at = now;
  };
  return { provider, store, sessions, create, advance };
}

test("a session enters the push index when a token is registered and leaves it with the token or the ride", async () => {
  const { store, sessions, create } = world();
  const a = await create();
  const b = await create();
  const c = await create();
  assert.deepEqual(await store.pushIndex.sample(10), [], "no token, no entry");
  for (const id of [a.id, b.id, c.id]) await sessions.registerLiveActivityToken(id, { pushToken: PUSH_TOKEN });
  assert.deepEqual((await store.pushIndex.sample(10)).sort(), [a.id, b.id, c.id].sort());

  await sessions.clearLiveActivityToken(a.id);
  await sessions.end(b.id);
  const target = await sessions.liveActivityTarget(c.id);
  await sessions.dropLiveActivityToken(c.id, "000000000000");
  assert.deepEqual(await store.pushIndex.sample(10), [c.id], "a stale fingerprint drops nothing");
  await sessions.dropLiveActivityToken(c.id, target!.fingerprint);
  assert.deepEqual(await store.pushIndex.sample(10), []);
});

test("a tick refreshes a ride the app has not read lately, leaves a recent one, and prunes what needs no push", async () => {
  const { provider, store, sessions, create, advance } = world();
  const ride = await create();
  await sessions.registerLiveActivityToken(ride.id, { pushToken: PUSH_TOKEN });
  const reads = provider.reads;
  assert.deepEqual(await sessions.tickLiveActivity(ride.id), { kind: "recent" });
  assert.equal(provider.reads, reads, "a recent read costs no provider call");
  advance(LIVE_ACTIVITY_TICK_MIN_AGE_MS);
  const refreshed = await sessions.tickLiveActivity(ride.id);
  assert.equal(refreshed.kind, "refreshed");
  assert.equal(provider.reads, reads + 1);

  // An entry whose token went away by another path, a row that is gone, a ride past its expiry.
  await store.pushIndex.add("syn-tick-missing");
  assert.deepEqual(await sessions.tickLiveActivity("syn-tick-missing"), { kind: "removed", reason: "gone" });
  const untracked = await create();
  await store.pushIndex.add(untracked.id);
  assert.deepEqual(await sessions.tickLiveActivity(untracked.id), { kind: "removed", reason: "no_token" });
  advance(24 * 60 * 60_000);
  assert.deepEqual(await sessions.tickLiveActivity(ride.id), { kind: "removed", reason: "expired" });
  assert.deepEqual(await store.pushIndex.sample(10), []);
  assert.ok(await store.load(ride.id), "the expired row stays, so the app still reads 410 rather than 404");
});

function tickApi(options: { pusher?: boolean; operator?: boolean } = {}) {
  const { sessions, create, advance, store } = world();
  const config = readTransitApiConfig(
    { TAGO_SERVICE_KEY: "synthetic-key", TRANSIT_SESSIONS_ENABLED: "true", ...(options.operator === false ? {} : { RIDE_CAPTURE_OPERATOR_TOKEN: OPERATOR }) },
    { nodeVersion: "v22.0.0" },
  );
  const pushed: JourneySessionView[] = [];
  const handler = createTransitApiHandler({
    config,
    provider: new Provider() as never,
    sessions,
    ...(options.operator === false ? {} : { operatorToken: OPERATOR }),
    ...(options.pusher === false ? {} : {
      liveActivityPush: { enabled: true, environment: "development" as const },
      liveActivityPusher: { afterRead: async (view: JourneySessionView) => void pushed.push(view), beforeEnd: async () => {} },
    }),
    log: () => {},
  });
  const tick = (token: string = OPERATOR) =>
    handler(new Request("http://api.test/operator/live-activity/tick", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }));
  return { tick, sessions, create, advance, pushed, store };
}

test("the operator tick refreshes and pushes indexed rides and answers with counts only", async () => {
  const { tick, sessions, create, advance, pushed } = tickApi();
  const ride = await create();
  await sessions.registerLiveActivityToken(ride.id, { pushToken: PUSH_TOKEN });
  const quiet = await create();
  advance(LIVE_ACTIVITY_TICK_MIN_AGE_MS);

  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  let response: Response;
  try {
    response = await tick();
  } finally {
    console.info = original;
  }
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { sampled: 1, refreshed: 1, recent: 0, removed: 0, failed: 0, deferred: 0 });
  assert.deepEqual(pushed.map((view) => view.id), [ride.id], "only the ride with a token is read and pushed");
  assert.ok(!text.includes(ride.id) && !text.includes(quiet.id));
  const logged = lines.find((line) => line.includes("live_activity_tick"));
  assert.ok(logged && !logged.includes(ride.id) && !logged.includes(PUSH_TOKEN));

  assert.deepEqual(await (await tick()).json(), { sampled: 1, refreshed: 0, recent: 1, removed: 0, failed: 0, deferred: 0 }, "just read: left alone");
});

test("the tick is operator-only, and answers 503 where push is not configured", async () => {
  const api = tickApi();
  assert.equal((await api.tick("")).status, 401, "no bearer token");
  assert.equal((await api.tick("wrong-token-wrong-token-wrong")).status, 401);
  const noPush = tickApi({ pusher: false });
  const refused = await noPush.tick();
  assert.equal(refused.status, 503);
  assert.equal((await refused.json()).error, "LIVE_ACTIVITY_PUSH_UNAVAILABLE");
  const noOperator = await tickApi({ operator: false }).tick();
  assert.equal(noOperator.status, 503);
  assert.equal((await noOperator.json()).error, "OPERATOR_DISABLED");
});

test("the durable push index is a set inside the store's own namespace", async () => {
  const commands: string[][] = [];
  const members = new Set<string>();
  const fetchImpl = (async (_url: string | URL | Request, init: RequestInit = {}) => {
    const command = JSON.parse(String(init.body)) as string[];
    commands.push(command);
    const [name, key, ...args] = command;
    assert.equal(key, `tapso:prod:journey-session:${PUSH_INDEX_KEY_SUFFIX}`);
    let result: unknown = null;
    if (name === "SADD") result = members.add(args[0]!) ? 1 : 0;
    else if (name === "SREM") result = members.delete(args[0]!) ? 1 : 0;
    else if (name === "SRANDMEMBER") result = [...members].slice(0, Number(args[0]));
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as unknown as typeof fetch;
  const store = new UpstashJourneySessionStore({ restUrl: "https://synthetic.upstash.io", restToken: "synthetic", keyPrefix: "tapso:prod:journey-session:", fetchImpl });
  await store.pushIndex.add("syn-a");
  await store.pushIndex.add("syn-b");
  await store.pushIndex.remove("syn-a");
  assert.deepEqual(await store.pushIndex.sample(20), ["syn-b"]);
  assert.deepEqual(await store.pushIndex.sample(0), []);
  assert.deepEqual(commands.map((command) => command[0]), ["SADD", "SADD", "SREM", "SRANDMEMBER"]);
  assert.throws(() => store.keyFor(PUSH_INDEX_KEY_SUFFIX), /push index/);
  assert.equal(await store.load(PUSH_INDEX_KEY_SUFFIX), undefined, "reading the index's name finds no session");
  assert.equal(commands.length, 4, "and sends nothing");
  await assert.rejects(store.pushIndex.add(PUSH_INDEX_KEY_SUFFIX), /push index/);
});

test("the ticker is off unless both variables are set, and only ever sends its token over https to the tick route", () => {
  assert.deepEqual(readTickerConfig({}), { enabled: false });
  const token = "t".repeat(32);
  for (const [env, problem] of [
    [{ LIVE_ACTIVITY_TICK_URL: "https://api.test/operator/live-activity/tick" }, /set together/],
    [{ LIVE_ACTIVITY_TICK_URL: "https://api.test/operator/live-activity/tick", LIVE_ACTIVITY_TICK_TOKEN: "short" }, /at least 24/],
    [{ LIVE_ACTIVITY_TICK_URL: "http://api.test/operator/live-activity/tick", LIVE_ACTIVITY_TICK_TOKEN: token }, /https/],
    [{ LIVE_ACTIVITY_TICK_URL: "https://api.test/v1/sessions", LIVE_ACTIVITY_TICK_TOKEN: token }, /https/],
    [{ LIVE_ACTIVITY_TICK_URL: "not a url", LIVE_ACTIVITY_TICK_TOKEN: token }, /not a URL/],
  ] as const) {
    const config = readTickerConfig(env);
    assert.equal(config.enabled, false);
    assert.match((config as { problem: string }).problem, problem);
  }
  assert.deepEqual(readTickerConfig({ LIVE_ACTIVITY_TICK_URL: " https://api.test/operator/live-activity/tick ", LIVE_ACTIVITY_TICK_TOKEN: token }), {
    enabled: true,
    url: "https://api.test/operator/live-activity/tick",
    token,
  });
});

test("the ticker posts with the bearer token, never overlaps, pauses on a deployment that cannot push, and never logs the token", async () => {
  const token = "s".repeat(32);
  const config: TickerConfig = { enabled: true, url: "https://api.test/operator/live-activity/tick", token };
  let now = 1_000_000;
  const requests: Array<{ url: string; authorization: string | null }> = [];
  let answer: () => Promise<Response> = async () => new Response(JSON.stringify({ sampled: 2, refreshed: 1, recent: 1, removed: 0, failed: 0, deferred: 0 }), { status: 200 });
  const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: String(url), authorization: new Headers(init.headers).get("authorization") });
    return answer();
  }) as unknown as typeof fetch;
  const logs: Array<Record<string, unknown>> = [];
  const ticker = new LiveActivityTicker(config, { fetchImpl, now: () => now, log: (entry) => logs.push(entry) });

  assert.deepEqual(await ticker.tickOnce(), { kind: "ok", counts: { sampled: 2, refreshed: 1, recent: 1, removed: 0, failed: 0, deferred: 0 } });
  assert.deepEqual(requests[0], { url: config.url, authorization: `Bearer ${token}` });

  let release!: () => void;
  answer = () => new Promise((resolve) => {
    release = () => resolve(new Response(JSON.stringify({ sampled: 0 }), { status: 200 }));
  });
  const first = ticker.tickOnce();
  assert.deepEqual(await ticker.tickOnce(), { kind: "skipped", reason: "running" });
  release();
  await first;

  answer = async () => new Response(JSON.stringify({ error: "LIVE_ACTIVITY_PUSH_UNAVAILABLE" }), { status: 503 });
  assert.deepEqual(await ticker.tickOnce(), { kind: "push_unavailable" });
  const asked = requests.length;
  now += LIVE_ACTIVITY_TICK_PAUSE_MS - 1;
  assert.deepEqual(await ticker.tickOnce(), { kind: "skipped", reason: "paused" });
  assert.equal(requests.length, asked);
  assert.ok(ticker.status().pausedUntil);
  now += 1;
  answer = async () => new Response("{}", { status: 401 });
  assert.deepEqual(await ticker.tickOnce(), { kind: "unauthorized" });
  now += LIVE_ACTIVITY_TICK_PAUSE_MS;
  answer = async () => {
    throw new TypeError("fetch failed");
  };
  assert.deepEqual(await ticker.tickOnce(), { kind: "failed", reason: "TypeError" });

  assert.equal(ticker.status().state, "enabled");
  assert.equal(ticker.status().last?.outcome, "failed");
  assert.ok(logs.length > 0);
  assert.ok(logs.every((entry) => !JSON.stringify(entry).includes(token)), "the token is never logged");
  assert.ok(!JSON.stringify(ticker.status()).includes(token), "nor shown in health");
});

test("a disabled ticker sends nothing", async () => {
  let called = false;
  const ticker = new LiveActivityTicker({ enabled: false }, { fetchImpl: (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch });
  ticker.start();
  assert.deepEqual(ticker.status(), { state: "disabled" });
  assert.equal((await ticker.tickOnce()).kind, "failed");
  assert.equal(called, false);
});
