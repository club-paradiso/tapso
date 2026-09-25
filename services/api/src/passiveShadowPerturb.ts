/**
 * Passive Shadow Validation v3 — deterministic adversarial variants.
 *
 * Every variant is `SYNTHETIC_OR_PERTURBED`, whatever real case it started
 * from, and the summariser keeps it out of every live count. A variant never
 * rewrites `observedAt` or `timestampSource`: TAGO publishes no observation
 * time, and a perturbation must not invent one. Delay is modelled as provider
 * content lag (what TAPSO receives at t describes the bus at t − D) and,
 * separately, as receipt jitter (TAPSO's own receipt clock moves).
 *
 * Some variants are conditioned on the ground truth's *timing or identity*
 * (an outage right before boarding, removing the ground-truth bus). That is
 * legitimate for a robustness probe and is why these results can never be
 * evidence: the answer shaped the input.
 */

import type { VehicleObservation } from "./domain.ts";
import type { RideSnapshot } from "./rideCapture.ts";
import { replayMatching } from "./matchReplay.ts";
import { toBlindCapture, type GroundTruthVault, type PassiveCase, type PassiveMatcherInput } from "./passiveShadow.ts";
import { blindLabels, classifyPassiveCase, type PassiveCaseResult, type ReplayFunction } from "./passiveShadowEvaluate.ts";

export type PerturbationFamily =
  | "poll_dropout"
  | "delay"
  | "stale_repetition"
  | "vehicle_disappearance"
  | "competitor_pressure"
  | "direction_ambiguity";

export interface PerturbationContext {
  /** Modelled boarding instant (ms). Timing only; identity is in `truthVehicleId`. */
  boardingAt: number;
  truthVehicleId: string;
  seed: number;
}

export interface Perturbation {
  id: string;
  family: PerturbationFamily;
  /** Whether the variant used the ground truth's identity to build the input. */
  usesTruthIdentity: boolean;
  /** `undefined` when the variant does not apply to this case (e.g. no competitor exists). */
  apply(input: PassiveMatcherInput, context: PerturbationContext): PassiveMatcherInput | undefined;
}

const SYNTHETIC_PREFIX = "SYNTHETIC-";

export const PERTURBATIONS: readonly Perturbation[] = [
  dropEvery("dropout_every_3rd", 3),
  dropEvery("dropout_every_5th", 5),
  {
    id: "dropout_seeded_20pct",
    family: "poll_dropout",
    usesTruthIdentity: false,
    apply: (input, context) => {
      const random = mulberry32(context.seed);
      return withSnapshots(input, input.snapshots.filter(() => random() >= 0.2));
    },
  },
  {
    id: "dropout_outage_60s_before_boarding",
    family: "poll_dropout",
    usesTruthIdentity: false,
    apply: (input, context) => withSnapshots(input, input.snapshots.filter((snapshot) => {
      const at = Date.parse(snapshot.capturedAt);
      return at < context.boardingAt - 60_000 || at >= context.boardingAt;
    })),
  },
  contentLag("delay_content_lag_10s", 10_000),
  contentLag("delay_content_lag_20s", 20_000),
  contentLag("delay_content_lag_40s", 40_000),
  receiptJitter("delay_receipt_jitter_10s", 10_000),
  receiptJitter("delay_receipt_jitter_20s", 20_000),
  receiptJitter("delay_receipt_jitter_40s", 40_000),
  frozen("stale_repetition_60s_before_boarding", 60_000),
  frozen("stale_repetition_120s_before_boarding", 120_000),
  {
    id: "disappear_ground_truth_60s_before_boarding",
    family: "vehicle_disappearance",
    usesTruthIdentity: true,
    apply: (input, context) => removeVehicle(input, context.truthVehicleId, context.boardingAt - 60_000, context.boardingAt),
  },
  {
    id: "disappear_competitor_60s_before_boarding",
    family: "vehicle_disappearance",
    usesTruthIdentity: true,
    apply: (input, context) => {
      const competitor = nearestCompetitor(input, context);
      return competitor === undefined
        ? undefined
        : removeVehicle(input, competitor, context.boardingAt - 60_000, context.boardingAt);
    },
  },
  {
    id: "synthetic_competitor_one_stop_behind",
    family: "competitor_pressure",
    usesTruthIdentity: true,
    apply: (input, context) => cloneVehicle(input, context.truthVehicleId, `${SYNTHETIC_PREFIX}SHADOW`, (row) => ({
      ...row,
      ...(row.stopSequence === undefined ? {} : { stopSequence: Math.max(1, row.stopSequence - 1) }),
    })),
  },
  {
    id: "synthetic_opposite_route_twin",
    family: "direction_ambiguity",
    usesTruthIdentity: true,
    apply: (input, context) => cloneVehicle(input, context.truthVehicleId, `${SYNTHETIC_PREFIX}OPPOSITE`, (row) => ({
      ...row,
      routeId: `${row.routeId}${SYNTHETIC_PREFIX}OPPOSITE`,
    })),
  },
  {
    id: "synthetic_reversing_decoy",
    family: "direction_ambiguity",
    usesTruthIdentity: false,
    apply: (input) => {
      let step = 0;
      return withSnapshots(input, input.snapshots.map((snapshot) => {
        if (snapshot.error) return snapshot;
        const template = snapshot.vehicles[0];
        if (!template) return snapshot;
        // Moves one stop backwards every other poll, starting two past the stop.
        const stopSequence = input.boardingStopSequence + 2 - Math.floor(step / 2);
        step += 1;
        const decoy: VehicleObservation = {
          ...template,
          vehicleId: `${SYNTHETIC_PREFIX}REVERSE`,
          stopSequence,
        };
        delete decoy.latitude;
        delete decoy.longitude;
        delete decoy.stopId;
        return { ...snapshot, vehicles: [...snapshot.vehicles, decoy] };
      }));
    },
  },
];

