/**
 * NightGuard: the official timetable read for one instant, across midnight.
 * Every dataset built here is SYNTHETIC (invented places and times, a
 * repeated-letter checksum); the last tests read the committed real bundle
 * (downloaded 2026-10-03) and the real holiday calendar.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { nightGuardView, NIGHT_GUARD_SCHEMA_VERSION, type NightGuardEntry } from "../src/nightGuard.ts";
import { TIMETABLE_SCHEMA_VERSION, routeTimetableView, validateTimetableBundle, type OfficialTimetableDataset, type TimetableBundle, type TimetableService } from "../src/officialTimetable.ts";
import { validateHolidayCalendar } from "../src/serviceDay.ts";

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const calendar = validateHolidayCalendar(read("../data/kr-public-holidays.json"));
const realBundle = validateTimetableBundle(read("../data/jeju-timetables.json")).bundle;

/** A Korean wall-clock instant: `kst("2026-11-14", "00:05")`. */
const kst = (date: string, time: string): Date => new Date(`${date}T${time}:00+09:00`);

function service(overrides: Partial<TimetableService> = {}): TimetableService {
  return {
    sheets: ["SYNTHETIC"],
    routeNumbers: ["999"],
    dayType: "weekday",
    dayLabel: "평일",
    direction: "합성A→합성B",
    effectiveFrom: "2026-06-24",
    summary: "SYNTHETIC",
    timepoints: ["합성A", "합성중간", "합성B"],
    trips: [
      { routeNumber: "999", times: ["06:00", "06:20", "06:40"], firstTime: "06:00" },
      { routeNumber: "999", times: ["23:00", "23:20", "23:40"], firstTime: "23:00" },
      { routeNumber: "999", times: ["24:10", "24:30", "24:50"], firstTime: "24:10" },
    ],
    status: "ok",
    ...overrides,
  };
}

function bundle(services: TimetableService[], retrievedOn = "2026-11-01"): TimetableBundle {
  const dataset: OfficialTimetableDataset = {
    schemaVersion: TIMETABLE_SCHEMA_VERSION,
    label: "OFFICIAL_DATED",
    source: { publisher: "SYNTHETIC", dataset: "SYNTHETIC", page: "https://synthetic.invalid", file: "999.xlsx", sha256: "a".repeat(64), scheduleId: "SYN999" },
    retrievedOn,
    parser: { name: "synthetic", version: "1" },
    routeNumbers: ["999"],
    status: services.some((entry) => entry.status !== "ok") ? "source_conflict" : "parsed",
    services,
  };
  return {
    schemaVersion: "tapso-jeju-timetable-bundle-v1",
    label: "OFFICIAL_DATED",
    bundleVersion: "synthetic",
    source: { page: "https://synthetic.invalid", dataset: "SYNTHETIC" },
    retrievedOn,
    retrievedAt: `${retrievedOn}T10:00:00+09:00`,
    parser: { name: "synthetic", version: "1" },
    census: { entries: 1, counts: { parsed: 1 }, noTimetable: [], refused: [] },
    datasets: [dataset],
  };
}

const only = (entries: NightGuardEntry[]): NightGuardEntry => {
  assert.equal(entries.length, 1, `expected one entry, got ${JSON.stringify(entries.map((entry) => [entry.serviceDate, entry.dayType, entry.status]))}`);
  return entries[0]!;
};

test("after midnight, yesterday's table still answers for its 24:xx trips, on its own service date", () => {
  // Saturday 00:05: Friday's weekday table published a 24:10 departure.
  const view = nightGuardView(bundle([service()]), calendar, "999", kst("2026-11-14", "00:05"));
  assert.equal(view.schemaVersion, NIGHT_GUARD_SCHEMA_VERSION);
  assert.equal(view.localDate, "2026-11-14");
  assert.equal(view.localTime, "00:05");
  const entry = only(view.entries);
  assert.equal(entry.serviceDate, "2026-11-13", "the Friday service day");
  assert.equal(entry.status, "scheduled_departures_remain");
  assert.deepEqual(entry.next, { table: "24:10", clock: "00:10", date: "2026-11-14", at: "합성A", minutesFromNow: 5 });
  assert.ok(entry.reasons.includes("previous_service_day"));
  assert.ok(entry.reasons.includes("scheduled_not_observed"), "scheduled is never observed");
  assert.equal(entry.claimsOperating, false);
});

test("baseline: the date-only reader (routeTimetableView) has nothing for that same Saturday 00:05", () => {
  // `GET /v1/timetables` reads one calendar date. At 00:05 on Saturday it reads
  // Saturday, where the weekday table does not apply, so Friday's 24:10 is invisible.
  const legacy = routeTimetableView(bundle([service()]), calendar, "999", "2026-11-14");
  assert.deepEqual(legacy.today, []);
  assert.equal(legacy.services[0]?.applicability, "does_not_apply");
  // After 06:00 NightGuard stops reading Friday's table too.
  assert.equal(nightGuardView(bundle([service()]), calendar, "999", kst("2026-11-14", "06:30")).entries.length, 0);
});

