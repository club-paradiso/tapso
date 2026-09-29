/**
 * Old-versus-new matcher migration over the same passive evidence.
 *
 * One set of cases is generated from the streams, with one ground-truth vault,
 * and every case is replayed blind twice: once under the legacy
 * `symmetric-stop-distance-v0` policy (the one Passive Shadow v3 measured) and
 * once under the production `directed-route-progress-v1` policy. Nothing about
 * the cases changes between the two runs except the matcher.
 *
 * The output accounts for every case individually. In particular every former
 * wrong commit is listed with what the current policy does instead, and any
 * *new* wrong commit or any correct-to-wrong regression is surfaced as a
 * blocker. Coverage is reported, never optimised: an abstention is a safe
 * outcome and is counted as one.
 *
 * Pure: no provider, no file system, no clock. `scripts/passive-shadow/migrate.ts`
 * is the offline, network-guarded CLI around it.
 */

import { MATCHER_POLICY_VERSION, type MatcherFunction } from "./matching.ts";
import { LEGACY_MATCHER_POLICY_VERSION, matchVehicleLegacySymmetricV0 } from "./matchingLegacy.ts";
import {
  generatePassiveCases,
  validatePassiveStream,
  type PassiveCaseGeneratorPolicy,
  type PassiveObservationStream,
  type PassiveScenario,
} from "./passiveShadow.ts";
import { evaluatePassiveCase, type PassiveBucket, type PassiveCaseResult } from "./passiveShadowEvaluate.ts";
import { assertNoRawVehicleIds, vehiclePseudonyms } from "./passiveShadowSummary.ts";
import { summarize, type NumberSummary } from "./stats.ts";

export const MATCHER_MIGRATION_SCHEMA_VERSION = 1;

export type OutcomeClass =
  | "correct"
  | "wrong"
  | "abstain"
  | "provider_failure"
  | "insufficient_evidence"
  | "stale_failure"
  | "direction_failure";

export const OUTCOME_CLASSES: readonly OutcomeClass[] = [
  "correct",
  "wrong",
  "abstain",
  "provider_failure",
  "insufficient_evidence",
  "stale_failure",
  "direction_failure",
];

export function outcomeClass(bucket: PassiveBucket): OutcomeClass {
  switch (bucket) {
    case "PASSIVE_CORRECT": return "correct";
    case "PASSIVE_WRONG": return "wrong";
    case "PASSIVE_ABSTAINED":
    case "PASSIVE_AMBIGUOUS": return "abstain";
    case "PASSIVE_PROVIDER_FAILURE": return "provider_failure";
    case "PASSIVE_INSUFFICIENT_EVIDENCE": return "insufficient_evidence";
    case "PASSIVE_STALE_FAILURE": return "stale_failure";
    case "PASSIVE_DIRECTION_FAILURE": return "direction_failure";
  }
}

/** One case, both policies, pseudonyms only. */
export interface MigrationCaseRow {
  caseId: string;
  scenario: PassiveScenario;
  routeId: string;
  boardingSequence: number;
  boardingEventId: string;
  trajectoryId: string;
  difficulty: string;
  groundTruth: string;
  legacy: MigrationSide;
  current: MigrationSide;
  transition: `${OutcomeClass}->${OutcomeClass}`;
}

export interface MigrationSide {
  bucket: PassiveBucket;
  outcome: OutcomeClass;
  committed: string | null;
  commitAt?: string;
  commitRelativeToBoardingSeconds?: number;
  committedStopOffset?: number;
  directedInvariantViolated: boolean;
  maxEligibleCandidates: number;
  ambiguousDecisions: number;
  /** Abstention reasons the current policy gave, most frequent first (current side only). */
  abstentionReasons?: string[];
}

