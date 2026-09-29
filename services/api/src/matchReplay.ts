/**
 * Replay the real matcher over a captured ride.
 *
 * The broad-real-mode gate in `docs/DATA_VALIDATION.md` asks for 30 observed
 * boardings showing "a clear candidate margin, no silent direction reversal,
 * and bounded stale-data behaviour". Until this module existed, nothing
 * measured any of those three: `analyzeRideCapture` compared the one vehicle
 * the rider typed in against their stop markers and never ran the matcher at
 * all. Thirty rides would have produced thirty captures that could not close
 * the gate.
 *
 * So this feeds each captured snapshot back through the same
 * `matchVehicleWithSourceFreshness` and `classifyTagoCadenceFreshness` that
 * serve a live session, and asks the only question that matters: at the moment
 * the matcher would have committed, would it have chosen the bus the rider
 * actually boarded?
 *
 * Nothing here is a threshold and nothing here is a decision. It is the
 * instrument that makes the gate countable.
 */

import type { MatchResult, PassageMemory, RiderState, VehicleObservation } from "./domain.ts";
import { MATCHER_POLICY_VERSION, matchVehicleWithSourceFreshness, type MatcherFunction } from "./matching.ts";
import type { RideCapture, RideSnapshot } from "./rideCapture.ts";
import {
  appendCadenceObservation,
  classifyTagoCadenceFreshness,
  recentlySeenVehicles,
  type SourceFreshnessEvidence,
  type SourceFreshnessState,
} from "./sourceFreshness.ts";
import { round, summarize, type NumberSummary } from "./stats.ts";

/**
 * What the matcher would have done at one captured instant.
 *
 * `selected_other` is the only catastrophic outcome. Both `withheld_*` values
 * are the matcher declining to act, which costs a rider convenience and costs
 * nobody the wrong bus.
 */
export type MatchDecisionOutcome =
  | "selected_boarded"
  | "selected_other"
  | "withheld_ambiguous"
  | "withheld_unavailable";

export type SelectionVerdict =
  /** The first commit was the vehicle the rider boarded. */
  | "correct"
  /** The first commit was a different vehicle. A gate failure on its own. */
  | "wrong"
  /** The matcher never committed during the ride. Safe, and no help either. */
  | "never_committed"
  /** No boarded vehicle was recorded, so there is nothing to be right about. */
  | "no_boarded_vehicle";

export interface FirstCommit {
  at: string;
  /** Pseudonym. `tracked` is the boarded vehicle; `V1`, `V2`, … are the others. */
  selectedLabel: string;
  /** Best minus runner-up among eligible candidates, when there were two or more. */
  margin?: number;
  /** Eligible candidates the matcher was choosing between. */
  eligibleCount: number;
  /** Successful snapshots consumed before the matcher would commit. */
  snapshotsBefore: number;
}

export interface MatchGateEvidence {
  /** The matcher policy the capture was replayed under. */
  matcherPolicy: string;
  /** The rider state every decision was made for. */
  riderState: RiderState;
  /** Successful snapshots the matcher was replayed against. */
  evaluatedSnapshots: number;
  outcomeCounts: Record<MatchDecisionOutcome, number>;
  /**
   * The first instant the matcher would have selected a vehicle. In a live
   * session that decision is irreversible — nothing silently rematches — so it
   * is the decision the gate is actually about.
   */
  firstCommit?: FirstCommit;
  selectionVerdict: SelectionVerdict;
  /**
   * The total-score gap between the two best eligible candidates, wherever
   * there were at least two. Descriptive only: the directed policy decides
   * on a stop margin (`marginStops`), not on this gap.
   */
  candidateMargin: NumberSummary;
  /**
   * Evaluation points where a second eligible candidate existed at all. A
   * margin distribution drawn from rides that never had competition says
   * nothing about ambiguity.
   */
  contestedDecisions: number;
  directionReversal: {
    /** Distinct `directionCode` values the boarded vehicle reported. */
    boardedDirectionCodes: number;
    /** Times it changed between consecutive sightings. Any change is a reversal. */
    boardedDirectionChanges: number;
    /** Decisions rejecting a candidate for conflicting with the ride direction. */
    wrongDirectionRejections: number;
  };
  staleData: {
    /** Decisions where the boarded vehicle's cadence surrogate was not `fresh`. */
    boardedNotFreshDecisions: number;
    /**
     * Times the matcher selected a TAGO vehicle whose cadence was not `fresh`.
     * Must be zero: the matcher is supposed to make that impossible, so a
     * non-zero value here is a bug, not a threshold to tune.
     */
    selectionsWhileNotFresh: number;
    /** Distribution of the boarded vehicle's cadence states across decisions. */
    boardedCadenceStates: Record<SourceFreshnessState, number>;
  };
  /**
   * `false` whenever the replay lacked what it needed — no boarded vehicle, no
   * successful snapshots, or a capture whose vehicles carry provider
   * timestamps and so never exercise the cadence path TAGO actually uses.
   */
  usableForGate: boolean;
  warnings: string[];
  /**
   * Every decision in order, present only when `recordDecisions` was asked
   * for. Additive and opt-in: nothing above depends on it, and the existing
   * v1/v2 reports never request it.
   */
  decisions?: ReplayDecision[];
}

