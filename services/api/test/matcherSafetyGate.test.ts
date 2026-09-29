import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateGate,
  GATE_POLICY_VERSION,
  MINIMUMS,
  MITIGATION_CRITERIA,
  mitigationEvidenceHolds,
  PINNED_NEGATIVE_CONTROLS,
  READINESS_LEVELS,
  readinessRank,
  type GateEvidence,
  type MitigationEntry,
  type ReadinessLevel,
} from "../src/matcherSafetyGate.ts";
import { NEGATIVE_CONTROLS } from "../../../scripts/negative-controls/mutations.ts";

/*
 * Release gate `matcher-passive-safety-v4`. Every fixture below is synthetic
 * and says so: it exercises the gate's rules, not the world.
 */

const NO_MITIGATIONS: GateEvidence["humanOnlyMitigations"] = {
  riderSeesAndCanUndoAutomaticPick: false,
  destinationAlertIndependentOfProviderLag: false,
  physicalDeviceLiveActivityVerified: false,
  riderBoardsFirstArrivingBusMeasured: false,
};

const CONTROLS: NonNullable<GateEvidence["negativeControls"]> = {
  total: PINNED_NEGATIVE_CONTROLS.length, killed: PINNED_NEGATIVE_CONTROLS.length, survived: 0, stale: 0, invalid: 0, timeout: 0,
  complete: true, baselineGreen: true, realTreeUnchanged: true, killedIds: [...PINNED_NEGATIVE_CONTROLS],
};

/** The digest of the matcher sources the synthetic live evidence claims to come from. */
const DIGEST = "synthetic-matcher-digest";

function shadowEvidence(overrides: Partial<GateEvidence> = {}): GateEvidence {
  return {
    generatedAt: "2026-09-29T00:00:00.000Z",
    matcher: { policyVersion: "directed-route-progress-v1", legacyFreeServingPaths: true, runtimeInvariantEnforced: true },
    tests: { suitePassed: true, propertySeedsPerInvariant: 2_000, propertyRegressionSeedsReplayed: 8, propertyInvariantsCovered: 15 },
    negativeControls: CONTROLS,
    formerWrongCommitInstants: { records: 268, legacyReproduced: 268, currentCommits: 0 },
    deploymentPosture: { automaticMatchingOffEverywhere: true, checkedBy: "config_default" },
    currentMatcherSourceSha256: DIGEST,
    humanOnlyMitigations: NO_MITIGATIONS,
    ...overrides,
  };
}

type LiveReplay = NonNullable<GateEvidence["liveReplay"]>;

function liveReplay(overrides: Partial<LiveReplay> = {}): LiveReplay {
  const ca = MINIMUMS.confirmationAssisted;
  return {
    collections: 3,
    reproductionOk: true,
    deterministicAcrossRuns: true,
    matcherSourceSha256: DIGEST,
    omittedArtifacts: [],
    carriedForward: 0,
    cases: 900,
    trajectories: ca.trajectories,
    trajectoriesWithCommit: 40,
    vehicles: ca.vehicles,
    routes: ca.routes,
    collectionWindows: ca.collectionWindows,
    timeBands: ca.timeBands,
    contestedTrajectories: ca.contestedTrajectories,
    currentWrong: 0,
    currentInvariantViolations: 0,
    selectionsWhileNotFresh: 0,
    correctToWrong: 0,
    newWrong: 0,
    providerPaths: ["tapso-public-api"],
    sessionCadence: { trajectories: 0, vehicles: 0, routes: 0, collectionWindows: 0, timeBands: 0, contestedTrajectories: 0 },
    ...overrides,
  };
}

const COUNTERFACTUALS: NonNullable<GateEvidence["counterfactualsOnLiveBases"]> = {
  families: 30,
  expectationFailures: 0,
  wrongAgainstRederivedTruth: 0,
  invariantViolations: 0,
  matcherSourceSha256: DIGEST,
};

function confirmationEvidence(overrides: Partial<GateEvidence> = {}): GateEvidence {
  return shadowEvidence({ liveReplay: liveReplay(), counterfactualsOnLiveBases: COUNTERFACTUALS, ...overrides });
}

function status(evidence: GateEvidence, id: string): string | undefined {
  return evaluateGate(evidence).criteria.find((row) => row.id === id)?.status;
}

