import type { StopOnRoute, VehicleObservation } from "./domain.ts";
import { replayMatching, type MatchGateEvidence } from "./matchReplay.ts";
import { round, summarize, type NumberSummary } from "./stats.ts";

/**
 * Controlled real-ride capture and analysis.
 *
 * A capture is written only under ignored `work/` storage because it contains raw
 * TAGO vehicle numbers. The report produced by `analyzeRideCapture` replaces every
 * vehicle number with a per-run pseudonym so it can be quoted in tracked docs.
 *
 * TAGO exposes no source observation timestamp, so every "age" here is the time
 * since the snapshot content for a vehicle last changed, measured with TAPSO
 * receipt time. That is evidence for defining a freshness rule, not the rule itself.
 */

/** Re-exported so existing importers of this module keep working. */
export { summarize, type NumberSummary };

export const RIDE_CAPTURE_SCHEMA_VERSION = 1;

export type RideMarkerKind = "boarded" | "passed_stop" | "alighted" | "note";

/**
 * Instrument lifecycle, not rider ground truth. A mobile browser can be
 * suspended or lose the network mid-ride, and the resulting hole in the
 * snapshots looks exactly like a provider dropout unless the instrument says
 * otherwise. These events are how the analysis tells the two apart; they are
 * never markers, and nothing here is evidence about TAGO.
 */
export type RideEventKind =
  | "hidden"
  | "visible"
  | "offline"
  | "online"
  | "wake_lock_active"
  | "wake_lock_unavailable"
  | "resumed";

export interface RideEvent {
  at: string;
  kind: RideEventKind;
  /** Short operator-safe context. Never a URL, a credential, or a vehicle number. */
  detail?: string;
}

export type RideCaptureSource = "cli" | "web-controller";
export type RideCaptureEngine = "cli" | "local-device" | "railway-background";

export interface RideMarker {
  at: string;
  kind: RideMarkerKind;
  /** Physical stop sequence for `passed_stop` and optionally `boarded`/`alighted`. */
  stopSequence?: number;
  note?: string;
}

export interface RideSnapshot {
  capturedAt: string;
  vehicles: VehicleObservation[];
  /** Credential-safe provider error message when the poll failed. */
  error?: string;
}

export interface RideCapture {
  schemaVersion: number;
  startedAt: string;
  endedAt?: string;
  routeId: string;
  cityCode: string;
  boardingStopSequence: number;
  destinationStopSequence: number;
  /** Raw TAGO vehicle number typed by the rider. Never leaves `work/`. */
  boardedVehicleId?: string;
  intervalMs: number;
  stops: StopOnRoute[];
  snapshots: RideSnapshot[];
  markers: RideMarker[];
  /**
   * Optional and additive at schema version 1: absent in every capture the CLI
   * writes, present in captures from the mobile controller. Keeping the version
   * at 1 is deliberate — a bump would make the CLI analyzer reject web captures
   * and vice versa, and these two fields need no such break.
   */
  events?: RideEvent[];
  source?: RideCaptureSource;
  /** Concrete polling owner. Unlike source, this distinguishes Safari polling from Railway polling. */
  captureEngine?: RideCaptureEngine;
}

export interface SequenceChange {
  at: string;
  stopSequence?: number;
  /** Seconds since the previous content change for this vehicle. */
  secondsSincePreviousChange?: number;
}

export interface VehicleGap {
  missingFrom: string;
  missingUntil: string;
  seconds: number;
  /** Number of consecutive successful snapshots in which the vehicle was absent. */
  missedSnapshots: number;
}

/**
 * Whether `nodeord` and the published coordinates move together. TAGO exposes
 * both and neither carries a source timestamp, so Task C needs to know which of
 * the two actually advances before it can trust either as a progress signal.
 */
export interface GpsEvidence {
  /** Observations carrying both a latitude and a longitude. */
  coordinateSamples: number;
  /** Consecutive sightings whose coordinates differ. */
  coordinateChanges: number;
  coordinateChangeWithoutSequenceChange: number;
  sequenceChangeWithoutCoordinateChange: number;
}

export interface VehicleTimeline {
  /** Per-run pseudonym such as `V1`; `tracked` for the boarded vehicle. */
  label: string;
  isTracked: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  snapshotsSeen: number;
  /** `snapshotsSeen` over the successful snapshots taken after this vehicle first appeared. */
  presenceRatio: number;
  contentChanges: SequenceChange[];
  contentChangeIntervalSeconds: NumberSummary;
  /** Seconds since last content change, sampled at every successful snapshot after the first sighting. */
  contentAgeSeconds: NumberSummary;
  sequenceDecreaseCount: number;
  largestSequenceJump: number;
  largestSequenceDecrease: number;
  /** Distribution of forward `nodeord` steps between consecutive sightings. */
  sequenceAdvances: NumberSummary;
  gpsEvidence: GpsEvidence;
  gaps: VehicleGap[];
}

