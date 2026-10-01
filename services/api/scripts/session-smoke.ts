/**
 * Journey-session lifecycle smoke test for a deployed TAPSO transit API.
 *
 * Where `smoke.ts` never writes, this one does, exactly once: it creates one
 * short-lived ride session, reads it back across several requests (and
 * several at once), confirms a bus the way a rider would, ends the session
 * with `DELETE`, and checks that it is gone. Against a durable deployment that
 * is the observable proof that a ride survives the request that created it.
 *
 * Production-safe by construction:
 *  - it only runs where `/health` says sessions are enabled and automatic
 *    matching is off, and on a production deployment only from the durable
 *    store's production namespace;
 *  - it touches only its own session, through the public API, and deletes it
 *    even when a check fails; it never reaches Redis directly;
 *  - its few provider reads are the same ones one rider would cause;
 *  - it prints no vehicle number: buses appear as their last four digits.
 *
 *   node --experimental-strip-types scripts/session-smoke.ts https://<api-host> \
 *     [--city 39] [--route-numbers 365,202,201] [--interval-ms 6000] [--require-enabled]
 *
 * Exit codes: 0 every check passed (or sessions are disabled and
 * `--require-enabled` was not given); 1 a check failed; 2 usage; 3 sessions
 * are disabled and `--require-enabled` was given.
 */

type Outcome = "PASS" | "WARN" | "FAIL" | "SKIP";
type Check = { name: string; outcome: Outcome; detail: string };
type Reply = { status: number; text: string; body: Record<string, unknown> | undefined };

const args = process.argv.slice(2);
const base = args[0];
if (!base || base.startsWith("-")) {
  console.error("Usage: node --experimental-strip-types scripts/session-smoke.ts <base-url> [--city 39] [--route-numbers 365,202] [--interval-ms 6000] [--require-enabled]");
  process.exit(2);
}
const baseUrl = base.replace(/\/+$/, "");
const cityCode = option("--city") ?? "39";
const routeNumbers = (option("--route-numbers") ?? "365,202,201,281,282,101,102").split(",").map((value) => value.trim()).filter(Boolean);
const intervalMs = Number(option("--interval-ms") ?? "6000");
const requireEnabled = args.includes("--require-enabled");
if (!Number.isFinite(intervalMs) || intervalMs < 0) {
  console.error("--interval-ms must be a non-negative number");
  process.exit(2);
}

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const STATES = new Set(["awaiting_match", "confirmation_required", "tracking", "degraded", "arrived", "passed_destination", "lost"]);
const checks: Check[] = [];
let createdId: string | undefined;
let ended = false;

try {
  await run();
} catch (error) {
  record("unexpected error", fail(error instanceof Error ? error.message : String(error)));
} finally {
  if (createdId && !ended) {
    // A failed check never leaves a ride behind.
    const cleanup = await send("DELETE", `/v1/sessions/${encodeURIComponent(createdId)}`).catch(() => undefined);
    record("cleanup", cleanup && (cleanup.status === 204 || cleanup.status === 404)
      ? pass(`session deleted after an earlier failure (${cleanup.status})`)
      : fail(`could not delete the smoke session; it expires on its own TTL (status ${cleanup?.status ?? "no response"})`));
  }
}
report();

