/**
 * NightGuard: what Jeju's official timetables say about the rest of tonight,
 * read for one instant, with every limit stated.
 *
 * Inputs are the dated timetable bundle (`officialTimetable.ts`, label
 * `OFFICIAL_DATED`) and the holiday calendar (`serviceDay.ts`). No live data
 * is read here, and nothing here claims that a bus is operating: a timetable
 * says what is scheduled, not what runs. Live vehicle evidence is combined
 * separately and conservatively by `reconcileOperatingEvidence`
 * (`transitEvidence.ts`).
 *
 * Rules (docs/exec-plans/TAPSO_V4_IMPLEMENTATION.md, NightGuard):
 * - Service day across midnight. Late-night tables write times after midnight
 *   as 24:00–29:59, on the service day they started. At 00:20 on a Saturday,
 *   Friday's table is still answering for its 24:xx trips, so both Friday's
 *   (at 24:20) and Saturday's (at 00:20) tables are read, each labelled with
 *   its own service date.
 * - A table answers for "tonight" only when the dataset is `fresh` or `aging`,
 *   the service is not a source conflict, its 시행일 has passed and its day
 *   label applies to the service date. A table with no day label is reported
 *   as a table fact (its published last departure) with status `unknown`:
 *   whether it runs on that day is not stated.
 * - Times are read where the table publishes them and nowhere else. Without a
 *   named timepoint, a departure is the trip's start; the bus reaches later
 *   stops after that, so "the last scheduled trip has started" never means
 *   "the last bus has passed your stop". With a named timepoint that appears
 *   once in the table, its own column is read. Between timepoints TAPSO does
 *   not interpolate.
 * - A trip with conditions (season, market day, on demand) is never a plain
 *   departure. If one is scheduled after the last plain trip, the status is
 *   `uncertain`, not `last_scheduled_departed`.
 * - Two applicable tables for one direction on one service date: `uncertain`.
 */

import { timetableFreshness, type OfficialTimetableDataset, type TimetableBundle, type TimetableFreshness, type TimetableService, type TimetableTrip } from "./officialTimetable.ts";
import { dayTypeApplies, serviceDay, type DayTypeApplicability, type HolidayCalendar } from "./serviceDay.ts";

export const NIGHT_GUARD_SCHEMA_VERSION = "tapso-night-guard-v1";

/** Late-night tables run to 29:59 at most (`officialTimetable.ts` TIME); after 06:00 yesterday's table is never read. */
export const PREVIOUS_SERVICE_DAY_UNTIL_MINUTES = 6 * 60;

export type NightGuardStatus =
  /** A later plain departure is published for this service date. Scheduled, not observed. */
  | "scheduled_departures_remain"
  /** The first plain departure of this service date is still ahead. */
  | "before_first_departure"
  /** Every plain departure's published time has passed. The bus may still be late, and later stops are passed later. */
  | "last_scheduled_departed"
  /** The table answers, but not plainly: conditional trips later, an uncertain day type, or two tables. */
  | "uncertain"
  /** No table TAPSO may read for this instant. */
  | "unknown";

export type NightGuardReason =
  | "timetable_stale"
  | "timetable_freshness_unknown"
  | "source_conflict"
  | "not_in_effect"
  | "day_type_unstated"
  | "day_type_uncertain"
  | "multiple_tables"
  | "conditional_trips_later"
  | "no_plain_trips"
  | "timepoint_not_published"
  | "timepoint_ambiguous"
  | "measured_from_trip_start"
  | "scheduled_not_observed"
  | "bus_may_run_late"
  | "previous_service_day"
  /** Set by `aggregateRouteSchedule`: one statement for every direction of a route number. */
  | "route_number_aggregate"
  /** Set by `aggregateRouteSchedule`: some direction's table could not answer (unknown, conflicted), so the route cannot be said to have finished. */
  | "direction_unresolved";

/** A departure as the table writes it, plus the wall clock it stands for. */
export interface ScheduledTime {
  /** `HH:MM` as published; 24:00 and later belongs to the next calendar day. */
  table: string;
  /** `HH:MM` on a 24-hour wall clock. */
  clock: string;
  /** The calendar date (Korea) the time falls on. */
  date: string;
  /** Where the time was read: the trip's start, or the named timepoint. */
  at: string;
  /** Minutes from the evaluation instant; negative when it has passed. */
  minutesFromNow: number;
}

