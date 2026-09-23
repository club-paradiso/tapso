/**
 * The field-validation campaign, counted the same way every time.
 *
 * The broad-real-mode gate in `docs/DATA_VALIDATION.md` asks for 30 observed
 * boardings. One ride is answered by `analyzeRideCapture`, and its
 * `matchGate`. Thirty rides arrive as a directory of phone exports: some raw
 * captures, some sanitized reports whose raw partner was never saved, some
 * duplicates, some from an instrument the repository has not decided about.
 * Counting that by hand is how a report-only ride ends up in the thirty.
 *
 * This module adds no matching logic. Every per-ride number is read out of the
 * report `analyzeRideCapture` produces from the raw capture. What it adds is
 * the bookkeeping: pairing, de-duplication, and a bucket per ride whose rules
 * are the documented ones and nothing more. Where the repository has not
 * decided whether something counts, the ride says `UNRESOLVED` instead of
 * this file deciding.
 */

import { createHash } from "node:crypto";
import {
  analyzeRideCapture,
  type RideCapture,
  type RideCaptureEngine,
  type RideCaptureReport,
} from "./rideCapture.ts";
import type { SelectionVerdict } from "./matchReplay.ts";
import { summarize, type NumberSummary } from "./stats.ts";

export const GATE_BOARDINGS_REQUIRED = 30;
/** `AMBIGUITY_MARGIN` in `matching.ts`, quoted so a margin below it can be flagged. */
export const MATCHER_AMBIGUITY_MARGIN = 12;

export interface CampaignInputFile {
  /** File name only. Never a path, so no home directory reaches the output. */
  name: string;
  content: Uint8Array | string;
}

export type RawRecovery =
  | "EXACT_RAW_FOUND"
  | "COMPATIBLE_RAW_FOUND"
  | "RAW_NOT_FOUND"
  | "AMBIGUOUS_RAW_MATCH";

export type EvidenceBucket =
  | "CLEAN_GATE_CANDIDATE"
  | "HISTORICAL_MATCHER_EVIDENCE"
  | "HISTORICAL_CONFOUNDED"
  | "EXCLUDED"
  | "REPORT_ONLY_NO_RAW";

export interface CampaignRide {
  /** File stem, e.g. `ROUTE-2026-09-13T08-48-19-225Z`. Route id and time, no vehicle. */
  stem: string;
  source: "raw_capture" | "report_only";
  rawRecovery: RawRecovery;
  bucket: EvidenceBucket;
  /** Why the ride sits in its bucket, in the order the rules were checked. */
  reasons: string[];
  /**
   * `UNRESOLVED` when the repository has not decided whether this kind of ride
   * can count. Never set to `DECIDED` by guessing; see `classify`.
   */
  policy: "DECIDED" | "UNRESOLVED";
  routeId: string;
  startedAt?: string;
  captureEngine: RideCaptureEngine | "unknown";
  snapshotCount?: number;
  evidenceVerdict?: string;
  hiddenPeriods?: number;
  hiddenSeconds?: number;
  offlinePeriods?: number;
  /** Present only for rides re-analysed from a raw capture. */
  matchGate?: {
    usableForGate: boolean;
    selectionVerdict: SelectionVerdict;
    contestedDecisions: number;
    candidateMargin: NumberSummary;
    firstCommit?: { snapshotsBefore: number; eligibleCount: number; margin?: number; selectedLabel: string };
    boardedDirectionChanges: number;
    selectionsWhileNotFresh: number;
    boardedCadenceStates: Record<string, number>;
    warnings: string[];
  };
  /** Report-level facts for a report-only ride. Descriptive, never gate evidence. */
  reportOnly?: {
    hasMatchGate: boolean;
    hasCaptureEngine: boolean;
    uniqueVehicleCount?: number;
    /**
     * The `matchGate` the deployed analyzer computed when the ride ended. It
     * cannot be replayed under the current matcher without the raw capture.
     * Copied so a human can see it; never counted.
     */
    rideTimeMatchGate?: {
      usableForGate?: boolean;
      selectionVerdict?: string;
      contestedDecisions?: number;
      boardedDirectionChanges?: number;
      selectionsWhileNotFresh?: number;
    };
  };
  warnings: string[];
}

