/**
 * Transit Evidence Engine: schedule, live and official notices combined
 * conservatively. Every input here is SYNTHETIC.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { NightGuardEntry } from "../src/nightGuard.ts";
import {
  LIVE_RECEIPT_MAX_AGE_SECONDS,
  OfficialNoticeError,
  activeNotices,
  aggregateRouteSchedule,
  assessOperatingEvidence,
  validateOfficialNotice,
  type LiveVehicleEvidence,
  type OfficialNotice,
} from "../src/transitEvidence.ts";

const now = new Date("2026-11-13T14:00:00Z"); // 23:00 KST

function schedule(overrides: Partial<NightGuardEntry> = {}): NightGuardEntry {
  return {
    direction: "합성A→합성B",
    serviceDate: "2026-11-13",
    dayType: "weekday",
    dayLabel: "평일",
    applicability: "applies",
    status: "scheduled_departures_remain",
    evidence: "OFFICIAL_DATED",
    measuredAt: { kind: "trip_start" },
    next: { table: "23:20", clock: "23:20", date: "2026-11-13", at: "합성A", minutesFromNow: 20 },
    last: { table: "23:20", clock: "23:20", date: "2026-11-13", at: "합성A", minutesFromNow: 20 },
    laterConditional: [],
    reasons: ["measured_from_trip_start", "scheduled_not_observed"],
    claimsOperating: false,
    ...overrides,
  };
}

const live = (overrides: Partial<LiveVehicleEvidence> = {}): LiveVehicleEvidence => ({
  status: "reported",
  vehicleCount: 2,
  receivedAt: new Date(now.getTime() - 10_000).toISOString(),
  observedAt: null,
  provenance: "TAGO getRouteAcctoBusLcList via TAPSO API (SYNTHETIC)",
  ...overrides,
});

const notice = (overrides: Partial<OfficialNotice> = {}): OfficialNotice => ({
  id: "SYN-NOTICE-1",
  kind: "suspension",
  routeNumbers: ["999"],
  effectiveFrom: "2026-11-13T00:00:00+09:00",
  effectiveUntil: "2026-11-14T00:00:00+09:00",
  source: { publisher: "SYNTHETIC", url: "https://synthetic.invalid/notice/1", retrievedOn: "2026-11-12", title: "SYNTHETIC 운행 중단" },
  reviewedBy: "SYNTHETIC reviewer",
  summary: "SYNTHETIC",
  ...overrides,
});

test("a reported vehicle is OBSERVED, never 'operating', and its receipt is never its observation time", () => {
  const result = assessOperatingEvidence({ routeNo: "999", schedule: schedule(), live: live(), now });
  assert.equal(result.claim, "vehicle_reported");
  assert.equal(result.label, "OBSERVED");
  assert.equal(result.claimsOperating, false);
  assert.ok(result.reasons.includes("provider_observation_time_unavailable"));
  assert.ok(result.reasons.includes("vehicle_reported_is_not_the_riders_bus"));
  const liveRecord = result.evidence.find((record) => record.kind === "live_vehicle_position")!;
  assert.equal(liveRecord.observedAt, null);
  assert.notEqual(liveRecord.receivedAt, null);
});

test("no vehicle while the timetable schedules more: scheduled, not observed — absence is not cancellation", () => {
  const result = assessOperatingEvidence({ routeNo: "999", schedule: schedule(), live: live({ status: "none_reported", vehicleCount: 0 }), now });
  assert.equal(result.claim, "scheduled_not_observed");
  assert.equal(result.label, "OFFICIAL_DATED");
  assert.ok(result.reasons.includes("absence_is_not_cancellation"));
});

test("no vehicle after the last scheduled departure: schedule-based, and the bus may still be late", () => {
  const result = assessOperatingEvidence({
    routeNo: "999",
    schedule: schedule({ status: "last_scheduled_departed", next: null }),
    live: live({ status: "none_reported", vehicleCount: 0 }),
    now,
  });
  assert.equal(result.claim, "no_scheduled_service_remaining");
  assert.ok(result.reasons.includes("bus_may_run_late"));
});

test("an old receipt is not evidence about now", () => {
  const old = live({ receivedAt: new Date(now.getTime() - (LIVE_RECEIPT_MAX_AGE_SECONDS + 1) * 1_000).toISOString() });
  const result = assessOperatingEvidence({ routeNo: "999", schedule: schedule(), live: old, now });
  assert.equal(result.claim, "scheduled_not_observed");
  assert.ok(result.reasons.includes("live_receipt_too_old"));
  assert.equal(result.evidence.find((record) => record.kind === "live_vehicle_position")?.label, "UNKNOWN");
});

test("live unavailable and no usable schedule: unknown, labelled UNAVAILABLE", () => {
  const result = assessOperatingEvidence({ routeNo: "999", schedule: null, live: live({ status: "unavailable", vehicleCount: 0, receivedAt: null }), now });
  assert.equal(result.claim, "unknown");
  assert.equal(result.label, "UNAVAILABLE");
});

test("an uncertain schedule stays unknown when no vehicle is reported", () => {
  const result = assessOperatingEvidence({ routeNo: "999", schedule: schedule({ status: "uncertain", next: null }), live: live({ status: "none_reported", vehicleCount: 0 }), now });
  assert.equal(result.claim, "unknown");
});

test("a vehicle reported long before the first scheduled departure conflicts with the table", () => {
  const early = schedule({ status: "before_first_departure", next: { table: "06:00", clock: "06:00", date: "2026-11-14", at: "합성A", minutesFromNow: 120 } });
  const result = assessOperatingEvidence({ routeNo: "999", schedule: early, live: live(), now });
  assert.equal(result.claim, "conflicting");
  assert.equal(result.label, "CONFLICTED");
});

test("a reviewed suspension notice in effect suspends; a vehicle during it is a conflict; an expired one is not read", () => {
  const suspended = assessOperatingEvidence({ routeNo: "999", schedule: schedule(), live: live({ status: "none_reported", vehicleCount: 0 }), notices: [notice()], now });
  assert.equal(suspended.claim, "officially_suspended");
  assert.deepEqual(suspended.notices, ["SYN-NOTICE-1"]);

  const conflicting = assessOperatingEvidence({ routeNo: "999", schedule: schedule(), live: live(), notices: [notice()], now });
  assert.equal(conflicting.claim, "conflicting");

  const expired = notice({ effectiveFrom: "2026-11-01T00:00:00+09:00", effectiveUntil: "2026-11-02T00:00:00+09:00" });
  assert.deepEqual(activeNotices([expired], "999", now), []);
  assert.equal(assessOperatingEvidence({ routeNo: "999", schedule: schedule(), live: live(), notices: [expired], now }).claim, "vehicle_reported");
});

test("a notice for one stop does not suspend the route", () => {
  const closure = notice({ kind: "suspension", stops: ["합성A"] });
  const result = assessOperatingEvidence({ routeNo: "999", schedule: schedule(), live: live({ status: "none_reported", vehicleCount: 0 }), notices: [closure], now });
  assert.equal(result.claim, "scheduled_not_observed");
});

test("notice records must expire, cite an https source and be reviewed", () => {
  assert.equal(validateOfficialNotice(notice()).id, "SYN-NOTICE-1");
  assert.throws(() => validateOfficialNotice({ ...notice(), effectiveUntil: undefined }), OfficialNoticeError);
  assert.throws(() => validateOfficialNotice({ ...notice(), effectiveUntil: "2026-11-12T00:00:00+09:00" }), /after effectiveFrom/);
  assert.throws(() => validateOfficialNotice({ ...notice(), source: { ...notice().source, url: "http://insecure.invalid" } }), /https/);
  assert.throws(() => validateOfficialNotice({ ...notice(), reviewedBy: "" }), /reviewed/);
  assert.throws(() => validateOfficialNotice({ ...notice(), kind: "rumour" }), /not one TAPSO reads/);
});

test("suspect rows are reported but never counted: only suspects means unknown, not 'no bus'", () => {
  const onlySuspect = assessOperatingEvidence({ routeNo: "999", schedule: schedule(), live: live({ vehicleCount: 2, suspectCount: 2 }), now });
  assert.equal(onlySuspect.claim, "unknown");
  assert.ok(onlySuspect.reasons.includes("all_reported_vehicles_suspect"));

  const mixed = assessOperatingEvidence({ routeNo: "999", schedule: schedule(), live: live({ vehicleCount: 2, suspectCount: 1 }), now });
  assert.equal(mixed.claim, "vehicle_reported");
  assert.ok(mixed.reasons.includes("some_reported_vehicles_suspect"));
});

test("route-number aggregate: any direction with departures left wins; all passed means passed; none answering is null", () => {
  const remain = schedule({ next: { table: "23:40", clock: "23:40", date: "2026-11-13", at: "합성A", minutesFromNow: 40 } });
  const sooner = schedule({ direction: "합성B→합성A", next: { table: "23:10", clock: "23:10", date: "2026-11-13", at: "합성B", minutesFromNow: 10 } });
  const passed = schedule({ direction: "합성C→합성D", status: "last_scheduled_departed", next: null });
  const unknown = schedule({ direction: "합성E", status: "unknown", evidence: "UNKNOWN", next: null });

  const mixed = aggregateRouteSchedule([remain, sooner, passed, unknown])!;
  assert.equal(mixed.status, "scheduled_departures_remain");
  assert.equal(mixed.next?.minutesFromNow, 10, "the earliest next departure");
  assert.ok(mixed.reasons.includes("route_number_aggregate"));

  const allPassed = aggregateRouteSchedule([passed, { ...passed, direction: "x", last: { ...passed.last!, minutesFromNow: -5 } }])!;
  assert.equal(allPassed.status, "last_scheduled_departed");
  assert.equal(allPassed.last?.minutesFromNow, 20, "the latest last departure is kept");

  assert.equal(aggregateRouteSchedule([unknown]), null);
  assert.equal(aggregateRouteSchedule([passed, schedule({ direction: "y", status: "uncertain", next: null })])?.status, "uncertain");
});
