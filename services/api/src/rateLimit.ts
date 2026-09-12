/**
 * Per-caller burst control for the public transit API.
 *
 * The point is not authentication; it is keeping one abusive client from
 * spending the shared TAGO quota. Route caching absorbs the common case, so the
 * limiter only has to stop pathological fan-out (unique query strings, session
 * creation loops).
 *
 * In a serverless deployment each warm instance keeps its own counters, so the
 * effective limit is per instance, not global. That is stated plainly rather
 * than papered over: a global limiter would need a shared store, which this
 * phase deliberately does not add.
 */

export type RateLimitVerdict = {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
};

export type BurstLimiter = {
  readonly limit: number;
  readonly windowSeconds: number;
  consume(bucket: string, now?: number): RateLimitVerdict;
};

/** A fixed window keyed by bucket, pruned opportunistically so it stays bounded. */
export function createBurstLimiter(limit: number, windowSeconds: number): BurstLimiter {
  if (!Number.isInteger(limit) || limit <= 0) throw new RangeError("limit must be a positive integer");
  if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
    throw new RangeError("windowSeconds must be a positive integer");
  }
  const windowMs = windowSeconds * 1_000;
  const windows = new Map<string, { windowStart: number; hits: number }>();

  return {
    limit,
    windowSeconds,
    consume(bucket, now = Date.now()) {
      const windowStart = Math.floor(now / windowMs) * windowMs;

      if (windows.size > 4_096) {
        for (const [key, entry] of windows) {
          if (entry.windowStart !== windowStart) windows.delete(key);
        }
      }

      const existing = windows.get(bucket);
      const entry = existing && existing.windowStart === windowStart ? existing : { windowStart, hits: 0 };
      entry.hits += 1;
      windows.set(bucket, entry);

      const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1_000));
      return {
        allowed: entry.hits <= limit,
        retryAfterSeconds,
        remaining: Math.max(0, limit - entry.hits),
      };
    },
  };
}

/** Keeps a bucket key greppable in logs without publishing the raw client address. */
export function maskClientAddress(address: string): string {
  if (address === "unknown") return "unknown";
  if (address.includes(":")) return `${address.split(":").slice(0, 2).join(":")}::/32`;
  const parts = address.split(".");
  if (parts.length !== 4) return "unknown";
  return `${parts[0]}.${parts[1]}.x.x`;
}