export interface CampaignFileSummary {
  filesSeen: number;
  reportsDiscovered: number;
  rawCapturesDiscovered: number;
  exactRawMatches: number;
  compatibleRawMatches: number;
  ambiguousRawMatches: number;
  reportsWithoutRaw: number;
  duplicateRawCaptures: string[];
  invalidFiles: Array<{ name: string; reason: string }>;
  ignoredFiles: string[];
}

export interface CampaignReport {
  generatedFrom: "analyzeRideCapture";
  files: CampaignFileSummary;
  rides: CampaignRide[];
  routes: {
    distinctRouteIds: number;
    capturesPerRoute: Record<string, number>;
    cleanGateCandidatesPerRoute: Record<string, number>;
  };
  buckets: Record<EvidenceBucket, number>;
  unresolvedPolicyRides: number;
  modernMatchGate: {
    ridesReanalysed: number;
    usableForGate: number;
    selectionVerdicts: Record<SelectionVerdict, number>;
    contestedDecisionsTotal: number;
    ridesWithContestedDecisions: number;
    /** Per-ride minimum margins. Quantiles cannot be pooled from summaries, so none are invented. */
    perRideMinimumMargins: number[];
    ridesWithMarginBelowAmbiguity: number;
    firstCommitSnapshotsBefore: NumberSummary;
    boardedDirectionChanges: { total: number; max: number };
    selectionsWhileNotFresh: number;
    boardedCadenceStates: Record<string, number>;
  };
  counter: {
    cleanObservedBoardings: number;
    remainingToThirty: number;
    note: string;
  };
  assessment: {
    wrongFirstCommit: boolean;
    silentDirectionReversal: boolean;
    selectionWhileNotFresh: boolean;
    /** Clean rides only. `undefined` when no clean ride committed. */
    correctCommitRate?: number;
    neverCommittedRate?: number;
    cleanRoutes: number;
    multipleRoutes: boolean;
    contestedDecisionsInCleanRides: number;
    /**
     * Whether any clean ride had a second eligible candidate at all. The
     * repository names no count that makes margin evidence sufficient, so this
     * says none or some, and leaves "enough" to a human.
     */
    marginEvidence: "NONE" | "PRESENT";
  };
}

const REPORT_SUFFIX = ".report.json";

/**
 * Build the campaign from the files in one directory.
 *
 * Pure over its input: no file system, no clock, no network. The caller reads
 * the directory, so the input stays read-only by construction.
 */
