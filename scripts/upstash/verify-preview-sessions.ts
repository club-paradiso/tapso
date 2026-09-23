/**
 * Milestone 6, step 2: the deployment half of the live verification.
 *
 * `verify-session-store.ts` proves the store against a real database. This
 * script proves the deployed service uses it correctly: it drives a PREVIEW
 * deployment of `services/api` through one real session and, after every
 * request, reads the exact Redis key that session must live at.
 *
 *   1. POST /v1/sessions                       → row at version 1
 *   2. GET  /v1/sessions/<id>, twice           → version 2, then 3
 *   3. POST /v1/sessions/<id>/confirm          → version 4, explicit selection
 *   4. the row exists under the preview namespace and under no other
 *   5. the version prefix advanced by exactly one per request
 *   6. the database gained exactly one key during the run
 *
 * Safety.
 *  - Refuses to run unless `/health` reports a preview build with the redis
 *    store, sessions enabled, and automatic matching off. It cannot be pointed
 *    at production by mistake.
 *  - Reads Redis only by exact key (`GET`, `PTTL`, `EXISTS`) and `DBSIZE`,
 *    which is a count. It never lists, scans or flushes, so no unrelated key
 *    in a shared database is ever read, let alone modified.
 *  - The only key it deletes is the one session it created, by exact name.
 *  - Never prints the Upstash token or host, or a deployment-protection secret.
 *
 * Usage (from a machine that holds the credentials in .env.local):
 *   env -u UPSTASH_REDIS_REST_TOKEN node --env-file=.env.local \
 *     --experimental-strip-types scripts/upstash/verify-preview-sessions.ts \
 *     --base-url=https://<tapso-api preview host> \
 *     --route=<TAGO routeId> --board=<stop sequence> --dest=<later stop sequence> --yes
 *
 *   Optional: --city=39 (default), --direction=<code>,
 *   --prefix=<namespace> (default tapso:preview:journey-session:).
 *   If the preview is behind Vercel Deployment Protection, put its automation
 *   bypass secret in VERCEL_AUTOMATION_BYPASS_SECRET; it is sent as the
 *   `x-vercel-protection-bypass` header and never printed.
 *
 * Step 3 needs a vehicle currently running on the route, because the service
 * only accepts a confirmation against a live TAGO snapshot. Pick a route and
 * a time with a bus on it.
 */

import { readUpstashCredentials } from "../../services/api/src/apiConfig.ts";
import {
  DEFAULT_SESSION_KEY_PREFIX,
  VERIFY_SESSION_KEY_PREFIX,
  validateSessionKeyPrefix,
} from "../../services/api/src/sessionKeyPrefix.ts";

const PREVIEW_PREFIX = "tapso:preview:journey-session:";
/** Namespaces this run's session id must NOT appear under. */
const OTHER_PREFIXES = [DEFAULT_SESSION_KEY_PREFIX, "tapso:prod:journey-session:", VERIFY_SESSION_KEY_PREFIX];

const args = new Map(
  process.argv.slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => [arg.slice(2, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] as const),
);

if (!process.argv.includes("--yes") || !args.get("base-url") || !args.get("route")
  || !args.get("board") || !args.get("dest")) {
  console.error([
    "Usage: node --experimental-strip-types scripts/upstash/verify-preview-sessions.ts \\",
    "  --base-url=https://<tapso-api preview host> --route=<routeId> \\",
    "  --board=<stop sequence> --dest=<later stop sequence> [--city=39] [--direction=<code>] --yes",
    "",
    "Creates one journey session on a PREVIEW deployment, reads its Redis row by",
    "exact key after each request, and deletes that one key at the end. Refuses",
    "to run against anything /health does not report as a preview redis build.",
  ].join("\n"));
  process.exit(2);
}

