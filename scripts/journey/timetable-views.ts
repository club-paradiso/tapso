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

// Dates follow the bundle's own download date, so a weekly re-import never
// silently turns "today" into "unknown" (a view read for a day before the
// download is `unknown` by rule). The first Wednesday after the download that
// is not a public holiday stands for an ordinary weekday.
const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const isHoliday = (date: string): boolean => calendar.holidays.some((entry) => entry.date === date);
let weekday = addDays(bundle.retrievedOn, 1);
while (new Date(`${weekday}T00:00:00Z`).getUTCDay() !== 3 || isHoliday(weekday)) weekday = addDays(weekday, 1);

// The substitute-holiday case needs a 대체 휴일 inside the bundle's usable window,
// which most imports do not have: it reads the same real tables as if downloaded
// the day before 2026-10-05 (개천절 대체 휴일) and says so in `readAsOf`.
const substituteHoliday = "2026-10-05";
const asIfBefore = { ...bundle, retrievedOn: addDays(substituteHoliday, -1) };

const cases = [
  { name: "dated-weekday", routeNo: "365", date: weekday },
  { name: "dated-substitute-holiday", routeNo: "365", date: substituteHoliday, readAsOf: asIfBefore.retrievedOn },
  { name: "undated", routeNo: "201", date: weekday },
  { name: "partly-withheld", routeNo: "325", date: weekday },
  { name: "withheld", routeNo: "182", date: weekday },
  // 369: every sheet is a suspension notice in each census so far (888 gained a timetable on 2026-11-05).
  { name: "no-timetable", routeNo: "369", date: weekday },
  { name: "stale", routeNo: "365", date: addDays(bundle.retrievedOn, 120) },
];

const output = {
  schemaVersion: "tapso-timetable-views-v1",
  label: "OFFICIAL_DATED",
  generatedBy: "scripts/journey/timetable-views.ts",
  bundleVersion: bundle.bundleVersion,
  views: cases.map(({ name, routeNo, date, readAsOf }) => ({
    name,
    ...(readAsOf ? { readAsOf } : {}),
    item: routeTimetableView(readAsOf ? asIfBefore : bundle, calendar, routeNo, date),
  })),
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
