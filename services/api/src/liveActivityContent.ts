/**
 * What a ride's Live Activity should show, computed on the server from the
 * journey session, and when it is worth a push
 * (`docs/exec-plans/LIVE_ACTIVITY_PUSH.md`, milestone 4).
 *
 * The app already turns a session into Lock Screen content
 * (`LiveSessionInterpreter.rideSignal` → `RideGuidancePolicy`). A push must
 * carry exactly what the app would show, so this is a port of those two Swift
 * functions, not a second policy. `fixtures/journey/live-activity-signals-v1.json`
 * is generated from this module over the server's own session payloads, and
 * the Swift core checks every entry against its own functions
 * (`LiveSessionInterpreterTests`), so the two cannot drift silently.
 *
 * Fail closed throughout: anything the server did not establish becomes
 * `checking`, which never alerts. A push carries only a rider-confirmed bus's
 * progress; a session without a confirmed bus is never pushed, whatever the
 * matcher concluded.
 */

import type { LiveActivityContentState, LiveActivityMilestone, LiveActivityPush } from "./apns.ts";
import { swiftDate } from "./apns.ts";
import type { StopOnRoute } from "./domain.ts";
import type { JourneySessionView } from "./journeySession.ts";

/** Swift `JourneyState` raw values this module can produce. */
export type RidePhase =
  | "active"
  | "approachingDestination"
  | "nextStopIsDestination"
  | "arrived"
  | "dataStale"
  | "vehicleTemporarilyLost"
  | "vehicleRecovery"
  | "completed";

export type RideFreshness = "fresh" | "aging" | "stale" | "unknown";

/** Swift `RideSignal`. */
export interface RideSignal {
  phase: RidePhase;
  remainingStops: number;
  freshness: RideFreshness;
  destinationPassed: boolean;
  isOffline: boolean;
}

/** Swift `RideMoment`. */
export type RideMoment =
  | "riding"
  | "prepare"
  | "nextStop"
  | "arrived"
  | "passedDestination"
  | "delayed"
  | "vehicleLost"
  | "offline"
  | "checking"
  | "ended";

/** Nonterminal content goes stale this long after it was true (`TapsoLiveActivityPolicy.staleInterval`). */
export const LIVE_ACTIVITY_STALE_INTERVAL_MS = 120_000;
/**
 * Unchanged content is pushed again once this much of the stale interval has
 * passed, so a ride whose bus sits between stops does not read "확인 중" while
 * its data is still fresh.
 */
export const LIVE_ACTIVITY_REFRESH_INTERVAL_MS = 60_000;
/** An ended activity stays on the Lock Screen this long (`LiveActivityClient.end`). */
export const LIVE_ACTIVITY_END_DISMISSAL_MS = 60_000;

/**
 * The milestone alerts, in the app's own words (`ride.<milestone>.headline` /
 * `.detail` in `apps/ios/Resources/ko.lproj/Localizable.strings`;
 * `liveActivityContent.test.ts` fails if they drift).
 */
export const MILESTONE_ALERTS: Readonly<Record<LiveActivityMilestone, { title: string; body: string }>> = {
  prepare: { title: "2정거장 남았어요", body: "내릴 준비를 해주세요" },
  nextStop: { title: "다음에 내려요", body: "다음 정류장이 목적지예요. 하차벨을 눌러주세요" },
  arrived: { title: "여기서 내려요", body: "목적지에 도착했어요" },
};

/** Port of `LiveSessionInterpreter.rideSignal`. The server is never offline to itself. */
export function rideSignalFromSession(view: JourneySessionView): RideSignal {
  const progress = view.progress;
  const remaining = progress?.remainingStops ?? -1;
  const reading = progress ? phaseFor(progress.phase) : undefined;
  const checking: RideSignal = { phase: "vehicleRecovery", remainingStops: -1, freshness: "unknown", destinationPassed: false, isOffline: false };
  switch (view.state) {
    case "tracking":
    case "arrived":
    case "passed_destination":
      if (!progress || !reading) return checking;
      return {
        phase: reading.phase,
        remainingStops: reading.passed ? 0 : progress.remainingStops,
        freshness: "fresh",
        destinationPassed: reading.passed,
        isOffline: false,
      };
    case "degraded":
      return {
        phase: reading?.phase ?? "dataStale",
        remainingStops: remaining,
        freshness: "aging",
        destinationPassed: reading?.passed ?? false,
        isOffline: false,
      };
    case "lost":
      return { phase: "vehicleTemporarilyLost", remainingStops: remaining, freshness: "stale", destinationPassed: false, isOffline: false };
    default:
      return checking;
  }
}

