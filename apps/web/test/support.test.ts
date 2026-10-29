import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmSupportPayment,
  createSupportIntent,
  handleSupportWebhook,
  isSupportLive,
  type SupportDependencies,
} from "../api/_lib/support/service.ts";
import { canTransition, type SupportAmountPolicy } from "../api/_lib/support/types.ts";
import { readTossConfig } from "../api/_lib/env.ts";
import { createBurstLimiter } from "../api/_lib/rateLimit.ts";
import {
  createFakeProvider,
  createFakeStore,
  fixedRandomBytes,
  paymentView,
  type FakeProvider,
  type FakeStore,
} from "./fakes.ts";

const policy: SupportAmountPolicy = {
  currency: "KRW",
  presetAmounts: [3000, 5000, 10000],
  minAmount: 1000,
  maxAmount: 100000,
};

function deps(
  store: FakeStore | undefined,
  provider: FakeProvider | undefined,
  clientKey: string | undefined = "test_ck_public",
): SupportDependencies {
  return {
    store,
    provider,
    clientKey,
    policy,
    burstLimiter: createBurstLimiter(5, 60),
    clientIp: "203.0.113.9",
    randomBytes: fixedRandomBytes(),
    now: () => new Date("2026-08-26T01:00:00.000Z"),
  };
}

async function seedIntent(store: FakeStore, provider: FakeProvider, amount = 5000) {
  const result = await createSupportIntent({ amount }, deps(store, provider));
  assert.equal(result.response.status, "created");
  if (result.response.status !== "created") throw new Error("unreachable");
  return result.response.orderId;
}

// Availability ------------------------------------------------------------

test("support is unavailable until switch, credentials, and store all agree", () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "x", amount: 1000 }));
  assert.equal(isSupportLive(deps(store, provider)), true);
  assert.equal(isSupportLive(deps(undefined, provider)), false);
  assert.equal(isSupportLive(deps(store, undefined)), false);
  // A default parameter would swallow an explicit `undefined`, so the missing
  // client key is expressed by overriding the built object.
  assert.equal(isSupportLive({ ...deps(store, provider), clientKey: undefined }), false);
});

test("an unconfigured provider refuses to create an intent", async () => {
  const result = await createSupportIntent({ amount: 5000 }, deps(createFakeStore(), undefined));
  assert.deepEqual(result.response, { status: "unavailable" });
  assert.equal(result.httpStatus, 503);
});

// Intent ------------------------------------------------------------------

test("an intent records the server's amount before any payment window opens", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "x", amount: 5000 }));
  const result = await createSupportIntent({ amount: 5000 }, deps(store, provider));

  assert.equal(result.httpStatus, 201);
  if (result.response.status !== "created") throw new Error("expected created");
  const record = store.payments.get(result.response.orderId);
  assert.equal(record?.amount, 5000);
  assert.equal(record?.status, "pending");
  assert.equal(result.response.clientKey, "test_ck_public");
});

test("an out-of-range amount is rejected", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "x", amount: 1 }));
  for (const amount of [0, 999, 100001, 5000.5, "5000"]) {
    const result = await createSupportIntent({ amount }, deps(store, provider));
    assert.deepEqual(result.response, { status: "invalid_request", field: "amount" }, String(amount));
  }
  assert.equal(store.payments.size, 0);
});

// Confirm -----------------------------------------------------------------

test("a valid provider confirmation marks the payment paid", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider);
  provider.confirmResult = paymentView({ orderId, amount: 5000 });

  const result = await confirmSupportPayment(
    { orderId, paymentKey: "pay_abc", amount: 5000 },
    deps(store, provider),
  );

  assert.deepEqual(result.response, { status: "paid", orderId, amount: 5000 });
  assert.equal(store.payments.get(orderId)?.status, "paid");
  assert.equal(store.payments.get(orderId)?.confirmedAt, "2026-08-26T01:00:00.000Z");
});

test("the stored amount is what reaches the provider, not the client's", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider, 5000);
  provider.confirmResult = paymentView({ orderId, amount: 5000 });

  // No amount echoed by the browser at all.
  await confirmSupportPayment({ orderId, paymentKey: "pay_abc" }, deps(store, provider));
  assert.deepEqual(provider.confirmCalls[0], { paymentKey: "pay_abc", orderId, amount: 5000 });
});

