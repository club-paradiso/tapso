/**
 * Reproducible smoke test for a deployed TAPSO transit API.
 *
 * It checks response semantics, not just status codes: city identity, preserved
 * route variants, monotonic direction-specific stop order, and honest vehicle
 * timestamp semantics. A missing credential is reported as
 * `BLOCKED_BY_CREDENTIALS`, never converted into a pass.
 *
 * It never writes to the deployment it checks: the one request that could
 * create state (`POST /v1/sessions`) carries an input the API rejects before
 * any provider read or store write, which is enough to learn whether sessions
 * are enabled. The scheduled production smoke relies on that.
 *
 *   node --experimental-strip-types scripts/smoke.ts https://<api-host>
 *   node --experimental-strip-types scripts/smoke.ts http://127.0.0.1:8787 \
 *     --city 39 --route-no 365 --route-id JEB405136521
 */

type Outcome = "PASS" | "WARN" | "FAIL" | "BLOCKED_BY_CREDENTIALS";

type Check = {
  name: string;
  outcome: Outcome;
  detail: string;
};

const args = process.argv.slice(2);
const base = args[0];
if (!base || base.startsWith("-")) {
  console.error("Usage: node --experimental-strip-types scripts/smoke.ts <base-url> [--city 39] [--route-no 365] [--route-id JEB405136521]");
  process.exit(2);
}
const baseUrl = base.replace(/\/+$/, "");
const cityCode = option("--city") ?? "39";
const routeNumber = option("--route-no") ?? "365";
const routeId = option("--route-id") ?? "JEB405136521";

const checks: Check[] = [];

await run();
report();

