import test from "node:test";
import assert from "node:assert/strict";
import { readTransitApiConfig } from "../src/apiConfig.ts";
import { createTransitApi } from "../src/apiRuntime.ts";
import {
  DEFAULT_SESSION_KEY_PREFIX,
  MAX_SESSION_KEY_PREFIX_LENGTH,
  readSessionKeyPrefix,
  resolveVerificationKeyPrefix,
  validateSessionKeyPrefix,
  VERIFY_SESSION_KEY_PREFIX,
} from "../src/sessionKeyPrefix.ts";
import { JOURNEY_SESSION_SCHEMA_VERSION, type StoredJourneySession } from "../src/sessionStore.ts";
import { UpstashJourneySessionStore } from "../src/upstashSessionStore.ts";

const NOW = new Date("2026-09-22T12:00:00Z");
const NODE = { nodeVersion: "v22.18.0" };
const PREVIEW = "tapso:preview:journey-session:";
const PROD = "tapso:prod:journey-session:";
const UPSTASH = {
  UPSTASH_REDIS_REST_URL: "https://synthetic.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "synthetic-upstash-token",
};

function session(overrides: Partial<StoredJourneySession> = {}): StoredJourneySession {
  return {
    schemaVersion: JOURNEY_SESSION_SCHEMA_VERSION,
    id: "session-1",
    routeId: "JEB405136521",
    cityCode: "39",
    boardingStopSequence: 1,
    destinationStopSequence: 5,
    stops: [{ stopId: "S1", name: "제주대학교", sequence: 1, latitude: 33.4, longitude: 126.5 }],
    boardingStop: { stopId: "S1", name: "제주대학교", sequence: 1, latitude: 33.4, longitude: 126.5 },
    destinationStop: { stopId: "S5", name: "제주한라대학교", sequence: 5, latitude: 33.5, longitude: 126.6 },
    matchConfidence: "unknown",
    createdAtMs: NOW.getTime(),
    updatedAtMs: NOW.getTime(),
    expiresAtMs: NOW.getTime() + 60_000,
    cadenceHistory: [],
    consecutiveProviderFailures: 0,
    ...overrides,
  };
}

/**
 * One fake database shared by every store built from it, answering the four
 * commands the store sends with the semantics Redis gives them. Sharing is the
 * point: isolation has to hold between stores on the same physical database,
 * and a per-store stub could never show a collision.
 */
function sharedDatabase() {
  const rows = new Map<string, string>();
  const commands: string[][] = [];
  const fetchImpl = (async (_url: string | URL | Request, init: RequestInit = {}) => {
    const command = JSON.parse(String(init.body)) as string[];
    commands.push(command);
    const reply = (result: unknown) =>
      new Response(JSON.stringify({ result }), { status: 200, headers: { "content-type": "application/json" } });
    const [name, ...args] = command;
    switch (name) {
      case "GET":
        return reply(rows.get(args[0]!) ?? null);
      case "SET": {
        const [key, value, ...flags] = args;
        if (flags.includes("NX") && rows.has(key!)) return reply(null);
        rows.set(key!, value!);
        return reply("OK");
      }
      case "DEL":
        return reply(rows.delete(args[0]!) ? 1 : 0);
      case "EVAL": {
        // Mirrors CAS_SCRIPT: EVAL <script> 1 <key> <expected> <value> <px>
        const [, , key, expected, value] = args;
        const current = rows.get(key!);
        if (current === undefined) return reply([0, ""]);
        if (Number(current.slice(0, current.indexOf(":"))) !== Number(expected)) return reply([-1, current]);
        rows.set(key!, value!);
        return reply([1, ""]);
      }
      default:
        throw new Error(`the fake database does not implement ${name}`);
    }
  }) as unknown as typeof fetch;

  const store = (keyPrefix?: string) => new UpstashJourneySessionStore({
    restUrl: "https://synthetic.upstash.io",
    restToken: "synthetic-token",
    now: () => NOW,
    fetchImpl,
    ...(keyPrefix === undefined ? {} : { keyPrefix }),
  });
  return { rows, commands, store };
}

/* ---------------------------------------------------------------- validation */

test("the default namespace is exactly the key format existing rows already use", () => {
  assert.equal(DEFAULT_SESSION_KEY_PREFIX, "tapso:journey-session:");
  assert.equal(readSessionKeyPrefix({}), DEFAULT_SESSION_KEY_PREFIX);
  const { store } = sharedDatabase();
  assert.equal(store().keyPrefix, DEFAULT_SESSION_KEY_PREFIX);
  assert.equal(store().keyFor("abc"), "tapso:journey-session:abc");
});