test("a tampered amount is rejected without contacting the provider", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider, 5000);

  const result = await confirmSupportPayment(
    { orderId, paymentKey: "pay_abc", amount: 1 },
    deps(store, provider),
  );

  assert.deepEqual(result.response, { status: "invalid_request", field: "amount" });
  assert.equal(provider.confirmCalls.length, 0);
  assert.equal(store.payments.get(orderId)?.status, "pending");
});

test("a provider that reports a different amount cannot mark the payment paid", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider, 5000);
  provider.confirmResult = paymentView({ orderId, amount: 100 });

  const result = await confirmSupportPayment(
    { orderId, paymentKey: "pay_abc" },
    deps(store, provider),
  );

  assert.equal(result.response.status, "failed");
  assert.equal(store.payments.get(orderId)?.status, "failed");
});

test("an order id the server never issued is refused", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "x", amount: 5000 }));

  const result = await confirmSupportPayment(
    { orderId: "tapso_support_forged", paymentKey: "pay_abc", amount: 5000 },
    deps(store, provider),
  );

  assert.deepEqual(result.response, { status: "invalid_request", field: "orderId" });
  assert.equal(provider.confirmCalls.length, 0);
});

test("re-confirming a paid order is idempotent and does not charge again", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider);
  provider.confirmResult = paymentView({ orderId, amount: 5000, paymentKey: "pay_abc" });

  await confirmSupportPayment({ orderId, paymentKey: "pay_abc" }, deps(store, provider));
  const again = await confirmSupportPayment({ orderId, paymentKey: "pay_abc" }, deps(store, provider));

  assert.deepEqual(again.response, { status: "paid", orderId, amount: 5000 });
  assert.equal(provider.confirmCalls.length, 1, "the provider must be called exactly once");
});

test("a provider rejection is recorded as failed and reported honestly", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider);
  provider.confirmResult = { ok: false, code: "PAY_PROCESS_CANCELED", message: "cancelled" };

  const result = await confirmSupportPayment({ orderId, paymentKey: "pay_abc" }, deps(store, provider));

  assert.deepEqual(result.response, {
    status: "failed",
    orderId,
    reason: "PAY_PROCESS_CANCELED",
  });
  assert.equal(store.payments.get(orderId)?.status, "failed");
});

test("a virtual account awaiting deposit is pending, never paid", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider);
  provider.confirmResult = paymentView({ orderId, amount: 5000, status: "awaiting_deposit" });

  const result = await confirmSupportPayment({ orderId, paymentKey: "pay_abc" }, deps(store, provider));

  assert.deepEqual(result.response, { status: "pending", orderId });
  assert.equal(store.payments.get(orderId)?.status, "awaiting_deposit");
});

test("malformed confirm input is rejected", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "x", amount: 1000 }));
  const shared = deps(store, provider);

  assert.equal((await confirmSupportPayment(null, shared)).response.status, "invalid_request");
  assert.deepEqual((await confirmSupportPayment({ paymentKey: "k" }, shared)).response, {
    status: "invalid_request",
    field: "orderId",
  });
  assert.deepEqual((await confirmSupportPayment({ orderId: "o" }, shared)).response, {
    status: "invalid_request",
    field: "paymentKey",
  });
  assert.deepEqual(
    (await confirmSupportPayment({ orderId: "o", paymentKey: "k".repeat(201) }, shared)).response,
    { status: "invalid_request", field: "paymentKey" },
  );
});

// Webhooks ----------------------------------------------------------------

const webhookBody = (paymentKey: string, status = "DONE") =>
  JSON.stringify({
    eventType: "PAYMENT_STATUS_CHANGED",
    createdAt: "2026-08-26T01:00:05.000Z",
    data: { paymentKey, orderId: "ignored-by-design", status },
  });

test("a wrong webhook token is rejected before any work happens", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "x", amount: 5000 }));

  const result = await handleSupportWebhook(
    webhookBody("pay_abc"),
    "wrong",
    "correct",
    deps(store, provider),
  );

  assert.equal(result.outcome, "unauthorized");
  assert.equal(result.httpStatus, 401);
  assert.equal(provider.fetchCalls.length, 0);
});

