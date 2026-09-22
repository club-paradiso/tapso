/**
 * Live verification for `UpstashJourneySessionStore`.
 *
 * `services/api/src/upstashSessionStore.ts` is labelled
 * `UNVERIFIED_AGAINST_LIVE_SERVICE`: every path is covered by tests driving a
 * stub `fetch`, which proves that client's behaviour and not Upstash's. This
 * script closes milestone 6 of `docs/exec-plans/DURABLE_JOURNEY_SESSIONS.md` by
 * running the same store against a real database.
 *
 * It deliberately checks only what a stub cannot settle:
 *
 *  - the Lua compare-and-set really parses the `<version>:` prefix and really
 *    returns the winning row in a nested table, against a real Redis Lua
 *    interpreter rather than an array this repository wrote itself;
 *  - a real `SET NX PX` refuses a second create and really sets a TTL;
 *  - a session carrying Korean stop names and ISO timestamps — which are full
 *    of colons, the same character the version prefix is delimited by —
 *    survives the REST round trip byte for byte;
 *  - concurrent writers at one version produce exactly one winner, which is
 *    the invariant the whole compare-and-set design exists for.
 *
 * Safety. It writes only under a run-unique id, deletes what it wrote even on
 * failure, and never prints the token or the database host. Run it against a
 * scratch or preview database, never the one a live ride depends on.
 *
 * Usage:
 *   env -u UPSTASH_REDIS_REST_TOKEN node --env-file=.env.local \
 *     --experimental-strip-types scripts/upstash/verify-session-store.ts --yes
 *
 *   (`env -u` clears an exported copy of the name so the value in .env.local is
 *   the one used, matching `scripts/ride-capture/capture.ts`.)
 */

import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { readUpstashCredentials } from "../../services/api/src/apiConfig.ts";
import {
  JOURNEY_SESSION_SCHEMA_VERSION,
  type StoredJourneySession,
} from "../../services/api/src/sessionStore.ts";
import {
  SESSION_KEY_PREFIX,
  UpstashJourneySessionStore,
} from "../../services/api/src/upstashSessionStore.ts";

const CONFIRMED = process.argv.includes("--yes");
const SESSION_TTL_MS = 60_000;
const CONCURRENT_WRITERS = 8;

if (!CONFIRMED) {
  console.error([
    "Usage: node --experimental-strip-types scripts/upstash/verify-session-store.ts --yes",
    "",
    "Writes and deletes one run-unique key in the Upstash database named by",
    "UPSTASH_REDIS_REST_URL. Point it at a scratch or preview database, never at",
    "one a live ride depends on. --yes is required so this cannot run by accident.",
    "",
    "Run with: env -u UPSTASH_REDIS_REST_TOKEN node --env-file=.env.local \\",
    "  --experimental-strip-types scripts/upstash/verify-session-store.ts --yes",
  ].join("\n"));
  process.exit(2);
}

await warnOnLooseEnvPermissions();

// The same resolver the service uses, so a URL this script accepts is a URL the
// deployment would accept — including the https-only refusal.
let credentials: { restUrl: string; restToken: string } | undefined;
try {
  credentials = readUpstashCredentials(process.env);
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : "credentials are not usable"}`);
  process.exit(1);
}
if (!credentials) {
  console.error("FAIL  UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are both required");
  process.exit(1);
}

// Narrowed once, so nothing below needs a non-null assertion to reach it.
const resolved = credentials;
const store = new UpstashJourneySessionStore(resolved);
const sessionId = `verify-${randomUUID()}`;
const key = `${SESSION_KEY_PREFIX}${sessionId}`;

let failures = 0;
let checks = 0;

function check(name: string, passed: boolean, detail?: string): void {
  checks += 1;
  if (passed) {
    console.log(`PASS  ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
}

/**
 * A session shaped like a real one, not a minimal stub.
 *
 * Korean stop names and ISO timestamps are the two things most likely to
 * survive a local test and break over a real REST hop: the timestamps are full
 * of colons, which is exactly the delimiter the version prefix uses, and the
 * names are multi-byte.
 */