export interface MarkerComparison {
  kind: RideMarkerKind;
  markedAt: string;
  stopSequence?: number;
  /** First successful snapshot where the tracked vehicle reported `stopSequence >= marked sequence`. */
  providerReachedAt?: string;
  /** Positive: provider reported the stop after the rider marked it. Negative: before. */
  providerLagSeconds?: number;
}

export interface TrackedVehicleReport {
  present: boolean;
  /** Successful snapshots containing the tracked vehicle, over those taken after it first appeared. */
  presenceRatio: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  remainingStopsTimeline: Array<{ at: string; stopSequence: number; remainingStops: number }>;
  passedBoardingAt?: string;
  arrivalDetectedAt?: string;
  passedDestination: boolean;
  missedSnapshotCount: number;
  markerComparisons: MarkerComparison[];
}

/**
 * What the recording instrument did during the ride. A gap while the browser
 * was suspended or offline is the instrument's gap, and reading it as a
 * provider dropout would corrupt the very cadence Task C is meant to measure.
 */
export interface RideCaptureLifecycle {
  source: RideCaptureSource | "unknown";
  eventCount: number;
  hiddenPeriods: number;
  hiddenSeconds: number;
  offlinePeriods: number;
  offlineSeconds: number;
  /** Captures reopened after a refresh or a crash. */
  recoveries: number;
  wakeLockUnavailable: boolean;
}

/**
 * Whether the capture file itself is trustworthy, independent of what it shows.
 * A non-zero count here is a reason to doubt the run, not a property of TAGO.
 */
export interface RideCaptureIntegrity {
  /** Snapshots stored out of chronological order. Analysis sorts them; the count stays. */
  snapshotsOutOfOrder: number;
  duplicateSnapshotTimestamps: number;
  /** One snapshot listing the same vehicle twice. */
  duplicateVehicleObservations: number;
  markersOutOfOrder: number;
  markersOutsideCaptureWindow: number;
  /** Observations whose `routeId` is not the captured route. */
  foreignRouteObservations: number;
  /**
   * Observations reporting a `nodeord` the captured topology does not contain,
   * which is what a topology change mid-ride looks like from inside a capture.
   */
  offTopologyObservations: number;
}

/**
 * One sample-count precondition for computing a statistic. These are minimum
 * sample sizes for a distribution to mean anything — never a freshness policy
 * threshold, which Task C defines from the distributions themselves.
 */
export interface EvidenceCriterion {
  name: string;
  required: boolean;
  met: boolean;
  observed: number;
  minimum: number;
  note: string;
}

export interface EvidenceCompleteness {
  verdict: "SUFFICIENT" | "INSUFFICIENT_EVIDENCE";
  criteria: EvidenceCriterion[];
  unmetRequired: string[];
}

export interface RideCaptureReport {
  schemaVersion: number;
  routeId: string;
  cityCode: string;
  boardingStopSequence: number;
  destinationStopSequence: number;
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  /** Concrete polling owner, preserved in the sanitized report for acceptance evidence. */
  captureEngine: RideCaptureEngine | "unknown";
  /** Poll interval the runner was configured with, as opposed to what it achieved. */
  configuredIntervalSeconds: number;
  snapshotCount: number;
  failedSnapshotCount: number;
  emptySnapshotCount: number;
  collectionIntervalSeconds: NumberSummary;
  uniqueVehicleCount: number;
  stopCount: number;
  stopSequenceContiguous: boolean;
  /** The route's shape, and whether this particular ride wraps past the end of it. */
  topology: RouteTopology & { wrapAround: boolean };
  vehicles: VehicleTimeline[];
  tracked: TrackedVehicleReport;
  /** Which instrument produced the capture, and what it did to itself. */
  lifecycle: RideCaptureLifecycle;
  integrity: RideCaptureIntegrity;
  evidenceCompleteness: EvidenceCompleteness;
  /**
   * What the real matcher would have done, replayed over these snapshots.
   *
   * This is the only part of the report that answers the broad-real-mode gate
   * in `docs/DATA_VALIDATION.md`: whether the matcher would have picked the bus
   * the rider actually boarded, by what margin, and whether it stayed closed on
   * stale data. Everything else here describes the ride; this describes the
   * decision the product would have made during it.
   */
  matchGate: MatchGateEvidence;
  /** Aggregate over all vehicles; input for a freshness rule, not the rule. */
  freshnessEvidence: {
    contentChangeIntervalSeconds: NumberSummary;
    contentAgeSeconds: NumberSummary;
    longestUnchangedRunSeconds?: number;
    gapSeconds: NumberSummary;
    sequenceAdvanceStops: NumberSummary;
    /** Seconds from a physical rider marker to the first snapshot reporting it. */
    markerLagSeconds: NumberSummary;
  };
  warnings: string[];
}