test("the webhook body is never trusted; the provider is re-queried", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider);
  provider.fetchResult = paymentView({ orderId, amount: 5000, status: "paid" });

  const result = await handleSupportWebhook(
    // The body claims a different order entirely.
    webhookBody("pay_abc"),
    "secret",
    "secret",
    deps(store, provider),
  );

  assert.equal(result.outcome, "applied");
  assert.deepEqual(provider.fetchCalls, ["pay_abc"]);
  assert.equal(store.payments.get(orderId)?.status, "paid");
});

test("a replayed webhook is applied once", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider);
  provider.fetchResult = paymentView({ orderId, amount: 5000, status: "paid" });
  const shared = deps(store, provider);

  const first = await handleSupportWebhook(webhookBody("pay_abc"), undefined, undefined, shared);
  const replay = await handleSupportWebhook(webhookBody("pay_abc"), undefined, undefined, shared);

  assert.equal(first.outcome, "applied");
  assert.equal(replay.outcome, "duplicate");
  assert.equal(replay.httpStatus, 200);
  assert.equal(store.payments.get(orderId)?.status, "paid");
});

test("a late pending event cannot un-pay a paid record", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider);
  const shared = deps(store, provider);

  provider.fetchResult = paymentView({ orderId, amount: 5000, status: "paid" });
  await handleSupportWebhook(webhookBody("pay_abc", "DONE"), undefined, undefined, shared);

  provider.fetchResult = paymentView({ orderId, amount: 5000, status: "pending" });
  const late = await handleSupportWebhook(webhookBody("pay_abc", "READY"), undefined, undefined, shared);

  assert.equal(late.outcome, "ignored");
  assert.equal(store.payments.get(orderId)?.status, "paid");
});

test("an amount that disagrees with the intent is never recorded as paid", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider, 5000);
  provider.fetchResult = paymentView({ orderId, amount: 50, status: "paid" });

  const result = await handleSupportWebhook(webhookBody("pay_abc"), undefined, undefined, deps(store, provider));

  assert.equal(result.outcome, "applied");
  assert.equal(store.payments.get(orderId)?.status, "failed");
});

test("an unreachable provider asks for a retry instead of recording a guess", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider);
  provider.fetchResult = { ok: false, code: "PROVIDER_UNREACHABLE", message: "timeout" };

  const result = await handleSupportWebhook(webhookBody("pay_abc"), undefined, undefined, deps(store, provider));

  assert.equal(result.outcome, "retry");
  assert.equal(result.httpStatus, 503);
  assert.equal(store.payments.get(orderId)?.status, "pending");
  assert.equal(store.webhookEvents.size, 0, "an unprocessed event must stay retryable");
});

test("a payment for an unknown order is acknowledged but not recorded", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "someone-else", amount: 5000 }));

  const result = await handleSupportWebhook(webhookBody("pay_abc"), undefined, undefined, deps(store, provider));

  assert.equal(result.outcome, "ignored");
  assert.equal(result.httpStatus, 200);
  assert.equal(store.payments.size, 0);
});

test("a malformed webhook body is rejected", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "x", amount: 5000 }));
  const shared = deps(store, provider);

  assert.equal((await handleSupportWebhook("{", undefined, undefined, shared)).outcome, "malformed");
  assert.equal((await handleSupportWebhook("[]", undefined, undefined, shared)).outcome, "malformed");
  assert.equal(
    (await handleSupportWebhook(JSON.stringify({ data: {} }), undefined, undefined, shared)).outcome,
    "malformed",
  );
});

// State machine -----------------------------------------------------------

test("terminal and backwards transitions are blocked", () => {
  assert.equal(canTransition("pending", "paid"), true);
  assert.equal(canTransition("pending", "awaiting_deposit"), true);
  assert.equal(canTransition("awaiting_deposit", "paid"), true);
  assert.equal(canTransition("paid", "refunded"), true);
  assert.equal(canTransition("paid", "pending"), false);
  assert.equal(canTransition("paid", "failed"), false);
  assert.equal(canTransition("failed", "paid"), false);
  assert.equal(canTransition("refunded", "paid"), false);
});