async function run(): Promise<void> {
  const health = await get("/health");
  if (health.status !== 200 || !health.body) {
    record("health", fail(`status ${health.status}`));
    return;
  }
  const sessions = (health.body.sessions ?? {}) as Record<string, unknown>;
  const matching = (health.body.matching ?? {}) as Record<string, unknown>;
  const build = (health.body.build ?? {}) as Record<string, unknown>;
  if (sessions.enabled !== true) {
    const why = typeof sessions.problem === "string" ? sessions.problem : `store ${String(sessions.store)}`;
    record("sessions enabled", { outcome: requireEnabled ? "FAIL" : "SKIP", detail: `sessions are disabled on this deployment (${why})` });
    if (requireEnabled) process.exitCode = 3;
    return;
  }
  if (matching.automaticMatchingEnabled !== false) {
    record("shadow posture", fail("automatic matching is not off; this smoke only runs against shadow deployments"));
    return;
  }
  if (build.environment === "production" && (sessions.store !== "redis" || sessions.namespace !== "production")) {
    record("production store", fail(`production serves sessions from store ${String(sessions.store)}, namespace ${String(sessions.namespace)}`));
    return;
  }
  record("preconditions", pass(`sessions enabled, store ${String(sessions.store)}${sessions.namespace ? ` (${String(sessions.namespace)} namespace)` : ""}, `
    + `automatic matching off, build ${String(build.commit ?? "unknown")} (${String(build.environment ?? "local")})`));

  const plan = await choosePlan();
  if (!plan) {
    record("route", fail(`no official route variant answered for route numbers ${routeNumbers.join(", ")}`));
    return;
  }
  record("route", plan.vehicles > 0
    ? pass(`route ${plan.routeNumber} (${plan.routeId}), boarding ${plan.boarding}, destination ${plan.destination}, ${plan.vehicles} bus(es) reporting`)
    : { outcome: "WARN", detail: `route ${plan.routeNumber} (${plan.routeId}) has no bus reporting; the confirm step will be skipped` });

  /* ---------------------------------------------------------------- create */
  const created = await send("POST", "/v1/sessions", JSON.stringify({
    routeId: plan.routeId,
    cityCode,
    boardingStopSequence: plan.boarding,
    destinationStopSequence: plan.destination,
  }));
  if (created.status !== 201 || !created.body) {
    record("create", fail(`status ${created.status} ${preview(created.text)}`));
    return;
  }
  const id = String(created.body.id ?? "");
  if (SESSION_ID.test(id)) createdId = id;
  const lifetimeMs = Date.parse(String(created.body.expiresAt)) - Date.parse(String(created.body.createdAt));
  record("create", SESSION_ID.test(id) && STATES.has(String(created.body.state)) && created.body.matchingMode === "shadow"
      && created.body.selectedVehicleId === undefined && created.body.routeId === plan.routeId
      && lifetimeMs > 60 * 60 * 1_000 && lifetimeMs <= 12 * 60 * 60 * 1_000
    ? pass(`201, state ${String(created.body.state)}, shadow, nothing selected, lifetime ${Math.round(lifetimeMs / 60_000)} min`)
    : fail(`unexpected session ${preview(created.text)}`));
  if (!createdId) return;
  const path = `/v1/sessions/${encodeURIComponent(createdId)}`;

  /* ------------------------------------------------- reads across requests */
  let latest = created.body;
  let previousUpdatedAt = Date.parse(String(created.body.updatedAt));
  const readProblems: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    await sleep(intervalMs);
    const read = await get(path);
    if (read.status !== 200 || !read.body) {
      readProblems.push(`read ${index + 1}: status ${read.status} ${preview(read.text)}`);
      continue;
    }
    const updatedAt = Date.parse(String(read.body.updatedAt));
    if (read.body.id !== createdId) readProblems.push(`read ${index + 1}: another session answered`);
    if (!STATES.has(String(read.body.state))) readProblems.push(`read ${index + 1}: unknown state ${String(read.body.state)}`);
    if (read.body.selectedVehicleId !== undefined) readProblems.push(`read ${index + 1}: a bus was selected without a rider confirming it`);
    if (updatedAt < previousUpdatedAt) readProblems.push(`read ${index + 1}: updatedAt went backward`);
    previousUpdatedAt = Math.max(previousUpdatedAt, updatedAt);
    latest = read.body;
  }
  record("reads persist", readProblems.length === 0
    ? pass(`3 reads ${intervalMs} ms apart returned the same session, never selected, time moving forward`)
    : fail(readProblems.join("; ")));

  /* ------------------------------------------------------ concurrent reads */
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => get(path)));
  const statuses = concurrent.map((reply) => reply.status);
  record("concurrent reads", statuses.every((status) => status === 200)
      && concurrent.every((reply) => reply.body?.id === createdId && reply.body?.selectedVehicleId === undefined)
    ? pass("4 simultaneous reads all answered 200 with the same unselected session")
    : fail(`statuses ${statuses.join(", ")}`));

  /* --------------------------------------------------------------- confirm */
  const candidates = Array.isArray(latest.candidates) ? latest.candidates as Array<Record<string, unknown>> : [];
  const chosen = typeof candidates[0]?.vehicleId === "string" ? candidates[0].vehicleId as string : undefined;
  if (!chosen) {
    record("confirm", { outcome: "WARN", detail: "no bus was offered for confirmation at this moment; the confirm path was not exercised" });
  } else {
    const confirmed = await send("POST", `${path}/confirm`, JSON.stringify({ vehicleId: chosen }));
    if (confirmed.status === 400) {
      record("confirm", { outcome: "WARN", detail: `the offered bus ${mask(chosen)} left the snapshot before the tap (${preview(String(confirmed.body?.message ?? ""))})` });
    } else {
      const persisted = confirmed.status === 200 ? await get(path) : undefined;
      record("confirm", confirmed.status === 200 && confirmed.body?.selectionMode === "explicit" && confirmed.body?.selectedVehicleId === chosen
          && persisted?.status === 200 && persisted.body?.selectionMode === "explicit" && persisted.body?.selectedVehicleId === chosen
        ? pass(`rider confirmation of ${mask(chosen)} was stored and read back by a later request (state ${String(persisted?.body?.state)})`)
        : fail(`confirm ${confirmed.status}, read-back ${persisted?.status ?? "not attempted"} ${preview(persisted?.text ?? confirmed.text)}`));
    }
  }

  /* ------------------------------------------------------------------- end */
  const end = await send("DELETE", path);
  if (end.status === 204) ended = true;
  const gone = await get(path);
  const again = await send("DELETE", path);
  record("end", end.status === 204 && gone.status === 404 && gone.body?.error === "SESSION_NOT_FOUND" && again.status === 404
    ? pass("DELETE 204, then the session reads 404 and a second DELETE is 404")
    : fail(`DELETE ${end.status}, read ${gone.status}, second DELETE ${again.status}`));

  /* ----------------------------------------------------------- not founds */
  const unknown = await get("/v1/sessions/00000000-0000-4000-8000-000000000000");
  const malformed = await get("/v1/sessions/not%20a%20session");
  record("unknown and malformed ids", unknown.status === 404 && malformed.status === 400
    ? pass("unknown id 404, malformed id 400")
    : fail(`unknown ${unknown.status}, malformed ${malformed.status}`));
}

