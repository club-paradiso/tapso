import test from "node:test";
import assert from "node:assert/strict";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { ProviderResponseError } from "../src/provider.ts";
import { analyzeRideCapture, RIDE_CAPTURE_SCHEMA_VERSION, type RideCapture, type RideSnapshot } from "../src/rideCapture.ts";
import { applyCommand, startRideCapture } from "../src/rideCaptureRunner.ts";

// Synthetic fixture: eight-stop route, ride from stop 3 to stop 7. Vehicle numbers are synthetic.
const base = Date.parse("2026-09-12T09:00:00+09:00");
const stops: StopOnRoute[] = Array.from({ length: 8 }, (_, index) => ({
  stopId: `SYN-${index + 1}`,
  name: `Synthetic ${index + 1}`,
  sequence: index + 1,
}));

function at(seconds: number): string {
  return new Date(base + seconds * 1_000).toISOString();
}

function observation(vehicleId: string, seconds: number, stopSequence: number, latitude = 33.5): VehicleObservation {
  return {
    vehicleId,
    routeId: "SYN-ROUTE",
    observedAt: new Date(0).toISOString(),
    receivedAt: at(seconds),
    timestampSource: "unavailable",
    stopId: `SYN-${stopSequence}`,
    stopSequence,
    latitude,
    longitude: 126.5,
    receiveType: "TAGO_SNAPSHOT",
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
    boardedVehicleId: "제주79자9999",
    intervalMs: 5_000,
    stops,
    snapshots,
    markers: [],
    ...overrides,
  };
}

test("tracks the boarded vehicle, gaps, arrival, and freshness evidence without exposing vehicle numbers", () => {
  const tracked = "제주79자9999";
  const other = "제주79자8888";
  const snapshots: RideSnapshot[] = [
    { capturedAt: at(0), vehicles: [observation(tracked, 0, 3), observation(other, 0, 6)] },
    { capturedAt: at(5), vehicles: [observation(tracked, 5, 3), observation(other, 5, 6)] }, // unchanged (age 5)
    { capturedAt: at(10), vehicles: [observation(tracked, 10, 4), observation(other, 10, 5)] }, // other reverses
    { capturedAt: at(15), vehicles: [observation(other, 15, 5)] }, // tracked missing
    { capturedAt: at(20), vehicles: [], error: "TAGO request failed or timed out" },
    { capturedAt: at(25), vehicles: [observation(tracked, 25, 5), observation(other, 25, 5)] },
    { capturedAt: at(30), vehicles: [observation(tracked, 30, 6), observation(other, 30, 5)] },
    { capturedAt: at(35), vehicles: [observation(tracked, 35, 7), observation(other, 35, 5)] },
    { capturedAt: at(40), vehicles: [observation(tracked, 40, 7), observation(other, 40, 5)] },
  ];
  const report = analyzeRideCapture(capture(snapshots, {
    markers: [
      { at: at(0), kind: "boarded", stopSequence: 3 },
      { at: at(22), kind: "passed_stop", stopSequence: 5 },
      { at: at(38), kind: "alighted", stopSequence: 7 },
    ],
  }));

  assert.equal(report.snapshotCount, 9);
  assert.equal(report.failedSnapshotCount, 1);
  assert.equal(report.uniqueVehicleCount, 2);
  assert.equal(report.stopSequenceContiguous, true);
  assert.equal(report.collectionIntervalSeconds.median, 5);

  const trackedTimeline = report.vehicles.find((vehicle) => vehicle.isTracked)!;
  assert.equal(trackedTimeline.label, "tracked");
  assert.equal(trackedTimeline.snapshotsSeen, 7);
  assert.equal(trackedTimeline.sequenceDecreaseCount, 0);
  assert.deepEqual(trackedTimeline.gaps, [{ missingFrom: at(15), missingUntil: at(25), seconds: 15, missedSnapshots: 1 }]);
  assert.equal(trackedTimeline.contentAgeSeconds.max, 5);
  assert.equal(trackedTimeline.contentChangeIntervalSeconds.max, 15);

  const otherTimeline = report.vehicles.find((vehicle) => !vehicle.isTracked)!;
  assert.equal(otherTimeline.label, "V2");
  assert.equal(otherTimeline.sequenceDecreaseCount, 1);
  assert.equal(otherTimeline.contentAgeSeconds.max, 30);

  assert.equal(report.tracked.present, true);
  assert.equal(report.tracked.passedBoardingAt, at(10));
  assert.equal(report.tracked.arrivalDetectedAt, at(35));
  assert.equal(report.tracked.passedDestination, false);
  assert.equal(report.tracked.missedSnapshotCount, 1);
  assert.deepEqual(report.tracked.remainingStopsTimeline.map((entry) => entry.remainingStops), [4, 3, 2, 1, 0]);

  const [boarded, passed, alighted] = report.tracked.markerComparisons;
  assert.equal(boarded!.providerReachedAt, undefined);
  assert.equal(passed!.providerReachedAt, at(25));
  assert.equal(passed!.providerLagSeconds, 3);
  assert.equal(alighted!.providerReachedAt, at(35));
  assert.equal(alighted!.providerLagSeconds, -3);

  assert.equal(report.freshnessEvidence.longestUnchangedRunSeconds, 30);
  assert.equal(report.freshnessEvidence.gapSeconds.count, 1);
  assert.deepEqual(report.warnings, []);

  const encoded = JSON.stringify(report);
  assert.equal(encoded.includes(tracked), false);
  assert.equal(encoded.includes(other), false);
});

