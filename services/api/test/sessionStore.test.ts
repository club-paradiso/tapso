import test from "node:test";
import assert from "node:assert/strict";
import {
  JOURNEY_SESSION_SCHEMA_VERSION,
  MemoryJourneySessionStore,
  SessionStoreError,
  type StoredJourneySession,
} from "../src/sessionStore.ts";
import { DEFAULT_SESSION_KEY_PREFIX } from "../src/sessionKeyPrefix.ts";
import {
  DEFAULT_EXPIRY_GRACE_MS,
  UpstashJourneySessionStore,
} from "../src/upstashSessionStore.ts";

const NOW = new Date("2026-09-22T12:00:00Z");
const EPOCH = new Date(0).toISOString();

function session(overrides: Partial<StoredJourneySession> = {}): StoredJourneySession {
  return {
    schemaVersion: JOURNEY_SESSION_SCHEMA_VERSION,
    id: "session-1",
    routeId: "JEB405136521",
    cityCode: "39",
    boardingStopSequence: 1,
    destinationStopSequence: 5,
    directionCode: "1",
    stops: [{ stopId: "S1", name: "제주대학교", sequence: 1, latitude: 33.4, longitude: 126.5 }],
    boardingStop: { stopId: "S1", name: "제주대학교", sequence: 1, latitude: 33.4, longitude: 126.5 },
    destinationStop: { stopId: "S5", name: "제주한라대학교", sequence: 5, latitude: 33.5, longitude: 126.6 },
    matchConfidence: "unknown",
    createdAtMs: NOW.getTime(),
    updatedAtMs: NOW.getTime(),
    expiresAtMs: NOW.getTime() + 60_000,
    cadenceHistory: [
      ["TAGO-A", [{
        vehicleId: "TAGO-A",
        routeId: "JEB405136521",
        observedAt: EPOCH,
        receivedAt: NOW.toISOString(),
        timestampSource: "unavailable",
        stopSequence: 2,
      }]],
    ],
    consecutiveProviderFailures: 0,
    ...overrides,
  };
}

/* --------------------------------------------------------- memory store */

test("a stored session round-trips every field, including the cadence history map", async () => {
  const store = new MemoryJourneySessionStore({ now: () => NOW });
  const original = session();
  assert.equal((await store.create(original)).outcome, "saved");

  const loaded = await store.load("session-1");
  assert.ok(loaded);
  // `JSON.stringify` turns a Map into `{}` without complaining, so the entry
  // array is the thing that has to survive intact.
  assert.deepEqual(loaded.session, original);
  assert.equal(loaded.session.cadenceHistory[0]?.[0], "TAGO-A");
  assert.equal(loaded.session.cadenceHistory[0]?.[1]?.[0]?.observedAt, EPOCH);
  assert.equal(loaded.version, 1);
});

test("the store hands back a copy, never a live reference", async () => {
  const store = new MemoryJourneySessionStore({ now: () => NOW });
  await store.create(session());

  const first = await store.load("session-1");
  first!.session.consecutiveProviderFailures = 99;

  const second = await store.load("session-1");
  // Mutating a loaded session must not reach the store. If it did, the memory
  // store would behave unlike the durable one and stop being a test double.
  assert.equal(second!.session.consecutiveProviderFailures, 0);
});

test("a create never overwrites an existing session", async () => {
  const store = new MemoryJourneySessionStore({ now: () => NOW });
  await store.create(session({ selectedVehicleId: "TAGO-A" }));

  const collision = await store.create(session({ selectedVehicleId: "TAGO-B" }));
  assert.equal(collision.outcome, "conflict");
  assert.equal((await store.load("session-1"))!.session.selectedVehicleId, "TAGO-A");
});

