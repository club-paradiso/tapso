/**
 * The live-replay input of release gate `matcher-passive-safety-v4`
 * (`GateEvidence.liveReplay`), assembled from evaluated raw live collections.
 *
 * Pure: it takes what the evaluation of each collection produced and adds it
 * up. The evaluation itself (blind replay under the current matcher, and the
 * old-versus-new migration) runs in `scripts/matcher-evidence/live-evidence.ts`,
 * which is the only place raw collections are read.
 *
 * Counting rules. Sample sizes may only ever be under-stated; failures may
 * never disappear:
 * - the independent unit is one bus on one route direction in one collection
 *   window, counted only when it contributed at least one evaluated case. Runs
 *   of the same bus split by a feed gap are one unit, and so are two trips of
 *   one bus on one direction inside a window;
 * - a contested unit is one with at least one waiting-rider case in which a
 *   second vehicle was plausible at a decision;
 * - a window, its KST time band and its provider path count only when the
 *   window contributed a unit;
 * - vehicles are distinct ground-truth vehicles across all windows, by raw id,
 *   in memory only (per-run pseudonyms cannot be compared across runs);
 * - only unperturbed `LIVE_PASSIVE` cases count, never a synthetic or
 *   perturbed one;
 * - a collection counted twice (a replayed copy of the same raw) is refused;
 * - a window evaluated earlier whose raw is no longer retained keeps its
 *   failures (wrong commits, invariant violations, non-fresh selections,
 *   regressions) through `previous`, and contributes no sample;
 * - the artifacts that could not be fetched or verified are listed, and the
 *   gate does not count a replay with any of them as complete.
 */

import type { GateEvidence } from "./matcherSafetyGate.ts";

export type LiveReplayEvidence = NonNullable<GateEvidence["liveReplay"]>;

/** The provider path journey sessions use: direct TAGO, uncached, at session cadence. */
export const SESSION_CADENCE_PROVIDER_PATH = "tago-direct";

/** One replayed case under the current matcher. Raw ids in memory only. */
export interface CaseRow {
  sourceClass: string;
  perturbation?: string;
  routeId: string;
  scenario: string;
  groundTruthVehicleId: string;
  /** The current matcher committed to a vehicle in this case. */
  committed: boolean;
  /** At least one decision of the case had a second plausible vehicle. */
  contested: boolean;
  directedInvariantViolated: boolean;
}

/** What the evaluation of one raw live collection produced. */
export interface CollectionEvaluation {
  collectionId: string;
  providerPath: string;
  /** The collection's first receipt (ISO). */
  firstReceiptAt: string;
  rawTreeSha256: string;
  /** Under the current matcher: the summary's live aggregates. */
  live: {
    cases: number;
    buckets: Record<string, number>;
    staleSelections: number;
  };
  results: CaseRow[];
  /** Legacy versus current on the same cases. */
  migration: { correctToWrong: number; newWrong: number };
  /** Present when the collection has an evidence of record the legacy side must reproduce. */
  reproduction?: { ok: boolean; detail: string };
  /** sha256 over the collection's sorted case-level decisions (no vehicle id in the clear). */
  caseDigest: string;
}

/** The failure counts of one collection, the part that outlives its raw. */
export interface CollectionFailures {
  currentWrong: number;
  currentInvariantViolations: number;
  selectionsWhileNotFresh: number;
  correctToWrong: number;
  newWrong: number;
}