/**
 * What shape the route's stop list is. This decides whether a journey may wrap
 * past the end of the list, which is the only question a circular route asks
 * that a straight one does not.
 *
 *  - `linear`    every stop appears once; a journey runs forward and only forward.
 *  - `loop`      the last entry repeats the first and nothing else repeats, so the
 *                list closes on itself and wrap-around is well defined.
 *  - `repeating` some stop appears more than once without closing the list. The
 *                route really does pass a stop twice, so "which pass" is
 *                ambiguous and wrap-around is refused rather than guessed.
 */
export type TopologyKind = "linear" | "loop" | "repeating";

export interface RouteTopology {
  kind: TopologyKind;
  stopCount: number;
  /** Distinct physical stops in one pass, and the modulus a loop wraps on. */
  cycleLength: number;
  sequenceAscending: boolean;
  duplicateStopIdCount: number;
  /** Two different stops may legitimately share a name; the UI must show more than the name. */
  duplicateStopNameCount: number;
}

export function classifyTopology(stops: StopOnRoute[]): RouteTopology {
  const list = stops ?? [];
  const ids = list.map((stop) => stop.stopId);
  const names = list.map((stop) => stop.name);
  const duplicateStopIdCount = ids.length - new Set(ids).size;
  const duplicateStopNameCount = names.length - new Set(names).size;
  const sequenceAscending = list.every((stop, index) => index === 0 || stop.sequence > list[index - 1]!.sequence);
  const closes = list.length >= 3 && ids[0] !== undefined && ids[0] === ids.at(-1);

  if (closes && duplicateStopIdCount === 1) {
    return { kind: "loop", stopCount: list.length, cycleLength: list.length - 1, sequenceAscending, duplicateStopIdCount, duplicateStopNameCount };
  }
  const kind: TopologyKind = duplicateStopIdCount === 0 ? "linear" : "repeating";
  return { kind, stopCount: list.length, cycleLength: list.length, sequenceAscending, duplicateStopIdCount, duplicateStopNameCount };
}

/** True when the ride runs past the end of the stop list and back round. */
export function isWrapAroundJourney(capture: Pick<RideCapture, "stops" | "boardingStopSequence" | "destinationStopSequence">): boolean {
  return capture.boardingStopSequence > capture.destinationStopSequence
    && classifyTopology(capture.stops).kind === "loop";
}

/**
 * Stops still to go. On a straight route that is a subtraction; on a loop it is
 * the forward arc, because a bus at sequence 38 of 40 heading for sequence 3 has
 * five stops left, not minus thirty-five.
 */
export function forwardStopDistance(from: number, to: number, topology: RouteTopology, wrapAround: boolean): number {
  if (!wrapAround) return to - from;
  const modulus = Math.max(1, topology.cycleLength);
  return (((to - from) % modulus) + modulus) % modulus;
}

export class RideCaptureInputError extends Error {
  readonly code = "RIDE_CAPTURE_INPUT_INVALID";
}

export function validateRideCapture(capture: RideCapture): void {
  if (capture.schemaVersion !== RIDE_CAPTURE_SCHEMA_VERSION) {
    throw new RideCaptureInputError(`Unsupported ride capture schema ${capture.schemaVersion}`);
  }
  if (!capture.routeId.trim() || !capture.cityCode.trim()) {
    throw new RideCaptureInputError("routeId and cityCode are required");
  }
  const sequences = new Set(capture.stops.map((stop) => stop.sequence));
  if (sequences.size === 0) throw new RideCaptureInputError("Route stops are required");
  for (const [name, value] of [
    ["boardingStopSequence", capture.boardingStopSequence],
    ["destinationStopSequence", capture.destinationStopSequence],
  ] as const) {
    if (!Number.isInteger(value) || !sequences.has(value)) {
      throw new RideCaptureInputError(`${name} must be an official stop sequence of the route`);
    }
  }
  if (capture.boardingStopSequence === capture.destinationStopSequence) {
    throw new RideCaptureInputError("destinationStopSequence must be after boardingStopSequence");
  }
  if (capture.boardingStopSequence > capture.destinationStopSequence) {
    // Riding past the end of the list and back round is only meaningful when the
    // list actually closes on itself. Anywhere else it is a reversed direction,
    // and accepting it would produce markers nobody can interpret afterwards.
    const topology = classifyTopology(capture.stops);
    if (topology.kind !== "loop") {
      throw new RideCaptureInputError(
        `destinationStopSequence must be after boardingStopSequence on a ${topology.kind} route; wrap-around needs a topology that closes on itself`,
      );
    }
  }
  for (const marker of capture.markers) {
    if (marker.kind === "passed_stop" && (!Number.isInteger(marker.stopSequence) || !sequences.has(marker.stopSequence!))) {
      throw new RideCaptureInputError("passed_stop markers must name an official stop sequence");
    }
  }
  if (capture.events !== undefined) {
    if (!Array.isArray(capture.events)) throw new RideCaptureInputError("events must be an array when present");
    for (const event of capture.events) {
      if (!event || typeof event.at !== "string" || Number.isNaN(Date.parse(event.at))) {
        throw new RideCaptureInputError("every event needs an ISO timestamp");
      }
      if (!RIDE_EVENT_KINDS.has(event.kind)) throw new RideCaptureInputError(`unknown ride event: ${String(event.kind)}`);
    }
  }
  if (capture.source !== undefined && capture.source !== "cli" && capture.source !== "web-controller") {
    throw new RideCaptureInputError("source must be cli or web-controller when present");
  }
  if (capture.captureEngine !== undefined && !CAPTURE_ENGINES.has(capture.captureEngine)) {
    throw new RideCaptureInputError("captureEngine must be cli, local-device, or railway-background when present");
  }
}

