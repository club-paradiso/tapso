/**
 * Release gate `matcher-passive-safety-v4` and the readiness levels it awards.
 *
 * The legacy gates (`broad-real-mode-30-boardings-v1`, `beta-matcher-30-
 * boardings-v2`) counted human boardings. They stay as they are, with whatever
 * counts reality gave them (zero). This gate replaces the *ritual count* with
 * the safety properties those rides were meant to establish, each read from a
 * machine-produced evidence file and each labelled with the kind of evidence
 * behind it.
 *
 * Readiness levels are defined here, before any is assigned, and each strictly
 * includes the one below it:
 *
 * | Level | What the product may do |
 * |---|---|
 * | `NOT_READY` | Nothing matcher-driven reaches a rider. |
 * | `READY_FOR_SHADOW` | The matcher runs and its ranking is recorded; riders see nothing from it; only an explicit rider confirmation selects a bus. |
 * | `READY_FOR_CONFIRMATION_ASSISTED` | The matcher's pick may be shown to the rider as a suggestion; only the rider's tap commits it. |
 * | `READY_FOR_BOUNDED_AUTOMATION` | Automatic commitment for a waiting rider inside the evidenced envelope, with a rider-visible way to undo it. |
 * | `READY_FOR_AUTOMATIC_MATCHING` | Automatic commitment in every supported rider state. |
 *
 * A level is awarded only when every criterion of it and of every level below
 * it is `PASS`. `MISSING` evidence is never a pass. No criterion trades against
 * another: there is no weighted score.
 *
 * Numeric minimums are justified in `MINIMUMS` below. None was chosen because
 * existing evidence meets it; several deliberately are not met yet.
 */

export const GATE_POLICY_VERSION = "matcher-passive-safety-v4";

export const READINESS_LEVELS = [
  "NOT_READY",
  "READY_FOR_SHADOW",
  "READY_FOR_CONFIRMATION_ASSISTED",
  "READY_FOR_BOUNDED_AUTOMATION",
  "READY_FOR_AUTOMATIC_MATCHING",
] as const;

export type ReadinessLevel = (typeof READINESS_LEVELS)[number];

export function readinessRank(level: ReadinessLevel): number {
  return READINESS_LEVELS.indexOf(level);
}

/** The kinds of evidence a criterion can rest on; never blurred. */
export type EvidenceClass =
  | "VERIFIED_LIVE_HUMAN"
  | "VERIFIED_LIVE_PASSIVE"
  | "VERIFIED_LIVE_INFRASTRUCTURE"
  | "VERIFIED_BY_REPLAY"
  | "VERIFIED_BY_TEST"
  | "HISTORICAL_REPORT_ONLY"
  | "SIMULATED"
  | "INFERRED"
  | "MISSING";

export type CriterionStatus = "PASS" | "FAIL" | "MISSING";

export interface CriterionResult {
  id: string;
  level: Exclude<ReadinessLevel, "NOT_READY">;
  title: string;
  status: CriterionStatus;
  evidenceClass: EvidenceClass;
  observed: string;
  required: string;
}

/**
 * Minimum sample sizes, with the argument for each.
 *
 * The statistical fact used throughout: with zero failures in n independent
 * trials, the one-sided 95 % upper confidence bound on the failure probability
 * is 1 − 0.05^(1/n) ≈ 3/n (the "rule of three"). The *tolerances* are product
 * choices, stated as such:
 *
 * - Confirmation-assisted: a wrong suggestion costs the rider a correction, and
 *   the rider still decides, so a 95 % bound of 5 % per independent vehicle run
 *   is tolerated → n ≥ 60 runs.
 * - Bounded automation: nobody confirms, so the bound must be 1 % → n ≥ 300.
 *
 * The independent unit is the vehicle *trajectory* (one bus, one trip), not the
 * pseudo-boarding case: cases from one trajectory share the bus, the timing and
 * the competitors, and counting them separately would overstate the sample
 * roughly twenty-fold. Contested cases (two or more vehicles plausible at once)
 * are counted separately because the ambiguity rules only act there; 30 of
 * them bounds the contested failure rate at 10 %.
 *
 * The Passive Shadow v3 evidence of record has 29 trajectories and 27
 * vehicles, so it meets neither the confirmation-assisted nor the automation
 * minimum. These numbers were not fitted to it.
 */