function phaseFor(wire: string): { phase: RidePhase; passed: boolean } | undefined {
  switch (wire) {
    case "active": return { phase: "active", passed: false };
    case "approaching": return { phase: "approachingDestination", passed: false };
    case "next_stop": return { phase: "nextStopIsDestination", passed: false };
    case "arrived": return { phase: "arrived", passed: false };
    case "passed_destination": return { phase: "arrived", passed: true };
    default: return undefined;
  }
}

/** Port of `RideGuidancePolicy.moment` for the phases this module produces. */
export function rideMoment(signal: RideSignal): RideMoment {
  if (signal.phase === "completed") return "ended";
  if (signal.remainingStops < 0) return "checking";
  if (signal.isOffline) return "offline";
  if (signal.phase === "vehicleTemporarilyLost") return "vehicleLost";
  if (signal.freshness === "stale" || signal.phase === "dataStale") return "delayed";
  if (signal.freshness === "unknown" || signal.phase === "vehicleRecovery") return "checking";
  if (signal.freshness === "aging") return "delayed";
  if (signal.destinationPassed) {
    return signal.phase === "arrived" && signal.remainingStops === 0 ? "passedDestination" : "checking";
  }
  if (signal.phase === "approachingDestination" && signal.remainingStops === 2) return "prepare";
  if (signal.phase === "nextStopIsDestination" && signal.remainingStops === 1) return "nextStop";
  if (signal.phase === "arrived" && signal.remainingStops === 0) return "arrived";
  if (signal.phase === "active" && signal.remainingStops >= 3) return "riding";
  return "checking";
}

/** Port of `RideGuidancePolicy.milestone`. */
export function rideMilestone(moment: RideMoment): LiveActivityMilestone | undefined {
  return moment === "prepare" || moment === "nextStop" || moment === "arrived" ? moment : undefined;
}

/**
 * The Lock Screen content for a session, as `TapsoAppModel.contentState`
 * builds it: the stop the bus was last placed at (or the boarding stop), and
 * the next stop toward the destination; past the destination, the stop to get
 * off at (`PassedStopRescue.exitStop`).
 */
export function liveActivityContentState(view: JourneySessionView, stops: readonly StopOnRoute[], atMs: number): LiveActivityContentState {
  const signal = rideSignalFromSession(view);
  const ordered = [...stops].sort((left, right) => left.sequence - right.sequence);
  const current = view.progress?.currentStopSequence;
  const destination = view.destinationStop.sequence;
  const currentStopName = (current === undefined ? undefined : ordered.find((stop) => stop.sequence === current)?.name)
    ?? view.boardingStop.name;
  const from = current ?? view.boardingStop.sequence;
  const next = rideMoment(signal) === "passedDestination"
    ? exitStop(ordered, destination, current)
    : ordered.find((stop) => stop.sequence > from && stop.sequence <= destination);
  return {
    phase: signal.phase,
    currentStopName,
    ...(next ? { nextStopName: next.name } : {}),
    remainingStops: signal.remainingStops,
    freshness: signal.freshness,
    updatedAt: swiftDate(atMs),
    destinationPassed: signal.destinationPassed,
    isOffline: false,
  };
}

/** Port of `PassedStopRescue.exitStop`. */
function exitStop(stops: readonly StopOnRoute[], destination: number, bus: number | undefined): StopOnRoute | undefined {
  if (bus === undefined) return undefined;
  const after = Math.max(bus, destination);
  const next = stops.find((stop) => stop.sequence > after);
  if (next) return next;
  const last = stops.at(-1);
  return last && last.sequence === bus ? last : undefined;
}

/**
 * What was last pushed for a ride. Kept in the session row beside the token,
 * so a rotated token keeps it and ending the ride deletes it.
 */