const CAPTURE_ENGINES = new Set<string>(["cli", "local-device", "railway-background"]);

const RIDE_EVENT_KINDS = new Set<string>([
  "hidden",
  "visible",
  "offline",
  "online",
  "wake_lock_active",
  "wake_lock_unavailable",
  "resumed",
]);

export function analyzeRideCapture(capture: RideCapture): RideCaptureReport {
  validateRideCapture(capture);
  const warnings: string[] = [];
  const topology = classifyTopology(capture.stops);
  const wrapAround = topology.kind === "loop" && capture.boardingStopSequence > capture.destinationStopSequence;
  // A bus on a closed route wraps whether or not this rider's journey does, so
  // the step arithmetic follows the route while remaining-stops follows the ride.
  const loopArithmetic = topology.kind === "loop";
  const snapshots = [...capture.snapshots].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const successful = snapshots.filter((snapshot) => !snapshot.error);
  const boarded = capture.boardedVehicleId?.trim();
  const tracked: TrackedVehicleReport = {
    present: false,
    presenceRatio: 0,
    remainingStopsTimeline: [],
    passedDestination: false,
    missedSnapshotCount: 0,
    markerComparisons: [],
  };

  const labels = new Map<string, string>();
  const order: string[] = [];
  for (const snapshot of successful) {
    for (const vehicle of snapshot.vehicles) {
      if (!labels.has(vehicle.vehicleId)) {
        labels.set(vehicle.vehicleId, vehicle.vehicleId === boarded ? "tracked" : `V${order.length + 1}`);
        order.push(vehicle.vehicleId);
      }
    }
  }
  if (boarded && !labels.has(boarded)) {
    warnings.push("The boarded vehicle never appeared in any successful snapshot");
  }
  if (!boarded) warnings.push("No boarded vehicle was recorded; tracked analysis is empty");

  const allChangeIntervals: number[] = [];
  const allContentAges: number[] = [];
  const allGapSeconds: number[] = [];
  const allAdvances: number[] = [];
  let longestUnchangedRun: number | undefined;

  const vehicles = order.map((vehicleId): VehicleTimeline => {
    const label = labels.get(vehicleId)!;
    const isTracked = label === "tracked";
    const contentChanges: SequenceChange[] = [];
    const ages: number[] = [];
    const gaps: VehicleGap[] = [];
    let previousSignature: string | undefined;
    let lastChangeAt: number | undefined;
    let lastSeenIndex: number | undefined;
    let lastSeenAt = "";
    let firstSeenAt = "";
    let previousSequence: number | undefined;
    let decreases = 0;
    let largestJump = 0;
    let largestDecrease = 0;
    let seen = 0;
    let firstSeenIndex: number | undefined;
    const advances: number[] = [];
    let previousObservation: VehicleObservation | undefined;
    let coordinateSamples = 0;
    let coordinateChanges = 0;
    let coordinateChangeWithoutSequenceChange = 0;
    let sequenceChangeWithoutCoordinateChange = 0;

    successful.forEach((snapshot, index) => {
      const observation = snapshot.vehicles.find((vehicle) => vehicle.vehicleId === vehicleId);
      const at = Date.parse(snapshot.capturedAt);
      if (!observation) {
        if (isTracked && firstSeenAt) tracked.missedSnapshotCount += 1;
        return;
      }
      seen += 1;
      if (!firstSeenAt) {
        firstSeenAt = snapshot.capturedAt;
        firstSeenIndex = index;
      }
      if (lastSeenIndex !== undefined && lastSeenIndex < index - 1) {
        const missingFrom = successful[lastSeenIndex + 1]!.capturedAt;
        const seconds = round((at - Date.parse(lastSeenAt)) / 1_000);
        gaps.push({ missingFrom, missingUntil: snapshot.capturedAt, seconds, missedSnapshots: index - lastSeenIndex - 1 });
        allGapSeconds.push(seconds);
      }
      lastSeenIndex = index;
      lastSeenAt = snapshot.capturedAt;

      const signature = contentSignature(observation);
      if (signature !== previousSignature) {
        const change: SequenceChange = { at: snapshot.capturedAt, stopSequence: observation.stopSequence };
        if (lastChangeAt !== undefined) {
          change.secondsSincePreviousChange = round((at - lastChangeAt) / 1_000);
          allChangeIntervals.push(change.secondsSincePreviousChange);
        }
        contentChanges.push(change);
        lastChangeAt = at;
        previousSignature = signature;
      } else if (lastChangeAt !== undefined) {
        const age = round((at - lastChangeAt) / 1_000);
        ages.push(age);
        allContentAges.push(age);
        longestUnchangedRun = Math.max(longestUnchangedRun ?? 0, age);
      }

      const sequence = observation.stopSequence;
      if (sequence !== undefined) {
        if (previousSequence !== undefined) {
          const delta = loopArithmetic
            ? shortestArc(previousSequence, sequence, topology)
            : sequence - previousSequence;
          if (delta < 0) {
            decreases += 1;
            largestDecrease = Math.max(largestDecrease, -delta);
          } else if (delta > 0) {
            advances.push(delta);
            allAdvances.push(delta);
          }
          largestJump = Math.max(largestJump, Math.abs(delta));
        }
        previousSequence = sequence;
        if (isTracked) recordTrackedProgress(capture, tracked, snapshot.capturedAt, sequence, topology, wrapAround);
      }

      if (hasCoordinates(observation)) coordinateSamples += 1;
      if (previousObservation) {
        const movedCoordinates = coordinatesChanged(previousObservation, observation);
        const movedSequence = observation.stopSequence !== previousObservation.stopSequence;
        if (movedCoordinates) {
          coordinateChanges += 1;
          if (!movedSequence) coordinateChangeWithoutSequenceChange += 1;
        } else if (movedSequence && hasCoordinates(observation) && hasCoordinates(previousObservation)) {
          sequenceChangeWithoutCoordinateChange += 1;
        }
      }
      previousObservation = observation;
    });

    // Measured from the first sighting, so a vehicle that entered service late is
    // not scored down for the snapshots taken before it existed on the route.
    const observableSnapshots = firstSeenIndex === undefined ? 0 : successful.length - firstSeenIndex;
    const presenceRatio = observableSnapshots > 0 ? round(seen / observableSnapshots) : 0;
    if (isTracked) {
      tracked.present = seen > 0;
      tracked.presenceRatio = presenceRatio;
      tracked.firstSeenAt = firstSeenAt || undefined;
      tracked.lastSeenAt = lastSeenAt || undefined;
      if (decreases > 0) warnings.push(`Tracked vehicle stop sequence decreased ${decreases} time(s)`);
    }
    return {
      label,
      isTracked,
      firstSeenAt,
      lastSeenAt,
      snapshotsSeen: seen,
      presenceRatio,
      contentChanges,
      contentChangeIntervalSeconds: summarize(contentChanges.map((change) => change.secondsSincePreviousChange!).filter(Number.isFinite)),
      contentAgeSeconds: summarize(ages),
      sequenceDecreaseCount: decreases,
      largestSequenceJump: largestJump,
      largestSequenceDecrease: largestDecrease,
      sequenceAdvances: summarize(advances),
      gpsEvidence: {
        coordinateSamples,
        coordinateChanges,
        coordinateChangeWithoutSequenceChange,
        sequenceChangeWithoutCoordinateChange,
      },
      gaps,
    };
  }).sort((a, b) => Number(b.isTracked) - Number(a.isTracked) || b.snapshotsSeen - a.snapshotsSeen || a.label.localeCompare(b.label));

  tracked.markerComparisons = compareMarkers(capture, successful, boarded);
  if (tracked.present && !tracked.arrivalDetectedAt) warnings.push("Tracked vehicle never reached the destination sequence in the capture");

  const sequences = capture.stops.map((stop) => stop.sequence).sort((a, b) => a - b);
  const startedAt = Date.parse(capture.startedAt);
  const endedAt = Date.parse(capture.endedAt ?? snapshots.at(-1)?.capturedAt ?? capture.startedAt);
  const configuredIntervalSeconds = round(capture.intervalMs / 1_000);
  const collectionIntervalSeconds = summarize(positiveDiffSeconds(snapshots.map((snapshot) => snapshot.capturedAt)));
  const markerLags = tracked.markerComparisons
    .map((comparison) => comparison.providerLagSeconds)
    .filter((value): value is number => Number.isFinite(value));

  const integrity = inspectIntegrity(capture, snapshots, startedAt, endedAt);
  warnings.push(...describeIntegrity(integrity));
  warnings.push(...describeLifecycle(summarizeLifecycle(capture, endedAt)));
  if (collectionIntervalSeconds.max !== undefined && collectionIntervalSeconds.max > configuredIntervalSeconds * 3) {
    warnings.push(`Polling stalled: longest gap between snapshots was ${collectionIntervalSeconds.max} s against a ${configuredIntervalSeconds} s interval`);
  }

  const report: RideCaptureReport = {
    schemaVersion: capture.schemaVersion,
    routeId: capture.routeId,
    cityCode: capture.cityCode,
    boardingStopSequence: capture.boardingStopSequence,
    destinationStopSequence: capture.destinationStopSequence,
    startedAt: capture.startedAt,
    endedAt: capture.endedAt,
    durationSeconds: round(Math.max(0, endedAt - startedAt) / 1_000),
    captureEngine: capture.captureEngine ?? (capture.source === "cli" ? "cli" : "unknown"),
    configuredIntervalSeconds,
    snapshotCount: snapshots.length,
    failedSnapshotCount: snapshots.length - successful.length,
    emptySnapshotCount: successful.filter((snapshot) => snapshot.vehicles.length === 0).length,
    collectionIntervalSeconds,
    uniqueVehicleCount: order.length,
    stopCount: capture.stops.length,
    stopSequenceContiguous: sequences.every((sequence, index) => index === 0 || sequence === sequences[index - 1]! + 1),
    topology: { ...topology, wrapAround },
    vehicles,
    tracked,
    lifecycle: summarizeLifecycle(capture, endedAt),
    integrity,
    evidenceCompleteness: assessEvidence(successful.length, tracked, allChangeIntervals.length, markerLags.length),
    // Replayed with the same pseudonyms the rest of the report uses, so the
    // identifier guard below covers it without a special case.
    matchGate: replayMatching(capture, { labels, ...(boarded ? { boardedVehicleId: boarded } : {}) }),
    freshnessEvidence: {
      contentChangeIntervalSeconds: summarize(allChangeIntervals),
      contentAgeSeconds: summarize(allContentAges),
      longestUnchangedRunSeconds: longestUnchangedRun,
      gapSeconds: summarize(allGapSeconds),
      sequenceAdvanceStops: summarize(allAdvances),
      markerLagSeconds: summarize(markerLags),
    },
    warnings,
  };
  assertNoVehicleIdentifiers(report, boarded ? [...order, boarded] : order);
  return report;
}