test("warns when the boarded vehicle is absent or never arrives", () => {
  const missing = analyzeRideCapture(capture([
    { capturedAt: at(0), vehicles: [observation("제주79자1111", 0, 4)] },
  ]));
  assert.equal(missing.tracked.present, false);
  assert.ok(missing.warnings.some((warning) => warning.includes("never appeared")));

  const unfinished = analyzeRideCapture(capture([
    { capturedAt: at(0), vehicles: [observation("제주79자9999", 0, 4)] },
    { capturedAt: at(5), vehicles: [observation("제주79자9999", 5, 5)] },
  ]));
  assert.equal(unfinished.tracked.arrivalDetectedAt, undefined);
  assert.ok(unfinished.warnings.some((warning) => warning.includes("never reached the destination")));
});

test("rejects rides whose stop sequences are not on the official topology", () => {
  assert.throws(() => analyzeRideCapture(capture([], { boardingStopSequence: 9 })), /official stop sequence/);
  assert.throws(() => analyzeRideCapture(capture([], { boardingStopSequence: 7, destinationStopSequence: 3 })), /after boardingStopSequence/);
  assert.throws(() => analyzeRideCapture(capture([], { markers: [{ at: at(0), kind: "passed_stop", stopSequence: 42 }] })), /passed_stop markers/);
});

test("runner records snapshots, tolerates provider failures, and stops after arrival", async () => {
  let clock = base;
  const vehicleSequences = [3, 3, 4, 5, 6, 7, 7, 7, 7, 7, 7, 7, 7];
  let poll = 0;
  const provider = {
    async stops(request: RouteRequest) {
      assert.deepEqual(request, { routeId: "SYN-ROUTE", cityCode: "999" });
      return stops;
    },
    async vehicles(): Promise<VehicleObservation[]> {
      const index = poll++;
      if (index === 1) throw new ProviderResponseError("TAGO request failed or timed out");
      return [observation("제주79자9999", 0, vehicleSequences[index] ?? 7)];
    },
  };
  const persisted: number[] = [];
  const controller = startRideCapture({
    provider,
    routeId: "SYN-ROUTE",
    cityCode: "999",
    boardingStopSequence: 3,
    destinationStopSequence: 7,
    intervalMs: 5_000,
    snapshotsAfterArrival: 2,
    now: () => new Date(clock),
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    persist: (capture) => {
      persisted.push(capture.snapshots.length);
    },
  });
  controller.command("b 제주79자9999");
  const capture = await controller.done;

  assert.equal(capture.boardedVehicleId, "제주79자9999");
  assert.equal(capture.markers[0]!.kind, "boarded");
  assert.equal(capture.snapshots[1]!.error, "TAGO request failed or timed out");
  // Arrival at poll index 5 (sequence 7), then two more snapshots, then stop.
  assert.equal(capture.snapshots.length, 8);
  assert.ok(capture.endedAt);
  assert.equal(persisted.at(-1), 8);

  const report = analyzeRideCapture(capture);
  assert.equal(report.tracked.arrivalDetectedAt, capture.snapshots[5]!.capturedAt);
  assert.equal(report.failedSnapshotCount, 1);
});

test("runner honours quit and snapshot limits and enforces a minimum interval", async () => {
  let clock = base;
  const provider = {
    async stops() {
      return stops;
    },
    async vehicles(): Promise<VehicleObservation[]> {
      return [];
    },
  };
  const controller = startRideCapture({
    provider,
    routeId: "SYN-ROUTE",
    cityCode: "999",
    boardingStopSequence: 1,
    destinationStopSequence: 8,
    intervalMs: 500,
    maxSnapshots: 3,
    now: () => new Date(clock),
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    persist: () => {},
  });
  const capture = await controller.done;
  assert.equal(capture.snapshots.length, 3);
  assert.equal(capture.intervalMs, 3_000);
  assert.equal(Date.parse(capture.snapshots[2]!.capturedAt) - Date.parse(capture.snapshots[0]!.capturedAt), 6_000);

  const quitting = startRideCapture({
    provider,
    routeId: "SYN-ROUTE",
    cityCode: "999",
    boardingStopSequence: 1,
    destinationStopSequence: 8,
    now: () => new Date(clock),
    sleep: async () => {
      quitting.command("q");
    },
    persist: () => {},
  });
  assert.equal((await quitting.done).snapshots.length, 1);
});

test("rider commands validate stop sequences and record markers", () => {
  const ride = capture([]);
  const log: string[] = [];
  const now = () => new Date(base);
  assert.equal(applyCommand(ride, "p 5", now, (line) => log.push(line)), true);
  assert.equal(applyCommand(ride, "a", now, () => {}), true);
  assert.equal(applyCommand(ride, "n doors opened late", now, () => {}), true);
  assert.equal(applyCommand(ride, "q", now, () => {}), false);
  assert.throws(() => applyCommand(ride, "p 99", now, () => {}), /official stop sequence/);
  assert.throws(() => applyCommand(ride, "x", now, () => {}), /Unknown command/);
  assert.deepEqual(ride.markers.map((marker) => [marker.kind, marker.stopSequence]), [
    ["passed_stop", 5],
    ["alighted", 7],
    ["note", undefined],
  ]);
  assert.equal(log[0], "marker passed_stop @5");
});