test("levels are ordered and each includes the one below it", () => {
  assert.deepEqual([...READINESS_LEVELS], [
    "NOT_READY",
    "READY_FOR_SHADOW",
    "READY_FOR_CONFIRMATION_ASSISTED",
    "READY_FOR_BOUNDED_AUTOMATION",
    "READY_FOR_AUTOMATIC_MATCHING",
  ]);
  READINESS_LEVELS.forEach((level, index) => assert.equal(readinessRank(level), index));
  assert.equal(GATE_POLICY_VERSION, "matcher-passive-safety-v4");
});

test("missing evidence is never a pass", () => {
  const bare: GateEvidence = {
    generatedAt: "2026-09-29T00:00:00.000Z",
    matcher: { policyVersion: "directed-route-progress-v1", legacyFreeServingPaths: undefined, runtimeInvariantEnforced: undefined },
    humanOnlyMitigations: NO_MITIGATIONS,
  };
  const result = evaluateGate(bare);
  assert.equal(result.awarded, "NOT_READY");
  for (const id of ["SH-1", "SH-2", "SH-3", "SH-4", "SH-5", "SH-6"]) {
    assert.equal(status(bare, id), "MISSING", id);
    // Missing evidence is labelled as missing, never as the kind it would have been.
    assert.equal(result.criteria.find((row) => row.id === id)?.evidenceClass, "MISSING", id);
  }
  for (const id of ["CA-1", "CA-2", "CA-3", "CA-4", "CA-5", "CA-6", "CA-7", "BA-1", "BA-2"]) {
    assert.equal(status(bare, id), "MISSING", id);
  }
  assert.equal(result.nextLevel?.level, "READY_FOR_SHADOW");
});

test("the machine-producible shadow evidence awards exactly READY_FOR_SHADOW", () => {
  const result = evaluateGate(shadowEvidence());
  assert.equal(result.awarded, "READY_FOR_SHADOW");
  assert.equal(result.nextLevel?.level, "READY_FOR_CONFIRMATION_ASSISTED");
  // With no raw replay and no real-base counterfactuals, every CA criterion is
  // missing, not failed: nothing observed contradicts it, nothing supports it.
  assert.deepEqual(result.nextLevel?.blockedBy.map((row) => [row.id, row.status]), [
    ["CA-1", "MISSING"], ["CA-2", "MISSING"], ["CA-3", "MISSING"], ["CA-4", "MISSING"],
    ["CA-5", "MISSING"], ["CA-6", "MISSING"], ["CA-7", "MISSING"],
  ]);
});

test("every shadow criterion is necessary", () => {
  const breakers: Array<[string, Partial<GateEvidence>]> = [
    ["SH-1", { matcher: { policyVersion: "symmetric-stop-distance-v0", legacyFreeServingPaths: true, runtimeInvariantEnforced: true } }],
    ["SH-1", { matcher: { policyVersion: "directed-route-progress-v1", legacyFreeServingPaths: false, runtimeInvariantEnforced: true } }],
    ["SH-2", { matcher: { policyVersion: "directed-route-progress-v1", legacyFreeServingPaths: true, runtimeInvariantEnforced: false } }],
    ["SH-3", { tests: { suitePassed: false, propertySeedsPerInvariant: 2_000, propertyRegressionSeedsReplayed: 8, propertyInvariantsCovered: 15 } }],
    ["SH-3", { tests: { suitePassed: true, propertySeedsPerInvariant: 1_999, propertyRegressionSeedsReplayed: 8, propertyInvariantsCovered: 15 } }],
    ["SH-3", { tests: { suitePassed: true, propertySeedsPerInvariant: 2_000, propertyRegressionSeedsReplayed: 8, propertyInvariantsCovered: 14 } }],
    ["SH-4", { negativeControls: { ...CONTROLS, killed: 29, survived: 1 } }],
    ["SH-4", { negativeControls: { ...CONTROLS, killed: 29, stale: 1 } }],
    ["SH-4", { negativeControls: { ...CONTROLS, killed: 29, invalid: 1 } }],
    ["SH-4", { negativeControls: { ...CONTROLS, killed: 29, timeout: 1 } }],
    ["SH-4", { negativeControls: { ...CONTROLS, total: 0, killed: 0 } }],
    // A debug run of one control, a red baseline or a tree that moved under
    // the run proves nothing about the catalogue.
    ["SH-4", { negativeControls: { ...CONTROLS, total: 1, killed: 1, complete: false } }],
    ["SH-4", { negativeControls: { ...CONTROLS, baselineGreen: false } }],
    ["SH-4", { negativeControls: { ...CONTROLS, realTreeUnchanged: false } }],
    // A catalogue that silently lost a control still says "all killed".
    ["SH-4", { negativeControls: { ...CONTROLS, total: CONTROLS.total - 1, killed: CONTROLS.total - 1, killedIds: CONTROLS.killedIds.filter((id) => id !== "F1") } }],
    ["SH-5", { formerWrongCommitInstants: { records: 268, legacyReproduced: 268, currentCommits: 1 } }],
    ["SH-5", { formerWrongCommitInstants: { records: 268, legacyReproduced: 267, currentCommits: 0 } }],
    ["SH-6", { deploymentPosture: { automaticMatchingOffEverywhere: false, checkedBy: "config_default" } }],
  ];
  for (const [id, override] of breakers) {
    const evidence = shadowEvidence(override);
    assert.equal(status(evidence, id), "FAIL", `${id} ${JSON.stringify(override)}`);
    assert.equal(evaluateGate(evidence).awarded, "NOT_READY", `${id} ${JSON.stringify(override)}`);
  }
});

