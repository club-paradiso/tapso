/**
 * The reviewed, committed data the API serves as files rather than fetching:
 * the canonical transit catalog, the official timetable bundle and the
 * public-holiday calendar, all under `services/api/data/` (bundled into every
 * Vercel function by `vercel.json` → `includeFiles`).
 *
 * Each is read and validated once per process. A file that is missing or fails
 * validation is reported as unavailable with its reason; it is never served
 * half-checked, and its absence never stops the live endpoints.
 */

import { readFileSync } from "node:fs";

import { validateTimetableBundle, type TimetableBundle } from "./officialTimetable.ts";
import { validateHolidayCalendar, type HolidayCalendar } from "./serviceDay.ts";
import { validateCatalog, type TransitCatalog } from "./transitCatalog.ts";

export type Loaded<T> = { ok: true; value: T; bytes: string } | { ok: false; reason: string };

export interface StaticTransitData {
  catalog(): Loaded<TransitCatalog>;
  timetables(): Loaded<TimetableBundle>;
  holidays(): Loaded<HolidayCalendar>;
}

const DATA = new URL("../data/", import.meta.url);

export function fileStaticTransitData(base: URL = DATA): StaticTransitData {
  const memo = new Map<string, Loaded<unknown>>();
  const load = <T>(name: string, validate: (raw: unknown) => T): Loaded<T> => {
    const cached = memo.get(name);
    if (cached) return cached as Loaded<T>;
    let result: Loaded<T>;
    try {
      const bytes = readFileSync(new URL(name, base), "utf8");
      result = { ok: true, value: validate(JSON.parse(bytes)), bytes };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      result = { ok: false, reason: code === "ENOENT" ? `${name} is not deployed` : `${name}: ${(error as Error).message}` };
    }
    memo.set(name, result);
    return result;
  };
  return {
    catalog: () => load("jeju-transit-catalog.json", validateCatalog),
    timetables: () => load("jeju-timetables.json", (raw) => validateTimetableBundle(raw).bundle),
    holidays: () => load("kr-public-holidays.json", validateHolidayCalendar),
  };
}

/** For tests and local runs: data given directly. */
export function inMemoryStaticTransitData(values: { catalog?: TransitCatalog; timetables?: TimetableBundle; holidays?: HolidayCalendar }): StaticTransitData {
  const wrap = <T>(value: T | undefined, name: string): Loaded<T> =>
    value === undefined ? { ok: false, reason: `${name} is not deployed` } : { ok: true, value, bytes: JSON.stringify(value) };
  return {
    catalog: () => wrap(values.catalog, "jeju-transit-catalog.json"),
    timetables: () => wrap(values.timetables, "jeju-timetables.json"),
    holidays: () => wrap(values.holidays, "kr-public-holidays.json"),
  };
}
