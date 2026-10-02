import type { RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";
import {
  ProviderConfigurationError,
  ProviderResponseError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  providerTransportError,
  type TransitProvider,
} from "./provider.ts";
import { logProviderRequest, type ProviderOutcome, type ProviderRequestRecord } from "./providerHealth.ts";
import { CANONICAL_SERVICE_KEY_ENV, resolveTagoServiceKey } from "./serviceKey.ts";

type FetchLike = typeof fetch;
type UnknownRecord = Record<string, unknown>;

const TAGO_TRANSIENT_ATTEMPTS = 2;
const TAGO_RETRY_DELAY_MS = 250;
/**
 * The whole of one logical request (every page and retry) gets this long.
 * Production saw 12–14 s answers when each of two attempts had 8 s of its own
 * and nothing bounded their sum; the app gives up on a request at 20 s and a
 * rider at a stop much sooner. A slow feed now answers `PROVIDER_TIMEOUT`
 * within this budget instead of a late success or a later 502.
 */
export const TAGO_REQUEST_DEADLINE_MS = 9_000;
/** One attempt never takes longer than this, nor longer than what is left of the deadline. */
export const TAGO_ATTEMPT_TIMEOUT_MS = 6_000;
/** A retry is only worth starting with at least this much of the deadline left. */
export const TAGO_MINIMUM_RETRY_BUDGET_MS = 2_000;

export interface TagoTransitProviderOptions {
  serviceKey?: string;
  routeBaseURL?: string;
  locationBaseURL?: string;
  fetchImplementation?: FetchLike;
  now?: () => Date;
  /** Overrides for tests; production uses the constants above. */
  deadlineMs?: number;
  attemptTimeoutMs?: number;
  minimumRetryBudgetMs?: number;
  /** Monotonic milliseconds for the deadline. Defaults to `performance.now`. */
  clock?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** 0 ≤ value < 1; spreads concurrent retries. Defaults to `Math.random`. */
  random?: () => number;
  /** Receives one record per logical request. Defaults to a structured log line. */
  onRequest?: (record: ProviderRequestRecord) => void;
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
  /** The provider's own classification. Reported, never interpreted. */
  routeType?: string;
}

/**
 * What `getRouteInfoIem` publishes about one route's service day
 * (REPORTED-OFFICIAL, data.go.kr dataset 15098529, read 2026-10-01): the first
 * and last departure as HHMM and the average headway in minutes for weekdays,
 * Saturdays and Sundays. All five are optional in the documentation, so an
 * absent or malformed value stays absent rather than becoming a guess.
 *
 * The times are departures from the route's starting stop (기점). A bus reaches
 * every later stop after that, so "be at your stop by the last departure" is a
 * conservative rule, never a promise about when the bus passes it.
 */
export type ServiceDayField = "startvehicletime" | "endvehicletime" | "intervaltime" | "intervalsattime" | "intervalsuntime";

export interface TagoRouteServiceHours {
  routeId: string;
  routeNumber?: string;
  routeType?: string;
  startStopName?: string;
  endStopName?: string;
  /** `HH:MM`, Korean local time, from the starting stop. */
  firstDeparture?: string;
  lastDeparture?: string;
  /** Average minutes between buses, as published; never a timetable. */
  headwayMinutes: { weekday?: number; saturday?: number; sunday?: number };
  /**
   * Service-day fields TAGO sent in a shape its documentation does not give
   * (`HHMM`, whole minutes): the field name and the raw text, trimmed and cut to
   * 16 characters. Never parsed: it only lets a probe tell "TAGO publishes
   * nothing" from "TAGO publishes something else". Public schedule data.
   */
  undocumented?: Partial<Record<ServiceDayField, string>>;
}

/** Official Ministry of Land, Infrastructure and Transport TAGO adapter. */
export class TagoTransitProvider implements TransitProvider {
  private readonly serviceKey: string;
  private readonly routeBaseURL: string;
  private readonly locationBaseURL: string;
  private readonly fetchImplementation: FetchLike;
  private readonly now: () => Date;
  private readonly deadlineMs: number;
  private readonly attemptTimeoutMs: number;
  private readonly minimumRetryBudgetMs: number;
  private readonly clock: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly onRequest: (record: ProviderRequestRecord) => void;

  constructor(options: TagoTransitProviderOptions = {}) {
    // Resolved through the shared helper so the provider and the health payload
    // can never disagree about whether a credential is configured.
    this.serviceKey = (options.serviceKey ?? resolveTagoServiceKey().key).trim();
    this.routeBaseURL = options.routeBaseURL
      ?? "https://apis.data.go.kr/1613000/BusRouteInfoInqireService";
    this.locationBaseURL = options.locationBaseURL
      ?? "https://apis.data.go.kr/1613000/BusLcInfoInqireService";
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.deadlineMs = options.deadlineMs ?? TAGO_REQUEST_DEADLINE_MS;
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? TAGO_ATTEMPT_TIMEOUT_MS;
    this.minimumRetryBudgetMs = options.minimumRetryBudgetMs ?? TAGO_MINIMUM_RETRY_BUDGET_MS;
    this.clock = options.clock ?? (() => performance.now());
    this.sleep = options.sleep ?? delay;
    this.random = options.random ?? Math.random;
    this.onRequest = options.onRequest ?? logProviderRequest;
  }

  async cities(): Promise<TagoCity[]> {
    const items = await this.request(this.routeBaseURL, "/getCtyCodeList", {}, false);
    return items.map((item) => ({
      cityCode: requiredStringAny(item, "citycode", "cityCode"),
      name: requiredStringAny(item, "cityname", "cityName"),
    }));
  }

  async routes(cityCode: string, routeNumber: string): Promise<TagoRoute[]> {
    return this.routeRows(cityCode, { routeNo: routeNumber });
  }

  /**
   * Every route the provider lists for a city, with no route number to filter
   * by. Whether TAGO answers this at all is the provider's decision, not an
   * assumption made here: the call is made, and whatever comes back — rows or an
   * error — is the answer. Callers must be able to work without it.
   */
  async allRoutes(cityCode: string): Promise<TagoRoute[]> {
    return this.routeRows(cityCode, {});
  }

  private async routeRows(cityCode: string, extra: Record<string, string>): Promise<TagoRoute[]> {
    const items = await this.request(this.routeBaseURL, "/getRouteNoList", { cityCode, ...extra });
    return items.map((item) => {
      // Absent stays absent: an explicit `undefined` key would claim the
      // provider answered the question and said nothing.
      const routeType = stringField(item, "routetp", "routeTp");
      return {
        routeId: requiredStringAny(item, "routeid", "routeId"),
        routeNumber: requiredStringAny(item, "routeno", "routeNo"),
        startStopName: stringField(item, "startnodenm", "startNodeNm"),
        endStopName: stringField(item, "endnodenm", "endNodeNm"),
        ...(routeType === undefined ? {} : { routeType }),
      };
    });
  }

  /** `undefined` when TAGO knows no such route. */
  async routeServiceHours(cityCode: string, routeId: string): Promise<TagoRouteServiceHours | undefined> {
    const items = await this.request(this.routeBaseURL, "/getRouteInfoIem", { cityCode, routeId }, false);
    const item = items.find((row) => stringField(row, "routeid", "routeId") === routeId);
    if (!item) return undefined;
    // Absent stays absent: an explicit `undefined` would claim TAGO answered and said nothing.
    const hours: TagoRouteServiceHours = { routeId, headwayMinutes: {} };
    const routeNumber = stringField(item, "routeno", "routeNo");
    if (routeNumber !== undefined) hours.routeNumber = routeNumber;
    const routeType = stringField(item, "routetp", "routeTp");
    if (routeType !== undefined) hours.routeType = routeType;
    const startStopName = stringField(item, "startnodenm", "startNodeNm");
    if (startStopName !== undefined) hours.startStopName = startStopName;
    const endStopName = stringField(item, "endnodenm", "endNodeNm");
    if (endStopName !== undefined) hours.endStopName = endStopName;
    const undocumented: Partial<Record<ServiceDayField, string>> = {};
    const read = <T>(field: ServiceDayField, camel: string, parse: (raw: string | undefined) => T | undefined): T | undefined => {
      const raw = stringField(item, field, camel);
      const value = parse(raw);
      if (raw !== undefined && value === undefined) undocumented[field] = raw.slice(0, 16);
      return value;
    };
    const firstDeparture = read("startvehicletime", "startVehicleTime", serviceTime);
    if (firstDeparture !== undefined) hours.firstDeparture = firstDeparture;
    const lastDeparture = read("endvehicletime", "endVehicleTime", serviceTime);
    if (lastDeparture !== undefined) hours.lastDeparture = lastDeparture;
    const weekday = read("intervaltime", "intervalTime", headway);
    if (weekday !== undefined) hours.headwayMinutes.weekday = weekday;
    const saturday = read("intervalsattime", "intervalSatTime", headway);
    if (saturday !== undefined) hours.headwayMinutes.saturday = saturday;
    const sunday = read("intervalsuntime", "intervalSunTime", headway);
    if (sunday !== undefined) hours.headwayMinutes.sunday = sunday;
    if (Object.keys(undocumented).length > 0) hours.undocumented = undocumented;
    return hours;
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
    const items = await this.request(this.locationBaseURL, "/getRouteAcctoBusLcList", {
      cityCode: request.cityCode,
      routeId: request.routeId,
    });
    // TAPSO server receipt time — when this process finished reading the
    // snapshot. It is not when TAGO observed the vehicle, and TAGO does not
    // say when that was. Never rename, serialise or describe this as a
    // provider or observation timestamp.
    const receivedAt = this.now().toISOString();
    return items.map((item) => ({
      vehicleId: requiredStringAny(item, "vehicleno", "vehicleNo"),
      routeId: request.routeId,
      // The epoch sentinel, deliberately. `getRouteAcctoBusLcList` carries no
      // observation time in any field, so there is nothing truthful to put
      // here. Paired with `timestampSource: "unavailable"` it makes every
      // consumer that compares ages fail closed instead of silently treating
      // network receipt time as provider freshness.
      observedAt: new Date(0).toISOString(),
      receivedAt,
      timestampSource: "unavailable",
      stopId: stringField(item, "nodeid", "nodeId"),
      stopName: stringField(item, "nodenm", "nodeNm"),
      stopSequence: numberField(item, "nodeord", "nodeOrd"),
      latitude: numberField(item, "gpslati", "gpsLati"),
      longitude: numberField(item, "gpslong", "gpsLong"),
      receiveType: "TAGO_SNAPSHOT",
    }));
  }

  /**
   * One logical request: every page and retry inside one deadline, recorded
   * once (`providerHealth.ts`) whatever the outcome. The record names the
   * operation and the outcome class, never the URL (it carries the key).
   */
  private async request(
    baseURL: string,
    path: string,
    params: Record<string, string>,
    paged = true,
  ): Promise<UnknownRecord[]> {
    const started = this.clock();
    const trace: RequestTrace = { attempts: 0, deadlineAt: started + this.deadlineMs };
    let outcome: ProviderOutcome = "ok";
    let detail: string | undefined;
    try {
      return await this.requestPages(baseURL, path, params, paged, trace);
    } catch (error) {
      outcome = failureOutcome(error);
      // A configuration message names the credential variable, which `/health`
      // must never carry; the outcome class says enough.
      detail = outcome !== "BLOCKED_BY_CREDENTIALS" && error instanceof Error ? error.message : undefined;
      throw error;
    } finally {
      this.onRequest({
        provider: "tago",
        operation: path.replace(/^\//, ""),
        outcome,
        latencyMs: Math.max(0, Math.round(this.clock() - started)),
        attempts: trace.attempts,
        ...(detail === undefined ? {} : { detail }),
        ...(trace.httpStatus === undefined ? {} : { httpStatus: trace.httpStatus }),
        at: this.now().toISOString(),
      });
    }
  }

  private async requestPages(
    baseURL: string,
    path: string,
    params: Record<string, string>,
    paged: boolean,
    trace: RequestTrace,
  ): Promise<UnknownRecord[]> {
    if (!this.serviceKey) {
      throw new ProviderConfigurationError(`${CANONICAL_SERVICE_KEY_ENV} is required for TAGO live transit calls`);
    }
    if (/%[0-9a-f]{2}/i.test(this.serviceKey)) {
      throw new ProviderConfigurationError(`${CANONICAL_SERVICE_KEY_ENV} must contain the Decoding key, not the Encoding key`);
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

      const envelope = await this.fetchEnvelopeWithTransientRetry(url, trace);
      const resultCode = stringField(envelope.header, "resultCode");
      if (!resultCode) throw new ProviderResponseError("TAGO resultCode is missing");
      if (resultCode && resultCode !== "00" && resultCode !== "0") {
        const safeCode = /^\d{1,3}$/.test(resultCode) ? resultCode : "unknown";
        throw new ProviderResponseError(`TAGO provider error ${safeCode}`);
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

  /**
   * data.go.kr occasionally returns a syntactically valid but incomplete TAGO
   * envelope for a single request. Transport failures, timeouts, HTTP 5xx,
   * non-JSON bodies and malformed envelopes are retried once (a GET changes
   * nothing upstream), after a short jittered pause, and only while enough of
   * the request's deadline is left for the retry to be worth it; then the
   * request fails closed. Logical TAGO result codes and HTTP 4xx are answers,
   * handled by the caller and never retried here.
   */
  private async fetchEnvelopeWithTransientRetry(url: URL, trace: RequestTrace): Promise<{ header: UnknownRecord; body: UnknownRecord }> {
    let lastError: ProviderResponseError | undefined;
    for (let attempt = 1; attempt <= TAGO_TRANSIENT_ATTEMPTS; attempt += 1) {
      const remaining = trace.deadlineAt - this.clock();
      if (remaining <= 0) throw lastError ?? new ProviderTimeoutError("TAGO request deadline exceeded");
      trace.attempts += 1;
      const retry = async (error: ProviderResponseError): Promise<boolean> => {
        lastError = error;
        // One retry per logical request, not per page.
        if (attempt >= TAGO_TRANSIENT_ATTEMPTS || trace.retried) return false;
        const pause = TAGO_RETRY_DELAY_MS * (1 + this.random());
        if (trace.deadlineAt - this.clock() - pause < this.minimumRetryBudgetMs) return false;
        trace.retried = true;
        await this.sleep(pause);
        return true;
      };

      let response: Response;
      try {
        response = await this.fetchImplementation(url, {
          headers: {
            accept: "application/json",
            "user-agent": "TAPSO-live-transit/1.0",
            connection: "close",
          },
          signal: AbortSignal.timeout(Math.max(1, Math.min(this.attemptTimeoutMs, Math.floor(remaining)))),
          redirect: "error",
        });
      } catch (error) {
        if (await retry(providerTransportError(error, "TAGO"))) continue;
        throw lastError!;
      }

      trace.httpStatus = response.status;
      if (!response.ok) {
        const error = new ProviderUnavailableError(`TAGO provider returned HTTP ${response.status}`);
        if (response.status >= 500 && await retry(error)) continue;
        throw error;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        // A body cut off by the attempt's timeout is a timeout, not nonsense.
        const failure = isTimeout(error) ? providerTransportError(error, "TAGO") : new ProviderResponseError("TAGO returned a non-JSON response");
        if (await retry(failure)) continue;
        throw lastError!;
      }

      try {
        return extractEnvelope(payload);
      } catch (error) {
        if (!(error instanceof ProviderResponseError)) throw error;
        if (await retry(error)) continue;
        throw lastError!;
      }
    }
    throw lastError ?? new ProviderUnavailableError("TAGO request failed");
  }
}

interface RequestTrace {
  attempts: number;
  /** A retry was spent; a later page gets none. */
  retried?: boolean;
  deadlineAt: number;
  httpStatus?: number;
}

function isTimeout(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && String((error as { name: unknown }).name) === "TimeoutError");
}

function failureOutcome(error: unknown): ProviderOutcome {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  switch (code) {
    case "PROVIDER_TIMEOUT":
    case "PROVIDER_UNAVAILABLE":
    case "BLOCKED_BY_CREDENTIALS":
      return code;
    default:
      return "PROVIDER_RESPONSE_INVALID";
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

/**
 * `HHMM` (documented) → `HH:MM`. A number loses its leading zero in JSON (`600`),
 * so it is padded back. Anything outside 00:00–23:59 is not documented and is
 * dropped: an undocumented "after midnight" encoding must not be guessed at.
 */
function serviceTime(raw: string | undefined): string | undefined {
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return undefined;
  const padded = raw.padStart(4, "0");
  const hours = Number(padded.slice(0, 2));
  const minutes = Number(padded.slice(2));
  if (hours > 23 || minutes > 59) return undefined;
  return `${padded.slice(0, 2)}:${padded.slice(2)}`;
}

/** Minutes between buses: a positive whole number of at most a day, or nothing. */
function headway(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return undefined;
  const minutes = Number(raw);
  return minutes > 0 && minutes <= 1_440 ? minutes : undefined;
}

function requiredNumber(item: UnknownRecord, ...keys: string[]): number {
  const value = numberField(item, ...keys);
  if (value === undefined || value < 1 || !Number.isInteger(value)) {
    throw new ProviderResponseError(`Missing TAGO numeric field: ${keys.join("|")}`);
  }
  return value;
}