export interface PerturbedResult {
  perturbation: Perturbation;
  result?: PassiveCaseResult;
  skipped?: "NOT_APPLICABLE";
}

/**
 * Runs every perturbation over one case. The matcher is the same canonical
 * replay; only its input changed. The answer is read once, up front, because
 * some variants need it to be built — which is exactly why these results are
 * robustness evidence and nothing else.
 */
export function evaluatePerturbations(
  passiveCase: PassiveCase,
  vault: GroundTruthVault,
  options: { replay?: ReplayFunction; perturbations?: readonly Perturbation[] } = {},
): PerturbedResult[] {
  const truth = vault.reveal(passiveCase.meta.caseId);
  const context: PerturbationContext = {
    boardingAt: Date.parse(truth.provenance.crossingNextAt),
    truthVehicleId: truth.vehicleId,
    seed: seedFor(passiveCase.meta.caseId),
  };
  const replay = options.replay ?? replayMatching;
  return (options.perturbations ?? PERTURBATIONS).map((perturbation) => {
    const input = perturbation.apply(passiveCase.input, context);
    if (!input) return { perturbation, skipped: "NOT_APPLICABLE" as const };
    const labels = blindLabels(input);
    const evidence = replay(toBlindCapture(input), { labels, recordDecisions: true });
    return {
      perturbation,
      result: classifyPassiveCase(passiveCase.meta, input, evidence, labels, truth, {
        perturbation: perturbation.id,
        sourceClass: "SYNTHETIC_OR_PERTURBED",
      }),
    };
  });
}

/* ------------------------------------------------------------ builders */

function withSnapshots(input: PassiveMatcherInput, snapshots: RideSnapshot[]): PassiveMatcherInput {
  const sorted = [...snapshots].sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
  return {
    ...input,
    startedAt: sorted[0]?.capturedAt ?? input.startedAt,
    endedAt: sorted.at(-1)?.capturedAt ?? input.endedAt,
    snapshots: sorted,
  };
}

function dropEvery(id: string, every: number): Perturbation {
  return {
    id,
    family: "poll_dropout",
    usesTruthIdentity: false,
    apply: (input) => withSnapshots(input, input.snapshots.filter((_, index) => index % every !== every - 1)),
  };
}

