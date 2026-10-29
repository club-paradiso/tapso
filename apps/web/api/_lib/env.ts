/**
 * Server-side configuration.
 *
 * Nothing in this module may be imported from `src/`. These values are secrets
 * and are only ever read inside a Vercel Function.
 */

import type { SupportAmountPolicy } from "./support/types.ts";

export type StoreConfig = {
  url: string;
  serviceRoleKey: string;
};

export type EmailConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
};

export type RateLimitPolicy = {
  burstLimit: number;
  burstWindowSeconds: number;
  sustainedLimit: number;
  sustainedWindowSeconds: number;
  /** A form completed faster than this is not being completed by a person. */
  minimumFillMilliseconds: number;
};

export type TossConfig = {
  secretKey: string;
  clientKey: string;
  apiBaseUrl: string;
  webhookToken?: string;
};

export type ServerEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

export const MILLION_SUPPORT_AMOUNT = 1_000_000;
const DEFAULT_PRESET_AMOUNTS = [3000, 5000, 10000, MILLION_SUPPORT_AMOUNT];

function trimmed(env: ServerEnv, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function positiveInt(env: ServerEnv, key: string, fallback: number): number {
  const raw = trimmed(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** `undefined` means the waitlist is not provisioned and must fail closed. */
export function readStoreConfig(env: ServerEnv = process.env): StoreConfig | undefined {
  const url = trimmed(env, "SUPABASE_URL");
  const serviceRoleKey = trimmed(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return undefined;
  return { url: url.replace(/\/+$/, ""), serviceRoleKey };
}

/** `undefined` means confirmation email is unconfigured; registration still works. */
export function readEmailConfig(env: ServerEnv = process.env): EmailConfig | undefined {
  const apiKey = trimmed(env, "RESEND_API_KEY");
  const from = trimmed(env, "WAITLIST_FROM_EMAIL");
  if (!apiKey || !from) return undefined;
  return { apiKey, from, replyTo: trimmed(env, "WAITLIST_REPLY_TO") };
}

/**
 * The consent text version the visitor actually agreed to. Recording it means a
 * later policy change does not silently rewrite what past visitors accepted.
 */
export function readPrivacyConsentVersion(env: ServerEnv = process.env): string {
  return trimmed(env, "PRIVACY_CONSENT_VERSION") ?? "2026-08-26";
}

export function readRateLimitPolicy(env: ServerEnv = process.env): RateLimitPolicy {
  return {
    burstLimit: positiveInt(env, "WAITLIST_BURST_LIMIT", 3),
    burstWindowSeconds: positiveInt(env, "WAITLIST_BURST_WINDOW_SECONDS", 60),
    sustainedLimit: positiveInt(env, "WAITLIST_RATE_LIMIT", 8),
    sustainedWindowSeconds: positiveInt(env, "WAITLIST_RATE_LIMIT_WINDOW_SECONDS", 3600),
    minimumFillMilliseconds: positiveInt(env, "WAITLIST_MIN_FILL_MS", 1200),
  };
}

/**
 * Support payment is off unless the operator both flips the switch and supplies
 * merchant credentials. Neither alone is enough: a half-configured payment path
 * is worse than a disabled one.
 */
export function readTossConfig(env: ServerEnv = process.env): TossConfig | undefined {
  if (trimmed(env, "SUPPORT_ENABLED") !== "true") return undefined;
  const secretKey = trimmed(env, "TOSS_SECRET_KEY");
  const clientKey = trimmed(env, "TOSS_CLIENT_KEY");
  const webhookToken = trimmed(env, "SUPPORT_WEBHOOK_TOKEN");
  // A public webhook endpoint must not be open without a shared secret.
  if (!secretKey || !clientKey || !webhookToken || webhookToken.length < 32) return undefined;

  const testPair = secretKey.startsWith("test_sk_") && clientKey.startsWith("test_ck_");
  const livePair = secretKey.startsWith("live_sk_") && clientKey.startsWith("live_ck_");
  if (!testPair && !livePair) return undefined;

  // Never silently let preview/local environments use real-money keys.
  // Never let production launch a test merchant and call it live support.
  const production = trimmed(env, "VERCEL_ENV") === "production";
  if ((production && !livePair) || (!production && !testPair)) return undefined;

  return {
    secretKey,
    clientKey,
    apiBaseUrl: trimmed(env, "TOSS_API_BASE_URL") ?? "https://api.tosspayments.com",
    webhookToken,
  };
}

export function readSupportAmountPolicy(env: ServerEnv = process.env): SupportAmountPolicy {
  const raw = trimmed(env, "SUPPORT_PRESET_AMOUNTS");
  const configuredPresets = raw
    ? raw
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isSafeInteger(value) && value > 0)
    : [];

  // ₩1,000,000 is a deliberate product easter egg. Keep it available even if
  // an older deployment still carries the pre-feature preset/max environment.
  const presetAmounts = Array.from(
    new Set([...(configuredPresets.length > 0 ? configuredPresets : DEFAULT_PRESET_AMOUNTS), MILLION_SUPPORT_AMOUNT]),
  ).sort((a, b) => a - b);
  const configuredMax = positiveInt(env, "SUPPORT_MAX_AMOUNT", MILLION_SUPPORT_AMOUNT);

  return {
    currency: "KRW",
    presetAmounts,
    minAmount: positiveInt(env, "SUPPORT_MIN_AMOUNT", 1000),
    maxAmount: Math.max(configuredMax, MILLION_SUPPORT_AMOUNT),
  };
}
