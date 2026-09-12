import type { RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";
import type { TransitProvider } from "./provider.ts";
import { TtlCache, type CachedResult } from "./ttlCache.ts";

export const DEFAULT_STOP_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
export const DEFAULT_VEHICLE_CACHE_TTL_MS = 20_000;

export interface CachedTransitProviderOptions {
  stopTtlMs?: number;
  vehicleTtlMs?: number;
  now?: () => number;
}

/**
 * Shares one successful upstream result per route for a short window and
 * coalesces concurrent misses. Failed upstream calls are never cached.
 *
 * In a serverless deployment this cache is per warm instance, so the shared
 * layer that actually bounds upstream fan-out is the CDN `s-maxage` the API
 * sets from the same policy. See `docs/PRODUCTION_TRANSIT_API.md`.
 */
export class CachedTransitProvider implements TransitProvider {
  readonly policy: { stopTtlMs: number; vehicleTtlMs: number };

  private readonly upstream: TransitProvider;
  private readonly stopCache: TtlCache<StopOnRoute[]>;
  private readonly vehicleCache: TtlCache<VehicleObservation[]>;

  constructor(upstream: TransitProvider, options: CachedTransitProviderOptions = {}) {
    this.upstream = upstream;
    const stopTtlMs = options.stopTtlMs ?? DEFAULT_STOP_CACHE_TTL_MS;
    const vehicleTtlMs = options.vehicleTtlMs ?? DEFAULT_VEHICLE_CACHE_TTL_MS;
    this.stopCache = new TtlCache<StopOnRoute[]>({ ttlMs: stopTtlMs, now: options.now });
    this.vehicleCache = new TtlCache<VehicleObservation[]>({ ttlMs: vehicleTtlMs, now: options.now });
    this.policy = { stopTtlMs: this.stopCache.ttlMs, vehicleTtlMs: this.vehicleCache.ttlMs };
  }

  async stops(request: RouteRequest): Promise<StopOnRoute[]> {
    return (await this.stopsResult(request)).value;
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    return (await this.vehiclesResult(request)).value;
  }

  /** Same read as `stops`, plus the cache outcome for structured logging. */
  async stopsResult(request: RouteRequest): Promise<CachedResult<StopOnRoute[]>> {
    const result = await this.stopCache.readThrough(routeKey(request), () => this.upstream.stops(request));
    return { value: result.value.map((item) => ({ ...item })), cache: result.cache };
  }

  /** Same read as `vehicles`, plus the cache outcome for structured logging. */
  async vehiclesResult(request: RouteRequest): Promise<CachedResult<VehicleObservation[]>> {
    const result = await this.vehicleCache.readThrough(routeKey(request), () => this.upstream.vehicles(request));
    return { value: result.value.map((item) => ({ ...item })), cache: result.cache };
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
}

function routeKey(request: RouteRequest): string {
  return `${request.cityCode}:${request.routeId}`;
}
