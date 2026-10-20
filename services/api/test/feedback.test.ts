import assert from "node:assert/strict";
import test from "node:test";

import { readTransitApiConfig } from "../src/apiConfig.ts";
import { createTransitApiHandler } from "../src/apiRouter.ts";
import { FEEDBACK_CATEGORIES, FEEDBACK_RETENTION_MS, MemoryFeedbackStore, parseFeedback, UpstashFeedbackStore, type FeedbackStore } from "../src/feedbackStore.ts";
import { createBurstLimiter } from "../src/rateLimit.ts";

const OPERATOR_TOKEN = "synthetic-operator-token-0123456789";
const report = {
  category: "missed_alert",
  message: "2정거장 알림이 오지 않았어요",
  appVersion: "0.1.0",
  build: "7",
  gitCommit: "abc1234",
  buildConfiguration: "Beta",
  osVersion: "iOS 26.1",
  deviceModel: "iPhone15,4",
  language: "ko",
};

function handler(feedback: FeedbackStore | undefined, perCaller = 5) {
  const config = readTransitApiConfig({ TAGO_SERVICE_KEY: "synthetic-key", RIDE_CAPTURE_OPERATOR_TOKEN: OPERATOR_TOKEN }, { nodeVersion: "v22.0.0" });
  return createTransitApiHandler({
    config,
    discovery: { async cities() { return []; }, async routes() { return []; } },
    provider: { async stops() { return []; }, async vehicles() { return []; } },
    ...(feedback ? { feedback, feedbackLimiter: createBurstLimiter(perCaller, 60) } : {}),
    operatorToken: OPERATOR_TOKEN,
    log: () => {},
  });
}

const post = (h: ReturnType<typeof handler>, body: unknown) =>
  h(new Request("http://api.test/v1/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

test("a report is answered with a receipt id only once it is stored", async () => {
  const store = new MemoryFeedbackStore();
  const h = handler(store);
  const response = await post(h, report);
  assert.equal(response.status, 201);
  const receipt = await response.json();
  assert.match(receipt.id, /^[0-9a-f-]{36}$/);
  const [stored] = await store.recent(10);
  assert.equal(stored?.id, receipt.id);
  assert.equal(stored?.category, "missed_alert");
  assert.equal(stored?.diagnostics, undefined);
});

test("without a store nothing is claimed as sent", async () => {
  const response = await post(handler(undefined), report);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "FEEDBACK_UNAVAILABLE");
});

test("diagnostics travel only with explicit consent, and unknown categories are refused", async () => {
  assert.throws(() => parseFeedback({ ...report, diagnostics: "trace" }), /[Cc]onsent/);
  assert.throws(() => parseFeedback({ ...report, diagnostics: "trace", diagnosticsConsent: "yes" }), /[Cc]onsent/);
  assert.equal(parseFeedback({ ...report, diagnostics: "trace", diagnosticsConsent: true }).diagnostics, "trace");
  assert.throws(() => parseFeedback({ ...report, category: "bug" }), /category/);
  assert.throws(() => parseFeedback({ ...report, message: "x".repeat(2_001) }), /longer/);
  assert.equal(FEEDBACK_CATEGORIES.length, 8);
  const status = (await post(handler(new MemoryFeedbackStore()), { ...report, diagnostics: "trace" })).status;
  assert.equal(status, 400);
});

test("the store keeps nothing that identifies the caller", async () => {
  const store = new MemoryFeedbackStore();
  await post(handler(store), { ...report, ip: "203.0.113.9", latitude: 33.5 });
  const [stored] = await store.recent(1);
  assert.deepEqual(Object.keys(stored!).sort(), ["appVersion", "build", "buildConfiguration", "category", "deviceModel", "gitCommit", "id", "language", "message", "osVersion", "receivedAt"]);
});

test("a caller is limited to a few reports a minute", async () => {
  const h = handler(new MemoryFeedbackStore(), 2);
  assert.equal((await post(h, report)).status, 201);
  assert.equal((await post(h, report)).status, 201);
  const third = await post(h, report);
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get("retry-after")) >= 1);
});

test("only the operator reads reports", async () => {
  const store = new MemoryFeedbackStore();
  const h = handler(store);
  await post(h, report);
  assert.equal((await h(new Request("http://api.test/operator/feedback"))).status, 401);
  const read = await h(new Request("http://api.test/operator/feedback?limit=5", { headers: { authorization: `Bearer ${OPERATOR_TOKEN}` } }));
  assert.equal(read.status, 200);
  assert.equal((await read.json()).items.length, 1);
});

test("the Redis store writes an expiring entry and a pruned index, and reads newest first", async () => {
  const commands: string[][] = [];
  const values = new Map<string, string>();
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const command = JSON.parse(init.body) as string[];
    commands.push(command);
    let result: unknown = "OK";
    if (command[0] === "SET") values.set(command[1]!, command[2]!);
    if (command[0] === "ZADD" || command[0] === "ZREMRANGEBYSCORE") result = 1;
    if (command[0] === "ZRANGE") result = [...values.keys()].map((key) => key.split("feedback:")[1]);
    if (command[0] === "MGET") result = command.slice(1).map((key) => values.get(key) ?? null);
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as unknown as typeof fetch;
  const store = new UpstashFeedbackStore({ restUrl: "https://redis.test", restToken: "t", fetchImpl }, "tapso:test:journey-session:");
  const now = Date.parse("2026-10-20T00:00:00.000Z");
  const added = await store.add(parseFeedback(report), now);
  const set = commands.find((command) => command[0] === "SET")!;
  assert.equal(set[1], `tapso:test:journey-session:feedback:${added.id}`);
  assert.deepEqual(set.slice(3), ["PX", String(FEEDBACK_RETENTION_MS), "NX"]);
  assert.deepEqual(commands.find((command) => command[0] === "ZREMRANGEBYSCORE"), ["ZREMRANGEBYSCORE", "tapso:test:journey-session:feedback-index", "-inf", String(now - FEEDBACK_RETENTION_MS)]);
  const [read] = await store.recent(10);
  assert.equal(read?.id, added.id);
});
