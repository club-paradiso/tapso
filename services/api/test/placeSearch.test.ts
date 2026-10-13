import test from "node:test";
import assert from "node:assert/strict";
import { createTransitApiHandler, type TransitApiHandler } from "../src/apiRouter.ts";
import { readTransitApiConfig } from "../src/apiConfig.ts";
import { CachedTransitProvider } from "../src/cachedTransitProvider.ts";
import {
  inJejuBox,
  KakaoPlaceSearch,
  normalizePlaceQuery,
  parseAddress,
  parseKeyword,
  readKakaoApiKey,
} from "../src/placeSearch.ts";

// Every place, address and coordinate below is SYNTHETIC, in the shape the
// Kakao Local API documents (x = longitude, y = latitude, both strings).
const KEYWORD_BODY = {
  meta: { total_count: 3, pageable_count: 3, is_end: true },
  documents: [
    { place_name: "합성시장", address_name: "제주특별자치도 제주시 합성동 1", road_address_name: "제주특별자치도 제주시 합성로 1", x: "126.5265", y: "33.5118" },
    { place_name: "합성시장 서울점", address_name: "서울 중구 합성동 2", road_address_name: "", x: "126.9780", y: "37.5665" },
    { place_name: "좌표없는곳", address_name: "제주특별자치도 어딘가", x: "", y: "" },
  ],
};
const ADDRESS_BODY = {
  meta: { total_count: 1, pageable_count: 1, is_end: true },
  documents: [
    {
      address_name: "제주특별자치도 제주시 합성동 1",
      address_type: "REGION_ADDR",
      x: "126.5265",
      y: "33.5118",
      road_address: { address_name: "제주특별자치도 제주시 합성로 1", building_name: "합성빌딩" },
    },
  ],
};

type Call = { url: URL; authorization: string | null };

function stubFetch(responses: { keyword?: unknown; address?: unknown; status?: number; fail?: Error }, calls: Call[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    if (responses.fail) throw responses.fail;
    const body = url.pathname.endsWith("keyword.json") ? responses.keyword : responses.address;
    return new Response(JSON.stringify(body ?? { documents: [] }), { status: responses.status ?? 200 });
  }) as typeof fetch;
}

test("keyword results keep only Jeju places with coordinates, road address first", () => {
  const items = parseKeyword(KEYWORD_BODY);
  assert.deepEqual(items, [
    { name: "합성시장", address: "제주특별자치도 제주시 합성로 1", lat: 33.5118, lng: 126.5265, kind: "place" },
  ]);
});

test("address results are named by building, then road address, then lot", () => {
  assert.deepEqual(parseAddress(ADDRESS_BODY), [
    { name: "합성빌딩", address: "제주특별자치도 제주시 합성로 1", lat: 33.5118, lng: 126.5265, kind: "address" },
  ]);
  const plain = { documents: [{ address_name: "제주특별자치도 제주시 합성동 3", x: "126.53", y: "33.50", road_address: null }] };
  assert.deepEqual(parseAddress(plain), [
    { name: "제주특별자치도 제주시 합성동 3", lat: 33.5, lng: 126.53, kind: "address" },
  ]);
});

test("a body without documents is invalid, not empty", () => {
  assert.throws(() => parseKeyword({ errorType: "AccessDeniedError" }), /no documents/);
});

test("the Jeju box covers Chujado and Marado and nothing on the mainland", () => {
  assert.equal(inJejuBox(33.9636, 126.30), true);
  assert.equal(inJejuBox(33.118, 126.267), true);
  assert.equal(inJejuBox(34.80, 126.39), false);
});

test("the key is read from KAKAO_REST_API_KEY only, trimmed, and blank means none", () => {
  assert.equal(readKakaoApiKey({ KAKAO_REST_API_KEY: "  k  " }), "k");
  assert.equal(readKakaoApiKey({ KAKAO_REST_API_KEY: "   " }), undefined);
  assert.equal(readKakaoApiKey({}), undefined);
  assert.equal(normalizePlaceQuery("  동문   시장 "), "동문 시장");
});