/** One replayed matcher decision, by pseudonym only. */
export interface ReplayDecision {
  at: string;
  status: "matched" | "ambiguous" | "unavailable";
  selectedLabel?: string;
  eligibleCount: number;
  margin?: number;
  /** Decision-level reasons a selection was withheld (directed policy only). */
  abstentionReasons?: string[];
  /** Vehicles absent from this snapshot that still competed from memory. */
  rememberedVehicles?: number;
  candidates: Array<{
    label: string;
    score: number;
    rejectedReasons: string[];
    stopSequence?: number;
    cadence?: SourceFreshnessState;
    zone?: string;
  }>;
}

export interface ReplayOptions {
  /** Pseudonyms by raw vehicle id, so this never emits a vehicle number. */
  labels: ReadonlyMap<string, string>;
  /**
   * The answer, used only to *score* decisions after the blind replay has made
   * all of them. It never reaches `replayBlind`; see F3 in
   * `docs/exec-plans/PASSIVE_SHADOW_VALIDATION_V3.md`.
   */
  boardedVehicleId?: string;
  /** Opt in to `MatchGateEvidence.decisions`. Changes no other output. */
  recordDecisions?: boolean;
  /**
   * What the rider declared at session start. `replayMatching` defaults to the
   * capture's own start declaration (`declaredRiderStateAtStart`);
   * `replayBlind` defaults to `waiting_at_stop`.
   */
  riderState?: RiderState;
  /**
   * The direction the rider's session asked for, if it asked for one. Only a
   * declared request direction may constrain the replay; deriving it from the
   * boarded vehicle would hand the matcher the answer.
   */
  declaredDirectionCode?: string;
  /** The matcher to replay. Defaults to the production directed matcher. */
  matcher?: MatcherFunction;
  /** Recorded as `matcherPolicy`. Required whenever `matcher` is not the default. */
  matcherPolicy?: string;
}

/** One decision of the blind replay, by raw vehicle id. Never serialised. */
export interface BlindDecision {
  at: string;
  result: MatchResult;
  freshness: ReadonlyMap<string, SourceFreshnessEvidence>;
  positions: ReadonlyMap<string, number | undefined>;
  /** Vehicles in this snapshot that carry no provider timestamp (TAGO). */
  receiptTimedVehicles: ReadonlySet<string>;
  rememberedVehicles: number;
}

export interface BlindReplay {
  matcherPolicy: string;
  riderState: RiderState;
  decisions: BlindDecision[];
  sawTagoObservation: boolean;
}

/**
 * Every matcher decision a live session would have made on this capture, made
 * without the answer. The signature is the guarantee: there is no parameter
 * through which the boarded vehicle could arrive.
 */
