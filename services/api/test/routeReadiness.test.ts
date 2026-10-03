/**
 * Route readiness rules. The catalog and probe here are SYNTHETIC; the
 * timetable bundle is the committed official one.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateTimetableBundle } from "../src/officialTimetable.ts";
import { assessReadiness, renderReadinessMarkdown } from "../src/routeReadiness.ts";
import { buildCatalog } from "../src/transitCatalog.ts";
import type { StopOnRoute } from "../src/domain.ts";

const { bundle } = validateTimetableBundle(JSON.parse(readFileSync(new URL("../data/jeju-timetables.json", import.meta.url), "utf8")));
const stops = (prefix: string, count: number, positions = true): StopOnRoute[] => Array.from({ length: count }, (_, index) => ({
  stopId: `${prefix}${index}`,
  name: `합성${prefix}${index}`,
  sequence: index + 1,
  ...(positions ? { latitude: 33.4 + index / 1000, longitude: 126.5 } : {}),
}));
const catalog = buildCatalog({
  generatedAt: "2026-10-03T00:00:00.000Z",
  cityCode: "39",
  via: "https://synthetic.invalid",
  discovery: [],
  routes: [
    { routeId: "SYN-A", routeNumber: "365" },
    { routeId: "SYN-B", routeNumber: "365" },
    { routeId: "SYN-C", routeNumber: "9999" },
    { routeId: "SYN-D", routeNumber: "201" },
    { routeId: "SYN-E", routeNumber: "325" },
    { routeId: "SYN-F", routeNumber: "888" },
  ],
  stopsByRoute: new Map<string, StopOnRoute[] | { error: string }>([
    ["SYN-A", stops("a", 5)],
    ["SYN-B", stops("b", 5, false)],
    ["SYN-C", stops("c", 5)],
    ["SYN-D", [...stops("d", 3), { stopId: "d0", name: "합성d0", sequence: 4, latitude: 33.4, longitude: 126.5 }, { stopId: "d1", name: "합성d1", sequence: 5, latitude: 33.401, longitude: 126.5 }]],
    ["SYN-E", stops("e", 4)],
    ["SYN-F", { error: "stops_http_502" }],
  ]),
});

test("each variant is classified by explicit rules, with its reasons", () => {
  const report = assessReadiness(catalog, bundle, {
    probedAt: "2026-10-03T01:00:00.000Z",
    catalogVersion: catalog.catalogVersion,
    probes: {
      "SYN-A": { status: 200, vehicles: 3, withStopSequence: 3, sequenceInRange: 3 },
      "SYN-B": { status: 200, vehicles: 0, withStopSequence: 0, sequenceInRange: 0 },
      "SYN-C": { status: 502, vehicles: 0, withStopSequence: 0, sequenceInRange: 0 },
      "SYN-D": { status: 200, vehicles: 2, withStopSequence: 2, sequenceInRange: 1 },
    },
  });
  const by = Object.fromEntries(report.variants.map((variant) => [variant.routeId, variant]));
  assert.equal(by["SYN-A"]!.tracking, "SUPPORTED");
  assert.equal(by["SYN-A"]!.timetable, "available");
  assert.equal(by["SYN-B"]!.tracking, "SUPPORTED_WITH_WARNING");
  assert.match(by["SYN-B"]!.reasons.join(" "), /no position/);
  assert.equal(by["SYN-B"]!.geometry, "NONE");
  assert.equal(by["SYN-C"]!.tracking, "UNSUPPORTED");
  assert.equal(by["SYN-C"]!.timetable, "not_published");
  assert.equal(by["SYN-D"]!.tracking, "UNSUPPORTED", "a bus outside the route's sequences");
  assert.equal(by["SYN-E"]!.tracking, "UNKNOWN", "never probed");
  assert.equal(by["SYN-F"]!.tracking, "UNSUPPORTED");
  assert.equal(by["SYN-F"]!.timetable, "no_timetable");
  assert.deepEqual(report.totals, { SUPPORTED: 1, SUPPORTED_WITH_WARNING: 1, UNSUPPORTED: 3, UNKNOWN: 1 });
  assert.match(renderReadinessMarkdown(report), /\| 365 \| `SYN-A` \| 5 \| linear \| answered_with_buses \| available \| SUPPORTED \|/);
});

test("a probe of another catalog version counts for nothing", () => {
  const report = assessReadiness(catalog, bundle, { probedAt: "x", catalogVersion: "0000000000000000", probes: { "SYN-A": { status: 200, vehicles: 1, withStopSequence: 1, sequenceInRange: 1 } } });
  assert.equal(report.totals.UNKNOWN, 5);
  assert.equal(report.probedAt, undefined);
});

test("one stop list under two route IDs of a number is a warning on both", () => {
  const twins = buildCatalog({
    generatedAt: "2026-10-03T00:00:00.000Z",
    cityCode: "39",
    via: "https://synthetic.invalid",
    discovery: [],
    routes: [{ routeId: "SYN-T1", routeNumber: "202" }, { routeId: "SYN-T2", routeNumber: "202" }, { routeId: "SYN-T3", routeNumber: "201" }],
    stopsByRoute: new Map<string, StopOnRoute[] | { error: string }>([["SYN-T1", stops("t", 4)], ["SYN-T2", stops("t", 4)], ["SYN-T3", stops("t", 4)]]),
  });
  const probe = { status: 200, vehicles: 1, withStopSequence: 1, sequenceInRange: 1 };
  const report = assessReadiness(twins, bundle, { probedAt: "x", catalogVersion: twins.catalogVersion, probes: { "SYN-T1": probe, "SYN-T2": probe, "SYN-T3": probe } });
  const by = Object.fromEntries(report.variants.map((variant) => [variant.routeId, variant]));
  assert.equal(by["SYN-T1"]!.tracking, "SUPPORTED_WITH_WARNING");
  assert.match(by["SYN-T1"]!.reasons.join(" "), /same stop list as SYN-T2 under 202/);
  assert.match(by["SYN-T2"]!.reasons.join(" "), /same stop list as SYN-T1 under 202/);
  assert.equal(by["SYN-T3"]!.tracking, "SUPPORTED", "another number with the same stops is a different route, not a twin");
});
