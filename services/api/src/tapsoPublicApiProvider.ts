/**
 * Reads TAPSO's own public transit API as a `TransitProvider`.
 *
 * This is not a TAGO client. It calls `/v1/stops`, `/v1/vehicles` and
 * `/v1/routes` on a TAPSO deployment, which itself reads TAGO through the one
 * `TagoTransitProvider`. It exists for passive collection from a runner that
 * holds no TAGO credential. Two consequences are recorded on every stream it
 * feeds (`providerPath: "tapso-public-api"`):
 *
 *   - `/v1/vehicles` is served through a 20 s shared cache, so genuine receipts
 *     arrive at most about every 20 s, not every 5 s like a journey session;
 *   - items are the deployment's own `VehicleObservation` JSON, validated here
 *     and rejected whole if anything is off. Failing closed beats trusting a
 *     shape nobody checked.
 */

import type { RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";
import { ProviderResponseError, ProviderUnavailableError, providerTransportError, type TransitProvider } from "./provider.ts";
import type { RouteDiscovery } from "./passiveShadowCollector.ts";

type FetchLike = typeof fetch;

export class TapsoPublicApiProvider implements TransitProvider, RouteDiscovery {
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchLike;

  constructor(options: { baseUrl: string; fetchImplementation?: FetchLike }) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      throw new Error("TAPSO public API base URL must be https");
    }
    this.baseUrl = url.origin;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async stops(request: RouteRequest): Promise<StopOnRoute[]> {
    const items = await this.items("/v1/stops", { cityCode: request.cityCode, routeId: request.routeId });
    return items.map((item) => {
      if (typeof item.stopId !== "string" || typeof item.name !== "string" || !Number.isInteger(item.sequence)) {
        throw new ProviderResponseError("TAPSO API stop item is invalid");
      }
      return {
        stopId: item.stopId,
        name: item.name,
        sequence: item.sequence as number,
        ...(typeof item.directionCode === "string" ? { directionCode: item.directionCode } : {}),
        ...(finite(item.latitude) ? { latitude: item.latitude as number } : {}),
        ...(finite(item.longitude) ? { longitude: item.longitude as number } : {}),
      };
    }).sort((left, right) => left.sequence - right.sequence);
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    const items = await this.items("/v1/vehicles", { cityCode: request.cityCode, routeId: request.routeId });
    return items.map((item) => {
      if (typeof item.vehicleId !== "string" || !item.vehicleId.trim()) throw new ProviderResponseError("TAPSO API vehicle item has no vehicleId");
      if (item.routeId !== request.routeId) throw new ProviderResponseError("TAPSO API vehicle item is for another route");
      if (item.timestampSource !== "unavailable") {
        // TAGO publishes no observation time. Anything else here means the
        // deployment is not the TAGO path this stream claims to be.
        throw new ProviderResponseError("TAPSO API vehicle item does not carry timestampSource=unavailable");
      }
      if (typeof item.receivedAt !== "string" || !Number.isFinite(Date.parse(item.receivedAt))) {
        throw new ProviderResponseError("TAPSO API vehicle item has no receipt time");
      }
      return {
        vehicleId: item.vehicleId,
        routeId: request.routeId,
        observedAt: typeof item.observedAt === "string" ? item.observedAt : new Date(0).toISOString(),
        receivedAt: item.receivedAt,
        timestampSource: "unavailable" as const,
        ...(typeof item.stopId === "string" ? { stopId: item.stopId } : {}),
        ...(typeof item.stopName === "string" ? { stopName: item.stopName } : {}),
        ...(Number.isInteger(item.stopSequence) ? { stopSequence: item.stopSequence as number } : {}),
        ...(typeof item.directionCode === "string" ? { directionCode: item.directionCode } : {}),
        ...(finite(item.latitude) ? { latitude: item.latitude as number } : {}),
        ...(finite(item.longitude) ? { longitude: item.longitude as number } : {}),
        ...(typeof item.receiveType === "string" ? { receiveType: item.receiveType } : {}),
      };
    });
  }

  async routes(cityCode: string, routeNumber: string): Promise<Array<{ routeId: string }>> {
    const items = await this.items("/v1/routes", { cityCode, routeNo: routeNumber });
    return items
      .filter((item) => typeof item.routeId === "string" && item.routeId.trim())
      .map((item) => ({ routeId: item.routeId as string }));
  }

  private async items(path: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
    const url = new URL(path, this.baseUrl);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        headers: { accept: "application/json", "user-agent": "TAPSO-passive-shadow-v3/1.0" },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
    } catch (error) {
      throw providerTransportError(error, "TAPSO API");
    }
    if (!response.ok) throw new ProviderUnavailableError(`TAPSO API returned HTTP ${response.status}`);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderResponseError("TAPSO API returned a non-JSON response");
    }
    const items = (payload as { items?: unknown })?.items;
    if (!Array.isArray(items) || !items.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      throw new ProviderResponseError("TAPSO API response has no items array");
    }
    return items as Record<string, unknown>[];
  }
}

function finite(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}
