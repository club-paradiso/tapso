import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleLiveReplayEvidence,
  timeBandKst,
  type CaseRow,
  type CollectionEvaluation,
} from "../src/liveReplayEvidence.ts";
import { evaluateGate, MINIMUMS, PINNED_NEGATIVE_CONTROLS, type GateEvidence } from "../src/matcherSafetyGate.ts";

/*
 * Synthetic evaluations only: invented collections, routes and vehicle ids.
 * They exercise the counting rules, not the world.
 */

const DIGEST = "synthetic-matcher-digest";

function row(vehicle: string, overrides: Partial<CaseRow> = {}): CaseRow {
  return {
    sourceClass: "LIVE_PASSIVE",
    routeId: "SYN-R1",
    scenario: "WAIT_AT_STOP",
    groundTruthVehicleId: vehicle,
    committed: true,
    contested: false,
    directedInvariantViolated: false,
    ...overrides,
  };
}

function evaluation(overrides: Partial<CollectionEvaluation> & { collectionId: string }): CollectionEvaluation {
  return {
    providerPath: "tapso-public-api",
    firstReceiptAt: "2026-09-25T05:28:01.803Z",
    rawTreeSha256: `tree-${overrides.collectionId}`,
    live: { cases: 100, buckets: { PASSIVE_CORRECT: 40, PASSIVE_ABSTAINED: 60 }, staleSelections: 0 },
    results: [row("SYN-V1"), row("SYN-V2")],
    migration: { correctToWrong: 0, newWrong: 0 },
    caseDigest: `digest-${overrides.collectionId}`,
    ...overrides,
  };
}

const assemble = (collections: CollectionEvaluation[], extra: Partial<Parameters<typeof assembleLiveReplayEvidence>[1]> = {}) =>
  assembleLiveReplayEvidence(collections, { deterministicAcrossRuns: true, matcherSourceSha256: DIGEST, ...extra });

test("time bands follow KST, whatever the UTC date", () => {
  assert.equal(timeBandKst("2026-09-25T05:28:01Z"), "daytime"); // 14:28 KST
  assert.equal(timeBandKst("2026-09-28T22:37:00Z"), "morning_peak"); // 07:37 KST the next day
  assert.equal(timeBandKst("2026-09-29T09:11:00Z"), "evening_peak"); // 18:11 KST
  assert.equal(timeBandKst("2026-09-29T13:00:00Z"), "off_peak"); // 22:00 KST
  assert.throws(() => timeBandKst("not a time"));
});

test("the unit is one bus on one route direction in one window: repeated cases and split runs count once", () => {
  const evidence = assemble([evaluation({
    collectionId: "SYN-C1",
    results: [
      // One bus, many cases (a trip split in two by a feed gap looks exactly like this).
      row("SYN-V1"), row("SYN-V1"), row("SYN-V1", { committed: false }),
      // The same bus on the other direction is another unit.
      row("SYN-V1", { routeId: "SYN-R2" }),
      row("SYN-V2", { committed: false }),
      // Never counted: synthetic or perturbed rows.
      row("SYN-V9", { sourceClass: "SYNTHETIC_OR_PERTURBED" }),
      row("SYN-V8", { perturbation: "dropout_every_3rd" }),
    ],
  })]);
  assert.equal(evidence.trajectories, 3);
  assert.equal(evidence.trajectoriesWithCommit, 2);
  assert.equal(evidence.vehicles, 2);
  assert.equal(evidence.routes, 2);
});

test("a window with no evaluated case adds no window, time band or provider path", () => {
  const evidence = assemble([
    evaluation({ collectionId: "SYN-C1" }),
    // A direct-TAGO window whose every poll failed: snapshots, no case.
    evaluation({
      collectionId: "SYN-C2", providerPath: "tago-direct", firstReceiptAt: "2026-09-28T23:00:00Z",
      live: { cases: 0, buckets: {}, staleSelections: 0 }, results: [],
    }),
  ]);
  assert.equal(evidence.collections, 2);
  assert.equal(evidence.collectionWindows, 1);
  assert.equal(evidence.timeBands, 1);
  assert.deepEqual(evidence.providerPaths, ["tapso-public-api"]);
  assert.equal(evidence.sessionCadence.trajectories, 0);
  assert.equal(evidence.sessionCadence.collectionWindows, 0);
});

