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

export interface TagoCity {
  cityCode: string;
  name: string;
}

export interface TagoRoute {
  routeId: string;
  routeNumber: string;
  startStopName?: string;
  endStopName?: string;
}

/** Official Ministry of Land, Infrastructure and Transport TAGO adapter. */
export class TagoTransitProvider implements TransitProvider {
  private readonly serviceKey: string;
  private readonly routeBaseURL: string;
  private readonly locationBaseURL: string;
  private readonly fetchImplementation: FetchLike;
  private readonly now: () => Date;

  constructor(options: TagoTransitProviderOptions = {}) {
    this.serviceKey = (options.serviceKey ?? process.env.PUBLIC_DATA_SERVICE_KEY ?? "").trim();
    this.routeBaseURL = options.routeBaseURL
      ?? process.env.TAGO_ROUTE_BASE_URL
      ?? "https://apis.data.go.kr/1613000/BusRouteInfoInqireService";
    this.locationBaseURL = options.locationBaseURL
      ?? process.env.TAGO_LOCATION_BASE_URL
      ?? "https://apis.data.go.kr/1613000/BusLcInfoInqireService";
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async cities(): Promise<TagoCity[]> {
    const items = await this.request(this.routeBaseURL, "/getCtyCodeList", {}, false);
    return items.map((item) => ({
      cityCode: requiredStringAny(item, "citycode", "cityCode"),
      name: requiredStringAny(item, "cityname", "cityName"),
    }));
  }

  async routes(cityCode: string, routeNumber: string): Promise<TagoRoute[]> {
    const items = await this.request(this.routeBaseURL, "/getRouteNoList", {
      cityCode,
      routeNo: routeNumber,
    });
    return items.map((item) => ({
      routeId: requiredStringAny(item, "routeid", "routeId"),
      routeNumber: requiredStringAny(item, "routeno", "routeNo"),
      startStopName: stringField(item, "startnodenm", "startNodeNm"),
      endStopName: stringField(item, "endnodenm", "endNodeNm"),
    }));
  }

  async stops(request: RouteRequest): Promise<StopOnRoute[]> {
    const items = await this.request(this.routeBaseURL, "/getRouteAcctoThrghSttnList", {
      cityCode: request.cityCode,
      routeId: request.routeId,
    });
    return items.map((item) => ({
      stopId: requiredStringAny(item, "nodeid", "nodeId"),
      name: requiredStringAny(item, "nodenm", "nodeNm"),
      sequence: requiredNumber(item, "nodeord", "nodeOrd"),
      directionCode: stringField(item, "updowncd", "upDownCd"),
      latitude: numberField(item, "gpslati", "gpsLati"),
      longitude: numberField(item, "gpslong", "gpsLong"),
    })).sort((a, b) => a.sequence - b.sequence);
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    const capturedAt = this.now().toISOString();
    const items = await this.request(this.locationBaseURL, "/getRouteAcctoBusLcList", {
      cityCode: request.cityCode,
      routeId: request.routeId,
    });
    return items.map((item) => ({
      vehicleId: requiredStringAny(item, "vehicleno", "vehicleNo"),
      routeId: request.routeId,
      observedAt: capturedAt,
      stopId: stringField(item, "nodeid", "nodeId"),
      stopName: stringField(item, "nodenm", "nodeNm"),
      stopSequence: numberField(item, "nodeord", "nodeOrd"),
      latitude: numberField(item, "gpslati", "gpsLati"),
      longitude: numberField(item, "gpslong", "gpsLong"),
      receiveType: "TAGO_SNAPSHOT",
    }));
  }

  private async request(
    baseURL: string,
    path: string,
    params: Record<string, string>,
    paged = true,
  ): Promise<UnknownRecord[]> {
    if (!this.serviceKey) {
      throw new ProviderConfigurationError("PUBLIC_DATA_SERVICE_KEY is required for TAGO live transit calls");
    }
    if (/%[0-9a-f]{2}/i.test(this.serviceKey)) {
      throw new ProviderConfigurationError("PUBLIC_DATA_SERVICE_KEY must contain the Decoding key, not the Encoding key");
    }
    for (const [name, value] of Object.entries(params)) {
      if (!value.trim()) throw new ProviderResponseError(`TAGO requires ${name}`);
    }

    const all: UnknownRecord[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const url = new URL(`${baseURL}${path}`);
      url.searchParams.set("serviceKey", this.serviceKey);
      url.searchParams.set("_type", "json");
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
      if (paged) {
        url.searchParams.set("pageNo", String(page));
        url.searchParams.set("numOfRows", "100");
      }

      let response: Response;
      try {
        response = await this.fetchImplementation(url, {
          headers: {
            accept: "application/json",
            "user-agent": "TAPSO-live-transit/1.0",
            connection: "close",
          },
          signal: AbortSignal.timeout(8_000),
          redirect: "error",
        });
      } catch {
        throw new ProviderResponseError("TAGO request failed or timed out");
      }
      if (!response.ok) throw new ProviderResponseError(`TAGO provider returned HTTP ${response.status}`);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ProviderResponseError("TAGO returned a non-JSON response");
      }
      const envelope = extractEnvelope(payload);
      const resultCode = stringField(envelope.header, "resultCode");
      const resultMessage = stringField(envelope.header, "resultMsg");
      if (resultCode && resultCode !== "00" && resultCode !== "0") {
        throw new ProviderResponseError(
          `TAGO provider error ${resultCode}: ${resultMessage ?? "unknown provider error"}`,
        );
      }

      const items = extractItems(envelope.body);
      all.push(...items);
      if (!paged) return all;

      const total = numberField(envelope.body, "totalCount");
      if (total === undefined || total < 0 || !Number.isInteger(total)) {
        throw new ProviderResponseError("TAGO totalCount is invalid");
      }
      if (all.length >= total) return all;
      if (!items.length || numberField(envelope.body, "pageNo") !== page) {
        throw new ProviderResponseError("TAGO pagination is incomplete");
      }
    }
    throw new ProviderResponseError("TAGO pagination limit exceeded");
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
  if (Array.isArray(value)) {
    if (!value.every(isRecord)) throw new ProviderResponseError("TAGO item is invalid");
    return value;
  }
  if (isRecord(value)) return [value];
  throw new ProviderResponseError("TAGO items are invalid");
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(item: UnknownRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
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
  if (value === undefined || value < 1 || !Number.isInteger(value)) {
    throw new ProviderResponseError(`Missing TAGO numeric field: ${keys.join("|")}`);
  }
  return value;
}