/**
 * The first route number with an official variant, preferring a variant with
 * a bus reporting before a stop that leaves three more after it: the boarding
 * stop goes one ahead of that bus, so the rider has a bus to confirm.
 */
async function choosePlan(): Promise<{ routeNumber: string; routeId: string; boarding: number; destination: number; vehicles: number } | undefined> {
  let fallback: { routeNumber: string; routeId: string; boarding: number; destination: number; vehicles: number } | undefined;
  for (const routeNumber of routeNumbers) {
    const routes = await get(`/v1/routes?cityCode=${encodeURIComponent(cityCode)}&routeNo=${encodeURIComponent(routeNumber)}`);
    const variants = asArray(routes.body?.items).map((item) => (item as Record<string, unknown>).routeId).filter((value): value is string => typeof value === "string");
    for (const routeId of variants) {
      const query = `routeId=${encodeURIComponent(routeId)}&cityCode=${encodeURIComponent(cityCode)}`;
      const stops = asArray((await get(`/v1/stops?${query}`)).body?.items)
        .map((stop) => (stop as Record<string, unknown>).sequence)
        .filter((value): value is number => typeof value === "number")
        .sort((left, right) => left - right);
      if (stops.length < 5) continue;
      const last = stops[stops.length - 1]!;
      const vehicles = asArray((await get(`/v1/vehicles?${query}`)).body?.items)
        .map((vehicle) => (vehicle as Record<string, unknown>).stopSequence)
        .filter((value): value is number => typeof value === "number");
      const lead = vehicles.filter((sequence) => sequence + 4 <= last).sort((left, right) => left - right)[0];
      if (lead !== undefined) {
        return { routeNumber, routeId, boarding: lead + 1, destination: lead + 4, vehicles: vehicles.length };
      }
      fallback ??= { routeNumber, routeId, boarding: stops[1]!, destination: stops[4]!, vehicles: vehicles.length };
    }
  }
  return fallback;
}

async function get(path: string): Promise<Reply> {
  return send("GET", path);
}

async function send(method: string, path: string, body?: string): Promise<Reply> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> | undefined;
  try {
    const value: unknown = text ? JSON.parse(text) : undefined;
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    parsed = undefined;
  }
  return { status: response.status, text, body: parsed };
}

/** The digits a rider reads off the bus, never the whole registration. */
function mask(vehicleId: string): string {
  const digits = vehicleId.replace(/\D/g, "");
  return digits.length >= 2 ? `••${digits.slice(-4)}` : "••••";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pass(detail: string): Omit<Check, "name"> {
  return { outcome: "PASS", detail };
}

function fail(detail: string): Omit<Check, "name"> {
  return { outcome: "FAIL", detail };
}

function record(name: string, result: Omit<Check, "name">): void {
  checks.push({ name, ...result });
}

/** Responses are previewed with every run of four or more digits masked, so no vehicle number is printed. */
function preview(text: string): string {
  const masked = text.replace(/\d{4,}/g, (digits) => `••${digits.slice(-4)}`);
  return masked.length > 160 ? `${masked.slice(0, 160)}…` : masked;
}

function option(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function report(): void {
  const width = Math.max(...checks.map((check) => check.name.length));
  for (const check of checks) console.log(`${check.outcome.padEnd(5)} ${check.name.padEnd(width)}  ${check.detail}`);
  const failed = checks.filter((check) => check.outcome === "FAIL").length;
  const warned = checks.filter((check) => check.outcome === "WARN").length;
  const skipped = checks.filter((check) => check.outcome === "SKIP").length;
  console.log(`\n${checks.length - failed - warned - skipped} passed, ${warned} warned, ${skipped} skipped, ${failed} failed — ${baseUrl}`);
  // Exit 3 (disabled where they were required) is kept: it is the more specific answer.
  if (failed > 0 && process.exitCode !== 3) process.exitCode = 1;
}