export const MINIMUMS = {
  confirmationAssisted: { trajectories: 60, vehicles: 30, routes: 8, contestedCases: 30, collectionWindows: 3, timeBands: 2 },
  boundedAutomation: { trajectories: 300, vehicles: 100, routes: 15, contestedCases: 100, collectionWindows: 10, timeBands: 3 },
  propertySeedsPerInvariant: 2_000,
} as const;

/** Everything the gate reads. Each field is produced by a named tool; absence is `MISSING`. */
export interface GateEvidence {
  generatedAt: string;
  matcher: {
    policyVersion: string;
    /** No module reachable from a serving entry point imports the legacy matcher (static test). */
    legacyFreeServingPaths: boolean | undefined;
    /** `assertDirectedInvariant` runs on every result (static test). */
    runtimeInvariantEnforced: boolean | undefined;
  };
  tests?: {
    suitePassed: boolean;
    propertySeedsPerInvariant: number;
    propertyRegressionSeedsReplayed: number;
    propertyInvariantsCovered: number;
  };
  negativeControls?: {
    total: number;
    killed: number;
    survived: number;
    stale: number;
    invalid: number;
    timeout: number;
    /** The whole catalogue ran (no `--only`). */
    complete: boolean;
    /** The unmutated suite was green, so every kill is attributable to its mutation. */
    baselineGreen: boolean;
    /** Nothing in the working tree changed during the run. */
    realTreeUnchanged: boolean;
  };
  /** `scripts/matcher-evidence/redecide-ledger.ts` over the evidence-of-record ledger. */
  formerWrongCommitInstants?: {
    records: number;
    legacyReproduced: number;
    currentCommits: number;
  };
  /** `scripts/passive-shadow/migrate.ts` over retained raw live collections. Absent until it has run. */
  liveReplay?: {
    collections: number;
    reproductionOk: boolean;
    deterministicAcrossRuns: boolean;
    cases: number;
    trajectories: number;
    trajectoriesWithCommit: number;
    vehicles: number;
    routes: number;
    collectionWindows: number;
    timeBands: number;
    contestedCases: number;
    currentWrong: number;
    currentInvariantViolations: number;
    selectionsWhileNotFresh: number;
    correctToWrong: number;
    newWrong: number;
    providerPaths: string[];
  };
  /** `scripts/passive-shadow/counterfactual.ts` over real bases. Absent until it has run on real bases. */
  counterfactualsOnLiveBases?: {
    families: number;
    expectationFailures: number;
    wrongAgainstRederivedTruth: number;
    invariantViolations: number;
  };
  /** Automatic matching is off in every deployment that was checked. */
  deploymentPosture?: {
    automaticMatchingOffEverywhere: boolean;
    checkedBy: "live_health_endpoint" | "config_default";
  };
  /** Architecture responses to properties no passive evidence can establish. */
  humanOnlyMitigations: {
    riderSeesAndCanUndoAutomaticPick: boolean;
    destinationAlertIndependentOfProviderLag: boolean;
    physicalDeviceLiveActivityVerified: boolean;
    riderBoardsFirstArrivingBusMeasured: boolean;
  };
}

export interface GateResult {
  policyVersion: typeof GATE_POLICY_VERSION;
  generatedAt: string;
  awarded: ReadinessLevel;
  criteria: CriterionResult[];
  /** The first level not awarded, and exactly which of its criteria stand in the way. */
  nextLevel?: { level: ReadinessLevel; blockedBy: Array<Pick<CriterionResult, "id" | "status" | "observed" | "required">> };
}

