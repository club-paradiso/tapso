/**
 * Passive Shadow Validation v3 — observation streams, trajectories, and the
 * pseudo-boarding case generator.
 *
 * A passive stream is what a collector saw on one route with no rider at all.
 * This module turns real vehicle trajectories in such a stream into
 * pseudo-boarding cases and splits every case, at birth, into two objects:
 *
 *   PassiveMatcherInput  — what a session would have had: route, stops, the
 *                          boarding stop, and the provider snapshots. No answer.
 *   PassiveGroundTruth   — which vehicle the rider would have boarded, held in a
 *                          `GroundTruthVault` that only the evaluator opens,
 *                          and only after the matcher has been replayed.
 *
 * The ground truth is a *model*, not an observation: a rider waiting at stop S
 * from T0 boards the first vehicle of the route to reach S after T0. Every case
 * says so in `groundTruth.source`. Where the trajectory cannot establish that
 * vehicle beyond doubt the generator refuses the case and counts the reason;
 * it never guesses.
 *
 * Nothing here scores, ranks or selects a vehicle. The matcher is replayed by
 * `passiveShadowEvaluate.ts` through the canonical `replayMatching`.
 */

import { createHash } from "node:crypto";

import type { StopOnRoute, VehicleObservation } from "./domain.ts";
import { RIDE_CAPTURE_SCHEMA_VERSION, type RideCapture, type RideSnapshot } from "./rideCapture.ts";

export const PASSIVE_SHADOW_POLICY_VERSION = "passive-shadow-validation-v3";
export const PASSIVE_SHADOW_CAMPAIGN_ID = "passive-shadow-validation-v3";
export const PASSIVE_SHADOW_SCHEMA_VERSION = 1;

/**
 * Where evidence came from. Only `LIVE_PASSIVE` may ever enter a live count;
 * `SYNTHETIC_OR_PERTURBED` exists so robustness runs can be reported without
 * ever being mistaken for field evidence.
 */
export type PassiveSourceClass =
  | "LIVE_PASSIVE"
  | "HISTORICAL_REAL"
  | "HISTORICAL_REPORT_ONLY"
  | "SYNTHETIC_OR_PERTURBED";

/**
 * How the collector reached the provider. `tago-direct` is the uncached
 * `TagoTransitProvider`, the same read a journey session and the Railway
 * collector make. `tapso-public-api` is TAPSO's own public `/v1/vehicles`,
 * which sits behind a 20 s shared cache, so its receipt cadence is coarser.
 * `synthetic` is anything a test invented.
 */
export type PassiveProviderPath = "tago-direct" | "tapso-public-api" | "synthetic";

export function sourceClassFor(path: PassiveProviderPath): PassiveSourceClass {
  return path === "synthetic" ? "SYNTHETIC_OR_PERTURBED" : "LIVE_PASSIVE";
}

/** One route, observed with no rider. Raw vehicle numbers: keep under `work/`. */
export interface PassiveObservationStream {
  schemaVersion: typeof PASSIVE_SHADOW_SCHEMA_VERSION;
  policyVersion: typeof PASSIVE_SHADOW_POLICY_VERSION;
  sourceClass: PassiveSourceClass;
  /** The capture id every case and result points back to. */
  streamId: string;
  /** The collection session (one collector run covers several routes). */
  collectionId: string;
  providerPath: PassiveProviderPath;
  collectorEngine: string;
  routeId: string;
  cityCode: string;
  stops: StopOnRoute[];
  intervalMs: number;
  startedAt: string;
  endedAt?: string;
  snapshots: RideSnapshot[];
  /** Genuine receipts only. A cached re-serve of the same receipt is dropped and counted here. */
  duplicateReceiptsDropped: number;
  /** Set when a stop condition ended collection early. */
  stopReason?: string;
}

export type PassiveScenario = "WAIT_AT_STOP" | "ON_BOARD_START";

export interface PassiveCaseGeneratorPolicy {
  /** WAIT_AT_STOP session starts are laid on this grid, independent of any vehicle. */
  startGridMs: number;
  maxWaitMs: number;
  /** How long the session keeps evaluating after the ground-truth vehicle reaches the stop. */
  postBoardingMs: number;
  /** The two sightings bracketing the crossing may be at most this far apart. */
  maxCrossingBracketMs: number;
  /** Stops skipped across the crossing bracket. */
  maxCrossingJump: number;
  /** An absence this long splits a vehicle into two trajectories. */
  trajectoryBreakAbsenceMs: number;
  /** A stop-sequence decrease larger than this starts a new trip. */
  trajectoryBreakDecrease: number;
  /** Stops ahead of the boarding stop used as the session destination. */
  destinationOffset: number;
}

