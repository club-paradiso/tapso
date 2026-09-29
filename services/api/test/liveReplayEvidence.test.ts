import assert from "node:assert/strict";
import test from "node:test";

import { assembleLiveReplayEvidence, timeBandKst, type CollectionEvaluation } from "../src/liveReplayEvidence.ts";
import { evaluateGate, MINIMUMS, type GateEvidence } from "../src/matcherSafetyGate.ts";

/*
 * Synthetic evaluations only: invented collections, routes and vehicle ids.
 * They exercise the counting rules, not the world.
 */

function evaluation(overrides: Partial<CollectionEvaluation> & { collectionId: string }): CollectionEvaluation {
  return {
    providerPath: "tapso-public-api",
    firstReceiptAt: "2026-09-25T05:28:01.803Z",
    rawTreeSha256: `tree-${overrides.collectionId}`,
    live: {
      cases: 100,
      trajectories: 10,
      routes: ["SYN-R1", "SYN-R2"],
      buckets: { PASSIVE_CORRECT: 40, PASSIVE_ABSTAINED: 60 },
      staleSelections: 0,
      grouped: { byTrajectory: { withWrongCommit: 0, withCorrectCommitOnly: 6 } },
      difficultyProfile: { contested: { cases: 7 } },
    },
    results: [
      { sourceClass: "LIVE_PASSIVE", groundTruthVehicleId: "SYN-V1", directedInvariantViolated: false },
      { sourceClass: "LIVE_PASSIVE", groundTruthVehicleId: "SYN-V2", directedInvariantViolated: false },
    ],
    migration: { correctToWrong: 0, newWrong: 0 },
    ...overrides,
  };
}

test("time bands follow KST, whatever the UTC date", () => {
  assert.equal(timeBandKst("2026-09-25T05:28:01Z"), "daytime"); // 14:28 KST
  assert.equal(timeBandKst("2026-09-28T22:37:00Z"), "morning_peak"); // 07:37 KST the next day
  assert.equal(timeBandKst("2026-09-29T09:11:00Z"), "evening_peak"); // 18:11 KST
  assert.equal(timeBandKst("2026-09-29T13:00:00Z"), "off_peak"); // 22:00 KST
  assert.throws(() => timeBandKst("not a time"));
});

test("sums per collection, distinct vehicles and routes across collections, bands and paths as sets", () => {
  const evidence = assembleLiveReplayEvidence([
    evaluation({ collectionId: "SYN-C1", reproduction: { ok: true, detail: "reproduced" } }),
    evaluation({
      collectionId: "SYN-C2",
      firstReceiptAt: "2026-09-28T22:37:00Z",
      providerPath: "tago-direct",
      live: { ...evaluation({ collectionId: "x" }).live, routes: ["SYN-R2", "SYN-R3"] },
      results: [
        { sourceClass: "LIVE_PASSIVE", groundTruthVehicleId: "SYN-V2", directedInvariantViolated: false },
        { sourceClass: "LIVE_PASSIVE", groundTruthVehicleId: "SYN-V3", directedInvariantViolated: false },
        // Never counted: synthetic or perturbed rows.
        { sourceClass: "SYNTHETIC_OR_PERTURBED", groundTruthVehicleId: "SYN-V9", directedInvariantViolated: true },
        { sourceClass: "LIVE_PASSIVE", perturbation: "dropout_every_3rd", groundTruthVehicleId: "SYN-V8", directedInvariantViolated: true },
      ],
    }),
  ], { deterministicAcrossRuns: true });
  assert.equal(evidence.collections, 2);
  assert.equal(evidence.collectionWindows, 2);
  assert.equal(evidence.cases, 200);
  assert.equal(evidence.trajectories, 20);
  assert.equal(evidence.trajectoriesWithCommit, 12);
  assert.equal(evidence.vehicles, 3, "SYN-V2 appears in both windows and counts once");
  assert.equal(evidence.routes, 3);
  assert.equal(evidence.timeBands, 2);
  assert.equal(evidence.contestedCases, 14);
  assert.equal(evidence.currentInvariantViolations, 0);
  assert.deepEqual(evidence.providerPaths, ["tago-direct", "tapso-public-api"]);
  assert.equal(evidence.reproductionOk, true);
  assert.equal(evidence.deterministicAcrossRuns, true);
  assert.ok(!JSON.stringify(evidence).includes("SYN-V"), "no vehicle id leaves the assembly");
});

