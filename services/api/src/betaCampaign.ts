/**
 * The beta matcher field campaign: a separate, versioned policy for rides
 * recorded by invited beta testers.
 *
 * Two different questions share the broad-real-mode gate in
 * `docs/DATA_VALIDATION.md`, and this file answers only one of them:
 *
 *   A. Provider / cadence calibration — how late TAGO reports a stop the bus
 *      physically reached. That needs physical stop markers (`markerLagSamples`)
 *      and stays the operator campaign's job. It is a prerequisite of its own.
 *   B. Matcher correctness in the field — given a real boarding, would the
 *      current matcher have committed to the bus the rider actually boarded?
 *
 * Beta testers never tap physical-stop markers, so their rides carry no marker
 * lag, and they can never inform (A). They can inform (B), because (B)'s
 * ground truth is the bus the rider confirmed before boarding, which the
 * collector re-verified on an uncached provider read at start, not anything
 * the matcher inferred. The matcher replay reads the boarding stop the rider
 * picked and the snapshots; it never reads the boarded vehicle id to decide.
 *
 * Nothing here changes `classifyReplayedRide`, the v1 buckets, or the v1
 * campaign. A beta ride is classified by v1's own rules first (recorded as
 * information), then by the stricter v2 rules below, and it lands in its own
 * campaign set. Thirty clean beta rides satisfy the matcher field-sample part
 * of the gate at most: `gateClosed` stays `false`, automatic matching stays
 * disabled, and provider/cadence calibration remains a separate requirement.
 */

import type { FieldRideSubmission } from "./fieldValidation.ts";
import { GATE_BOARDINGS_REQUIRED } from "./rideCampaign.ts";
import type { SelectionVerdict } from "./matchReplay.ts";
import type { RideCaptureReport } from "./rideCapture.ts";

export const BETA_MATCHER_CAMPAIGN_ID = "beta-matcher-30-boardings-v2";
export const BETA_MATCHER_POLICY_VERSION = "beta-matcher-v2";

export type BetaMatcherBucket =
  /** Every v2 criterion holds and the matcher's first commit was the boarded bus. Counts. */
  | "MATCHER_FIELD_CLEAN"
  /** A documented gate criterion failed: wrong bus, direction change, or a stale selection. Never hidden. */
  | "MATCHER_FIELD_FAILURE"
  /** Safe, but not evidence of matcher correctness (never committed, too little data, …). */
  | "MATCHER_FIELD_NOT_COUNTED";

/**
 * The evidence-completeness criteria a beta ride must meet, by the names
 * `analyzeRideCapture` already uses. `markerLagSamples` is deliberately absent:
 * it measures provider lag against physical markers, which is calibration
 * question (A), not whether the matcher picked the right bus.
 */
export const BETA_REQUIRED_EVIDENCE = [
  "trackedVehiclePresent",
  "successfulSnapshots",
  "trackedSequenceProgression",
  "contentChangeSamples",
] as const;

export const BETA_EXCLUDED_EVIDENCE = ["markerLagSamples", "arrivalObserved"] as const;

export interface BetaMatcherCriterion {
  name: string;
  met: boolean;
  observed?: number | string;
  required?: number | string;
}

export interface BetaMatcherClassification {
  policyVersion: typeof BETA_MATCHER_POLICY_VERSION;
  bucket: BetaMatcherBucket;
  reasons: string[];
  criteria: BetaMatcherCriterion[];
  /** Where the ground truth came from. Always the tester, never the matcher. */
  groundTruth: "tester_confirmed_vehicle_server_verified_at_start";
  /** Recorded for provider calibration bookkeeping only; never gates a beta ride. */
  markerLagSamples: number;
}

/**
 * Classify one beta ride under v2, from the report `analyzeRideCapture`
 * produced from its raw. Every number is read out of that one current replay;
 * no matcher logic is duplicated here. The caller also records what v1's
 * `classifyReplayedRide` says about the same report, for comparison.
 */
