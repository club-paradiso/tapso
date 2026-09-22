import test from "node:test";
import assert from "node:assert/strict";
import { readTransitApiConfig } from "../src/apiConfig.ts";
import { createBurstLimiter, maskClientAddress } from "../src/rateLimit.ts";

const NODE = { nodeVersion: "v22.18.0" };

test("defaults keep the measured cache policy and a local session store", () => {
  const config = readTransitApiConfig({}, NODE);
  assert.equal(config.transitProvider, "tago");
  assert.equal(config.liveTransitConfigured, false);
  assert.equal(config.cachePolicy.stopTtlMs, 6 * 60 * 60 * 1_000);
  assert.equal(config.cachePolicy.vehicleTtlMs, 20_000);
  assert.equal(config.cachePolicy.discoveryTtlMs, 6 * 60 * 60 * 1_000);
  assert.equal(config.runtime.platform, "node");
  assert.equal(config.sessions.enabled, true, "one long-lived process can hold sessions honestly");
  assert.equal(config.rateLimit.enabled, true);
  assert.deepEqual(config.cors.allowedOrigins, []);
});

test("a serverless deployment disables memory-only sessions by default", () => {
  const config = readTransitApiConfig({ VERCEL: "1", VERCEL_ENV: "production", VERCEL_REGION: "icn1" }, NODE);
  assert.equal(config.runtime.platform, "vercel");
  assert.equal(config.sessions.enabled, false);
  assert.equal(config.sessions.store, "memory");
  assert.equal(config.runtime.region, "icn1");
  assert.equal(config.build.environment, "production");
});

test("an operator can opt a single-instance deployment back into sessions", () => {
  const config = readTransitApiConfig({ VERCEL: "1", TRANSIT_SESSIONS_ENABLED: "true" }, NODE);
  assert.equal(config.sessions.enabled, true);
});

test("automatic matching is off by default on every platform", () => {
  for (const env of [{}, { VERCEL: "1" }, { VERCEL: "1", VERCEL_ENV: "production" }]) {
    const config = readTransitApiConfig(env, NODE);
    assert.equal(config.matching.automaticMatchingEnabled, false);
    assert.equal(config.matching.mode, "shadow");
    assert.equal(config.matching.withheldReason, "field_validation_gate_open");
    assert.equal(config.matching.fieldValidationGate.status, "open");
    assert.equal(config.matching.fieldValidationGate.requiredBoardings, 30);
  }
});

test("enabling sessions is not enough to enable automatic matching", () => {
  // The two flags are separate rollout axes on purpose. Sessions make the
  // endpoints reachable; only the matching flag lets the server pick a bus.
  const config = readTransitApiConfig({ TRANSIT_SESSIONS_ENABLED: "true" }, NODE);
  assert.equal(config.sessions.enabled, true);
  assert.equal(config.matching.automaticMatchingEnabled, false);
  assert.equal(config.matching.mode, "shadow");
});

test("automatic matching turns on only through its own explicit flag", () => {
  const config = readTransitApiConfig({ TRANSIT_AUTOMATIC_MATCHING_ENABLED: "true" }, NODE);
  assert.equal(config.matching.automaticMatchingEnabled, true);
  assert.equal(config.matching.mode, "automatic");
  assert.equal(config.matching.withheldReason, undefined);
});

test("an unparseable automatic-matching flag fails loudly rather than defaulting open", () => {
  assert.throws(
    () => readTransitApiConfig({ TRANSIT_AUTOMATIC_MATCHING_ENABLED: "yes" }, NODE),
    /TRANSIT_AUTOMATIC_MATCHING_ENABLED must be true or false/,
  );
});

test("the build identifier is a commit prefix, never anything else", () => {
  const good = readTransitApiConfig({ VERCEL_GIT_COMMIT_SHA: "8e07285d43d2853d4bc42ba54fc5303652c0402a" }, NODE);
  assert.equal(good.build.commit, "8e07285d43d2");
  const junk = readTransitApiConfig({ VERCEL_GIT_COMMIT_SHA: "not-a-sha" }, NODE);
  assert.equal(junk.build.commit, undefined);
});

test("credential presence is reported as a boolean and never echoed", () => {
  const config = readTransitApiConfig({ TAGO_SERVICE_KEY: "  super-secret  " }, NODE);
  assert.equal(config.liveTransitConfigured, true);
  assert.equal(config.credential.source, "canonical");
  assert.equal(config.credential.deprecatedNamePresent, false);
  assert.ok(!JSON.stringify(config).includes("super-secret"));
});

test("the deprecated name still configures a local run", () => {
  const config = readTransitApiConfig({ PUBLIC_DATA_SERVICE_KEY: "local-only" }, NODE);
  assert.equal(config.liveTransitConfigured, true);
  assert.equal(config.credential.source, "deprecated_local_fallback");
  assert.equal(config.credential.deprecatedNamePresent, true);
});

test("the deprecated name configures nothing on a serverless deployment", () => {
  const config = readTransitApiConfig({ VERCEL: "1", PUBLIC_DATA_SERVICE_KEY: "not-honoured-here" }, NODE);
  assert.equal(config.liveTransitConfigured, false, "production must not read a PUBLIC_ variable");
  assert.equal(config.credential.source, "missing");
  assert.equal(config.credential.deprecatedNamePresent, true, "the mistake stays visible to the operator");
  assert.ok(!JSON.stringify(config).includes("not-honoured-here"));
});

