/**
 * Passive Shadow Validation v3 — blind replay and scoring.
 *
 * Order of operations is the whole point:
 *
 *   1. `assertBlindMatcherInput` — the input has only what a session would have.
 *   2. `replayMatching(capture, { labels })` — the canonical replay, with
 *      pseudonyms derived from the input alone and **no** `boardedVehicleId`.
 *      (Passing it would also let `replayMatching` derive a direction
 *      constraint from the answer; see F3 in the exec plan.)
 *   3. `vault.reveal(caseId)` — only now is the answer read.
 *   4. Classify under `passive-shadow-validation-v3`.
 *
 * The matcher is not re-implemented anywhere here. `replay` is injectable only
 * so tests can prove that changing the matcher's output changes the verdict.
 */

import { replayMatching, type MatchGateEvidence, type ReplayDecision, type ReplayOptions } from "./matchReplay.ts";
import type { RideCapture } from "./rideCapture.ts";
import { TAGO_CADENCE_POLICY_V1, type SourceFreshnessState } from "./sourceFreshness.ts";
import {
  PASSIVE_SHADOW_POLICY_VERSION,
  PASSIVE_SHADOW_SCHEMA_VERSION,
  assertBlindMatcherInput,
  toBlindCapture,
  type GroundTruthVault,
  type PassiveCase,
  type PassiveCaseMeta,
  type PassiveGroundTruth,
  type PassiveMatcherInput,
  type PassiveSourceClass,
} from "./passiveShadow.ts";

export type PassiveBucket =
  | "PASSIVE_CORRECT"
  | "PASSIVE_WRONG"
  | "PASSIVE_ABSTAINED"
  | "PASSIVE_AMBIGUOUS"
  | "PASSIVE_STALE_FAILURE"
  | "PASSIVE_DIRECTION_FAILURE"
  | "PASSIVE_INSUFFICIENT_EVIDENCE"
  | "PASSIVE_PROVIDER_FAILURE";

export const PASSIVE_BUCKETS: readonly PassiveBucket[] = [
  "PASSIVE_CORRECT",
  "PASSIVE_WRONG",
  "PASSIVE_ABSTAINED",
  "PASSIVE_AMBIGUOUS",
  "PASSIVE_STALE_FAILURE",
  "PASSIVE_DIRECTION_FAILURE",
  "PASSIVE_INSUFFICIENT_EVIDENCE",
  "PASSIVE_PROVIDER_FAILURE",
];

/** Buckets in which the matcher committed to a vehicle. */
export const COMMITTED_BUCKETS: ReadonlySet<PassiveBucket> = new Set([
  "PASSIVE_CORRECT",
  "PASSIVE_WRONG",
  "PASSIVE_STALE_FAILURE",
  "PASSIVE_DIRECTION_FAILURE",
]);

export type Difficulty = "SINGLE_CANDIDATE" | "CONTESTED" | "DEPARTED_DECOY";

/** Where a wrong commit landed relative to the modelled boarding. */
export type WrongKind = "DEPARTED_VEHICLE" | "FOLLOWING_VEHICLE" | "OTHER";

