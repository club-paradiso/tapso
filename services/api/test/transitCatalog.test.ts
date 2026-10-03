/**
 * The canonical transit catalog: deterministic build, identity preservation and
 * fail-closed validation. Every route, stop and coordinate here is SYNTHETIC.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { StopOnRoute } from "../src/domain.ts";
import {
  CATALOG_SCHEMA_VERSION,
  CatalogError,
  buildCatalog,
  routeStops,
  validateCatalog,
  type CatalogBuildInput,
} from "../src/transitCatalog.ts";

function stops(prefix: string, names: string[], start = 1): StopOnRoute[] {
  return names.map((name, index) => ({
    stopId: `${prefix}${index}`,
    name,
    sequence: start + index,
    latitude: 33.4 + index / 1000,
    longitude: 126.5 + index / 1000,
  }));
}

function input(overrides: Partial<CatalogBuildInput> = {}): CatalogBuildInput {
  const outbound = stops("SYN-A", ["합성터미널", "합성시장[동]", "합성학교"]);
  const inbound = stops("SYN-B", ["합성학교", "합성시장[서]", "합성터미널"]);
  const branch = [...outbound.slice(0, 2), { stopId: "SYN-C0", name: "합성마을", sequence: 3 }];
  return {
    generatedAt: "2026-10-03T00:00:00.000Z",
    cityCode: "39",
    via: "https://synthetic.invalid",
    discovery: [{ method: "all_routes", query: "", routeIds: 3 }],
    routes: [
      { routeId: "SYN202B", routeNumber: "202", startStopName: "합성학교", endStopName: "합성터미널" },
      { routeId: "SYN202A", routeNumber: "202", startStopName: "합성터미널", endStopName: "합성학교" },
      { routeId: "SYN2021", routeNumber: "202-1", startStopName: "합성터미널", endStopName: "합성마을" },
      // Found twice by two discovery queries: one entry.
      { routeId: "SYN202A", routeNumber: "202" },
    ],
    stopsByRoute: new Map<string, StopOnRoute[] | { error: string }>([
      ["SYN202A", outbound],
      ["SYN202B", inbound],
      ["SYN2021", branch],
    ]),
    ...overrides,
  };
}

test("one entry per provider route ID; 202 and 202-1 stay distinct routes", () => {
  const catalog = buildCatalog(input());
  assert.equal(catalog.schemaVersion, CATALOG_SCHEMA_VERSION);
  assert.deepEqual(catalog.routes.map((route) => [route.routeNo, route.routeId]), [
    ["202", "SYN202A"],
    ["202", "SYN202B"],
    ["202-1", "SYN2021"],
  ]);
  // Shared poles are one stop; a same-named pole on the other side is another.
  assert.equal(catalog.stops.length, 7);
  assert.deepEqual(routeStops(catalog, catalog.routes[2]!).map((stop) => stop.name), ["합성터미널", "합성시장[동]", "합성마을"]);
  assert.equal(catalog.stops.find((stop) => stop.id === "SYN-C0")!.lat, undefined, "a stop the provider gave no position keeps none");
});

test("the build is deterministic and the version follows the content only", () => {
  const first = buildCatalog(input());
  const again = buildCatalog({ ...input(), generatedAt: "2026-10-04T00:00:00.000Z", routes: [...input().routes].reverse() });
  assert.equal(first.catalogVersion, again.catalogVersion);
  assert.deepEqual(first.routes, again.routes);
  const changed = buildCatalog(input({ stopsByRoute: new Map([...input().stopsByRoute, ["SYN2021", stops("SYN-D", ["합성터미널", "합성공원"])]]) }));
  assert.notEqual(changed.catalogVersion, first.catalogVersion);
});

test("a variant whose stops could not be read is listed as unavailable, never dropped silently", () => {
  const catalog = buildCatalog(input({
    stopsByRoute: new Map<string, StopOnRoute[] | { error: string }>([
      ["SYN202A", stops("SYN-A", ["합성터미널", "합성학교"])],
      ["SYN202B", { error: "stops_http_502" }],
      ["SYN2021", stops("SYN-C", ["합성터미널"])],
    ]),
  }));
  assert.deepEqual(catalog.routes.map((route) => route.routeId), ["SYN202A"]);
  assert.deepEqual(catalog.unavailable, [
    { routeId: "SYN2021", routeNo: "202-1", reason: "provider_stop_list_has_1_stops" },
    { routeId: "SYN202B", routeNo: "202", reason: "stops_http_502" },
  ]);
});

test("provider sequences other than 1…n are kept; a loop is classified", () => {
  const loop = [...stops("SYN-L", ["합성순환A", "합성순환B", "합성순환C"], 5), { stopId: "SYN-L0", name: "합성순환A", sequence: 8, latitude: 33.4, longitude: 126.5 }];
  const catalog = buildCatalog(input({
    routes: [{ routeId: "SYN440", routeNumber: "440" }],
    stopsByRoute: new Map([["SYN440", loop]]),
  }));
  const route = catalog.routes[0]!;
  assert.equal(route.topology, "loop");
  assert.deepEqual(route.sequences, [5, 6, 7, 8]);
  assert.deepEqual(routeStops(catalog, route).map((stop) => stop.sequence), [5, 6, 7, 8]);
});

test("a route ID named with two different numbers stops the build", () => {
  assert.throws(
    () => buildCatalog(input({ routes: [{ routeId: "SYN202A", routeNumber: "202" }, { routeId: "SYN202A", routeNumber: "202-1" }] })),
    CatalogError,
  );
});

test("validation fails closed on tampering", () => {
  const good = buildCatalog(input());
  assert.doesNotThrow(() => validateCatalog(JSON.parse(JSON.stringify(good))));
  const cases: [string, (raw: any) => void][] = [
    ["schema", (raw) => { raw.schemaVersion = "tapso-jeju-catalog-v0"; }],
    ["label", (raw) => { raw.label = "LIVE"; }],
    ["content changed without a new version", (raw) => { raw.stops[0].name = "변조"; }],
    ["index outside the table", (raw) => { raw.routes[0].stops[1] = 99; }],
    ["duplicate route", (raw) => { raw.routes.push(raw.routes[0]); }],
    ["one-stop route", (raw) => { raw.routes[0].stops = [0]; }],
    ["half a coordinate", (raw) => { delete raw.stops[0].lng; }],
  ];
  for (const [name, mutate] of cases) {
    const raw = JSON.parse(JSON.stringify(good));
    mutate(raw);
    assert.throws(() => validateCatalog(raw), CatalogError, name);
  }
});
