/**
 * The official Jeju timetable bundle (v3): validation, freshness, the
 * service-day engine and the per-route view. The committed bundle and Route
 * 365 dataset are the real files' parse (downloaded 2026-10-03); every other
 * dataset here is SYNTHETIC (invented places and times, a repeated-letter
 * checksum).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TIMETABLE_FRESH_DAYS,
  TIMETABLE_SCHEMA_VERSION,
  TIMETABLE_USABLE_DAYS,
  TimetableDatasetError,
  routeTimetableView,
  timetableFreshness,
  timetableIndex,
  validateTimetableBundle,
  validateTimetableDataset,
  type OfficialTimetableDataset,
  type TimetableBundle,
  type TimetableService,
} from "../src/officialTimetable.ts";
import { dayTypeApplies, koreanDate, serviceDay, validateHolidayCalendar, type HolidayCalendar } from "../src/serviceDay.ts";

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const realBundle = validateTimetableBundle(read("../data/jeju-timetables.json"));
const calendar = validateHolidayCalendar(read("../data/kr-public-holidays.json"));
const route365 = read("../../../fixtures/jeju/timetables/365.json");

function service(overrides: Partial<TimetableService> = {}): TimetableService {
  return {
    sheets: ["SYNTHETIC"],
    routeNumbers: ["999"],
    dayType: "weekday",
    dayLabel: "평일",
    direction: "합성A→합성B",
    effectiveFrom: "2026-06-24",
    summary: "SYNTHETIC",
    timepoints: ["합성A", "합성B"],
    trips: [
      { routeNumber: "999", times: [null, "06:10"], firstTime: "06:00", startsAt: { place: "합성C", time: "06:00", column: "합성A" } },
      { routeNumber: "999", times: ["12:30", "12:40"], firstTime: "12:30" },
      { routeNumber: "999", times: ["22:10", "22:20"], firstTime: "22:10" },
      { routeNumber: "999", times: ["23:00", "23:10"], firstTime: "23:00", conditions: ["11,12,1,2월 막차"], note: "11,12,1,2월 막차" },
    ],
    status: "ok",
    ...overrides,
  };
}

function dataset(services: TimetableService[] = [service()], overrides: Partial<OfficialTimetableDataset> = {}): OfficialTimetableDataset {
  return {
    schemaVersion: TIMETABLE_SCHEMA_VERSION,
    label: "OFFICIAL_DATED",
    source: { publisher: "SYNTHETIC", dataset: "SYNTHETIC", page: "https://synthetic.invalid", file: "999.xlsx", sha256: "a".repeat(64), scheduleId: "SYN999" },
    retrievedOn: "2026-10-03",
    parser: { name: "jeju-bis-xlsx", version: "3" },
    routeNumbers: ["999"],
    status: "parsed",
    services,
    ...overrides,
  };
}

function bundle(datasets: OfficialTimetableDataset[], retrievedOn = "2026-10-03"): TimetableBundle {
  return {
    schemaVersion: "tapso-jeju-timetable-bundle-v1",
    label: "OFFICIAL_DATED",
    bundleVersion: "0000000000000000",
    source: { page: "https://synthetic.invalid", dataset: "SYNTHETIC" },
    retrievedOn,
    retrievedAt: `${retrievedOn}T10:00:00+09:00`,
    parser: { name: "jeju-bis-xlsx", version: "3" },
    census: { entries: datasets.length + 1, counts: { parsed: datasets.length, no_timetable: 1 }, noTimetable: [{ scheduleId: "SYN888", name: "888", reason: "site_has_none" }], refused: [] },
    datasets,
  };
}

/** A SYNTHETIC calendar: one weekday holiday, 2026-10-05. */
const synthetic: HolidayCalendar = {
  schemaVersion: "tapso-kr-public-holidays-v1",
  validFrom: "2026-01-01",
  validThrough: "2026-12-31",
  generator: { library: "SYNTHETIC", version: "0", category: "public" },
  sources: [],
  holidays: [{ date: "2026-10-05", name: "합성 대체 휴일" }],
};