test("a save at a stale version loses and returns the winning row", async () => {
  const store = new MemoryJourneySessionStore({ now: () => NOW });
  await store.create(session());
  const loaded = await store.load("session-1");

  const winner = await store.save(session({ selectedVehicleId: "WINNER" }), loaded!.version);
  assert.equal(winner.outcome, "saved");

  // The second writer still holds version 1 and must not clobber version 2.
  const loser = await store.save(session({ selectedVehicleId: "LOSER" }), loaded!.version);
  assert.equal(loser.outcome, "conflict");
  assert.equal(loser.outcome === "conflict" ? loser.stored?.session.selectedVehicleId : undefined, "WINNER");
  assert.equal((await store.load("session-1"))!.session.selectedVehicleId, "WINNER");
});

test("a save against a row that has vanished reports a conflict with nothing stored", async () => {
  const store = new MemoryJourneySessionStore({ now: () => NOW });
  await store.create(session());
  await store.delete("session-1");

  const result = await store.save(session(), 1);
  assert.equal(result.outcome, "conflict");
  assert.equal(result.outcome === "conflict" ? result.stored : "unset", undefined);
});

test("an expired row is returned, not hidden, so the coordinator can report 410", async () => {
  let now = NOW;
  const store = new MemoryJourneySessionStore({ now: () => now });
  await store.create(session());

  now = new Date(NOW.getTime() + 120_000);
  const loaded = await store.load("session-1");
  assert.ok(loaded, "the store does not decide expiry; a 404 here would be indistinguishable from a wrong id");
  assert.ok(loaded.session.expiresAtMs <= now.getTime());

  store.pruneExpired();
  assert.equal(await store.load("session-1"), undefined);
});

/* -------------------------------------------------------- upstash store */

type Call = { url: string; init: RequestInit };

function stubFetch(replies: unknown[]): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const reply = replies[index++];
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function upstash(replies: unknown[]) {
  const { fetchImpl, calls } = stubFetch(replies);
  const store = new UpstashJourneySessionStore({
    restUrl: "https://synthetic.upstash.io/",
    restToken: "synthetic-token",
    now: () => NOW,
    fetchImpl,
  });
  return { store, calls };
}

function body(call: Call): string[] {
  return JSON.parse(String(call.init.body)) as string[];
}

