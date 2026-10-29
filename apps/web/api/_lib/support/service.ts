/**
 * Support payment use cases: intent, confirm, and webhook reconciliation.
 *
 * Two rules drive the whole file:
 *  1. The amount is whatever the server wrote when the intent was created. A
 *     value supplied by the browser is only ever compared, never used.
 *  2. A payment is `paid` only because the provider said so in a response the
 *     server requested itself. Visiting a success URL proves nothing.
 */

import type {
  SupportConfirmResponse,
  SupportIntentResponse,
} from "../contract.ts";
import { log } from "../log.ts";
import { enforceRateLimit, type BurstLimiter } from "../rateLimit.ts";
import type { RateLimitStore, SupportStore } from "../store.ts";
import { parseSupportAmount } from "../validation.ts";
import {
  canTransition,
  createOrderId,
  type SupportAmountPolicy,
  type SupportPaymentProvider,
  type SupportPaymentStatus,
} from "./types.ts";

const MAX_ORDER_ID_LENGTH = 64;
const MAX_PAYMENT_KEY_LENGTH = 200;

export type SupportDependencies = {
  store?: SupportStore & RateLimitStore;
  provider?: SupportPaymentProvider;
  /** Publishable merchant key handed to the browser to open the payment window. */
  clientKey?: string;
  policy: SupportAmountPolicy;
  burstLimiter: BurstLimiter;
  clientIp: string;
  randomBytes: (size: number) => Uint8Array;
  now?: () => Date;
};

type ReadyDependencies = SupportDependencies & {
  store: SupportStore & RateLimitStore;
  provider: SupportPaymentProvider;
  clientKey: string;
};

/** Support is live only when the switch, the credentials, and the store agree. */
export function isSupportLive(deps: SupportDependencies): deps is ReadyDependencies {
  return Boolean(deps.store && deps.provider && deps.clientKey);
}