export function evaluateGate(evidence: GateEvidence): GateResult {
  const criteria: CriterionResult[] = [];
  const add = (row: CriterionResult) => criteria.push(row);
  const bool = (value: boolean | undefined): CriterionStatus => (value === undefined ? "MISSING" : value ? "PASS" : "FAIL");

  /* ------------------------------------------------ READY_FOR_SHADOW */
  add({
    id: "SH-1", level: "READY_FOR_SHADOW", title: "Directed matcher serves every path; legacy symmetric matcher unreachable",
    status: evidence.matcher.policyVersion === "directed-route-progress-v1" ? bool(evidence.matcher.legacyFreeServingPaths) : "FAIL",
    evidenceClass: "VERIFIED_BY_TEST",
    observed: `${evidence.matcher.policyVersion}; legacy-free serving paths: ${String(evidence.matcher.legacyFreeServingPaths)}`,
    required: "directed-route-progress-v1 and no serving import of matchingLegacy.ts",
  });
  add({
    id: "SH-2", level: "READY_FOR_SHADOW", title: "Formal invariant enforced at runtime on every result",
    status: bool(evidence.matcher.runtimeInvariantEnforced), evidenceClass: "VERIFIED_BY_TEST",
    observed: String(evidence.matcher.runtimeInvariantEnforced), required: "true",
  });
  const tests = evidence.tests;
  add({
    id: "SH-3", level: "READY_FOR_SHADOW", title: "Unit, replay and property suites pass over all 15 invariants",
    status: !tests ? "MISSING"
      : tests.suitePassed && tests.propertyInvariantsCovered >= 15 && tests.propertySeedsPerInvariant >= MINIMUMS.propertySeedsPerInvariant ? "PASS" : "FAIL",
    evidenceClass: "VERIFIED_BY_TEST",
    observed: tests ? `passed=${tests.suitePassed}, invariants=${tests.propertyInvariantsCovered}, seeds/invariant=${tests.propertySeedsPerInvariant}, regression seeds=${tests.propertyRegressionSeedsReplayed}` : "not supplied",
    required: `suite green, 15 invariants, ≥ ${MINIMUMS.propertySeedsPerInvariant} seeds each`,
  });
  const controls = evidence.negativeControls;
  add({
    id: "SH-4", level: "READY_FOR_SHADOW", title: "Every negative control (F1, F3 leak paths, F4, fail-closed rules) is killed",
    status: !controls ? "MISSING"
      : controls.total > 0 && controls.killed === controls.total && controls.survived === 0 && controls.stale === 0
        && controls.invalid === 0 && controls.timeout === 0 && controls.complete && controls.baselineGreen && controls.realTreeUnchanged
        ? "PASS" : "FAIL",
    evidenceClass: "VERIFIED_BY_TEST",
    observed: controls
      ? `${controls.killed}/${controls.total} killed, ${controls.survived} survived, ${controls.stale} stale, ${controls.invalid} invalid, `
        + `${controls.timeout} timed out; complete ${controls.complete}, baseline green ${controls.baselineGreen}, tree unchanged ${controls.realTreeUnchanged}`
      : "not supplied",
    required: "a complete run on a green baseline and an unchanged tree: all killed, none survived, stale, invalid or timed out",
  });
  const instants = evidence.formerWrongCommitInstants;
  add({
    id: "SH-5", level: "READY_FOR_SHADOW", title: "No former live wrong commit is still a commit at its instant",
    status: !instants ? "MISSING"
      : instants.records > 0 && instants.legacyReproduced === instants.records && instants.currentCommits === 0 ? "PASS" : "FAIL",
    evidenceClass: "VERIFIED_BY_REPLAY",
    observed: instants ? `${instants.currentCommits} commits at ${instants.records} instants; legacy reproduced ${instants.legacyReproduced}` : "not supplied",
    required: "0 commits; legacy reproduces every recorded selection",
  });
  const posture = evidence.deploymentPosture;
  add({
    id: "SH-6", level: "READY_FOR_SHADOW", title: "Automatic matching off by default, and an opt-in refused below bounded automation",
    status: !posture ? "MISSING" : posture.automaticMatchingOffEverywhere ? "PASS" : "FAIL",
    evidenceClass: posture?.checkedBy === "live_health_endpoint" ? "VERIFIED_LIVE_INFRASTRUCTURE" : "VERIFIED_BY_TEST",
    observed: posture ? `off: ${posture.automaticMatchingOffEverywhere} (${posture.checkedBy === "live_health_endpoint"
      ? "read from live /health"
      : "configuration evaluated, no live deployment read"})` : "not supplied",
    required: "off",
  });

  /* ----------------------------------- READY_FOR_CONFIRMATION_ASSISTED */
  const live = evidence.liveReplay;
  const liveStatus = (test: (value: NonNullable<GateEvidence["liveReplay"]>) => boolean): CriterionStatus =>
    (!live ? "MISSING" : test(live) ? "PASS" : "FAIL");
  const ca = MINIMUMS.confirmationAssisted;
  add({
    id: "CA-1", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "Full-window blind replay of retained raw live evidence, legacy side reproducing the record",
    status: liveStatus((value) => value.collections >= 1 && value.reproductionOk), evidenceClass: live ? "VERIFIED_BY_REPLAY" : "MISSING",
    observed: live ? `${live.collections} collection(s), reproduction ok: ${live.reproductionOk}` : "raw replay has not run",
    required: "≥ 1 collection, reproduction ok",
  });
  add({
    id: "CA-2", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "Zero wrong commits, zero invariant violations, zero non-fresh selections on live evidence",
    status: liveStatus((value) => value.currentWrong === 0 && value.currentInvariantViolations === 0 && value.selectionsWhileNotFresh === 0),
    evidenceClass: live ? "VERIFIED_BY_REPLAY" : "MISSING",
    observed: live ? `wrong ${live.currentWrong}, violations ${live.currentInvariantViolations}, non-fresh ${live.selectionsWhileNotFresh}` : "raw replay has not run",
    required: "0 / 0 / 0",
  });
  add({
    id: "CA-3", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "No previously correct live case regresses to wrong; no new wrong commit",
    status: liveStatus((value) => value.correctToWrong === 0 && value.newWrong === 0), evidenceClass: live ? "VERIFIED_BY_REPLAY" : "MISSING",
    observed: live ? `correct→wrong ${live.correctToWrong}, new wrong ${live.newWrong}` : "raw replay has not run",
    required: "0 / 0",
  });
  add({
    id: "CA-4", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "Replay is deterministic across independent runs",
    status: liveStatus((value) => value.deterministicAcrossRuns), evidenceClass: live ? "VERIFIED_BY_REPLAY" : "MISSING",
    observed: live ? String(live.deterministicAcrossRuns) : "raw replay has not run", required: "true",
  });
  const cf = evidence.counterfactualsOnLiveBases;
  add({
    id: "CA-5", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "Counterfactual suite on real bases: no expectation failure, no wrong commit, no violation",
    status: !cf ? "MISSING" : cf.families >= 30 && cf.expectationFailures === 0 && cf.wrongAgainstRederivedTruth === 0 && cf.invariantViolations === 0 ? "PASS" : "FAIL",
    evidenceClass: cf ? "SIMULATED" : "MISSING",
    observed: cf ? `${cf.families} families; expectation failures ${cf.expectationFailures}; wrong ${cf.wrongAgainstRederivedTruth}; violations ${cf.invariantViolations}` : "not run on real bases",
    required: "≥ 30 families, 0 / 0 / 0",
  });
  add({
    id: "CA-6", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "Independent live sample large enough for a 5 % bound",
    status: liveStatus((value) => value.trajectories >= ca.trajectories && value.vehicles >= ca.vehicles && value.contestedCases >= ca.contestedCases),
    evidenceClass: live ? "VERIFIED_LIVE_PASSIVE" : "MISSING",
    observed: live ? `${live.trajectories} trajectories, ${live.vehicles} vehicles, ${live.contestedCases} contested cases` : "raw replay has not run",
    required: `≥ ${ca.trajectories} trajectories, ≥ ${ca.vehicles} vehicles, ≥ ${ca.contestedCases} contested cases`,
  });
  add({
    id: "CA-7", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "Route and time diversity",
    status: liveStatus((value) => value.routes >= ca.routes && value.collectionWindows >= ca.collectionWindows && value.timeBands >= ca.timeBands),
    evidenceClass: live ? "VERIFIED_LIVE_PASSIVE" : "MISSING",
    observed: live ? `${live.routes} routes, ${live.collectionWindows} windows, ${live.timeBands} time bands` : "raw replay has not run",
    required: `≥ ${ca.routes} routes, ≥ ${ca.collectionWindows} windows, ≥ ${ca.timeBands} time bands`,
  });

  /* ------------------------------------- READY_FOR_BOUNDED_AUTOMATION */
  const ba = MINIMUMS.boundedAutomation;
  add({
    id: "BA-1", level: "READY_FOR_BOUNDED_AUTOMATION", title: "Independent live sample large enough for a 1 % bound, on the envelope that would be automated",
    status: liveStatus((value) => value.trajectories >= ba.trajectories && value.vehicles >= ba.vehicles && value.contestedCases >= ba.contestedCases
      && value.routes >= ba.routes && value.collectionWindows >= ba.collectionWindows && value.timeBands >= ba.timeBands),
    evidenceClass: live ? "VERIFIED_LIVE_PASSIVE" : "MISSING",
    observed: live ? `${live.trajectories} trajectories, ${live.vehicles} vehicles, ${live.routes} routes, ${live.collectionWindows} windows` : "raw replay has not run",
    required: `≥ ${ba.trajectories} trajectories, ≥ ${ba.vehicles} vehicles, ≥ ${ba.contestedCases} contested, ≥ ${ba.routes} routes, ≥ ${ba.collectionWindows} windows, ≥ ${ba.timeBands} time bands`,
  });
  add({
    id: "BA-2", level: "READY_FOR_BOUNDED_AUTOMATION", title: "Evidence at session cadence (direct TAGO, uncached), not only the cached public path",
    status: liveStatus((value) => value.providerPaths.includes("tago-direct")), evidenceClass: live ? "VERIFIED_LIVE_PASSIVE" : "MISSING",
    observed: live ? `provider paths: ${live.providerPaths.join(", ") || "none"}` : "raw replay has not run",
    required: "includes tago-direct",
  });
  const human = evidence.humanOnlyMitigations;
  add({
    id: "BA-3", level: "READY_FOR_BOUNDED_AUTOMATION", title: "Rider sees the automatically committed bus and can undo it (architecture response to rider-choice risk)",
    status: human.riderSeesAndCanUndoAutomaticPick ? "PASS" : "FAIL", evidenceClass: human.riderSeesAndCanUndoAutomaticPick ? "VERIFIED_BY_TEST" : "MISSING",
    observed: String(human.riderSeesAndCanUndoAutomaticPick), required: "implemented and tested in the rider client",
  });
  add({
    id: "BA-4", level: "READY_FOR_BOUNDED_AUTOMATION", title: "Destination alert timing does not depend on unmeasured provider lag",
    status: human.destinationAlertIndependentOfProviderLag ? "PASS" : "FAIL", evidenceClass: human.destinationAlertIndependentOfProviderLag ? "VERIFIED_BY_TEST" : "MISSING",
    observed: String(human.destinationAlertIndependentOfProviderLag), required: "true",
  });
  add({
    id: "BA-5", level: "READY_FOR_BOUNDED_AUTOMATION", title: "Live Activity shows the committed bus on a physical device",
    status: human.physicalDeviceLiveActivityVerified ? "PASS" : "MISSING", evidenceClass: human.physicalDeviceLiveActivityVerified ? "VERIFIED_LIVE_HUMAN" : "MISSING",
    observed: String(human.physicalDeviceLiveActivityVerified), required: "verified on hardware (a device check, not a ride)",
  });

  /* ------------------------------------- READY_FOR_AUTOMATIC_MATCHING */
  add({
    id: "AM-1", level: "READY_FOR_AUTOMATIC_MATCHING", title: "How often riders board the first arriving bus is measured",
    status: human.riderBoardsFirstArrivingBusMeasured ? "PASS" : "MISSING", evidenceClass: human.riderBoardsFirstArrivingBusMeasured ? "VERIFIED_LIVE_HUMAN" : "MISSING",
    observed: String(human.riderBoardsFirstArrivingBusMeasured),
    required: "measured from real riders; no passive source can establish it, so this level is not a product target",
  });

  let awarded: ReadinessLevel = "NOT_READY";
  let nextLevel: GateResult["nextLevel"];
  for (const level of READINESS_LEVELS.slice(1)) {
    const own = criteria.filter((row) => row.level === level);
    if (own.every((row) => row.status === "PASS")) {
      awarded = level;
      continue;
    }
    nextLevel = {
      level,
      blockedBy: own.filter((row) => row.status !== "PASS").map(({ id, status, observed, required }) => ({ id, status, observed, required })),
    };
    break;
  }
  return { policyVersion: GATE_POLICY_VERSION, generatedAt: evidence.generatedAt, awarded, criteria, ...(nextLevel ? { nextLevel } : {}) };
}