export interface LiveActivityDelivery {
  /** The `timestampMs` of the last push Apple accepted. A push is never older. */
  lastTimestampMs: number;
  /** The last content pushed, minus `updatedAt`. */
  lastContentKey: string;
  /** Milestones already alerted on this ride; each alerts once. */
  alerted: LiveActivityMilestone[];
}

export type LiveActivityPlan =
  | { send: false; reason: "no_confirmed_bus" | "not_newer" | "unchanged" }
  | { send: true; push: Omit<LiveActivityPush, "token">; next: LiveActivityDelivery };

/**
 * Whether this session state is worth a push, and the push. Pure.
 *
 * - Only a rider-confirmed bus is pushed (`selectionMode: "explicit"`, or an
 *   automatic selection where readiness allowed one).
 * - The push's timestamp is when its content was true (`progress.evidenceAt`,
 *   else the session's `updatedAt`); one no newer than the last accepted is
 *   never sent, since Apple would drop it and it could only move the screen back.
 * - Changed content is pushed at priority 5. Unchanged content is pushed again
 *   only once `LIVE_ACTIVITY_REFRESH_INTERVAL_MS` has passed, to move its
 *   stale date. A milestone reached for the first time on this ride carries its
 *   alert (priority 10), once.
 */
export function planLiveActivityPush(
  view: JourneySessionView,
  stops: readonly StopOnRoute[],
  delivery: LiveActivityDelivery | undefined,
): LiveActivityPlan {
  if (view.selectedVehicleId === undefined) return { send: false, reason: "no_confirmed_bus" };
  // Fresh progress was true when its evidence arrived. Any other state (a
  // degraded, lost or checking session keeps the old progress with its old
  // evidence time) became true when the session moved into it.
  const fresh = view.state === "tracking" || view.state === "arrived" || view.state === "passed_destination";
  const timestampMs = Date.parse((fresh ? view.progress?.evidenceAt : undefined) ?? view.updatedAt);
  if (!Number.isFinite(timestampMs) || (delivery && timestampMs <= delivery.lastTimestampMs)) return { send: false, reason: "not_newer" };
  const contentState = liveActivityContentState(view, stops, timestampMs);
  const { updatedAt: _updatedAt, ...comparable } = contentState;
  const contentKey = JSON.stringify(comparable);
  const milestone = rideMilestone(rideMoment(rideSignalFromSession(view)));
  const alert = milestone !== undefined && !(delivery?.alerted ?? []).includes(milestone) ? milestone : undefined;
  if (delivery && alert === undefined && contentKey === delivery.lastContentKey
    && timestampMs - delivery.lastTimestampMs < LIVE_ACTIVITY_REFRESH_INTERVAL_MS) {
    return { send: false, reason: "unchanged" };
  }
  const terminal = contentState.phase === "arrived";
  return {
    send: true,
    push: {
      event: "update",
      contentState,
      timestampMs,
      ...(terminal ? {} : { staleDateMs: timestampMs + LIVE_ACTIVITY_STALE_INTERVAL_MS }),
      ...(alert ? { alert: MILESTONE_ALERTS[alert] } : {}),
    },
    next: {
      lastTimestampMs: timestampMs,
      lastContentKey: contentKey,
      alerted: alert ? [...(delivery?.alerted ?? []), alert] : [...(delivery?.alerted ?? [])],
    },
  };
}

/**
 * The push that ends the activity when the ride ends on the server (the rider
 * ended it, or it expired): "ride ended" content, dismissed after a minute,
 * as the app does when the rider finishes. Timestamped `nowMs`, after anything pushed before.
 */
export function planLiveActivityEnd(
  session: { boardingStop: StopOnRoute; lastProgressStopName?: string },
  delivery: LiveActivityDelivery | undefined,
  nowMs: number,
): Omit<LiveActivityPush, "token"> {
  const timestampMs = Math.max(nowMs, (delivery?.lastTimestampMs ?? 0) + 1);
  return {
    event: "end",
    contentState: {
      phase: "completed",
      currentStopName: session.lastProgressStopName ?? session.boardingStop.name,
      remainingStops: 0,
      freshness: "unknown",
      updatedAt: swiftDate(timestampMs),
      destinationPassed: false,
      isOffline: false,
    },
    timestampMs,
    dismissalDateMs: timestampMs + LIVE_ACTIVITY_END_DISMISSAL_MS,
  };
}