test("a higher level is never awarded over a failed lower one", () => {
  // Everything confirmation-assisted asks for, and one killed-control short.
  const evidence = confirmationEvidence({ negativeControls: { ...CONTROLS, killed: 29, survived: 1 } });
  assert.equal(status(evidence, "CA-1"), "PASS");
  assert.equal(status(evidence, "CA-6"), "PASS");
  assert.equal(evaluateGate(evidence).awarded, "NOT_READY");
});

test("confirmation-assisted needs the rule-of-three sample on live evidence, and nothing wrong in it", () => {
  assert.equal(evaluateGate(confirmationEvidence()).awarded, "READY_FOR_CONFIRMATION_ASSISTED");
  const ca = MINIMUMS.confirmationAssisted;
  const shortfalls: Array<[string, Partial<LiveReplay>]> = [
    ["CA-1", { reproductionOk: false }],
    ["CA-1", { collections: 0 }],
    ["CA-1", { omittedArtifacts: ["10849693394"] }],
    ["CA-2", { currentWrong: 1 }],
    ["CA-2", { currentInvariantViolations: 1 }],
    ["CA-2", { selectionsWhileNotFresh: 1 }],
    ["CA-3", { correctToWrong: 1 }],
    ["CA-3", { newWrong: 1 }],
    ["CA-4", { deterministicAcrossRuns: false }],
    ["CA-6", { trajectories: ca.trajectories - 1 }],
    ["CA-6", { vehicles: ca.vehicles - 1 }],
    ["CA-6", { contestedTrajectories: ca.contestedTrajectories - 1 }],
    ["CA-7", { routes: ca.routes - 1 }],
    ["CA-7", { collectionWindows: ca.collectionWindows - 1 }],
    ["CA-7", { timeBands: ca.timeBands - 1 }],
  ];
  for (const [id, override] of shortfalls) {
    const evidence = confirmationEvidence({ liveReplay: liveReplay(override) });
    assert.equal(status(evidence, id), "FAIL", `${id} ${JSON.stringify(override)}`);
    assert.equal(evaluateGate(evidence).awarded, "READY_FOR_SHADOW", `${id} ${JSON.stringify(override)}`);
  }
  for (const counterfactuals of [
    { ...COUNTERFACTUALS, families: 29 },
    { ...COUNTERFACTUALS, expectationFailures: 1 },
    { ...COUNTERFACTUALS, wrongAgainstRederivedTruth: 1 },
    { ...COUNTERFACTUALS, invariantViolations: 1 },
  ]) {
    const evidence = confirmationEvidence({ counterfactualsOnLiveBases: counterfactuals });
    assert.equal(status(evidence, "CA-5"), "FAIL", JSON.stringify(counterfactuals));
    assert.equal(evaluateGate(evidence).awarded, "READY_FOR_SHADOW");
  }
});

test("the Passive Shadow v3 evidence of record alone meets no live minimum", () => {
  // Its recorded dimensions: 29 trajectories with cases, 27 vehicles, 5 routes,
  // 1 window, 1 time band (its contested trajectories are not in the recorded
  // summary; at most 29). Even a clean replay of it stays below
  // confirmation-assisted, and that is by design, not by tuning.
  const v3 = liveReplay({
    collections: 1, trajectories: 29, vehicles: 27, contestedTrajectories: 29, routes: 5, collectionWindows: 1, timeBands: 1,
  });
  const result = evaluateGate(confirmationEvidence({ liveReplay: v3 }));
  assert.equal(result.awarded, "READY_FOR_SHADOW");
  assert.deepEqual(result.nextLevel?.blockedBy.map((row) => row.id), ["CA-6", "CA-7"]);
});

