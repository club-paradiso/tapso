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
 * The independent unit is the *trajectory*: one bus on one route direction in
 * one collection window, counted only when it contributed at least one
 * evaluated case (`liveReplayEvidence.ts`). Pseudo-boarding cases are not the
 * unit: cases from one trajectory share the bus, the timing and the
 * competitors, and counting them separately would overstate the sample roughly
 * twenty-fold. For the same reason a bus split into two runs by a feed gap is
 * one unit, never two. Contested trajectories (a waiting-rider case in which a
 * second vehicle was plausible at a decision) are counted separately because
 * the ambiguity rules only act there; 30 of them bound the per-trajectory
 * contested failure rate at 10 %.
 *
 * Bounded automation commits for riders at session cadence, so its sample is
 * the session-cadence subset alone (direct TAGO, uncached); the 20 s-cached
 * public path is a different regime and does not count toward it.
 *
 * The Passive Shadow v3 evidence of record has 29 trajectories with cases (by
 * its own trajectory split) and 27 vehicles from one window, so it meets
 * neither the confirmation-assisted nor the automation minimum. These numbers
 * were not fitted to it.
 */
export const MINIMUMS = {
  confirmationAssisted: { trajectories: 60, vehicles: 30, routes: 8, contestedTrajectories: 30, collectionWindows: 3, timeBands: 2 },
  boundedAutomation: { trajectories: 300, vehicles: 100, routes: 15, contestedTrajectories: 100, collectionWindows: 10, timeBands: 3 },
  propertySeedsPerInvariant: 2_000,
} as const;

/**
 * Every negative control SH-4 requires, by id. A control that disappears from
 * the catalogue must disappear from here too, in a reviewed change; a report
 * that lacks any of these as KILLED fails SH-4 however complete it says it is.
 */
export const PINNED_NEGATIVE_CONTROLS = [
  "F1", "F1b", "F1c", "F3a", "F3b", "F3c", "F3d", "F4",
  "M-memory", "M-fresh", "M-content", "M-regress", "M-error", "M-margin", "M-topology", "M-repeat", "M-onboard", "M-legacy-import",
  "F1-unguarded", "F1b-onboard", "F3b-order", "F3-guard-input", "F3-guard-snapshot", "F3c-pass",
  "F4-unobserved", "F4-carry", "F4-onboard-late", "F4-onboard-left", "F4-onboard-roster",
  "M-memory-reach", "M-stale-compete", "M-stale-compete-onboard", "M-unknown",
  "H-perturb-live", "H-truth-flag", "H-live-guard", "H-raw-ids",
  "F9-margin-window", "F10-remembered-crossing", "F10-remembered-window", "F11-pre-passage-row", "F12-first-look",
  "F13-receipt-order", "F14-vehicle-guard", "F14-stop-guard", "H-policy-label", "H-truth-timing", "H-readiness-clamp",
  "H-live-stale", "H-pinned-controls", "H-live-omitted", "H-live-units", "H-live-carried", "H-mitigation-criterion",
  "H-coordinator-wiring", "H-matches-shadow",
  "F12-late", "F15-forgotten", "F15-unseen-time", "F15-unknown-out-of-sight", "F16-first-sighting", "F16-onboard-competes",
  "F17-loop-crossing", "F17-loop-window", "F17-loop-exclusion", "F17-reached-after", "F15-onboard-not-theirs", "F15-placed-twice", "F15-unplaced-row",
  "F15-future-sighting", "F17-lost-loop", "F18-lap", "F18-conflict", "F19-two-routes", "F19-invariant-route",
  "F20-never-watched", "F20-others-ignored", "F20-selected-first", "F20-first-sighting", "F20-watch-never-ends", "F20-reselect",
  "R23-returned", "R23-back", "R23-lap", "R23-unproven", "R23-short-loop", "R24-lap", "R24-order", "R25-spread",
  "R27-exclusion", "R27-memory", "R28-mark", "R29-own", "R29-own-lap",
  "R30-unknown", "R30-never-placed", "F20-watch-ends-early", "R31-reason", "R31-one-place",
  "R31-other-route", "R31-speed", "R31-loop-back", "R33-merge", "R33-order", "R34-seam",
  "R30-never-placed-loop", "R30-never-placed-plain", "R30-never-placed-twice", "R30-never-placed-edge",
  "R31-place-time", "R31-watch-start", "R33-tie", "R33-retry", "R33-mode", "R34-window", "R34-sort", "R40-bound",
  "R40-margin", "R40-unknown-time", "R42-anchor", "R43-read-back", "R43-possibility", "R43-remembered",
  "R44-end-merge", "R44-earliest",
  "R46-misread", "R47-loop-edge", "R48-order-first-seen", "R48-order-remembered",
] as const;