export function replayBlind(
  capture: RideCapture,
  options: Pick<ReplayOptions, "riderState" | "declaredDirectionCode" | "matcher" | "matcherPolicy"> = {},
): BlindReplay {
  const riderState: RiderState = options.riderState ?? "waiting_at_stop";
  const matcher = options.matcher ?? matchVehicleWithSourceFreshness;
  if (options.matcher && !options.matcherPolicy) throw new Error("a replacement matcher must name its policy");
  if (!options.matcher && options.matcherPolicy && options.matcherPolicy !== MATCHER_POLICY_VERSION) {
    throw new Error(`the production matcher is ${MATCHER_POLICY_VERSION}; it cannot be labelled ${options.matcherPolicy}`);
  }
  const matcherPolicy = options.matcherPolicy ?? MATCHER_POLICY_VERSION;
  const snapshots = [...(capture.snapshots ?? [])]
    .filter((snapshot) => !snapshot.error)
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
  const boardingStop = (capture.stops ?? []).find((stop) => stop.sequence === capture.boardingStopSequence);
  const directionCode = options.declaredDirectionCode?.trim() || undefined;

  // The cadence surrogate is stateful: it only means anything when it is built
  // from the same consecutive receipts a live session would have accumulated.
  // The same history is the matcher's memory of vehicles that drop out of a
  // poll, exactly as `JourneySessionCoordinator` keeps it.
  const cadenceHistory = new Map<string, VehicleObservation[]>();
  let sawTagoObservation = false;
  // Session memory of passages past the boarding stop, threaded from one
  // decision to the next exactly as a live session persists it.
  let passage: PassageMemory | undefined;
  const decisions: BlindDecision[] = [];

  for (const snapshot of snapshots) {
    const at = new Date(Date.parse(snapshot.capturedAt));
    if (!Number.isFinite(at.getTime())) continue;

    const freshness = new Map<string, SourceFreshnessEvidence>();
    for (const observation of snapshot.vehicles) {
      if (observation.timestampSource !== "unavailable") continue;
      sawTagoObservation = true;
      const history = appendCadenceObservation(
        cadenceHistory.get(observation.vehicleId) ?? [],
        observation,
        at,
      );
      cadenceHistory.set(observation.vehicleId, history);
      freshness.set(observation.vehicleId, classifyTagoCadenceFreshness(history, at));
    }
    const recentlySeen = recentlySeenVehicles(cadenceHistory, snapshot.vehicles, at);

    const result = matcher({
      routeId: capture.routeId,
      boardingStopSequence: capture.boardingStopSequence,
      boardingLatitude: boardingStop?.latitude,
      boardingLongitude: boardingStop?.longitude,
      ...(directionCode ? { directionCode } : {}),
      now: at.toISOString(),
      candidates: snapshot.vehicles,
      riderState,
      stops: capture.stops ?? [],
      recentlySeen,
      ...(passage ? { passage } : {}),
      ...(capture.startedAt ? { declaredAt: capture.startedAt } : {}),
    }, freshness);
    // The label is evidence: a replay counted under one policy must have been
    // decided by it, so a result that names a different policy is refused.
    if (result.policyVersion !== undefined && result.policyVersion !== matcherPolicy) {
      throw new Error(`replay labelled ${matcherPolicy} was decided by ${result.policyVersion}`);
    }
    passage = result.passage ?? passage;

    decisions.push({
      at: snapshot.capturedAt,
      result,
      freshness,
      positions: new Map(snapshot.vehicles.map((vehicle) => [vehicle.vehicleId, vehicle.stopSequence])),
      receiptTimedVehicles: new Set(snapshot.vehicles
        .filter((vehicle) => vehicle.timestampSource === "unavailable")
        .map((vehicle) => vehicle.vehicleId)),
      rememberedVehicles: recentlySeen.length,
    });
  }
  return { matcherPolicy, riderState, decisions, sawTagoObservation };
}