export function buildCampaign(files: CampaignInputFile[]): CampaignReport {
  const summary: CampaignFileSummary = {
    filesSeen: files.length,
    reportsDiscovered: 0,
    rawCapturesDiscovered: 0,
    exactRawMatches: 0,
    compatibleRawMatches: 0,
    ambiguousRawMatches: 0,
    reportsWithoutRaw: 0,
    duplicateRawCaptures: [],
    invalidFiles: [],
    ignoredFiles: [],
  };

  const raws: Array<{ stem: string; capture: RideCapture; report: RideCaptureReport }> = [];
  const reports: Array<{ stem: string; report: Record<string, unknown> }> = [];
  const seenHashes = new Map<string, string>();
  const vehicleIds = new Set<string>();

  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!file.name.endsWith(".json") || file.name.startsWith(".")) {
      summary.ignoredFiles.push(file.name);
      continue;
    }
    const bytes = typeof file.content === "string" ? new TextEncoder().encode(file.content) : file.content;
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      summary.invalidFiles.push({ name: file.name, reason: "not valid JSON" });
      continue;
    }

    if (isRawCapture(parsed)) {
      summary.rawCapturesDiscovered += 1;
      const hash = createHash("sha256").update(bytes).digest("hex");
      const earlier = seenHashes.get(hash);
      if (earlier) {
        summary.duplicateRawCaptures.push(`${file.name} duplicates ${earlier}`);
        continue;
      }
      seenHashes.set(hash, file.name);
      for (const snapshot of parsed.snapshots) {
        for (const vehicle of snapshot.vehicles ?? []) vehicleIds.add(vehicle.vehicleId);
      }
      if (parsed.boardedVehicleId) vehicleIds.add(parsed.boardedVehicleId);
      try {
        raws.push({ stem: stemOf(file.name), capture: parsed, report: analyzeRideCapture(parsed) });
      } catch (error) {
        // The analyzer's own validation. Its messages name fields, never vehicles.
        summary.invalidFiles.push({ name: file.name, reason: error instanceof Error ? error.message : "rejected by analyzeRideCapture" });
      }
      continue;
    }

    if (isReport(parsed)) {
      summary.reportsDiscovered += 1;
      reports.push({ stem: stemOf(file.name), report: parsed });
      continue;
    }

    summary.invalidFiles.push({ name: file.name, reason: "neither a RideCapture nor a ride report" });
  }

  const rides: CampaignRide[] = raws.map((raw) => rideFromRaw(raw.stem, raw.report));
  const rawByStem = new Map(raws.map((raw, index) => [raw.stem, index]));

  for (const { stem, report } of reports) {
    const exact = rawByStem.get(stem);
    if (exact !== undefined) {
      summary.exactRawMatches += 1;
      continue;
    }
    // A renamed raw is still the same ride if it names the same route and start.
    const compatible = raws
      .map((raw, index) => ({ raw, index }))
      .filter(({ raw }) => raw.capture.routeId === report.routeId && raw.capture.startedAt === report.startedAt);
    if (compatible.length === 1) {
      summary.compatibleRawMatches += 1;
      rides[compatible[0]!.index]!.rawRecovery = "COMPATIBLE_RAW_FOUND";
      continue;
    }
    if (compatible.length > 1) {
      summary.ambiguousRawMatches += 1;
      rides.push(reportOnlyRide(stem, report, "AMBIGUOUS_RAW_MATCH"));
      continue;
    }
    summary.reportsWithoutRaw += 1;
    rides.push(reportOnlyRide(stem, report, "RAW_NOT_FOUND"));
  }

  rides.sort((a, b) => a.stem.localeCompare(b.stem));
  const campaign = aggregate(summary, rides);
  assertSanitized(campaign, vehicleIds);
  return campaign;
}

/**
 * One ride's bucket, from the report `analyzeRideCapture` produced from its raw
 * capture. The same rules `buildCampaign` applies to a folder, exported so the
 * collector's submission pipeline classifies a ride exactly the same way.
 */
export function classifyReplayedRide(stem: string, report: RideCaptureReport): CampaignRide {
  return rideFromRaw(stem, report);
}

function rideFromRaw(stem: string, report: RideCaptureReport): CampaignRide {
  const gate = report.matchGate;
  const ride: CampaignRide = {
    stem,
    source: "raw_capture",
    rawRecovery: "EXACT_RAW_FOUND",
    bucket: "EXCLUDED",
    reasons: [],
    policy: "DECIDED",
    routeId: report.routeId,
    startedAt: report.startedAt,
    captureEngine: report.captureEngine,
    snapshotCount: report.snapshotCount,
    evidenceVerdict: report.evidenceCompleteness.verdict,
    hiddenPeriods: report.lifecycle.hiddenPeriods,
    hiddenSeconds: report.lifecycle.hiddenSeconds,
    offlinePeriods: report.lifecycle.offlinePeriods,
    matchGate: {
      usableForGate: gate.usableForGate,
      selectionVerdict: gate.selectionVerdict,
      contestedDecisions: gate.contestedDecisions,
      candidateMargin: gate.candidateMargin,
      ...(gate.firstCommit
        ? {
          firstCommit: {
            snapshotsBefore: gate.firstCommit.snapshotsBefore,
            eligibleCount: gate.firstCommit.eligibleCount,
            ...(gate.firstCommit.margin !== undefined ? { margin: gate.firstCommit.margin } : {}),
            selectedLabel: gate.firstCommit.selectedLabel,
          },
        }
        : {}),
      boardedDirectionChanges: gate.directionReversal.boardedDirectionChanges,
      selectionsWhileNotFresh: gate.staleData.selectionsWhileNotFresh,
      boardedCadenceStates: { ...gate.staleData.boardedCadenceStates },
      warnings: [...gate.warnings],
    },
    warnings: [...report.warnings],
  };
  classify(ride);
  return ride;
}