export interface FormerWrongCommitOutcome {
  caseId: string;
  scenario: PassiveScenario;
  routeId: string;
  boardingSequence: number;
  groundTruth: string;
  legacySelected: string;
  legacyCommittedStopOffset?: number;
  legacyCommitRelativeToBoardingSeconds?: number;
  currentOutcome: OutcomeClass;
  currentBucket: PassiveBucket;
  currentCommitted: string | null;
  currentCommitRelativeToBoardingSeconds?: number;
  currentAbstentionReasons: string[];
}

export interface MatcherMigration {
  schemaVersion: typeof MATCHER_MIGRATION_SCHEMA_VERSION;
  legacyPolicy: typeof LEGACY_MATCHER_POLICY_VERSION;
  currentPolicy: string;
  cases: number;
  byScenario: Record<string, number>;
  /** `legacy->current` → count, over all cases and per scenario. */
  transitions: Record<string, number>;
  transitionsByScenario: Record<string, Record<string, number>>;
  /** The named transitions the release gate reads, with explicit zeros. */
  named: {
    wrongToCorrect: number;
    wrongToAbstain: number;
    wrongToWrong: number;
    wrongToOther: number;
    correctToWrong: number;
    correctToAbstain: number;
    correctToCorrect: number;
    abstainToCorrect: number;
    abstainToWrong: number;
    abstainToAbstain: number;
  };
  ambiguity: {
    /** Cases with at least one ambiguous decision, per policy. */
    legacyCasesWithAmbiguousDecision: number;
    currentCasesWithAmbiguousDecision: number;
    becameAmbiguous: number;
    stoppedBeingAmbiguous: number;
  };
  eligibility: {
    /** Most eligible candidates at one decision went up / down / stayed. */
    increased: number;
    decreased: number;
    unchanged: number;
  };
  commitTiming: {
    /** Cases committed to the ground-truth vehicle under both policies. */
    correctUnderBoth: number;
    /** current − legacy commit time, seconds; positive means the current policy commits later. */
    delaySeconds: NumberSummary;
    currentCommitRelativeToBoardingSeconds: NumberSummary;
    legacyCommitRelativeToBoardingSeconds: NumberSummary;
  };
  invariant: {
    legacyViolations: number;
    currentViolations: number;
  };
  currentAbstentionReasons: Record<string, number>;
  formerWrongCommits: FormerWrongCommitOutcome[];
  /** Blockers: any of these non-empty fails the gate. */
  newWrongCommits: MigrationCaseRow[];
  correctToWrongRegressions: MigrationCaseRow[];
  rows: MigrationCaseRow[];
}

export interface MigrationOptions {
  policy?: PassiveCaseGeneratorPolicy;
  /** Injectable for tests; defaults to the production directed matcher. */
  currentMatcher?: MatcherFunction;
  currentPolicy?: string;
}

export function runMatcherMigration(streams: PassiveObservationStream[], options: MigrationOptions = {}): MatcherMigration {
  for (const stream of streams) validatePassiveStream(stream);
  const generated = generatePassiveCases(streams, { ...(options.policy ? { policy: options.policy } : {}) });
  const currentPolicy = options.currentPolicy ?? MATCHER_POLICY_VERSION;
  const legacy = generated.cases.map((passiveCase) => evaluatePassiveCase(passiveCase, generated.vault, {
    matcher: matchVehicleLegacySymmetricV0,
    matcherPolicy: LEGACY_MATCHER_POLICY_VERSION,
  }));
  const current = generated.cases.map((passiveCase) => evaluatePassiveCase(passiveCase, generated.vault, {
    ...(options.currentMatcher ? { matcher: options.currentMatcher, matcherPolicy: currentPolicy } : {}),
  }));
  const { pseudonym, allVehicleIds } = vehiclePseudonyms(streams);
  const migration = compareResults(legacy, current, pseudonym, currentPolicy);
  assertNoRawVehicleIds(migration, allVehicleIds);
  return migration;
}

