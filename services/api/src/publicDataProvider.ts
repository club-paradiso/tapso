import type { RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";
import {
  ProviderConfigurationError,
  ProviderResponseError,
  type TransitProvider,
} from "./provider.ts";

type FetchLike = typeof fetch;
type UnknownRecord = Record<string, unknown>;
type PublicDataRequest = { standardRegionCode: string; routeId?: string };

type RecordValue = Record<string, unknown>;
export interface PublicDataProviderOptions {
  serviceKey?: string;
  fetchImplementation?: typeof fetch;
  now?: () => Date;
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

export class PublicDataUltraPrecisionProvider implements TransitProvider {
  private readonly serviceKey?: string;
  private readonly baseURL: string;
  private readonly fetchImplementation: FetchLike;

  constructor(options: PublicDataProviderOptions = {}) {
    this.serviceKey = (options.serviceKey ?? process.env.PUBLIC_DATA_SERVICE_KEY ?? "").trim();
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async routeMasters(standardRegionCode: string): Promise<RouteMasterRecord[]> {
    const items = await this.request("/mst_info", { standardRegionCode });
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

  async routes(cityCode: string, routeNumber: string): Promise<TagoRoute[]> {
    const items = await this.request(ROUTES + "getRouteNoList", { cityCode, routeNo: routeNumber });
    return items.map(item => ({
      routeId: requiredText(item, "routeid"), routeNumber: requiredText(item, "routeno"),
      startStopName: text(item, "startnodenm"), endStopName: text(item, "endnodenm"),
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
    url.searchParams.set("stdgCd", request.standardRegionCode);
    if (request.routeId) url.searchParams.set("rteId", request.routeId);

  private async request(path: string, params: Record<string, string>, paged = true): Promise<RecordValue[]> {
    if (!this.serviceKey) throw new ProviderConfigurationError("PUBLIC_DATA_SERVICE_KEY is required for live transit calls");
    if (/%[0-9a-f]{2}/i.test(this.serviceKey)) {
      throw new ProviderConfigurationError("PUBLIC_DATA_SERVICE_KEY must contain the Decoding key, not the Encoding key");
    }
    for (const [name, value] of Object.entries(params)) {
      if (typeof value !== "string" || !value.trim()) throw new ProviderResponseError(`TAGO requires ${name}`);
    }
    const all: RecordValue[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const url = new URL(ROOT + path);
      url.search = new URLSearchParams({ ...params, serviceKey: this.serviceKey, _type: "json", ...(paged ? { pageNo: String(page), numOfRows: "100" } : {}) }).toString();
      let response: Response;
      let payload: unknown;
      try {
        response = await this.fetchImplementation(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000), redirect: "error" });
      } catch {
        // Never propagate upstream exceptions: they may contain the request URL/key.
        throw new ProviderResponseError("TAGO request failed or timed out");
      }
      if (!response.ok) throw new ProviderResponseError(`TAGO returned HTTP ${response.status}`);
      try { payload = await response.json(); } catch {
        throw new ProviderResponseError("TAGO returned a non-JSON response; check API approval and Decoding key");
      }
      if (!isRecord(payload) || !isRecord(payload.response) || !isRecord(payload.response.header)) {
        throw new ProviderResponseError("TAGO response has no valid header");
      }
      const code = text(payload.response.header, "resultCode");
      if (code !== "00") {
        const safeCode = code && /^\d{1,3}$/.test(code) ? code : "unknown";
        throw new ProviderResponseError(`TAGO service error ${safeCode}`);
      }
      const body = payload.response.body;
      if (!isRecord(body)) throw new ProviderResponseError("TAGO response has no valid body");
      const container = body.items;
      let items: RecordValue[] = [];
      if (container !== "" && container != null) {
        if (!isRecord(container)) throw new ProviderResponseError("TAGO items are invalid");
        const value = container.item;
        if (value != null && value !== "") {
          const list = Array.isArray(value) ? value : [value];
          if (!list.every(isRecord)) throw new ProviderResponseError("TAGO item is invalid");
          items = list;
        }
      }
      all.push(...items);
      if (!paged) return all;
      const total = number(body, "totalCount");
      if (total === undefined || total < 0 || !Number.isInteger(total)) throw new ProviderResponseError("TAGO totalCount is invalid");
      if (all.length >= total) return all;
      if (!items.length || number(body, "pageNo") !== page) throw new ProviderResponseError("TAGO pagination is incomplete");
    }
    throw new ProviderResponseError("TAGO pagination limit exceeded");
  }
}
function isRecord(value: unknown): value is RecordValue { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(item: RecordValue, key: string): string | undefined {
  const value = item[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
function requiredText(item: RecordValue, key: string): string {
  const value = text(item, key);
  if (!value) throw new ProviderResponseError(`TAGO missing field ${key}`);
  return value;
}
function number(item: RecordValue, key: string): number | undefined {
  const raw = text(item, key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
function requiredSequence(item: RecordValue, key: string): number {
  const value = number(item, key);
  if (value === undefined || value < 1 || !Number.isInteger(value)) throw new ProviderResponseError(`TAGO invalid sequence ${key}`);
  return value;
}
function coordinate(item: RecordValue, key: string, bound: number): number | undefined {
  const value = number(item, key);
  return value !== undefined && Math.abs(value) <= bound ? value : undefined;
}