export interface DetailRow extends CollectionFailures {
  collectionId: string;
  rawTreeSha256: string;
  /** false: the raw was not retained this time; only the failures recorded earlier are carried. */
  retained: boolean;
  providerPath?: string;
  timeBand?: TimeBandKst;
  cases?: number;
  trajectories?: number;
  contestedTrajectories?: number;
  caseDigest?: string;
  reproduction?: string;
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

const liveRows = (collection: CollectionEvaluation) =>
  collection.results.filter((row) => row.sourceClass === "LIVE_PASSIVE" && row.perturbation === undefined);

interface Unit {
  vehicle: string;
  routeId: string;
  committed: boolean;
  contested: boolean;
}

function unitsOf(collection: CollectionEvaluation): Unit[] {
  const units = new Map<string, Unit>();
  for (const row of liveRows(collection)) {
    const key = `${row.routeId}\u0000${row.groundTruthVehicleId}`;
    const unit = units.get(key) ?? { vehicle: row.groundTruthVehicleId, routeId: row.routeId, committed: false, contested: false };
    unit.committed ||= row.committed;
    unit.contested ||= row.contested && row.scenario === "WAIT_AT_STOP";
    units.set(key, unit);
  }
  return [...units.values()];
}

/** The sample dimensions of a set of windows; the same rules for the whole and for the session-cadence subset. */
export function sampleOf(collections: CollectionEvaluation[]): LiveReplayEvidence["sessionCadence"] & { trajectoriesWithCommit: number; providerPaths: string[] } {
  const vehicles = new Set<string>();
  const routes = new Set<string>();
  const bands = new Set<TimeBandKst>();
  const paths = new Set<string>();
  let trajectories = 0;
  let trajectoriesWithCommit = 0;
  let contestedTrajectories = 0;
  let collectionWindows = 0;
  for (const collection of collections) {
    const units = unitsOf(collection);
    if (units.length === 0) continue;
    collectionWindows += 1;
    bands.add(timeBandKst(collection.firstReceiptAt));
    paths.add(collection.providerPath);
    for (const unit of units) {
      trajectories += 1;
      if (unit.committed) trajectoriesWithCommit += 1;
      if (unit.contested) contestedTrajectories += 1;
      vehicles.add(unit.vehicle);
      routes.add(unit.routeId);
    }
  }
  return {
    trajectories,
    trajectoriesWithCommit,
    contestedTrajectories,
    vehicles: vehicles.size,
    routes: routes.size,
    collectionWindows,
    timeBands: bands.size,
    providerPaths: [...paths].sort(),
  };
}

function failuresOf(collection: CollectionEvaluation): CollectionFailures {
  return {
    currentWrong: collection.live.buckets.PASSIVE_WRONG ?? 0,
    currentInvariantViolations: liveRows(collection).filter((row) => row.directedInvariantViolated).length,
    selectionsWhileNotFresh: collection.live.staleSelections,
    correctToWrong: collection.migration.correctToWrong,
    newWrong: collection.migration.newWrong,
  };
}

const FAILURE_KEYS: Array<keyof CollectionFailures> = ["currentWrong", "currentInvariantViolations", "selectionsWhileNotFresh", "correctToWrong", "newWrong"];

export function assembleLiveReplayEvidence(
  collections: CollectionEvaluation[],
  options: {
    deterministicAcrossRuns: boolean;
    /** Digest of the matcher and evaluation sources that produced these results. */
    matcherSourceSha256: string;
    /** The detail rows of the evidence committed before, whose failures must not disappear. */
    previous?: DetailRow[];
    /** Retained artifacts that could not be fetched or verified. */
    omittedArtifacts?: string[];
  },
): LiveReplayEvidence & { detail: DetailRow[] } {
  const ids = collections.map((collection) => collection.collectionId);
  if (new Set(ids).size !== ids.length) throw new Error("a collection is counted twice; pass each raw collection once");
  const trees = collections.map((collection) => collection.rawTreeSha256);
  if (new Set(trees).size !== trees.length) throw new Error("two collection ids share one raw tree; refusing to count it twice");

  const detail: DetailRow[] = collections.map((collection) => {
    const units = unitsOf(collection);
    return {
      collectionId: collection.collectionId,
      rawTreeSha256: collection.rawTreeSha256,
      retained: true,
      providerPath: collection.providerPath,
      timeBand: timeBandKst(collection.firstReceiptAt),
      cases: collection.live.cases,
      trajectories: units.length,
      contestedTrajectories: units.filter((unit) => unit.contested).length,
      ...failuresOf(collection),
      caseDigest: collection.caseDigest,
      reproduction: collection.reproduction
        ? (collection.reproduction.ok ? "reproduced" : `NOT reproduced: ${collection.reproduction.detail}`)
        : "no evidence of record",
    };
  });
  // A window evaluated before and no longer retained keeps its failures. Its
  // sample cannot be re-established without the raw, so it adds none.
  const carried = new Set(ids);
  for (const row of options.previous ?? []) {
    if (carried.has(row.collectionId)) continue;
    carried.add(row.collectionId);
    detail.push({
      collectionId: row.collectionId,
      rawTreeSha256: row.rawTreeSha256,
      retained: false,
      ...Object.fromEntries(FAILURE_KEYS.map((key) => [key, Number(row[key]) || 0])) as unknown as CollectionFailures,
    });
  }

  const total = (key: keyof CollectionFailures) => detail.reduce((sum, row) => sum + row[key], 0);
  const whole = sampleOf(collections);
  const session = sampleOf(collections.filter((collection) => collection.providerPath === SESSION_CADENCE_PROVIDER_PATH));
  const records = collections.filter((collection) => collection.reproduction !== undefined);
  return {
    collections: collections.length,
    // At least one evidence of record, and every one reproduced by the legacy side.
    reproductionOk: records.length > 0 && records.every((collection) => collection.reproduction!.ok),
    deterministicAcrossRuns: options.deterministicAcrossRuns,
    matcherSourceSha256: options.matcherSourceSha256,
    omittedArtifacts: [...(options.omittedArtifacts ?? [])].sort(),
    carriedForward: detail.filter((row) => !row.retained).length,
    cases: collections.reduce((sum, collection) => sum + collection.live.cases, 0),
    trajectories: whole.trajectories,
    trajectoriesWithCommit: whole.trajectoriesWithCommit,
    vehicles: whole.vehicles,
    routes: whole.routes,
    collectionWindows: whole.collectionWindows,
    timeBands: whole.timeBands,
    contestedTrajectories: whole.contestedTrajectories,
    currentWrong: total("currentWrong"),
    currentInvariantViolations: total("currentInvariantViolations"),
    selectionsWhileNotFresh: total("selectionsWhileNotFresh"),
    correctToWrong: total("correctToWrong"),
    newWrong: total("newWrong"),
    providerPaths: whole.providerPaths,
    sessionCadence: {
      trajectories: session.trajectories,
      vehicles: session.vehicles,
      routes: session.routes,
      collectionWindows: session.collectionWindows,
      timeBands: session.timeBands,
      contestedTrajectories: session.contestedTrajectories,
    },
    detail,
  };
}