test("the documented environment namespaces are accepted as written", () => {
  for (const prefix of [DEFAULT_SESSION_KEY_PREFIX, PREVIEW, PROD, VERIFY_SESSION_KEY_PREFIX,
    "tapso:pr-48:journey-session:", "tapso:a:b_c:d-1:journey-session:"]) {
    assert.equal(validateSessionKeyPrefix(prefix), prefix);
  }
  assert.equal(readSessionKeyPrefix({ TRANSIT_SESSION_KEY_PREFIX: PREVIEW }), PREVIEW);
});

test("an empty namespace is refused, including one set explicitly to nothing", () => {
  assert.throws(() => validateSessionKeyPrefix(""), /must not be empty/);
  // Set-but-empty is not unset. Falling back to the default here would put
  // this deployment's rides in whatever namespace the default belongs to.
  assert.throws(() => readSessionKeyPrefix({ TRANSIT_SESSION_KEY_PREFIX: "" }), /TRANSIT_SESSION_KEY_PREFIX must not be empty/);
});

test("whitespace is refused rather than trimmed", () => {
  for (const prefix of [" tapso:preview:journey-session:", "tapso:preview:journey-session: ",
    "tapso:pre view:journey-session:", "tapso:preview:journey-session: ", "   "]) {
    assert.throws(() => validateSessionKeyPrefix(prefix), /whitespace/, JSON.stringify(prefix));
  }
});

test("control characters are refused", () => {
  for (const prefix of ["tapso:pre\u0000view:journey-session:", "tapso:preview\n:journey-session:",
    "tapso:preview:journey-session:\r", "tapso:\u001bpreview:journey-session:", "tapso:preview\u007f:journey-session:"]) {
    assert.throws(() => validateSessionKeyPrefix(prefix), /control characters/, JSON.stringify(prefix));
  }
});

test("an overly long namespace is refused", () => {
  const long = `tapso:${"a".repeat(MAX_SESSION_KEY_PREFIX_LENGTH)}:journey-session:`;
  assert.throws(() => validateSessionKeyPrefix(long), /at most 96 characters/);
  // A single segment is capped too, well inside the overall bound.
  assert.throws(() => validateSessionKeyPrefix(`tapso:${"a".repeat(33)}:journey-session:`), /must match/);
});

test("wildcards and Redis pattern characters are refused", () => {
  for (const prefix of ["*", "tapso:*", "tapso:*:journey-session:", "tapso:pre?iew:journey-session:",
    "tapso:[ab]:journey-session:", "tapso:{preview}:journey-session:", "tapso:a\\b:journey-session:",
    "tapso:^a:journey-session:"]) {
    assert.throws(() => validateSessionKeyPrefix(prefix), /pattern characters/, prefix);
  }
});

test("global and foreign namespaces are unspellable", () => {
  for (const prefix of [":", "tapso", "tapso:", "journey-session:", "tapso:preview:",
    "session:", "tong-yuck:journey-session:", "TAPSO:journey-session:", "tapso:Preview:journey-session:",
    "tapso:preview:journey-session", "tapso::journey-session:", "tapso:-x:journey-session:",
    "tapso:a.b:journey-session:", "tapso:a:b:c:d:journey-session:"]) {
    assert.throws(() => validateSessionKeyPrefix(prefix), RangeError, prefix);
  }
});

test("one namespace can never be nested inside another", () => {
  // Accepting this would make every one of its keys also a key of the default
  // namespace, under an id that happens to start with `journey-session:`.
  assert.throws(
    () => validateSessionKeyPrefix("tapso:journey-session:journey-session:"),
    /must not nest/,
  );
  assert.throws(
    () => validateSessionKeyPrefix("tapso:preview:journey-session:journey-session:"),
    /must not nest/,
  );
});

/* --------------------------------------------------------- boot-time failure */

test("an invalid explicit namespace fails at boot instead of falling back", () => {
  for (const bad of ["", " ", "tapso:*", "tapso:", "tapso:preview:journey-session: "]) {
    const env = { TRANSIT_SESSION_KEY_PREFIX: bad };
    assert.throws(() => readSessionKeyPrefix(env), /TRANSIT_SESSION_KEY_PREFIX/, JSON.stringify(bad));
    // Config is read on every store, so a dormant typo on a memory deployment
    // does not wait for the day someone switches to redis.
    assert.throws(() => readTransitApiConfig(env, NODE), /TRANSIT_SESSION_KEY_PREFIX/);
    assert.throws(
      () => readTransitApiConfig({ ...env, TRANSIT_SESSION_STORE: "redis", ...UPSTASH }, NODE),
      /TRANSIT_SESSION_KEY_PREFIX/,
    );
    assert.throws(
      () => createTransitApi({ ...env, TRANSIT_SESSION_STORE: "redis", ...UPSTASH }),
      /TRANSIT_SESSION_KEY_PREFIX/,
    );
  }
});