export interface PassiveCaseResult {
  schemaVersion: typeof PASSIVE_SHADOW_SCHEMA_VERSION;
  policyVersion: typeof PASSIVE_SHADOW_POLICY_VERSION;
  sourceClass: PassiveSourceClass;
  /** Set on adversarial variants; absent for an unperturbed case. */
  perturbation?: string;
  caseId: string;
  meta: PassiveCaseMeta;
  bucket: PassiveBucket;
  reason: string;
  /** Raw vehicle ids. Sensitive; the summariser replaces them with pseudonyms. */
  groundTruthVehicleId: string;
  committedVehicleId?: string;
  commitAt?: string;
  /** Seconds from the modelled boarding to the commit; negative is before boarding. */
  commitRelativeToBoardingSeconds?: number;
  wrongKind?: WrongKind;
  difficulty: Difficulty;
  /** Distinct vehicles seen in the window before boarding. */
  candidateCount: number;
  /** Most vehicles within ±4 stops of the boarding stop at any pre-boarding decision. */
  maxNearbyCandidates: number;
  decisionsEvaluated: number;
  ambiguousDecisions: number;
  failedPolls: number;
  totalPolls: number;
  selectionsWhileNotFresh: number;
  /** The ground-truth vehicle's cadence state at each decision point. */
  groundTruthCadence: Record<SourceFreshnessState, number>;
  /** Decisions that rejected a candidate for cadence / for route or direction. */
  staleRejections: number;
  directionRejections: number;
  committedDirectionInconsistency: boolean;
  /** Committed vehicle's stop sequence minus the boarding stop, at the commit. Positive = already past the stop. */
  committedStopOffset?: number;
  /**
   * The ground-truth vehicle never reached `fresh` cadence at any decision.
   * With no commit, this attributes the abstention to the cadence gate
   * (fail-closed on freshness) rather than to ambiguity or position.
   */
  groundTruthNeverFresh: boolean;
  /** Most candidates eligible (no rejection) at any single decision. */
  maxEligibleCandidates: number;
  /** Decisions with two or more eligible candidates (from `replayMatching`). */
  contestedDecisions: number;
  /**
   * Pre-boarding decisions with a bus within 4 stops *before* the boarding stop
   * and another at or within 4 stops *after* it: the geometry in which a
   * symmetric stop-distance score cannot tell approaching from departed.
   */
  approachingVsDepartedDecisions: number;
  /** A same-route bus was within 4 stops of the boarding stop, behind the true bus, before boarding. */
  followingCompetitorPressure: boolean;
  /**
   * Counterfactual for cases with no commit: had a policy forced a commit to
   * the top eligible candidate at the first decision that had one, would it
   * have been the wrong bus? Absent when no candidate was ever eligible.
   * Measures whether abstaining was the safer outcome; it changes nothing.
   */
  forcedTopWouldBeWrong?: boolean;
  /** Decision timeline in pseudonyms. Kept for failed and ambiguous cases only. */
  timeline?: ReplayDecision[];
  groundTruthLabel: string;
}

export type ReplayFunction = (capture: RideCapture, options: ReplayOptions) => MatchGateEvidence;

export interface EvaluateOptions {
  replay?: ReplayFunction;
  perturbation?: string;
  /** Forces the result's source class; perturbations always pass SYNTHETIC_OR_PERTURBED. */
  sourceClass?: PassiveSourceClass;
}

const NEARBY_STOPS = 4;

/** Pseudonyms `C1`, `C2`, … by first appearance in the input — never from the answer. */
export function blindLabels(input: PassiveMatcherInput): Map<string, string> {
  const labels = new Map<string, string>();
  for (const snapshot of input.snapshots) {
    for (const vehicle of snapshot.vehicles) {
      if (!labels.has(vehicle.vehicleId)) labels.set(vehicle.vehicleId, `C${labels.size + 1}`);
    }
  }
  return labels;
}

export function evaluatePassiveCase(
  passiveCase: PassiveCase,
  vault: GroundTruthVault,
  options: EvaluateOptions = {},
): PassiveCaseResult {
  const { meta, input } = passiveCase;
  assertBlindMatcherInput(input);
  const labels = blindLabels(input);
  const replay = options.replay ?? replayMatching;
  // No boardedVehicleId, by construction. The vault has not been opened yet.
  const evidence = replay(toBlindCapture(input), { labels, recordDecisions: true });
  const truth = vault.reveal(meta.caseId);
  return classifyPassiveCase(meta, input, evidence, labels, truth, options);
}