/**
 * Counts what would make the capture file itself untrustworthy. Analysis still
 * runs — a flawed capture with the flaw stated beats a silently repaired one.
 */
function inspectIntegrity(
  capture: RideCapture,
  sorted: RideSnapshot[],
  startedAt: number,
  endedAt: number,
): RideCaptureIntegrity {
  let snapshotsOutOfOrder = 0;
  for (let index = 1; index < capture.snapshots.length; index += 1) {
    const previous = Date.parse(capture.snapshots[index - 1]!.capturedAt);
    const current = Date.parse(capture.snapshots[index]!.capturedAt);
    if (Number.isFinite(previous) && Number.isFinite(current) && current < previous) snapshotsOutOfOrder += 1;
  }

  let duplicateSnapshotTimestamps = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]!.capturedAt === sorted[index - 1]!.capturedAt) duplicateSnapshotTimestamps += 1;
  }

  let duplicateVehicleObservations = 0;
  let foreignRouteObservations = 0;
  let offTopologyObservations = 0;
  const knownSequences = new Set(capture.stops.map((stop) => stop.sequence));
  for (const snapshot of sorted) {
    const seen = new Set<string>();
    for (const vehicle of snapshot.vehicles) {
      if (seen.has(vehicle.vehicleId)) duplicateVehicleObservations += 1;
      seen.add(vehicle.vehicleId);
      if (vehicle.routeId && vehicle.routeId !== capture.routeId) foreignRouteObservations += 1;
      if (vehicle.stopSequence !== undefined && !knownSequences.has(vehicle.stopSequence)) offTopologyObservations += 1;
    }
  }

  let markersOutOfOrder = 0;
  let markersOutsideCaptureWindow = 0;
  capture.markers.forEach((marker, index) => {
    const at = Date.parse(marker.at);
    if (!Number.isFinite(at)) {
      markersOutsideCaptureWindow += 1;
      return;
    }
    if (index > 0) {
      const previous = Date.parse(capture.markers[index - 1]!.at);
      if (Number.isFinite(previous) && at < previous) markersOutOfOrder += 1;
    }
    if (at < startedAt || at > endedAt) markersOutsideCaptureWindow += 1;
  });

  return {
    snapshotsOutOfOrder,
    duplicateSnapshotTimestamps,
    duplicateVehicleObservations,
    markersOutOfOrder,
    markersOutsideCaptureWindow,
    foreignRouteObservations,
    offTopologyObservations,
  };
}