/**
 * The bucket rules. Each one is either stated in `docs/DATA_VALIDATION.md` or
 * is the absence of a statement, reported as `UNRESOLVED`.
 *
 *  - `usableForGate=false` never counts (documented).
 *  - `wrong`, a direction change on the boarded bus, or a selection on
 *    non-fresh cadence each fail a documented criterion. The ride is excluded
 *    from the count and surfaced as a gate failure, never hidden.
 *  - Browser background suspension makes polling gaps unattributable
 *    (documented as `CONFOUNDED`), so a capture that was hidden or offline is
 *    historical at best.
 *  - `railway-background` is the collector the repository accepted for
 *    unattended polling, so a clean replay from it is a gate candidate.
 *  - Whether a `local-device`, `cli` or engine-less capture with no suspension
 *    can count is not written down anywhere. Those rides stay historical and
 *    are marked `UNRESOLVED` rather than promoted by this file.
 */
function classify(ride: CampaignRide): void {
  const gate = ride.matchGate!;
  if (!gate.usableForGate) {
    ride.bucket = "EXCLUDED";
    ride.reasons.push("matchGate.usableForGate is false");
    return;
  }
  const failures: string[] = [];
  if (gate.selectionVerdict === "wrong") failures.push("GATE_FAILURE: first commit was not the boarded vehicle");
  if (gate.boardedDirectionChanges > 0) failures.push("GATE_FAILURE: boarded vehicle changed direction");
  if (gate.selectionsWhileNotFresh > 0) failures.push("GATE_FAILURE: matcher selected on non-fresh cadence");
  if (failures.length > 0) {
    ride.bucket = "EXCLUDED";
    ride.reasons.push(...failures);
    return;
  }
  const suspended = (ride.hiddenPeriods ?? 0) > 0 || (ride.offlinePeriods ?? 0) > 0;
  if (suspended && ride.captureEngine !== "railway-background") {
    ride.bucket = "HISTORICAL_CONFOUNDED";
    ride.reasons.push("recorder was hidden or offline, so polling gaps cannot be attributed to TAGO");
    return;
  }
  if (ride.captureEngine === "railway-background") {
    ride.bucket = "CLEAN_GATE_CANDIDATE";
    ride.reasons.push("usable replay from the server-side collector with every criterion clean");
    return;
  }
  ride.bucket = "HISTORICAL_MATCHER_EVIDENCE";
  ride.policy = "UNRESOLVED";
  ride.reasons.push(
    ride.captureEngine === "unknown"
      ? "captureEngine is missing; provenance is not inferred"
      : `repository has not decided whether a ${ride.captureEngine} capture counts toward the thirty`,
  );
}

/**
 * A report without its raw. It never counts, because the current matcher
 * cannot be replayed from it. That includes a modern Railway report carrying a
 * ride-time `matchGate`: decided 2026-09-23 in favour of exporting the raw
 * capture instead (`GET /capture/:id/raw`), so replayability is never traded
 * for convenience. The ride-time gate is shown for reference only.
 */
