import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTransitValidation } from "../src/liveValidation.ts";

/**
 * Synthetic test fixtures, not observations: every provider response below is
 * constructed by the test, and nothing here is evidence that a bus was seen.
 * Values that look real (public TAGO route and stop ids, stop names and
 * coordinates, and vehicle numbers carried over from earlier fixtures) are
 * used only as inputs.
 */

const base = Date.parse("2026-09-10T12:00:00+09:00");

function observed(vehicleId: string, seconds: number, stopSequence: number, directionCode = "1") {
  return {
    vehicleId,
    routeId: "route-365",
    observedAt: new Date(base + seconds * 1_000).toISOString(),
    stopSequence,
    directionCode,
    latitude: 33.49 + seconds / 1_000_000,
    longitude: 126.53,
    eventCode: stopSequence % 2 === 0 ? "ARRIVE" : "MOVE",
  };
}

test("summarizes provider cadence, coverage, duplicates, and continuity", () => {
  const first = observed("BUS-A", 0, 10);
  const report = analyzeTransitValidation([
    { capturedAt: new Date(base).toISOString(), vehicles: [first, observed("BUS-B", 0, 8, "2")] },
    { capturedAt: new Date(base + 5_000).toISOString(), vehicles: [first, observed("BUS-B", 5, 9, "2")] },
    { capturedAt: new Date(base + 10_000).toISOString(), vehicles: [observed("BUS-A", 10, 11), observed("BUS-B", 10, 10, "2")] },
  ], [
    { stopId: "s1", name: "A", sequence: 1 },
    { stopId: "s2", name: "B", sequence: 2 },
    { stopId: "s3", name: "C", sequence: 3 },
  ]);

  assert.equal(report.sampleCount, 3);
  assert.equal(report.observationCount, 6);
  assert.equal(report.uniqueVehicleCount, 2);
  assert.equal(report.collectionIntervalSeconds.median, 5);
  assert.equal(report.providerUpdateIntervalSeconds.max, 10);
  assert.equal(report.stopSequenceCoverage, 1);
  assert.equal(report.coordinateCoverage, 1);
  assert.equal(report.directionCoverage, 1);
  assert.equal(report.eventCodeCoverage, 1);
  assert.equal(report.duplicateObservationCount, 1);
  assert.equal(report.outOfOrderObservationCount, 0);
  assert.equal(report.stopCount, 3);
  assert.equal(report.stopSequenceContiguous, true);
  assert.equal(report.vehicleContinuity[0]!.samplesSeen, 3);
});

test("reports missing optional realtime fields without inventing evidence", () => {
  const report = analyzeTransitValidation([
    {
      capturedAt: new Date(base).toISOString(),
      vehicles: [{ vehicleId: "BUS-A", routeId: "route-365", observedAt: new Date(base).toISOString() }],
    },
  ]);

  assert.equal(report.stopSequenceCoverage, 0);
  assert.equal(report.coordinateCoverage, 0);
  assert.equal(report.directionCoverage, 0);
  assert.equal(report.eventCodeCoverage, 0);
});

test("detects provider timestamps that move backward across samples", () => {
  const report = analyzeTransitValidation([
    { capturedAt: new Date(base).toISOString(), vehicles: [observed("BUS-A", 10, 10)] },
    { capturedAt: new Date(base + 5_000).toISOString(), vehicles: [observed("BUS-A", 5, 11)] },
  ]);

  assert.equal(report.outOfOrderObservationCount, 1);
});
