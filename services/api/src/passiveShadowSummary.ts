/**
 * Passive Shadow Validation v3 — evidence summary.
 *
 * Live evidence and synthetic evidence are computed in separate functions from
 * separate inputs, and the live function refuses any result whose source class
 * is not `LIVE_PASSIVE`. Raw vehicle numbers never leave this module: they are
 * replaced by run-level pseudonyms (`veh-01`, …) and the finished summary is
 * checked for every raw id before it is returned.
 */

import { summarize, type NumberSummary } from "./stats.ts";
import { TAGO_CADENCE_POLICY_V1 } from "./sourceFreshness.ts";
import {
  PASSIVE_CASE_POLICY_V1,
  PASSIVE_SHADOW_CAMPAIGN_ID,
  PASSIVE_SHADOW_POLICY_VERSION,
  PASSIVE_SHADOW_SCHEMA_VERSION,
  sortedSnapshots,
  streamSha256,
  type GeneratedCases,
  type GeneratorRejection,
  type PassiveCaseGeneratorPolicy,
  type PassiveObservationStream,
  type PassiveScenario,
} from "./passiveShadow.ts";
import {
  COMMITTED_BUCKETS,
  PASSIVE_BUCKETS,
  type Difficulty,
  type PassiveBucket,
  type PassiveCaseResult,
} from "./passiveShadowEvaluate.ts";
import type { PerturbationFamily, PerturbedResult } from "./passiveShadowPerturb.ts";

export type BucketCounts = Record<PassiveBucket, number>;

export interface RateMetrics {
  cases: number;
  /** Cases minus provider failures and insufficient evidence. */
  evaluable: number;
  committed: number;
  /** correct / committed. `null` when nothing was committed. */
  committedSelectionPrecision: number | null;
  /** committed / evaluable. */
  coverage: number | null;
  /** wrong / evaluable. */
  wrongCommitRate: number | null;
  /** (abstained + ambiguous) / evaluable. */
  abstentionRate: number | null;
}

export interface StreamSummary {
  streamId: string;
  routeId: string;
  sourceClass: string;
  providerPath: string;
  collectorEngine: string;
  startedAt?: string;
  endedAt?: string;
  snapshots: number;
  failedSnapshots: number;
  emptySnapshots: number;
  duplicateReceiptsDropped: number;
  receiptIntervalSeconds: NumberSummary;
  vehiclesSeen: number;
  maxConcurrentVehicles: number;
  sha256: string;
  stopReason?: string;
}

export interface CaseDiagnostic {
  caseId: string;
  scenario: PassiveScenario;
  routeId: string;
  boardingSequence: number;
  bucket: PassiveBucket;
  reason: string;
  groundTruth: string;
  groundTruthCaseLabel: string;
  matcherFinalChoice: string | null;
  commitRelativeToBoardingSeconds?: number;
  wrongKind?: string;
  difficulty: Difficulty;
  candidateCount: number;
  freshnessState: Record<string, number>;
  directionState: { committedDirectionInconsistency: boolean; directionRejections: number };
  timeline: Array<{
    at: string;
    status: string;
    selected?: string;
    margin?: number;
    top: Array<{ label: string; score: number; stopSequence?: number; cadence?: string; rejected: string[] }>;
  }>;
}

export interface LiveSection {
  sourceClass: "LIVE_PASSIVE";
  captures: number;
  trajectories: number;
  trajectoriesWithCases: number;
  boardingEvents: number;
  cases: number;
  independentVehicles: number;
  routes: string[];
  timeSpan: { from?: string; to?: string; hoursObserved: number };
  generatorRejections: Record<GeneratorRejection, number>;
  buckets: BucketCounts;
  metrics: RateMetrics;
  byScenario: Record<string, { buckets: BucketCounts; metrics: RateMetrics }>;
  byRoute: Record<string, BucketCounts>;
  byVehicle: Record<string, BucketCounts>;
  byHourKst: Record<string, BucketCounts>;
  byDifficulty: Record<string, { buckets: BucketCounts; metrics: RateMetrics }>;
  candidateCountDistribution: Record<string, number>;
  grouped: {
    byTrajectory: { total: number; withWrongCommit: number; withCorrectCommitOnly: number; neverCommitted: number };
    byBoardingEvent: { total: number; withWrongCommit: number; withCorrectCommitOnly: number; neverCommitted: number };
  };
  wrongCommits: CaseDiagnostic[];
  staleSelections: number;
  /** Vehicles that appeared in more than one route's stream: real route-variant / direction identity changes. */
  crossRouteVehicles: number;
}