function reportOnlyRide(stem: string, report: Record<string, unknown>, rawRecovery: RawRecovery): CampaignRide {
  const lifecycle = (report.lifecycle ?? {}) as Record<string, number>;
  const evidence = (report.evidenceCompleteness ?? {}) as { verdict?: string };
  const gate = report.matchGate as undefined | {
    usableForGate?: boolean;
    selectionVerdict?: string;
    contestedDecisions?: number;
    directionReversal?: { boardedDirectionChanges?: number };
    staleData?: { selectionsWhileNotFresh?: number };
  };
  return {
    stem,
    source: "report_only",
    rawRecovery,
    bucket: "REPORT_ONLY_NO_RAW",
    reasons: [
      rawRecovery === "AMBIGUOUS_RAW_MATCH"
        ? "more than one raw capture matches this report; none was chosen"
        : "no raw capture, so the current matcher cannot be replayed",
      ...(gate
        ? ["carries a ride-time matchGate, shown for reference; a report without its raw never counts"]
        : ["report predates matchGate"]),
    ],
    policy: "DECIDED",
    routeId: String(report.routeId ?? "unknown"),
    ...(typeof report.startedAt === "string" ? { startedAt: report.startedAt } : {}),
    captureEngine: typeof report.captureEngine === "string" ? report.captureEngine as RideCaptureEngine : "unknown",
    ...(typeof report.snapshotCount === "number" ? { snapshotCount: report.snapshotCount } : {}),
    ...(evidence.verdict ? { evidenceVerdict: evidence.verdict } : {}),
    ...(typeof lifecycle.hiddenPeriods === "number" ? { hiddenPeriods: lifecycle.hiddenPeriods } : {}),
    ...(typeof lifecycle.hiddenSeconds === "number" ? { hiddenSeconds: lifecycle.hiddenSeconds } : {}),
    ...(typeof lifecycle.offlinePeriods === "number" ? { offlinePeriods: lifecycle.offlinePeriods } : {}),
    reportOnly: {
      hasMatchGate: "matchGate" in report,
      hasCaptureEngine: "captureEngine" in report,
      ...(typeof report.uniqueVehicleCount === "number" ? { uniqueVehicleCount: report.uniqueVehicleCount } : {}),
      ...(gate
        ? {
          rideTimeMatchGate: {
            ...(typeof gate.usableForGate === "boolean" ? { usableForGate: gate.usableForGate } : {}),
            ...(typeof gate.selectionVerdict === "string" ? { selectionVerdict: gate.selectionVerdict } : {}),
            ...(typeof gate.contestedDecisions === "number" ? { contestedDecisions: gate.contestedDecisions } : {}),
            ...(typeof gate.directionReversal?.boardedDirectionChanges === "number"
              ? { boardedDirectionChanges: gate.directionReversal.boardedDirectionChanges }
              : {}),
            ...(typeof gate.staleData?.selectionsWhileNotFresh === "number"
              ? { selectionsWhileNotFresh: gate.staleData.selectionsWhileNotFresh }
              : {}),
          },
        }
        : {}),
    },
    warnings: [],
  };
}

