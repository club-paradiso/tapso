import test from "node:test";
import assert from "node:assert/strict";
import type { StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { analyzeRideCapture, RIDE_CAPTURE_SCHEMA_VERSION, type RideCapture, type RideSnapshot } from "../src/rideCapture.ts";
import { replayMatching } from "../src/matchReplay.ts";

/**
 * Synthetic fixture. Vehicle numbers are invented and the route is not real.
 *
 * The boarding stop is sequence 3 and carries coordinates, because the matcher
 * scores boarding proximity and a capture without stop coordinates would make
 * every candidate look equally plausible.
 */
const base = Date.parse("2026-09-22T09:00:00+09:00");
const stops: StopOnRoute[] = Array.from({ length: 8 }, (_, index) => ({
  stopId: `SYN-${index + 1}`,
  name: `Synthetic ${index + 1}`,
  sequence: index + 1,
  latitude: 33.5 + index * 0.01,
  longitude: 126.5,
}));

const BOARDED = "제주79자9999";
const OTHER = "제주79자8888";

function at(seconds: number): string {
  return new Date(base + seconds * 1_000).toISOString();
}

function tago(
  vehicleId: string,
  seconds: number,
  stopSequence: number,
  overrides: Partial<VehicleObservation> = {},
): VehicleObservation {
  const stop = stops[stopSequence - 1]!;
  return {
    vehicleId,
    routeId: "SYN-ROUTE",
    observedAt: new Date(0).toISOString(),
    receivedAt: at(seconds),
    timestampSource: "unavailable",
    stopId: stop.stopId,
    stopSequence,
    latitude: stop.latitude,
    longitude: stop.longitude,
    directionCode: "1",
    receiveType: "TAGO_SNAPSHOT",
    ...overrides,
  };
}

function capture(snapshots: RideSnapshot[], overrides: Partial<RideCapture> = {}): RideCapture {
  return {
    schemaVersion: RIDE_CAPTURE_SCHEMA_VERSION,
    startedAt: at(0),
    endedAt: at(60),
    routeId: "SYN-ROUTE",
    cityCode: "999",
    boardingStopSequence: 3,
    destinationStopSequence: 7,
    boardedVehicleId: BOARDED,
    intervalMs: 5_000,
    stops,
    snapshots,
    markers: [{ at: at(0), kind: "boarded", stopSequence: 3 }],
    ...overrides,
  };
}

const labels = new Map([[BOARDED, "tracked"], [OTHER, "V1"]]);

function replay(snapshots: RideSnapshot[], overrides: Partial<RideCapture> = {}) {
  return replayMatching(capture(snapshots, overrides), { labels, boardedVehicleId: BOARDED });
}

/**
 * Three changing receipts ten seconds apart is the minimum the cadence
 * surrogate accepts, so every fixture that expects a selection has to move the
 * bus at least that much first.
 */
function movingRide(vehicleId: string, startStop: number): RideSnapshot[] {
  return [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [tago(vehicleId, seconds, startStop + index)],
  }));
}

test("a lone boarded vehicle is selected once its cadence becomes fresh", () => {
  const evidence = replay(movingRide(BOARDED, 3));

  assert.equal(evidence.evaluatedSnapshots, 3);
  assert.equal(evidence.selectionVerdict, "correct");
  assert.equal(evidence.firstCommit?.selectedLabel, "tracked");
  // Not the first snapshot: the surrogate needs repeated changing receipts, so
  // the matcher withholds until it has them. That delay is the feature.
  assert.equal(evidence.firstCommit?.snapshotsBefore, 2);
  assert.equal(evidence.outcomeCounts.selected_other, 0);
  assert.equal(evidence.outcomeCounts.withheld_unavailable, 2);
  assert.equal(evidence.usableForGate, true);
  assert.deepEqual(evidence.warnings, []);
});

