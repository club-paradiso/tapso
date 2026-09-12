/**
 * One read-through cache primitive for every shared upstream read.
 *
 * A successful result is reused for a bounded window and concurrent misses for
 * the same key share a single upstream call. Failures are never stored, so a
 * provider outage can never be replayed as a success.
 */

export type CacheOutcome = "hit" | "miss" | "coalesced";

export interface CachedResult<T> {
  value: T;
  cache: CacheOutcome;
}

export interface TtlCacheOptions {
  ttlMs: number;
  now?: () => number;
  /** Opportunistic prune threshold; entries are bounded, never unbounded. */
  maxEntries?: number;
}

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

export class TtlCache<T> {
  readonly ttlMs: number;

  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(options: TtlCacheOptions) {
    this.ttlMs = normalizeTtl(options.ttlMs);
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 256;
  }

  async readThrough(key: string, load: () => Promise<T>): Promise<CachedResult<T>> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) return { value: cached.value, cache: "hit" };

    const pending = this.inflight.get(key);
    if (pending) return { value: await pending, cache: "coalesced" };

    const promise = load()
      .then((value) => {
        // The expiry is measured from completion, so a slow upstream call does
        // not shorten the window the result is actually reused for.
        this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
        this.prune();
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return { value: await promise, cache: "miss" };
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(): void {
    if (this.entries.size <= this.maxEntries) return;
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

function normalizeTtl(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("cache TTL must be a non-negative finite number");
  }
  return value;
}