function aggregate(files: CampaignFileSummary, rides: CampaignRide[]): CampaignReport {
  const buckets: Record<EvidenceBucket, number> = {
    CLEAN_GATE_CANDIDATE: 0,
    HISTORICAL_MATCHER_EVIDENCE: 0,
    HISTORICAL_CONFOUNDED: 0,
    EXCLUDED: 0,
    REPORT_ONLY_NO_RAW: 0,
  };
  const capturesPerRoute: Record<string, number> = {};
  const cleanPerRoute: Record<string, number> = {};
  for (const ride of rides) {
    buckets[ride.bucket] += 1;
    capturesPerRoute[ride.routeId] = (capturesPerRoute[ride.routeId] ?? 0) + 1;
    if (ride.bucket === "CLEAN_GATE_CANDIDATE") cleanPerRoute[ride.routeId] = (cleanPerRoute[ride.routeId] ?? 0) + 1;
  }

  const replayed = rides.filter((ride) => ride.matchGate);
  const verdicts: Record<SelectionVerdict, number> = { correct: 0, wrong: 0, never_committed: 0, no_boarded_vehicle: 0 };
  const cadence: Record<string, number> = { fresh: 0, aging: 0, stale: 0, unknown: 0 };
  const minimumMargins: number[] = [];
  const snapshotsBefore: number[] = [];
  let contested = 0;
  let ridesContested = 0;
  let directionTotal = 0;
  let directionMax = 0;
  let staleSelections = 0;
  for (const ride of replayed) {
    const gate = ride.matchGate!;
    verdicts[gate.selectionVerdict] += 1;
    contested += gate.contestedDecisions;
    if (gate.contestedDecisions > 0) ridesContested += 1;
    if (gate.candidateMargin.min !== undefined) minimumMargins.push(gate.candidateMargin.min);
    if (gate.firstCommit) snapshotsBefore.push(gate.firstCommit.snapshotsBefore);
    directionTotal += gate.boardedDirectionChanges;
    directionMax = Math.max(directionMax, gate.boardedDirectionChanges);
    staleSelections += gate.selectionsWhileNotFresh;
    for (const [state, count] of Object.entries(gate.boardedCadenceStates)) cadence[state] = (cadence[state] ?? 0) + count;
  }

  const clean = rides.filter((ride) => ride.bucket === "CLEAN_GATE_CANDIDATE");
  const cleanCommitted = clean.filter((ride) => ride.matchGate!.firstCommit);
  const cleanCorrect = clean.filter((ride) => ride.matchGate!.selectionVerdict === "correct").length;
  const cleanNever = clean.filter((ride) => ride.matchGate!.selectionVerdict === "never_committed").length;
  const cleanContested = clean.reduce((sum, ride) => sum + ride.matchGate!.contestedDecisions, 0);
  const cleanRoutes = Object.keys(cleanPerRoute).length;

  return {
    generatedFrom: "analyzeRideCapture",
    files,
    rides,
    routes: {
      distinctRouteIds: Object.keys(capturesPerRoute).length,
      capturesPerRoute: sortKeys(capturesPerRoute),
      cleanGateCandidatesPerRoute: sortKeys(cleanPerRoute),
    },
    buckets,
    unresolvedPolicyRides: rides.filter((ride) => ride.policy === "UNRESOLVED").length,
    modernMatchGate: {
      ridesReanalysed: replayed.length,
      usableForGate: replayed.filter((ride) => ride.matchGate!.usableForGate).length,
      selectionVerdicts: verdicts,
      contestedDecisionsTotal: contested,
      ridesWithContestedDecisions: ridesContested,
      perRideMinimumMargins: minimumMargins.sort((a, b) => a - b),
      ridesWithMarginBelowAmbiguity: minimumMargins.filter((margin) => margin < MATCHER_AMBIGUITY_MARGIN).length,
      firstCommitSnapshotsBefore: summarize(snapshotsBefore),
      boardedDirectionChanges: { total: directionTotal, max: directionMax },
      selectionsWhileNotFresh: staleSelections,
      boardedCadenceStates: cadence,
    },
    counter: {
      cleanObservedBoardings: clean.length,
      remainingToThirty: Math.max(0, GATE_BOARDINGS_REQUIRED - clean.length),
      note: "Reaching 30 alone does NOT close the gate: every criterion in docs/DATA_VALIDATION.md must also hold.",
    },
    assessment: {
      wrongFirstCommit: verdicts.wrong > 0,
      silentDirectionReversal: directionTotal > 0,
      selectionWhileNotFresh: staleSelections > 0,
      ...(cleanCommitted.length > 0 ? { correctCommitRate: round2(cleanCorrect / cleanCommitted.length) } : {}),
      ...(clean.length > 0 ? { neverCommittedRate: round2(cleanNever / clean.length) } : {}),
      cleanRoutes,
      multipleRoutes: cleanRoutes >= 2,
      contestedDecisionsInCleanRides: cleanContested,
      marginEvidence: cleanContested === 0 ? "NONE" : "PRESENT",
    },
  };
}

/**
 * A raw vehicle number anywhere in the output is a bug. The analyzer already
 * pseudonymises; this is the second lock on the same door.
 */
function assertSanitized(campaign: CampaignReport, vehicleIds: Set<string>): void {
  const text = JSON.stringify(campaign);
  for (const id of vehicleIds) {
    if (id && text.includes(id)) throw new Error("campaign output would contain a raw vehicle identifier");
  }
  if (/"(latitude|longitude)"\s*:/.test(text)) throw new Error("campaign output would contain coordinates");
}

function isRawCapture(value: unknown): value is RideCapture {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.snapshots)
    && Array.isArray(candidate.stops)
    && typeof candidate.routeId === "string"
    && typeof candidate.boardingStopSequence === "number";
}

function isReport(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.evidenceCompleteness === "object"
    && typeof candidate.routeId === "string"
    && !Array.isArray(candidate.snapshots);
}

function stemOf(name: string): string {
  if (name.endsWith(REPORT_SUFFIX)) return name.slice(0, -REPORT_SUFFIX.length);
  return name.endsWith(".json") ? name.slice(0, -".json".length) : name;
}