let baseUrl: URL;
let prefix: string;
let credentials: { restUrl: string; restToken: string } | undefined;
try {
  baseUrl = new URL(args.get("base-url")!);
  if (baseUrl.protocol !== "https:") throw new RangeError("--base-url must be an https URL");
  prefix = validateSessionKeyPrefix(args.get("prefix") ?? PREVIEW_PREFIX, "--prefix");
  if (prefix === DEFAULT_SESSION_KEY_PREFIX || prefix === VERIFY_SESSION_KEY_PREFIX) {
    throw new RangeError("--prefix must be the preview deployment's own namespace");
  }
  credentials = readUpstashCredentials(process.env);
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : "invalid arguments"}`);
  process.exit(1);
}
if (!credentials) {
  console.error("FAIL  UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are both required");
  process.exit(1);
}
const upstash = credentials;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();

let checks = 0;
let failures = 0;
function check(name: string, passed: boolean, detail?: string): boolean {
  checks += 1;
  if (passed) console.log(`PASS  ${name}`);
  else {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
  }
  return passed;
}

/** Exact-key and count commands only. Anything else is refused here. */
const ALLOWED_COMMANDS = new Set(["GET", "PTTL", "EXISTS", "DBSIZE", "DEL"]);
async function redis(command: string[]): Promise<unknown> {
  if (!ALLOWED_COMMANDS.has(command[0]!)) throw new Error(`refusing to send ${command[0]}`);
  const response = await fetch(upstash.restUrl.replace(/\/+$/, ""), {
    method: "POST",
    headers: { authorization: `Bearer ${upstash.restToken}`, "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`the database rejected ${command[0]} with status ${response.status}`);
  const payload = await response.json() as { result?: unknown; error?: unknown };
  if (payload.error) throw new Error(`the database reported an error running ${command[0]}`);
  return payload.result;
}

async function api(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
  });
  const text = await response.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: response.status, json };
}

/** The version prefix of a stored row, or undefined when there is no row. */
async function storedVersion(key: string): Promise<{ version?: number; row?: any }> {
  const raw = await redis(["GET", key]);
  if (typeof raw !== "string") return {};
  const separator = raw.indexOf(":");
  const version = Number(raw.slice(0, separator));
  let row: unknown;
  try { row = JSON.parse(raw.slice(separator + 1)); } catch { row = undefined; }
  return { version: Number.isSafeInteger(version) ? version : undefined, row };
}

console.log(`Verifying preview sessions at ${baseUrl.origin} under ${prefix}<id>\n`);

/* 0 ------------------------------------------------ refuse anything but preview */
const health = await api("GET", "/health");
const posture = health.json ?? {};
const safe = check("/health reports a preview build on the redis store, sessions on, automatic matching off",
  health.status === 200
    && posture.build?.environment === "preview"
    && posture.sessions?.store === "redis"
    && posture.sessions?.enabled === true
    && posture.matching?.automaticMatchingEnabled === false,
  `status ${health.status}, environment ${posture.build?.environment}, store ${posture.sessions?.store}, `
    + `sessions ${posture.sessions?.enabled}, automatic ${posture.matching?.automaticMatchingEnabled}`);
if (!safe) {
  console.error([
    "",
    "Stopped before writing anything. A 401/403 here usually means Deployment Protection:",
    "set VERCEL_AUTOMATION_BYPASS_SECRET. Otherwise fix the preview environment variables.",
  ].join("\n"));
  process.exit(1);
}

let sessionKey: string | undefined;
try {
  const sizeBefore = Number(await redis(["DBSIZE"]));

  /* 1 ---------------------------------------------------------------- create */
  const createBody: Record<string, unknown> = {
    routeId: args.get("route"),
    cityCode: args.get("city") ?? "39",
    boardingStopSequence: Number(args.get("board")),
    destinationStopSequence: Number(args.get("dest")),
    ...(args.get("direction") ? { directionCode: args.get("direction") } : {}),
  };
  const created = await api("POST", "/v1/sessions", createBody);
  const id: unknown = created.json?.id;
  if (!check("POST /v1/sessions creates a session", created.status === 201 && typeof id === "string",
    `status ${created.status}, error ${JSON.stringify(created.json?.error ?? created.json?.code ?? null)}`)) {
    throw new Error("no session to follow");
  }
  const sessionId = id as string;
  sessionKey = `${prefix}${sessionId}`;
  console.log(`      session ${sessionId}`);

  const v1 = await storedVersion(sessionKey);
  check("the row exists under the preview namespace at version 1", v1.version === 1, `version ${v1.version}`);
  const pttl = Number(await redis(["PTTL", sessionKey]));
  check("the row has a real TTL", pttl > 0, `PTTL ${pttl}`);

  /* 2 ---------------------------------------------------------- two refreshes */
  const versions = [v1.version];
  let latest = created;
  for (const round of [1, 2]) {
    latest = await api("GET", `/v1/sessions/${encodeURIComponent(sessionId)}`);
    check(`GET /v1/sessions/<id> #${round} answers 200`, latest.status === 200, `status ${latest.status}`);
    versions.push((await storedVersion(sessionKey)).version);
  }

  /* 3 ---------------------------------------------------------------- confirm */
  // The rider confirms what the last refresh showed them.
  const vehicleId: unknown = latest.json?.candidates?.[0]?.vehicleId;
  if (check("a live vehicle is on the route to confirm", typeof vehicleId === "string",
    "no candidates in the current snapshot; re-run when a bus is running on this route")) {
    const confirmed = await api("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/confirm`, { vehicleId });
    check("POST /v1/sessions/<id>/confirm answers 200 with an explicit selection",
      confirmed.status === 200 && confirmed.json?.selectedVehicleId === vehicleId
        && confirmed.json?.selectionMode === "explicit",
      `status ${confirmed.status}, selected ${confirmed.json?.selectedVehicleId}`);
    const afterConfirm = await storedVersion(sessionKey);
    versions.push(afterConfirm.version);
    check("the stored row carries the confirmed vehicle",
      afterConfirm.row?.selectedVehicleId === vehicleId && afterConfirm.row?.selectionMode === "explicit",
      `stored ${afterConfirm.row?.selectedVehicleId} / ${afterConfirm.row?.selectionMode}`);
  }

  /* 5 ------------------------------------------------ version advanced per request */
  const expected = versions.map((_, index) => index + 1);
  check("the version prefix advanced by exactly one per request",
    JSON.stringify(versions) === JSON.stringify(expected),
    `observed ${versions.join(" → ")}, expected ${expected.join(" → ")}`);

  /* 4 ------------------------------------------- only under the preview namespace */
  const elsewhere: string[] = [];
  for (const other of OTHER_PREFIXES) {
    if (Number(await redis(["EXISTS", `${other}${sessionId}`])) !== 0) elsewhere.push(other);
  }
  if (Number(await redis(["EXISTS", sessionId])) !== 0) elsewhere.push("(unprefixed)");
  check("the session exists under no other namespace", elsewhere.length === 0, `also found under ${elsewhere.join(", ")}`);

  /* 6 -------------------------------------------------- nothing else was written */
  const sizeAfter = Number(await redis(["DBSIZE"]));
  check("the database gained exactly one key during the run", sizeAfter - sizeBefore === 1,
    `DBSIZE ${sizeBefore} → ${sizeAfter}. Another application writing to the same database `
      + "at the same moment also moves this count; if so, re-run at a quiet time.");
} catch (error) {
  failures += 1;
  console.error(`FAIL  the verification stopped: ${error instanceof Error ? error.message : "unknown error"}`);
} finally {
  // The one key this run created, by exact name. Nothing else is ever deleted.
  if (sessionKey) await redis(["DEL", sessionKey]).catch(() => {});
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error("\nThe preview half of milestone 6 is NOT verified. Keep UNVERIFIED_AGAINST_LIVE_SERVICE.");
  process.exit(1);
}
console.log("\nThe preview deployment stores sessions correctly. Record this output in docs/exec-plans/DURABLE_JOURNEY_SESSIONS.md.");