test("contested units are units with a contested waiting-rider case", () => {
  const evidence = assemble([evaluation({
    collectionId: "SYN-C1",
    results: [
      row("SYN-V1", { contested: true }), row("SYN-V1", { contested: true }), row("SYN-V1", { contested: true }),
      row("SYN-V2", { contested: true, scenario: "ON_BOARD_START" }),
      row("SYN-V3"),
    ],
  })]);
  // Three contested cases of one bus are one contested unit; an on-board case is not a waiting rider's.
  assert.equal(evidence.contestedTrajectories, 1);
});

test("vehicles are distinct across windows, units are per window, and the session-cadence subset is separate", () => {
  const evidence = assemble([
    evaluation({ collectionId: "SYN-C1", reproduction: { ok: true, detail: "reproduced" } }),
    evaluation({
      collectionId: "SYN-C2", providerPath: "tago-direct", firstReceiptAt: "2026-09-28T22:37:00Z",
      results: [row("SYN-V2", { routeId: "SYN-R3" }), row("SYN-V3", { routeId: "SYN-R3" })],
    }),
  ]);
  assert.equal(evidence.trajectories, 4);
  assert.equal(evidence.vehicles, 3, "SYN-V2 appears in both windows and counts once");
  assert.equal(evidence.routes, 2);
  assert.equal(evidence.collectionWindows, 2);
  assert.equal(evidence.timeBands, 2);
  assert.deepEqual(evidence.providerPaths, ["tago-direct", "tapso-public-api"]);
  assert.deepEqual(evidence.sessionCadence, {
    trajectories: 2, vehicles: 2, routes: 1, collectionWindows: 1, timeBands: 1, contestedTrajectories: 0,
  });
  assert.equal(evidence.reproductionOk, true);
  assert.equal(evidence.matcherSourceSha256, DIGEST);
  assert.ok(!JSON.stringify(evidence).includes("SYN-V"), "no vehicle id leaves the assembly");
});

test("a window whose raw is gone keeps its failures and adds no sample", () => {
  const first = assemble([
    evaluation({ collectionId: "SYN-C1" }),
    evaluation({
      collectionId: "SYN-C2", live: { cases: 100, buckets: { PASSIVE_WRONG: 1 }, staleSelections: 2 },
      migration: { correctToWrong: 1, newWrong: 1 },
      results: [row("SYN-V1", { directedInvariantViolated: true })],
    }),
  ]);
  assert.equal(first.currentWrong, 1);
  // SYN-C2's raw has expired: only SYN-C1 is retained now.
  const later = assemble([evaluation({ collectionId: "SYN-C1" })], { previous: first.detail });
  assert.equal(later.carriedForward, 1);
  assert.equal(later.currentWrong, 1);
  assert.equal(later.currentInvariantViolations, 1);
  assert.equal(later.selectionsWhileNotFresh, 2);
  assert.equal(later.correctToWrong, 1);
  assert.equal(later.newWrong, 1);
  assert.equal(later.collectionWindows, 1);
  assert.equal(later.trajectories, 2);
  // And it stays carried through every later run.
  const evenLater = assemble([evaluation({ collectionId: "SYN-C1" })], { previous: later.detail });
  assert.equal(evenLater.currentWrong, 1);
});

test("reproduction needs an evidence of record, and every record reproduced", () => {
  assert.equal(assemble([evaluation({ collectionId: "SYN-C1" })]).reproductionOk, false);
  assert.equal(assemble([
    evaluation({ collectionId: "SYN-C1", reproduction: { ok: true, detail: "" } }),
    evaluation({ collectionId: "SYN-C2", reproduction: { ok: false, detail: "bucket PASSIVE_WRONG differs" } }),
  ]).reproductionOk, false);
});

