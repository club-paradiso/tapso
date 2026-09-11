import type { StopOnRoute, VehicleObservation } from "./domain.ts";

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

export const RIDE_CAPTURE_SCHEMA_VERSION = 1;

export type RideMarkerKind = "boarded" | "passed_stop" | "alighted" | "note";

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
}

export interface NumberSummary {
  count: number;
  min?: number;
  median?: number;
  p95?: number;
  max?: number;
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

export interface VehicleTimeline {
  /** Per-run pseudonym such as `V1`; `tracked` for the boarded vehicle. */
  label: string;
  isTracked: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  snapshotsSeen: number;
  contentChanges: SequenceChange[];
  contentChangeIntervalSeconds: NumberSummary;
  /** Seconds since last content change, sampled at every successful snapshot after the first sighting. */
  contentAgeSeconds: NumberSummary;
  sequenceDecreaseCount: number;
  largestSequenceJump: number;
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
  firstSeenAt?: string;
  lastSeenAt?: string;
  remainingStopsTimeline: Array<{ at: string; stopSequence: number; remainingStops: number }>;
  passedBoardingAt?: string;
  arrivalDetectedAt?: string;
  passedDestination: boolean;
  missedSnapshotCount: number;
  markerComparisons: MarkerComparison[];
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
  snapshotCount: number;
  failedSnapshotCount: number;
  emptySnapshotCount: number;
  collectionIntervalSeconds: NumberSummary;
  uniqueVehicleCount: number;
  stopCount: number;
  stopSequenceContiguous: boolean;
  vehicles: VehicleTimeline[];
  tracked: TrackedVehicleReport;
  /** Aggregate over all vehicles; input for a freshness rule, not the rule. */
  freshnessEvidence: {
    contentChangeIntervalSeconds: NumberSummary;
    contentAgeSeconds: NumberSummary;
    longestUnchangedRunSeconds?: number;
    gapSeconds: NumberSummary;
  };
  warnings: string[];
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
  if (capture.boardingStopSequence >= capture.destinationStopSequence) {
    throw new RideCaptureInputError("destinationStopSequence must be after boardingStopSequence");
  }
  for (const marker of capture.markers) {
    if (marker.kind === "passed_stop" && (!Number.isInteger(marker.stopSequence) || !sequences.has(marker.stopSequence!))) {
      throw new RideCaptureInputError("passed_stop markers must name an official stop sequence");
    }
  }
}

export function analyzeRideCapture(capture: RideCapture): RideCaptureReport {
  validateRideCapture(capture);
  const warnings: string[] = [];
  const snapshots = [...capture.snapshots].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const successful = snapshots.filter((snapshot) => !snapshot.error);
  const boarded = capture.boardedVehicleId?.trim();
  const tracked: TrackedVehicleReport = {
    present: false,
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
    let seen = 0;

    successful.forEach((snapshot, index) => {
      const observation = snapshot.vehicles.find((vehicle) => vehicle.vehicleId === vehicleId);
      const at = Date.parse(snapshot.capturedAt);
      if (!observation) {
        if (isTracked && firstSeenAt) tracked.missedSnapshotCount += 1;
        return;
      }
      seen += 1;
      if (!firstSeenAt) firstSeenAt = snapshot.capturedAt;
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
          if (sequence < previousSequence) decreases += 1;
          largestJump = Math.max(largestJump, Math.abs(sequence - previousSequence));
        }
        previousSequence = sequence;
        if (isTracked) recordTrackedProgress(capture, tracked, snapshot.capturedAt, sequence);
      }
    });

    if (isTracked) {
      tracked.present = seen > 0;
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
      contentChanges,
      contentChangeIntervalSeconds: summarize(contentChanges.map((change) => change.secondsSincePreviousChange!).filter(Number.isFinite)),
      contentAgeSeconds: summarize(ages),
      sequenceDecreaseCount: decreases,
      largestSequenceJump: largestJump,
      gaps,
    };
  }).sort((a, b) => Number(b.isTracked) - Number(a.isTracked) || b.snapshotsSeen - a.snapshotsSeen || a.label.localeCompare(b.label));

  tracked.markerComparisons = compareMarkers(capture, successful, boarded);
  if (tracked.present && !tracked.arrivalDetectedAt) warnings.push("Tracked vehicle never reached the destination sequence in the capture");

  const sequences = capture.stops.map((stop) => stop.sequence).sort((a, b) => a - b);
  const startedAt = Date.parse(capture.startedAt);
  const endedAt = Date.parse(capture.endedAt ?? snapshots.at(-1)?.capturedAt ?? capture.startedAt);
  const report: RideCaptureReport = {
    schemaVersion: capture.schemaVersion,
    routeId: capture.routeId,
    cityCode: capture.cityCode,
    boardingStopSequence: capture.boardingStopSequence,
    destinationStopSequence: capture.destinationStopSequence,
    startedAt: capture.startedAt,
    endedAt: capture.endedAt,
    durationSeconds: round(Math.max(0, endedAt - startedAt) / 1_000),
    snapshotCount: snapshots.length,
    failedSnapshotCount: snapshots.length - successful.length,
    emptySnapshotCount: successful.filter((snapshot) => snapshot.vehicles.length === 0).length,
    collectionIntervalSeconds: summarize(positiveDiffSeconds(snapshots.map((snapshot) => snapshot.capturedAt))),
    uniqueVehicleCount: order.length,
    stopCount: capture.stops.length,
    stopSequenceContiguous: sequences.every((sequence, index) => index === 0 || sequence === sequences[index - 1]! + 1),
    vehicles,
    tracked,
    freshnessEvidence: {
      contentChangeIntervalSeconds: summarize(allChangeIntervals),
      contentAgeSeconds: summarize(allContentAges),
      longestUnchangedRunSeconds: longestUnchangedRun,
      gapSeconds: summarize(allGapSeconds),
    },
    warnings,
  };
  assertNoVehicleIdentifiers(report, order);
  return report;
}

function recordTrackedProgress(capture: RideCapture, tracked: TrackedVehicleReport, at: string, sequence: number): void {
  const remaining = Math.max(0, capture.destinationStopSequence - sequence);
  const last = tracked.remainingStopsTimeline.at(-1);
  if (!last || last.stopSequence !== sequence) {
    tracked.remainingStopsTimeline.push({ at, stopSequence: sequence, remainingStops: remaining });
  }
  if (!tracked.passedBoardingAt && sequence > capture.boardingStopSequence) tracked.passedBoardingAt = at;
  if (!tracked.arrivalDetectedAt && sequence >= capture.destinationStopSequence) tracked.arrivalDetectedAt = at;
  if (sequence > capture.destinationStopSequence) tracked.passedDestination = true;
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

export function summarize(values: number[]): NumberSummary {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0 };
  return {
    count: sorted.length,
    min: round(sorted[0]!),
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1)!),
  };
}

function percentile(sorted: number[], quantile: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
