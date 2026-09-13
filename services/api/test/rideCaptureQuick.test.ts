import test from "node:test";
import assert from "node:assert/strict";

import {
  boardingCandidates,
  collectVehicleCandidates,
  exactRouteVariants,
  hasPassedStopMarker,
  hasValidPlateSuffix,
  matchingVehicles,
  normalizePlateSuffix,
  vehiclePlateSuffix,
} from "../public/ride-capture/quick-core.js";

test("normalizes a Korean bus plate to its last four digits", () => {
  assert.equal(normalizePlateSuffix("제주79아3651"), "3651");
  assert.equal(vehiclePlateSuffix("제주79아 36-51"), "3651");
  assert.equal(hasValidPlateSuffix("3651"), true);
  assert.equal(hasValidPlateSuffix("651"), false);
});

test("keeps only exact route-number variants", () => {
  const variants = [
    { routeNumber: "202", routeId: "a" },
    { routeNumber: "202-1", routeId: "b" },
    { routeNumber: "1202", routeId: "c" },
    { routeNumber: "202", routeId: "d" },
  ];
  assert.deepEqual(exactRouteVariants(variants, "202번").map((v) => v.routeId), ["a", "d"]);
});

test("matches the requested four-digit plate suffix without guessing", () => {
  const vehicles = [
    { vehicleId: "제주79아3651", stopSequence: 66 },
    { vehicleId: "제주79아3649", stopSequence: 13 },
  ];
  assert.deepEqual(matchingVehicles(vehicles, "3651").map((v) => v.vehicleId), ["제주79아3651"]);
  assert.deepEqual(matchingVehicles(vehicles, "9999"), []);
});

test("collects route identity together with the matching vehicle", () => {
  const routeA = { routeNumber: "455", routeId: "JEB405245508" };
  const routeB = { routeNumber: "455", routeId: "JEB405245512" };
  const rows = [
    { route: routeA, vehicles: [{ vehicleId: "제주79아3651" }] },
    { route: routeB, vehicles: [] },
  ];
  const matches = collectVehicleCandidates(rows, "3651");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].route.routeId, "JEB405245508");
});

test("boarding candidates include a small window behind stale provider position", () => {
  const stops = Array.from({ length: 10 }, (_, index) => ({ sequence: index + 1, name: `S${index + 1}` }));
  assert.deepEqual(boardingCandidates(stops, 7).map((s) => s.sequence), [4, 5, 6, 7, 8]);
});

test("detects an already stored physical marker for the same stop sequence", () => {
  const markers = [
    { kind: "boarded", stopSequence: 18 },
    { kind: "passed_stop", stopSequence: 20 },
    { kind: "note", note: "door reopened" },
  ];
  assert.equal(hasPassedStopMarker(markers, 20), true);
  assert.equal(hasPassedStopMarker(markers, 18), false);
  assert.equal(hasPassedStopMarker(markers, 21), false);
});