export interface AdversarialVariantSummary {
  id: string;
  family: PerturbationFamily;
  usesTruthIdentity: boolean;
  evaluated: number;
  skipped: number;
  buckets: BucketCounts;
  correct: number;
  wrong: number;
  abstained: number;
  casesWithStaleRejection: number;
  casesWithDirectionRejection: number;
  /** Baseline (unperturbed) bucket → perturbed bucket, only where it changed. */
  flips: Record<string, number>;
}

export interface PassiveShadowSummary {
  schemaVersion: typeof PASSIVE_SHADOW_SCHEMA_VERSION;
  policyVersion: typeof PASSIVE_SHADOW_POLICY_VERSION;
  campaignId: typeof PASSIVE_SHADOW_CAMPAIGN_ID;
  createdAt: string;
  automaticMatching: "disabled";
  gateClosed: false;
  groundTruthModel: "passive_first_arrival_model";
  generatorPolicy: PassiveCaseGeneratorPolicy;
  cadencePolicyReference: typeof TAGO_CADENCE_POLICY_V1;
  collection: StreamSummary[];
  live: LiveSection;
  adversarial: {
    sourceClass: "SYNTHETIC_OR_PERTURBED";
    note: string;
    basisCases: number;
    variants: AdversarialVariantSummary[];
  };
  diagnostics: CaseDiagnostic[];
  limitations: string[];
}

export interface SummaryInput {
  streams: PassiveObservationStream[];
  generated: GeneratedCases;
  results: PassiveCaseResult[];
  perturbed: Array<{ baseline: PassiveCaseResult; variants: PerturbedResult[] }>;
  createdAt: string;
  policy?: PassiveCaseGeneratorPolicy;
  maxDiagnostics?: number;
}

export function emptyBuckets(): BucketCounts {
  return Object.fromEntries(PASSIVE_BUCKETS.map((bucket) => [bucket, 0])) as BucketCounts;
}

export function rateMetrics(results: PassiveCaseResult[]): RateMetrics {
  const buckets = countBuckets(results);
  const evaluable = results.length - buckets.PASSIVE_PROVIDER_FAILURE - buckets.PASSIVE_INSUFFICIENT_EVIDENCE;
  const committed = results.filter((result) => COMMITTED_BUCKETS.has(result.bucket)).length;
  return {
    cases: results.length,
    evaluable,
    committed,
    committedSelectionPrecision: ratio(buckets.PASSIVE_CORRECT, committed),
    coverage: ratio(committed, evaluable),
    wrongCommitRate: ratio(buckets.PASSIVE_WRONG, evaluable),
    abstentionRate: ratio(buckets.PASSIVE_ABSTAINED + buckets.PASSIVE_AMBIGUOUS, evaluable),
  };
}

export function countBuckets(results: PassiveCaseResult[]): BucketCounts {
  const counts = emptyBuckets();
  for (const result of results) counts[result.bucket] += 1;
  return counts;
}

/**
 * The live section. Throws if anything but `LIVE_PASSIVE` reaches it — a
 * synthetic case in a live count is a validation failure, not a rounding error.
 */
