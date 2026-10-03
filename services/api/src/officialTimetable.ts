/**
 * Jeju's official bus timetables as a dated, imported dataset.
 *
 * TAGO publishes no Jeju service day (`docs/DATA_SOURCES.md` → *Jeju
 * timetables*), so first and last buses can only come from the per-route
 * timetable files of data.go.kr dataset 3043887, downloaded from
 * `bus.jeju.go.kr`. Those terms allow use only as a dated import, labelled with
 * its download date and never presented as live. The pipeline:
 *
 *   official XLSX → `scripts/timetables/fetch_jeju_bis.py` (census) →
 *   `scripts/timetables/jeju_xlsx.py` (v3 parser) →
 *   `scripts/timetables/build_bundle.py` → `data/jeju-timetables.json` →
 *   `validateTimetableBundle` → `routeTimetableView`
 *
 * v3 follows all 234 real files of the 2026-10-03 census: one workbook may
 * carry several route numbers (a route column per trip), several sheets per
 * direction and day type, marks for stops served without a published time,
 * off-table places, alternate times, demand-responsive windows and late-night
 * tables that cross midnight (times from 24:00 belong to the next day). A
 * service whose own file contradicts itself is `source_conflict`: kept for the
 * record, never served.
 *
 * Between timepoints the table says nothing, and TAPSO does not interpolate.
 */

import { dayTypeApplies, serviceDay, type DayTypeApplicability, type HolidayCalendar, type ServiceDay } from "./serviceDay.ts";

export const TIMETABLE_SCHEMA_VERSION = "tapso-jeju-timetable-v3";
export const TIMETABLE_BUNDLE_SCHEMA_VERSION = "tapso-jeju-timetable-bundle-v1";

/**
 * `ASSUMED` staleness bounds, counted from the day the file was downloaded.
 * Jeju revises timetables irregularly (the dataset's own update cycle is
 * "수시"), so the age of TAPSO's last confirmation is the only signal. A month
 * is fresh, three months is the most a dataset may be used for "today", and
 * older is shown only as a dated record.
 */
export const TIMETABLE_FRESH_DAYS = 30;
export const TIMETABLE_USABLE_DAYS = 90;

export type TimetableDayType =
  | "weekday"
  | "saturday"
  | "sunday_holiday"
  | "saturday_sunday_holiday"
  | "holiday_saturday_unstated"
  | "unstated";

const DAY_TYPES: ReadonlySet<string> = new Set(["weekday", "saturday", "sunday_holiday", "saturday_sunday_holiday", "holiday_saturday_unstated", "unstated"]);

export interface OfficialTimetableDataset {
  schemaVersion: typeof TIMETABLE_SCHEMA_VERSION;
  /** Official, but only as of `retrievedOn`. Never live. */
  label: "OFFICIAL_DATED";
  source: {
    publisher: string;
    dataset: string;
    page: string;
    file: string;
    sha256: string;
    /** The site's own identifier for the timetable (GSCHEDULE_ID). */
    scheduleId?: string;
    /** The name the site lists it under (GSCHEDULE_NM). */
    listedName?: string;
  };
  /** `YYYY-MM-DD`, Korean date the file was downloaded. */
  retrievedOn: string;
  parser: { name: string; version: string };
  routeNumbers: string[];
  serviceLabels?: string[];
  status: "parsed" | "source_conflict";
  services: TimetableService[];
}

export interface TimetableService {
  /** Every sheet that carries this table (multi-route workbooks repeat it). */
  sheets: string[];
  routeNumbers: string[];
  dayType: TimetableDayType;
  /** The file's own words for the day type, e.g. "평일", "토,공휴일". */
  dayLabel?: string;
  /** "옵서버스", "공항리무진", "심야" …: what the title says about the service. */
  serviceLabels?: string[];
  direction: string;
  /** `YYYY-MM-DD`, the sheet's 시행일. */
  effectiveFrom?: string;
  /** Every 시행일 identical sheets carried; `effectiveFrom` is the latest. */
  effectiveDates?: string[];
  /** "미입력": the sheet says it has no 시행일. */
  effectiveNote?: string;
  summary: string;
  /** Timepoint names in travel order. A circular route, or a merged header, repeats names. */
  timepoints: string[];
  trips: TimetableTrip[];
  status: "ok" | "source_conflict";
  conflicts?: string[];
  /** Contradictions accepted one exact case at a time (`KNOWN_SUMMARY_CONFLICTS`). */
  acceptedConflicts?: string[];
  warnings?: string[];
  crossesMidnight?: boolean;
  /** A note every trip carried, e.g. "평일 운행". */
  note?: string;
}