test("bounded automation needs 300 trajectories at session cadence, and the client mitigations", () => {
  const ba = MINIMUMS.boundedAutomation;
  const session = {
    trajectories: ba.trajectories, vehicles: ba.vehicles, routes: ba.routes, contestedTrajectories: ba.contestedTrajectories,
    collectionWindows: ba.collectionWindows, timeBands: ba.timeBands,
  };
  const large = liveReplay({ ...session, providerPaths: ["tapso-public-api", "tago-direct"], sessionCadence: session });
  const allMitigations = {
    riderSeesAndCanUndoAutomaticPick: true,
    destinationAlertIndependentOfProviderLag: true,
    physicalDeviceLiveActivityVerified: true,
    riderBoardsFirstArrivingBusMeasured: false,
  };
  const ready = confirmationEvidence({ liveReplay: large, humanOnlyMitigations: allMitigations });
  assert.equal(evaluateGate(ready).awarded, "READY_FOR_BOUNDED_AUTOMATION");

  // Without the mitigations the live sample alone is not enough.
  const unmitigated = confirmationEvidence({ liveReplay: large });
  assert.equal(evaluateGate(unmitigated).awarded, "READY_FOR_CONFIRMATION_ASSISTED");
  assert.equal(status(unmitigated, "BA-3"), "FAIL");
  assert.equal(status(unmitigated, "BA-4"), "FAIL");
  // A device check nobody made is missing evidence, not a failed one.
  assert.equal(status(unmitigated, "BA-5"), "MISSING");

  // The cached public path alone is not session-cadence evidence, however large.
  const none = { trajectories: 0, vehicles: 0, routes: 0, contestedTrajectories: 0, collectionWindows: 0, timeBands: 0 };
  const cachedOnly = confirmationEvidence({
    liveReplay: { ...large, providerPaths: ["tapso-public-api"], sessionCadence: none }, humanOnlyMitigations: allMitigations,
  });
  assert.equal(status(cachedOnly, "BA-1"), "FAIL");
  assert.equal(status(cachedOnly, "BA-2"), "FAIL");
  assert.equal(evaluateGate(cachedOnly).awarded, "READY_FOR_CONFIRMATION_ASSISTED");

  // Each dimension of the session-cadence sample is necessary.
  for (const key of ["trajectories", "vehicles", "routes", "contestedTrajectories", "collectionWindows", "timeBands"] as const) {
    const short = confirmationEvidence({
      liveReplay: { ...large, sessionCadence: { ...session, [key]: ba[key] - 1 } }, humanOnlyMitigations: allMitigations,
    });
    assert.equal(status(short, "BA-1"), "FAIL", key);
  }
});

test("live and counterfactual evidence from other matcher sources is stale, and stale is missing", () => {
  const stale = confirmationEvidence({ currentMatcherSourceSha256: "the-current-digest" });
  for (const id of ["CA-1", "CA-2", "CA-3", "CA-4", "CA-5", "CA-6", "CA-7"]) assert.equal(status(stale, id), "MISSING", id);
  assert.equal(evaluateGate(stale).awarded, "READY_FOR_SHADOW");
  assert.match(evaluateGate(stale).criteria.find((row) => row.id === "CA-2")!.observed, /stale/);
  // With no current digest to compare against, nothing live counts either.
  const unknown = confirmationEvidence({ currentMatcherSourceSha256: undefined });
  assert.equal(status(unknown, "CA-1"), "MISSING");
  // Only the counterfactuals stale: CA-5 alone is missing.
  const staleCounterfactuals = confirmationEvidence({ counterfactualsOnLiveBases: { ...COUNTERFACTUALS, matcherSourceSha256: "old" } });
  assert.equal(status(staleCounterfactuals, "CA-5"), "MISSING");
  assert.equal(status(staleCounterfactuals, "CA-1"), "PASS");
});

test("every negative control in the catalogue is pinned by the gate, and every pinned one exists", () => {
  const catalogue = NEGATIVE_CONTROLS.map((control) => control.id).sort();
  assert.deepEqual([...PINNED_NEGATIVE_CONTROLS].sort(), catalogue);
});

