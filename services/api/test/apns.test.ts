import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";

import {
  ApnsLiveActivitySender,
  ApnsProviderToken,
  classifyApnsResponse,
  describeApns,
  liveActivityRequest,
  readApnsConfig,
  swiftDate,
  tokenFingerprint,
  type ApnsConfig,
  type ApnsTransport,
  type LiveActivityPush,
} from "../src/apns.ts";

// SYNTHETIC: a throwaway P-256 key made for this test run, invented IDs, an invented token.
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const ENV = {
  APNS_KEY_ID: "ABCDE12345",
  APNS_TEAM_ID: "TEAM123456",
  APNS_BUNDLE_ID: "com.lucanomics.tapso",
  APNS_ENVIRONMENT: "development",
  APNS_PRIVATE_KEY: PEM,
};
const TOKEN = "a1".repeat(32);

function enabled(env: Record<string, string> = ENV): Extract<ApnsConfig, { enabled: true }> {
  const config = readApnsConfig(env);
  assert.equal(config.enabled, true);
  return config as Extract<ApnsConfig, { enabled: true }>;
}

const push = (overrides: Partial<LiveActivityPush> = {}): LiveActivityPush => ({
  token: TOKEN,
  event: "update",
  timestampMs: Date.parse("2026-10-01T08:00:00Z"),
  contentState: {
    phase: "approachingDestination",
    currentStopName: "중앙로",
    nextStopName: "동문로터리",
    remainingStops: 2,
    freshness: "fresh",
    updatedAt: swiftDate(Date.parse("2026-10-01T08:00:00Z")),
    destinationPassed: false,
    isOffline: false,
  },
  ...overrides,
});

test("APNs stays off unless every credential is present and valid, and says which by name only", () => {
  assert.deepEqual(readApnsConfig({}), {
    enabled: false,
    missing: ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID", "APNS_ENVIRONMENT", "APNS_PRIVATE_KEY"],
  });
  const wrongCurve = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.deepEqual(readApnsConfig({ ...ENV, APNS_PRIVATE_KEY: wrongCurve }), { enabled: false, missing: ["APNS_PRIVATE_KEY"] });
  assert.deepEqual(readApnsConfig({ ...ENV, APNS_ENVIRONMENT: "prod" }), { enabled: false, missing: ["APNS_ENVIRONMENT"] });
  // A key pasted with escaped newlines, as some dashboards store it, still reads.
  assert.equal(readApnsConfig({ ...ENV, APNS_PRIVATE_KEY: PEM.replace(/\n/g, "\\n") }).enabled, true);
  const described = JSON.stringify(describeApns(enabled()));
  assert.deepEqual(JSON.parse(described), { enabled: true, environment: "development" });
  for (const secret of [ENV.APNS_KEY_ID, ENV.APNS_TEAM_ID, "PRIVATE KEY"]) assert.ok(!described.includes(secret));
});

test("the provider token is an ES256 JWT Apple can verify, reused for 50 minutes, refreshed no sooner than 20", () => {
  let now = Date.parse("2026-10-01T08:00:00Z");
  const tokens = new ApnsProviderToken(enabled(), () => now);
  const first = tokens.current();
  const [header, claims, signature] = first.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header!, "base64url").toString()), { alg: "ES256", kid: "ABCDE12345" });
  assert.deepEqual(JSON.parse(Buffer.from(claims!, "base64url").toString()), { iss: "TEAM123456", iat: now / 1_000 });
  assert.ok(verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url")));

  now += 10 * 60_000;
  assert.equal(tokens.current(), first, "reused");
  assert.equal(tokens.refresh(), undefined, "not replaced within 20 minutes of issue");
  now += 15 * 60_000;
  const second = tokens.refresh();
  assert.ok(second && second !== first, "replaced after 20 minutes when Apple says it expired");
  now += 51 * 60_000;
  assert.notEqual(tokens.current(), second, "never used past 50 minutes");
});