/** What arrives at t is what the provider knew at t − lag. Receipt times are untouched. */
function contentLag(id: string, lagMs: number): Perturbation {
  return {
    id,
    family: "delay",
    usesTruthIdentity: false,
    apply: (input) => {
      const successful = input.snapshots.filter((snapshot) => !snapshot.error);
      const lagged: RideSnapshot[] = [];
      for (const snapshot of input.snapshots) {
        if (snapshot.error) {
          lagged.push(snapshot);
          continue;
        }
        const at = Date.parse(snapshot.capturedAt);
        const source = [...successful].reverse().find((candidate) => Date.parse(candidate.capturedAt) <= at - lagMs);
        if (!source) continue;
        lagged.push({
          capturedAt: snapshot.capturedAt,
          vehicles: source.vehicles.map((vehicle) => ({ ...vehicle, receivedAt: snapshot.capturedAt })),
        });
      }
      return withSnapshots(input, lagged);
    },
  };
}

/** Every other receipt lands `delayMs` late; content is unchanged. */
function receiptJitter(id: string, delayMs: number): Perturbation {
  return {
    id,
    family: "delay",
    usesTruthIdentity: false,
    apply: (input) => withSnapshots(input, input.snapshots.map((snapshot, index) => {
      if (index % 2 === 0) return snapshot;
      const shifted = new Date(Date.parse(snapshot.capturedAt) + delayMs).toISOString();
      return {
        ...snapshot,
        capturedAt: shifted,
        vehicles: snapshot.vehicles.map((vehicle) => ({ ...vehicle, receivedAt: shifted })),
      };
    })),
  };
}

/** The provider keeps answering with a frozen row for `durationMs` up to boarding. */
function frozen(id: string, durationMs: number): Perturbation {
  return {
    id,
    family: "stale_repetition",
    usesTruthIdentity: false,
    apply: (input, context) => {
      const from = context.boardingAt - durationMs;
      let template: RideSnapshot | undefined;
      return withSnapshots(input, input.snapshots.map((snapshot) => {
        const at = Date.parse(snapshot.capturedAt);
        if (snapshot.error || at < from || at > context.boardingAt) return snapshot;
        template ??= snapshot;
        return {
          capturedAt: snapshot.capturedAt,
          vehicles: template.vehicles.map((vehicle) => ({ ...vehicle, receivedAt: snapshot.capturedAt })),
        };
      }));
    },
  };
}

function removeVehicle(input: PassiveMatcherInput, vehicleId: string, from: number, until: number): PassiveMatcherInput {
  return withSnapshots(input, input.snapshots.map((snapshot) => {
    const at = Date.parse(snapshot.capturedAt);
    if (at < from || at >= until) return snapshot;
    return { ...snapshot, vehicles: snapshot.vehicles.filter((vehicle) => vehicle.vehicleId !== vehicleId) };
  }));
}

function cloneVehicle(
  input: PassiveMatcherInput,
  vehicleId: string,
  cloneId: string,
  transform: (row: VehicleObservation) => VehicleObservation,
): PassiveMatcherInput {
  return withSnapshots(input, input.snapshots.map((snapshot) => {
    const row = snapshot.vehicles.find((vehicle) => vehicle.vehicleId === vehicleId);
    if (!row) return snapshot;
    return { ...snapshot, vehicles: [...snapshot.vehicles, { ...transform({ ...row }), vehicleId: cloneId }] };
  }));
}

/** The real non-truth vehicle that spent most sightings within ±4 stops of the boarding stop. */
function nearestCompetitor(input: PassiveMatcherInput, context: PerturbationContext): string | undefined {
  const counts = new Map<string, number>();
  for (const snapshot of input.snapshots) {
    if (Date.parse(snapshot.capturedAt) > context.boardingAt) break;
    for (const vehicle of snapshot.vehicles) {
      if (vehicle.vehicleId === context.truthVehicleId || vehicle.stopSequence === undefined) continue;
      if (Math.abs(vehicle.stopSequence - input.boardingStopSequence) > 4) continue;
      counts.set(vehicle.vehicleId, (counts.get(vehicle.vehicleId) ?? 0) + 1);
    }
  }
  return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
}

export function seedFor(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