/**
 * Pairs `hidden`/`visible` and `offline`/`online` into closed periods. An
 * unpaired opening period is closed at the end of the capture rather than
 * dropped, because a capture that ended while suspended is precisely the case
 * worth seeing.
 */
function summarizeLifecycle(capture: RideCapture, endedAt: number): RideCaptureLifecycle {
  const events = [...(capture.events ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const spans = (open: RideEventKind, close: RideEventKind): { periods: number; seconds: number } => {
    let periods = 0;
    let seconds = 0;
    let openedAt: number | undefined;
    for (const event of events) {
      const at = Date.parse(event.at);
      if (!Number.isFinite(at)) continue;
      if (event.kind === open && openedAt === undefined) openedAt = at;
      else if (event.kind === close && openedAt !== undefined) {
        periods += 1;
        seconds += Math.max(0, (at - openedAt) / 1_000);
        openedAt = undefined;
      }
    }
    if (openedAt !== undefined) {
      periods += 1;
      seconds += Math.max(0, (endedAt - openedAt) / 1_000);
    }
    return { periods, seconds: round(seconds) };
  };

  const hidden = spans("hidden", "visible");
  const offline = spans("offline", "online");
  return {
    source: capture.source ?? "unknown",
    eventCount: events.length,
    hiddenPeriods: hidden.periods,
    hiddenSeconds: hidden.seconds,
    offlinePeriods: offline.periods,
    offlineSeconds: offline.seconds,
    recoveries: events.filter((event) => event.kind === "resumed").length,
    wakeLockUnavailable: events.some((event) => event.kind === "wake_lock_unavailable"),
  };
}

function describeLifecycle(lifecycle: RideCaptureLifecycle): string[] {
  const messages: string[] = [];
  if (lifecycle.hiddenPeriods > 0) {
    messages.push(`Instrument gap: the capture was backgrounded ${lifecycle.hiddenPeriods} time(s) for ${lifecycle.hiddenSeconds} s in total; those holes are the recorder's, not the provider's`);
  }
  if (lifecycle.offlinePeriods > 0) {
    messages.push(`Instrument gap: the device was offline ${lifecycle.offlinePeriods} time(s) for ${lifecycle.offlineSeconds} s in total; those holes are the recorder's, not the provider's`);
  }
  if (lifecycle.recoveries > 0) {
    messages.push(`The capture was recovered ${lifecycle.recoveries} time(s) after a reload`);
  }
  return messages;
}

function describeIntegrity(integrity: RideCaptureIntegrity): string[] {
  const messages: Array<[number, string]> = [
    [integrity.snapshotsOutOfOrder, "snapshot(s) stored out of chronological order"],
    [integrity.duplicateSnapshotTimestamps, "snapshot(s) share a capture timestamp"],
    [integrity.duplicateVehicleObservations, "duplicate vehicle observation(s) inside one snapshot"],
    [integrity.markersOutOfOrder, "marker(s) stored out of chronological order"],
    [integrity.markersOutsideCaptureWindow, "marker(s) fall outside the capture window"],
    [integrity.foreignRouteObservations, "observation(s) belong to another route"],
    [integrity.offTopologyObservations, "observation(s) report a stop the captured topology does not contain — the route may have changed mid-ride"],
  ];
  return messages.filter(([count]) => count > 0).map(([count, text]) => `Capture integrity: ${count} ${text}`);
}

/**
 * Sample-size preconditions only. Each minimum is what a distribution needs to
 * exist at all; none of them is a freshness threshold, which Task C derives.
 */
function assessEvidence(
  successfulSnapshots: number,
  tracked: TrackedVehicleReport,
  contentChangeSamples: number,
  markerLagSamples: number,
): EvidenceCompleteness {
  const distinctSequences = new Set(tracked.remainingStopsTimeline.map((entry) => entry.stopSequence)).size;
  const criteria: EvidenceCriterion[] = [
    {
      name: "trackedVehiclePresent",
      required: true,
      observed: tracked.present ? 1 : 0,
      minimum: 1,
      met: tracked.present,
      note: "The boarded vehicle must appear in the snapshots or nothing can be compared",
    },
    {
      name: "successfulSnapshots",
      required: true,
      observed: successfulSnapshots,
      minimum: 20,
      met: successfulSnapshots >= 20,
      note: "Snapshots that returned data, the base of every interval measurement",
    },
    {
      name: "trackedSequenceProgression",
      required: true,
      observed: distinctSequences,
      minimum: 3,
      met: distinctSequences >= 3,
      note: "Distinct nodeord values reported for the tracked vehicle",
    },
    {
      name: "contentChangeSamples",
      required: true,
      observed: contentChangeSamples,
      minimum: 5,
      met: contentChangeSamples >= 5,
      note: "Content-change intervals available for a cadence distribution",
    },
    {
      name: "markerLagSamples",
      required: true,
      observed: markerLagSamples,
      minimum: 3,
      met: markerLagSamples >= 3,
      note: "Physical markers the provider was observed to reach, for a lag distribution",
    },
    {
      name: "arrivalObserved",
      required: false,
      observed: tracked.arrivalDetectedAt ? 1 : 0,
      minimum: 1,
      met: Boolean(tracked.arrivalDetectedAt),
      note: "Whether the capture ran long enough to see the destination reported",
    },
  ];
  const unmetRequired = criteria.filter((criterion) => criterion.required && !criterion.met).map((criterion) => criterion.name);
  return {
    verdict: unmetRequired.length === 0 ? "SUFFICIENT" : "INSUFFICIENT_EVIDENCE",
    criteria,
    unmetRequired,
  };
}

function hasCoordinates(observation: VehicleObservation): boolean {
  return Number.isFinite(observation.latitude) && Number.isFinite(observation.longitude);
}

function coordinatesChanged(previous: VehicleObservation, current: VehicleObservation): boolean {
  if (!hasCoordinates(previous) || !hasCoordinates(current)) return false;
  return previous.latitude !== current.latitude || previous.longitude !== current.longitude;
}

function recordTrackedProgress(
  capture: RideCapture,
  tracked: TrackedVehicleReport,
  at: string,
  sequence: number,
  topology: RouteTopology,
  wrapAround: boolean,
): void {
  const remaining = wrapAround
    ? forwardStopDistance(sequence, capture.destinationStopSequence, topology, true)
    : Math.max(0, capture.destinationStopSequence - sequence);
  const last = tracked.remainingStopsTimeline.at(-1);
  if (!last || last.stopSequence !== sequence) {
    tracked.remainingStopsTimeline.push({ at, stopSequence: sequence, remainingStops: remaining });
  }
  const pastBoarding = wrapAround
    ? forwardStopDistance(capture.boardingStopSequence, sequence, topology, true) > 0
    : sequence > capture.boardingStopSequence;
  if (!tracked.passedBoardingAt && pastBoarding) tracked.passedBoardingAt = at;
  const arrived = wrapAround ? remaining === 0 : sequence >= capture.destinationStopSequence;
  if (!tracked.arrivalDetectedAt && arrived) tracked.arrivalDetectedAt = at;
  // Overshoot on a closed route is indistinguishable from a second lap, so it is
  // reported only where it can actually be told apart.
  if (!wrapAround && sequence > capture.destinationStopSequence) tracked.passedDestination = true;
}

/** Signed shortest step around a closed route: +2 forward, or −1 back over the seam. */
function shortestArc(from: number, to: number, topology: RouteTopology): number {
  const modulus = Math.max(1, topology.cycleLength);
  const forward = forwardStopDistance(from, to, topology, true);
  return forward * 2 > modulus ? forward - modulus : forward;
}

function compareMarkers(capture: RideCapture, successful: RideSnapshot[], boarded: string | undefined): MarkerComparison[] {
  return [...capture.markers]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((marker) => {
      const comparison: MarkerComparison = { kind: marker.kind, markedAt: marker.at, stopSequence: marker.stopSequence };
      const target = marker.kind === "alighted" ? capture.destinationStopSequence : marker.stopSequence;
      if (!boarded || target === undefined || marker.kind === "note" || marker.kind === "boarded") return comparison;
      const reached = successful.find((snapshot) => {
        const observation = snapshot.vehicles.find((vehicle) => vehicle.vehicleId === boarded);
        return observation?.stopSequence !== undefined && observation.stopSequence >= target;
      });
      if (reached) {
        comparison.providerReachedAt = reached.capturedAt;
        comparison.providerLagSeconds = round((Date.parse(reached.capturedAt) - Date.parse(marker.at)) / 1_000);
      }
      return comparison;
    });
}

function assertNoVehicleIdentifiers(report: RideCaptureReport, vehicleIds: string[]): void {
  const encoded = JSON.stringify(report);
  for (const vehicleId of vehicleIds) {
    if (vehicleId.length >= 4 && encoded.includes(vehicleId)) {
      throw new RideCaptureInputError("Report would expose a raw vehicle identifier; refusing output");
    }
  }
}

function contentSignature(observation: VehicleObservation): string {
  return JSON.stringify([
    observation.stopSequence,
    observation.stopId,
    observation.latitude,
    observation.longitude,
    observation.directionCode,
  ]);
}

function positiveDiffSeconds(timestamps: string[]): number[] {
  const values = timestamps.map(Date.parse).filter(Number.isFinite);
  const result: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const delta = (values[index]! - values[index - 1]!) / 1_000;
    if (delta > 0) result.push(delta);
  }
  return result;
}
