/**
 * Jeju's official bus timetables as a dated, imported dataset.
 *
 * TAGO publishes no Jeju service day (`docs/DATA_SOURCES.md` → *Jeju
 * timetables*), so the last bus can only come from the per-route timetable
 * files of data.go.kr dataset 3043887, downloaded from `bus.jeju.go.kr`. Those
 * terms allow use only as a dated import, labelled with its download date and
 * never presented as live. The pipeline:
 *
 *   official XLSX → `scripts/timetables/jeju_xlsx.py` →
 *   `fixtures/jeju/timetables/<route>.json` → `validateTimetableDataset` →
 *   `timetableFreshness` → `lastDeparture` / `lastTimeAt`
 *
 * v2 follows the first real file (Route 365, 2026-10-03): one service per
 * direction and day type, each a table of trips over named timepoints, and a
 * trip may start at a place before its first timepoint. A dataset that fails
 * validation is not used.
 */

export const TIMETABLE_SCHEMA_VERSION = "tapso-jeju-timetable-v2";

/**
 * `ASSUMED` staleness bounds, counted from the day the file was downloaded.
 * Jeju revises timetables irregularly (the dataset's own update cycle is
 * "수시"), so age is the only signal TAPSO has. Until a revision is observed
 * these stay conservative: a month is fresh, three months is the most a
 * dataset may be used for, and older is never used.
 */
export const TIMETABLE_FRESH_DAYS = 30;
export const TIMETABLE_USABLE_DAYS = 90;

/**
 * `saturday_sunday_holiday` is the file's "토,공휴일". Sunday is a public
 * holiday under 관공서의 공휴일에 관한 규정 제2조 제1호. Which day type a
 * calendar date falls in is the caller's to decide, with a holiday calendar.
 */
export type TimetableDayType = "weekday" | "saturday" | "sunday_holiday" | "saturday_sunday_holiday" | "daily";

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
    /** The file name as committed. */
    file: string;
    /** SHA-256 of the downloaded file, hex. */
    sha256: string;
  };
  /** `YYYY-MM-DD`, Korean date the file was downloaded. */
  retrievedOn: string;
  parser: { name: string; version: string };
  routeNumber: string;
  services: TimetableService[];
}

export interface TimetableService {
  /** The sheet name, verbatim. */
  sheet: string;
  dayType: TimetableDayType;
  /** The file's own words for the day type, e.g. "평일", "토,공휴일". */
  dayLabel: string;
  /** The file's own direction, e.g. "한라대→공항→시청→제주대". */
  direction: string;
  /** `YYYY-MM-DD`, the sheet's 시행일, if it states one. */
  effectiveFrom?: string;
  /** The sheet's summary line (first and last bus, headway, operator), verbatim. */
  summary: string;
  /** Timepoint names in travel order, as the sheet heads its columns. */
  timepoints: string[];
  trips: TimetableTrip[];
}

export interface TimetableTrip {
  /** One per timepoint: `HH:MM`, or `null` where the trip does not serve it. */
  times: Array<string | null>;
  /** A trip that starts before its first timepoint, at a place the table does not head. */
  startsAt?: { place: string; time: string; column: string };
  note?: string;
}

