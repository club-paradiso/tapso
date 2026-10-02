/**
 * Jeju's official bus timetables as a dated, imported dataset.
 *
 * TAGO publishes no Jeju service day (`docs/DATA_SOURCES.md` → *Jeju
 * timetables*), so the last bus can only come from the per-route timetable
 * files of data.go.kr dataset 3043887, downloaded from `bus.jeju.go.kr`. Those
 * terms allow use only as a dated import, labelled with its download date and
 * never presented as live. This module is the half of that pipeline that does
 * not depend on the file's layout:
 *
 *   official XLSX → parser (written against the first real file) →
 *   `OfficialTimetableDataset` → `validateTimetableDataset` →
 *   `timetableFreshness` → route-info
 *
 * The parser does not exist yet: no real file has been downloaded, and the
 * layout must not be guessed. A dataset that fails validation is not used.
 */

export const TIMETABLE_SCHEMA_VERSION = "tapso-jeju-timetable-v1";

/**
 * `ASSUMED` staleness bounds, counted from the day the file was downloaded.
 * Jeju revises timetables irregularly (the dataset's own update cycle is
 * "수시"), so age is the only signal TAPSO has. Until a revision is observed
 * these stay conservative: a month is fresh, three months is the most a
 * dataset may be used for, and older is never used.
 */
export const TIMETABLE_FRESH_DAYS = 30;
export const TIMETABLE_USABLE_DAYS = 90;

export type TimetableDayType = "weekday" | "saturday" | "sunday_holiday" | "daily";

export interface OfficialTimetableDataset {
  schemaVersion: typeof TIMETABLE_SCHEMA_VERSION;
  /** Official, but only as of `retrievedOn`. Never live. */
  label: "OFFICIAL_DATED";
  source: {
    publisher: string;
    /** `data.go.kr 3043887` */
    dataset: string;
    /** The page the file was downloaded from. */
    page: string;
    /** The file name as downloaded. */
    file: string;
    /** SHA-256 of the downloaded file, hex. */
    sha256: string;
  };
  /** `YYYY-MM-DD`, Korean date the file was downloaded. */
  retrievedOn: string;
  /** `YYYY-MM-DD`, when the file says it takes effect, if it says. */
  effectiveFrom?: string;
  parser: { name: string; version: string };
  routeNumber: string;
  services: TimetableService[];
}

export interface TimetableService {
  /** The starting stop the departures are from, as the file names it. */
  origin: string;
  dayType: TimetableDayType;
  /** `HH:MM`, ascending. A departure after midnight is not representable and must not be guessed. */
  departures: string[];
}

export class TimetableDatasetError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_TYPES: ReadonlySet<string> = new Set(["weekday", "saturday", "sunday_holiday", "daily"]);

/** Throws `TimetableDatasetError` naming the first problem; returns the dataset typed. */
export function validateTimetableDataset(value: unknown): OfficialTimetableDataset {
  const fail = (message: string): never => {
    throw new TimetableDatasetError(message);
  };
  if (!isRecord(value)) fail("dataset must be an object");
  const dataset = value as Record<string, unknown>;
  if (dataset.schemaVersion !== TIMETABLE_SCHEMA_VERSION) fail(`schemaVersion must be ${TIMETABLE_SCHEMA_VERSION}`);
  if (dataset.label !== "OFFICIAL_DATED") fail("label must be OFFICIAL_DATED");
  const source = dataset.source;
  if (!isRecord(source)) fail("source is required");
  for (const field of ["publisher", "dataset", "page", "file"] as const) {
    if (!nonEmpty((source as Record<string, unknown>)[field])) fail(`source.${field} is required`);
  }
  if (!/^[0-9a-f]{64}$/.test(String((source as Record<string, unknown>).sha256))) fail("source.sha256 must be 64 hex characters");
  if (!validDate(dataset.retrievedOn)) fail("retrievedOn must be a YYYY-MM-DD date");
  if (dataset.effectiveFrom !== undefined && !validDate(dataset.effectiveFrom)) fail("effectiveFrom must be a YYYY-MM-DD date");
  const parser = dataset.parser;
  if (!isRecord(parser) || !nonEmpty(parser.name) || !nonEmpty(parser.version)) fail("parser name and version are required");
  if (!nonEmpty(dataset.routeNumber)) fail("routeNumber is required");
  if (!Array.isArray(dataset.services) || dataset.services.length === 0) fail("services must be a non-empty array");
  const seen = new Set<string>();
  (dataset.services as unknown[]).forEach((service, index) => {
    if (!isRecord(service)) fail(`services[${index}] must be an object`);
    const entry = service as Record<string, unknown>;
    if (!nonEmpty(entry.origin)) fail(`services[${index}].origin is required`);
    if (!DAY_TYPES.has(String(entry.dayType))) fail(`services[${index}].dayType is not one of ${[...DAY_TYPES].join(", ")}`);
    const key = `${entry.origin}|${entry.dayType}`;
    if (seen.has(key)) fail(`services[${index}] repeats ${key}`);
    seen.add(key);
    if (!Array.isArray(entry.departures) || entry.departures.length === 0) fail(`services[${index}].departures must be non-empty`);
    const times = entry.departures as unknown[];
    times.forEach((time, position) => {
      if (typeof time !== "string" || !TIME.test(time)) fail(`services[${index}].departures[${position}] must be HH:MM`);
      if (position > 0 && String(times[position - 1]) >= String(time)) fail(`services[${index}].departures must be strictly ascending`);
    });
  });
  return value as OfficialTimetableDataset;
}

export type TimetableFreshness = "fresh" | "aging" | "stale" | "unknown";

/**
 * How far a dataset may be trusted on `today` (`YYYY-MM-DD`, Korean date).
 *
 * - `fresh`: downloaded within `TIMETABLE_FRESH_DAYS`.
 * - `aging`: within `TIMETABLE_USABLE_DAYS`; usable, shown with its "as of" date.
 * - `stale`: older; never used for a last-bus time.
 * - `unknown`: a date that cannot be read, a download date in the future, or
 *   an effective date still to come; never used.
 */
export function timetableFreshness(dataset: Pick<OfficialTimetableDataset, "retrievedOn" | "effectiveFrom">, today: string): TimetableFreshness {
  if (!validDate(dataset.retrievedOn) || !validDate(today)) return "unknown";
  if (dataset.effectiveFrom !== undefined && (!validDate(dataset.effectiveFrom) || dataset.effectiveFrom > today)) return "unknown";
  const age = days(dataset.retrievedOn, today);
  if (age < 0) return "unknown";
  if (age <= TIMETABLE_FRESH_DAYS) return "fresh";
  if (age <= TIMETABLE_USABLE_DAYS) return "aging";
  return "stale";
}

/** The last departure from `origin` on `dayType`, only from a usable dataset. */
export function lastDeparture(
  dataset: OfficialTimetableDataset,
  origin: string,
  dayType: TimetableDayType,
  today: string,
): { time: string; asOf: string; freshness: "fresh" | "aging" } | undefined {
  const freshness = timetableFreshness(dataset, today);
  if (freshness !== "fresh" && freshness !== "aging") return undefined;
  const service = dataset.services.find((entry) => entry.origin === origin && entry.dayType === dayType)
    ?? dataset.services.find((entry) => entry.origin === origin && entry.dayType === "daily");
  const time = service?.departures.at(-1);
  return time === undefined ? undefined : { time, asOf: dataset.retrievedOn, freshness };
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function days(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