export function classifyPassiveCase(
  meta: PassiveCaseMeta,
  input: PassiveMatcherInput,
  evidence: MatchGateEvidence,
  labels: ReadonlyMap<string, string>,
  truth: PassiveGroundTruth,
  options: EvaluateOptions = {},
): PassiveCaseResult {
  const byLabel = new Map([...labels].map(([vehicleId, label]) => [label, vehicleId]));
  const truthLabel = labels.get(truth.vehicleId) ?? "absent";
  const boardingAt = Date.parse(truth.provenance.crossingNextAt);
  const decisions = evidence.decisions ?? [];
  const committedVehicleId = evidence.firstCommit ? byLabel.get(evidence.firstCommit.selectedLabel) : undefined;
  const commitAt = evidence.firstCommit?.at;

  const polls = input.snapshots;
  const failedPolls = polls.filter((snapshot) => snapshot.error).length;
  const successfulAt = polls.filter((snapshot) => !snapshot.error).map((snapshot) => Date.parse(snapshot.capturedAt));
  const successfulSpanMs = successfulAt.length ? Math.max(...successfulAt) - Math.min(...successfulAt) : 0;
  const longestFailureRunMs = longestFailureRun(polls);

  const preBoarding = decisions.filter((decision) => Date.parse(decision.at) <= boardingAt);
  const candidateCount = new Set(
    input.snapshots
      .filter((snapshot) => Date.parse(snapshot.capturedAt) <= boardingAt)
      .flatMap((snapshot) => snapshot.vehicles.map((vehicle) => vehicle.vehicleId)),
  ).size;
  let maxNearby = 0;
  let departedDecoy = false;
  for (const decision of preBoarding) {
    const nearby = decision.candidates.filter(
      (candidate) => candidate.stopSequence !== undefined && Math.abs(candidate.stopSequence - meta.boardingSequence) <= NEARBY_STOPS,
    );
    maxNearby = Math.max(maxNearby, nearby.length);
    if (nearby.some((candidate) => candidate.label !== truthLabel && candidate.stopSequence! >= meta.boardingSequence)) {
      departedDecoy = true;
    }
  }
  const difficulty: Difficulty = departedDecoy ? "DEPARTED_DECOY" : maxNearby >= 2 ? "CONTESTED" : "SINGLE_CANDIDATE";

  let approachingVsDepartedDecisions = 0;
  let followingCompetitorPressure = false;
  for (const decision of preBoarding) {
    const positions = decision.candidates.filter((candidate) => candidate.stopSequence !== undefined);
    const approaching = positions.some((candidate) => candidate.stopSequence! < meta.boardingSequence
      && candidate.stopSequence! >= meta.boardingSequence - NEARBY_STOPS);
    const departed = positions.some((candidate) => candidate.stopSequence! >= meta.boardingSequence
      && candidate.stopSequence! <= meta.boardingSequence + NEARBY_STOPS);
    if (approaching && departed) approachingVsDepartedDecisions += 1;
    const truthRow = positions.find((candidate) => candidate.label === truthLabel);
    if (truthRow && positions.some((candidate) => candidate.label !== truthLabel
      && candidate.stopSequence! < truthRow.stopSequence!
      && Math.abs(candidate.stopSequence! - meta.boardingSequence) <= NEARBY_STOPS)) {
      followingCompetitorPressure = true;
    }
  }
  const maxEligibleCandidates = Math.max(0, ...decisions.map((decision) => decision.eligibleCount));
  let forcedTopWouldBeWrong: boolean | undefined;
  if (committedVehicleId === undefined) {
    const firstEligible = decisions.find((decision) => decision.eligibleCount > 0);
    const top = firstEligible?.candidates.find((candidate) => candidate.rejectedReasons.length === 0);
    if (top) forcedTopWouldBeWrong = top.label !== truthLabel;
  }

  const groundTruthCadence: Record<SourceFreshnessState, number> = { fresh: 0, aging: 0, stale: 0, unknown: 0 };
  let staleRejections = 0;
  let directionRejections = 0;
  let ambiguousDecisions = 0;
  for (const decision of decisions) {
    if (decision.status === "ambiguous") ambiguousDecisions += 1;
    const truthRow = decision.candidates.find((candidate) => candidate.label === truthLabel);
    if (truthRow?.cadence) groundTruthCadence[truthRow.cadence] += 1;
    if (decision.candidates.some((candidate) => candidate.rejectedReasons.some(isCadenceRejection))) staleRejections += 1;
    if (decision.candidates.some((candidate) => candidate.rejectedReasons.some(isDirectionRejection))) directionRejections += 1;
  }

  const committedDirectionInconsistency = committedVehicleId !== undefined && commitAt !== undefined
    && directionInconsistent(input, committedVehicleId, Date.parse(commitAt));

  let bucket: PassiveBucket;
  let reason: string;
  let wrongKind: WrongKind | undefined;
  const committedPosition = committedVehicleId !== undefined && commitAt !== undefined
    ? positionAt(input, committedVehicleId, Date.parse(commitAt))
    : undefined;
  const committedStopOffset = committedPosition === undefined ? undefined : committedPosition - meta.boardingSequence;
  if (committedVehicleId !== undefined && committedVehicleId !== truth.vehicleId) {
    bucket = "PASSIVE_WRONG";
    wrongKind = classifyWrong(input, committedVehicleId, truth.vehicleId, meta.boardingSequence, Date.parse(commitAt!));
    reason = `first commit was ${evidence.firstCommit!.selectedLabel}, ground truth ${truthLabel} (${wrongKind})`;
  } else if (evidence.staleData.selectionsWhileNotFresh > 0) {
    bucket = "PASSIVE_STALE_FAILURE";
    reason = `${evidence.staleData.selectionsWhileNotFresh} selection(s) of a TAGO vehicle whose cadence was not fresh`;
  } else if (committedDirectionInconsistency) {
    bucket = "PASSIVE_DIRECTION_FAILURE";
    reason = "committed vehicle reported a stop-sequence decrease or direction change before the commit";
  } else if (committedVehicleId !== undefined) {
    bucket = "PASSIVE_CORRECT";
    reason = "first commit was the ground-truth vehicle";
  } else if (polls.length > 0 && (failedPolls / polls.length >= 0.2 || longestFailureRunMs > TAGO_CADENCE_POLICY_V1.maximumReceiptGapMs)) {
    bucket = "PASSIVE_PROVIDER_FAILURE";
    reason = `no commit; ${failedPolls}/${polls.length} polls failed, longest failure run ${Math.round(longestFailureRunMs / 1_000)} s`;
  } else if (successfulAt.length < TAGO_CADENCE_POLICY_V1.minimumSamples || successfulSpanMs < TAGO_CADENCE_POLICY_V1.minimumSpanMs) {
    bucket = "PASSIVE_INSUFFICIENT_EVIDENCE";
    reason = `no commit; ${successfulAt.length} successful receipts over ${Math.round(successfulSpanMs / 1_000)} s is below the cadence policy minimums`;
  } else if (ambiguousDecisions > 0) {
    bucket = "PASSIVE_AMBIGUOUS";
    reason = `no commit; ${ambiguousDecisions} ambiguous decision(s)`;
  } else {
    bucket = "PASSIVE_ABSTAINED";
    reason = "no commit; no eligible candidate with a sufficient margin at any decision";
  }

  const keepTimeline = bucket !== "PASSIVE_CORRECT";
  return {
    schemaVersion: PASSIVE_SHADOW_SCHEMA_VERSION,
    policyVersion: PASSIVE_SHADOW_POLICY_VERSION,
    sourceClass: options.sourceClass ?? meta.sourceClass,
    ...(options.perturbation ? { perturbation: options.perturbation } : {}),
    caseId: meta.caseId,
    meta,
    bucket,
    reason,
    groundTruthVehicleId: truth.vehicleId,
    groundTruthLabel: truthLabel,
    ...(committedVehicleId !== undefined ? { committedVehicleId } : {}),
    ...(commitAt ? { commitAt, commitRelativeToBoardingSeconds: Math.round((Date.parse(commitAt) - boardingAt) / 100) / 10 } : {}),
    ...(wrongKind ? { wrongKind } : {}),
    ...(committedStopOffset === undefined ? {} : { committedStopOffset }),
    groundTruthNeverFresh: groundTruthCadence.fresh === 0,
    maxEligibleCandidates,
    contestedDecisions: evidence.contestedDecisions,
    approachingVsDepartedDecisions,
    followingCompetitorPressure,
    ...(forcedTopWouldBeWrong === undefined ? {} : { forcedTopWouldBeWrong }),
    difficulty,
    candidateCount,
    maxNearbyCandidates: maxNearby,
    decisionsEvaluated: decisions.length,
    ambiguousDecisions,
    failedPolls,
    totalPolls: polls.length,
    selectionsWhileNotFresh: evidence.staleData.selectionsWhileNotFresh,
    groundTruthCadence,
    staleRejections,
    directionRejections,
    committedDirectionInconsistency,
    ...(keepTimeline ? { timeline: decisions } : {}),
  };
}

