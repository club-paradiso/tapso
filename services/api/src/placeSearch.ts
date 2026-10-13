/**
 * Place and address search for "I don't know the stop, I know where I'm
 * going" (`GET /v1/places?q=`), through the Kakao Local REST API.
 *
 * The Kakao key stays here, server-side, read from `KAKAO_REST_API_KEY`; the
 * app never holds it. Without a key every lookup fails closed with
 * `PLACES_UNAVAILABLE`, and the app falls back to Apple Maps on the phone.
 *
 * Only coordinates inside the Jeju box (the same one the app's `NearbyStops`
 * accepts) are returned: TAPSO maps a place to the Jeju stops near it and has
 * nothing to offer anywhere else. The query is never logged.
 *
 * Endpoints and fields: https://developers.kakao.com/docs/latest/ko/local/dev-guide
 * (keyword search, address search; `Authorization: KakaoAK <key>`; `x` is
 * longitude and `y` latitude, both strings).
 */

import { TtlCache } from "./ttlCache.ts";

export const KAKAO_KEY_ENV = "KAKAO_REST_API_KEY";

/** Jeju, Udo, Gapado, Marado, Chujado. Mirrors `NearbyStops.jejuLatitude/Longitude`. */
export const JEJU_BOX = { minLat: 33.08, maxLat: 34.05, minLng: 126.08, maxLng: 127.0 } as const;

export const PLACE_QUERY_MIN = 2;
export const PLACE_QUERY_MAX = 60;
export const PLACE_RESULT_LIMIT = 8;

export interface PlaceResult {
  name: string;
  /** Road address when Kakao has one, else the lot address; absent when neither. */
  address?: string;
  lat: number;
  lng: number;
  /** `place` from keyword search, `address` from address search. */
  kind: "place" | "address";
}

export type PlaceSearchFailure = "unconfigured" | "unavailable" | "timeout" | "invalid_response";

export class PlaceSearchError extends Error {
  readonly reason: PlaceSearchFailure;
  constructor(reason: PlaceSearchFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

type FetchLike = typeof fetch;

export interface KakaoPlaceSearchOptions {
  apiKey: string | undefined;
  fetchImplementation?: FetchLike;
  timeoutMs?: number;
  /** A place's coordinates change rarely; one Kakao read per query per day. */
  cacheTtlMs?: number;
}

const KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json";

export function readKakaoApiKey(env: Record<string, string | undefined>): string | undefined {
  const value = env[KAKAO_KEY_ENV]?.trim();
  return value ? value : undefined;
}

export function inJejuBox(lat: number, lng: number): boolean {
  return lat >= JEJU_BOX.minLat && lat <= JEJU_BOX.maxLat && lng >= JEJU_BOX.minLng && lng <= JEJU_BOX.maxLng;
}

/** Whitespace collapsed and trimmed: what is searched, and the cache key. */
export function normalizePlaceQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export class KakaoPlaceSearch {
  readonly configured: boolean;
  private readonly apiKey: string | undefined;
  private readonly fetchImplementation: FetchLike;
  private readonly timeoutMs: number;
  private readonly cache: TtlCache<PlaceResult[]>;

  constructor(options: KakaoPlaceSearchOptions) {
    this.apiKey = options.apiKey;
    this.configured = Boolean(options.apiKey);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 4_000;
    this.cache = new TtlCache<PlaceResult[]>({ ttlMs: options.cacheTtlMs ?? 24 * 60 * 60 * 1_000, maxEntries: 2_000 });
  }

  /**
   * Keyword and address search together, Jeju only. Address matches come first
   * (a typed address means that address), then places; duplicates dropped.
   */
  async search(rawQuery: string): Promise<{ items: PlaceResult[]; cache: string }> {
    if (!this.apiKey) throw new PlaceSearchError("unconfigured", `${KAKAO_KEY_ENV} is not set on this deployment`);
    const query = normalizePlaceQuery(rawQuery);
    const result = await this.cache.readThrough(query, async () => {
      const rect = `${JEJU_BOX.minLng},${JEJU_BOX.minLat},${JEJU_BOX.maxLng},${JEJU_BOX.maxLat}`;
      const keywordUrl = new URL(KEYWORD_URL);
      keywordUrl.searchParams.set("query", query);
      keywordUrl.searchParams.set("rect", rect);
      keywordUrl.searchParams.set("size", "15");
      const addressUrl = new URL(ADDRESS_URL);
      addressUrl.searchParams.set("query", query);
      addressUrl.searchParams.set("size", "10");
      const [keyword, address] = await Promise.all([this.read(keywordUrl), this.read(addressUrl)]);
      return merge(parseAddress(address), parseKeyword(keyword));
    });
    return { items: result.value, cache: result.cache };
  }

  private async read(url: URL): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        headers: { authorization: `KakaoAK ${this.apiKey}`, accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = error && typeof error === "object" && "name" in error ? String((error as Error).name) : "";
      if (name === "TimeoutError" || name === "AbortError") throw new PlaceSearchError("timeout", "place search timed out");
      throw new PlaceSearchError("unavailable", "place search could not be reached");
    }
    // The upstream body is never passed on: it can echo the request.
    if (!response.ok) throw new PlaceSearchError("unavailable", `place search answered HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new PlaceSearchError("invalid_response", "place search answered with something other than JSON");
    }
  }
}

function documents(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== "object" || !Array.isArray((body as { documents?: unknown }).documents)) {
    throw new PlaceSearchError("invalid_response", "place search answer has no documents");
  }
  return (body as { documents: unknown[] }).documents.filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === "object");
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function coordinate(document: Record<string, unknown>): { lat: number; lng: number } | undefined {
  const lng = Number(text(document.x));
  const lat = Number(text(document.y));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return inJejuBox(lat, lng) ? { lat, lng } : undefined;
}

export function parseKeyword(body: unknown): PlaceResult[] {
  const out: PlaceResult[] = [];
  for (const document of documents(body)) {
    const name = text(document.place_name);
    const at = coordinate(document);
    if (!name || !at) continue;
    const address = text(document.road_address_name) ?? text(document.address_name);
    out.push({ name, ...(address ? { address } : {}), ...at, kind: "place" });
  }
  return out;
}

export function parseAddress(body: unknown): PlaceResult[] {
  const out: PlaceResult[] = [];
  for (const document of documents(body)) {
    const at = coordinate(document);
    const lot = text(document.address_name);
    if (!at || !lot) continue;
    const road = document.road_address && typeof document.road_address === "object"
      ? document.road_address as Record<string, unknown>
      : undefined;
    const roadName = road ? text(road.address_name) : undefined;
    const building = road ? text(road.building_name) : undefined;
    const name = building ?? roadName ?? lot;
    const address = roadName && roadName !== name ? roadName : lot !== name ? lot : undefined;
    out.push({ name, ...(address ? { address } : {}), ...at, kind: "address" });
  }
  return out;
}

function merge(first: PlaceResult[], second: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const item of [...first, ...second]) {
    const key = `${item.name}|${item.lat.toFixed(4)}|${item.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length === PLACE_RESULT_LIMIT) break;
  }
  return out;
}