test("a mitigation counts only with evidence that can exist for it alone", () => {
  const passing = ["BA-3: the rider sees the committed bus and undoes it", "an unrelated passing test"];
  const context = (records: Record<string, unknown> = {}) => ({ passingTests: passing, readRecord: (record: string) => records[record] });
  const tests = (names: string[]): MitigationEntry => ({ met: true, evidenceKind: "tests", evidence: { tests: names }, source: "synthetic" });
  const holds = (key: keyof typeof MITIGATION_CRITERIA, entry: MitigationEntry, records?: Record<string, unknown>) =>
    mitigationEvidenceHolds(key, entry, context(records)).holds;

  assert.equal(holds("riderSeesAndCanUndoAutomaticPick", tests(["BA-3: the rider sees the committed bus and undoes it"])), true);
  // A passing test that is not named for the criterion proves nothing about it.
  assert.equal(holds("riderSeesAndCanUndoAutomaticPick", tests(["an unrelated passing test"])), false);
  // Named for the criterion but not passing in this run.
  assert.equal(holds("riderSeesAndCanUndoAutomaticPick", tests(["BA-3: something that never ran"])), false);
  // Another criterion's tests.
  assert.equal(holds("destinationAlertIndependentOfProviderLag", tests(["BA-3: the rider sees the committed bus and undoes it"])), false);
  assert.equal(holds("riderSeesAndCanUndoAutomaticPick", { ...tests(["BA-3: the rider sees the committed bus and undoes it"]), met: false }), false);
  assert.equal(holds("riderSeesAndCanUndoAutomaticPick", tests([])), false);

  const record = {
    evidenceClass: "VERIFIED_LIVE_HUMAN", property: "physicalDeviceLiveActivityVerified", criterion: "BA-5",
    procedure: "synthetic procedure", subject: "synthetic device and build", performedBy: "synthetic person",
    performedAt: "2026-10-01T09:00:00+09:00", result: "pass",
  };
  const human = (path: string): MitigationEntry => ({ met: true, evidenceKind: "human_record", evidence: { record: path }, source: "synthetic" });
  assert.equal(holds("physicalDeviceLiveActivityVerified", human("r.json"), { "r.json": record }), true);
  // A bare two-field record, another property's record, or a failed check does not count.
  assert.equal(holds("physicalDeviceLiveActivityVerified", human("r.json"), {
    "r.json": { evidenceClass: "VERIFIED_LIVE_HUMAN", property: "physicalDeviceLiveActivityVerified" },
  }), false);
  assert.equal(holds("physicalDeviceLiveActivityVerified", human("r.json"), { "r.json": { ...record, property: "riderBoardsFirstArrivingBusMeasured" } }), false);
  assert.equal(holds("physicalDeviceLiveActivityVerified", human("r.json"), { "r.json": { ...record, result: "fail" } }), false);
  assert.equal(holds("physicalDeviceLiveActivityVerified", human("missing.json")), false);
  // A device check cannot be shown by tests, and client behaviour not by a human record.
  assert.equal(holds("physicalDeviceLiveActivityVerified", tests(["BA-5: a test"])), false);
  assert.equal(holds("riderSeesAndCanUndoAutomaticPick", human("r.json"), { "r.json": { ...record, criterion: "BA-3" } }), false);
});

test("automatic matching needs rider behaviour measured by humans; no passive evidence can award it", () => {
  const ba = MINIMUMS.boundedAutomation;
  const sample = {
    trajectories: ba.trajectories * 10, vehicles: ba.vehicles * 10, routes: ba.routes * 2, contestedTrajectories: ba.contestedTrajectories * 10,
    collectionWindows: ba.collectionWindows * 10, timeBands: 4,
  };
  const huge = liveReplay({ ...sample, providerPaths: ["tago-direct"], sessionCadence: sample });
  const evidence = confirmationEvidence({
    liveReplay: huge,
    humanOnlyMitigations: {
      riderSeesAndCanUndoAutomaticPick: true,
      destinationAlertIndependentOfProviderLag: true,
      physicalDeviceLiveActivityVerified: true,
      riderBoardsFirstArrivingBusMeasured: false,
    },
  });
  const result = evaluateGate(evidence);
  assert.equal(result.awarded, "READY_FOR_BOUNDED_AUTOMATION");
  assert.equal(status(evidence, "AM-1"), "MISSING");
  assert.equal(result.nextLevel?.level, "READY_FOR_AUTOMATIC_MATCHING");
});

test("the result is a pure function of the evidence", () => {
  const evidence = confirmationEvidence();
  assert.deepEqual(evaluateGate(evidence), evaluateGate(structuredClone(evidence)));
  const levels = new Set<ReadinessLevel>(READINESS_LEVELS);
  assert.ok(levels.has(evaluateGate(evidence).awarded));
});