/** The criterion each human-only mitigation answers, and the only kind of evidence that can show it. */
export const MITIGATION_CRITERIA = {
  riderSeesAndCanUndoAutomaticPick: { criterion: "BA-3", evidenceKind: "tests" },
  destinationAlertIndependentOfProviderLag: { criterion: "BA-4", evidenceKind: "tests" },
  physicalDeviceLiveActivityVerified: { criterion: "BA-5", evidenceKind: "human_record" },
  riderBoardsFirstArrivingBusMeasured: { criterion: "AM-1", evidenceKind: "human_record" },
} as const;

export type MitigationKey = keyof typeof MITIGATION_CRITERIA;

/** One declared mitigation, as `ops/matcher-evidence/human-only-mitigations.json` states it. */
export interface MitigationEntry {
  met: boolean;
  evidenceKind: "tests" | "human_record";
  evidence: { tests?: string[]; record?: string } | null;
  source: string;
}

/**
 * A mitigation counts only with evidence that can exist for it alone: tests
 * named for its criterion (`"BA-3: …"`) that passed in the same suite run, or
 * a committed human record for exactly this property that names what was done,
 * on what, when, by whom, and that it passed. A bare `met: true` is a claim.
 */
export function mitigationEvidenceHolds(
  key: MitigationKey,
  entry: MitigationEntry,
  context: { passingTests: readonly string[]; readRecord: (record: string) => unknown },
): { holds: boolean; reason: string } {
  const { criterion, evidenceKind } = MITIGATION_CRITERIA[key];
  if (entry.met !== true) return { holds: false, reason: "not declared met" };
  if (entry.evidenceKind !== evidenceKind) return { holds: false, reason: `${criterion} can only be shown by ${evidenceKind}` };
  if (evidenceKind === "tests") {
    const tests = entry.evidence?.tests ?? [];
    const passing = new Set(context.passingTests);
    if (tests.length === 0) return { holds: false, reason: "no test named" };
    const foreign = tests.filter((name) => !name.startsWith(`${criterion}: `));
    if (foreign.length > 0) return { holds: false, reason: `tests not named for ${criterion}: ${foreign.join("; ")}` };
    const missing = tests.filter((name) => !passing.has(name));
    if (missing.length > 0) return { holds: false, reason: `did not pass in this suite run: ${missing.join("; ")}` };
    return { holds: true, reason: `${tests.length} test(s) named for ${criterion} passed` };
  }
  const record = entry.evidence?.record;
  const content = record ? context.readRecord(record) : undefined;
  if (!content || typeof content !== "object") return { holds: false, reason: "no committed human record" };
  const row = content as Record<string, unknown>;
  const text = (field: string) => typeof row[field] === "string" && (row[field] as string).trim().length > 0;
  const problems = [
    row.evidenceClass === "VERIFIED_LIVE_HUMAN" ? "" : "evidenceClass is not VERIFIED_LIVE_HUMAN",
    row.property === key ? "" : `property is not ${key}`,
    row.criterion === criterion ? "" : `criterion is not ${criterion}`,
    text("procedure") ? "" : "no procedure",
    text("subject") ? "" : "no subject (device, build or sample)",
    text("performedBy") ? "" : "no performedBy",
    typeof row.performedAt === "string" && Number.isFinite(Date.parse(row.performedAt)) ? "" : "performedAt is not a date",
    row.result === "pass" ? "" : "result is not pass",
  ].filter(Boolean);
  return problems.length === 0
    ? { holds: true, reason: `human record for ${criterion}` }
    : { holds: false, reason: problems.join("; ") };
}

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
    /** The ids of the controls the run killed; every pinned control must be among them. */
    killedIds: string[];
  };
  /** `scripts/matcher-evidence/redecide-ledger.ts` over the evidence-of-record ledger. */
  formerWrongCommitInstants?: {
    records: number;
    legacyReproduced: number;
    currentCommits: number;
  };
  /**
   * `scripts/matcher-evidence/live-evidence.ts` over retained raw live
   * collections (`liveReplayEvidence.ts` states the counting rules). Absent
   * until it has run.
   */
  liveReplay?: {
    collections: number;
    reproductionOk: boolean;
    deterministicAcrossRuns: boolean;
    /** Digest of the matcher and evaluation sources that produced this evidence. */
    matcherSourceSha256: string;
    /** Retained artifacts that could not be fetched or verified; any one makes the replay incomplete. */
    omittedArtifacts: string[];
    /** Windows evaluated before whose raw is gone: their failures are in the counts below, their sample is not. */
    carriedForward: number;
    cases: number;
    /** Independent units: one bus on one route direction in one window, with at least one evaluated case. */
    trajectories: number;
    trajectoriesWithCommit: number;
    vehicles: number;
    routes: number;
    collectionWindows: number;
    timeBands: number;
    /** Units with a waiting-rider case in which a second vehicle was plausible. */
    contestedTrajectories: number;
    currentWrong: number;
    currentInvariantViolations: number;
    selectionsWhileNotFresh: number;
    correctToWrong: number;
    newWrong: number;
    providerPaths: string[];
    /** The same sample dimensions over session-cadence windows only (direct TAGO, uncached). */
    sessionCadence: {
      trajectories: number;
      vehicles: number;
      routes: number;
      collectionWindows: number;
      timeBands: number;
      contestedTrajectories: number;
    };
  };
  /** `scripts/matcher-evidence/live-evidence.ts`: the counterfactual suite over real bases. Absent until it has run on real bases. */
  counterfactualsOnLiveBases?: {
    families: number;
    expectationFailures: number;
    wrongAgainstRederivedTruth: number;
    invariantViolations: number;
    /** Digest of the matcher and evaluation sources that produced this evidence. */
    matcherSourceSha256: string;
  };
  /**
   * Digest of the current matcher and evaluation sources. Live and
   * counterfactual evidence produced by any other sources is stale: it says
   * nothing about the matcher being gated.
   */
  currentMatcherSourceSha256?: string;
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
    evidenceClass: evidence.matcher.legacyFreeServingPaths === undefined ? "MISSING" : "VERIFIED_BY_TEST",
    observed: `${evidence.matcher.policyVersion}; legacy-free serving paths: ${String(evidence.matcher.legacyFreeServingPaths)}`,
    required: "directed-route-progress-v1 and no serving import of matchingLegacy.ts",
  });
  add({
    id: "SH-2", level: "READY_FOR_SHADOW", title: "Formal invariant enforced at runtime on every result",
    status: bool(evidence.matcher.runtimeInvariantEnforced),
    evidenceClass: evidence.matcher.runtimeInvariantEnforced === undefined ? "MISSING" : "VERIFIED_BY_TEST",
    observed: String(evidence.matcher.runtimeInvariantEnforced), required: "true",
  });
  const tests = evidence.tests;
  add({
    id: "SH-3", level: "READY_FOR_SHADOW", title: "Unit, replay and property suites pass over all 15 invariants",
    status: !tests ? "MISSING"
      : tests.suitePassed && tests.propertyInvariantsCovered >= 15 && tests.propertySeedsPerInvariant >= MINIMUMS.propertySeedsPerInvariant ? "PASS" : "FAIL",
    evidenceClass: tests ? "VERIFIED_BY_TEST" : "MISSING",
    observed: tests ? `passed=${tests.suitePassed}, invariants=${tests.propertyInvariantsCovered}, seeds/invariant=${tests.propertySeedsPerInvariant}, regression seeds=${tests.propertyRegressionSeedsReplayed}` : "not supplied",
    required: `suite green, 15 invariants, ≥ ${MINIMUMS.propertySeedsPerInvariant} seeds each`,
  });
  const controls = evidence.negativeControls;
  const unpinned = controls ? PINNED_NEGATIVE_CONTROLS.filter((id) => !controls.killedIds.includes(id)) : [];
  add({
    id: "SH-4", level: "READY_FOR_SHADOW", title: "Every negative control (F1, F3 leak paths, F4, fail-closed rules) is killed",
    status: !controls ? "MISSING"
      : controls.total > 0 && controls.killed === controls.total && controls.survived === 0 && controls.stale === 0
        && controls.invalid === 0 && controls.timeout === 0 && controls.complete && controls.baselineGreen && controls.realTreeUnchanged
        && unpinned.length === 0
        ? "PASS" : "FAIL",
    evidenceClass: controls ? "VERIFIED_BY_TEST" : "MISSING",
    observed: controls
      ? `${controls.killed}/${controls.total} killed, ${controls.survived} survived, ${controls.stale} stale, ${controls.invalid} invalid, `
        + `${controls.timeout} timed out; complete ${controls.complete}, baseline green ${controls.baselineGreen}, tree unchanged ${controls.realTreeUnchanged}`
        + (unpinned.length > 0 ? `; pinned controls not killed: ${unpinned.join(", ")}` : `; all ${PINNED_NEGATIVE_CONTROLS.length} pinned controls killed`)
      : "not supplied",
    required: `a complete run on a green baseline and an unchanged tree: all killed, none survived, stale, invalid or timed out, and each of the ${PINNED_NEGATIVE_CONTROLS.length} pinned controls among the killed`,
  });
  const instants = evidence.formerWrongCommitInstants;
  add({
    id: "SH-5", level: "READY_FOR_SHADOW", title: "No former live wrong commit is still a commit at its instant",
    status: !instants ? "MISSING"
      : instants.records > 0 && instants.legacyReproduced === instants.records && instants.currentCommits === 0 ? "PASS" : "FAIL",
    evidenceClass: instants ? "VERIFIED_BY_REPLAY" : "MISSING",
    observed: instants ? `${instants.currentCommits} commits at ${instants.records} instants; legacy reproduced ${instants.legacyReproduced}` : "not supplied",
    required: "0 commits; legacy reproduces every recorded selection",
  });
  const posture = evidence.deploymentPosture;
  add({
    id: "SH-6", level: "READY_FOR_SHADOW", title: "Automatic matching off by default, and an opt-in refused below bounded automation",
    status: !posture ? "MISSING" : posture.automaticMatchingOffEverywhere ? "PASS" : "FAIL",
    evidenceClass: !posture ? "MISSING" : posture.checkedBy === "live_health_endpoint" ? "VERIFIED_LIVE_INFRASTRUCTURE" : "VERIFIED_BY_TEST",
    observed: posture ? `off: ${posture.automaticMatchingOffEverywhere} (${posture.checkedBy === "live_health_endpoint"
      ? "read from live /health"
      : "configuration evaluated, no live deployment read"})` : "not supplied",
    required: "off",
  });

  /* ----------------------------------- READY_FOR_CONFIRMATION_ASSISTED */
  // Live and counterfactual evidence speak only for the sources that produced
  // them. Evidence from other sources, or with no digest to compare, is stale:
  // the matcher it describes is not the one being gated.
  const current = evidence.currentMatcherSourceSha256;
  const fresh = (digest: string | undefined) => current !== undefined && digest === current;
  const live = evidence.liveReplay && fresh(evidence.liveReplay.matcherSourceSha256) ? evidence.liveReplay : undefined;
  const liveAbsent = evidence.liveReplay ? "stale: produced by other matcher sources" : "raw replay has not run";
  const liveStatus = (test: (value: NonNullable<GateEvidence["liveReplay"]>) => boolean): CriterionStatus =>
    (!live ? "MISSING" : test(live) ? "PASS" : "FAIL");
  const ca = MINIMUMS.confirmationAssisted;
  add({
    id: "CA-1", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "Full-window blind replay of every retained raw live collection, legacy side reproducing the record",
    status: liveStatus((value) => value.collections >= 1 && value.reproductionOk && value.omittedArtifacts.length === 0),
    evidenceClass: live ? "VERIFIED_BY_REPLAY" : "MISSING",
    observed: live
      ? `${live.collections} collection(s), reproduction ok: ${live.reproductionOk}, omitted artifacts: ${live.omittedArtifacts.length}, carried forward: ${live.carriedForward}`
      : liveAbsent,
    required: "≥ 1 collection, reproduction ok, no retained artifact left out",
  });
  add({
    id: "CA-2", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "Zero wrong commits, zero invariant violations, zero non-fresh selections on live evidence",
    status: liveStatus((value) => value.currentWrong === 0 && value.currentInvariantViolations === 0 && value.selectionsWhileNotFresh === 0),
    evidenceClass: live ? "VERIFIED_BY_REPLAY" : "MISSING",
    observed: live ? `wrong ${live.currentWrong}, violations ${live.currentInvariantViolations}, non-fresh ${live.selectionsWhileNotFresh}` : liveAbsent,
    required: "0 / 0 / 0",
  });
  add({
    id: "CA-3", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "No previously correct live case regresses to wrong; no new wrong commit",
    status: liveStatus((value) => value.correctToWrong === 0 && value.newWrong === 0), evidenceClass: live ? "VERIFIED_BY_REPLAY" : "MISSING",
    observed: live ? `correct→wrong ${live.correctToWrong}, new wrong ${live.newWrong}` : liveAbsent,
    required: "0 / 0",
  });
  add({
    id: "CA-4", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "Replay is deterministic across independent runs, case by case",
    status: liveStatus((value) => value.deterministicAcrossRuns), evidenceClass: live ? "VERIFIED_BY_REPLAY" : "MISSING",
    observed: live ? String(live.deterministicAcrossRuns) : liveAbsent, required: "true",
  });
  const cf = evidence.counterfactualsOnLiveBases && fresh(evidence.counterfactualsOnLiveBases.matcherSourceSha256)
    ? evidence.counterfactualsOnLiveBases
    : undefined;
  add({
    id: "CA-5", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "Counterfactual suite on real bases: no expectation failure, no wrong commit, no violation",
    status: !cf ? "MISSING" : cf.families >= 30 && cf.expectationFailures === 0 && cf.wrongAgainstRederivedTruth === 0 && cf.invariantViolations === 0 ? "PASS" : "FAIL",
    evidenceClass: cf ? "SIMULATED" : "MISSING",
    observed: cf
      ? `${cf.families} families; expectation failures ${cf.expectationFailures}; wrong ${cf.wrongAgainstRederivedTruth}; violations ${cf.invariantViolations}`
      : evidence.counterfactualsOnLiveBases ? "stale: produced by other matcher sources" : "not run on real bases",
    required: "≥ 30 families, 0 / 0 / 0",
  });
  add({
    id: "CA-6", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "Independent live sample large enough for a 5 % bound",
    status: liveStatus((value) => value.trajectories >= ca.trajectories && value.vehicles >= ca.vehicles
      && value.contestedTrajectories >= ca.contestedTrajectories),
    evidenceClass: live ? "VERIFIED_LIVE_PASSIVE" : "MISSING",
    observed: live ? `${live.trajectories} trajectories, ${live.vehicles} vehicles, ${live.contestedTrajectories} contested trajectories` : liveAbsent,
    required: `≥ ${ca.trajectories} trajectories, ≥ ${ca.vehicles} vehicles, ≥ ${ca.contestedTrajectories} contested trajectories`,
  });
  add({
    id: "CA-7", level: "READY_FOR_CONFIRMATION_ASSISTED", title: "Route and time diversity",
    status: liveStatus((value) => value.routes >= ca.routes && value.collectionWindows >= ca.collectionWindows && value.timeBands >= ca.timeBands),
    evidenceClass: live ? "VERIFIED_LIVE_PASSIVE" : "MISSING",
    observed: live ? `${live.routes} routes, ${live.collectionWindows} windows, ${live.timeBands} time bands` : liveAbsent,
    required: `≥ ${ca.routes} routes, ≥ ${ca.collectionWindows} windows, ≥ ${ca.timeBands} time bands`,
  });

  /* ------------------------------------- READY_FOR_BOUNDED_AUTOMATION */
  const ba = MINIMUMS.boundedAutomation;
  add({
    id: "BA-1", level: "READY_FOR_BOUNDED_AUTOMATION", title: "Independent live sample large enough for a 1 % bound, at session cadence (the envelope that would be automated)",
    status: liveStatus(({ sessionCadence: value }) => value.trajectories >= ba.trajectories && value.vehicles >= ba.vehicles
      && value.contestedTrajectories >= ba.contestedTrajectories && value.routes >= ba.routes
      && value.collectionWindows >= ba.collectionWindows && value.timeBands >= ba.timeBands),
    evidenceClass: live ? "VERIFIED_LIVE_PASSIVE" : "MISSING",
    observed: live
      ? `at session cadence: ${live.sessionCadence.trajectories} trajectories, ${live.sessionCadence.vehicles} vehicles, `
        + `${live.sessionCadence.contestedTrajectories} contested, ${live.sessionCadence.routes} routes, ${live.sessionCadence.collectionWindows} windows, `
        + `${live.sessionCadence.timeBands} time bands`
      : liveAbsent,
    required: `at session cadence: ≥ ${ba.trajectories} trajectories, ≥ ${ba.vehicles} vehicles, ≥ ${ba.contestedTrajectories} contested, `
      + `≥ ${ba.routes} routes, ≥ ${ba.collectionWindows} windows, ≥ ${ba.timeBands} time bands`,
  });
  add({
    id: "BA-2", level: "READY_FOR_BOUNDED_AUTOMATION", title: "Evidence at session cadence (direct TAGO, uncached) with evaluated cases, not only the cached public path",
    status: liveStatus((value) => value.sessionCadence.trajectories > 0), evidenceClass: live ? "VERIFIED_LIVE_PASSIVE" : "MISSING",
    observed: live ? `session-cadence trajectories: ${live.sessionCadence.trajectories}; provider paths: ${live.providerPaths.join(", ") || "none"}` : liveAbsent,
    required: "session-cadence windows with evaluated cases",
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
