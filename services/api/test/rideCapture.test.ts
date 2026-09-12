import test from "node:test";
import assert from "node:assert/strict";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { ProviderResponseError } from "../src/provider.ts";
import { analyzeRideCapture, RIDE_CAPTURE_SCHEMA_VERSION, summarize, type RideCapture, type RideSnapshot } from "../src/rideCapture.ts";
import {
  applyCommand,
  describeCurrentVehicles,
  describeRideStart,
  describeStatus,
  describeStopWindow,
  maskVehicleId,
  resolveVehicleSelection,
  startRideCapture,
} from "../src/rideCaptureRunner.ts";

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

test("summarize reports the quartiles Task C needs, not just the median", () => {
  const summary = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(summary.count, 10);
  assert.equal(summary.min, 1);
  assert.equal(summary.median, 5.5);
  assert.equal(summary.p75, 7.75);
  assert.equal(summary.p90, 9.1);
  assert.equal(summary.max, 10);
  assert.deepEqual(summarize([]), { count: 0 });
});

test("vehicle selection resolves an exact number, a unique suffix, and refuses an ambiguous one", () => {
  const present = [observation("제주79자1234", 0, 4), observation("제주79자5234", 0, 9), observation("제주80자7777", 0, 2)];
  assert.deepEqual(
    { ...resolveVehicleSelection(present, "제주79자1234"), observation: undefined },
    { status: "exact", vehicleId: "제주79자1234", observation: undefined },
  );
  assert.equal(resolveVehicleSelection(present, "7777").status, "suffix");
  assert.equal(resolveVehicleSelection(present, "1234").vehicleId, "제주79자1234");
  // Both 1234 and 5234 end in 234, so the tool must not pick one.
  const ambiguous = resolveVehicleSelection(present, "234");
  assert.equal(ambiguous.status, "ambiguous");
  assert.deepEqual(ambiguous.matches, ["제주79자1234", "제주79자5234"]);
  assert.equal(resolveVehicleSelection(present, "0000").status, "absent");
  assert.equal(resolveVehicleSelection([], "1234").status, "absent");
  assert.equal(maskVehicleId("제주79자1234"), "…1234");
  assert.equal(maskVehicleId("123"), "123");
});

test("boarding cross-checks the typed number against the live snapshot", () => {
  const now = () => new Date(base);
  const ride = capture([
    { capturedAt: at(0), vehicles: [observation("제주79자1234", 0, 3), observation("제주79자5234", 0, 6)] },
  ], { boardedVehicleId: undefined });

  const log: string[] = [];
  assert.equal(applyCommand(ride, "b 1234", now, (line) => log.push(line)), true);
  assert.equal(ride.boardedVehicleId, "제주79자1234");
  assert.ok(log.some((line) => line.includes("…1234") && line.includes("confirm this is the bus")));
  assert.equal(log.some((line) => line.includes("제주79자1234")), false, "the full plate must not be printed");

  assert.throws(() => applyCommand(ride, "b 234", now, () => {}), /matches 2 vehicles/);
  assert.equal(ride.boardedVehicleId, "제주79자1234", "an ambiguous entry must not change the selection");

  const warnings: string[] = [];
  assert.equal(applyCommand(ride, "b 제주99자0001", now, (line) => warnings.push(line)), true);
  assert.equal(ride.boardedVehicleId, "제주99자0001", "an unmatched number is still honoured verbatim");
  assert.ok(warnings.some((line) => line.startsWith("WARNING:")));
  assert.ok(warnings.some((line) => line.includes("replacing the previously recorded vehicle")));
});

test("the rider briefing names the stops instead of only numbering them", () => {
  const ride = capture([]);
  const briefing = describeRideStart(ride, { maxSnapshots: 720, maxDurationMs: 90 * 60_000 });
  assert.ok(briefing.includes("route SYN-ROUTE · city 999 · 8 stops"));
  assert.ok(briefing.includes("direction: Synthetic 1 → Synthetic 8"));
  assert.ok(briefing.includes("boarding      3  Synthetic 3"));
  assert.ok(briefing.includes("destination   7  Synthetic 7"));
  assert.ok(briefing.includes("limits: 720 snapshots, 90 minutes"));

  const window = describeStopWindow(ride);
  assert.deepEqual(window.split("\n").map((line) => line.trim().split(/\s+/)[0]), ["3", "4", "5", "6", "7"]);
  assert.ok(window.includes("← board here"));
  assert.ok(window.includes("← get off here"));
});

test("status and vehicle listings stay readable and masked mid-ride", () => {
  const ride = capture([
    { capturedAt: at(0), vehicles: [observation("제주79자9999", 0, 4), observation("제주79자5678", 0, 6)] },
    { capturedAt: at(5), vehicles: [], error: "TAGO request failed or timed out" },
  ]);
  ride.markers.push({ at: at(3), kind: "passed_stop", stopSequence: 4 });

  const vehicles = describeCurrentVehicles(ride);
  assert.ok(vehicles.includes("…9999"));
  assert.equal(vehicles.includes("제주79자5678"), false);
  assert.ok(vehicles.includes("← tracked"), "the boarded vehicle is marked in the list");

  const status = describeStatus(ride, new Date(base + 125_000));
  assert.ok(status.startsWith("[02:05] snapshots 2 (1 failed)"));
  assert.ok(status.includes("markers 1"));
  assert.ok(status.includes("tracked …9999 seq 4/7"));
  assert.ok(status.includes("last marker passed_stop @4"));

  assert.equal(describeCurrentVehicles(capture([])), "no vehicles reported on this route in the last snapshot");
});