test("reproduction needs an evidence of record, and every record reproduced", () => {
  assert.equal(assembleLiveReplayEvidence([evaluation({ collectionId: "SYN-C1" })], { deterministicAcrossRuns: true }).reproductionOk, false);
  assert.equal(assembleLiveReplayEvidence([
    evaluation({ collectionId: "SYN-C1", reproduction: { ok: true, detail: "" } }),
    evaluation({ collectionId: "SYN-C2", reproduction: { ok: false, detail: "bucket PASSIVE_WRONG differs" } }),
  ], { deterministicAcrossRuns: true }).reproductionOk, false);
});

test("a collection is never counted twice", () => {
  assert.throws(() => assembleLiveReplayEvidence([evaluation({ collectionId: "SYN-C1" }), evaluation({ collectionId: "SYN-C1" })], { deterministicAcrossRuns: true }));
  assert.throws(() => assembleLiveReplayEvidence([
    evaluation({ collectionId: "SYN-C1", rawTreeSha256: "same" }),
    evaluation({ collectionId: "SYN-C2", rawTreeSha256: "same" }),
  ], { deterministicAcrossRuns: true }));
});

test("the assembled evidence is exactly what the gate reads, and a wrong commit anywhere fails it", () => {
  const ca = MINIMUMS.confirmationAssisted;
  const windows = Array.from({ length: ca.collectionWindows }, (_, index) => evaluation({
    collectionId: `SYN-C${index}`,
    firstReceiptAt: index === 0 ? "2026-09-25T05:28:01Z" : "2026-09-28T22:37:00Z",
    reproduction: index === 0 ? { ok: true, detail: "" } : undefined,
    live: {
      cases: 400, trajectories: 25, routes: [`SYN-R${index}a`, `SYN-R${index}b`, `SYN-R${index}c`],
      buckets: { PASSIVE_CORRECT: 150 }, staleSelections: 0,
      grouped: { byTrajectory: { withWrongCommit: 0, withCorrectCommitOnly: 20 } },
      difficultyProfile: { contested: { cases: 12 } },
    },
    results: Array.from({ length: 12 }, (_, vehicle) => ({ sourceClass: "LIVE_PASSIVE", groundTruthVehicleId: `SYN-V${index}-${vehicle}`, directedInvariantViolated: false })),
  }));
  const liveReplay = assembleLiveReplayEvidence(windows, { deterministicAcrossRuns: true });
  const base: GateEvidence = {
    generatedAt: "2026-09-29T00:00:00.000Z",
    matcher: { policyVersion: "directed-route-progress-v1", legacyFreeServingPaths: true, runtimeInvariantEnforced: true },
    tests: { suitePassed: true, propertySeedsPerInvariant: 2_000, propertyRegressionSeedsReplayed: 9, propertyInvariantsCovered: 15 },
    negativeControls: { total: 48, killed: 48, survived: 0, stale: 0, invalid: 0, timeout: 0, complete: true, baselineGreen: true, realTreeUnchanged: true },
    formerWrongCommitInstants: { records: 268, legacyReproduced: 268, currentCommits: 0 },
    deploymentPosture: { automaticMatchingOffEverywhere: true, checkedBy: "config_default" },
    counterfactualsOnLiveBases: { families: 31, expectationFailures: 0, wrongAgainstRederivedTruth: 0, invariantViolations: 0 },
    humanOnlyMitigations: {
      riderSeesAndCanUndoAutomaticPick: false,
      destinationAlertIndependentOfProviderLag: false,
      physicalDeviceLiveActivityVerified: false,
      riderBoardsFirstArrivingBusMeasured: false,
    },
  };
  assert.equal(evaluateGate({ ...base, liveReplay }).awarded, "READY_FOR_CONFIRMATION_ASSISTED");
  const oneWrong = assembleLiveReplayEvidence(
    windows.map((window, index) => (index === 1 ? { ...window, live: { ...window.live, buckets: { ...window.live.buckets, PASSIVE_WRONG: 1 } } } : window)),
    { deterministicAcrossRuns: true },
  );
  assert.equal(evaluateGate({ ...base, liveReplay: oneWrong }).awarded, "READY_FOR_SHADOW");
});