/** Exposed so a test can feed hand-built result pairs. */
export function compareResults(
  legacy: PassiveCaseResult[],
  current: PassiveCaseResult[],
  pseudonym: (vehicleId: string) => string,
  currentPolicy: string = MATCHER_POLICY_VERSION,
): MatcherMigration {
  if (legacy.length !== current.length) throw new Error("legacy and current results must cover the same cases");
  const currentById = new Map(current.map((result) => [result.caseId, result]));
  const rows: MigrationCaseRow[] = legacy.map((old) => {
    const now = currentById.get(old.caseId);
    if (!now) throw new Error(`case ${old.caseId} is missing from the current results`);
    const legacySide = side(old, pseudonym, false);
    const currentSide = side(now, pseudonym, true);
    return {
      caseId: old.caseId,
      scenario: old.meta.scenario,
      routeId: old.meta.routeId,
      boardingSequence: old.meta.boardingSequence,
      boardingEventId: old.meta.boardingEventId,
      trajectoryId: old.meta.trajectoryId,
      difficulty: old.difficulty,
      groundTruth: pseudonym(old.groundTruthVehicleId),
      legacy: legacySide,
      current: currentSide,
      transition: `${legacySide.outcome}->${currentSide.outcome}` as const,
    };
  });

  const transitions: Record<string, number> = {};
  const transitionsByScenario: Record<string, Record<string, number>> = {};
  const byScenario: Record<string, number> = {};
  for (const row of rows) {
    transitions[row.transition] = (transitions[row.transition] ?? 0) + 1;
    const perScenario = transitionsByScenario[row.scenario] ?? {};
    perScenario[row.transition] = (perScenario[row.transition] ?? 0) + 1;
    transitionsByScenario[row.scenario] = perScenario;
    byScenario[row.scenario] = (byScenario[row.scenario] ?? 0) + 1;
  }
  const count = (from: OutcomeClass, to: OutcomeClass) => transitions[`${from}->${to}`] ?? 0;
  const wrongTotal = rows.filter((row) => row.legacy.outcome === "wrong").length;

  const correctUnderBoth = rows.filter((row) => row.legacy.outcome === "correct" && row.current.outcome === "correct");
  const currentAbstentionReasons: Record<string, number> = {};
  for (const row of rows) {
    for (const reason of row.current.abstentionReasons ?? []) {
      currentAbstentionReasons[reason] = (currentAbstentionReasons[reason] ?? 0) + 1;
    }
  }

  return {
    schemaVersion: MATCHER_MIGRATION_SCHEMA_VERSION,
    legacyPolicy: LEGACY_MATCHER_POLICY_VERSION,
    currentPolicy,
    cases: rows.length,
    byScenario,
    transitions,
    transitionsByScenario,
    named: {
      wrongToCorrect: count("wrong", "correct"),
      wrongToAbstain: count("wrong", "abstain"),
      wrongToWrong: count("wrong", "wrong"),
      wrongToOther: wrongTotal - count("wrong", "correct") - count("wrong", "abstain") - count("wrong", "wrong"),
      correctToWrong: count("correct", "wrong"),
      correctToAbstain: count("correct", "abstain"),
      correctToCorrect: count("correct", "correct"),
      abstainToCorrect: count("abstain", "correct"),
      abstainToWrong: count("abstain", "wrong"),
      abstainToAbstain: count("abstain", "abstain"),
    },
    ambiguity: {
      legacyCasesWithAmbiguousDecision: rows.filter((row) => row.legacy.ambiguousDecisions > 0).length,
      currentCasesWithAmbiguousDecision: rows.filter((row) => row.current.ambiguousDecisions > 0).length,
      becameAmbiguous: rows.filter((row) => row.legacy.ambiguousDecisions === 0 && row.current.ambiguousDecisions > 0).length,
      stoppedBeingAmbiguous: rows.filter((row) => row.legacy.ambiguousDecisions > 0 && row.current.ambiguousDecisions === 0).length,
    },
    eligibility: {
      increased: rows.filter((row) => row.current.maxEligibleCandidates > row.legacy.maxEligibleCandidates).length,
      decreased: rows.filter((row) => row.current.maxEligibleCandidates < row.legacy.maxEligibleCandidates).length,
      unchanged: rows.filter((row) => row.current.maxEligibleCandidates === row.legacy.maxEligibleCandidates).length,
    },
    commitTiming: {
      correctUnderBoth: correctUnderBoth.length,
      delaySeconds: summarize(correctUnderBoth
        .filter((row) => row.current.commitRelativeToBoardingSeconds !== undefined && row.legacy.commitRelativeToBoardingSeconds !== undefined)
        .map((row) => row.current.commitRelativeToBoardingSeconds! - row.legacy.commitRelativeToBoardingSeconds!)),
      currentCommitRelativeToBoardingSeconds: summarize(rows
        .map((row) => row.current.commitRelativeToBoardingSeconds)
        .filter((value): value is number => value !== undefined)),
      legacyCommitRelativeToBoardingSeconds: summarize(rows
        .map((row) => row.legacy.commitRelativeToBoardingSeconds)
        .filter((value): value is number => value !== undefined)),
    },
    invariant: {
      legacyViolations: rows.filter((row) => row.legacy.directedInvariantViolated).length,
      currentViolations: rows.filter((row) => row.current.directedInvariantViolated).length,
    },
    currentAbstentionReasons,
    formerWrongCommits: rows
      .filter((row) => row.legacy.outcome === "wrong")
      .map((row) => ({
        caseId: row.caseId,
        scenario: row.scenario,
        routeId: row.routeId,
        boardingSequence: row.boardingSequence,
        groundTruth: row.groundTruth,
        legacySelected: row.legacy.committed ?? "none",
        ...(row.legacy.committedStopOffset === undefined ? {} : { legacyCommittedStopOffset: row.legacy.committedStopOffset }),
        ...(row.legacy.commitRelativeToBoardingSeconds === undefined ? {} : { legacyCommitRelativeToBoardingSeconds: row.legacy.commitRelativeToBoardingSeconds }),
        currentOutcome: row.current.outcome,
        currentBucket: row.current.bucket,
        currentCommitted: row.current.committed,
        ...(row.current.commitRelativeToBoardingSeconds === undefined ? {} : { currentCommitRelativeToBoardingSeconds: row.current.commitRelativeToBoardingSeconds }),
        currentAbstentionReasons: row.current.abstentionReasons ?? [],
      })),
    newWrongCommits: rows.filter((row) => row.current.outcome === "wrong" && row.legacy.outcome !== "wrong"),
    correctToWrongRegressions: rows.filter((row) => row.legacy.outcome === "correct" && row.current.outcome === "wrong"),
    rows,
  };
}

function side(result: PassiveCaseResult, pseudonym: (vehicleId: string) => string, withAbstentions: boolean): MigrationSide {
  const reasons = new Map<string, number>();
  if (withAbstentions) {
    for (const decision of result.timeline ?? []) {
      for (const reason of decision.abstentionReasons ?? []) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }
  return {
    bucket: result.bucket,
    outcome: outcomeClass(result.bucket),
    committed: result.committedVehicleId === undefined ? null : pseudonym(result.committedVehicleId),
    ...(result.commitAt ? { commitAt: result.commitAt } : {}),
    ...(result.commitRelativeToBoardingSeconds === undefined ? {} : { commitRelativeToBoardingSeconds: result.commitRelativeToBoardingSeconds }),
    ...(result.committedStopOffset === undefined ? {} : { committedStopOffset: result.committedStopOffset }),
    directedInvariantViolated: result.directedInvariantViolated,
    maxEligibleCandidates: result.maxEligibleCandidates,
    ambiguousDecisions: result.ambiguousDecisions,
    ...(withAbstentions ? {
      abstentionReasons: [...reasons].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([reason]) => reason),
    } : {}),
  };
}