test("a capture where the matcher would have picked the wrong bus fails the gate", () => {
  // The decoy sits exactly on the boarding stop while the bus the rider
  // actually boarded is four stops away. The matcher has no way to know which
  // one the rider will step onto, and it commits to the near one.
  const snapshots: RideSnapshot[] = [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [
      tago(OTHER, seconds, 3 + index),
      tago(BOARDED, seconds, 7),
    ],
  }));
  const evidence = replay(snapshots);

  assert.equal(evidence.selectionVerdict, "wrong", "this is the catastrophic outcome the gate exists to count");
  assert.equal(evidence.firstCommit?.selectedLabel, "V1");
  assert.ok(evidence.outcomeCounts.selected_other > 0);
  assert.equal(evidence.outcomeCounts.selected_boarded, 0);
  assert.match(evidence.warnings.join(" "), /would have committed to a vehicle the rider did not board/);

  // Why it went wrong matters as much as that it did. The boarded bus was not
  // outscored — it was excluded, because a vehicle that never moves reads as
  // `aging` and `aging` never unlocks matching. Only the decoy was eligible.
  assert.equal(evidence.firstCommit?.eligibleCount, 1);
  assert.equal(evidence.staleData.boardedCadenceStates.fresh, 0);
  assert.ok(evidence.staleData.boardedCadenceStates.aging > 0);
});

test("a wrong match is still caught when both candidates are eligible and it is decided on score", () => {
  // Both buses report changing coordinates, so both reach `fresh` and both are
  // eligible. Their stop sequences stay put, which keeps the boarding-distance
  // scores apart: the decoy sits on the boarding stop and the boarded bus is
  // four stops away, a 20-point gap that clears the 12-point ambiguity margin.
  // A smaller gap is withheld as ambiguous, which is the matcher working.
  const snapshots: RideSnapshot[] = [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [
      tago(OTHER, seconds, 3, { latitude: 33.52 + index * 0.0005 }),
      tago(BOARDED, seconds, 7, { latitude: 33.56 + index * 0.0005 }),
    ],
  }));
  const evidence = replay(snapshots);

  assert.equal(evidence.selectionVerdict, "wrong");
  assert.equal(evidence.firstCommit?.selectedLabel, "V1");
  assert.equal(evidence.firstCommit?.eligibleCount, 2, "both were eligible; the matcher chose between them");
  assert.ok(evidence.contestedDecisions > 0);
  // The margin that produced a wrong answer is exactly the number
  // `AMBIGUITY_MARGIN` has to be calibrated against.
  assert.equal(typeof evidence.firstCommit?.margin, "number");
});

test("candidate margin is only measured where a second eligible candidate existed", () => {
  const alone = replay(movingRide(BOARDED, 3));
  assert.equal(alone.contestedDecisions, 0);
  assert.equal(alone.candidateMargin.count, 0, "a margin from an uncontested ride would be a fiction");

  const contested: RideSnapshot[] = [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [tago(BOARDED, seconds, 3 + index), tago(OTHER, seconds, 4 + index)],
  }));
  const evidence = replay(contested);
  assert.ok(evidence.contestedDecisions > 0);
  assert.equal(evidence.candidateMargin.count, evidence.contestedDecisions);
  assert.ok((evidence.candidateMargin.median ?? -1) >= 0);
});

test("a ride the matcher never commits to is safe, not correct", () => {
  // Present the whole time and never moving: continuous receipts, unchanged
  // content. The surrogate calls that `aging`, which never unlocks matching.
  const stationary: RideSnapshot[] = [0, 5, 10, 15].map((seconds) => ({
    capturedAt: at(seconds),
    vehicles: [tago(BOARDED, seconds, 3)],
  }));
  const evidence = replay(stationary);

  assert.equal(evidence.selectionVerdict, "never_committed");
  assert.equal(evidence.firstCommit, undefined);
  assert.equal(evidence.staleData.selectionsWhileNotFresh, 0);
  assert.ok(evidence.staleData.boardedCadenceStates.aging > 0);
  assert.equal(evidence.staleData.boardedCadenceStates.fresh, 0);
});