/**
 * Version 1 generator policy. Every number is a case-construction choice, not
 * a matcher threshold: none of them is read by the matcher, and none relaxes
 * anything in `sourceFreshness.ts` or `matching.ts`.
 */
export const PASSIVE_CASE_POLICY_V1: PassiveCaseGeneratorPolicy = {
  startGridMs: 120_000,
  maxWaitMs: 20 * 60_000,
  postBoardingMs: 5 * 60_000,
  maxCrossingBracketMs: 90_000,
  maxCrossingJump: 3,
  trajectoryBreakAbsenceMs: 120_000,
  trajectoryBreakDecrease: 2,
  destinationOffset: 6,
};

export interface Sighting {
  at: number;
  capturedAt: string;
  stopSequence?: number;
  directionCode?: string;
}

export interface Trajectory {
  trajectoryId: string;
  streamId: string;
  vehicleId: string;
  sightings: Sighting[];
}

export interface Crossing {
  trajectoryId: string;
  vehicleId: string;
  stopSequence: number;
  /** Last sighting before the stop. */
  prevAt: number;
  /** First sighting at or past the stop: the modelled boarding instant. */
  nextAt: number;
  jump: number;
}

/**
 * Exactly what a session would have had. The allowed keys are enumerated in
 * `BLIND_INPUT_KEYS` and enforced by `assertBlindMatcherInput`; adding a field
 * here without adding it there fails every evaluation.
 */
export interface PassiveMatcherInput {
  schemaVersion: number;
  startedAt: string;
  endedAt: string;
  routeId: string;
  cityCode: string;
  boardingStopSequence: number;
  destinationStopSequence: number;
  intervalMs: number;
  stops: StopOnRoute[];
  snapshots: RideSnapshot[];
  markers: [];
}

export const BLIND_INPUT_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "startedAt",
  "endedAt",
  "routeId",
  "cityCode",
  "boardingStopSequence",
  "destinationStopSequence",
  "intervalMs",
  "stops",
  "snapshots",
  "markers",
]);

const BLIND_SNAPSHOT_KEYS: ReadonlySet<string> = new Set(["capturedAt", "vehicles", "error"]);

/** Everything about a case that is not the answer. Safe to hand to anyone. */
export interface PassiveCaseMeta {
  caseId: string;
  streamId: string;
  collectionId: string;
  sourceClass: PassiveSourceClass;
  scenario: PassiveScenario;
  routeId: string;
  cityCode: string;
  boardingSequence: number;
  sessionStartAt: string;
  windowEndAt: string;
  /** Distinct boarding event (trajectory × stop) the case scores against. */
  boardingEventId: string;
  trajectoryId: string;
}

export interface PassiveGroundTruth {
  caseId: string;
  vehicleId: string;
  source: "passive_first_arrival_model";
  confidence: "bracketed_crossing";
  provenance: {
    streamId: string;
    collectionId: string;
    trajectoryId: string;
    crossingPrevAt: string;
    crossingNextAt: string;
    crossingJump: number;
    stopSequence: number;
  };
}

/**
 * Ground truth lives here and nowhere else. The generator deposits; only
 * `reveal` reads, and the evaluator calls it after replay.
 */
export class GroundTruthVault {
  private readonly truths = new Map<string, PassiveGroundTruth>();
  private readonly revealed = new Set<string>();

  deposit(truth: PassiveGroundTruth): void {
    if (this.truths.has(truth.caseId)) throw new Error(`ground truth for ${truth.caseId} already deposited`);
    this.truths.set(truth.caseId, truth);
  }

  reveal(caseId: string): PassiveGroundTruth {
    const truth = this.truths.get(caseId);
    if (!truth) throw new Error(`no ground truth for ${caseId}`);
    this.revealed.add(caseId);
    return truth;
  }

  has(caseId: string): boolean {
    return this.truths.has(caseId);
  }

  wasRevealed(caseId: string): boolean {
    return this.revealed.has(caseId);
  }

  get size(): number {
    return this.truths.size;
  }

