/**
 * Progression of a bus the rider has already identified.
 *
 * Before a bus is selected the question is "which bus is the rider on?", and
 * `sourceFreshness.ts` answers it conservatively: automatic selection needs
 * repeated, changing provider content. After the rider confirms a bus the
 * question changes to "can this confirmed bus safely advance along this exact
 * route?", and that is what this module decides. It does not weaken the
 * matcher: the cadence verdict is still computed and published for the
 * selected bus, it is simply no longer the gate on a confirmed ride's count.
 *
 * Nothing here trusts the provider blindly. Every accepted step needs the
 * same route, the same direction, a monotonic stop sequence, a physically
 * plausible distance for the time elapsed, a receipt inside the bounded
 * window, and a second sighting before a passage of the destination that was
 * not seen coming. Each refusal names itself so the client can tell a bus
 * held at a light (unchanged, still tracking) from evidence it must not act on.
 *
 * Thresholds reuse what the codebase already relies on rather than inventing
 * new ones: the 90 s evidence window of `sourceFreshness.ts`, the 35 m/s
 * movement bound of the Swift `HybridPositionEngine`, and the two-stop
 * `approaching` phase of `progressPhase`.
 */

import type { StopOnRoute, VehicleObservation } from "./domain.ts";
import { distanceMeters } from "./geo.ts";

export interface ConfirmedProgressionPolicy {
  /** A provider row received longer ago than this says nothing about the bus now. */
  maxReceiptAgeMs: number;
  /** The fastest a bus is allowed to have moved between two accepted observations. */
  maxSpeedMetersPerSecond: number;
  /** Allowance on the stop-chord distance for road curvature and provider rounding. */
  jumpSlackMeters: number;
  /**
   * A passage of the destination seen from further out than this many stops
   * before it needs a second, later sighting past the destination before it
   * is believed. Two stops is where the rider was told to prepare.
   */
  passageConfirmationStops: number;
}

export const CONFIRMED_PROGRESSION_POLICY_V1: ConfirmedProgressionPolicy = {
  maxReceiptAgeMs: 90_000,
  maxSpeedMetersPerSecond: 35,
  jumpSlackMeters: 300,
  passageConfirmationStops: 2,
};

/** The last accepted step of the ride, as the session stores it. */
export interface AcceptedStep {
  stopSequence: number;
  /** The instant the step's evidence was ordered by (TAPSO receipt for TAGO). */
  evidenceAtMs: number;
}

/** A passage of the destination seen once, awaiting a second sighting. */
export interface PendingPassage {
  stopSequence: number;
  evidenceAtMs: number;
}

export type ConfirmedProgressionRejection =
  | "route_conflict"
  | "direction_conflict"
  | "backward_conflict"
  | "corrupt_sequence"
  | "topology_conflict"
  | "implausible_jump"
  | "destination_passage_unconfirmed"
  | "stale_evidence";

export type ConfirmedProgressionVerdict =
  | {
      kind: "accept";
      stop: StopOnRoute;
      source: "provider_stop_sequence" | "near_stop_estimate";
      /** Whether the bus moved to a new stop since the last accepted step. */
      observation: "changing" | "unchanged";
      explanation: string;
    }
  | {
      /** The same receipt again (a cached snapshot, a duplicate row): the last step stands and the ride is still tracking. */
      kind: "retain";
      explanation: string;
    }
  | {
      /** The bus is identified but no conservative stop position can be resolved from this row. */
      kind: "unresolved";
      explanation: string;
    }
  | {
      kind: "reject";
      reason: ConfirmedProgressionRejection;
      /** Set when the rejected sighting is a destination passage that a later sighting may confirm. */
      pendingPassage?: PendingPassage;
      explanation: string;
    };

export interface ConfirmedProgressionInput {
  observation: VehicleObservation;
  /** The receipt instant of `observation`, as the session orders evidence by. */
  evidenceAtMs: number;
  now: Date;
  routeId: string;
  directionCode?: string;
  stops: StopOnRoute[];
  destinationSequence: number;
  lastStep?: AcceptedStep;
  pendingPassage?: PendingPassage;
  nearStopRadiusMeters: number;
  policy?: ConfirmedProgressionPolicy;
}

