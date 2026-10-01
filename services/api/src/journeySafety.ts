/**
 * Jeju safety layer: Safe Return, Transfer Guardian and Rescue.
 *
 * Three deterministic, pure decisions over facts another system already
 * established. They never invent a timetable, an arrival time or a distance:
 * an input TAPSO does not have stays absent, and the answer becomes `unknown`
 * (or, for Rescue, a hand-off to a map app) instead of a confident guess.
 *
 * Times are minutes on one clock (the caller's "now" is 0); ranges are what the
 * evidence allows, never a single guessed instant. The language-neutral
 * specifications are `fixtures/journey/safe-return-v1.json`,
 * `transfer-guardian-v1.json` and `rescue-v1.json`; the Swift core implements
 * the same rules (`packages/transit-core/Sources/TapsoTransit/JourneySafety.swift`)
 * and runs the same cases. Product notes: `docs/product/JEJU_SAFETY_LAYER_V3.md`.
 *
 * The policy constants are `ASSUMED` product values, not measurements. They are
 * named, exported and recorded in each specification so a change is visible in
 * review and in both languages at once.
 */

import type { SafeReturnLevel, TransferRisk } from "./journeyContract.ts";

/* ------------------------------------------------------------- Safe Return */

export const SAFE_RETURN_POLICY = {
  /** Be at the stop this long before the last practical bus. */
  safetyMarginMinutes: 10,
  /** Slack beyond a useful visit for "오늘 다녀오기 좋아요". */
  comfortableSlackMinutes: 90,
  /** Less slack than this is "tight". */
  tightSlackMinutes: 20,
  /** A gap between catchable buses at least this long is worth saying out loud. */
  longWaitMinutes: 40,
  /** Estimates derived from live data expire after this long. */
  estimatedDataMaxAgeMinutes: 15,
} as const;

export type ReturnDataQuality = "scheduled" | "estimated" | "unknown";
export type SafeReturnReason =
  | "returnUnknown"
  | "dataExpired"
  | "arrivalUnknown"
  | "noReturnService"
  | "noTimeForVisit"
  | "longWait"
  | "disruption"
  | "estimatedTimes";

export interface SafeReturnInput {
  /** When the rider reaches the place; `null` when not known. */
  arrival: number | null;
  /** The shortest visit worth making. */
  minimumStay: number;
  /** From the place back to the return stop. */
  walkToReturnStop?: number;
  /** Departures of the return bus from the return stop. `null` when not known. */
  departures: number[] | null;
  /** `scheduled` and `estimated` lists are complete, even when empty; `unknown` is no data. */
  quality: ReturnDataQuality;
  /** Age of an `estimated` list. */
  dataAgeMinutes?: number;
  /** The last departure that still gets the rider home, when later buses do not. */
  lastPracticalDeparture?: number;
  /** A relevant service notice affects the way back. */
  disruption?: boolean;
}

export interface SafeReturnStatus {
  level: SafeReturnLevel;
  /** Leave the place by this time. */
  leaveBy: number | null;
  /** The last practical bus back. */
  lastDeparture: number | null;
  /** The longest wait between catchable buses after a useful visit, within the plan. */
  longestWait: number | null;
  reasons: SafeReturnReason[];
}

const unknownReturn = (reason: SafeReturnReason): SafeReturnStatus => ({
  level: "unknown",
  leaveBy: null,
  lastDeparture: null,
  longestWait: null,
  reasons: [reason],
});