export function classifyBetaMatcherRide(report: RideCaptureReport): BetaMatcherClassification {
  const gate = report.matchGate;
  const evidence = new Map(report.evidenceCompleteness.criteria.map((criterion) => [criterion.name, criterion]));
  const criteria: BetaMatcherCriterion[] = [];
  const reasons: string[] = [];

  const engineOk = report.captureEngine === "railway-background";
  criteria.push({ name: "captureEngine", met: engineOk, observed: report.captureEngine, required: "railway-background" });

  for (const name of BETA_REQUIRED_EVIDENCE) {
    const criterion = evidence.get(name);
    criteria.push({
      name,
      met: Boolean(criterion?.met),
      ...(criterion ? { observed: criterion.observed, required: criterion.minimum } : {}),
    });
  }

  criteria.push({ name: "usableForGate", met: gate.usableForGate });
  criteria.push({ name: "selectionVerdict", met: gate.selectionVerdict === "correct", observed: gate.selectionVerdict, required: "correct" });
  criteria.push({ name: "boardedDirectionChanges", met: gate.directionReversal.boardedDirectionChanges === 0, observed: gate.directionReversal.boardedDirectionChanges, required: 0 });
  criteria.push({ name: "selectionsWhileNotFresh", met: gate.staleData.selectionsWhileNotFresh === 0, observed: gate.staleData.selectionsWhileNotFresh, required: 0 });

  const markerLagSamples = Number(evidence.get("markerLagSamples")?.observed ?? 0);
  const base = {
    policyVersion: BETA_MATCHER_POLICY_VERSION as typeof BETA_MATCHER_POLICY_VERSION,
    criteria,
    groundTruth: "tester_confirmed_vehicle_server_verified_at_start" as const,
    markerLagSamples,
  };

  // Failures first: they are what the gate exists to catch, so they are
  // surfaced whatever else is missing.
  const failures: string[] = [];
  if (gate.selectionVerdict === "wrong") failures.push("GATE_FAILURE: first commit was not the boarded vehicle");
  if (gate.directionReversal.boardedDirectionChanges > 0) failures.push("GATE_FAILURE: boarded vehicle changed direction");
  if (gate.staleData.selectionsWhileNotFresh > 0) failures.push("GATE_FAILURE: matcher selected on non-fresh cadence");
  if (failures.length > 0) return { ...base, bucket: "MATCHER_FIELD_FAILURE", reasons: failures };

  if (!engineOk) reasons.push("capture was not collected by the Railway background collector");
  if (!gate.usableForGate) reasons.push("matchGate.usableForGate is false");
  for (const name of BETA_REQUIRED_EVIDENCE) {
    if (!evidence.get(name)?.met) reasons.push(`evidence criterion ${name} not met`);
  }
  if (gate.selectionVerdict === "never_committed") {
    reasons.push("the matcher never committed during the ride: safe, but not evidence that it picks the right bus");
  } else if (gate.selectionVerdict !== "correct") {
    reasons.push(`selectionVerdict is ${gate.selectionVerdict}`);
  }
  if (reasons.length > 0) return { ...base, bucket: "MATCHER_FIELD_NOT_COUNTED", reasons };

  return {
    ...base,
    bucket: "MATCHER_FIELD_CLEAN",
    reasons: [`every ${BETA_MATCHER_POLICY_VERSION} criterion holds and the first commit was the tester-confirmed bus`],
  };
}

/* ------------------------------------------------------------ campaign view */

export interface BetaCampaignSummary {
  campaignId: string;
  policyVersion: typeof BETA_MATCHER_POLICY_VERSION;
  /** What 30 clean beta rides can satisfy: the matcher field-sample portion, nothing else. */
  matcherFieldRides: { clean: number; target: number; remaining: number };
  /** Always this value. Beta rides carry no physical markers. */
  providerCadenceCalibration: "SEPARATE_REQUIREMENT_NOT_ADDRESSED_BY_BETA_RIDES";
  /** Always false. A human closes the gate, and only with calibration evidence too. */
  gateClosed: false;
  automaticMatching: "disabled";
  note: string;
  submissions: number;
  testers: number;
  routes: number;
  cleanRoutes: number;
  buckets: Record<BetaMatcherBucket, number>;
  verdictCounts: Record<SelectionVerdict, number>;
  contestedDecisions: number;
  ridesWithContestedDecisions: number;
  directionReversals: number;
  staleSelections: number;
  alerts: string[];
}