test("a valid namespace boots and stays out of the public config", () => {
  const env = { TRANSIT_SESSION_STORE: "redis", TRANSIT_SESSION_KEY_PREFIX: PREVIEW, ...UPSTASH };
  assert.doesNotThrow(() => createTransitApi(env));
  const config = readTransitApiConfig(env, NODE);
  // `/health` serializes config. The key layout of a shared database is not
  // something an anonymous caller needs.
  assert.ok(!JSON.stringify(config).includes("journey-session"));
  // A namespace is not a rollout decision.
  assert.equal(config.matching.automaticMatchingEnabled, false);
});

test("the store refuses an invalid namespace even when built directly", () => {
  const { store } = sharedDatabase();
  assert.throws(() => store(""), /must not be empty/);
  assert.throws(() => store("tapso:*"), /pattern characters/);
  assert.throws(() => store("other-app:"), /must match/);
});

/* ---------------------------------------------------------------- isolation */

test("a custom preview namespace is used for every command the store sends", async () => {
  const { store, commands } = sharedDatabase();
  const preview = store(PREVIEW);
  assert.equal(preview.keyPrefix, PREVIEW);

  assert.equal((await preview.create(session())).outcome, "saved");
  assert.ok(await preview.load("session-1"));
  assert.equal((await preview.save(session({ selectedVehicleId: "A" }), 1)).outcome, "saved");
  await preview.delete("session-1");

  assert.deepEqual(commands.map((command) => command[0]), ["SET", "GET", "EVAL", "DEL"]);
  const keys = commands.map((command) => (command[0] === "EVAL" ? command[3] : command[1]));
  assert.deepEqual(keys, Array(4).fill(`${PREVIEW}session-1`));
});

test("preview and production namespaces cannot see or mutate each other's sessions", async () => {
  const { store, rows } = sharedDatabase();
  const preview = store(PREVIEW);
  const prod = store(PROD);

  assert.equal((await prod.create(session({ selectedVehicleId: "PROD" }))).outcome, "saved");
  // Same id, same database, different namespace: a fresh create, not a conflict.
  assert.equal((await preview.create(session({ selectedVehicleId: "PREVIEW" }))).outcome, "saved");
  assert.deepEqual([...rows.keys()].sort(), [`${PREVIEW}session-1`, `${PROD}session-1`]);

  assert.equal((await preview.load("session-1"))?.session.selectedVehicleId, "PREVIEW");
  assert.equal((await prod.load("session-1"))?.session.selectedVehicleId, "PROD");

  // Preview advances its own row twice. Production's version does not move.
  assert.equal((await preview.save(session({ selectedVehicleId: "PREVIEW-2" }), 1)).outcome, "saved");
  assert.equal((await preview.save(session({ selectedVehicleId: "PREVIEW-3" }), 2)).outcome, "saved");
  const prodRow = await prod.load("session-1");
  assert.equal(prodRow?.version, 1);
  assert.equal(prodRow?.session.selectedVehicleId, "PROD");

  // Production's CAS judges its own version, not preview's.
  assert.equal((await prod.save(session({ selectedVehicleId: "PROD-2" }), 3)).outcome, "conflict");
  assert.equal((await prod.save(session({ selectedVehicleId: "PROD-2" }), 1)).outcome, "saved");

  // Deleting in preview leaves production's row alone.
  await preview.delete("session-1");
  assert.equal(await preview.load("session-1"), undefined);
  assert.equal((await prod.load("session-1"))?.session.selectedVehicleId, "PROD-2");
  // And a CAS in preview against its deleted row does not resurrect anything.
  assert.equal((await preview.save(session(), 3)).outcome, "conflict");
  assert.deepEqual([...rows.keys()], [`${PROD}session-1`]);
});