export function evaluateSafeReturn(input: SafeReturnInput, policy = SAFE_RETURN_POLICY): SafeReturnStatus {
  if (input.quality === "unknown" || input.departures === null) return unknownReturn("returnUnknown");
  if (input.quality === "estimated") {
    const age = input.dataAgeMinutes;
    if (age === undefined || !(age <= policy.estimatedDataMaxAgeMinutes)) return unknownReturn("dataExpired");
  }
  if (input.arrival === null) return unknownReturn("arrivalUnknown");

  const arrival = input.arrival;
  const walk = input.walkToReturnStop ?? 0;
  const latest = input.lastPracticalDeparture;
  const catchable = input.departures
    .filter((departure) => departure >= arrival + walk && (latest === undefined || departure <= latest))
    .sort((left, right) => left - right);
  const last = catchable.at(-1);
  if (last === undefined) {
    return { level: "notRecommended", leaveBy: null, lastDeparture: null, longestWait: null, reasons: ["noReturnService"] };
  }

  const leaveBy = last - walk - policy.safetyMarginMinutes;
  const visitEnd = arrival + input.minimumStay;
  const afterVisit = catchable.filter((departure) => departure >= visitEnd + walk);
  const longestWait = afterVisit.length < 2
    ? null
    : Math.max(...afterVisit.slice(1).map((departure, index) => departure - afterVisit[index]!));

  if (visitEnd > leaveBy) {
    return { level: "notRecommended", leaveBy, lastDeparture: last, longestWait, reasons: ["noTimeForVisit"] };
  }

  const slack = leaveBy - visitEnd;
  let level: SafeReturnLevel = slack >= policy.comfortableSlackMinutes
    ? "comfortable"
    : slack >= policy.tightSlackMinutes
      ? "leaveBy"
      : "tight";
  const reasons: SafeReturnReason[] = [];
  if (longestWait !== null && longestWait >= policy.longWaitMinutes) {
    reasons.push("longWait");
    if (level === "comfortable") level = "leaveBy";
  }
  if (input.disruption) {
    reasons.push("disruption");
    level = level === "comfortable" ? "leaveBy" : "tight";
  }
  if (input.quality === "estimated") reasons.push("estimatedTimes");
  return { level, leaveBy, lastDeparture: last, longestWait, reasons };
}

/* -------------------------------------------------------- Transfer Guardian */

export const TRANSFER_GUARDIAN_POLICY = {
  /** A worst-case margin at least this large is `safe`. */
  safeMarginMinutes: 4,
  /** A wait for the following connection at least this long is worth saying out loud. */
  longWaitMinutes: 30,
} as const;

export interface MinuteRange {
  min: number;
  max: number;
}

export interface TransferInput {
  /** When the bus the rider is on reaches the transfer stop. */
  feederArrival: MinuteRange | null;
  /** Between the two stops; 0 when it is the same stop. */
  walk?: number;
  /** When the planned connecting bus leaves the transfer stop. */
  connection: MinuteRange | null;
  /** When the connecting bus after it leaves, if known. */
  nextConnection?: number | null;
  /** A Rescue plan replaced this connection. */
  recovering?: boolean;
}

export type TransferReason = "feederUnknown" | "connectionUnknown" | "invalidInput" | "longWaitIfMissed";

export interface TransferAssessment {
  risk: TransferRisk;
  /** Connection departure minus the rider's readiness, in the worst and best case. */
  worstMargin: number | null;
  bestMargin: number | null;
  /** The longest wait for the following connection if this one is missed. */
  waitIfMissed: number | null;
  reasons: TransferReason[];
}

const unknownTransfer = (reason: TransferReason): TransferAssessment => ({
  risk: "unknown",
  worstMargin: null,
  bestMargin: null,
  waitIfMissed: null,
  reasons: [reason],
});

const validRange = (range: MinuteRange) => Number.isFinite(range.min) && Number.isFinite(range.max) && range.min <= range.max;

export function assessTransfer(input: TransferInput, policy = TRANSFER_GUARDIAN_POLICY): TransferAssessment {
  if (input.recovering) {
    return { risk: "recovering", worstMargin: null, bestMargin: null, waitIfMissed: null, reasons: [] };
  }
  if (!input.feederArrival) return unknownTransfer("feederUnknown");
  if (!input.connection) return unknownTransfer("connectionUnknown");
  const walk = input.walk ?? 0;
  if (!validRange(input.feederArrival) || !validRange(input.connection) || !(Number.isFinite(walk) && walk >= 0)) {
    return unknownTransfer("invalidInput");
  }

  const readyEarliest = input.feederArrival.min + walk;
  const readyLatest = input.feederArrival.max + walk;
  const worstMargin = input.connection.min - readyLatest;
  const bestMargin = input.connection.max - readyEarliest;
  const risk: TransferRisk = bestMargin < 0
    ? "missed"
    : worstMargin >= policy.safeMarginMinutes
      ? "safe"
      : worstMargin >= 0
        ? "tight"
        : "atRisk";
  const next = input.nextConnection;
  const waitIfMissed = next !== undefined && next !== null && next >= readyEarliest ? next - readyEarliest : null;
  const reasons: TransferReason[] = waitIfMissed !== null && waitIfMissed >= policy.longWaitMinutes ? ["longWaitIfMissed"] : [];
  return { risk, worstMargin, bestMargin, waitIfMissed, reasons };
}