async function run(): Promise<void> {
  const health = await get("/health");
  const build = (health.body?.build ?? {}) as Record<string, unknown>;
  record("health", health.status === 200 && health.body?.ok === true && health.body?.transitProvider === "tago"
    ? pass(`status 200, provider ${String(health.body?.transitProvider)}, live=${String(health.body?.liveTransitConfigured)}`
      + `, build ${String(build.commit ?? "unknown")} (${String(build.environment ?? "no deployment environment")})`)
    : fail(`status ${health.status} body ${preview(health.text)}`));

  record("health hides credentials", /serviceKey|TAGO_SERVICE_KEY|PUBLIC_DATA_SERVICE_KEY|RIDE_CAPTURE_OPERATOR_TOKEN|"key"|"token"/i.test(health.text)
    ? fail("health payload names a credential variable or field")
    : pass("no credential name or value in payload"));

  const credential = (health.body?.credential ?? {}) as Record<string, unknown>;
  record("credential source", describeCredentialSource(credential));

  record("matching posture", describeMatchingPosture(health.body?.matching as Record<string, unknown> | undefined));

  const credentialed = health.body?.liveTransitConfigured === true;

  const cities = await get("/v1/cities");
  record("cities", evaluateUpstream(cities, () => {
    const items = asArray(cities.body?.items);
    if (!items.length) return fail("no city rows");
    const sample = items[0] as Record<string, unknown>;
    if (typeof sample.cityCode !== "string" || typeof sample.name !== "string") return fail("unexpected city schema");
    const jeju = items.find((item) => (item as Record<string, unknown>).cityCode === cityCode);
    return pass(`${items.length} cities; cityCode ${cityCode} ${jeju ? "present" : "ABSENT"}`);
  }, credentialed));

  const routes = await get(`/v1/routes?cityCode=${cityCode}&routeNo=${routeNumber}`);
  record("routes", evaluateUpstream(routes, () => {
    const items = asArray(routes.body?.items);
    if (!items.length) return fail("no route rows");
    const ids = items.map((item) => String((item as Record<string, unknown>).routeId));
    if (new Set(ids).size !== ids.length) return fail("duplicate route ids");
    if (ids.length === 1) return fail("route variants look collapsed into one id");
    return pass(`${ids.length} variants preserved: ${ids.join(", ")}`);
  }, credentialed));

  const stops = await get(`/v1/stops?routeId=${routeId}&cityCode=${cityCode}`);
  record("stops", evaluateUpstream(stops, () => {
    const items = asArray(stops.body?.items) as Array<Record<string, unknown>>;
    if (!items.length) return fail("no stop rows");
    let previous = -Infinity;
    for (const stop of items) {
      const sequence = stop.sequence;
      if (typeof sequence !== "number" || !Number.isInteger(sequence)) return fail("stop sequence is not an integer");
      if (sequence <= previous) return fail(`stop sequence is not strictly increasing at ${sequence}`);
      previous = sequence;
      if (typeof stop.stopId !== "string" || typeof stop.name !== "string") return fail("unexpected stop schema");
    }
    return pass(`${items.length} ordered stops, sequence ${items[0]?.sequence}..${previous}`);
  }, credentialed));

  const vehicles = await get(`/v1/vehicles?routeId=${routeId}&cityCode=${cityCode}`);
  record("vehicles", evaluateUpstream(vehicles, () => {
    // The freshness posture is one object, published identically by /health,
    // /v1/vehicles and /operator/snapshot (docs/PRODUCTION_TRANSIT_API.md).
    const freshness = ((vehicles.body?.meta as Record<string, unknown> | undefined)?.freshness ?? {}) as Record<string, unknown>;
    if (freshness.providerObservationTimestamp !== "unavailable") {
      return fail("vehicles meta.freshness does not say the provider observation timestamp is unavailable");
    }
    const items = asArray(vehicles.body?.items) as Array<Record<string, unknown>>;
    for (const vehicle of items) {
      if (vehicle.timestampSource !== "unavailable") return fail("a vehicle claims a provider timestamp source");
      if (vehicle.observedAt !== new Date(0).toISOString()) return fail("observedAt is not the epoch sentinel");
      if (typeof vehicle.receivedAt !== "string") return fail("receivedAt is missing");
      if (vehicle.routeId !== routeId) return fail("vehicle routeId does not match the request");
    }
    const honest = `${items.length} vehicles, timestamps honest (observedAt sentinel, receivedAt present)`;
    const posture = freshness.automaticMatching;
    if (posture === "shadow_only_pending_matching_readiness") return pass(`${honest}; matching ${String(posture)}`);
    if (posture === "shadow_only_pending_field_validation") {
      // Withheld all the same, under the wording before the readiness gate.
      return { outcome: "WARN", detail: `${honest}; deployment predates the readiness gate (${String(posture)})` };
    }
    // "enabled_by_explicit_operator_opt_in" is judged against the demonstrated
    // readiness by the "matching posture" check on /health.
    if (posture === "enabled_by_explicit_operator_opt_in") return pass(`${honest}; matching ${String(posture)}`);
    return fail(`vehicles meta.freshness.automaticMatching is ${JSON.stringify(posture)}`);
  }, credentialed));

  const badCity = await get(`/v1/stops?routeId=${routeId}&cityCode=not-a-city`);
  record("invalid cityCode", badCity.status === 400 ? pass("400") : fail(`status ${badCity.status}`));

  const badRoute = await get(`/v1/stops?routeId=${"x".repeat(200)}&cityCode=${cityCode}`);
  record("invalid routeId", badRoute.status === 400 ? pass("400") : fail(`status ${badRoute.status}`));

  const missing = await get("/v1/vehicles");
  record("missing parameters", missing.status === 400 ? pass("400") : fail(`status ${missing.status}`));

  const legacy = await get(`/v1/stops?stdgCd=${cityCode}&routeId=${routeId}`);
  record("rejects legacy stdgCd", legacy.status === 400 ? pass("400") : fail(`status ${legacy.status}`));

  const unknown = await get("/v1/does-not-exist");
  record("unknown path", unknown.status === 404 ? pass("404") : fail(`status ${unknown.status}`));

  const wrongMethod = await send("POST", "/v1/vehicles", "{}");
  record("wrong method", wrongMethod.status === 405 || wrongMethod.status === 404
    ? pass(String(wrongMethod.status))
    : fail(`status ${wrongMethod.status}`));

  // Write-free on purpose: stop sequence 0 fails input validation before the
  // provider is read or anything is stored, so no journey session is created.
  const session = await send("POST", "/v1/sessions", JSON.stringify({
    routeId,
    cityCode,
    boardingStopSequence: 0,
    destinationStopSequence: 1,
  }));
  record("sessions policy", describeSessionOutcome(session));
  record("session store", describeSessionStore(
    health.body?.sessions as Record<string, unknown> | undefined,
    typeof build.environment === "string" ? build.environment : undefined,
  ));

  // No token is sent, so a 200 here would mean the operator ride-capture path
  // is answering the whole internet with uncached upstream reads. That is the
  // one failure this script can catch without holding any secret at all.
  const operator = await get(`/operator/snapshot?routeId=${encodeURIComponent(routeId)}&cityCode=${encodeURIComponent(cityCode)}`);
  record("operator path is closed", operator.status === 401 || operator.status === 503
    ? pass(`${operator.status} without a token`)
    : fail(`status ${operator.status} without a token — the ride-capture path must never answer unauthenticated`));
}

