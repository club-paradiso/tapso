/**
 * Generates `fixtures/journey/timetable-views-v1.json`: real `GET /v1/timetables`
 * items produced by the server's own `routeTimetableView` from the committed
 * official bundle and holiday calendar (OFFICIAL_DATED, not synthetic), for a
 * few routes and dates chosen to cover each outcome: a dated route on a weekday
 * and on a substitute holiday, a route whose tables state no day type, a
 * withheld conflicting route, and a route with no timetable. The Swift core
 * decodes each and checks what the rider reads (`OfficialTimetableTests.swift`).
 *
 *   node --experimental-strip-types scripts/journey/timetable-views.ts [--check]
 *
 * `--check` regenerates in memory and exits 1 if the committed file differs.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { routeTimetableView, validateTimetableBundle } from "../../services/api/src/officialTimetable.ts";
import { validateHolidayCalendar } from "../../services/api/src/serviceDay.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string): unknown => JSON.parse(readFileSync(path.join(root, relative), "utf8"));
const { bundle } = validateTimetableBundle(read("services/api/data/jeju-timetables.json"));
const calendar = validateHolidayCalendar(read("services/api/data/kr-public-holidays.json"));

const cases = [
  { name: "dated-weekday", routeNo: "365", date: "2026-10-07" },
  { name: "dated-substitute-holiday", routeNo: "365", date: "2026-10-05" },
  { name: "undated", routeNo: "201", date: "2026-10-07" },
  { name: "partly-withheld", routeNo: "325", date: "2026-10-07" },
  { name: "withheld", routeNo: "182", date: "2026-10-07" },
  { name: "no-timetable", routeNo: "888", date: "2026-10-07" },
  { name: "stale", routeNo: "365", date: "2027-03-01" },
];

const output = {
  schemaVersion: "tapso-timetable-views-v1",
  label: "OFFICIAL_DATED",
  generatedBy: "scripts/journey/timetable-views.ts",
  bundleVersion: bundle.bundleVersion,
  views: cases.map(({ name, routeNo, date }) => ({ name, item: routeTimetableView(bundle, calendar, routeNo, date) })),
};
const text = `${JSON.stringify(output, null, 1)}\n`;
const target = path.join(root, "fixtures/journey/timetable-views-v1.json");
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== text) {
    console.error("fixtures/journey/timetable-views-v1.json is out of date; regenerate it");
    process.exit(1);
  }
  console.log("timetable views match");
} else {
  writeFileSync(target, text);
  console.log(`wrote ${cases.length} views`);
}