/* ------------------------------------------------------------------ Rescue */

export const RESCUE_POLICY = {
  /** ASSUMED walking pace, about 4.2 km/h. */
  walkingMetersPerMinute: 70,
  /** Beyond this TAPSO does not propose walking back. */
  maxWalkBackMeters: 1_200,
  /** A walk back this short is preferred over waiting for a bus. */
  comfortableWalkMinutes: 15,
  /** A wait at least this long is marked as long. */
  longWaitMinutes: 30,
} as const;

export type RescueKind = "passedDestination" | "missedConnection" | "wrongDirection";
export type RescueAction = "walkBack" | "rideBack" | "waitForNextConnection" | "takeAlternativeRoute" | "openMapApp";

export interface RescueInput {
  kind: RescueKind;
  /** Where the rider can get off next. */
  nextStopName?: string | null;
  /** From that stop back to the destination, when both are surveyed. */
  walkBackMeters?: number | null;
  /** A bus of the same route runs the other way through both stops. */
  oppositeDirection?: boolean;
  oppositeWaitMinutes?: number | null;
  nextConnectionWaitMinutes?: number | null;
  /** Other routes TAPSO knows serve the destination from here. */
  alternativeRoutes?: string[] | null;
}

export interface RescueOption {
  action: RescueAction;
  minutes: number | null;
  routeNumber: string | null;
  longWait: boolean;
}

export interface RescuePlan {
  /** Get off here first; `null` when the rider is not on a bus that must be left. */
  exitAt: string | null;
  /** Ordered; the first is the recommendation. A map-app hand-off is always last. */
  options: RescueOption[];
}

const option = (action: RescueAction, minutes: number | null = null, routeNumber: string | null = null, longWait = false): RescueOption =>
  ({ action, minutes, routeNumber, longWait });

export function planRescue(input: RescueInput, policy = RESCUE_POLICY): RescuePlan {
  const map = option("openMapApp");
  const exitAt = input.kind === "missedConnection" ? null : input.nextStopName ?? null;

  if (input.kind === "missedConnection") {
    const wait = input.nextConnectionWaitMinutes ?? null;
    const waitOption = wait === null ? null : option("waitForNextConnection", wait, null, wait >= policy.longWaitMinutes);
    const alternatives = (input.alternativeRoutes ?? []).map((route) => option("takeAlternativeRoute", null, route));
    if (waitOption && wait! < policy.longWaitMinutes) return { exitAt, options: [waitOption, ...alternatives, map] };
    if (alternatives.length > 0) return { exitAt, options: [...alternatives, ...(waitOption ? [waitOption] : []), map] };
    return { exitAt, options: [...(waitOption ? [waitOption] : []), map] };
  }

  const rideBack = input.oppositeDirection ? option("rideBack", input.oppositeWaitMinutes ?? null) : null;
  if (input.kind === "wrongDirection") return { exitAt, options: [...(rideBack ? [rideBack] : []), map] };

  const meters = input.walkBackMeters;
  const walkBack = meters !== undefined && meters !== null && Number.isFinite(meters) && meters >= 0 && meters <= policy.maxWalkBackMeters
    ? option("walkBack", Math.ceil(meters / policy.walkingMetersPerMinute))
    : null;
  const preferWalk = walkBack !== null && (
    walkBack.minutes! <= policy.comfortableWalkMinutes
    || rideBack === null
    || (rideBack.minutes !== null && walkBack.minutes! <= rideBack.minutes)
  );
  const ordered = preferWalk ? [walkBack, rideBack] : [rideBack, walkBack];
  return { exitAt, options: [...ordered.filter((value): value is RescueOption => value !== null), map] };
}