test("the matcher never selects a TAGO vehicle whose cadence is not fresh", () => {
  // A long hole in the middle: receipts resume but the gap exceeds the policy,
  // so the surrogate reports `stale` rather than picking up where it left off.
  const snapshots: RideSnapshot[] = [
    { capturedAt: at(0), vehicles: [tago(BOARDED, 0, 3)] },
    { capturedAt: at(5), vehicles: [tago(BOARDED, 5, 4)] },
    { capturedAt: at(60), vehicles: [tago(BOARDED, 60, 5)] },
    { capturedAt: at(65), vehicles: [tago(BOARDED, 65, 6)] },
  ];
  const evidence = replay(snapshots);

  assert.equal(evidence.staleData.selectionsWhileNotFresh, 0, "a non-zero value here is a bug, not a threshold");
  assert.ok(evidence.staleData.boardedNotFreshDecisions > 0);
  assert.ok(evidence.staleData.boardedCadenceStates.stale > 0);
});

test("a direction change on the boarded vehicle is counted as a reversal", () => {
  const snapshots: RideSnapshot[] = [
    { capturedAt: at(0), vehicles: [tago(BOARDED, 0, 3, { directionCode: "1" })] },
    { capturedAt: at(5), vehicles: [tago(BOARDED, 5, 4, { directionCode: "0" })] },
    { capturedAt: at(10), vehicles: [tago(BOARDED, 10, 5, { directionCode: "1" })] },
  ];
  const evidence = replay(snapshots);

  // Two changes, not two distinct codes: 1→0→1 reverses twice and would look
  // like a single anomaly if only distinct values were counted.
  assert.equal(evidence.directionReversal.boardedDirectionChanges, 2);
  assert.equal(evidence.directionReversal.boardedDirectionCodes, 2);
});

test("a capture with no boarded vehicle is refused rather than scored", () => {
  const evidence = replayMatching(
    capture(movingRide(BOARDED, 3), { boardedVehicleId: undefined }),
    { labels },
  );
  assert.equal(evidence.selectionVerdict, "no_boarded_vehicle");
  assert.equal(evidence.usableForGate, false);
  assert.match(evidence.warnings.join(" "), /No boarded vehicle was recorded/);
});

test("a capture whose vehicles carry provider timestamps is not gate evidence for TAGO", () => {
  // TAGO never does this. A fixture that does would exercise the provider
  // timestamp path and prove nothing about the surrogate production relies on.
  const snapshots: RideSnapshot[] = [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [tago(BOARDED, seconds, 3 + index, {
      observedAt: at(seconds),
      timestampSource: "provider",
    })],
  }));
  const evidence = replay(snapshots);

  assert.equal(evidence.usableForGate, false);
  assert.match(evidence.warnings.join(" "), /cadence surrogate TAGO relies on was never exercised/);
});

test("failed snapshots are skipped without breaking cadence continuity", () => {
  const snapshots: RideSnapshot[] = [
    { capturedAt: at(0), vehicles: [tago(BOARDED, 0, 3)] },
    { capturedAt: at(5), vehicles: [], error: "TAGO payload has no body object" },
    { capturedAt: at(10), vehicles: [tago(BOARDED, 10, 4)] },
    { capturedAt: at(15), vehicles: [tago(BOARDED, 15, 5)] },
  ];
  const evidence = replay(snapshots);

  assert.equal(evidence.evaluatedSnapshots, 3, "the failed poll is not a decision point");
  assert.equal(evidence.selectionVerdict, "correct");
});

test("the gate evidence reaches the sanitized report and carries no vehicle number", () => {
  const report = analyzeRideCapture(capture(movingRide(BOARDED, 3)));

  assert.equal(report.matchGate.selectionVerdict, "correct");
  assert.equal(report.matchGate.firstCommit?.selectedLabel, "tracked");
  assert.equal(report.matchGate.usableForGate, true);

  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(BOARDED), "the report generator refuses raw identifiers; so must this section");
  assert.ok(!serialized.includes(OTHER));
});

test("a report whose matcher picked another vehicle still refuses to name it", () => {
  const snapshots: RideSnapshot[] = [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [tago(OTHER, seconds, 3 + index), tago(BOARDED, seconds, 7)],
  }));
  const report = analyzeRideCapture(capture(snapshots));

  assert.equal(report.matchGate.selectionVerdict, "wrong");
  assert.equal(report.matchGate.firstCommit?.selectedLabel, "V1");
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(OTHER), "a wrong match is exactly when a raw number must not leak");
});