export function summarizeLive(
  streams: PassiveObservationStream[],
  generated: GeneratedCases,
  results: PassiveCaseResult[],
  pseudonym: (vehicleId: string) => string,
  maxDiagnostics = 50,
): LiveSection {
  for (const result of results) {
    if (result.sourceClass !== "LIVE_PASSIVE" || result.perturbation !== undefined) {
      throw new Error(`result ${result.caseId} is ${result.sourceClass}${result.perturbation ? ` (${result.perturbation})` : ""} and cannot enter the live section`);
    }
  }
  const liveStreams = streams.filter((stream) => stream.sourceClass === "LIVE_PASSIVE");
  const liveStreamIds = new Set(liveStreams.map((stream) => stream.streamId));
  const trajectories = generated.trajectories.filter((trajectory) => liveStreamIds.has(trajectory.streamId));
  const times = liveStreams.flatMap((stream) => sortedSnapshots(stream).map((snapshot) => Date.parse(snapshot.capturedAt)));
  const from = times.length ? Math.min(...times) : undefined;
  const to = times.length ? Math.max(...times) : undefined;

  const group = <K extends string>(key: (result: PassiveCaseResult) => K) => {
    const map: Record<string, PassiveCaseResult[]> = {};
    for (const result of results) (map[key(result)] ??= []).push(result);
    return map;
  };
  const withMetrics = (map: Record<string, PassiveCaseResult[]>) =>
    Object.fromEntries(Object.entries(map).map(([key, list]) => [key, { buckets: countBuckets(list), metrics: rateMetrics(list) }]));
  const bucketsOnly = (map: Record<string, PassiveCaseResult[]>) =>
    Object.fromEntries(Object.entries(map).map(([key, list]) => [key, countBuckets(list)]));

  const candidateCountDistribution: Record<string, number> = {};
  for (const result of results) {
    const key = result.candidateCount >= 5 ? "5+" : String(result.candidateCount);
    candidateCountDistribution[key] = (candidateCountDistribution[key] ?? 0) + 1;
  }

  const vehicleRoutes = new Map<string, Set<string>>();
  for (const trajectory of trajectories) {
    const stream = liveStreams.find((item) => item.streamId === trajectory.streamId)!;
    const routes = vehicleRoutes.get(trajectory.vehicleId) ?? new Set<string>();
    routes.add(stream.routeId);
    vehicleRoutes.set(trajectory.vehicleId, routes);
  }

  return {
    sourceClass: "LIVE_PASSIVE",
    captures: liveStreams.length,
    trajectories: trajectories.length,
    trajectoriesWithCases: new Set(results.map((result) => result.meta.trajectoryId)).size,
    boardingEvents: new Set(results.map((result) => result.meta.boardingEventId)).size,
    cases: results.length,
    independentVehicles: new Set(results.map((result) => result.groundTruthVehicleId)).size,
    routes: [...new Set(results.map((result) => result.meta.routeId))].sort(),
    timeSpan: {
      ...(from === undefined ? {} : { from: new Date(from).toISOString() }),
      ...(to === undefined ? {} : { to: new Date(to).toISOString() }),
      hoursObserved: from === undefined ? 0 : Math.round(((to! - from) / 3_600_000) * 100) / 100,
    },
    generatorRejections: generated.rejections,
    buckets: countBuckets(results),
    metrics: rateMetrics(results),
    byScenario: withMetrics(group((result) => result.meta.scenario)),
    byRoute: bucketsOnly(group((result) => result.meta.routeId)),
    byVehicle: bucketsOnly(group((result) => pseudonym(result.groundTruthVehicleId))),
    byHourKst: bucketsOnly(group((result) => kstHour(result.meta.sessionStartAt))),
    byDifficulty: withMetrics(group((result) => result.difficulty)),
    candidateCountDistribution,
    grouped: {
      byTrajectory: groupOutcome(results, (result) => result.meta.trajectoryId),
      byBoardingEvent: groupOutcome(results, (result) => result.meta.boardingEventId),
    },
    wrongCommits: results
      .filter((result) => result.bucket === "PASSIVE_WRONG")
      .slice(0, maxDiagnostics)
      .map((result) => diagnostic(result, pseudonym)),
    staleSelections: results.reduce((sum, result) => sum + result.selectionsWhileNotFresh, 0),
    crossRouteVehicles: [...vehicleRoutes.values()].filter((routes) => routes.size > 1).length,
  };
}

function groupOutcome(results: PassiveCaseResult[], key: (result: PassiveCaseResult) => string) {
  const groups = new Map<string, PassiveCaseResult[]>();
  for (const result of results) {
    const list = groups.get(key(result)) ?? [];
    list.push(result);
    groups.set(key(result), list);
  }
  let withWrongCommit = 0;
  let withCorrectCommitOnly = 0;
  let neverCommitted = 0;
  for (const list of groups.values()) {
    const committed = list.filter((result) => COMMITTED_BUCKETS.has(result.bucket));
    if (list.some((result) => result.bucket === "PASSIVE_WRONG")) withWrongCommit += 1;
    else if (committed.length > 0 && committed.every((result) => result.bucket === "PASSIVE_CORRECT")) withCorrectCommitOnly += 1;
    else if (committed.length === 0) neverCommitted += 1;
  }
  return { total: groups.size, withWrongCommit, withCorrectCommitOnly, neverCommitted };
}