test("search sends the key as KakaoAK, bounds keyword search to Jeju, merges and caches", async () => {
  const calls: Call[] = [];
  const search = new KakaoPlaceSearch({ apiKey: "synthetic-kakao-key", fetchImplementation: stubFetch({ keyword: KEYWORD_BODY, address: ADDRESS_BODY }, calls) });
  const first = await search.search("합성 시장");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.authorization === "KakaoAK synthetic-kakao-key"));
  const keyword = calls.find((call) => call.url.pathname.endsWith("keyword.json"));
  assert.equal(keyword?.url.searchParams.get("rect"), "126.08,33.08,127,34.05");
  assert.equal(keyword?.url.searchParams.get("query"), "합성 시장");
  assert.deepEqual(first.items.map((item) => item.name), ["합성빌딩", "합성시장"], "address first, then places");
  await search.search("  합성   시장 ");
  assert.equal(calls.length, 2, "same query after normalising: served from cache");
});

test("an upstream failure is a typed error and is never cached", async () => {
  const calls: Call[] = [];
  const search = new KakaoPlaceSearch({ apiKey: "k", fetchImplementation: stubFetch({ status: 401 }, calls) });
  await assert.rejects(search.search("합성"), (error: { reason?: string }) => error.reason === "unavailable");
  await assert.rejects(search.search("합성"), (error: { reason?: string }) => error.reason === "unavailable");
  assert.equal(calls.length, 4);
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  const slow = new KakaoPlaceSearch({ apiKey: "k", fetchImplementation: stubFetch({ fail: timeout }) });
  await assert.rejects(slow.search("합성"), (error: { reason?: string }) => error.reason === "timeout");
});

function handlerWith(places?: KakaoPlaceSearch): TransitApiHandler {
  const config = readTransitApiConfig({ TAGO_SERVICE_KEY: "synthetic-key" }, { nodeVersion: "v22.0.0" });
  const provider = new CachedTransitProvider(
    { stops: async () => [], vehicles: async () => [] },
    { stopTtlMs: config.cachePolicy.stopTtlMs, vehicleTtlMs: config.cachePolicy.vehicleTtlMs },
  );
  return createTransitApiHandler({
    config,
    discovery: { cities: async () => [], routes: async () => [] },
    provider,
    ...(places ? { places } : {}),
    log: () => {},
  });
}

const get = (handler: TransitApiHandler, path: string) => handler(new Request(`http://api.test${path}`));

test("GET /v1/places fails closed without a key, and health says so without naming one", async () => {
  const handler = handlerWith(new KakaoPlaceSearch({ apiKey: undefined }));
  const response = await get(handler, "/v1/places?q=동문시장");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "PLACES_UNAVAILABLE");
  const health = await (await get(handler, "/health")).json();
  assert.deepEqual(health.places, { available: false, source: "kakao-local" });
  assert.equal((await get(handlerWith(), "/api/v1/places?q=동문시장")).status, 503);
});

test("GET /v1/places answers Jeju results, privately cached, and validates q before any upstream call", async () => {
  const calls: Call[] = [];
  const handler = handlerWith(new KakaoPlaceSearch({ apiKey: "synthetic-kakao-key", fetchImplementation: stubFetch({ keyword: KEYWORD_BODY, address: ADDRESS_BODY }, calls) }));
  const response = await get(handler, `/v1/places?q=${encodeURIComponent("합성시장")}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, max-age=300");
  const body = await response.json();
  assert.equal(body.meta.source, "kakao-local");
  assert.ok(body.items.every((item: { lat: number; lng: number }) => inJejuBox(item.lat, item.lng)));
  assert.ok(!JSON.stringify(body).includes("synthetic-kakao-key"));

  const before = calls.length;
  assert.equal((await get(handler, "/v1/places?q=a")).status, 400);
  assert.equal((await get(handler, `/v1/places?q=${"가".repeat(61)}`)).status, 400);
  assert.equal((await get(handler, "/v1/places")).status, 400);
  assert.equal(calls.length, before, "invalid queries never reach Kakao");
});

test("GET /v1/places maps an upstream failure to 502 and a timeout to 504, without the upstream body", async () => {
  const failing = handlerWith(new KakaoPlaceSearch({ apiKey: "k", fetchImplementation: stubFetch({ status: 500 }) }));
  const failed = await get(failing, "/v1/places?q=합성");
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).error, "PLACES_UPSTREAM_FAILED");
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  const slow = handlerWith(new KakaoPlaceSearch({ apiKey: "k", fetchImplementation: stubFetch({ fail: timeout }) }));
  assert.equal((await get(slow, "/v1/places?q=합성")).status, 504);
});
