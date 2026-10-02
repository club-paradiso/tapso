/**
 * The format-independent half of the official Jeju timetable pipeline:
 * schema, validation and the staleness rule. Every dataset here is SYNTHETIC
 * (invented times, a zero checksum pattern); no real timetable is in the repo.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  TIMETABLE_FRESH_DAYS,
  TIMETABLE_SCHEMA_VERSION,
  TIMETABLE_USABLE_DAYS,
  TimetableDatasetError,
  lastDeparture,
  timetableFreshness,
  validateTimetableDataset,
  type OfficialTimetableDataset,
} from "../src/officialTimetable.ts";

function dataset(overrides: Partial<OfficialTimetableDataset> = {}): OfficialTimetableDataset {
  return {
    schemaVersion: TIMETABLE_SCHEMA_VERSION,
    label: "OFFICIAL_DATED",
    source: {
      publisher: "SYNTHETIC",
      dataset: "data.go.kr 3043887",
      page: "https://bus.jeju.go.kr/publicTrafficInformation/generalBusSchedule?viewtype=2",
      file: "SYNTHETIC-365.xlsx",
      sha256: "a".repeat(64),
    },
    retrievedOn: "2026-10-01",
    parser: { name: "synthetic", version: "0" },
    routeNumber: "365",
    services: [
      { origin: "합성 기점", dayType: "weekday", departures: ["06:00", "12:30", "22:10"] },
      { origin: "합성 기점", dayType: "daily", departures: ["06:30", "21:40"] },
    ],
    ...overrides,
  };
}

test("a well-formed dataset validates", () => {
  assert.equal(validateTimetableDataset(dataset()).routeNumber, "365");
});

test("validation refuses what it cannot vouch for", () => {
  const bad: Array<[string, unknown]> = [
    ["live label", { ...dataset(), label: "LIVE" }],
    ["no checksum", { ...dataset(), source: { ...dataset().source, sha256: "" } }],
    ["bad date", { ...dataset(), retrievedOn: "2026-02-30" }],
    ["unsorted", { ...dataset(), services: [{ origin: "합성 기점", dayType: "weekday", departures: ["12:00", "06:00"] }] }],
    ["after midnight", { ...dataset(), services: [{ origin: "합성 기점", dayType: "weekday", departures: ["24:10"] }] }],
    ["repeated service", { ...dataset(), services: [dataset().services[0], dataset().services[0]] }],
    ["unknown day type", { ...dataset(), services: [{ origin: "합성 기점", dayType: "holiday", departures: ["06:00"] }] }],
    ["no services", { ...dataset(), services: [] }],
  ];
  for (const [why, value] of bad) assert.throws(() => validateTimetableDataset(value), TimetableDatasetError, why);
});

test("freshness is counted from the download date and fails closed", () => {
  const at = (today: string, extra: Partial<OfficialTimetableDataset> = {}) => timetableFreshness(dataset(extra), today);
  assert.equal(at("2026-10-01"), "fresh");
  assert.equal(at(addDays("2026-10-01", TIMETABLE_FRESH_DAYS)), "fresh");
  assert.equal(at(addDays("2026-10-01", TIMETABLE_FRESH_DAYS + 1)), "aging");
  assert.equal(at(addDays("2026-10-01", TIMETABLE_USABLE_DAYS)), "aging");
  assert.equal(at(addDays("2026-10-01", TIMETABLE_USABLE_DAYS + 1)), "stale");
  assert.equal(at("2026-09-30"), "unknown", "downloaded in the future");
  assert.equal(at("2026-10-05", { effectiveFrom: "2026-10-10" }), "unknown", "not in effect yet");
  assert.equal(at("not a date"), "unknown");
});

test("a last departure comes only from a usable dataset, with its as-of date", () => {
  assert.deepEqual(lastDeparture(dataset(), "합성 기점", "weekday", "2026-10-02"), { time: "22:10", asOf: "2026-10-01", freshness: "fresh" });
  assert.deepEqual(lastDeparture(dataset(), "합성 기점", "saturday", "2026-10-02"), { time: "21:40", asOf: "2026-10-01", freshness: "fresh" }, "falls back to daily");
  assert.equal(lastDeparture(dataset(), "합성 기점", "weekday", addDays("2026-10-01", TIMETABLE_USABLE_DAYS + 1)), undefined);
  assert.equal(lastDeparture(dataset(), "다른 기점", "weekday", "2026-10-02"), undefined);
});

function addDays(date: string, count: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}