test("reports presence, advance distribution, and how GPS tracks nodeord", () => {
  const tracked = "제주79자9999";
  const report = analyzeRideCapture(capture([
    { capturedAt: at(0), vehicles: [observation(tracked, 0, 3, 33.5)] },
    { capturedAt: at(5), vehicles: [observation(tracked, 5, 3, 33.51)] },  // moved, same stop
    { capturedAt: at(10), vehicles: [observation(tracked, 10, 4, 33.51)] }, // new stop, same point
    { capturedAt: at(15), vehicles: [] },                                   // absent
    { capturedAt: at(20), vehicles: [observation(tracked, 20, 6, 33.52)] }, // skipped a stop
    { capturedAt: at(25), vehicles: [observation(tracked, 25, 7, 33.53)] },
  ]));

  const timeline = report.vehicles[0]!;
  assert.equal(timeline.snapshotsSeen, 5);
  assert.equal(timeline.presenceRatio, 0.83);
  assert.deepEqual(timeline.sequenceAdvances, { count: 3, min: 1, median: 1, p75: 1.5, p90: 1.8, p95: 1.9, max: 2 });
  assert.equal(timeline.largestSequenceJump, 2);
  assert.equal(timeline.largestSequenceDecrease, 0);
  assert.deepEqual(timeline.gpsEvidence, {
    coordinateSamples: 5,
    coordinateChanges: 3,
    coordinateChangeWithoutSequenceChange: 1,
    sequenceChangeWithoutCoordinateChange: 1,
  });
  assert.equal(report.tracked.presenceRatio, 0.83);
  assert.equal(report.configuredIntervalSeconds, 5);
  assert.equal(report.freshnessEvidence.sequenceAdvanceStops.max, 2);
});

test("counts what makes a capture file itself untrustworthy", () => {
  const tracked = "제주79자9999";
  const duplicated = observation(tracked, 10, 4);
  const report = analyzeRideCapture(capture([
    { capturedAt: at(10), vehicles: [duplicated, duplicated, { ...observation("제주79자1111", 10, 2), routeId: "OTHER-ROUTE" }] },
    { capturedAt: at(5), vehicles: [observation(tracked, 5, 3)] },
    { capturedAt: at(5), vehicles: [observation(tracked, 5, 3)] },
  ], {
    markers: [
      { at: at(30), kind: "passed_stop", stopSequence: 5 },
      { at: at(20), kind: "passed_stop", stopSequence: 4 },
      { at: at(900), kind: "note", note: "after the capture ended" },
    ],
  }));

  assert.deepEqual(report.integrity, {
    snapshotsOutOfOrder: 1,
    duplicateSnapshotTimestamps: 1,
    duplicateVehicleObservations: 1,
    markersOutOfOrder: 1,
    markersOutsideCaptureWindow: 1,
    foreignRouteObservations: 1,
  });
  for (const fragment of ["out of chronological order", "share a capture timestamp", "belong to another route"]) {
    assert.ok(report.warnings.some((warning) => warning.includes(fragment)), fragment);
  }
});

test("says INSUFFICIENT_EVIDENCE instead of inventing a distribution", () => {
  const thin = analyzeRideCapture(capture([
    { capturedAt: at(0), vehicles: [observation("제주79자9999", 0, 3)] },
    { capturedAt: at(5), vehicles: [observation("제주79자9999", 5, 4)] },
  ]));
  assert.equal(thin.evidenceCompleteness.verdict, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(thin.evidenceCompleteness.unmetRequired, [
    "successfulSnapshots",
    "trackedSequenceProgression",
    "contentChangeSamples",
    "markerLagSamples",
  ]);
  assert.equal(thin.evidenceCompleteness.criteria.find((c) => c.name === "trackedVehiclePresent")!.met, true);

  // Coordinates drift every poll, as they do on a moving bus, so the cadence
  // distribution has samples even while nodeord sits on one stop.
  const snapshots: RideSnapshot[] = Array.from({ length: 24 }, (_, index) => ({
    capturedAt: at(index * 5),
    vehicles: [observation("제주79자9999", index * 5, Math.min(7, 3 + Math.floor(index / 4)), 33.5 + index * 0.001)],
  }));
  const rich = analyzeRideCapture(capture(snapshots, {
    endedAt: at(24 * 5),
    markers: [
      { at: at(10), kind: "boarded", stopSequence: 3 },
      { at: at(20), kind: "passed_stop", stopSequence: 4 },
      { at: at(40), kind: "passed_stop", stopSequence: 5 },
      { at: at(60), kind: "passed_stop", stopSequence: 6 },
      { at: at(80), kind: "alighted", stopSequence: 7 },
    ],
  }));
  assert.equal(rich.evidenceCompleteness.verdict, "SUFFICIENT");
  assert.deepEqual(rich.evidenceCompleteness.unmetRequired, []);
  assert.equal(rich.freshnessEvidence.markerLagSeconds.count, 4);
  assert.ok(rich.freshnessEvidence.markerLagSeconds.p90 !== undefined);
});

test("an interrupted capture still analyses, and the boarded number never reaches the report", () => {
  const interrupted = capture([
    { capturedAt: at(0), vehicles: [observation("제주79자1111", 0, 4)] },
    { capturedAt: at(30), vehicles: [observation("제주79자1111", 30, 5)] },
  ], { endedAt: undefined, boardedVehicleId: "제주79자9999" });

  const report = analyzeRideCapture(interrupted);
  assert.equal(report.endedAt, undefined);
  assert.equal(report.durationSeconds, 30, "duration falls back to the last stored snapshot");
  assert.equal(report.tracked.present, false);
  assert.equal(JSON.stringify(report).includes("제주79자9999"), false);
  assert.equal(JSON.stringify(report).includes("제주79자1111"), false);
  assert.equal(report.evidenceCompleteness.verdict, "INSUFFICIENT_EVIDENCE");
});