  /** For the sensitive `work/` bundle only. Never for a sanitized report. */
  export(): PassiveGroundTruth[] {
    return [...this.truths.values()];
  }
}

export interface PassiveCase {
  meta: PassiveCaseMeta;
  input: PassiveMatcherInput;
}

export type GeneratorRejection =
  | "NO_ARRIVAL_OBSERVED"
  | "NO_ARRIVAL_WITHIN_MAX_WAIT"
  | "GT_BRACKET_STRADDLES_START"
  | "GT_ORDER_AMBIGUOUS"
  | "GT_BRACKET_TOO_WIDE"
  | "GT_JUMP_TOO_LARGE"
  | "GT_IDENTITY_UNCERTAIN"
  | "STREAM_TRUNCATED"
  | "NO_SUCCESSFUL_SNAPSHOT"
  | "DUPLICATE_CASE";

export interface GeneratedCases {
  cases: PassiveCase[];
  vault: GroundTruthVault;
  trajectories: Trajectory[];
  rejections: Record<GeneratorRejection, number>;
}

/* ------------------------------------------------------------ trajectories */

export function sortedSnapshots(stream: Pick<PassiveObservationStream, "snapshots">): RideSnapshot[] {
  return [...stream.snapshots]
    .filter((snapshot) => Number.isFinite(Date.parse(snapshot.capturedAt)))
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
}

/**
 * Per-vehicle runs through the stream. A long absence or a real decrease in
 * stop sequence ends a run: the same bus on its next trip is a different
 * trajectory, and treating it as one would let a case score against a trip the
 * rider could not have been on.
 */
export function extractTrajectories(
  stream: PassiveObservationStream,
  policy: PassiveCaseGeneratorPolicy = PASSIVE_CASE_POLICY_V1,
): Trajectory[] {
  const byVehicle = new Map<string, Sighting[]>();
  for (const snapshot of sortedSnapshots(stream)) {
    if (snapshot.error) continue;
    const at = Date.parse(snapshot.capturedAt);
    const seen = new Set<string>();
    for (const vehicle of snapshot.vehicles) {
      if (vehicle.routeId !== stream.routeId || seen.has(vehicle.vehicleId)) continue;
      seen.add(vehicle.vehicleId);
      const list = byVehicle.get(vehicle.vehicleId) ?? [];
      list.push({
        at,
        capturedAt: snapshot.capturedAt,
        ...(Number.isFinite(vehicle.stopSequence) ? { stopSequence: vehicle.stopSequence } : {}),
        ...(vehicle.directionCode ? { directionCode: vehicle.directionCode } : {}),
      });
      byVehicle.set(vehicle.vehicleId, list);
    }
  }

  const trajectories: Trajectory[] = [];
  const vehicles = [...byVehicle.keys()].sort();
  for (const vehicleId of vehicles) {
    const sightings = byVehicle.get(vehicleId)!;
    let current: Sighting[] = [];
    let lastSequence: number | undefined;
    const flush = () => {
      if (current.length === 0) return;
      trajectories.push({
        trajectoryId: `${stream.streamId}:t${trajectories.length + 1}`,
        streamId: stream.streamId,
        vehicleId,
        sightings: current,
      });
      current = [];
      lastSequence = undefined;
    };
    for (const sighting of sightings) {
      const previous = current.at(-1);
      const absent = previous !== undefined && sighting.at - previous.at > policy.trajectoryBreakAbsenceMs;
      const newTrip = lastSequence !== undefined
        && sighting.stopSequence !== undefined
        && lastSequence - sighting.stopSequence > policy.trajectoryBreakDecrease;
      if (absent || newTrip) flush();
      current.push(sighting);
      if (sighting.stopSequence !== undefined) lastSequence = sighting.stopSequence;
    }
    flush();
  }
  return trajectories;
}

/** The first bracketed crossing of `stopSequence` in one trajectory, if any. */
export function findCrossing(trajectory: Trajectory, stopSequence: number): Crossing | undefined {
  const positioned = trajectory.sightings.filter((sighting) => sighting.stopSequence !== undefined);
  for (let index = 1; index < positioned.length; index += 1) {
    const previous = positioned[index - 1]!;
    const next = positioned[index]!;
    if (previous.stopSequence! < stopSequence && next.stopSequence! >= stopSequence) {
      return {
        trajectoryId: trajectory.trajectoryId,
        vehicleId: trajectory.vehicleId,
        stopSequence,
        prevAt: previous.at,
        nextAt: next.at,
        jump: next.stopSequence! - previous.stopSequence!,
      };
    }
  }
  return undefined;
}