function sampleSession(overrides: Partial<StoredJourneySession> = {}): StoredJourneySession {
  const now = Date.now();
  return {
    schemaVersion: JOURNEY_SESSION_SCHEMA_VERSION,
    id: sessionId,
    routeId: "JEB405136521",
    cityCode: "39",
    boardingStopSequence: 1,
    destinationStopSequence: 5,
    directionCode: "1",
    stops: [
      { stopId: "S1", name: "제주대학교", sequence: 1, latitude: 33.4, longitude: 126.5 },
      { stopId: "S5", name: "제주한라대학교(종점)", sequence: 5, latitude: 33.5, longitude: 126.6 },
    ],
    boardingStop: { stopId: "S1", name: "제주대학교", sequence: 1, latitude: 33.4, longitude: 126.5 },
    destinationStop: { stopId: "S5", name: "제주한라대학교(종점)", sequence: 5, latitude: 33.5, longitude: 126.6 },
    matchConfidence: "unknown",
    createdAtMs: now,
    updatedAtMs: now,
    expiresAtMs: now + SESSION_TTL_MS,
    cadenceHistory: [
      ["SYNTHETIC-BUS-1", [{
        vehicleId: "SYNTHETIC-BUS-1",
        routeId: "JEB405136521",
        observedAt: new Date(0).toISOString(),
        receivedAt: new Date(now).toISOString(),
        timestampSource: "unavailable",
        stopSequence: 2,
      }]],
    ],
    consecutiveProviderFailures: 0,
    ...overrides,
  };
}

/**
 * A raw command, so the checks can inspect what the store actually wrote
 * rather than trusting the store's own decoder to tell them.
 */