export function replayMatching(capture: RideCapture, options: ReplayOptions): MatchGateEvidence {
  const warnings: string[] = [];
  const { labels } = options;

  // Phase 1: every decision, made blind. The boarded vehicle is not passed and
  // cannot be: `replayBlind` has no parameter for it.
  const blind = replayBlind(capture, {
    riderState: options.riderState ?? declaredRiderStateAtStart(capture),
    declaredDirectionCode: options.declaredDirectionCode,
    matcher: options.matcher,
    matcherPolicy: options.matcherPolicy,
  });

  // Phase 2: only now is the answer read, to score what was already decided.
  const boarded = options.boardedVehicleId?.trim() || undefined;
  const snapshots = [...(capture.snapshots ?? [])]
    .filter((snapshot) => !snapshot.error)
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));

  const outcomeCounts: Record<MatchDecisionOutcome, number> = {
    selected_boarded: 0,
    selected_other: 0,
    withheld_ambiguous: 0,
    withheld_unavailable: 0,
  };
  const boardedCadenceStates: Record<SourceFreshnessState, number> = {
    fresh: 0,
    aging: 0,
    stale: 0,
    unknown: 0,
  };

  const margins: number[] = [];
  let contestedDecisions = 0;
  let wrongDirectionRejections = 0;
  let boardedNotFreshDecisions = 0;
  let selectionsWhileNotFresh = 0;
  let firstCommit: FirstCommit | undefined;
  let evaluated = 0;
  const decisions: ReplayDecision[] | undefined = options.recordDecisions ? [] : undefined;

  for (const decision of blind.decisions) {
    evaluated += 1;
    const { result, freshness } = decision;
    const eligible = result.ranked.filter((candidate) => candidate.rejectedReasons.length === 0);
    wrongDirectionRejections += result.ranked.filter(
      (candidate) => candidate.rejectedReasons.includes("wrong_direction"),
    ).length;

    let margin: number | undefined;
    if (eligible.length >= 2) {
      contestedDecisions += 1;
      margin = round(eligible[0]!.score - eligible[1]!.score);
      margins.push(margin);
    }

    if (boarded) {
      const state = freshness.get(boarded)?.state;
      if (state) {
        boardedCadenceStates[state] += 1;
        if (state !== "fresh") boardedNotFreshDecisions += 1;
      }
    }

    if (decisions) {
      decisions.push({
        at: decision.at,
        status: result.status,
        ...(result.selectedVehicleId ? { selectedLabel: labels.get(result.selectedVehicleId) ?? "unlabelled" } : {}),
        eligibleCount: eligible.length,
        ...(margin === undefined ? {} : { margin }),
        ...(result.abstentionReasons && result.abstentionReasons.length > 0
          ? { abstentionReasons: [...result.abstentionReasons] }
          : {}),
        ...(decision.rememberedVehicles > 0 ? { rememberedVehicles: decision.rememberedVehicles } : {}),
        candidates: result.ranked.map((candidate) => {
          const stopSequence = decision.positions.get(candidate.vehicleId);
          const cadence = freshness.get(candidate.vehicleId)?.state;
          return {
            label: labels.get(candidate.vehicleId) ?? "unlabelled",
            score: candidate.score,
            rejectedReasons: [...candidate.rejectedReasons],
            ...(stopSequence === undefined ? {} : { stopSequence }),
            ...(cadence === undefined ? {} : { cadence }),
            ...(candidate.zone === undefined ? {} : { zone: candidate.zone }),
          };
        }),
      });
    }

    const outcome = classify(result.status, result.selectedVehicleId, boarded);
    outcomeCounts[outcome] += 1;

    if (result.selectedVehicleId) {
      const selectedIsTago = decision.receiptTimedVehicles.has(result.selectedVehicleId);
      if (selectedIsTago && freshness.get(result.selectedVehicleId)?.state !== "fresh") {
        selectionsWhileNotFresh += 1;
      }
      if (!firstCommit) {
        firstCommit = {
          at: decision.at,
          selectedLabel: labels.get(result.selectedVehicleId) ?? "unlabelled",
          ...(margin === undefined ? {} : { margin }),
          eligibleCount: eligible.length,
          snapshotsBefore: evaluated - 1,
        };
      }
    }
  }

  const selectionVerdict = verdict(firstCommit, boarded, labels);

  if (!boarded) warnings.push("No boarded vehicle was recorded; the matcher replay cannot be scored");
  if (evaluated === 0) warnings.push("No successful snapshot was available to replay the matcher against");
  if (evaluated > 0 && !blind.sawTagoObservation) {
    warnings.push(
      "No observation carried timestampSource=unavailable, so the cadence surrogate TAGO relies on was never exercised",
    );
  }
  if (selectionVerdict === "wrong") {
    warnings.push("The matcher would have committed to a vehicle the rider did not board");
  }
  if (selectionsWhileNotFresh > 0) {
    warnings.push("The matcher selected a TAGO vehicle whose cadence was not fresh; this is a fail-closed violation");
  }

  return {
    matcherPolicy: blind.matcherPolicy,
    riderState: blind.riderState,
    evaluatedSnapshots: evaluated,
    outcomeCounts,
    ...(firstCommit ? { firstCommit } : {}),
    selectionVerdict,
    candidateMargin: summarize(margins),
    contestedDecisions,
    directionReversal: {
      boardedDirectionCodes: distinctDirectionCodes(snapshots, boarded).size,
      boardedDirectionChanges: countDirectionChanges(snapshots, boarded),
      wrongDirectionRejections,
    },
    staleData: {
      boardedNotFreshDecisions,
      selectionsWhileNotFresh,
      boardedCadenceStates,
    },
    usableForGate: Boolean(boarded) && evaluated > 0 && blind.sawTagoObservation && selectionVerdict !== "no_boarded_vehicle",
    warnings,
    ...(decisions ? { decisions } : {}),
  };
}