/* --------------------------------------------------------- ground truth */

type TruthDecision =
  | { ok: true; crossing: Crossing }
  | { ok: false; reason: GeneratorRejection };

/**
 * Who a rider at `stopSequence` from `startAt` boards under the first-arrival
 * model — or the reason nobody can say.
 */
export function firstArrivalAfter(
  trajectories: Trajectory[],
  crossings: Crossing[],
  stopSequence: number,
  startAt: number,
  policy: PassiveCaseGeneratorPolicy,
): TruthDecision {
  if (crossings.some((crossing) => crossing.prevAt < startAt && crossing.nextAt > startAt)) {
    return { ok: false, reason: "GT_BRACKET_STRADDLES_START" };
  }
  const after = crossings
    .filter((crossing) => crossing.prevAt >= startAt)
    .sort((left, right) => left.nextAt - right.nextAt || left.prevAt - right.prevAt);
  const first = after[0];
  if (!first) return { ok: false, reason: "NO_ARRIVAL_OBSERVED" };
  if (first.nextAt - startAt > policy.maxWaitMs) return { ok: false, reason: "NO_ARRIVAL_WITHIN_MAX_WAIT" };
  return qualify(trajectories, after, first, stopSequence, startAt, policy);
}

function qualify(
  trajectories: Trajectory[],
  crossings: Crossing[],
  chosen: Crossing,
  stopSequence: number,
  intervalStart: number,
  policy: PassiveCaseGeneratorPolicy,
): TruthDecision {
  if (chosen.nextAt - chosen.prevAt > policy.maxCrossingBracketMs) return { ok: false, reason: "GT_BRACKET_TOO_WIDE" };
  if (chosen.jump > policy.maxCrossingJump) return { ok: false, reason: "GT_JUMP_TOO_LARGE" };
  const overlapping = crossings.some(
    (crossing) => crossing !== chosen && crossing.prevAt < chosen.nextAt && crossing.nextAt > chosen.prevAt,
  );
  if (overlapping) return { ok: false, reason: "GT_ORDER_AMBIGUOUS" };

  // A vehicle the stream never saw cross could still have reached the stop
  // first. Refuse the case whenever that is possible inside the interval.
  for (const trajectory of trajectories) {
    if (trajectory.trajectoryId === chosen.trajectoryId) continue;
    const positioned = trajectory.sightings.filter((sighting) => sighting.stopSequence !== undefined);
    const first = positioned[0];
    const last = positioned.at(-1);
    if (!first || !last) continue;
    const appearedPast = first.at > intervalStart && first.at <= chosen.nextAt && first.stopSequence! >= stopSequence;
    const vanishedBefore = last.at >= intervalStart && last.at < chosen.nextAt && last.stopSequence! < stopSequence;
    if (appearedPast || vanishedBefore) return { ok: false, reason: "GT_IDENTITY_UNCERTAIN" };
  }
  return { ok: true, crossing: chosen };
}

/* ------------------------------------------------------------- generator */

export interface GenerateOptions {
  policy?: PassiveCaseGeneratorPolicy;
  scenarios?: PassiveScenario[];
}

