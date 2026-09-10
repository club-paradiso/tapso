import type { RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";
import {
  ProviderConfigurationError,
  ProviderResponseError,
  type TransitProvider,
} from "./provider.ts";

type FetchLike = typeof fetch;
type UnknownRecord = Record<string, unknown>;

export interface TagoTransitProviderOptions {
  serviceKey?: string;
  routeBaseURL?: string;
  locationBaseURL?: string;
  fetchImplementation?: FetchLike;
  now?: () => Date;
}

/**
 * Official Ministry of Land, Infrastructure and Transport TAGO adapter.
 *
 * RouteRequest.standardRegionCode carries TAGO cityCode for this provider.
 * TAGO location responses do not expose a provider observation timestamp, so
 * VehicleObservation.observedAt records TAPSO's snapshot acquisition time and
 * receiveType marks that limitation explicitly.
 */
export class TagoTransitProvider implements TransitProvider {
  private readonly serviceKey?: string;
  private readonly routeBaseURL: string;
  private readonly locationBaseURL: string;
  private readonly fetchImplementation: FetchLike;
  private readonly now: () => Date;

  constructor(options: TagoTransitProviderOptions = {}) {
    this.serviceKey = options.serviceKey ?? process.env.PUBLIC_DATA_SERVICE_KEY;
    this.routeBaseURL = options.routeBaseURL
      ?? process.env.TAGO_ROUTE_BASE_URL
      ?? "https://apis.data.go.kr/1613000/BusRouteInfoInqireService";
    this.locationBaseURL = options.locationBaseURL
      ?? process.env.TAGO_LOCATION_BASE_URL
      ?? "https://apis.data.go.kr/1613000/BusLcInfoInqireService";
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async stops(request: RouteRequest): Promise<StopOnRoute[]> {
    const items = await this.request(
      this.routeBaseURL,
      "/getRouteAcctoThrghSttnList",
      request,
    );
    return items.map((item) => ({
      stopId: requiredStringAny(item, "nodeid", "nodeId"),
      name: requiredStringAny(item, "nodenm", "nodeNm"),
      sequence: requiredNumber(item, "nodeord", "nodeOrd"),
      latitude: numberField(item, "gpslati", "gpsLati"),
      longitude: numberField(item, "gpslong", "gpsLong"),
    }));
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    const capturedAt = this.now().toISOString();
    const items = await this.request(
      this.locationBaseURL,
      "/getRouteAcctoBusLcList",
      request,
    );
    return items.map((item) => ({
      vehicleId: requiredStringAny(item, "vehicleno", "vehicleNo"),
      routeId: request.routeId,
      observedAt: capturedAt,
      stopSequence: numberField(item, "nodeord", "nodeOrd"),
      latitude: numberField(item, "gpslati", "gpsLati"),
      longitude: numberField(item, "gpslong", "gpsLong"),
      receiveType: "TAGO_SNAPSHOT",
    }));
  }

  private async request(baseURL: string, path: string, request: RouteRequest): Promise<UnknownRecord[]> {
    if (!this.serviceKey) {
      throw new ProviderConfigurationError("PUBLIC_DATA_SERVICE_KEY is required for TAGO live transit calls");
    }

    const url = new URL(`${baseURL}${path}`);
    url.searchParams.set("serviceKey", this.serviceKey);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "1000");
    url.searchParams.set("_type", "json");
    url.searchParams.set("cityCode", request.standardRegionCode);
    url.searchParams.set("routeId", request.routeId);

    const response = await this.fetchImplementation(url, {
      headers: {
        accept: "application/json",
        "user-agent": "TAPSO-live-transit/1.0",
        connection: "close",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new ProviderResponseError(`TAGO provider returned HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    const envelope = extractEnvelope(payload);
    const resultCode = stringField(envelope.header, "resultCode");
    const resultMessage = stringField(envelope.header, "resultMsg");

    if (resultCode && resultCode !== "00" && resultCode !== "0") {
      throw new ProviderResponseError(
        `TAGO provider error ${resultCode}: ${resultMessage ?? "unknown provider error"}`,
      );
    }

    return extractItems(envelope.body);
  }
}

function extractEnvelope(payload: unknown): { header: UnknownRecord; body: UnknownRecord } {
  if (!isRecord(payload)) throw new ProviderResponseError("TAGO payload is not an object");
  const response = payload.response;
  if (!isRecord(response)) throw new ProviderResponseError("TAGO payload has no response object");
  const header = response.header;
  const body = response.body;
  if (!isRecord(header)) throw new ProviderResponseError("TAGO payload has no header object");
  if (!isRecord(body)) throw new ProviderResponseError("TAGO payload has no body object");
  return { header, body };
}

function extractItems(body: UnknownRecord): UnknownRecord[] {
  const itemsContainer = body.items;
  if (itemsContainer === "" || itemsContainer == null) return [];
  const value = isRecord(itemsContainer) ? itemsContainer.item : itemsContainer;
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) return [value];
  return [];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(item: UnknownRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function requiredStringAny(item: UnknownRecord, ...keys: string[]): string {
  const value = stringField(item, ...keys);
  if (!value) throw new ProviderResponseError(`Missing TAGO field: ${keys.join("|")}`);
  return value;
}

function numberField(item: UnknownRecord, ...keys: string[]): number | undefined {
  const raw = stringField(item, ...keys);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function requiredNumber(item: UnknownRecord, ...keys: string[]): number {
  const value = numberField(item, ...keys);
  if (value === undefined) throw new ProviderResponseError(`Missing TAGO numeric field: ${keys.join("|")}`);
  return value;
}