export function summarizeAdversarial(
  perturbed: Array<{ baseline: PassiveCaseResult; variants: PerturbedResult[] }>,
): PassiveShadowSummary["adversarial"] {
  const variants = new Map<string, AdversarialVariantSummary>();
  for (const { baseline, variants: list } of perturbed) {
    for (const entry of list) {
      const id = entry.perturbation.id;
      const summary = variants.get(id) ?? {
        id,
        family: entry.perturbation.family,
        usesTruthIdentity: entry.perturbation.usesTruthIdentity,
        evaluated: 0,
        skipped: 0,
        buckets: emptyBuckets(),
        correct: 0,
        wrong: 0,
        abstained: 0,
        casesWithStaleRejection: 0,
        casesWithDirectionRejection: 0,
        flips: {},
      };
      if (!entry.result) {
        summary.skipped += 1;
      } else {
        const result = entry.result;
        if (result.sourceClass !== "SYNTHETIC_OR_PERTURBED") throw new Error(`perturbed result ${result.caseId} lost its synthetic label`);
        summary.evaluated += 1;
        summary.buckets[result.bucket] += 1;
        if (result.bucket === "PASSIVE_CORRECT") summary.correct += 1;
        else if (result.bucket === "PASSIVE_WRONG") summary.wrong += 1;
        else if (!COMMITTED_BUCKETS.has(result.bucket)) summary.abstained += 1;
        if (result.staleRejections > 0) summary.casesWithStaleRejection += 1;
        if (result.directionRejections > 0) summary.casesWithDirectionRejection += 1;
        if (result.bucket !== baseline.bucket) {
          const flip = `${baseline.bucket}→${result.bucket}`;
          summary.flips[flip] = (summary.flips[flip] ?? 0) + 1;
        }
      }
      variants.set(id, summary);
    }
  }
  return {
    sourceClass: "SYNTHETIC_OR_PERTURBED",
    note: "Perturbations of real cases. Robustness evidence only; never counted as live evidence. "
      + "Variants marked usesTruthIdentity were built with knowledge of the answer.",
    basisCases: perturbed.length,
    variants: [...variants.values()],
  };
}

export function buildPassiveShadowSummary(input: SummaryInput): PassiveShadowSummary {
  const pseudonyms = new Map<string, string>();
  const allVehicleIds = new Set<string>();
  for (const stream of input.streams) {
    for (const snapshot of sortedSnapshots(stream)) {
      for (const vehicle of snapshot.vehicles) {
        allVehicleIds.add(vehicle.vehicleId);
        if (!pseudonyms.has(vehicle.vehicleId)) {
          pseudonyms.set(vehicle.vehicleId, `veh-${String(pseudonyms.size + 1).padStart(2, "0")}`);
        }
      }
    }
  }
  const pseudonym = (vehicleId: string) => pseudonyms.get(vehicleId) ?? (vehicleId.startsWith("SYNTHETIC-") ? vehicleId : "veh-unknown");
  const live = summarizeLive(
    input.streams,
    input.generated,
    input.results.filter((result) => result.sourceClass === "LIVE_PASSIVE"),
    pseudonym,
    input.maxDiagnostics,
  );
  const diagnostics = input.results
    .filter((result) => result.bucket !== "PASSIVE_CORRECT")
    .sort((left, right) => severity(left.bucket) - severity(right.bucket))
    .slice(0, input.maxDiagnostics ?? 50)
    .map((result) => diagnostic(result, pseudonym));

  const summary: PassiveShadowSummary = {
    schemaVersion: PASSIVE_SHADOW_SCHEMA_VERSION,
    policyVersion: PASSIVE_SHADOW_POLICY_VERSION,
    campaignId: PASSIVE_SHADOW_CAMPAIGN_ID,
    createdAt: input.createdAt,
    automaticMatching: "disabled",
    gateClosed: false,
    groundTruthModel: "passive_first_arrival_model",
    generatorPolicy: input.policy ?? PASSIVE_CASE_POLICY_V1,
    cadencePolicyReference: TAGO_CADENCE_POLICY_V1,
    collection: input.streams.map(streamSummary),
    live,
    adversarial: summarizeAdversarial(input.perturbed),
    diagnostics,
    limitations: [
      "Ground truth is the first-arrival rider model, not an observed boarding. It cannot see a rider who lets a bus go.",
      "Cases from one trajectory, one boarding event or one stream are correlated; read the grouped counts, not only raw cases.",
      "Only the backend matcher (services/api/src/matching.ts) is evaluated; the Swift engine is not.",
      "Passive data cannot measure provider lag against a physical stop, user interaction, iPhone/Safari behaviour or restart UX.",
    ],
  };
  assertNoRawVehicleIds(summary, [...allVehicleIds]);
  return summary;
}