function isCadenceRejection(reason: string): boolean {
  return reason === "source_cadence_not_fresh" || reason === "stale_or_invalid_timestamp";
}

function isDirectionRejection(reason: string): boolean {
  return reason === "wrong_direction" || reason === "wrong_route";
}

function longestFailureRun(polls: PassiveMatcherInput["snapshots"]): number {
  let longest = 0;
  let runStart: number | undefined;
  let lastSuccess: number | undefined;
  for (const snapshot of polls) {
    const at = Date.parse(snapshot.capturedAt);
    if (snapshot.error) {
      if (runStart === undefined) runStart = lastSuccess ?? at;
      longest = Math.max(longest, at - runStart);
    } else {
      if (runStart !== undefined) longest = Math.max(longest, at - runStart);
      runStart = undefined;
      lastSuccess = at;
    }
  }
  return longest;
}

function positionAt(input: PassiveMatcherInput, vehicleId: string, at: number): number | undefined {
  let position: number | undefined;
  for (const snapshot of input.snapshots) {
    if (Date.parse(snapshot.capturedAt) > at) break;
    const row = snapshot.vehicles.find((vehicle) => vehicle.vehicleId === vehicleId);
    if (row?.stopSequence !== undefined) position = row.stopSequence;
  }
  return position;
}