export function generatePassiveCases(
  streams: PassiveObservationStream[],
  options: GenerateOptions = {},
): GeneratedCases {
  const policy = options.policy ?? PASSIVE_CASE_POLICY_V1;
  const scenarios = options.scenarios ?? ["WAIT_AT_STOP", "ON_BOARD_START"];
  const vault = new GroundTruthVault();
  const cases: PassiveCase[] = [];
  const allTrajectories: Trajectory[] = [];
  const rejections = emptyRejections();
  const seen = new Set<string>();

  for (const stream of streams) {
    const snapshots = sortedSnapshots(stream);
    const successful = snapshots.filter((snapshot) => !snapshot.error);
    if (successful.length === 0) {
      rejections.NO_SUCCESSFUL_SNAPSHOT += 1;
      continue;
    }
    const trajectories = extractTrajectories(stream, policy);
    allTrajectories.push(...trajectories);
    const streamStart = Date.parse(snapshots[0]!.capturedAt);
    const streamEnd = Date.parse(snapshots.at(-1)!.capturedAt);
    const sequences = [...new Set(stream.stops.map((stop) => stop.sequence))].sort((a, b) => a - b);
    const lastSequence = sequences.at(-1)!;

    for (const stopSequence of sequences) {
      // A route's first stop is where trips begin, so nothing crosses it; its
      // last is where they end, so nobody boards there.
      if (stopSequence === sequences[0] || stopSequence === lastSequence) continue;
      const crossings = trajectories
        .map((trajectory) => findCrossing(trajectory, stopSequence))
        .filter((crossing): crossing is Crossing => crossing !== undefined);
      const destination = sequences.find((sequence) => sequence >= stopSequence + policy.destinationOffset) ?? lastSequence;

      const starts: Array<{ scenario: PassiveScenario; startAt: number; decision: TruthDecision }> = [];
      if (scenarios.includes("WAIT_AT_STOP")) {
        for (let startAt = streamStart; startAt <= streamEnd; startAt += policy.startGridMs) {
          starts.push({
            scenario: "WAIT_AT_STOP",
            startAt,
            decision: firstArrivalAfter(trajectories, crossings, stopSequence, startAt, policy),
          });
        }
      }
      if (scenarios.includes("ON_BOARD_START")) {
        for (const crossing of crossings) {
          starts.push({
            scenario: "ON_BOARD_START",
            startAt: crossing.nextAt,
            decision: qualify(trajectories, crossings, crossing, stopSequence, crossing.prevAt, policy),
          });
        }
      }

      for (const start of starts) {
        if (!start.decision.ok) {
          rejections[start.decision.reason] += 1;
          continue;
        }
        const crossing = start.decision.crossing;
        const windowEnd = crossing.nextAt + policy.postBoardingMs;
        if (windowEnd > streamEnd) {
          rejections.STREAM_TRUNCATED += 1;
          continue;
        }
        const window = snapshots.filter((snapshot) => {
          const at = Date.parse(snapshot.capturedAt);
          return at >= start.startAt && at <= windowEnd;
        });
        if (!window.some((snapshot) => !snapshot.error)) {
          rejections.NO_SUCCESSFUL_SNAPSHOT += 1;
          continue;
        }
        const dedupeKey = [stream.streamId, start.scenario, stopSequence, window[0]!.capturedAt, crossing.trajectoryId].join("|");
        if (seen.has(dedupeKey)) {
          rejections.DUPLICATE_CASE += 1;
          continue;
        }
        seen.add(dedupeKey);

        const caseId = `${stream.streamId}:${start.scenario === "WAIT_AT_STOP" ? "w" : "b"}:s${stopSequence}:${new Date(start.startAt).toISOString()}`;
        const input: PassiveMatcherInput = {
          schemaVersion: RIDE_CAPTURE_SCHEMA_VERSION,
          startedAt: window[0]!.capturedAt,
          endedAt: window.at(-1)!.capturedAt,
          routeId: stream.routeId,
          cityCode: stream.cityCode,
          boardingStopSequence: stopSequence,
          destinationStopSequence: destination,
          intervalMs: stream.intervalMs,
          stops: stream.stops.map((stop) => ({ ...stop })),
          // Verbatim provider snapshots, in provider order. Nothing is added,
          // reordered or annotated.
          snapshots: window.map(copySnapshot),
          markers: [],
        };
        cases.push({
          meta: {
            caseId,
            streamId: stream.streamId,
            collectionId: stream.collectionId,
            sourceClass: stream.sourceClass,
            scenario: start.scenario,
            routeId: stream.routeId,
            cityCode: stream.cityCode,
            boardingSequence: stopSequence,
            sessionStartAt: new Date(start.startAt).toISOString(),
            windowEndAt: new Date(windowEnd).toISOString(),
            boardingEventId: `${crossing.trajectoryId}:s${stopSequence}`,
            trajectoryId: crossing.trajectoryId,
          },
          input,
        });
        vault.deposit({
          caseId,
          vehicleId: crossing.vehicleId,
          source: "passive_first_arrival_model",
          confidence: "bracketed_crossing",
          provenance: {
            streamId: stream.streamId,
            collectionId: stream.collectionId,
            trajectoryId: crossing.trajectoryId,
            crossingPrevAt: new Date(crossing.prevAt).toISOString(),
            crossingNextAt: new Date(crossing.nextAt).toISOString(),
            crossingJump: crossing.jump,
            stopSequence,
          },
        });
      }
    }
  }
  return { cases, vault, trajectories: allTrajectories, rejections };
}

