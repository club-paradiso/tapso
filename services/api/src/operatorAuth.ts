/**
 * Authentication for the operator-only ride-capture endpoints.
 *
 * These endpoints exist for one reason: Task B measures how often TAGO's own
 * content changes, and the public `/v1/vehicles` path answers from a 20-second
 * cache. Polling that cache would measure the cache. So the operator path calls
 * the provider directly — and because it does, it must not be open.
 *
 * The token is a shared secret held only in the server environment. It is never
 * echoed, never logged, and compared against the presented value in constant
 * time through equal-length digests, so a wrong guess reveals nothing about how
 * wrong it was.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const OPERATOR_TOKEN_ENV = "RIDE_CAPTURE_OPERATOR_TOKEN";

/** Long enough that a leaked deployment cannot be brute-forced from outside. */
const MINIMUM_TOKEN_LENGTH = 24;

export type OperatorTokenEnv = Record<string, string | undefined>;

export interface OperatorCredential {
  /** The configured token, or an empty string when the endpoints stay disabled. */
  token: string;
  configured: boolean;
  /** Set when a token is present but too weak to accept. */
  problem?: string;
}

export function resolveOperatorToken(env: OperatorTokenEnv = process.env as OperatorTokenEnv): OperatorCredential {
  const raw = env[OPERATOR_TOKEN_ENV];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { token: "", configured: false };
  if (value.length < MINIMUM_TOKEN_LENGTH) {
    // Refuse rather than accept: a short shared secret on a public host is the
    // same as no secret, and failing closed here is visible in `/health`.
    return { token: "", configured: false, problem: `${OPERATOR_TOKEN_ENV} must be at least ${MINIMUM_TOKEN_LENGTH} characters` };
  }
  return { token: value, configured: true };
}

/** `Authorization: Bearer <token>` → the token, or undefined for anything else. */
export function readBearerToken(headerValue: string | null | undefined): string | undefined {
  if (typeof headerValue !== "string") return undefined;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(headerValue.trim());
  return match ? match[1] : undefined;
}

/**
 * Constant-time comparison. Both sides are hashed first so the buffers are the
 * same length whatever was presented, which is what keeps the comparison itself
 * from leaking the token's length.
 */
export function operatorTokenMatches(expected: string, presented: string | undefined): boolean {
  if (!expected || !presented) return false;
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const presentedDigest = createHash("sha256").update(presented, "utf8").digest();
  return timingSafeEqual(expectedDigest, presentedDigest);
}