test("the committed bundle validates in full and agrees with the census counts", () => {
  assert.deepEqual(realBundle.rejected, []);
  const { bundle: real } = realBundle;
  assert.equal(real.datasets.length, real.census.counts.parsed! + real.census.counts.source_conflict!);
  assert.equal(real.census.entries, Object.values(real.census.counts).reduce((sum, count) => sum + count, 0));
  assert.deepEqual(real.census.refused, [], "no committed file is outside the parser's grammar");
  for (const entry of real.datasets) assert.equal(entry.label, "OFFICIAL_DATED");
});

test("the hand-downloaded Route 365 file and the census copy say the same thing", () => {
  const mine = validateTimetableDataset(route365);
  const census = realBundle.bundle.datasets.find((entry) => entry.routeNumbers.includes("365"))!;
  assert.deepEqual(mine.services.map((entry) => entry.trips), census.services.map((entry) => entry.trips));
});

test("Route 365 on a substitute holiday uses its 토,공휴일 table, from the real calendar", () => {
  const view = routeTimetableView(realBundle.bundle, calendar, "365", "2026-10-05");
  assert.equal(view.serviceDay.publicHoliday?.name, "개천절 대체 휴일");
  assert.equal(view.status, "available");
  assert.equal(view.freshness, "fresh");
  assert.deepEqual(view.today.map((entry) => entry.dayLabel), ["토,공휴일", "토,공휴일"]);
  const weekday = routeTimetableView(realBundle.bundle, calendar, "365", "2026-10-07");
  assert.deepEqual(weekday.today.map((entry) => entry.dayLabel), ["평일", "평일"]);
  assert.deepEqual(weekday.today[0]!.first, { time: "06:00", from: "한라대" });
});

test("a route whose table states no day type is listed but never claimed for today", () => {
  const view = routeTimetableView(realBundle.bundle, calendar, "201", "2026-10-07");
  assert.equal(view.status, "available");
  assert.deepEqual(view.today, []);
  assert.ok(view.services.every((entry) => entry.applicability === "unstated" && entry.first !== null));
});

test("a conflicting table is withheld: no trips, no first or last bus", () => {
  const view = routeTimetableView(realBundle.bundle, calendar, "325", "2026-10-07");
  const withheld = view.services.filter((entry) => entry.status === "source_conflict");
  assert.ok(withheld.length > 0);
  for (const entry of withheld) {
    assert.deepEqual(entry.trips, []);
    assert.equal(entry.first, null);
    assert.ok(entry.conflicts!.length > 0);
  }
});

test("status for routes the census has no timetable for, or never listed", () => {
  assert.equal(routeTimetableView(realBundle.bundle, calendar, "888", "2026-10-07").status, "no_timetable");
  assert.equal(routeTimetableView(realBundle.bundle, calendar, "9999", "2026-10-07").status, "not_published");
  const index = timetableIndex(realBundle.bundle);
  assert.equal(index.find((entry) => entry.routeNo === "365")?.status, "available");
  assert.equal(index.find((entry) => entry.routeNo === "888")?.status, "no_timetable");
});

test("first and last ignore conditional trips, which are reported after the last", () => {
  const view = routeTimetableView(bundle([dataset()]), synthetic, "999", "2026-10-07");
  const [entry] = view.services;
  assert.deepEqual(entry!.first, { time: "06:00", from: "합성C" });
  assert.deepEqual(entry!.last, { time: "22:10", from: "합성A" });
  assert.deepEqual(entry!.laterConditional, [{ time: "23:00", from: "합성A", conditions: ["11,12,1,2월 막차"] }]);
  assert.deepEqual(view.today, [{ direction: "합성A→합성B", first: entry!.first, last: entry!.last, dayLabel: "평일", applicability: "applies" }]);
});