export async function createSupportIntent(
  body: unknown,
  deps: SupportDependencies,
): Promise<{ response: SupportIntentResponse; httpStatus: number }> {
  if (!isSupportLive(deps)) {
    return { response: { status: "unavailable" }, httpStatus: 503 };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { response: { status: "invalid_request" }, httpStatus: 400 };
  }

  const amount = parseSupportAmount((body as Record<string, unknown>).amount, deps.policy);
  if (amount === undefined) {
    return { response: { status: "invalid_request", field: "amount" }, httpStatus: 400 };
  }

  const decision = await enforceRateLimit(
    {
      bucket: `support:${deps.clientIp}`,
      burst: { limit: 5, windowSeconds: 60 },
      sustained: { limit: 20, windowSeconds: 3600 },
    },
    deps.burstLimiter,
    deps.store,
    (message) => log("warn", "support_rate_limit_degraded", { message }),
  );
  if (!decision.allowed) {
    return {
      response: { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds },
      httpStatus: 429,
    };
  }

  const orderId = createOrderId(deps.randomBytes);
  try {
    await deps.store.createPayment({
      provider: deps.provider.name,
      orderId,
      amount,
      currency: deps.policy.currency,
    });
  } catch (error) {
    log("error", "support_intent_store_failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return { response: { status: "internal_error" }, httpStatus: 500 };
  }

  log("info", "support_intent_created", { orderId, amount });
  return {
    response: {
      status: "created",
      orderId,
      amount,
      currency: deps.policy.currency,
      clientKey: deps.clientKey,
    },
    httpStatus: 201,
  };
}

export async function confirmSupportPayment(
  body: unknown,
  deps: SupportDependencies,
): Promise<{ response: SupportConfirmResponse; httpStatus: number }> {
  if (!isSupportLive(deps)) {
    return { response: { status: "unavailable" }, httpStatus: 503 };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { response: { status: "invalid_request" }, httpStatus: 400 };
  }

  const input = body as Record<string, unknown>;
  const orderId = typeof input.orderId === "string" ? input.orderId.trim() : "";
  const paymentKey = typeof input.paymentKey === "string" ? input.paymentKey.trim() : "";
  if (!orderId || orderId.length > MAX_ORDER_ID_LENGTH) {
    return { response: { status: "invalid_request", field: "orderId" }, httpStatus: 400 };
  }
  if (!paymentKey || paymentKey.length > MAX_PAYMENT_KEY_LENGTH) {
    return { response: { status: "invalid_request", field: "paymentKey" }, httpStatus: 400 };
  }

  let record;
  try {
    record = await deps.store.findPaymentByOrderId(orderId);
  } catch (error) {
    log("error", "support_confirm_store_failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return { response: { status: "internal_error" }, httpStatus: 500 };
  }

  // An order id the server never issued is not a payment it will confirm.
  if (!record) {
    log("warn", "support_confirm_unknown_order", { orderId });
    return { response: { status: "invalid_request", field: "orderId" }, httpStatus: 400 };
  }

  // Retrying a completed confirm must not charge again or change the record.
  if (record.status === "paid") {
    // Never acknowledge a different payment key against an existing order.
    if (record.providerPaymentId && record.providerPaymentId !== paymentKey) {
      return { response: { status: "invalid_request", field: "paymentKey" }, httpStatus: 400 };
    }
    return { response: { status: "paid", orderId, amount: record.amount }, httpStatus: 200 };
  }

  // The browser may echo an amount. It has to match what the server stored, and
  // even then the stored value is what gets sent to the provider.
  if (input.amount !== undefined && input.amount !== record.amount) {
    log("error", "support_confirm_amount_mismatch", { orderId });
    return { response: { status: "invalid_request", field: "amount" }, httpStatus: 400 };
  }

  const result = await deps.provider.confirm({ paymentKey, orderId, amount: record.amount });
  if (!result.ok) {
    log("warn", "support_confirm_rejected", { orderId, code: result.code });
    // Timeout/5xx means an unknown outcome, not a declined charge.
    // Toss may have approved the payment while our request timed out.
    if (result.code === "PROVIDER_UNREACHABLE" || /^HTTP_5\d\d$/.test(result.code)) {
      return { response: { status: "internal_error" }, httpStatus: 503 };
    }
    if (!await applyStatus(deps, orderId, record.status, "failed", { failureCode: result.code })) {
      return { response: { status: "internal_error" }, httpStatus: 503 };
    }
    return { response: { status: "failed", orderId, reason: result.code }, httpStatus: 200 };
  }

  const payment = result.payment;
  if (payment.orderId !== orderId || payment.amount !== record.amount || payment.currency !== record.currency) {
    log("error", "support_confirm_provider_mismatch", { orderId });
    if (!await applyStatus(deps, orderId, record.status, "failed", { failureCode: "PAYMENT_MISMATCH" })) {
      return { response: { status: "internal_error" }, httpStatus: 503 };
    }
    return { response: { status: "failed", orderId, reason: "PAYMENT_MISMATCH" }, httpStatus: 200 };
  }

  const stored = await applyStatus(deps, orderId, record.status, payment.status, {
    providerPaymentId: payment.providerPaymentId,
    confirmedAt: payment.status === "paid" ? (payment.approvedAt ?? isoNow(deps)) : undefined,
    failureCode: payment.failureCode,
  });
  // Provider approval without a durable ledger entry is not a confirmed
  // TAPSO payment. Let callers retry safely with the same orderId.
  if (!stored) return { response: { status: "internal_error" }, httpStatus: 503 };

  if (payment.status === "paid") {
    log("info", "support_paid", { orderId, amount: payment.amount });
    return { response: { status: "paid", orderId, amount: payment.amount }, httpStatus: 200 };
  }
  if (payment.status === "pending" || payment.status === "awaiting_deposit") {
    return { response: { status: "pending", orderId }, httpStatus: 200 };
  }
  return { response: { status: "failed", orderId, reason: payment.status }, httpStatus: 200 };
}

export type WebhookOutcome =
  | { outcome: "applied" | "ignored" | "duplicate"; httpStatus: 200 }
  | { outcome: "unauthorized"; httpStatus: 401 }
  | { outcome: "malformed"; httpStatus: 400 }
  | { outcome: "retry"; httpStatus: 503 }
  | { outcome: "unavailable"; httpStatus: 503 };

/**
 * Toss sends no signature on `PAYMENT_STATUS_CHANGED` — the
 * `tosspayments-webhook-transmission-signature` header exists only for
 * `payout.changed` and `seller.changed`. So the body is treated purely as a
 * hint that something moved: the server re-reads the payment from the provider
 * and reconciles against that response. Nothing in the request body is trusted.
 *
 * `expectedToken` is a TAPSO-defined secret placed in the webhook URL the
 * operator registers with Toss. It is defence in depth, not a provider feature.
 */
export async function handleSupportWebhook(
  rawBody: string,
  suppliedToken: string | undefined,
  expectedToken: string | undefined,
  deps: SupportDependencies,
): Promise<WebhookOutcome> {
  if (!isSupportLive(deps)) return { outcome: "unavailable", httpStatus: 503 };

  if (expectedToken && !timingSafeEqual(suppliedToken ?? "", expectedToken)) {
    log("warn", "support_webhook_rejected_token", {});
    return { outcome: "unauthorized", httpStatus: 401 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return { outcome: "malformed", httpStatus: 400 };
  }
  if (!parsed || typeof parsed !== "object") return { outcome: "malformed", httpStatus: 400 };

  const envelope = parsed as Record<string, unknown>;
  const eventType = typeof envelope.eventType === "string" ? envelope.eventType : undefined;
  const data = (envelope.data ?? {}) as Record<string, unknown>;
  const paymentKey = typeof data.paymentKey === "string" ? data.paymentKey : "";
  if (!paymentKey || paymentKey.length > MAX_PAYMENT_KEY_LENGTH) {
    return { outcome: "malformed", httpStatus: 400 };
  }

  // Toss does not publish an event id for this event, so the dedupe key is
  // derived from the fields that identify one state change.
  const eventId = [
    paymentKey,
    typeof data.status === "string" ? data.status : "unknown",
    typeof envelope.createdAt === "string" ? envelope.createdAt : "unknown",
  ].join(":");

  const authoritative = await deps.provider.fetch(paymentKey);
  if (!authoritative.ok) {
    log("warn", "support_webhook_lookup_failed", { code: authoritative.code });
    // Ask the provider to retry rather than record an unverified state.
    return { outcome: "retry", httpStatus: 503 };
  }

  const payment = authoritative.payment;
  let record;
  try {
    record = await deps.store.findPaymentByOrderId(payment.orderId);
  } catch (error) {
    log("error", "support_webhook_store_failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return { outcome: "retry", httpStatus: 503 };
  }

  // A payment TAPSO never initiated is not TAPSO's to record.
  if (!record) {
    log("warn", "support_webhook_unknown_order", { orderId: payment.orderId });
    return { outcome: "ignored", httpStatus: 200 };
  }

  if (payment.amount !== record.amount || payment.currency !== record.currency) {
    log("error", "support_webhook_amount_mismatch", { orderId: payment.orderId });
    const recorded = await applyStatus(deps, payment.orderId, record.status, "failed", {
      failureCode: "PAYMENT_MISMATCH",
    });
    return recorded ? { outcome: "applied", httpStatus: 200 } : { outcome: "retry", httpStatus: 503 };
  }

  const applied = await applyStatus(deps, payment.orderId, record.status, payment.status, {
    providerPaymentId: payment.providerPaymentId,
    confirmedAt: payment.status === "paid" ? (payment.approvedAt ?? isoNow(deps)) : undefined,
    failureCode: payment.failureCode,
  });
  if (!applied && canTransition(record.status, payment.status)) {
    return { outcome: "retry", httpStatus: 503 };
  }

  // Recorded after the work, so a transient failure above still gets retried.
  let seen: "recorded" | "duplicate" = "recorded";
  try {
    seen = await deps.store.recordWebhookEvent(deps.provider.name, eventId, eventType);
  } catch (error) {
    log("warn", "support_webhook_event_write_failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
  }

  if (seen === "duplicate") return { outcome: "duplicate", httpStatus: 200 };
  return { outcome: applied ? "applied" : "ignored", httpStatus: 200 };
}

/** Returns whether the write happened; a disallowed transition is a no-op. */
async function applyStatus(
  deps: ReadyDependencies | SupportDependencies,
  orderId: string,
  from: SupportPaymentStatus,
  to: SupportPaymentStatus,
  patch: { providerPaymentId?: string; failureCode?: string; confirmedAt?: string },
): Promise<boolean> {
  if (!deps.store) return false;
  if (!canTransition(from, to)) {
    log("warn", "support_transition_rejected", { orderId, from, to });
    return false;
  }
  try {
    await deps.store.updatePayment(orderId, { status: to, ...patch });
    return true;
  } catch (error) {
    log("error", "support_status_write_failed", {
      orderId,
      message: error instanceof Error ? error.message : "unknown error",
    });
    return false;
  }
}

function isoNow(deps: SupportDependencies): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

/** Constant-time comparison so the URL token cannot be probed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