export interface TimetableTrip {
  /** `null` only where the file names no route for the trip ("동절기" in a route column). */
  routeNumber: string | null;
  /** One per timepoint: `HH:MM` (24:00 and later is the next day), or `null`. */
  times: Array<string | null>;
  /** The trip's first time in route order, wherever it starts. */
  firstTime: string | null;
  startsAt?: { place: string; time: string; column: string };
  offTable?: { place: string; time: string; role: string; column?: string }[];
  endsAt?: string;
  marks?: Record<string, string>;
  cellNotes?: Record<string, string>;
  cellAnnotations?: string[];
  alternate?: { times: Array<string | null>; condition: string };
  operatesOn?: string[];
  season?: string;
  window?: { from: string; to: string; label: string };
  conditionalEnd?: boolean;
  /** Anything that limits when the trip runs. Such a trip is never a day's first or last bus. */
  conditions?: string[];
  note?: string;
}

export interface TimetableBundle {
  schemaVersion: typeof TIMETABLE_BUNDLE_SCHEMA_VERSION;
  label: "OFFICIAL_DATED";
  bundleVersion: string;
  source: { page: string; dataset: string };
  retrievedOn: string;
  retrievedAt: string;
  parser: { name: string; version: string };
  census: {
    entries: number;
    counts: Record<string, number>;
    noTimetable: { scheduleId: string; name: string; reason: string }[];
    refused: { scheduleId: string; name: string; family?: string; reason?: string }[];
  };
  datasets: OfficialTimetableDataset[];
}