function sortKeys(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A short Markdown summary for a human. Same numbers as the JSON, nothing more. */
export function renderCampaignMarkdown(campaign: CampaignReport): string {
  const { files, buckets, counter, modernMatchGate: gate, assessment, routes } = campaign;
  const lines = [
    "# Field-validation campaign",
    "",
    `Generated by \`buildCampaign\` from \`analyzeRideCapture\`. ${counter.note}`,
    "",
    "## Counter",
    "",
    `- Clean observed boardings: **${counter.cleanObservedBoardings}**`,
    `- Remaining to thirty: **${counter.remainingToThirty}**`,
    `- Rides whose counting policy is UNRESOLVED: ${campaign.unresolvedPolicyRides}`,
    "",
    "## Files",
    "",
    `| Reports | Raw captures | Exact raw | Compatible raw | Ambiguous | Reports without raw | Duplicates | Invalid |`,
    `|---|---|---|---|---|---|---|---|`,
    `| ${files.reportsDiscovered} | ${files.rawCapturesDiscovered} | ${files.exactRawMatches} | ${files.compatibleRawMatches} | ${files.ambiguousRawMatches} | ${files.reportsWithoutRaw} | ${files.duplicateRawCaptures.length} | ${files.invalidFiles.length} |`,
    "",
    "## Evidence buckets",
    "",
    ...Object.entries(buckets).map(([bucket, count]) => `- ${bucket}: ${count}`),
    "",
    "## Modern match gate (re-analysed rides only)",
    "",
    `- Re-analysed: ${gate.ridesReanalysed}, usableForGate: ${gate.usableForGate}`,
    `- Verdicts: correct ${gate.selectionVerdicts.correct}, wrong ${gate.selectionVerdicts.wrong}, never_committed ${gate.selectionVerdicts.never_committed}, no_boarded_vehicle ${gate.selectionVerdicts.no_boarded_vehicle}`,
    `- Contested decisions: ${gate.contestedDecisionsTotal} across ${gate.ridesWithContestedDecisions} rides; rides with a margin below ${MATCHER_AMBIGUITY_MARGIN}: ${gate.ridesWithMarginBelowAmbiguity}`,
    `- Boarded direction changes: total ${gate.boardedDirectionChanges.total}, max ${gate.boardedDirectionChanges.max}`,
    `- Selections while not fresh: ${gate.selectionsWhileNotFresh}`,
    `- Boarded cadence states: ${Object.entries(gate.boardedCadenceStates).map(([state, count]) => `${state} ${count}`).join(", ")}`,
    "",
    "## Assessment",
    "",
    `- Wrong first commit: ${assessment.wrongFirstCommit ? "**YES — gate failure**" : "no"}`,
    `- Silent direction reversal: ${assessment.silentDirectionReversal ? "**YES — gate failure**" : "no"}`,
    `- Selection while not fresh: ${assessment.selectionWhileNotFresh ? "**YES — fail-closed bug**" : "no"}`,
    `- Correct-commit rate (clean, committed): ${assessment.correctCommitRate ?? "n/a"}`,
    `- Never-committed rate (clean): ${assessment.neverCommittedRate ?? "n/a"}`,
    `- Clean routes: ${assessment.cleanRoutes} (multiple: ${assessment.multipleRoutes ? "yes" : "no"})`,
    `- Margin evidence in clean rides: ${assessment.marginEvidence} (${assessment.contestedDecisionsInCleanRides} contested decisions)`,
    "",
    "## Routes",
    "",
    `Distinct routeIds: ${routes.distinctRouteIds}`,
    "",
    "| routeId | captures | clean |",
    "|---|---|---|",
    ...Object.entries(routes.capturesPerRoute).map(([route, count]) => `| ${route} | ${count} | ${routes.cleanGateCandidatesPerRoute[route] ?? 0} |`),
    "",
    "## Rides",
    "",
    "| Ride | Bucket | Policy | Engine | Snapshots | Hidden | Verdict | Reason |",
    "|---|---|---|---|---|---|---|---|",
    ...campaign.rides.map((ride) =>
      `| ${ride.stem} | ${ride.bucket} | ${ride.policy} | ${ride.captureEngine} | ${ride.snapshotCount ?? "—"} | ${ride.hiddenPeriods ?? "—"} | ${ride.matchGate?.selectionVerdict ?? (ride.reportOnly?.rideTimeMatchGate?.selectionVerdict ? `ride-time ${ride.reportOnly.rideTimeMatchGate.selectionVerdict}` : "—")} | ${ride.reasons.join("; ")} |`),
    "",
  ];
  return lines.join("\n");
}
