/**
 * GET /v1/catalog and GET /v1/timetables: reviewed files served as-is. The
 * catalog here is SYNTHETIC; the timetable bundle and calendar are the
 * committed real files.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readTransitApiConfig } from "../src/apiConfig.ts";
import { createTransitApiHandler, type TransitApiHandler } from "../src/apiRouter.ts";
import { CachedTransitProvider } from "../src/cachedTransitProvider.ts";
import { validateTimetableBundle } from "../src/officialTimetable.ts";
import { validateHolidayCalendar } from "../src/serviceDay.ts";
import { fileStaticTransitData, inMemoryStaticTransitData, type StaticTransitData } from "../src/staticTransitData.ts";
import { buildCatalog } from "../src/transitCatalog.ts";

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const timetables = validateTimetableBundle(read("../data/jeju-timetables.json")).bundle;
const holidays = validateHolidayCalendar(read("../data/kr-public-holidays.json"));
const catalog = buildCatalog({
  generatedAt: "2026-10-03T00:00:00.000Z",
  cityCode: "39",
  via: "https://synthetic.invalid",
  discovery: [{ method: "all_routes", query: "", routeIds: 1 }],
  routes: [{ routeId: "SYN1", routeNumber: "999" }],
  stopsByRoute: new Map([["SYN1", [
    { stopId: "SYN-S1", name: "합성정류장1", sequence: 1, latitude: 33.4, longitude: 126.5 },
    { stopId: "SYN-S2", name: "합성정류장2", sequence: 2, latitude: 33.41, longitude: 126.51 },
  ]]]),
});

function handler(staticData?: StaticTransitData, now = new Date("2026-10-07T01:00:00Z")): TransitApiHandler {
  const config = readTransitApiConfig({}, { nodeVersion: "v22.0.0" });
  return createTransitApiHandler({
    config,
    provider: new CachedTransitProvider({ async stops() { return []; }, async vehicles() { return []; } }, { stopTtlMs: 1, vehicleTtlMs: 1 }),
    discovery: { async cities() { return []; }, async routes() { return []; } },
    log: () => {},
    now: () => now,
    ...(staticData ? { staticData } : {}),
  });
}

const get = (h: TransitApiHandler, path: string, headers: Record<string, string> = {}) => h(new Request(`http://transit.invalid${path}`, { headers }));

test("the catalog is served whole, tagged by its version, and a client holding it gets 304", async () => {
  const h = handler(inMemoryStaticTransitData({ catalog, timetables, holidays }));
  const response = await get(h, "/v1/catalog");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("etag"), `"${catalog.catalogVersion}"`);
  assert.deepEqual(await response.json(), catalog);
  const again = await get(h, "/v1/catalog", { "if-none-match": `"${catalog.catalogVersion}"` });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");
});

test("without a deployed catalog the endpoint says so, and nothing else breaks", async () => {
  const h = handler(inMemoryStaticTransitData({ timetables, holidays }));
  const response = await get(h, "/v1/catalog");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "CATALOG_UNAVAILABLE");
  assert.equal((await get(h, "/v1/timetables?routeNo=365")).status, 200);
  assert.equal((await get(handler(), "/v1/timetables")).status, 503, "no data source at all");
});

test("timetables: the index, one route for today in Korea, and a stated date", async () => {
  const h = handler(inMemoryStaticTransitData({ timetables, holidays }));
  const index = await (await get(h, "/v1/timetables")).json();
  assert.equal(index.meta.label, "OFFICIAL_DATED");
  assert.equal(index.meta.asOf, "2026-10-03");
  assert.ok(index.items.some((item: { routeNo: string; status: string }) => item.routeNo === "365" && item.status === "available"));

  const today = await get(h, "/v1/timetables?routeNo=365");
  assert.equal(today.status, 200);
  assert.match(today.headers.get("cache-control") ?? "", /s-maxage=600/);
  const body = await today.json();
  assert.equal(body.item.date, "2026-10-07", "10:00 KST on a Wednesday");
  assert.deepEqual(body.item.today.map((entry: { dayLabel: string }) => entry.dayLabel), ["평일", "평일"]);
  const holiday = await (await get(h, "/v1/timetables?routeNo=365&date=2026-10-09")).json();
  assert.deepEqual(holiday.item.today.map((entry: { dayLabel: string }) => entry.dayLabel), ["토,공휴일", "토,공휴일"]);
});

test("timetables refuse malformed input", async () => {
  const h = handler(inMemoryStaticTransitData({ timetables, holidays }));
  for (const path of ["/v1/timetables?routeNo=36%205", "/v1/timetables?routeNo=365&date=2026-02-30", "/v1/timetables?routeNo=365&date=tomorrow"]) {
    assert.equal((await get(h, path)).status, 400, path);
  }
});

test("the committed data files load through the file loader, and health reports their versions", async () => {
  const data = fileStaticTransitData();
  assert.ok(data.timetables().ok);
  assert.ok(data.holidays().ok);
  const health = await (await get(handler(data), "/health")).json();
  assert.equal(health.staticData.timetables.available, true);
  assert.equal(health.staticData.timetables.parser.version, "3");
  assert.equal(health.staticData.holidays.available, true);
  const catalogLoaded = data.catalog();
  assert.equal(health.staticData.catalog.available, catalogLoaded.ok);
});