export class TimetableDatasetError extends Error {
  readonly code = "TIMETABLE_DATASET_INVALID";
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 00:00–29:59: late-night tables run past midnight into the next day. */
const TIME = /^([01]\d|2[0-9]):[0-5]\d$/;

/** Throws `TimetableDatasetError` naming the first problem; returns the dataset typed. */
export function validateTimetableDataset(value: unknown): OfficialTimetableDataset {
  const fail = (message: string): never => {
    throw new TimetableDatasetError(message);
  };
  if (!isRecord(value)) fail("dataset must be an object");
  const dataset = value as unknown as OfficialTimetableDataset;
  if (dataset.schemaVersion !== TIMETABLE_SCHEMA_VERSION) fail(`schemaVersion must be ${TIMETABLE_SCHEMA_VERSION}`);
  if (dataset.label !== "OFFICIAL_DATED") fail("label must be OFFICIAL_DATED");
  if (!isRecord(dataset.source)) fail("source is required");
  for (const field of ["publisher", "dataset", "page", "file"] as const) {
    if (!nonEmpty(dataset.source[field])) fail(`source.${field} is required`);
  }
  if (!/^[0-9a-f]{64}$/.test(String(dataset.source.sha256))) fail("source.sha256 must be 64 hex characters");
  if (!validDate(dataset.retrievedOn)) fail("retrievedOn must be a YYYY-MM-DD date");
  if (!isRecord(dataset.parser) || !nonEmpty(dataset.parser.name) || !nonEmpty(dataset.parser.version)) fail("parser name and version are required");
  if (!Array.isArray(dataset.routeNumbers) || dataset.routeNumbers.length === 0 || !dataset.routeNumbers.every(nonEmpty)) fail("routeNumbers must name at least one route");
  if (dataset.status !== "parsed" && dataset.status !== "source_conflict") fail("status must be parsed or source_conflict");
  if (!Array.isArray(dataset.services) || dataset.services.length === 0) fail("services must be a non-empty array");
  dataset.services.forEach((service, index) => {
    const at = `services[${index}]`;
    if (!isRecord(service)) fail(`${at} must be an object`);
    if (!Array.isArray(service.sheets) || service.sheets.length === 0) fail(`${at}.sheets is required`);
    if (typeof service.direction !== "string") fail(`${at}.direction must be a string`);
    if (!DAY_TYPES.has(String(service.dayType))) fail(`${at}.dayType is not one TAPSO reads`);
    if ((service.dayType === "unstated") !== (service.dayLabel === undefined)) fail(`${at}.dayLabel is required exactly when a day type is stated`);
    if (service.effectiveFrom !== undefined && !validDate(service.effectiveFrom)) fail(`${at}.effectiveFrom must be a YYYY-MM-DD date`);
    if (service.status !== "ok" && service.status !== "source_conflict") fail(`${at}.status must be ok or source_conflict`);
    if (service.status === "source_conflict" && (!Array.isArray(service.conflicts) || service.conflicts.length === 0)) fail(`${at} is a source conflict without saying what conflicts`);
    if (service.status === "ok" && service.conflicts !== undefined) fail(`${at} is ok but lists conflicts`);
    if (!Array.isArray(service.timepoints) || service.timepoints.length < 2) fail(`${at}.timepoints must name at least two timepoints`);
    if (!Array.isArray(service.trips) || service.trips.length === 0) fail(`${at}.trips must be non-empty`);
    if (service.status !== "ok") return;
    // A served table is checked again here: the parser is not trusted blindly.
    const width = service.timepoints.length;
    service.trips.forEach((trip, position) => {
      const where = `${at}.trips[${position}]`;
      if (!isRecord(trip) || !Array.isArray(trip.times) || trip.times.length !== width) fail(`${where}.times must have one entry per timepoint`);
      if (trip.routeNumber !== null && !service.routeNumbers.includes(String(trip.routeNumber))) fail(`${where}.routeNumber is not one the service names`);
      trip.times.forEach((time, column) => {
        if (time !== null && (typeof time !== "string" || !TIME.test(time))) fail(`${where}.times[${column}] must be HH:MM or null`);
      });
      const served = trip.times.filter((time): time is string => time !== null);
      served.forEach((time, step) => {
        if (step > 0 && served[step - 1]! > time) fail(`${where} times run backwards`);
      });
      if (trip.firstTime !== null && (typeof trip.firstTime !== "string" || !TIME.test(trip.firstTime))) fail(`${where}.firstTime must be HH:MM or null`);
      if (trip.firstTime !== null && served.length > 0 && trip.firstTime > served[0]!) fail(`${where}.firstTime is after its first timepoint time`);
      if (trip.firstTime === null && !trip.window && !trip.offTable) fail(`${where} has no time and is not a demand-responsive window`);
    });
  });
  return dataset;
}

/** Validates every dataset; one that fails is dropped and reported, never served. */
export function validateTimetableBundle(raw: unknown): { bundle: TimetableBundle; rejected: { scheduleId?: string; reason: string }[] } {
  if (!isRecord(raw) || raw.schemaVersion !== TIMETABLE_BUNDLE_SCHEMA_VERSION) throw new TimetableDatasetError(`bundle schemaVersion must be ${TIMETABLE_BUNDLE_SCHEMA_VERSION}`);
  const bundle = raw as unknown as TimetableBundle;
  if (bundle.label !== "OFFICIAL_DATED" || !validDate(bundle.retrievedOn) || !Array.isArray(bundle.datasets)) throw new TimetableDatasetError("bundle is missing its label, date or datasets");
  const rejected: { scheduleId?: string; reason: string }[] = [];
  const datasets = bundle.datasets.filter((dataset) => {
    try {
      validateTimetableDataset(dataset);
      return true;
    } catch (error) {
      rejected.push({ ...(dataset?.source?.scheduleId ? { scheduleId: dataset.source.scheduleId } : {}), reason: (error as Error).message });
      return false;
    }
  });
  return { bundle: { ...bundle, datasets }, rejected };
}

export type TimetableFreshness = "fresh" | "aging" | "stale" | "unknown";

/**
 * How far a dataset may be trusted on `today` (`YYYY-MM-DD`, Korean date).
 * `fresh` and `aging` may answer "today's first and last bus", always with the
 * as-of date; `stale` is shown only as a dated record; `unknown` (an unreadable
 * or future download date) is never used.
 */
export function timetableFreshness(dataset: Pick<OfficialTimetableDataset, "retrievedOn">, today: string): TimetableFreshness {
  if (!validDate(dataset.retrievedOn) || !validDate(today)) return "unknown";
  const age = days(dataset.retrievedOn, today);
  if (age < 0) return "unknown";
  if (age <= TIMETABLE_FRESH_DAYS) return "fresh";
  if (age <= TIMETABLE_USABLE_DAYS) return "aging";
  return "stale";
}

export interface TripEnd {
  /** `HH:MM`; 24:00 and later is after midnight. */
  time: string;
  /** Where the trip starts: an off-table place or the first timepoint it serves. */
  from: string;
}

export interface ServiceView {
  scheduleId?: string;
  direction: string;
  dayType: TimetableDayType;
  dayLabel?: string;
  serviceLabels?: string[];
  /** Whether this service runs on the view's date, as far as its label says. */
  applicability: DayTypeApplicability;
  effectiveFrom?: string;
  effectiveNote?: string;
  /** False when the 시행일 is after the view's date. */
  inEffect: boolean;
  status: "ok" | "source_conflict";
  conflicts?: string[];
  acceptedConflicts?: string[];
  note?: string;
  timepoints: string[];
  trips: TimetableTrip[];
  /** Over trips without conditions only; `null` when there is none. */
  first: TripEnd | null;
  last: TripEnd | null;
  /** Trips with conditions that start after `last` (seasonal, market-day, on-demand…). */
  laterConditional: (TripEnd & { conditions: string[] })[];
  hasConditionalTrips: boolean;
}

export interface RouteTimetableView {
  routeNo: string;
  status: "available" | "source_conflict" | "no_timetable" | "not_published";
  label: "OFFICIAL_DATED";
  asOf: string;
  freshness: TimetableFreshness;
  date: string;
  serviceDay: ServiceDay;
  /** Services that apply on `date`, one per direction, only when fresh or aging and in effect. */
  today: { direction: string; first: TripEnd | null; last: TripEnd | null; dayLabel?: string; applicability: DayTypeApplicability }[];
  services: ServiceView[];
  noTimetable?: { scheduleId: string; reason: string }[];
  source: { page: string; dataset: string; parser: { name: string; version: string }; bundleVersion: string };
}

/** Everything the bundle knows about one route number, read for one date. */
export function routeTimetableView(bundle: TimetableBundle, calendar: HolidayCalendar, routeNo: string, date: string): RouteTimetableView {
  const day = serviceDay(date, calendar);
  const freshness = timetableFreshness(bundle, date);
  const views: ServiceView[] = [];
  for (const dataset of bundle.datasets) {
    if (!dataset.routeNumbers.includes(routeNo)) continue;
    for (const service of dataset.services) {
      if (!service.routeNumbers.includes(routeNo)) continue;
      const trips = service.trips.filter((trip) => trip.routeNumber === routeNo);
      if (trips.length === 0) continue;
      views.push(serviceView(dataset, service, trips, service.timepoints, day));
    }
  }
  const noTimetable = bundle.census.noTimetable
    .filter((entry) => routeNumbersIn(entry.name).includes(routeNo))
    .map(({ scheduleId, reason }) => ({ scheduleId, reason }));
  const servable = views.filter((view) => view.status === "ok");
  const status: RouteTimetableView["status"] = servable.length > 0
    ? "available"
    : views.length > 0 ? "source_conflict" : noTimetable.length > 0 ? "no_timetable" : "not_published";

  // "Today" only from a dataset TAPSO may still vouch for, only for a service
  // whose label applies to the date, only once in effect, and only where one
  // service per direction answers. Anything else stays in `services`, labelled.
  const today: RouteTimetableView["today"] = [];
  if (freshness === "fresh" || freshness === "aging") {
    const byDirection = new Map<string, ServiceView[]>();
    for (const view of servable) {
      if (view.applicability !== "applies" || !view.inEffect) continue;
      byDirection.set(view.direction, [...(byDirection.get(view.direction) ?? []), view]);
    }
    for (const [direction, candidates] of byDirection) {
      if (candidates.length !== 1) continue;
      const view = candidates[0]!;
      today.push({ direction, first: view.first, last: view.last, ...(view.dayLabel ? { dayLabel: view.dayLabel } : {}), applicability: view.applicability });
    }
  }
  return {
    routeNo,
    status,
    label: "OFFICIAL_DATED",
    asOf: bundle.retrievedOn,
    freshness,
    date,
    serviceDay: day,
    today,
    services: views,
    ...(noTimetable.length > 0 ? { noTimetable } : {}),
    source: { page: bundle.source.page, dataset: bundle.source.dataset, parser: bundle.parser, bundleVersion: bundle.bundleVersion },
  };
}

/** Route numbers a census name lists ("231, 232" → 231 and 232). */
export function routeNumbersIn(name: string): string[] {
  return [...new Set(name.match(/\d{1,4}(?:-\d{1,2})?/g) ?? [])];
}

/** Every route number the bundle can answer for, with its status. */
export function timetableIndex(bundle: TimetableBundle): { routeNo: string; status: "available" | "source_conflict" | "no_timetable" }[] {
  const status = new Map<string, "available" | "source_conflict" | "no_timetable">();
  for (const dataset of bundle.datasets) {
    for (const service of dataset.services) {
      for (const routeNo of service.routeNumbers) {
        if (service.status === "ok") status.set(routeNo, "available");
        else if (!status.has(routeNo)) status.set(routeNo, "source_conflict");
      }
    }
  }
  for (const entry of bundle.census.noTimetable) {
    for (const routeNo of routeNumbersIn(entry.name)) if (!status.has(routeNo)) status.set(routeNo, "no_timetable");
  }
  return [...status].map(([routeNo, value]) => ({ routeNo, status: value })).sort((left, right) => compareRouteNumbers(left.routeNo, right.routeNo));
}

function serviceView(dataset: OfficialTimetableDataset, service: TimetableService, trips: TimetableTrip[], timepoints: string[], day: ServiceDay): ServiceView {
  const plain = trips.filter((trip) => trip.firstTime !== null && !(trip.conditions?.length));
  const ends = plain.map((trip) => ({ time: trip.firstTime!, from: startPlace(trip, timepoints) }));
  const first = ends.reduce<TripEnd | null>((best, end) => (best === null || end.time < best.time ? end : best), null);
  const last = ends.reduce<TripEnd | null>((best, end) => (best === null || end.time > best.time ? end : best), null);
  const laterConditional = trips
    .filter((trip) => trip.firstTime !== null && trip.conditions?.length && (last === null || trip.firstTime > last.time))
    .map((trip) => ({ time: trip.firstTime!, from: startPlace(trip, timepoints), conditions: trip.conditions! }));
  const inEffect = service.effectiveFrom === undefined || service.effectiveFrom <= day.date;
  return {
    ...(dataset.source.scheduleId ? { scheduleId: dataset.source.scheduleId } : {}),
    direction: service.direction,
    dayType: service.dayType,
    ...(service.dayLabel ? { dayLabel: service.dayLabel } : {}),
    ...(service.serviceLabels ? { serviceLabels: service.serviceLabels } : {}),
    applicability: dayTypeApplies(service.dayType, day),
    ...(service.effectiveFrom ? { effectiveFrom: service.effectiveFrom } : {}),
    ...(service.effectiveNote ? { effectiveNote: service.effectiveNote } : {}),
    inEffect,
    status: service.status,
    ...(service.conflicts ? { conflicts: service.conflicts } : {}),
    ...(service.acceptedConflicts ? { acceptedConflicts: service.acceptedConflicts } : {}),
    ...(service.note ? { note: service.note } : {}),
    timepoints,
    // A conflicting table is withheld: its trips are not sent.
    trips: service.status === "ok" ? trips : [],
    first: service.status === "ok" ? first : null,
    last: service.status === "ok" ? last : null,
    laterConditional: service.status === "ok" ? laterConditional : [],
    hasConditionalTrips: trips.some((trip) => trip.conditions?.length),
  };
}

function startPlace(trip: TimetableTrip, timepoints: string[]): string {
  if (trip.startsAt) return trip.startsAt.place;
  const index = trip.times.findIndex((time) => time !== null);
  const offTable = trip.offTable?.find((entry) => entry.time === trip.firstTime);
  if (offTable && (index < 0 || offTable.time < trip.times[index]!)) return offTable.place;
  return index >= 0 ? timepoints[index]! : offTable?.place ?? "";
}

function compareRouteNumbers(left: string, right: string): number {
  const [leftBase, leftBranch] = left.split("-").map(Number);
  const [rightBase, rightBranch] = right.split("-").map(Number);
  return (leftBase! - rightBase!) || ((leftBranch ?? 0) - (rightBranch ?? 0));
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