test("a create uses SET NX with a TTL past the session's own expiry", async () => {
  const { store, calls } = upstash([{ result: "OK" }]);
  const result = await store.create(session());

  assert.deepEqual(result, { outcome: "saved", version: 1 });
  const command = body(calls[0]!);
  assert.equal(command[0], "SET");
  // Literal on purpose: this is the format every existing row already uses.
  assert.equal(command[1], "tapso:journey-session:session-1");
  assert.equal(DEFAULT_SESSION_KEY_PREFIX, "tapso:journey-session:");
  assert.equal(command[3], "NX", "a colliding id must lose, not overwrite a ride in progress");
  assert.equal(command[4], "PX");
  // 60 s of session left plus the grace, so the row outlives the boundary the
  // coordinator reports 410 at.
  assert.equal(Number(command[5]), 60_000 + DEFAULT_EXPIRY_GRACE_MS);
  assert.match(command[2]!, /^1:\{/, "the version is a readable prefix on the stored value");
});

test("the bearer token travels in the header and never in the URL", async () => {
  const { store, calls } = upstash([{ result: null }, { result: null }]);
  await store.load("session-1");

  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer synthetic-token");
  assert.ok(!calls[0]!.url.includes("synthetic-token"));
});

test("a load decodes the version prefix and the session body", async () => {
  const stored = session({ selectedVehicleId: "TAGO-A" });
  const { store } = upstash([{ result: `7:${JSON.stringify(stored)}` }]);

  const loaded = await store.load("session-1");
  assert.equal(loaded?.version, 7);
  assert.deepEqual(loaded?.session, stored);
});

test("a missing key loads as undefined", async () => {
  const { store } = upstash([{ result: null }]);
  assert.equal(await store.load("session-1"), undefined);
});

test("a compare-and-set that wins reports the next version", async () => {
  const { store, calls } = upstash([{ result: [1, ""] }]);
  const result = await store.save(session(), 4);

  assert.deepEqual(result, { outcome: "saved", version: 5 });
  const command = body(calls[0]!);
  assert.equal(command[0], "EVAL");
  assert.equal(command[2], "2", "the row and the push index");
  assert.equal(command[3], "tapso:journey-session:session-1");
  assert.equal(command[4], "tapso:journey-session:push-index");
  assert.equal(command[5], "4", "the expected version is what makes this a compare-and-set");
  assert.match(command[6]!, /^5:\{/);
  assert.deepEqual(command.slice(8), ["0", "session-1"], "a row without a token leaves the index in the same step");
});

test("a compare-and-set that loses returns the winner's row instead of overwriting", async () => {
  const winner = session({ selectedVehicleId: "WINNER" });
  const { store } = upstash([{ result: [-1, `9:${JSON.stringify(winner)}`] }]);

  const result = await store.save(session({ selectedVehicleId: "LOSER" }), 4);
  assert.equal(result.outcome, "conflict");
  assert.equal(result.outcome === "conflict" ? result.stored?.session.selectedVehicleId : undefined, "WINNER");
  assert.equal(result.outcome === "conflict" ? result.stored?.version : undefined, 9);
});

test("a compare-and-set against a vanished row reports a conflict with nothing stored", async () => {
  const { store } = upstash([{ result: [0, ""] }]);
  const result = await store.save(session(), 4);
  assert.equal(result.outcome, "conflict");
  assert.equal(result.outcome === "conflict" ? result.stored : "unset", undefined);
});

test("an unreachable store throws instead of reading as an absent session", async () => {
  const { store } = upstash([new Error("ECONNREFUSED https://synthetic.upstash.io")]);
  // The distinction matters: undefined here would delete a rider's live
  // session from under them and answer 404 while doing it.
  await assert.rejects(store.load("session-1"), (error: unknown) => {
    assert.ok(error instanceof SessionStoreError);
    assert.equal(error.code, "SESSION_STORE_UNAVAILABLE");
    // The thrown cause can carry the credentialed host; our message must not.
    assert.ok(!String((error as Error).message).includes("upstash.io"));
    return true;
  });
});

test("a store error response throws rather than being read as data", async () => {
  const { store } = upstash([{ error: "WRONGPASS invalid or missing auth token" }]);
  await assert.rejects(store.load("session-1"), /session store reported a command error/);
});

test("an HTTP failure throws and does not leak the status body", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  const store = new UpstashJourneySessionStore({
    restUrl: "https://synthetic.upstash.io",
    restToken: "synthetic-token",
    now: () => NOW,
    fetchImpl,
  });
  await assert.rejects(store.load("session-1"), /rejected a command with status 500/);
});

test("a row with no version prefix is refused rather than half-read", async () => {
  const { store } = upstash([{ result: JSON.stringify(session()) }]);
  await assert.rejects(store.load("session-1"), /no version prefix|unreadable version/);
});

test("a row that is not valid JSON is refused", async () => {
  const { store } = upstash([{ result: "3:{not json" }]);
  await assert.rejects(store.load("session-1"), /not valid JSON/);
});

test("a row that decodes to something other than a session is refused", async () => {
  const { store } = upstash([{ result: '3:{"unrelated":true}' }]);
  await assert.rejects(store.load("session-1"), /not a journey session/);
});

test("an already expired session is still storable so the coordinator can report it", async () => {
  const { store, calls } = upstash([{ result: "OK" }]);
  await store.create(session({ expiresAtMs: NOW.getTime() - 10 * 60 * 1_000 }));
  // Clamped rather than negative: SET would reject a non-positive PX, and a
  // row that cannot be written is a row that reads as 404 instead of 410.
  assert.equal(Number(body(calls[0]!)[5]), 1_000);
});