async function raw(command: string[]): Promise<unknown> {
  const response = await fetch(resolved.restUrl.replace(/\/+$/, ""), {
    method: "POST",
    headers: {
      authorization: `Bearer ${resolved.restToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`the database rejected ${command[0]} with status ${response.status}`);
  const payload = await response.json() as { result?: unknown; error?: unknown };
  if (payload.error) throw new Error(`the database reported an error running ${command[0]}`);
  return payload.result;
}

console.log(`Verifying the Upstash journey-session store against key ${key}\n`);

try {
  /* 1 ---------------------------------------------------- create with SET NX */
  const created = await store.create(sampleSession());
  check("create stores a new session and reports version 1",
    created.outcome === "saved" && created.version === 1,
    `got ${JSON.stringify(created)}`);

  /* 2 ------------------------------------------- the stored value's shape */
  const storedRaw = await raw(["GET", key]);
  check("the stored value carries a numeric version prefix",
    typeof storedRaw === "string" && /^1:\{/.test(storedRaw),
    typeof storedRaw === "string" ? `starts with ${storedRaw.slice(0, 12)}…` : `got ${typeof storedRaw}`);

  /* 3 ------------------------------------------------------------ real TTL */
  const pttl = Number(await raw(["PTTL", key]));
  // -1 means no expiry and -2 means no key; either would mean an abandoned
  // session lives in the database forever.
  check("the key has a real TTL past the session's own expiry",
    pttl > SESSION_TTL_MS && pttl <= SESSION_TTL_MS + 6 * 60_000,
    `PTTL returned ${pttl}`);

  /* 4 ----------------------------------------- byte-for-byte round trip */
  const original = sampleSession();
  const loaded = await store.load(sessionId);
  check("a loaded session matches what was written, Korean names and all",
    loaded !== undefined
      && loaded.version === 1
      && loaded.session.stops[1]?.name === "제주한라대학교(종점)"
      && loaded.session.cadenceHistory[0]?.[1]?.[0]?.observedAt === original.cadenceHistory[0]![1]![0]!.observedAt,
    `got ${loaded ? JSON.stringify(loaded.session.stops[1]) : "undefined"}`);

  /* 5 ------------------------------------------------- NX refuses a second create */
  const duplicate = await store.create(sampleSession({ selectedVehicleId: "SHOULD-NOT-LAND" }));
  const afterDuplicate = await store.load(sessionId);
  check("a second create conflicts instead of overwriting",
    duplicate.outcome === "conflict" && afterDuplicate?.session.selectedVehicleId === undefined,
    `got ${JSON.stringify(duplicate.outcome)}, stored selectedVehicleId ${afterDuplicate?.session.selectedVehicleId}`);

  /* 6 ------------------------------------------------ compare-and-set wins */
  const won = await store.save(sampleSession({ selectedVehicleId: "WINNER" }), 1);
  check("a compare-and-set at the current version wins and increments it",
    won.outcome === "saved" && won.version === 2,
    `got ${JSON.stringify(won)}`);

  const afterWin = await raw(["GET", key]);
  check("the stored version prefix advanced to 2",
    typeof afterWin === "string" && afterWin.startsWith("2:"),
    typeof afterWin === "string" ? `starts with ${afterWin.slice(0, 12)}…` : `got ${typeof afterWin}`);

  /* 7 ------------------------- compare-and-set loses and returns the winner */
  // The single most important check here. It exercises the Lua `string.match`
  // against a real interpreter and the nested-table return path, which is what
  // lets a losing writer answer with real stored state instead of its own.
  const lost = await store.save(sampleSession({ selectedVehicleId: "LOSER" }), 1);
  check("a stale compare-and-set loses",
    lost.outcome === "conflict",
    `got ${JSON.stringify(lost.outcome)}`);
  check("the loser is handed the winner's row, decoded",
    lost.outcome === "conflict"
      && lost.stored?.version === 2
      && lost.stored.session.selectedVehicleId === "WINNER",
    `got ${lost.outcome === "conflict" ? JSON.stringify({ version: lost.stored?.version, selected: lost.stored?.session.selectedVehicleId }) : "saved"}`);

  const afterLoss = await store.load(sessionId);
  check("the losing write did not reach the database",
    afterLoss?.session.selectedVehicleId === "WINNER" && afterLoss.version === 2,
    `stored selectedVehicleId ${afterLoss?.session.selectedVehicleId} at version ${afterLoss?.version}`);

  /* 8 -------------------------------------------- concurrent writers, for real */
  // Eight writers all holding version 2. Exactly one may land. This is the
  // invariant the design exists for: without it two instances lose each other's
  // updates and a rider walks backward along the route.
  const racers = await Promise.all(
    Array.from({ length: CONCURRENT_WRITERS }, (_, index) =>
      store.save(sampleSession({ selectedVehicleId: `RACER-${index}` }), 2)),
  );
  const winners = racers.filter((outcome) => outcome.outcome === "saved");
  check(`exactly one of ${CONCURRENT_WRITERS} concurrent writers at one version wins`,
    winners.length === 1,
    `${winners.length} writers reported success`);

  const afterRace = await store.load(sessionId);
  check("the database holds exactly one racer's value at version 3",
    afterRace?.version === 3 && /^RACER-\d$/.test(afterRace.session.selectedVehicleId ?? ""),
    `stored ${afterRace?.session.selectedVehicleId} at version ${afterRace?.version}`);

  /* 9 ------------------------------------------ an already expired session */
  // PX must stay positive or the server rejects the write, and a session that
  // cannot be written reads as 404 instead of the 410 it deserves.
  const expiredId = `${sessionId}-expired`;
  const expired = await store.create(sampleSession({ id: expiredId, expiresAtMs: Date.now() - 600_000 }));
  check("an already expired session is still storable",
    expired.outcome === "saved",
    `got ${JSON.stringify(expired.outcome)}`);
  await store.delete(expiredId);

  /* 10 ------------------------------------------------- delete, then CAS */
  await store.delete(sessionId);
  const gone = await store.load(sessionId);
  check("delete removes the key", gone === undefined, `got ${gone ? "a session" : "undefined"}`);

  const orphan = await store.save(sampleSession(), 3);
  check("a compare-and-set against a missing key conflicts with nothing stored",
    orphan.outcome === "conflict" && orphan.stored === undefined,
    `got ${JSON.stringify(orphan.outcome)}`);
} catch (error) {
  failures += 1;
  console.error(`FAIL  the verification threw: ${error instanceof Error ? error.message : "unknown error"}`);
} finally {
  // Leave nothing behind, including after a thrown check.
  await store.delete(sessionId).catch(() => {});
  await store.delete(`${sessionId}-expired`).catch(() => {});
  // The orphan CAS above cannot create a key, but a partially applied run might
  // have, so this is unconditional rather than conditional on which step failed.
  await raw(["DEL", key]).catch(() => {});
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) {
  console.error([
    "",
    "The store is NOT verified against this database. Leave",
    "UNVERIFIED_AGAINST_LIVE_SERVICE in place in services/api/src/upstashSessionStore.ts",
    "and docs/KNOWN_ISSUES.md, and do not set TRANSIT_SESSION_STORE=redis anywhere.",
  ].join("\n"));
  process.exit(1);
}

console.log([
  "",
  "The store behaves correctly against this database.",
  "",
  "Milestone 6 is not closed by this alone. Still to do, on a PREVIEW deployment:",
  "  1. Set TRANSIT_SESSION_STORE=redis plus the two UPSTASH_* variables there.",
  "  2. POST /v1/sessions, GET it twice, POST its /confirm.",
  "  3. Confirm the row exists under tapso:journey-session:<id> and that the",
  "     version prefix advanced across the two refreshes.",
  "Then record the result in docs/exec-plans/DURABLE_JOURNEY_SESSIONS.md and drop",
  "the UNVERIFIED_AGAINST_LIVE_SERVICE label from the module and KNOWN_ISSUES.md.",
  "",
  "Production stays on the memory store until that record exists.",
].join("\n"));

async function warnOnLooseEnvPermissions(): Promise<void> {
  try {
    const info = await stat(path.resolve(process.cwd(), ".env.local"));
    if (info.mode & 0o077) {
      console.error(`[${new Date().toISOString()}] .env.local is readable by other users; run: chmod 600 .env.local`);
    }
  } catch {
    // No local env file: the credentials came from the shell, or there are none.
  }
}