/**
 * What the rider had declared when the capture began — never which bus.
 *
 * A capture whose `boarded` marker is stamped at or before its first
 * successful snapshot was started by a rider who was already boarding: the
 * Railway and beta flows record exactly that at start. Every other capture
 * began with the rider waiting. The marker's *time* is the rider's own
 * declaration, the same thing a live session receives as `riderState`; the
 * boarded vehicle's identity is not read here.
 */
export function declaredRiderStateAtStart(capture: Pick<RideCapture, "markers" | "snapshots">): RiderState {
  const firstSnapshotMs = Math.min(
    ...(capture.snapshots ?? [])
      .filter((snapshot) => !snapshot.error)
      .map((snapshot) => Date.parse(snapshot.capturedAt))
      .filter(Number.isFinite),
  );
  const boardedMs = Math.min(
    ...(capture.markers ?? [])
      .filter((marker) => marker.kind === "boarded")
      .map((marker) => Date.parse(marker.at))
      .filter(Number.isFinite),
  );
  return Number.isFinite(boardedMs) && Number.isFinite(firstSnapshotMs) && boardedMs <= firstSnapshotMs
    ? "on_board"
    : "waiting_at_stop";
}

function classify(
  status: "matched" | "ambiguous" | "unavailable",
  selectedVehicleId: string | undefined,
  boarded: string | undefined,
): MatchDecisionOutcome {
  if (status === "ambiguous") return "withheld_ambiguous";
  if (status !== "matched" || !selectedVehicleId) return "withheld_unavailable";
  return selectedVehicleId === boarded ? "selected_boarded" : "selected_other";
}

function verdict(
  firstCommit: FirstCommit | undefined,
  boarded: string | undefined,
  labels: ReadonlyMap<string, string>,
): SelectionVerdict {
  if (!boarded) return "no_boarded_vehicle";
  if (!firstCommit) return "never_committed";
  return firstCommit.selectedLabel === labels.get(boarded) ? "correct" : "wrong";
}

function distinctDirectionCodes(snapshots: RideSnapshot[], boarded: string | undefined): Set<string> {
  const codes = new Set<string>();
  if (!boarded) return codes;
  for (const snapshot of snapshots) {
    const code = snapshot.vehicles.find((vehicle) => vehicle.vehicleId === boarded)?.directionCode;
    if (code) codes.add(code);
  }
  return codes;
}

/**
 * Changes between consecutive sightings, not distinct values.
 *
 * A bus that reports direction 1, then 0, then 1 again has reversed twice, and
 * counting distinct codes would call that one. The gate asks about reversals.
 */
function countDirectionChanges(snapshots: RideSnapshot[], boarded: string | undefined): number {
  if (!boarded) return 0;
  let previous: string | undefined;
  let changes = 0;
  for (const snapshot of snapshots) {
    const code = snapshot.vehicles.find((vehicle) => vehicle.vehicleId === boarded)?.directionCode;
    if (!code) continue;
    if (previous !== undefined && code !== previous) changes += 1;
    previous = code;
  }
  return changes;
}
