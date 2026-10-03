/**
 * The official Jeju timetable dataset: schema, validation, staleness and the
 * last bus. The Route 365 dataset is the real file's parse (downloaded
 * 2026-10-03, `fixtures/jeju/timetables/365.json`); every other dataset here
 * is SYNTHETIC (invented times and places, a repeated-letter checksum).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TIMETABLE_FRESH_DAYS,
  TIMETABLE_SCHEMA_VERSION,
  TIMETABLE_USABLE_DAYS,
  TimetableDatasetError,
  lastDeparture,
  lastTimeAt,
  timetableFreshness,
  validateTimetableDataset,
  type OfficialTimetableDataset,
  type TimetableService,
} from "../src/officialTimetable.ts";

const route365 = JSON.parse(readFileSync(new URL("../../../fixtures/jeju/timetables/365.json", import.meta.url), "utf8")) as unknown;

function service(overrides: Partial<TimetableService> = {}): TimetableService {
  return {
    sheet: "SYNTHETIC",
    dayType: "weekday",
    dayLabel: "평일",
    direction: "합성A→합성B",
    effectiveFrom: "2026-06-24",
    summary: "SYNTHETIC",
    timepoints: ["합성A", "합성B"],
    trips: [
      { times: [null, "06:10"], startsAt: { place: "합성C", time: "06:00", column: "합성A" } },
      { times: ["12:30", "12:40"] },
      { times: ["22:10", "22:20"] },
    ],
    ...overrides,
  };
}

function dataset(overrides: Partial<OfficialTimetableDataset> = {}): OfficialTimetableDataset {
  return {
    schemaVersion: TIMETABLE_SCHEMA_VERSION,
    label: "OFFICIAL_DATED",
    source: {
      publisher: "SYNTHETIC",
      dataset: "data.go.kr 3043887",
      page: "https://bus.jeju.go.kr/publicTrafficInformation/generalBusSchedule",
      file: "SYNTHETIC.xlsx",
      sha256: "a".repeat(64),
    },
    retrievedOn: "2026-10-01",
    parser: { name: "synthetic", version: "0" },
    routeNumber: "999",
    services: [service(), service({ dayType: "daily", trips: [{ times: ["06:30", "06:40"] }, { times: ["21:40", "21:50"] }] })],
    ...overrides,
  };
}

test("the committed Route 365 dataset validates and says what the file says", () => {
  const real = validateTimetableDataset(route365);
  assert.equal(real.routeNumber, "365");
  assert.equal(real.retrievedOn, "2026-10-03");
  assert.equal(real.source.sha256, "8eafd16b3393be8c15ff26098edadde73fd10cd66d4584e9a6aa95b08b6d07a4");
  const weekday = "한라대→공항→시청→제주대";
  assert.deepEqual(lastDeparture(real, weekday, "weekday", "2026-10-03"), { time: "21:55", asOf: "2026-10-03", freshness: "fresh", effectiveFrom: "2026-06-24" });
  assert.deepEqual(lastTimeAt(real, weekday, "제주시청", "weekday", "2026-10-03")?.time, "22:44");
  assert.deepEqual(lastTimeAt(real, "제주대→시청→공항→한라대", "공항", "saturday_sunday_holiday", "2026-10-04")?.time, "22:37");
  // 영주고 is served only by morning weekday trips.
  assert.equal(lastTimeAt(real, weekday, "영주고", "weekday", "2026-10-03")?.time, "08:10");
  assert.equal(lastTimeAt(real, weekday, "영주고", "saturday_sunday_holiday", "2026-10-04"), undefined, "the holiday sheet has no 영주고 column");
  // The first trip starts at 월성마을, which no column heads.
  assert.deepEqual(real.services[0]!.trips[0]!.startsAt, { place: "월성마을", time: "06:03", column: "공항" });
});

test("a well-formed dataset validates", () => {
  assert.equal(validateTimetableDataset(dataset()).routeNumber, "999");
});

test("validation refuses what it cannot vouch for", () => {
  const trips = (value: TimetableService["trips"]) => ({ ...dataset(), services: [service({ trips: value })] });
  const bad: Array<[string, unknown]> = [
    ["v1 schema", { ...dataset(), schemaVersion: "tapso-jeju-timetable-v1" }],
    ["live label", { ...dataset(), label: "LIVE" }],
    ["no checksum", { ...dataset(), source: { ...dataset().source, sha256: "" } }],
    ["bad date", { ...dataset(), retrievedOn: "2026-02-30" }],
    ["bad effective date", { ...dataset(), services: [service({ effectiveFrom: "2026-13-01" })] }],
    ["descending within a trip", trips([{ times: ["12:00", "06:00"] }])],
    ["after midnight", trips([{ times: ["23:50", "24:10"] }])],
    ["start after the first time", trips([{ times: ["06:00", "06:10"], startsAt: { place: "합성C", time: "06:05", column: "합성A" } }])],
    ["start under an unknown column", trips([{ times: [null, "06:10"], startsAt: { place: "합성C", time: "06:00", column: "합성Z" } }])],
    ["out of order at a timepoint", trips([{ times: ["07:00", "07:10"] }, { times: ["06:00", "06:10"] }])],
    ["wrong width", trips([{ times: ["06:00"] }])],
    ["serves nothing", trips([{ times: [null, null] }])],
    ["repeated service", { ...dataset(), services: [service(), service()] }],
    ["unknown day type", { ...dataset(), services: [service({ dayType: "holiday" as never })] }],
    ["one timepoint", { ...dataset(), services: [service({ timepoints: ["합성A"], trips: [{ times: ["06:00"] }] })] }],
    ["no services", { ...dataset(), services: [] }],
  ];
  for (const [why, value] of bad) assert.throws(() => validateTimetableDataset(value), TimetableDatasetError, why);
});

test("freshness is counted from the download date and fails closed", () => {
  const at = (today: string) => timetableFreshness(dataset(), today);
  assert.equal(at("2026-10-01"), "fresh");
  assert.equal(at(addDays("2026-10-01", TIMETABLE_FRESH_DAYS)), "fresh");
  assert.equal(at(addDays("2026-10-01", TIMETABLE_FRESH_DAYS + 1)), "aging");
  assert.equal(at(addDays("2026-10-01", TIMETABLE_USABLE_DAYS)), "aging");
  assert.equal(at(addDays("2026-10-01", TIMETABLE_USABLE_DAYS + 1)), "stale");
  assert.equal(at("2026-09-30"), "unknown", "downloaded in the future");
  assert.equal(at("not a date"), "unknown");
});

test("a last bus comes only from a usable dataset and a service in effect, with its as-of date", () => {
  const direction = "합성A→합성B";
  assert.deepEqual(lastDeparture(dataset(), direction, "weekday", "2026-10-02"), { time: "22:10", asOf: "2026-10-01", freshness: "fresh", effectiveFrom: "2026-06-24" });
  assert.equal(lastDeparture(dataset(), direction, "saturday", "2026-10-02")?.time, "21:40", "falls back to daily");
  assert.equal(lastDeparture(dataset(), direction, "weekday", addDays("2026-10-01", TIMETABLE_USABLE_DAYS + 1)), undefined, "stale");
  assert.equal(lastDeparture(dataset(), "다른 방향", "weekday", "2026-10-02"), undefined);
  const notYet = dataset({ services: [service({ effectiveFrom: "2026-10-10" })] });
  assert.equal(lastDeparture(notYet, direction, "weekday", "2026-10-05"), undefined, "not in effect yet");
  // A trip that starts off the table departs at its start time.
  const onlyFirst = dataset({ services: [service({ trips: [service().trips[0]!] })] });
  assert.equal(lastDeparture(onlyFirst, direction, "weekday", "2026-10-02")?.time, "06:00");
  assert.equal(lastTimeAt(dataset(), direction, "합성B", "weekday", "2026-10-02")?.time, "22:20");
  assert.equal(lastTimeAt(dataset(), direction, "합성C", "weekday", "2026-10-02"), undefined, "a place no column heads");
});

function addDays(date: string, count: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}
