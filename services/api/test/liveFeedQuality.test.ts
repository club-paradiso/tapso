/**
 * Live feed quality checks. Every observation and stop list here is SYNTHETIC
 * (invented IDs and coordinates inside the Jeju box).
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { SEGMENT_SLACK_METERS, UNCHANGED_RECEIPTS_FLAG, assessFeedHistory, assessSnapshot } from "../src/liveFeedQuality.ts";

const stops: StopOnRoute[] = [
  { stopId: "SYN-S1", name: "합성1", sequence: 1, latitude: 33.50, longitude: 126.50 },
  { stopId: "SYN-S2", name: "합성2", sequence: 2, latitude: 33.505, longitude: 126.51 },
  { stopId: "SYN-S3", name: "합성3", sequence: 3, latitude: 33.51, longitude: 126.52 },
];
const routes = new Map([["SYN-R1", stops], ["SYN-R2", stops]]);

const row = (overrides: Partial<VehicleObservation> = {}): VehicleObservation => ({
  vehicleId: "SYN-V1",
  routeId: "SYN-R1",
  observedAt: "1970-01-01T00:00:00.000Z",
  receivedAt: "2026-11-08T03:00:00.000Z",
  timestampSource: "unavailable",
  stopId: "SYN-S2",
  stopSequence: 2,
  latitude: 33.5052,
  longitude: 126.5102,
  ...overrides,
});

test("a row that agrees with the route's stop list is clean", () => {
  const result = assessSnapshot([row()], routes);
  assert.equal(result.clean, 1);
  assert.deepEqual(result.vehicles[0]?.issues, []);
  assert.ok((result.vehicles[0]?.distanceToReportedStopMeters ?? Infinity) < 100);
});

test("each contradiction names itself and makes the row suspect, never repaired", () => {
  const cases: Array<[Partial<VehicleObservation>, string]> = [
    [{ latitude: undefined, longitude: undefined }, "missing_position"],
    [{ latitude: 37.5, longitude: 127.0 }, "outside_service_area"],
    [{ stopSequence: undefined }, "missing_stop_sequence"],
    [{ stopSequence: 9 }, "sequence_out_of_range"],
    [{ stopId: "SYN-S3" }, "stop_id_mismatch"],
    [{ latitude: 33.30, longitude: 126.30 }, "far_from_reported_stop"],
  ];
  for (const [overrides, issue] of cases) {
    const result = assessSnapshot([row(overrides)], routes);
    assert.ok(result.vehicles[0]!.issues.includes(issue as never), `${issue}: ${JSON.stringify(result.vehicles[0])}`);
    assert.equal(result.vehicles[0]!.suspect, true);
    assert.equal(result.byIssue[issue as never], 1);
  }
  assert.ok(SEGMENT_SLACK_METERS >= 1_000, "the bound only catches gross contradictions");
});

test("one vehicle on two variants at once is suspect on both", () => {
  const result = assessSnapshot([row(), row({ routeId: "SYN-R2" })], routes);
  assert.equal(result.suspect, 2);
  assert.ok(result.vehicles.every((vehicle) => vehicle.issues.includes("duplicate_vehicle_across_variants")));
});

test("a variant without a stop list is checked for position and duplication only", () => {
  const result = assessSnapshot([row({ routeId: "SYN-UNKNOWN", stopSequence: 99 })], routes);
  assert.deepEqual(result.vehicles[0]?.issues, []);
});

test("history: a backwards sequence is a regression, except across a loop's seam", () => {
  const forward = [row({ stopSequence: 1 }), row({ stopSequence: 2 }), row({ stopSequence: 1 })];
  assert.deepEqual(assessFeedHistory(forward).issues, ["sequence_regressed"]);
  const lap = [row({ stopSequence: 29 }), row({ stopSequence: 30 }), row({ stopSequence: 1 })];
  assert.equal(assessFeedHistory(lap, 30).regressions, 0);
});

test("history: identical receipts are counted as unchanged content, not as a stopped bus", () => {
  const same = Array.from({ length: UNCHANGED_RECEIPTS_FLAG }, () => row());
  const result = assessFeedHistory(same);
  assert.equal(result.longestUnchangedRun, UNCHANGED_RECEIPTS_FLAG);
  assert.deepEqual(result.issues, ["content_unchanged"]);
  assert.deepEqual(assessFeedHistory(same.slice(1)).issues, []);
});

test("regression (live, 2026-11-08): a bus near the NEXT stop on a long gap is clean, not far from its stop", () => {
  // SYNTHETIC coordinates with the observed geometry: a 5.4 km gap, the bus
  // 72 m before the next stop, so 5.3 km from the stop TAGO names (nodeord =
  // the stop last passed). The first rule (">5 km from the reported stop") flagged it.
  const longGap: StopOnRoute[] = [
    { stopId: "SYN-L1", name: "합성장거리1", sequence: 1, latitude: 33.400, longitude: 126.600 },
    { stopId: "SYN-L2", name: "합성장거리2", sequence: 2, latitude: 33.400, longitude: 126.658 },
  ];
  const nearNext = row({ routeId: "SYN-LONG", stopId: "SYN-L1", stopSequence: 1, latitude: 33.400, longitude: 126.6572 });
  const result = assessSnapshot([nearNext], new Map([["SYN-LONG", longGap]]));
  assert.ok((result.vehicles[0]?.distanceToReportedStopMeters ?? 0) > 5_000);
  assert.deepEqual(result.vehicles[0]?.issues, []);

  // Off the corridor entirely (8 km north of the segment): still flagged.
  const offRoad = row({ routeId: "SYN-LONG", stopId: "SYN-L1", stopSequence: 1, latitude: 33.472, longitude: 126.629 });
  assert.deepEqual(assessSnapshot([offRoad], new Map([["SYN-LONG", longGap]])).vehicles[0]?.issues, ["far_from_reported_stop"]);
});