export interface NightGuardEntry {
  direction: string;
  scheduleId?: string;
  /** The service day this table is read for; the day before the calendar date after midnight. */
  serviceDate: string;
  dayType: string;
  dayLabel?: string;
  serviceLabels?: string[];
  applicability: DayTypeApplicability;
  status: NightGuardStatus;
  /** `OFFICIAL_DATED` when a table answered; otherwise why not. */
  evidence: "OFFICIAL_DATED" | "CONFLICTED" | "UNKNOWN";
  /** Where times were read: every trip's start, or one named timepoint. */
  measuredAt: { kind: "trip_start" } | { kind: "timepoint"; name: string; column: number };
  next: ScheduledTime | null;
  last: ScheduledTime | null;
  /** Conditional trips published after the last plain one, read at the same place. */
  laterConditional: (ScheduledTime & { conditions: string[] })[];
  reasons: NightGuardReason[];
  /** Never true: a timetable cannot say that a bus is running. */
  claimsOperating: false;
}

export interface NightGuardView {
  schemaVersion: typeof NIGHT_GUARD_SCHEMA_VERSION;
  routeNo: string;
  label: "OFFICIAL_DATED";
  /** The instant evaluated, ISO 8601 UTC. */
  evaluatedAt: string;
  /** Korean wall clock at `evaluatedAt`. */
  localDate: string;
  localTime: string;
  asOf: string;
  freshness: TimetableFreshness;
  /** The next instant at which an entry's status can change (a departure time), or `null`. */
  validUntil: string | null;
  entries: NightGuardEntry[];
  /** Route-level reasons that apply to every entry. */
  reasons: NightGuardReason[];
  provenance: { page: string; dataset: string; bundleVersion: string; parser: { name: string; version: string }; retrievedAt: string };
}

export interface NightGuardOptions {
  /** A timepoint name exactly as the table writes it; read in its own column when it appears once. */
  timepoint?: string;
}

/** NightGuard for one route number at one instant. Pure: no clock, no network. */
export function nightGuardView(bundle: TimetableBundle, calendar: HolidayCalendar, routeNo: string, now: Date, options: NightGuardOptions = {}): NightGuardView {
  const local = koreanWallClock(now);
  const freshness = timetableFreshness(bundle, local.date);
  const routeReasons: NightGuardReason[] = [];
  if (freshness === "stale") routeReasons.push("timetable_stale");
  if (freshness === "unknown") routeReasons.push("timetable_freshness_unknown");
  const usable = freshness === "fresh" || freshness === "aging";

  const days: { serviceDate: string; nowMinutes: number; previous: boolean }[] = [{ serviceDate: local.date, nowMinutes: local.minutes, previous: false }];
  if (local.minutes < PREVIOUS_SERVICE_DAY_UNTIL_MINUTES) {
    days.unshift({ serviceDate: addDays(local.date, -1), nowMinutes: local.minutes + 1_440, previous: true });
  }

  const entries: NightGuardEntry[] = [];
  for (const { serviceDate, nowMinutes, previous } of days) {
    let day;
    try {
      day = serviceDay(serviceDate, calendar);
    } catch {
      continue;
    }
    const candidates: { dataset: OfficialTimetableDataset; service: TimetableService; trips: TimetableTrip[]; applicability: DayTypeApplicability }[] = [];
    for (const dataset of bundle.datasets) {
      if (!dataset.routeNumbers.includes(routeNo)) continue;
      for (const service of dataset.services) {
        if (!service.routeNumbers.includes(routeNo)) continue;
        const trips = service.trips.filter((trip) => trip.routeNumber === routeNo);
        if (trips.length === 0) continue;
        const applicability = dayTypeApplies(service.dayType, day);
        if (applicability === "does_not_apply") continue;
        candidates.push({ dataset, service, trips, applicability });
      }
    }
    const applicableByDirection = new Map<string, number>();
    for (const candidate of candidates) {
      if (candidate.applicability === "applies" && candidate.service.status === "ok" && inEffect(candidate.service, serviceDate)) {
        applicableByDirection.set(candidate.service.direction, (applicableByDirection.get(candidate.service.direction) ?? 0) + 1);
      }
    }
    for (const candidate of candidates) {
      const entry = evaluate(candidate, { serviceDate, nowMinutes, previous, usable, local, options, duplicates: applicableByDirection.get(candidate.service.direction) ?? 0 });
      // Yesterday's table matters after midnight only where it still publishes a time at or after now.
      if (previous && !hasTimeAtOrAfter(candidate.trips, nowMinutes)) continue;
      entries.push(entry);
    }
  }

  return {
    schemaVersion: NIGHT_GUARD_SCHEMA_VERSION,
    routeNo,
    label: "OFFICIAL_DATED",
    evaluatedAt: now.toISOString(),
    localDate: local.date,
    localTime: clockText(local.minutes),
    asOf: bundle.retrievedOn,
    freshness,
    validUntil: nextTransition(entries, now),
    entries,
    reasons: routeReasons,
    provenance: { page: bundle.source.page, dataset: bundle.source.dataset, bundleVersion: bundle.bundleVersion, parser: bundle.parser, retrievedAt: bundle.retrievedAt },
  };
}