test("today is withheld when stale, before the 시행일, or when two services answer one direction", () => {
  const stale = routeTimetableView(bundle([dataset()], "2026-06-01"), synthetic, "999", "2026-10-07");
  assert.equal(stale.freshness, "stale");
  assert.deepEqual(stale.today, []);
  assert.equal(stale.services[0]!.first?.time, "06:00", "the dated record is still shown");

  const early = routeTimetableView(bundle([dataset([service({ effectiveFrom: "2026-11-01" })])]), synthetic, "999", "2026-10-07");
  assert.equal(early.services[0]!.inEffect, false);
  assert.deepEqual(early.today, []);

  const twice = routeTimetableView(bundle([dataset([service(), service({ sheets: ["SYNTHETIC-2"], dayType: "weekday" })])]), synthetic, "999", "2026-10-07");
  assert.deepEqual(twice.today, []);
});

test("validation refuses what it cannot vouch for; a bad dataset is dropped, not served", () => {
  assert.doesNotThrow(() => validateTimetableDataset(dataset()));
  const cases: [string, OfficialTimetableDataset][] = [
    ["schema", { ...dataset(), schemaVersion: "tapso-jeju-timetable-v2" as never }],
    ["label", { ...dataset(), label: "LIVE" as never }],
    ["checksum", dataset(undefined, { source: { ...dataset().source, sha256: "abc" } })],
    ["unknown day type", dataset([service({ dayType: "daily" as never })])],
    ["day label without a day type", dataset([service({ dayType: "unstated" })])],
    ["a conflict without its reason", dataset([service({ status: "source_conflict" })])],
    ["ok with conflicts", dataset([service({ conflicts: ["x"] })])],
    ["a time past 29:59", dataset([service({ trips: [{ routeNumber: "999", times: ["30:00", null], firstTime: "30:00" }] })])],
    ["times running backwards", dataset([service({ trips: [{ routeNumber: "999", times: ["06:10", "06:00"], firstTime: "06:10" }] })])],
    ["wrong width", dataset([service({ trips: [{ routeNumber: "999", times: ["06:10"], firstTime: "06:10" }] })])],
    ["another route's trip", dataset([service({ trips: [{ routeNumber: "998", times: ["06:10", null], firstTime: "06:10" }] })])],
  ];
  for (const [name, value] of cases) assert.throws(() => validateTimetableDataset(value), TimetableDatasetError, name);
  // A conflicting service is not re-checked for order: it is never served.
  assert.doesNotThrow(() => validateTimetableDataset(dataset([service({ status: "source_conflict", conflicts: ["trip 1: times run backwards"], trips: [{ routeNumber: "999", times: ["06:10", "06:00"], firstTime: "06:10" }] })])));
  const mixed = validateTimetableBundle(bundle([dataset(), { ...dataset(), schemaVersion: "x" as never, source: { ...dataset().source, scheduleId: "SYN-BAD" } }]));
  assert.equal(mixed.bundle.datasets.length, 1);
  assert.equal(mixed.rejected[0]!.scheduleId, "SYN-BAD");
});

test("late-night times from 24:00 are valid and sort after the evening", () => {
  const night = dataset([service({ dayType: "unstated", dayLabel: undefined, trips: [
    { routeNumber: "999", times: ["23:40", "24:05"], firstTime: "23:40" },
    { routeNumber: "999", times: ["24:20", "24:30"], firstTime: "24:20" },
  ], crossesMidnight: true })]);
  assert.doesNotThrow(() => validateTimetableDataset(night));
  const view = routeTimetableView(bundle([night]), synthetic, "999", "2026-10-07");
  assert.equal(view.services[0]!.last?.time, "24:20");
});

test("freshness is counted from the download date and fails closed", () => {
  assert.equal(timetableFreshness({ retrievedOn: "2026-10-03" }, "2026-10-03"), "fresh");
  assert.equal(timetableFreshness({ retrievedOn: "2026-10-03" }, addDays("2026-10-03", TIMETABLE_FRESH_DAYS + 1)), "aging");
  assert.equal(timetableFreshness({ retrievedOn: "2026-10-03" }, addDays("2026-10-03", TIMETABLE_USABLE_DAYS + 1)), "stale");
  assert.equal(timetableFreshness({ retrievedOn: "2026-10-04" }, "2026-10-03"), "unknown");
  assert.equal(timetableFreshness({ retrievedOn: "2026-02-30" }, "2026-10-03"), "unknown");
});

