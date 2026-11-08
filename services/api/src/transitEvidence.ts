/**
 * Transit Evidence Engine, first layer: combine what the official timetable
 * schedules (NightGuard), what the live provider reports, and any reviewed
 * official notice into one conservative operating assessment.
 *
 * Principles (docs/exec-plans/TAPSO_V4_IMPLEMENTATION.md):
 * - Every input is an `EvidenceRecord` with its provenance, the provider's
 *   observation time when there is one, and TAPSO's receipt time. Receipt time
 *   is never copied into `observedAt`: TAGO rows carry no observation time
 *   (`docs/DATA_SOURCES.md`), so theirs stays `null`.
 * - No assessment claims that a bus is operating. The strongest claim is that
 *   the provider reported a vehicle on the route, which says nothing about the
 *   rider's own bus or when it reaches the rider's stop.
 * - Absence of live vehicles never becomes a cancellation. Only a reviewed
 *   official notice with an effective period says a service is suspended.
 * - Disagreement is reported as `conflicting`, with both sides kept.
 * - No confidence percentage is produced.
 */

import type { NightGuardEntry } from "./nightGuard.ts";

export type EvidenceLabel = "VERIFIED" | "OBSERVED" | "OFFICIAL_DATED" | "ESTIMATED" | "ASSUMED" | "UNKNOWN" | "CONFLICTED" | "UNAVAILABLE";

export type EvidenceKind = "official_timetable" | "live_vehicle_position" | "stop_arrival" | "route_topology" | "service_day" | "official_notice" | "historical";

export interface EvidenceRecord {
  kind: EvidenceKind;
  label: EvidenceLabel;
  /** Who published it and how TAPSO read it. */
  provenance: string;
  /** The provider's own observation time, ISO 8601; `null` when the provider gives none. */
  observedAt: string | null;
  /** When TAPSO received it, ISO 8601; `null` when nothing was received. */
  receivedAt: string | null;
  routeNo?: string;
  routeVariant?: string;
  stop?: string;
  reasons: string[];
}

/**
 * `ASSUMED`: a live receipt older than this is not evidence about now. The
 * public `/v1/vehicles` cache holds rows 20 s and the app polls every 15 s
 * (`docs/validation/RIDE_3001_FALSE_DELAY_2026-10-04.md`), so a minute leaves
 * room for one missed poll without treating an old answer as current.
 */
export const LIVE_RECEIPT_MAX_AGE_SECONDS = 60;

/**
 * `ASSUMED`: a vehicle reported more than this long before the first scheduled
 * departure is not explained by the timetable (it may be positioning, or the
 * table may not apply), so the two are reported as conflicting.
 */
export const EARLY_VEHICLE_CONFLICT_MINUTES = 60;

export interface LiveVehicleEvidence {
  /** `reported`: one or more vehicles; `none_reported`: an answer with none; `unavailable`: no answer. */
  status: "reported" | "none_reported" | "unavailable";
  vehicleCount: number;
  receivedAt: string | null;
  /** The provider's observation time; TAGO gives none. */
  observedAt: string | null;
  provenance: string;
  routeVariant?: string;
}

export type OfficialNoticeKind = "suspension" | "detour" | "stop_closure" | "schedule_revision";

/** A reviewed official notice. Every notice ends: there is no open-ended record. */
export interface OfficialNotice {
  id: string;
  kind: OfficialNoticeKind;
  routeNumbers: string[];
  stops?: string[];
  /** ISO 8601 instants. */
  effectiveFrom: string;
  effectiveUntil: string;
  source: { publisher: string; url: string; retrievedOn: string; title: string };
  /** Who reviewed the structured record against the source. */
  reviewedBy: string;
  summary: string;
}

export class OfficialNoticeError extends Error {
  readonly code = "OFFICIAL_NOTICE_INVALID";
}

export function validateOfficialNotice(raw: unknown): OfficialNotice {
  const fail = (message: string): never => {
    throw new OfficialNoticeError(message);
  };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("notice must be an object");
  const notice = raw as OfficialNotice;
  if (typeof notice.id !== "string" || !notice.id) fail("id is required");
  if (!["suspension", "detour", "stop_closure", "schedule_revision"].includes(notice.kind)) fail(`kind ${String(notice.kind)} is not one TAPSO reads`);
  if (!Array.isArray(notice.routeNumbers) || notice.routeNumbers.length === 0) fail("a notice names at least one route");
  const from = Date.parse(notice.effectiveFrom);
  const until = Date.parse(notice.effectiveUntil);
  if (Number.isNaN(from)) fail("effectiveFrom must be an ISO 8601 instant");
  if (Number.isNaN(until)) fail("effectiveUntil is required: every notice must expire");
  if (until <= from) fail("effectiveUntil must be after effectiveFrom");
  if (!notice.source || !/^https:\/\//.test(String(notice.source.url)) || !notice.source.publisher || !notice.source.retrievedOn || !notice.source.title) {
    fail("source needs publisher, https url, title and retrievedOn");
  }
  if (typeof notice.reviewedBy !== "string" || !notice.reviewedBy) fail("reviewedBy is required: notices are reviewed records");
  if (typeof notice.summary !== "string" || !notice.summary) fail("summary is required");
  return notice;
}

/** Notices in effect at `now` for a route number. Expired and future notices are not read. */
export function activeNotices(notices: OfficialNotice[], routeNo: string, now: Date): OfficialNotice[] {
  const at = now.getTime();
  return notices.filter((notice) => notice.routeNumbers.includes(routeNo) && Date.parse(notice.effectiveFrom) <= at && at < Date.parse(notice.effectiveUntil));
}