function classifyWrong(
  input: PassiveMatcherInput,
  committed: string,
  truth: string,
  boardingSequence: number,
  commitAt: number,
): WrongKind {
  const committedPosition = positionAt(input, committed, commitAt);
  const truthPosition = positionAt(input, truth, commitAt);
  if (committedPosition === undefined) return "OTHER";
  if (committedPosition >= boardingSequence && (truthPosition === undefined || truthPosition < boardingSequence)) {
    return "DEPARTED_VEHICLE";
  }
  if (truthPosition !== undefined && committedPosition < truthPosition) return "FOLLOWING_VEHICLE";
  return "OTHER";
}

/** Any backward stop step or direction-code change by the vehicle up to `until`. */
function directionInconsistent(input: PassiveMatcherInput, vehicleId: string, until: number): boolean {
  let previousSequence: number | undefined;
  let previousDirection: string | undefined;
  for (const snapshot of input.snapshots) {
    if (snapshot.error || Date.parse(snapshot.capturedAt) > until) continue;
    const row = snapshot.vehicles.find((vehicle) => vehicle.vehicleId === vehicleId);
    if (!row) continue;
    if (row.stopSequence !== undefined) {
      if (previousSequence !== undefined && row.stopSequence < previousSequence) return true;
      previousSequence = row.stopSequence;
    }
    if (row.directionCode) {
      if (previousDirection !== undefined && row.directionCode !== previousDirection) return true;
      previousDirection = row.directionCode;
    }
  }
  return false;
}