test("service days: weekday, Saturday, Sunday, weekday holiday, substitute holiday, outside the calendar", () => {
  const cases: [string, string, Record<string, string>][] = [
    // An ordinary Wednesday.
    ["2026-10-07", "wed", { weekday: "applies", saturday: "does_not_apply", sunday_holiday: "does_not_apply", saturday_sunday_holiday: "does_not_apply", holiday_saturday_unstated: "does_not_apply", unstated: "unstated" }],
    // An ordinary Saturday: "휴일" alone does not say whether it covers Saturday.
    ["2026-10-10", "sat", { weekday: "does_not_apply", saturday: "applies", sunday_holiday: "does_not_apply", saturday_sunday_holiday: "applies", holiday_saturday_unstated: "uncertain" }],
    ["2026-10-11", "sun", { weekday: "does_not_apply", saturday: "does_not_apply", sunday_holiday: "applies", saturday_sunday_holiday: "applies", holiday_saturday_unstated: "applies" }],
    // 한글날, a Friday holiday.
    ["2026-10-09", "fri", { weekday: "does_not_apply", sunday_holiday: "applies", saturday_sunday_holiday: "applies", holiday_saturday_unstated: "applies" }],
    // 개천절 (Saturday) gives a substitute holiday on Monday 2026-10-05.
    ["2026-10-05", "mon", { weekday: "does_not_apply", saturday_sunday_holiday: "applies" }],
    // 개천절 itself on a Saturday: the 토요일 table yields to the holiday one.
    ["2026-10-03", "sat", { saturday: "does_not_apply", sunday_holiday: "applies", saturday_sunday_holiday: "applies" }],
    // Beyond the calendar a weekday cannot be known not to be a holiday.
    ["2029-03-07", "wed", { weekday: "uncertain", saturday_sunday_holiday: "uncertain", sunday_holiday: "uncertain" }],
    ["2029-03-10", "sat", { saturday_sunday_holiday: "applies", weekday: "does_not_apply", saturday: "uncertain" }],
  ];
  for (const [date, weekday, expected] of cases) {
    const day = serviceDay(date, calendar);
    assert.equal(day.weekday, weekday, date);
    for (const [dayType, applicability] of Object.entries(expected)) assert.equal(dayTypeApplies(dayType, day), applicability, `${date} ${dayType}`);
  }
  assert.equal(dayTypeApplies("never_read_before", serviceDay("2026-10-07", calendar)), "uncertain");
  assert.equal(serviceDay("2029-03-07", calendar).publicHoliday, undefined);
  assert.equal(serviceDay("2026-10-07", calendar).publicHoliday, null);
});

test("the holiday calendar is the generated file, with its provenance, and refuses tampering", () => {
  assert.equal(calendar.generator.library, "holidays");
  assert.ok(calendar.sources.length >= 2);
  for (const date of ["2026-02-17", "2026-03-02", "2026-06-03", "2026-09-25", "2026-10-05"]) {
    assert.ok(calendar.holidays.some((entry) => entry.date === date), date);
  }
  assert.throws(() => validateHolidayCalendar({ ...calendar, holidays: [...calendar.holidays, calendar.holidays[0]] }));
  assert.throws(() => validateHolidayCalendar({ ...calendar, holidays: [{ date: "2030-01-01", name: "x" }] }));
});

test("the Korean date turns over at 15:00 UTC", () => {
  assert.equal(koreanDate(new Date("2026-10-03T14:59:59Z")), "2026-10-03");
  assert.equal(koreanDate(new Date("2026-10-03T15:00:00Z")), "2026-10-04");
});

function addDays(date: string, count: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}