function streamSummary(stream: PassiveObservationStream): StreamSummary {
  const snapshots = sortedSnapshots(stream);
  const successful = snapshots.filter((snapshot) => !snapshot.error);
  const intervals: number[] = [];
  for (let index = 1; index < successful.length; index += 1) {
    intervals.push((Date.parse(successful[index]!.capturedAt) - Date.parse(successful[index - 1]!.capturedAt)) / 1_000);
  }
  return {
    streamId: stream.streamId,
    routeId: stream.routeId,
    sourceClass: stream.sourceClass,
    providerPath: stream.providerPath,
    collectorEngine: stream.collectorEngine,
    ...(snapshots[0] ? { startedAt: snapshots[0].capturedAt } : {}),
    ...(snapshots.at(-1) ? { endedAt: snapshots.at(-1)!.capturedAt } : {}),
    snapshots: snapshots.length,
    failedSnapshots: snapshots.length - successful.length,
    emptySnapshots: successful.filter((snapshot) => snapshot.vehicles.length === 0).length,
    duplicateReceiptsDropped: stream.duplicateReceiptsDropped,
    receiptIntervalSeconds: summarize(intervals),
    vehiclesSeen: new Set(successful.flatMap((snapshot) => snapshot.vehicles.map((vehicle) => vehicle.vehicleId))).size,
    maxConcurrentVehicles: Math.max(0, ...successful.map((snapshot) => snapshot.vehicles.length)),
    sha256: streamSha256(stream),
    ...(stream.stopReason ? { stopReason: stream.stopReason } : {}),
  };
}

function diagnostic(result: PassiveCaseResult, pseudonym: (vehicleId: string) => string): CaseDiagnostic {
  const timeline = (result.timeline ?? [])
    .filter((decision, index, list) => index === 0
      || decision.status !== list[index - 1]!.status
      || decision.selectedLabel !== list[index - 1]!.selectedLabel)
    .slice(0, 40)
    .map((decision) => ({
      at: decision.at,
      status: decision.status,
      ...(decision.selectedLabel ? { selected: decision.selectedLabel } : {}),
      ...(decision.margin === undefined ? {} : { margin: decision.margin }),
      top: decision.candidates.slice(0, 4).map((candidate) => ({
        label: candidate.label,
        score: candidate.score,
        ...(candidate.stopSequence === undefined ? {} : { stopSequence: candidate.stopSequence }),
        ...(candidate.cadence === undefined ? {} : { cadence: candidate.cadence }),
        rejected: candidate.rejectedReasons,
      })),
    }));
  return {
    caseId: result.caseId,
    scenario: result.meta.scenario,
    routeId: result.meta.routeId,
    boardingSequence: result.meta.boardingSequence,
    bucket: result.bucket,
    reason: result.reason,
    groundTruth: pseudonym(result.groundTruthVehicleId),
    groundTruthCaseLabel: result.groundTruthLabel,
    matcherFinalChoice: result.committedVehicleId === undefined ? null : pseudonym(result.committedVehicleId),
    ...(result.commitRelativeToBoardingSeconds === undefined ? {} : { commitRelativeToBoardingSeconds: result.commitRelativeToBoardingSeconds }),
    ...(result.wrongKind ? { wrongKind: result.wrongKind } : {}),
    difficulty: result.difficulty,
    candidateCount: result.candidateCount,
    freshnessState: result.groundTruthCadence,
    directionState: {
      committedDirectionInconsistency: result.committedDirectionInconsistency,
      directionRejections: result.directionRejections,
    },
    timeline,
  };
}

function severity(bucket: PassiveBucket): number {
  return [
    "PASSIVE_WRONG",
    "PASSIVE_STALE_FAILURE",
    "PASSIVE_DIRECTION_FAILURE",
    "PASSIVE_AMBIGUOUS",
    "PASSIVE_ABSTAINED",
    "PASSIVE_PROVIDER_FAILURE",
    "PASSIVE_INSUFFICIENT_EVIDENCE",
    "PASSIVE_CORRECT",
  ].indexOf(bucket);
}

function kstHour(iso: string): string {
  const hour = (new Date(iso).getUTCHours() + 9) % 24;
  return `${String(hour).padStart(2, "0")}h`;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

export function assertNoRawVehicleIds(value: unknown, vehicleIds: string[]): void {
  const encoded = JSON.stringify(value);
  for (const vehicleId of vehicleIds) {
    if (vehicleId.startsWith("SYNTHETIC-")) continue;
    if (vehicleId.length >= 4 && encoded.includes(vehicleId)) {
      throw new Error("summary would expose a raw vehicle identifier; refusing output");
    }
  }
}