export function summarizeBetaCampaign(campaignId: string, records: FieldRideSubmission[]): BetaCampaignSummary {
  const buckets: Record<BetaMatcherBucket, number> = {
    MATCHER_FIELD_CLEAN: 0,
    MATCHER_FIELD_FAILURE: 0,
    MATCHER_FIELD_NOT_COUNTED: 0,
  };
  const verdicts: Record<SelectionVerdict, number> = { correct: 0, wrong: 0, never_committed: 0, no_boarded_vehicle: 0 };
  const testers = new Set<string>();
  const routes = new Set<string>();
  const cleanRoutes = new Set<string>();
  const alerts: string[] = [];
  let contested = 0;
  let contestedRides = 0;
  let reversals = 0;
  let stale = 0;
  for (const record of records) {
    const beta = record.matcherCampaign;
    if (!beta || beta.policyVersion !== BETA_MATCHER_POLICY_VERSION) {
      // A record without the v2 block in this set is a bookkeeping bug. It is
      // shown, never counted.
      alerts.push(`submission ${record.id} has no ${BETA_MATCHER_POLICY_VERSION} classification and is not counted`);
      continue;
    }
    buckets[beta.bucket] += 1;
    verdicts[record.selectionVerdict] += 1;
    testers.add(beta.testerId);
    routes.add(record.routeId);
    if (beta.bucket === "MATCHER_FIELD_CLEAN") cleanRoutes.add(record.routeId);
    contested += record.contestedDecisions;
    if (record.contestedDecisions > 0) contestedRides += 1;
    reversals += record.boardedDirectionChanges;
    stale += record.selectionsWhileNotFresh;
    if (record.replayAgreesWithRideTimeReport === false) {
      alerts.push(`submission ${record.id} replays differently under the current matcher than at ride time`);
    }
    if (record.sameRideAs) alerts.push(`submission ${record.id} shares route, start and engine with ${record.sameRideAs}`);
  }
  if (verdicts.wrong > 0) alerts.unshift(`GATE_FAILURE: ${verdicts.wrong} ride(s) committed to the wrong bus`);
  if (reversals > 0) alerts.unshift(`GATE_FAILURE: ${reversals} boarded direction change(s)`);
  if (stale > 0) alerts.unshift(`FAIL_CLOSED_BUG: ${stale} selection(s) on non-fresh cadence`);
  const clean = buckets.MATCHER_FIELD_CLEAN;
  return {
    campaignId,
    policyVersion: BETA_MATCHER_POLICY_VERSION,
    matcherFieldRides: { clean, target: GATE_BOARDINGS_REQUIRED, remaining: Math.max(0, GATE_BOARDINGS_REQUIRED - clean) },
    providerCadenceCalibration: "SEPARATE_REQUIREMENT_NOT_ADDRESSED_BY_BETA_RIDES",
    gateClosed: false,
    automaticMatching: "disabled",
    note: "Beta rides answer only whether the matcher picks the boarded bus. Reaching 30 does NOT close the gate or enable "
      + "automatic matching: provider/cadence calibration with physical markers is a separate requirement, every "
      + "criterion in docs/DATA_VALIDATION.md must hold, and a human must decide.",
    submissions: records.length,
    testers: testers.size,
    routes: routes.size,
    cleanRoutes: cleanRoutes.size,
    buckets,
    verdictCounts: verdicts,
    contestedDecisions: contested,
    ridesWithContestedDecisions: contestedRides,
    directionReversals: reversals,
    staleSelections: stale,
    alerts,
  };
}