export function evaluateConfirmedProgression(input: ConfirmedProgressionInput): ConfirmedProgressionVerdict {
  const policy = input.policy ?? CONFIRMED_PROGRESSION_POLICY_V1;
  const { observation, stops, lastStep } = input;

  if (observation.routeId !== input.routeId) {
    return { kind: "reject", reason: "route_conflict", explanation: "Confirmed vehicle reported another route; its position is not applied to this ride." };
  }
  if (input.directionCode && observation.directionCode && observation.directionCode !== input.directionCode) {
    return { kind: "reject", reason: "direction_conflict", explanation: "Confirmed vehicle reported the opposite direction; its position is not applied to this ride." };
  }

  const ageMs = input.now.getTime() - input.evidenceAtMs;
  if (!Number.isFinite(ageMs) || ageMs < -10_000 || ageMs > policy.maxReceiptAgeMs) {
    return { kind: "reject", reason: "stale_evidence", explanation: "Confirmed vehicle's latest row was received outside the bounded evidence window." };
  }
  if (lastStep !== undefined && input.evidenceAtMs <= lastStep.evidenceAtMs) {
    return { kind: "retain", explanation: "Same receipt as the last accepted step (a cached or duplicate snapshot); last accepted progress stands." };
  }

  if (observation.stopSequence !== undefined) {
    if (!Number.isInteger(observation.stopSequence) || observation.stopSequence < 0) {
      return { kind: "reject", reason: "corrupt_sequence", explanation: "Confirmed vehicle reported a stop sequence that is not a whole number." };
    }
    if (!stops.some((stop) => stop.sequence === observation.stopSequence)) {
      return { kind: "reject", reason: "topology_conflict", explanation: "Confirmed vehicle reported a stop sequence this route variant does not have." };
    }
  }

  const resolved = resolveConfirmedStop(observation, stops, input.nearStopRadiusMeters);
  if (!resolved) {
    return { kind: "unresolved", explanation: "Vehicle identity is confirmed, but no conservative stop position can be resolved from this row." };
  }

  if (lastStep !== undefined) {
    if (resolved.stop.sequence < lastStep.stopSequence) {
      return { kind: "reject", reason: "backward_conflict", explanation: "Confirmed vehicle moved backward in stop sequence; last accepted progress retained." };
    }
    if (resolved.stop.sequence === lastStep.stopSequence) {
      return { kind: "accept", stop: resolved.stop, source: resolved.source, observation: "unchanged", explanation: "Confirmed vehicle is still at the last accepted stop." };
    }
    const elapsedSeconds = (input.evidenceAtMs - lastStep.evidenceAtMs) / 1_000;
    const travelled = chordDistanceMeters(stops, lastStep.stopSequence, resolved.stop.sequence);
    if (travelled !== undefined && travelled > policy.maxSpeedMetersPerSecond * elapsedSeconds + policy.jumpSlackMeters) {
      return {
        kind: "reject",
        reason: "implausible_jump",
        explanation: `Confirmed vehicle would have covered ${Math.round(travelled)} m in ${Math.round(elapsedSeconds)} s; last accepted progress retained.`,
      };
    }
  }

  const delta = input.destinationSequence - resolved.stop.sequence;
  if (delta < 0) {
    const remainingBefore = lastStep === undefined ? undefined : input.destinationSequence - lastStep.stopSequence;
    const seenComing = remainingBefore !== undefined && remainingBefore <= policy.passageConfirmationStops;
    const confirmedByPending = input.pendingPassage !== undefined
      && input.pendingPassage.evidenceAtMs < input.evidenceAtMs
      && resolved.stop.sequence >= input.pendingPassage.stopSequence;
    if (!seenComing && !confirmedByPending) {
      return {
        kind: "reject",
        reason: "destination_passage_unconfirmed",
        pendingPassage: { stopSequence: resolved.stop.sequence, evidenceAtMs: input.evidenceAtMs },
        explanation: "Confirmed vehicle appeared past the destination without being seen approach it; a second sighting is needed before the passage is believed.",
      };
    }
  }

  return {
    kind: "accept",
    stop: resolved.stop,
    source: resolved.source,
    observation: "changing",
    explanation: resolved.source === "provider_stop_sequence"
      ? "Confirmed vehicle advanced with provider stop-sequence evidence."
      : "Confirmed vehicle is within the conservative near-stop radius; progress is an estimate.",
  };
}

function resolveConfirmedStop(
  observation: VehicleObservation,
  stops: StopOnRoute[],
  radiusMeters: number,
): { stop: StopOnRoute; source: "provider_stop_sequence" | "near_stop_estimate" } | undefined {
  if (observation.stopSequence !== undefined) {
    const stop = stops.find((candidate) => candidate.sequence === observation.stopSequence);
    if (stop) return { stop, source: "provider_stop_sequence" };
  }
  if (!Number.isFinite(observation.latitude) || !Number.isFinite(observation.longitude)) return undefined;
  let nearest: { stop: StopOnRoute; meters: number } | undefined;
  for (const stop of stops) {
    if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) continue;
    const meters = distanceMeters(
      { latitude: observation.latitude as number, longitude: observation.longitude as number },
      { latitude: stop.latitude as number, longitude: stop.longitude as number },
    );
    if (!nearest || meters < nearest.meters) nearest = { stop, meters };
  }
  if (!nearest || nearest.meters > radiusMeters) return undefined;
  return { stop: nearest.stop, source: "near_stop_estimate" };
}

/**
 * The straight-line distance along the stop list from one sequence to a later
 * one: the sum of the chords between consecutive stops. Shorter than the road,
 * so a bus that fails this bound has moved faster than any road allows.
 * `undefined` when a stop on the way has no coordinates.
 */
export function chordDistanceMeters(stops: StopOnRoute[], fromSequence: number, toSequence: number): number | undefined {
  const ordered = stops
    .filter((stop) => stop.sequence >= fromSequence && stop.sequence <= toSequence)
    .sort((left, right) => left.sequence - right.sequence);
  if (ordered.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (![previous.latitude, previous.longitude, current.latitude, current.longitude].every((value) => Number.isFinite(value))) {
      return undefined;
    }
    total += distanceMeters(
      { latitude: previous.latitude as number, longitude: previous.longitude as number },
      { latitude: current.latitude as number, longitude: current.longitude as number },
    );
  }
  return total;
}
