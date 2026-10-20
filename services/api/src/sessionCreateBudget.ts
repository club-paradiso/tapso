/**
 * A deployment-wide ceiling on new journey sessions per minute.
 *
 * Every `POST /v1/sessions` costs two uncached TAGO reads (stops, then
 * vehicles), and every live session keeps reading while it lasts. The public
 * burst limiter (`rateLimit.ts`) is per caller and per warm instance, so it
 * cannot bound the total. This budget can: with the Redis session store it is
 * one counter shared by every instance, keyed by the minute.
 *
 * The default is sized for a supervised field pilot, not for launch:
 * `DEFAULT_SESSION_CREATE_LIMIT_PER_MINUTE` new rides a minute is far above
 * what a pilot of tens of riders produces, and caps the creation cost at twice
 * that in TAGO reads. An operator raises it with
 * `TRANSIT_SESSION_CREATE_LIMIT_PER_MINUTE`, or sets 0 to switch it off.
 *
 * Over budget the rider is told to try again shortly (429 with Retry-After);
 * the app already treats `RATE_LIMITED` as a retry, never as a ride.
 */

import type { ServerEnv } from "./apiConfig.ts";
import { upstashCommand, type UpstashConnection } from "./upstashRest.ts";

export const DEFAULT_SESSION_CREATE_LIMIT_PER_MINUTE = 30;
const WINDOW_MS = 60_000;

export type SessionCreateVerdict = { allowed: boolean; retryAfterSeconds: number };

export interface SessionCreateBudget {
  readonly limitPerMinute: number;
  take(nowMs?: number): Promise<SessionCreateVerdict>;
}

/** The configured limit: a non-negative integer, `0` meaning off. */
export function readSessionCreateLimit(env: ServerEnv): number {
  const raw = env.TRANSIT_SESSION_CREATE_LIMIT_PER_MINUTE?.trim();
  if (!raw) return DEFAULT_SESSION_CREATE_LIMIT_PER_MINUTE;
  if (!/^[0-9]{1,6}$/.test(raw)) {
    throw new RangeError("TRANSIT_SESSION_CREATE_LIMIT_PER_MINUTE must be a non-negative integer");
  }
  return Number(raw);
}

function verdict(count: number, limit: number, nowMs: number): SessionCreateVerdict {
  const windowEnd = (Math.floor(nowMs / WINDOW_MS) + 1) * WINDOW_MS;
  return { allowed: count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - nowMs) / 1_000)) };
}

/** One process's budget: the honest choice for the memory session store, which is one process too. */
export class MemorySessionCreateBudget implements SessionCreateBudget {
  readonly limitPerMinute: number;
  private window = -1;
  private count = 0;

  constructor(limitPerMinute: number) {
    if (!Number.isInteger(limitPerMinute) || limitPerMinute <= 0) throw new RangeError("limitPerMinute must be a positive integer");
    this.limitPerMinute = limitPerMinute;
  }

  async take(nowMs = Date.now()): Promise<SessionCreateVerdict> {
    const window = Math.floor(nowMs / WINDOW_MS);
    if (window !== this.window) {
      this.window = window;
      this.count = 0;
    }
    this.count += 1;
    return verdict(this.count, this.limitPerMinute, nowMs);
  }
}

export class SessionCreateBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionCreateBudgetError";
  }
}

/**
 * One counter per minute in the session store's namespace, shared by every
 * instance. A store that cannot be reached throws: a session could not be
 * stored either, so refusing early is the same outcome.
 */
export class UpstashSessionCreateBudget implements SessionCreateBudget {
  readonly limitPerMinute: number;
  private readonly connection: UpstashConnection;
  private readonly keyPrefix: string;

  constructor(connection: UpstashConnection, keyPrefix: string, limitPerMinute: number) {
    if (!Number.isInteger(limitPerMinute) || limitPerMinute <= 0) throw new RangeError("limitPerMinute must be a positive integer");
    this.connection = connection;
    this.keyPrefix = keyPrefix;
    this.limitPerMinute = limitPerMinute;
  }

  async take(nowMs = Date.now()): Promise<SessionCreateVerdict> {
    const key = `${this.keyPrefix}create-budget:${Math.floor(nowMs / WINDOW_MS)}`;
    const fail = (message: string) => new SessionCreateBudgetError(message);
    const count = await upstashCommand(this.connection, ["INCR", key], "the session budget", fail);
    if (typeof count !== "number" || !Number.isInteger(count)) throw fail("the session budget returned a malformed count");
    // Two windows long, so a key never outlives the minute after its own.
    if (count === 1) await upstashCommand(this.connection, ["PEXPIRE", key, String(2 * WINDOW_MS)], "the session budget", fail);
    return verdict(count, this.limitPerMinute, nowMs);
  }
}
