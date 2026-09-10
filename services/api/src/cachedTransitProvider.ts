import type { RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";
import type { TransitProvider } from "./provider.ts";

export const DEFAULT_STOP_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
export const DEFAULT_VEHICLE_CACHE_TTL_MS = 20_000;

export interface CachedTransitProviderOptions {
  stopTtlMs?: number;
  vehicleTtlMs?: number;
  now?: () => number;
}

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

/**
 * Shares one successful upstream result per route for a short window and
 * coalesces concurrent misses. Failed upstream calls are never cached.
 */
export class CachedTransitProvider implements TransitProvider {
  readonly policy: { stopTtlMs: number; vehicleTtlMs: number };

  private readonly upstream: TransitProvider;
  private readonly now: () => number;
  private readonly stopCache = new Map<string, CacheEntry<StopOnRoute[]>>();
  private readonly vehicleCache = new Map<string, CacheEntry<VehicleObservation[]>>();
  private readonly stopInflight = new Map<string, Promise<StopOnRoute[]>>();
  private readonly vehicleInflight = new Map<string, Promise<VehicleObservation[]>>();

  constructor(upstream: TransitProvider, options: CachedTransitProviderOptions = {}) {
    this.upstream = upstream;
    this.now = options.now ?? Date.now;
    this.policy = {
      stopTtlMs: normalizeTtl(options.stopTtlMs, DEFAULT_STOP_CACHE_TTL_MS),
      vehicleTtlMs: normalizeTtl(options.vehicleTtlMs, DEFAULT_VEHICLE_CACHE_TTL_MS),
    };
  }

  async stops(request: RouteRequest): Promise<StopOnRoute[]> {
    const result = await this.readThrough(
      routeKey(request),
      this.stopCache,
      this.stopInflight,
      this.policy.stopTtlMs,
      () => this.upstream.stops(request),
    );
    return result.map((item) => ({ ...item }));
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    const result = await this.readThrough(
      routeKey(request),
      this.vehicleCache,
      this.vehicleInflight,
      this.policy.vehicleTtlMs,
      () => this.upstream.vehicles(request),
    );
    return result.map((item) => ({ ...item }));
  }

  clear(request?: RouteRequest): void {
    if (!request) {
      this.stopCache.clear();
      this.vehicleCache.clear();
      return;
    }
    const key = routeKey(request);
    this.stopCache.delete(key);
    this.vehicleCache.delete(key);
  }

  private async readThrough<T>(
    key: string,
    cache: Map<string, CacheEntry<T>>,
    inflight: Map<string, Promise<T>>,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const now = this.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;

    const pending = inflight.get(key);
    if (pending) return pending;

    const promise = load()
      .then((value) => {
        cache.set(key, { value, expiresAt: this.now() + ttlMs });
        this.pruneExpired(cache);
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, promise);
    return promise;
  }

  private pruneExpired<T>(cache: Map<string, CacheEntry<T>>): void {
    if (cache.size <= 256) return;
    const now = this.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
  }
}

function routeKey(request: RouteRequest): string {
  return `${request.cityCode}:${request.routeId}`;
}

function normalizeTtl(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new RangeError("cache TTL must be a non-negative finite number");
  return value;
}