test("a collection is never counted twice", () => {
  assert.throws(() => assemble([evaluation({ collectionId: "SYN-C1" }), evaluation({ collectionId: "SYN-C1" })]));
  assert.throws(() => assemble([
    evaluation({ collectionId: "SYN-C1", rawTreeSha256: "same" }),
    evaluation({ collectionId: "SYN-C2", rawTreeSha256: "same" }),
  ]));
});

test("the assembled evidence is exactly what the gate reads; a wrong commit, an omitted artifact or a stale digest stops it", () => {
  const ca = MINIMUMS.confirmationAssisted;
  const windows = Array.from({ length: ca.collectionWindows }, (_, index) => evaluation({
    collectionId: `SYN-C${index}`,
    firstReceiptAt: index === 0 ? "2026-09-25T05:28:01Z" : "2026-09-28T22:37:00Z",
    reproduction: index === 0 ? { ok: true, detail: "" } : undefined,
    live: { cases: 400, buckets: { PASSIVE_CORRECT: 150 }, staleSelections: 0 },
    results: Array.from({ length: 20 }, (_, vehicle) =>
      row(`SYN-V${index}-${vehicle}`, { routeId: `SYN-R${index}-${vehicle % 3}`, contested: vehicle < 10 })),
  }));
  const liveReplay = assemble(windows);
  const base: GateEvidence = {
    generatedAt: "2026-09-29T00:00:00.000Z",
    matcher: { policyVersion: "directed-route-progress-v1", legacyFreeServingPaths: true, runtimeInvariantEnforced: true },
    tests: { suitePassed: true, propertySeedsPerInvariant: 2_000, propertyRegressionSeedsReplayed: 9, propertyInvariantsCovered: 15 },
    negativeControls: {
      total: PINNED_NEGATIVE_CONTROLS.length, killed: PINNED_NEGATIVE_CONTROLS.length, survived: 0, stale: 0, invalid: 0, timeout: 0,
      complete: true, baselineGreen: true, realTreeUnchanged: true, killedIds: [...PINNED_NEGATIVE_CONTROLS],
    },
    formerWrongCommitInstants: { records: 268, legacyReproduced: 268, currentCommits: 0 },
    deploymentPosture: { automaticMatchingOffEverywhere: true, checkedBy: "config_default" },
    counterfactualsOnLiveBases: { families: 31, expectationFailures: 0, wrongAgainstRederivedTruth: 0, invariantViolations: 0, matcherSourceSha256: DIGEST },
    currentMatcherSourceSha256: DIGEST,
    humanOnlyMitigations: {
      riderSeesAndCanUndoAutomaticPick: false,
      destinationAlertIndependentOfProviderLag: false,
      physicalDeviceLiveActivityVerified: false,
      riderBoardsFirstArrivingBusMeasured: false,
    },
  };
  assert.equal(evaluateGate({ ...base, liveReplay }).awarded, "READY_FOR_CONFIRMATION_ASSISTED");

  const oneWrong = assemble(windows.map((window, index) => (index === 1
    ? { ...window, live: { ...window.live, buckets: { ...window.live.buckets, PASSIVE_WRONG: 1 } } }
    : window)));
  assert.equal(evaluateGate({ ...base, liveReplay: oneWrong }).awarded, "READY_FOR_SHADOW");

  const omitted = assemble(windows, { omittedArtifacts: ["12345"] });
  assert.equal(evaluateGate({ ...base, liveReplay: omitted }).awarded, "READY_FOR_SHADOW");

  const stale = evaluateGate({ ...base, liveReplay, currentMatcherSourceSha256: "another-digest" });
  assert.equal(stale.awarded, "READY_FOR_SHADOW");
  assert.equal(stale.criteria.find((criterion) => criterion.id === "CA-1")?.status, "MISSING");
});