function copySnapshot(snapshot: RideSnapshot): RideSnapshot {
  return {
    capturedAt: snapshot.capturedAt,
    vehicles: snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
    ...(snapshot.error ? { error: snapshot.error } : {}),
  };
}

export function emptyRejections(): Record<GeneratorRejection, number> {
  return {
    NO_ARRIVAL_OBSERVED: 0,
    NO_ARRIVAL_WITHIN_MAX_WAIT: 0,
    GT_BRACKET_STRADDLES_START: 0,
    GT_ORDER_AMBIGUOUS: 0,
    GT_BRACKET_TOO_WIDE: 0,
    GT_JUMP_TOO_LARGE: 0,
    GT_IDENTITY_UNCERTAIN: 0,
    STREAM_TRUNCATED: 0,
    NO_SUCCESSFUL_SNAPSHOT: 0,
    DUPLICATE_CASE: 0,
  };
}

/* ----------------------------------------------------------- leak guard */

/**
 * Throws unless the input carries exactly the fields a real session would
 * have. This is the structural half of the anti-leakage rule; the other half
 * is that `replayMatching` is never given `boardedVehicleId` (evaluator).
 */
export function assertBlindMatcherInput(input: PassiveMatcherInput): void {
  const record = input as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!BLIND_INPUT_KEYS.has(key)) throw new GroundTruthLeakError(`matcher input carries non-blind field "${key}"`);
  }
  if (!Array.isArray(input.markers) || input.markers.length !== 0) {
    throw new GroundTruthLeakError("matcher input may carry no markers");
  }
  for (const snapshot of input.snapshots) {
    for (const key of Object.keys(snapshot)) {
      if (!BLIND_SNAPSHOT_KEYS.has(key)) throw new GroundTruthLeakError(`snapshot carries non-blind field "${key}"`);
    }
  }
}

export class GroundTruthLeakError extends Error {
  readonly code = "GROUND_TRUTH_LEAK";
}

/** The replay-facing view: a `RideCapture` with no boarded vehicle. */
export function toBlindCapture(input: PassiveMatcherInput): RideCapture {
  assertBlindMatcherInput(input);
  return { ...input, markers: [] };
}

/* ------------------------------------------------------------- hygiene */

/** Stable content hash of a stream's evidence, recorded so later tampering shows. */
export function streamSha256(stream: PassiveObservationStream): string {
  return createHash("sha256").update(canonicalJson({
    routeId: stream.routeId,
    cityCode: stream.cityCode,
    stops: stream.stops,
    snapshots: stream.snapshots,
  })).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validatePassiveStream(stream: PassiveObservationStream): void {
  if (stream.schemaVersion !== PASSIVE_SHADOW_SCHEMA_VERSION) {
    throw new Error(`unsupported passive stream schema ${String(stream.schemaVersion)}`);
  }
  if (stream.policyVersion !== PASSIVE_SHADOW_POLICY_VERSION) {
    throw new Error(`passive stream policy ${String(stream.policyVersion)} is not ${PASSIVE_SHADOW_POLICY_VERSION}`);
  }
  if (sourceClassFor(stream.providerPath) !== stream.sourceClass) {
    throw new Error(`stream ${stream.streamId} claims ${stream.sourceClass} but was collected via ${stream.providerPath}`);
  }
  if (!stream.routeId || !stream.cityCode || !Array.isArray(stream.stops) || stream.stops.length === 0) {
    throw new Error(`stream ${stream.streamId} lacks route or stops`);
  }
  for (const snapshot of stream.snapshots) {
    if (!Number.isFinite(Date.parse(snapshot.capturedAt))) throw new Error(`stream ${stream.streamId} has an undated snapshot`);
    if (snapshot.error && snapshot.vehicles.length > 0) {
      throw new Error(`stream ${stream.streamId} has a failed snapshot that also claims vehicles`);
    }
    for (const vehicle of snapshot.vehicles) validateObservation(stream, vehicle);
  }
}

function validateObservation(stream: PassiveObservationStream, vehicle: VehicleObservation): void {
  if (!vehicle.vehicleId || vehicle.routeId !== stream.routeId) {
    throw new Error(`stream ${stream.streamId} has an observation for another route`);
  }
}
