import test from "node:test";
import assert from "node:assert/strict";

import {
  boardingCandidates,
  collectVehicleCandidates,
  exactRouteVariants,
  fieldStopChoices,
  hasPassedStopMarker,
  hasValidPlateSuffix,
  matchingVehicles,
  normalizePlateSuffix,
  postAlightObservationState,
  vehiclePlateSuffix,
} from "../public/ride-capture/quick-core.js";

/**
 * Synthetic test fixtures, not observations: every provider response below is
 * constructed by the test, and nothing here is evidence that a bus was seen.
 * Values that look real (public TAGO route and stop ids, stop names and
 * coordinates, and vehicle numbers carried over from earlier fixtures) are
 * used only as inputs.
 */

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

test("field mode starts at the boarding stop and advances only from rider markers", () => {
  const stops = Array.from({ length: 10 }, (_, index) => ({ sequence: index + 1, name: `S${index + 1}` }));
  assert.deepEqual(fieldStopChoices({
    stops,
    markers: [{ kind: "boarded", stopSequence: 3 }],
    boardingSequence: 3,
    destinationSequence: 9,
    limit: 4,
  }).map((stop) => stop.sequence), [3, 4, 5, 6]);

  assert.deepEqual(fieldStopChoices({
    stops,
    markers: [
      { kind: "boarded", stopSequence: 3 },
      { kind: "passed_stop", stopSequence: 5 },
    ],
    boardingSequence: 3,
    destinationSequence: 9,
    limit: 4,
  }).map((stop) => stop.sequence), [6, 7, 8, 9]);
});

test("field mode lets the rider skip stops without inventing physical markers", () => {
  const stops = Array.from({ length: 12 }, (_, index) => ({ sequence: index + 1, name: `S${index + 1}` }));
  const markers = [
    { kind: "boarded", stopSequence: 2 },
    { kind: "passed_stop", stopSequence: 2 },
    { kind: "passed_stop", stopSequence: 5 },
  ];
  assert.deepEqual(fieldStopChoices({
    stops,
    markers,
    boardingSequence: 2,
    destinationSequence: 10,
    limit: 4,
  }).map((stop) => stop.sequence), [6, 7, 8, 9]);
});

test("field mode follows the forward arc on a loop", () => {
  const stops = Array.from({ length: 5 }, (_, index) => ({ sequence: index + 1, name: `S${index + 1}` }));
  assert.deepEqual(fieldStopChoices({
    stops,
    markers: [{ kind: "boarded", stopSequence: 5 }],
    boardingSequence: 5,
    destinationSequence: 2,
    wrapAround: true,
    limit: 4,
  }).map((stop) => stop.sequence), [5, 1, 2]);

  assert.deepEqual(fieldStopChoices({
    stops,
    markers: [
      { kind: "boarded", stopSequence: 5 },
      { kind: "passed_stop", stopSequence: 5 },
    ],
    boardingSequence: 5,
    destinationSequence: 2,
    wrapAround: true,
    limit: 4,
  }).map((stop) => stop.sequence), [1, 2]);
});

test("post-alight gate keeps a capture open while the provider is still behind", () => {
  assert.deepEqual(postAlightObservationState({
    remainingStops: 1,
    alightedAtMs: 1_000,
    nowMs: 6_000,
    observeMs: 20_000,
  }), {
    destinationObserved: false,
    elapsedMs: 5_000,
    remainingMs: 15_000,
    canFinalize: false,
  });
});

test("post-alight gate closes early only after the destination is actually observed", () => {
  const observed = postAlightObservationState({
    remainingStops: 0,
    alightedAtMs: 1_000,
    nowMs: 2_000,
    observeMs: 20_000,
  });
  assert.equal(observed.destinationObserved, true);
  assert.equal(observed.canFinalize, true);
  assert.equal(observed.remainingMs, 0);
});

test("post-alight gate eventually closes even if the provider never catches up", () => {
  const expired = postAlightObservationState({
    remainingStops: 1,
    alightedAtMs: 1_000,
    nowMs: 21_000,
    observeMs: 20_000,
  });
  assert.equal(expired.destinationObserved, false);
  assert.equal(expired.canFinalize, true);
  assert.equal(expired.remainingMs, 0);
});
