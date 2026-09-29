/**
 * The live-replay input of release gate `matcher-passive-safety-v4`
 * (`GateEvidence.liveReplay`), assembled from evaluated raw live collections.
 *
 * Pure: it takes what the evaluation of each collection produced and adds it
 * up. The evaluation itself (blind replay under the current matcher, and the
 * old-versus-new migration) runs in `scripts/matcher-evidence/live-evidence.ts`,
 * which is the only place raw collections are read.
 *
 * Counting rules, each chosen so the total can only be an under-statement:
 * - a collection counted twice (a replayed copy of the same raw) is refused;
 * - vehicles are distinct ground-truth vehicles across all collections, by raw
 *   id, in memory only (per-run pseudonyms cannot be compared across runs);
 * - a collection window's time band is taken from its first receipt, in KST;
 * - only unperturbed `LIVE_PASSIVE` results count, never a synthetic or
 *   perturbed one.
 */

import type { GateEvidence } from "./matcherSafetyGate.ts";

export type LiveReplayEvidence = NonNullable<GateEvidence["liveReplay"]>;

/** What the evaluation of one raw live collection produced. */
export interface CollectionEvaluation {
  collectionId: string;
  providerPath: string;
  /** The collection's first receipt (ISO). */
  firstReceiptAt: string;
  rawTreeSha256: string;
  /** Under the current matcher: the summary's live section, as far as it is read here. */
  live: {
    cases: number;
    trajectories: number;
    routes: string[];
    buckets: Record<string, number>;
    staleSelections: number;
    grouped: { byTrajectory: { withWrongCommit: number; withCorrectCommitOnly: number } };
    difficultyProfile: { contested: { cases: number } };
  };
  /** Under the current matcher, one row per result, raw ids in memory only. */
  results: Array<{ sourceClass: string; perturbation?: string; groundTruthVehicleId: string; directedInvariantViolated: boolean }>;
  /** Legacy versus current on the same cases. */
  migration: { correctToWrong: number; newWrong: number };
  /** Present when the collection has an evidence of record the legacy side must reproduce. */
  reproduction?: { ok: boolean; detail: string };
}

export const TIME_BANDS_KST = ["morning_peak", "daytime", "evening_peak", "off_peak"] as const;
export type TimeBandKst = (typeof TIME_BANDS_KST)[number];

/** 07:00-09:59 morning peak, 10:00-16:59 daytime, 17:00-19:59 evening peak, otherwise off-peak (KST, UTC+9). */
export function timeBandKst(iso: string): TimeBandKst {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new RangeError(`not a timestamp: ${iso}`);
  const hour = new Date(ms + 9 * 60 * 60 * 1_000).getUTCHours();
  if (hour >= 7 && hour < 10) return "morning_peak";
  if (hour >= 10 && hour < 17) return "daytime";
  if (hour >= 17 && hour < 20) return "evening_peak";
  return "off_peak";
}

export function assembleLiveReplayEvidence(
  collections: CollectionEvaluation[],
  options: { deterministicAcrossRuns: boolean },
): LiveReplayEvidence & {
  detail: Array<{ collectionId: string; rawTreeSha256: string; providerPath: string; timeBand: TimeBandKst; cases: number; trajectories: number; reproduction: string }>;
} {
  const ids = collections.map((collection) => collection.collectionId);
  if (new Set(ids).size !== ids.length) throw new Error("a collection is counted twice; pass each raw collection once");
  const trees = collections.map((collection) => collection.rawTreeSha256);
  if (new Set(trees).size !== trees.length) throw new Error("two collection ids share one raw tree; refusing to count it twice");

  const vehicles = new Set<string>();
  const routes = new Set<string>();
  const bands = new Set<TimeBandKst>();
  const providerPaths = new Set<string>();
  let invariantViolations = 0;
  const sum = (pick: (collection: CollectionEvaluation) => number) => collections.reduce((total, collection) => total + pick(collection), 0);
  for (const collection of collections) {
    for (const route of collection.live.routes) routes.add(route);
    bands.add(timeBandKst(collection.firstReceiptAt));
    providerPaths.add(collection.providerPath);
    for (const result of collection.results) {
      if (result.sourceClass !== "LIVE_PASSIVE" || result.perturbation !== undefined) continue;
      vehicles.add(result.groundTruthVehicleId);
      if (result.directedInvariantViolated) invariantViolations += 1;
    }
  }
  const records = collections.filter((collection) => collection.reproduction !== undefined);
  return {
    collections: collections.length,
    // At least one evidence of record, and every one reproduced by the legacy side.
    reproductionOk: records.length > 0 && records.every((collection) => collection.reproduction!.ok),
    deterministicAcrossRuns: options.deterministicAcrossRuns,
    cases: sum((collection) => collection.live.cases),
    trajectories: sum((collection) => collection.live.trajectories),
    trajectoriesWithCommit: sum((collection) =>
      collection.live.grouped.byTrajectory.withWrongCommit + collection.live.grouped.byTrajectory.withCorrectCommitOnly),
    vehicles: vehicles.size,
    routes: routes.size,
    collectionWindows: collections.length,
    timeBands: bands.size,
    contestedCases: sum((collection) => collection.live.difficultyProfile.contested.cases),
    currentWrong: sum((collection) => collection.live.buckets.PASSIVE_WRONG ?? 0),
    currentInvariantViolations: invariantViolations,
    selectionsWhileNotFresh: sum((collection) => collection.live.staleSelections),
    correctToWrong: sum((collection) => collection.migration.correctToWrong),
    newWrong: sum((collection) => collection.migration.newWrong),
    providerPaths: [...providerPaths].sort(),
    // The raw tree hash binds each count to the exact raw files it came from,
    // so anyone holding the raw can recompute it; it reveals no vehicle id.
    detail: collections.map((collection) => ({
      collectionId: collection.collectionId,
      rawTreeSha256: collection.rawTreeSha256,
      providerPath: collection.providerPath,
      timeBand: timeBandKst(collection.firstReceiptAt),
      cases: collection.live.cases,
      trajectories: collection.live.trajectories,
      reproduction: collection.reproduction ? (collection.reproduction.ok ? "reproduced" : `NOT reproduced: ${collection.reproduction.detail}`) : "no evidence of record",
    })),
  };
}