/**
 * The retired `PUBLIC_` name is ignored on a serverless deployment, so a
 * deployment carrying only that variable answers 503 everywhere. Naming that
 * case explicitly turns a confusing outage into a one-line diagnosis.
 */
function describeCredentialSource(credential: Record<string, unknown>): Omit<Check, "name"> {
  const source = credential.source;
  if (source === "canonical") return pass("TAGO_SERVICE_KEY");
  if (source === "deprecated_local_fallback") {
    // Working, and only reachable off-serverless. Worth saying, not worth failing.
    return { outcome: "WARN", detail: "reading the deprecated PUBLIC_ name; rename it to TAGO_SERVICE_KEY" };
  }
  if (source === "missing") {
    return credential.deprecatedNamePresent === true
      ? fail("the deprecated PUBLIC_ name is set but ignored here; set TAGO_SERVICE_KEY instead")
      : { outcome: "BLOCKED_BY_CREDENTIALS", detail: "no TAGO_SERVICE_KEY is configured on this deployment" };
  }
  return fail(`unexpected credential source ${JSON.stringify(source)}`);
}

/**
 * The posture must match the evidence: automatic selection only when the
 * deployment itself reports a demonstrated readiness that permits it, and the
 * directed matcher serving. A deployment built before the directed matcher has
 * no `matcherPolicy` and is reported as such rather than failed.
 */
function describeMatchingPosture(matching: Record<string, unknown> | undefined): Omit<Check, "name"> {
  if (!matching) return fail("health has no matching block");
  const readiness = (matching.readiness ?? {}) as Record<string, unknown>;
  const demonstrated = typeof readiness.demonstrated === "string" ? readiness.demonstrated : "unreported";
  const automaticPermitted = demonstrated === "READY_FOR_BOUNDED_AUTOMATION" || demonstrated === "READY_FOR_AUTOMATIC_MATCHING";
  if (matching.automaticMatchingEnabled === true && !automaticPermitted) {
    return fail(`automatic matching is on while demonstrated readiness is ${demonstrated}`);
  }
  // What the session coordinator actually runs. A deployment from before this
  // field reports none, which says nothing either way.
  if (matching.sessionMatchingMode === "automatic" && !automaticPermitted) {
    return fail(`journey sessions match automatically while demonstrated readiness is ${demonstrated}`);
  }
  if (matching.matcherPolicy === undefined) {
    return { outcome: "WARN", detail: "deployment predates the directed matcher: /health reports no matcherPolicy" };
  }
  if (matching.matcherPolicy !== "directed-route-progress-v1") {
    return fail(`unexpected matcher policy ${JSON.stringify(matching.matcherPolicy)}`);
  }
  if (matching.automaticMatchingRequested === true && matching.automaticMatchingEnabled !== true) {
    // Safe, because the configuration refused it, but the flag says something
    // the evidence does not: worth an operator's attention, not a failure.
    return {
      outcome: "WARN",
      detail: `TRANSIT_AUTOMATIC_MATCHING_ENABLED=true is set and refused at demonstrated readiness ${demonstrated}`,
    };
  }
  return pass(`${String(matching.mode)}; matcher ${String(matching.matcherPolicy)}; demonstrated readiness ${demonstrated}`);
}