test("a Live Activity request carries Apple's push type, topic and payload shape", () => {
  const request = liveActivityRequest(push({ staleDateMs: Date.parse("2026-10-01T08:02:00Z"), relevanceScore: 80 }), enabled());
  assert.equal(request.path, `/3/device/${TOKEN}`);
  assert.deepEqual(request.headers, {
    "apns-push-type": "liveactivity",
    "apns-topic": "com.lucanomics.tapso.push-type.liveactivity",
    "apns-priority": "5",
    "content-type": "application/json",
  });
  const { aps } = JSON.parse(request.body);
  assert.equal(aps.event, "update");
  assert.equal(aps.timestamp, Date.parse("2026-10-01T08:00:00Z") / 1_000);
  assert.equal(aps["stale-date"], Date.parse("2026-10-01T08:02:00Z") / 1_000);
  assert.equal(aps["relevance-score"], 80);
  assert.equal(aps.alert, undefined, "a quiet update never alerts");
  // Swift's Date: seconds since 2001-01-01, so 2026-10-01T08:00:00Z is 812 534 400.
  assert.equal(aps["content-state"].updatedAt, 812_534_400);

  const milestone = liveActivityRequest(push({ alert: { title: "2정거장 남았어요", body: "내릴 준비를 해주세요" } }), enabled());
  assert.equal(milestone.headers["apns-priority"], "10");
  assert.deepEqual(JSON.parse(milestone.body).aps.alert, { title: "2정거장 남았어요", body: "내릴 준비를 해주세요", sound: "default" });
  assert.throws(() => liveActivityRequest(push({ token: "../../3/device/x" }), enabled()), /hexadecimal/);
});

test("APNs answers are told apart: dead token, our credential, throttling, outage", () => {
  assert.deepEqual(classifyApnsResponse(200, "", "id-1"), { kind: "delivered", apnsId: "id-1" });
  assert.deepEqual(classifyApnsResponse(410, '{"reason":"Unregistered"}'), { kind: "token_rejected", reason: "Unregistered", dropToken: true });
  assert.deepEqual(classifyApnsResponse(400, '{"reason":"BadDeviceToken"}'), { kind: "token_rejected", reason: "BadDeviceToken", dropToken: true });
  assert.deepEqual(classifyApnsResponse(403, '{"reason":"InvalidProviderToken"}'), { kind: "credential_rejected", reason: "InvalidProviderToken" });
  assert.deepEqual(classifyApnsResponse(429, '{"reason":"TooManyRequests"}'), { kind: "throttled", reason: "TooManyRequests" });
  assert.deepEqual(classifyApnsResponse(503, "<html>"), { kind: "unavailable", reason: "unknown", status: 503 });
  assert.deepEqual(classifyApnsResponse(400, '{"reason":"<script>"}'), { kind: "unavailable", reason: "unknown", status: 400 });
});

test("the sender retries an expired provider token once when it may refresh, and never logs a token", async () => {
  const calls: string[] = [];
  let answers: Array<{ status: number; body: string; apnsId?: string }> = [];
  const transport: ApnsTransport = {
    async post(origin, path, headers) {
      assert.equal(origin, "https://api.sandbox.push.apple.com");
      assert.equal(path, `/3/device/${TOKEN}`);
      calls.push(headers.authorization!);
      return answers.shift()!;
    },
  };
  let now = Date.parse("2026-10-01T08:00:00Z");
  const logs: string[] = [];
  const sender = new ApnsLiveActivitySender(enabled(), transport, () => now, (entry) => logs.push(JSON.stringify(entry)));

  answers = [{ status: 200, body: "", apnsId: "first" }];
  assert.deepEqual(await sender.send(push()), { kind: "delivered", apnsId: "first" });

  // Within 20 minutes Apple's "expired" cannot be answered with a new token: reported, not retried.
  answers = [{ status: 403, body: '{"reason":"ExpiredProviderToken"}' }];
  assert.deepEqual(await sender.send(push()), { kind: "credential_rejected", reason: "ExpiredProviderToken" });
  assert.equal(calls.length, 2);

  // Later, it is replaced and the push retried once with the new one.
  now += 25 * 60_000;
  answers = [{ status: 403, body: '{"reason":"ExpiredProviderToken"}' }, { status: 200, body: "", apnsId: "second" }];
  assert.deepEqual(await sender.send(push()), { kind: "delivered", apnsId: "second" });
  assert.equal(calls.length, 4);
  assert.notEqual(calls[3], calls[2]);

  assert.ok(logs.every((line) => !line.includes(TOKEN)), "a push token is a capability: never logged");
  assert.ok(logs.every((line) => line.includes(tokenFingerprint(TOKEN))));
});

test("a network failure is reported as one, against the production host when configured so", async () => {
  const failing = new ApnsLiveActivitySender(enabled({ ...ENV, APNS_ENVIRONMENT: "production" }), {
    async post() {
      throw new Error("ECONNRESET");
    },
  }, Date.now, () => {});
  assert.equal(failing.origin, "https://api.push.apple.com");
  assert.deepEqual(await failing.send(push()), { kind: "unavailable", reason: "network" });
});