export class TimetableDatasetError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_TYPES: ReadonlySet<string> = new Set(["weekday", "saturday", "sunday_holiday", "saturday_sunday_holiday", "daily"]);

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
  const parser = dataset.parser;
  if (!isRecord(parser) || !nonEmpty(parser.name) || !nonEmpty(parser.version)) fail("parser name and version are required");
  if (!nonEmpty(dataset.routeNumber)) fail("routeNumber is required");
  if (!Array.isArray(dataset.services) || dataset.services.length === 0) fail("services must be a non-empty array");
  const seen = new Set<string>();
  (dataset.services as unknown[]).forEach((service, index) => {
    const at = `services[${index}]`;
    if (!isRecord(service)) fail(`${at} must be an object`);
    const entry = service as Record<string, unknown>;
    for (const field of ["sheet", "dayLabel", "direction"] as const) {
      if (!nonEmpty(entry[field])) fail(`${at}.${field} is required`);
    }
    if (typeof entry.summary !== "string") fail(`${at}.summary must be a string`);
    if (!DAY_TYPES.has(String(entry.dayType))) fail(`${at}.dayType is not one of ${[...DAY_TYPES].join(", ")}`);
    if (entry.effectiveFrom !== undefined && !validDate(entry.effectiveFrom)) fail(`${at}.effectiveFrom must be a YYYY-MM-DD date`);
    const key = `${entry.direction}|${entry.dayType}`;
    if (seen.has(key)) fail(`${at} repeats ${key}`);
    seen.add(key);
    const timepoints = entry.timepoints;
    if (!Array.isArray(timepoints) || timepoints.length < 2 || !timepoints.every(nonEmpty)) fail(`${at}.timepoints must name at least two timepoints`);
    if (new Set(timepoints as string[]).size !== (timepoints as string[]).length) fail(`${at}.timepoints repeats a name`);
    if (!Array.isArray(entry.trips) || entry.trips.length === 0) fail(`${at}.trips must be non-empty`);
    const width = (timepoints as string[]).length;
    const lastAt: Array<string | undefined> = new Array(width).fill(undefined);
    (entry.trips as unknown[]).forEach((trip, position) => {
      const where = `${at}.trips[${position}]`;
      if (!isRecord(trip) || !Array.isArray(trip.times) || trip.times.length !== width) fail(`${where}.times must have one entry per timepoint`);
      const times = (trip as { times: unknown[] }).times;
      times.forEach((time, column) => {
        if (time !== null && (typeof time !== "string" || !TIME.test(time))) fail(`${where}.times[${column}] must be HH:MM or null`);
      });
      const served = times.filter((time): time is string => time !== null);
      if (served.length === 0) fail(`${where} serves no timepoint`);
      const startsAt = (trip as Record<string, unknown>).startsAt;
      let sequence = served;
      if (startsAt !== undefined) {
        if (!isRecord(startsAt) || !nonEmpty(startsAt.place) || typeof startsAt.time !== "string" || !TIME.test(startsAt.time)) {
          fail(`${where}.startsAt needs a place and an HH:MM time`);
        }
        if (!(timepoints as string[]).includes(String((startsAt as Record<string, unknown>).column))) fail(`${where}.startsAt.column must name a timepoint`);
        sequence = [String((startsAt as Record<string, unknown>).time), ...served];
      }
      sequence.forEach((time, step) => {
        if (step > 0 && sequence[step - 1]! >= time) fail(`${where} times must be strictly ascending (a time past midnight is not representable)`);
      });
      times.forEach((time, column) => {
        if (typeof time !== "string") return;
        if (lastAt[column] !== undefined && lastAt[column]! > time) fail(`${where} is out of order at ${(timepoints as string[])[column]}`);
        lastAt[column] = time;
      });
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
 * - `unknown`: a date that cannot be read, or a download date in the future; never used.
 */
export function timetableFreshness(dataset: Pick<OfficialTimetableDataset, "retrievedOn">, today: string): TimetableFreshness {
  if (!validDate(dataset.retrievedOn) || !validDate(today)) return "unknown";
  const age = days(dataset.retrievedOn, today);
  if (age < 0) return "unknown";
  if (age <= TIMETABLE_FRESH_DAYS) return "fresh";
  if (age <= TIMETABLE_USABLE_DAYS) return "aging";
  return "stale";
}

export interface DatedTime {
  time: string;
  asOf: string;
  freshness: "fresh" | "aging";
  effectiveFrom?: string;
}

/** The service for one direction and day type, only from a usable dataset and only once in effect. */
function usableService(dataset: OfficialTimetableDataset, direction: string, dayType: TimetableDayType, today: string): { service: TimetableService; freshness: "fresh" | "aging" } | undefined {
  const freshness = timetableFreshness(dataset, today);
  if (freshness !== "fresh" && freshness !== "aging") return undefined;
  const service = dataset.services.find((entry) => entry.direction === direction && entry.dayType === dayType)
    ?? dataset.services.find((entry) => entry.direction === direction && entry.dayType === "daily");
  if (!service) return undefined;
  if (service.effectiveFrom !== undefined && (!validDate(service.effectiveFrom) || service.effectiveFrom > today)) return undefined;
  return { service, freshness };
}

function dated(time: string, dataset: OfficialTimetableDataset, service: TimetableService, freshness: "fresh" | "aging"): DatedTime {
  return { time, asOf: dataset.retrievedOn, freshness, ...(service.effectiveFrom ? { effectiveFrom: service.effectiveFrom } : {}) };
}

/** The 막차: the last trip's first scheduled time, wherever it starts. */
export function lastDeparture(dataset: OfficialTimetableDataset, direction: string, dayType: TimetableDayType, today: string): DatedTime | undefined {
  const usable = usableService(dataset, direction, dayType, today);
  const trip = usable?.service.trips.at(-1);
  if (!usable || !trip) return undefined;
  const time = trip.startsAt?.time ?? trip.times.find((entry): entry is string => entry !== null);
  return time === undefined ? undefined : dated(time, dataset, usable.service, usable.freshness);
}

/** The last scheduled time at one named timepoint. Between timepoints the table says nothing. */
export function lastTimeAt(dataset: OfficialTimetableDataset, direction: string, timepoint: string, dayType: TimetableDayType, today: string): DatedTime | undefined {
  const usable = usableService(dataset, direction, dayType, today);
  if (!usable) return undefined;
  const column = usable.service.timepoints.indexOf(timepoint);
  if (column < 0) return undefined;
  const time = usable.service.trips.map((trip) => trip.times[column]).filter((entry): entry is string => entry != null).at(-1);
  return time === undefined ? undefined : dated(time, dataset, usable.service, usable.freshness);
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