interface EvaluationContext {
  serviceDate: string;
  nowMinutes: number;
  previous: boolean;
  usable: boolean;
  local: { date: string; minutes: number };
  options: NightGuardOptions;
  duplicates: number;
}

function evaluate(
  candidate: { dataset: OfficialTimetableDataset; service: TimetableService; trips: TimetableTrip[]; applicability: DayTypeApplicability },
  context: EvaluationContext,
): NightGuardEntry {
  const { dataset, service, trips, applicability } = candidate;
  const reasons: NightGuardReason[] = [];
  if (context.previous) reasons.push("previous_service_day");

  // Where times are read.
  let measuredAt: NightGuardEntry["measuredAt"] = { kind: "trip_start" };
  if (context.options.timepoint !== undefined) {
    const columns = service.timepoints.flatMap((name, index) => (name === context.options.timepoint ? [index] : []));
    if (columns.length === 1) measuredAt = { kind: "timepoint", name: context.options.timepoint, column: columns[0]! };
    else reasons.push(columns.length === 0 ? "timepoint_not_published" : "timepoint_ambiguous");
  }
  if (measuredAt.kind === "trip_start") reasons.push("measured_from_trip_start");

  const timeOf = (trip: TimetableTrip): string | null => (measuredAt.kind === "timepoint" ? trip.times[measuredAt.column] ?? null : trip.firstTime);
  const placeOf = (trip: TimetableTrip): string => (measuredAt.kind === "timepoint" ? measuredAt.name : startPlace(trip, service.timepoints));
  const toScheduled = (trip: TimetableTrip, time: string): ScheduledTime => scheduled(time, context.serviceDate, placeOf(trip), context.nowMinutes);

  const conflict = service.status !== "ok";
  const base = {
    direction: service.direction,
    ...(dataset.source.scheduleId ? { scheduleId: dataset.source.scheduleId } : {}),
    serviceDate: context.serviceDate,
    dayType: service.dayType,
    ...(service.dayLabel ? { dayLabel: service.dayLabel } : {}),
    ...(service.serviceLabels ? { serviceLabels: service.serviceLabels } : {}),
    applicability,
    measuredAt,
    claimsOperating: false as const,
  };
  if (conflict) {
    // A table that contradicts itself is withheld: none of its times are sent.
    return { ...base, status: "unknown", evidence: "CONFLICTED", next: null, last: null, laterConditional: [], reasons: [...reasons, "source_conflict"] };
  }

  const plain = trips.filter((trip) => !(trip.conditions?.length)).flatMap((trip) => {
    const time = timeOf(trip);
    return time === null ? [] : [{ trip, time }];
  }).sort((left, right) => left.time.localeCompare(right.time));
  const conditional = trips.filter((trip) => trip.conditions?.length).flatMap((trip) => {
    const time = timeOf(trip);
    return time === null ? [] : [{ trip, time, conditions: trip.conditions! }];
  });
  const lastPlain = plain.at(-1);
  const last = lastPlain ? toScheduled(lastPlain.trip, lastPlain.time) : null;
  const laterConditional = conditional
    .filter((entry) => lastPlain === undefined || entry.time > lastPlain.time)
    .sort((left, right) => left.time.localeCompare(right.time))
    .map((entry) => ({ ...toScheduled(entry.trip, entry.time), conditions: entry.conditions }));
  const nextPlain = plain.find((entry) => minutes(entry.time) >= context.nowMinutes);
  const next = nextPlain ? toScheduled(nextPlain.trip, nextPlain.time) : null;

  // Gates that keep a table from answering for this service date. Table facts
  // (`last`) are still sent, labelled, so a rider can read what was published.
  const blocked: NightGuardReason[] = [];
  if (!context.usable) blocked.push("timetable_stale");
  if (!inEffect(service, context.serviceDate)) blocked.push("not_in_effect");
  if (applicability === "unstated") blocked.push("day_type_unstated");
  if (blocked.length > 0) {
    return { ...base, status: "unknown", evidence: "UNKNOWN", next: null, last, laterConditional, reasons: [...reasons, ...dedupe(blocked)] };
  }
  if (applicability === "uncertain") reasons.push("day_type_uncertain");
  if (context.duplicates > 1) reasons.push("multiple_tables");

  let status: NightGuardStatus;
  if (plain.length === 0) {
    status = "uncertain";
    reasons.push("no_plain_trips");
  } else if (next !== null) {
    status = minutes(plain[0]!.time) >= context.nowMinutes ? "before_first_departure" : "scheduled_departures_remain";
    reasons.push("scheduled_not_observed");
  } else if (laterConditional.some((entry) => entry.minutesFromNow >= 0)) {
    status = "uncertain";
    reasons.push("conditional_trips_later");
  } else {
    status = "last_scheduled_departed";
    reasons.push("bus_may_run_late");
  }
  if (applicability === "uncertain" || context.duplicates > 1) status = "uncertain";

  // Two tables for one direction: neither one's next departure is sent as the answer.
  return { ...base, status, evidence: "OFFICIAL_DATED", next: context.duplicates > 1 ? null : next, last, laterConditional, reasons };
}