function describeSessionOutcome(result: Awaited<ReturnType<typeof get>>): Omit<Check, "name"> {
  if (result.status === 503 && result.body?.error === "SESSIONS_UNAVAILABLE") {
    return pass("503 SESSIONS_UNAVAILABLE — memory-only sessions correctly disabled");
  }
  if (result.status === 400 && result.body?.error === "INVALID_INPUT") {
    return pass("sessions enabled; the write-free probe was rejected by input validation, nothing created");
  }
  if (result.status === 503 && result.body?.error === "BLOCKED_BY_CREDENTIALS") {
    return { outcome: "BLOCKED_BY_CREDENTIALS", detail: "sessions enabled but no TAGO credential is configured" };
  }
  if (result.status === 201) return fail("a session request with stop sequence 0 was accepted and created a session");
  return fail(`status ${result.status} body ${preview(result.text)}`);
}

/**
 * Where rides live, from `/health` alone. Production and preview share one
 * Upstash database, so a durable production deployment must say it writes to
 * the production namespace; the API refuses any other combination, and a
 * refusal here is an operator misconfiguration worth a red run.
 */
function describeSessionStore(sessions: Record<string, unknown> | undefined, environment: string | undefined): Omit<Check, "name"> {
  if (!sessions) return fail("health has no sessions block");
  // A store setting that could not be used falls back to memory with sessions
  // off and says why (2026-10-02 incident). That is a misconfiguration to fix,
  // whatever store is reported.
  if (typeof sessions.problem === "string") return fail(`sessions refused: ${sessions.problem}`);
  const store = String(sessions.store);
  if (store === "memory") {
    return sessions.enabled === true
      ? pass("memory store, one process (local server)")
      : pass("memory store; sessions disabled because a serverless deployment would lose rides on scale-out");
  }
  if (store !== "redis") return fail(`unknown session store ${store}`);
  if (sessions.namespace === undefined) return { outcome: "WARN", detail: "durable store; deployment predates the namespace guard" };
  if (sessions.enabled !== true) return pass(`durable store (namespace ${String(sessions.namespace)}); sessions switched off by configuration`);
  if (environment === "production" && sessions.namespace !== "production") {
    return fail(`production serves sessions from the ${String(sessions.namespace)} namespace`);
  }
  return pass(`durable store (redis), namespace ${String(sessions.namespace)}, sessions enabled`);
}

function evaluateUpstream(
  result: Awaited<ReturnType<typeof get>>,
  onSuccess: () => Omit<Check, "name">,
  credentialed: boolean,
): Omit<Check, "name"> {
  if (result.status === 503 && result.body?.error === "BLOCKED_BY_CREDENTIALS") {
    return { outcome: "BLOCKED_BY_CREDENTIALS", detail: "no TAGO service key is configured on this deployment" };
  }
  if (result.status !== 200) return fail(`status ${result.status} body ${preview(result.text)}`);
  if (!credentialed) return fail("200 returned while health reports no credential");
  return onSuccess();
}

async function get(path: string): Promise<{ status: number; text: string; body: Record<string, unknown> | undefined }> {
  return send("GET", path);
}

async function send(
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; text: string; body: Record<string, unknown> | undefined }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> | undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    parsed = undefined;
  }
  return { status: response.status, text, body: parsed };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function preview(text: string): string {
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function option(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function report(): void {
  const width = Math.max(...checks.map((check) => check.name.length));
  for (const check of checks) {
    console.log(`${check.outcome.padEnd(24)} ${check.name.padEnd(width)}  ${check.detail}`);
  }
  const failed = checks.filter((check) => check.outcome === "FAIL").length;
  const blocked = checks.filter((check) => check.outcome === "BLOCKED_BY_CREDENTIALS").length;
  const warned = checks.filter((check) => check.outcome === "WARN").length;
  const passed = checks.length - failed - blocked - warned;
  console.log(
    `\n${passed} passed, ${warned} warned, ${blocked} blocked by credentials, ${failed} failed — ${baseUrl}`,
  );
  process.exit(failed > 0 ? 1 : 0);
}