test("Toss checkout remains disabled until credentials and the protected webhook are ready", () => {
  const common = {
    SUPPORT_ENABLED: "true",
    SUPPORT_WEBHOOK_TOKEN: "a".repeat(48),
  };
  const testKeys = { TOSS_CLIENT_KEY: "test_ck_example", TOSS_SECRET_KEY: "test_sk_example" };
  const liveKeys = { TOSS_CLIENT_KEY: "live_ck_example", TOSS_SECRET_KEY: "live_sk_example" };

  assert.equal(readTossConfig({ ...common, ...testKeys, VERCEL_ENV: "preview" })?.clientKey, "test_ck_example");
  assert.equal(readTossConfig({ ...common, ...liveKeys, VERCEL_ENV: "production" })?.clientKey, "live_ck_example");
  assert.equal(readTossConfig({ ...common, ...testKeys, VERCEL_ENV: "production" }), undefined);
  assert.equal(readTossConfig({ ...common, ...liveKeys, VERCEL_ENV: "preview" }), undefined);
  assert.equal(readTossConfig({ ...common, ...testKeys, TOSS_SECRET_KEY: "live_sk_wrong" }), undefined);
  assert.equal(readTossConfig({ ...common, ...testKeys, SUPPORT_WEBHOOK_TOKEN: "short" }), undefined);
  assert.equal(readTossConfig({ ...common, ...testKeys, SUPPORT_ENABLED: "false" }), undefined);
});

test("a provider timeout does not falsely mark an order failed", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider);
  provider.confirmResult = { ok: false, code: "PROVIDER_UNREACHABLE", message: "timeout" };

  const result = await confirmSupportPayment({ orderId, paymentKey: "pay_abc" }, deps(store, provider));
  assert.deepEqual(result.response, { status: "internal_error" });
  assert.equal(result.httpStatus, 503);
  assert.equal(store.payments.get(orderId)?.status, "pending");
});

test("a paid response is not returned if the ledger cannot persist provider approval", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider);
  provider.confirmResult = paymentView({ orderId, amount: 5000 });
  store.updatePayment = async () => { throw new Error("DB unavailable"); };

  const result = await confirmSupportPayment({ orderId, paymentKey: "pay_abc" }, deps(store, provider));
  assert.deepEqual(result.response, { status: "internal_error" });
  assert.equal(result.httpStatus, 503);
  assert.equal(store.payments.get(orderId)?.status, "pending");
});

test("webhook stays retryable if persisting an authoritative payment fails", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider);
  provider.fetchResult = paymentView({ orderId, amount: 5000 });
  store.updatePayment = async () => { throw new Error("DB unavailable"); };

  const result = await handleSupportWebhook(webhookBody("pay_abc"), undefined, undefined, deps(store, provider));
  assert.equal(result.outcome, "retry");
  assert.equal(result.httpStatus, 503);
  assert.equal(store.webhookEvents.size, 0);
});

test("provider currency mismatches never count as paid", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider);
  const reported = paymentView({ orderId, amount: 5000 });
  if (!reported.ok) throw new Error("invalid fixture");
  reported.payment.currency = "USD";
  provider.confirmResult = reported;

  const result = await confirmSupportPayment({ orderId, paymentKey: "pay_abc" }, deps(store, provider));
  assert.equal(result.response.status, "failed");
  assert.notEqual(store.payments.get(orderId)?.status, "paid");
});

test("a re-confirm for a different provider key is rejected without another charge", async () => {
  const store = createFakeStore();
  const provider = createFakeProvider(paymentView({ orderId: "placeholder", amount: 5000 }));
  const orderId = await seedIntent(store, provider);
  provider.confirmResult = paymentView({ orderId, amount: 5000, paymentKey: "pay_original" });
  await confirmSupportPayment({ orderId, paymentKey: "pay_original" }, deps(store, provider));

  const result = await confirmSupportPayment({ orderId, paymentKey: "pay_different" }, deps(store, provider));
  assert.deepEqual(result.response, { status: "invalid_request", field: "paymentKey" });
  assert.equal(provider.confirmCalls.length, 1);
});