function scheduled(table: string, serviceDate: string, at: string, nowMinutes: number): ScheduledTime {
  const total = minutes(table);
  return {
    table,
    clock: clockText(total % 1_440),
    date: total >= 1_440 ? addDays(serviceDate, 1) : serviceDate,
    at,
    minutesFromNow: total - nowMinutes,
  };
}

function nextTransition(entries: NightGuardEntry[], now: Date): string | null {
  const ahead = entries.flatMap((entry) => [entry.next, ...entry.laterConditional])
    .filter((time): time is ScheduledTime => time !== null && time.minutesFromNow >= 0)
    .map((time) => time.minutesFromNow);
  const nowMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  // A status turns over at the minute after the published time.
  const candidates = ahead.map((offset) => nowMinute + (offset + 1) * 60_000);
  // Yesterday's table stops being read at 06:00 and the calendar day turns at midnight.
  const local = koreanWallClock(now);
  const toMidnight = (1_440 - local.minutes) * 60_000;
  candidates.push(nowMinute + toMidnight);
  if (local.minutes < PREVIOUS_SERVICE_DAY_UNTIL_MINUTES) candidates.push(nowMinute + (PREVIOUS_SERVICE_DAY_UNTIL_MINUTES - local.minutes) * 60_000);
  return candidates.length ? new Date(Math.min(...candidates)).toISOString() : null;
}

function hasTimeAtOrAfter(trips: TimetableTrip[], nowMinutes: number): boolean {
  return trips.some((trip) => [trip.firstTime, ...trip.times].some((time) => time !== null && minutes(time) >= nowMinutes));
}

function inEffect(service: TimetableService, date: string): boolean {
  return service.effectiveFrom === undefined || service.effectiveFrom <= date;
}

function startPlace(trip: TimetableTrip, timepoints: string[]): string {
  if (trip.startsAt) return trip.startsAt.place;
  const index = trip.times.findIndex((time) => time !== null);
  const offTable = trip.offTable?.find((entry) => entry.time === trip.firstTime);
  if (offTable && (index < 0 || offTable.time < trip.times[index]!)) return offTable.place;
  return index >= 0 ? timepoints[index]! : offTable?.place ?? "";
}

/** Korean wall clock (UTC+9 all year; Korea has no daylight saving time). */
export function koreanWallClock(now: Date): { date: string; minutes: number } {
  const shifted = new Date(now.getTime() + 9 * 3_600_000);
  return { date: shifted.toISOString().slice(0, 10), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

function minutes(time: string): number {
  const [hours, mins] = time.split(":").map(Number);
  return hours! * 60 + mins!;
}

function clockText(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function addDays(date: string, delta: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + delta);
  return parsed.toISOString().slice(0, 10);
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}