export type OperatingClaim =
  /** The provider reported a vehicle on the route. Not the rider's bus; not an arrival time. */
  | "vehicle_reported"
  /** The timetable schedules more service; no vehicle is reported. Absence is not cancellation. */
  | "scheduled_not_observed"
  /** The timetable's last plain departure has passed and no vehicle is reported. Schedule-based. */
  | "no_scheduled_service_remaining"
  /** A reviewed official notice suspends the route now. */
  | "officially_suspended"
  /** Two sources disagree; both are kept. */
  | "conflicting"
  | "unknown";

export interface OperatingAssessment {
  claim: OperatingClaim;
  label: EvidenceLabel;
  reasons: string[];
  evidence: EvidenceRecord[];
  notices: string[];
  /** Never true. */
  claimsOperating: false;
}

export interface AssessmentInput {
  routeNo: string;
  schedule: NightGuardEntry | null;
  live: LiveVehicleEvidence;
  notices?: OfficialNotice[];
  now: Date;
  scheduleProvenance?: string;
}

/** One conservative assessment from schedule, live and notices. Pure. */
export function assessOperatingEvidence(input: AssessmentInput): OperatingAssessment {
  const { routeNo, schedule, now } = input;
  const evidence: EvidenceRecord[] = [];
  const reasons: string[] = [];

  if (schedule) {
    evidence.push({
      kind: "official_timetable",
      label: schedule.evidence,
      provenance: input.scheduleProvenance ?? "official timetable (OFFICIAL_DATED)",
      observedAt: null,
      receivedAt: null,
      routeNo,
      stop: schedule.measuredAt.kind === "timepoint" ? schedule.measuredAt.name : undefined,
      reasons: [...schedule.reasons],
    });
  }

  // Live: a receipt only counts as now if it is recent. Its time is a receipt, not an observation.
  const receiptAge = input.live.receivedAt === null ? Number.POSITIVE_INFINITY : (now.getTime() - Date.parse(input.live.receivedAt)) / 1_000;
  const liveCurrent = input.live.status !== "unavailable" && receiptAge >= 0 && receiptAge <= LIVE_RECEIPT_MAX_AGE_SECONDS;
  const liveReasons: string[] = [];
  if (input.live.observedAt === null) liveReasons.push("provider_observation_time_unavailable");
  if (input.live.status === "unavailable") liveReasons.push("live_unavailable");
  else if (!liveCurrent) liveReasons.push("live_receipt_too_old");
  evidence.push({
    kind: "live_vehicle_position",
    label: input.live.status === "unavailable" ? "UNAVAILABLE" : liveCurrent ? "OBSERVED" : "UNKNOWN",
    provenance: input.live.provenance,
    observedAt: input.live.observedAt,
    receivedAt: input.live.receivedAt,
    routeNo,
    ...(input.live.routeVariant ? { routeVariant: input.live.routeVariant } : {}),
    reasons: liveReasons,
  });
  const vehicles = liveCurrent && input.live.status === "reported" && input.live.vehicleCount > 0;
  const noVehicles = liveCurrent && (input.live.status === "none_reported" || input.live.vehicleCount === 0);

  const active = activeNotices(input.notices ?? [], routeNo, now);
  for (const notice of active) {
    evidence.push({
      kind: "official_notice",
      label: "OFFICIAL_DATED",
      provenance: `${notice.source.publisher}: ${notice.source.title} (${notice.source.url}, read ${notice.source.retrievedOn}, reviewed by ${notice.reviewedBy})`,
      observedAt: null,
      receivedAt: null,
      routeNo,
      reasons: [notice.kind, `effective ${notice.effectiveFrom} – ${notice.effectiveUntil}`],
    });
  }
  const suspension = active.find((notice) => notice.kind === "suspension" && !(notice.stops?.length));
  const done = (claim: OperatingClaim, label: EvidenceLabel, extra: string[] = []): OperatingAssessment => ({
    claim,
    label,
    reasons: [...reasons, ...extra],
    evidence,
    notices: active.map((notice) => notice.id),
    claimsOperating: false,
  });

  if (suspension) {
    if (vehicles) return done("conflicting", "CONFLICTED", ["vehicle_reported_during_official_suspension"]);
    return done("officially_suspended", "OFFICIAL_DATED", ["official_notice_in_effect"]);
  }

  if (vehicles) {
    const extra = ["vehicle_reported_is_not_the_riders_bus", ...liveReasons];
    if (schedule?.status === "before_first_departure" && schedule.next !== null && schedule.next.minutesFromNow > EARLY_VEHICLE_CONFLICT_MINUTES) {
      return done("conflicting", "CONFLICTED", [...extra, "vehicle_reported_long_before_first_scheduled_departure"]);
    }
    return done("vehicle_reported", "OBSERVED", extra);
  }

  if (!schedule || schedule.evidence !== "OFFICIAL_DATED") {
    return done("unknown", noVehicles ? "UNKNOWN" : "UNAVAILABLE", ["no_usable_schedule", ...liveReasons]);
  }
  switch (schedule.status) {
    case "scheduled_departures_remain":
    case "before_first_departure":
      return done("scheduled_not_observed", "OFFICIAL_DATED", ["absence_is_not_cancellation", ...liveReasons]);
    case "last_scheduled_departed":
      return done("no_scheduled_service_remaining", "OFFICIAL_DATED", ["bus_may_run_late", ...(noVehicles ? [] : liveReasons)]);
    default:
      return done("unknown", "UNKNOWN", ["schedule_uncertain", ...liveReasons]);
  }
}