test("once the last 24:xx trip has started, the status says so, and the bus is still en route to later stops", () => {
  const view = nightGuardView(bundle([service()]), calendar, "999", kst("2026-11-14", "00:15"));
  const entry = only(view.entries);
  assert.equal(entry.status, "last_scheduled_departed");
  assert.equal(entry.last?.table, "24:10");
  assert.equal(entry.last?.minutesFromNow, -5);
  assert.ok(entry.reasons.includes("measured_from_trip_start"), "measured at the trip's start, not the rider's stop");
  assert.ok(entry.reasons.includes("bus_may_run_late"));
});

test("yesterday's table is dropped once it publishes nothing at or after now", () => {
  const view = nightGuardView(bundle([service()]), calendar, "999", kst("2026-11-14", "01:30"));
  assert.equal(view.entries.length, 0);
});

test("a named timepoint is read in its own column; never interpolated", () => {
  const at = { timepoint: "합성B" };
  const before = only(nightGuardView(bundle([service()]), calendar, "999", kst("2026-11-14", "00:45"), at).entries);
  assert.deepEqual(before.measuredAt, { kind: "timepoint", name: "합성B", column: 2 });
  assert.equal(before.status, "scheduled_departures_remain", "24:50 at 합성B is still ahead");
  assert.equal(before.next?.table, "24:50");
  assert.equal(before.reasons.includes("measured_from_trip_start"), false);

  const missing = only(nightGuardView(bundle([service()]), calendar, "999", kst("2026-11-13", "23:10"), { timepoint: "없는정류장" }).entries);
  assert.ok(missing.reasons.includes("timepoint_not_published"));
  assert.deepEqual(missing.measuredAt, { kind: "trip_start" });

  const circular = service({ timepoints: ["합성A", "합성중간", "합성A"] });
  const ambiguous = only(nightGuardView(bundle([circular]), calendar, "999", kst("2026-11-13", "23:10"), { timepoint: "합성A" }).entries);
  assert.ok(ambiguous.reasons.includes("timepoint_ambiguous"));
  assert.deepEqual(ambiguous.measuredAt, { kind: "trip_start" });
});

test("a conditional trip after the last plain one makes the evening uncertain, never 'last bus gone'", () => {
  const winter = service({
    trips: [
      { routeNumber: "999", times: ["06:00", "06:20", "06:40"], firstTime: "06:00" },
      { routeNumber: "999", times: ["21:00", "21:20", "21:40"], firstTime: "21:00" },
      { routeNumber: "999", times: ["22:30", "22:50", "23:10"], firstTime: "22:30", conditions: ["11,12,1,2월 막차"] },
    ],
  });
  const entry = only(nightGuardView(bundle([winter]), calendar, "999", kst("2026-11-13", "21:30")).entries);
  assert.equal(entry.status, "uncertain");
  assert.ok(entry.reasons.includes("conditional_trips_later"));
  assert.equal(entry.last?.table, "21:00");
  assert.equal(entry.laterConditional[0]?.table, "22:30");
  assert.deepEqual(entry.laterConditional[0]?.conditions, ["11,12,1,2월 막차"]);
});

test("before the first departure of the day", () => {
  const entry = nightGuardView(bundle([service()]), calendar, "999", kst("2026-11-13", "05:30")).entries.find((candidate) => candidate.serviceDate === "2026-11-13");
  assert.equal(entry?.status, "before_first_departure");
  assert.equal(entry?.next?.table, "06:00");
});

test("a table with no day label is a table fact only: status unknown, its last departure kept and labelled", () => {
  const unstated = service({ dayType: "unstated", dayLabel: undefined });
  const entry = only(nightGuardView(bundle([unstated]), calendar, "999", kst("2026-11-13", "23:30")).entries);
  assert.equal(entry.status, "unknown");
  assert.equal(entry.evidence, "UNKNOWN");
  assert.equal(entry.next, null, "no next departure is claimed for a day the table does not name");
  assert.equal(entry.last?.table, "24:10");
  assert.ok(entry.reasons.includes("day_type_unstated"));
});

test("a source conflict is withheld: no times at all", () => {
  const conflict = service({ status: "source_conflict", conflicts: ["summary 막차 23:00 disagrees with the trips (24:10)"] });
  const entry = only(nightGuardView(bundle([conflict]), calendar, "999", kst("2026-11-13", "22:00")).entries);
  assert.equal(entry.evidence, "CONFLICTED");
  assert.equal(entry.status, "unknown");
  assert.equal(entry.next, null);
  assert.equal(entry.last, null);
  assert.ok(entry.reasons.includes("source_conflict"));
});