test("a store never touches a key outside its namespace, including unrelated data", async () => {
  const { store, rows } = sharedDatabase();
  // What else lives in a shared database: another app, and another TAPSO
  // environment that happens to use the same session id.
  rows.set("tong-yuck:user:1", "unrelated");
  rows.set("session-1", "unprefixed");
  rows.set(`${DEFAULT_SESSION_KEY_PREFIX}session-1`, `1:${JSON.stringify(session({ selectedVehicleId: "DEFAULT" }))}`);
  const before = new Map(rows);

  const preview = store(PREVIEW);
  assert.equal(await preview.load("session-1"), undefined);
  assert.equal((await preview.save(session(), 1)).outcome, "conflict");
  await preview.delete("session-1");
  assert.equal((await preview.create(session())).outcome, "saved");
  await preview.delete("session-1");

  assert.deepEqual(rows, before, "every foreign row is byte-for-byte untouched");
});

test("CAS semantics inside a custom namespace are unchanged", async () => {
  const { store } = sharedDatabase();
  const preview = store(PREVIEW);
  await preview.create(session());

  const winner = await preview.save(session({ selectedVehicleId: "WINNER" }), 1);
  assert.deepEqual(winner, { outcome: "saved", version: 2 });

  const loser = await preview.save(session({ selectedVehicleId: "LOSER" }), 1);
  assert.equal(loser.outcome, "conflict");
  assert.equal(loser.outcome === "conflict" ? loser.stored?.version : undefined, 2);
  assert.equal(loser.outcome === "conflict" ? loser.stored?.session.selectedVehicleId : undefined, "WINNER");

  const duplicate = await preview.create(session({ selectedVehicleId: "DUPLICATE" }));
  assert.equal(duplicate.outcome, "conflict");
  assert.equal((await preview.load("session-1"))?.session.selectedVehicleId, "WINNER");
});

/* ---------------------------------------------------- verification namespace */

test("the verification namespace is separate from every runtime namespace", () => {
  assert.equal(resolveVerificationKeyPrefix(undefined, {}), VERIFY_SESSION_KEY_PREFIX);
  assert.equal(VERIFY_SESSION_KEY_PREFIX, "tapso:verify:journey-session:");
  assert.equal(
    resolveVerificationKeyPrefix(undefined, { TRANSIT_SESSION_KEY_PREFIX: PREVIEW }),
    VERIFY_SESSION_KEY_PREFIX,
  );
  for (const runtime of [DEFAULT_SESSION_KEY_PREFIX, PREVIEW, PROD]) {
    assert.ok(!VERIFY_SESSION_KEY_PREFIX.startsWith(runtime));
    assert.ok(!runtime.startsWith(VERIFY_SESSION_KEY_PREFIX));
  }
});

test("an explicit verification namespace must validate and must not be a runtime one", () => {
  assert.equal(resolveVerificationKeyPrefix("tapso:verify-2:journey-session:", {}), "tapso:verify-2:journey-session:");
  assert.throws(() => resolveVerificationKeyPrefix("", {}), /verification key prefix must not be empty/);
  assert.throws(() => resolveVerificationKeyPrefix("tapso:*", {}), /pattern characters/);
  assert.throws(() => resolveVerificationKeyPrefix(" tapso:verify:journey-session:", {}), /whitespace/);
  // The script deletes what it writes; it must never be pointed at live rides.
  assert.throws(
    () => resolveVerificationKeyPrefix(DEFAULT_SESSION_KEY_PREFIX, {}),
    /must differ from every runtime session namespace/,
  );
  assert.throws(
    () => resolveVerificationKeyPrefix(PREVIEW, { TRANSIT_SESSION_KEY_PREFIX: PREVIEW }),
    /must differ from every runtime session namespace/,
  );
  // A broken runtime value next to it is not ignored either.
  assert.throws(
    () => resolveVerificationKeyPrefix(undefined, { TRANSIT_SESSION_KEY_PREFIX: "tapso:" }),
    /TRANSIT_SESSION_KEY_PREFIX/,
  );
});

test("the verification script addresses keys only through its own namespace and never enumerates", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../../../scripts/upstash/verify-session-store.ts", import.meta.url), "utf8");
  // Commands are string literals in a JSON array; none of these may appear.
  for (const forbidden of ['"SCAN"', '"KEYS"', '"FLUSHDB"', '"FLUSHALL"', '"UNLINK"']) {
    assert.ok(!source.includes(forbidden), `the script must never send ${forbidden}`);
  }
  assert.match(source, /resolveVerificationKeyPrefix\(/);
  assert.match(source, /--yes/);
  assert.ok(!source.includes("SESSION_KEY_PREFIX}"), "no key is built from a global prefix");
});