test("misconfiguration fails loudly instead of silently weakening policy", () => {
  assert.throws(() => readTransitApiConfig({ TRANSIT_VEHICLE_TTL_MS: "-1" }, NODE), /TRANSIT_VEHICLE_TTL_MS/);
  assert.throws(() => readTransitApiConfig({ TRANSIT_SESSIONS_ENABLED: "yes" }, NODE), /TRANSIT_SESSIONS_ENABLED/);
  assert.throws(() => readTransitApiConfig({ TRANSIT_RATE_LIMIT_PER_MINUTE: "1.5" }, NODE), /TRANSIT_RATE_LIMIT_PER_MINUTE/);
  assert.throws(() => readTransitApiConfig({ TRANSIT_ALLOWED_ORIGINS: "*" }, NODE), /absolute origins/);
  assert.throws(() => readTransitApiConfig({ TRANSIT_ALLOWED_ORIGINS: "tapso.app" }, NODE), /absolute origins/);
});

test("allowed origins are normalized and de-duplicated", () => {
  const config = readTransitApiConfig(
    { TRANSIT_ALLOWED_ORIGINS: "https://tapso-nu.vercel.app/, https://tapso-nu.vercel.app , http://localhost:5173" },
    NODE,
  );
  assert.deepEqual(config.cors.allowedOrigins, ["https://tapso-nu.vercel.app", "http://localhost:5173"]);
});

test("zero disables rate limiting explicitly", () => {
  const config = readTransitApiConfig({ TRANSIT_RATE_LIMIT_PER_MINUTE: "0" }, NODE);
  assert.equal(config.rateLimit.enabled, false);
});

test("the burst limiter counts per bucket inside one fixed window", () => {
  const limiter = createBurstLimiter(2, 60);
  assert.equal(limiter.consume("a", 0).allowed, true);
  assert.equal(limiter.consume("a", 1_000).allowed, true);
  assert.equal(limiter.consume("a", 2_000).allowed, false);
  assert.equal(limiter.consume("b", 2_000).allowed, true);
  assert.equal(limiter.consume("a", 60_000).allowed, true, "the next window starts clean");
  assert.equal(limiter.consume("a", 59_000).retryAfterSeconds, 1);
});

test("client addresses are masked before they reach a log line", () => {
  assert.equal(maskClientAddress("203.0.113.7"), "203.0.x.x");
  assert.equal(maskClientAddress("2001:db8::1"), "2001:db8::/32");
  assert.equal(maskClientAddress("unknown"), "unknown");
  assert.equal(maskClientAddress("garbage"), "unknown");
});

/* --------------------------------------------------- durable session store */

const UPSTASH = {
  UPSTASH_REDIS_REST_URL: "https://synthetic.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "synthetic-upstash-token",
};

test("sessions stay in memory unless a store is named", () => {
  const config = readTransitApiConfig({}, NODE);
  assert.equal(config.sessions.store, "memory");
  assert.equal(config.sessions.durableStoreConfigured, false);
});

test("stray Upstash variables do not silently switch the store", () => {
  // Presence of a credential is not a decision to use it. Inferring the store
  // from a leftover variable is how a deployment changes behaviour by accident.
  const config = readTransitApiConfig({ VERCEL: "1", ...UPSTASH }, NODE);
  assert.equal(config.sessions.store, "memory");
  assert.equal(config.sessions.enabled, false);
});

test("a durable store lets a serverless deployment hold sessions honestly", () => {
  const config = readTransitApiConfig(
    { VERCEL: "1", TRANSIT_SESSION_STORE: "redis", ...UPSTASH },
    NODE,
  );
  assert.equal(config.sessions.store, "redis");
  assert.equal(config.sessions.durableStoreConfigured, true);
  assert.equal(config.sessions.enabled, true);
  // Durable storage is a different axis from letting the server pick a bus.
  assert.equal(config.matching.automaticMatchingEnabled, false);
  assert.equal(config.matching.mode, "shadow");
});

test("an operator can still keep sessions off with a durable store configured", () => {
  const config = readTransitApiConfig(
    { VERCEL: "1", TRANSIT_SESSION_STORE: "redis", TRANSIT_SESSIONS_ENABLED: "false", ...UPSTASH },
    NODE,
  );
  assert.equal(config.sessions.store, "redis");
  assert.equal(config.sessions.enabled, false);
});

test("asking for redis without credentials fails loudly instead of falling back to memory", () => {
  // A silent fallback would leave a deployment that believes it has durable
  // sessions running on the exact failure mode it was trying to leave.
  assert.throws(
    () => readTransitApiConfig({ TRANSIT_SESSION_STORE: "redis" }, NODE),
    /requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN/,
  );
  assert.throws(
    () => readTransitApiConfig({ TRANSIT_SESSION_STORE: "redis", UPSTASH_REDIS_REST_URL: UPSTASH.UPSTASH_REDIS_REST_URL }, NODE),
    /requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN/,
  );
});

test("an unknown store name is a misconfiguration, not a default", () => {
  assert.throws(
    () => readTransitApiConfig({ TRANSIT_SESSION_STORE: "postgres" }, NODE),
    /TRANSIT_SESSION_STORE must be memory or redis/,
  );
});

test("a plaintext store URL is refused so a bearer token never crosses http", () => {
  assert.throws(
    () => readTransitApiConfig({
      TRANSIT_SESSION_STORE: "redis",
      UPSTASH_REDIS_REST_URL: "http://synthetic.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "synthetic-upstash-token",
    }, NODE),
    /must be an absolute https origin/,
  );
});

test("store credentials never reach the config object", () => {
  const config = readTransitApiConfig(
    { TRANSIT_SESSION_STORE: "redis", ...UPSTASH },
    NODE,
  );
  const serialized = JSON.stringify(config);
  assert.ok(!serialized.includes("synthetic-upstash-token"), "the token is never part of config");
  assert.ok(!serialized.includes("synthetic.upstash.io"), "nor is the host it authenticates against");
  // A category is all a reader gets, the same rule the TAGO key follows.
  assert.equal(config.sessions.store, "redis");
});