test("a stale dataset answers for no day", () => {
  const view = nightGuardView(bundle([service()], "2026-06-01"), calendar, "999", kst("2026-11-13", "22:00"));
  assert.equal(view.freshness, "stale");
  assert.deepEqual(view.reasons, ["timetable_stale"]);
  const entry = only(view.entries);
  assert.equal(entry.status, "unknown");
  assert.equal(entry.next, null);
  assert.ok(entry.reasons.includes("timetable_stale"));
});

test("a table whose 시행일 has not come is not in effect", () => {
  const entry = only(nightGuardView(bundle([service({ effectiveFrom: "2026-12-01" })]), calendar, "999", kst("2026-11-13", "22:00")).entries);
  assert.equal(entry.status, "unknown");
  assert.ok(entry.reasons.includes("not_in_effect"));
});

test("public holidays: a weekday table does not apply on 기독탄신일 (a Friday); the holiday table does", () => {
  const holiday = service({ dayType: "sunday_holiday", dayLabel: "일,공휴일", trips: [{ routeNumber: "999", times: ["07:00", "07:20", "07:40"], firstTime: "07:00" }, { routeNumber: "999", times: ["21:00", "21:20", "21:40"], firstTime: "21:00" }] });
  const view = nightGuardView(bundle([service(), holiday]), calendar, "999", kst("2026-12-25", "20:00"));
  const entry = only(view.entries);
  assert.equal(entry.dayType, "sunday_holiday");
  assert.equal(entry.next?.table, "21:00");
});

test("two applicable tables for one direction: uncertain, and neither next departure is offered", () => {
  const view = nightGuardView(bundle([service(), service({ sheets: ["SYNTHETIC-2"] })]), calendar, "999", kst("2026-11-13", "22:00"));
  assert.equal(view.entries.length, 2);
  for (const entry of view.entries) {
    assert.equal(entry.status, "uncertain");
    assert.ok(entry.reasons.includes("multiple_tables"));
    assert.equal(entry.next, null);
  }
});

test("validUntil is the minute after the next published time, so a cache never outlives a status", () => {
  const view = nightGuardView(bundle([service()]), calendar, "999", kst("2026-11-13", "22:58"));
  assert.equal(view.validUntil, kst("2026-11-13", "23:01").toISOString());
});

test("no entry ever claims a bus is operating", () => {
  for (const time of ["00:05", "05:30", "12:00", "22:59", "23:59"]) {
    for (const entry of nightGuardView(bundle([service()]), calendar, "999", kst("2026-11-13", time)).entries) {
      assert.equal(entry.claimsOperating, false);
    }
  }
});

// The committed real bundle (OFFICIAL_DATED 2026-10-03).

test("real bundle: every late-night route (3001–3008, 5001–5006) has no day label, so NightGuard never says 'tonight'", () => {
  const night = ["3001", "3002", "3003", "3004", "3005", "3006", "3007", "3008", "5001", "5002", "5003", "5004", "5005", "5006"];
  for (const routeNo of night) {
    const view = nightGuardView(realBundle, calendar, routeNo, kst("2026-11-09", "23:10"));
    assert.ok(view.entries.length > 0, `${routeNo} has a table`);
    for (const entry of view.entries) {
      assert.equal(entry.status, "unknown", `${routeNo} ${entry.direction}`);
      assert.ok(entry.reasons.includes(entry.evidence === "CONFLICTED" ? "source_conflict" : "day_type_unstated"));
      assert.equal(entry.next, null);
    }
  }
});

test("real bundle: 3001's self-contradicting table sends no times", () => {
  const view = nightGuardView(realBundle, calendar, "3001", kst("2026-11-09", "23:10"));
  assert.ok(view.entries.every((entry) => entry.evidence === "CONFLICTED" && entry.last === null));
});

test("real bundle: Route 365 on a Monday evening reads its weekday table (aging, as of 2026-10-03)", () => {
  const view = nightGuardView(realBundle, calendar, "365", kst("2026-11-09", "21:00"));
  assert.equal(view.freshness, "aging");
  assert.equal(view.asOf, "2026-10-03");
  const answered = view.entries.filter((entry) => entry.evidence === "OFFICIAL_DATED");
  assert.ok(answered.length > 0);
  for (const entry of answered) {
    assert.equal(entry.dayType, "weekday");
    assert.ok(["scheduled_departures_remain", "last_scheduled_departed", "uncertain"].includes(entry.status));
  }
});

test("real bundle: on 2027-01-01 every table turns stale unless the import is refreshed (90-day bound from 2026-10-03)", () => {
  assert.equal(nightGuardView(realBundle, calendar, "365", kst("2026-12-31", "21:00")).freshness, "aging");
  const view = nightGuardView(realBundle, calendar, "365", kst("2027-01-02", "21:00"));
  assert.equal(view.freshness, "stale");
  assert.ok(view.entries.every((entry) => entry.status === "unknown"));
});
