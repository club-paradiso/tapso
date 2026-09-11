import type { RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";
import {
  ProviderConfigurationError,
  ProviderResponseError,
  type TransitProvider,
} from "./provider.ts";

type FetchLike = typeof fetch;
type UnknownRecord = Record<string, unknown>;
type PublicDataRequest = { cityCode: string; routeId?: string };

export interface PublicDataProviderOptions {
  serviceKey?: string;
  baseURL?: string;
  fetchImplementation?: FetchLike;
}

export interface RouteMasterRecord {
  routeId: string;
  routeNumber: string;
  routeType?: string;
  originName?: string;
  destinationName?: string;
  firstDepartureTime?: string;
  lastDepartureTime?: string;
}

/** B551982 nationwide ultra-precision bus adapter. */
export class PublicDataUltraPrecisionProvider implements TransitProvider {
  private readonly serviceKey?: string;
  private readonly baseURL: string;
  private readonly fetchImplementation: FetchLike;

  constructor(options: PublicDataProviderOptions = {}) {
    this.serviceKey = (options.serviceKey ?? process.env.PUBLIC_DATA_SERVICE_KEY ?? "").trim();
    this.baseURL = options.baseURL ?? process.env.PUBLIC_DATA_BASE_URL ?? "https://apis.data.go.kr/B551982/rte";
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async routeMasters(standardRegionCode: string): Promise<RouteMasterRecord[]> {
    const items = await this.request("/mst_info", { cityCode: standardRegionCode });
    return items.map((item) => ({
      routeId: requiredStringAny(item, "rteId", "routeId"),
      routeNumber: requiredStringAny(item, "rteNo", "routeNo"),
      routeType: stringField(item, "rteTp", "rteTpNm", "rteType"),
      originName: stringField(item, "stStaNm", "orgnStaNm", "startNm"),
      destinationName: stringField(item, "edStaNm", "dstnStaNm", "endNm"),
      firstDepartureTime: stringField(item, "fstTm", "firstTm"),
      lastDepartureTime: stringField(item, "lstTm", "lastTm"),
    }));
  }

  async stops(request: RouteRequest): Promise<StopOnRoute[]> {
    const items = await this.request("/ps_info", request);
    return items.map((item) => ({
      stopId: requiredStringAny(item, "stopId", "stop_no", "sttnId", "staId"),
      name: requiredStringAny(item, "stopNm", "sttnNm", "staNm"),
      sequence: requiredNumber(item, "stopSeq", "sttnSeq", "staOrd"),
      directionCode: stringField(item, "drcGbnCd"),
      latitude: numberField(item, "lat", "gpsY"),
      longitude: numberField(item, "lot", "lon", "gpsX"),
    }));
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    const items = await this.request("/rtm_loc_info", request);
    return items.map((item) => ({
      vehicleId: requiredStringAny(item, "vhclNo"),
      routeId: stringField(item, "rteId") ?? request.routeId,
      observedAt: normalizeTimestamp(stringField(item, "gthrDt")),
      stopSequence: numberField(item, "stopSeq", "sttnSeq", "staOrd"),
      directionCode: stringField(item, "oprDrct", "drcGbnCd"),
      latitude: numberField(item, "lat"),
      longitude: numberField(item, "lot", "lon"),
      speedKph: numberField(item, "oprSpd"),
      headingDegrees: numberField(item, "agdr", "heading"),
      eventCode: stringField(item, "evtCd", "evtType"),
      receiveType: stringField(item, "rcvType"),
    }));
  }

  private async request(path: string, request: PublicDataRequest): Promise<UnknownRecord[]> {
    if (!this.serviceKey) {
      throw new ProviderConfigurationError("PUBLIC_DATA_SERVICE_KEY is required for live transit calls");
    }

    const url = new URL(`${this.baseURL}${path}`);
    url.searchParams.set("serviceKey", this.serviceKey);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "1000");
    url.searchParams.set("type", "json");
    url.searchParams.set("stdgCd", request.cityCode);
    if (request.routeId) url.searchParams.set("rteId", request.routeId);

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new ProviderResponseError("Transit provider request failed or timed out");
    }
    if (!response.ok) {
      throw new ProviderResponseError(`Transit provider returned HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderResponseError("Transit provider returned a non-JSON response");
    }
    const envelope = extractEnvelope(payload);
    const resultCode = stringField(envelope.header, "resultCode");
    const resultMessage = stringField(envelope.header, "resultMsg");

    if (resultCode === "K3" && resultMessage === "NODATA_ERROR") {
      return [];
    }
    if (resultCode && resultCode !== "00" && resultCode !== "0") {
      throw new ProviderResponseError(
        `Transit provider error ${resultCode}: ${resultMessage ?? "unknown provider error"}`,
      );
    }

    return extractItems(envelope.body);
  }
}

function extractEnvelope(payload: unknown): { header: UnknownRecord; body: UnknownRecord } {
  if (!isRecord(payload)) throw new ProviderResponseError("Provider payload is not an object");

  const nestedResponse = payload.response;
  const container = isRecord(nestedResponse) ? nestedResponse : payload;
  const header = container.header;
  const body = container.body;

  if (!isRecord(header)) throw new ProviderResponseError("Provider payload has no header object");
  if (!isRecord(body)) throw new ProviderResponseError("Provider payload has no body object");

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
  if (!value) throw new ProviderResponseError(`Missing required field: ${keys.join("|")}`);
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
  if (value === undefined) throw new ProviderResponseError(`Missing required numeric field: ${keys.join("|")}`);
  return value;
}

function normalizeTimestamp(value?: string): string {
  if (!value) return new Date(0).toISOString();
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? new Date(0).toISOString() : date.toISOString();
}
