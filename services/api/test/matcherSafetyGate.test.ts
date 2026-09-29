import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateGate,
  GATE_POLICY_VERSION,
  MINIMUMS,
  READINESS_LEVELS,
  readinessRank,
  type GateEvidence,
  type ReadinessLevel,
} from "../src/matcherSafetyGate.ts";

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
  total: 30, killed: 30, survived: 0, stale: 0, invalid: 0, timeout: 0, complete: true, baselineGreen: true, realTreeUnchanged: true,
};

function shadowEvidence(overrides: Partial<GateEvidence> = {}): GateEvidence {
  return {
    generatedAt: "2026-09-29T00:00:00.000Z",
    matcher: { policyVersion: "directed-route-progress-v1", legacyFreeServingPaths: true, runtimeInvariantEnforced: true },
    tests: { suitePassed: true, propertySeedsPerInvariant: 2_000, propertyRegressionSeedsReplayed: 8, propertyInvariantsCovered: 15 },
    negativeControls: CONTROLS,
    formerWrongCommitInstants: { records: 268, legacyReproduced: 268, currentCommits: 0 },
    deploymentPosture: { automaticMatchingOffEverywhere: true, checkedBy: "config_default" },
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
    cases: 900,
    trajectories: ca.trajectories,
    trajectoriesWithCommit: 40,
    vehicles: ca.vehicles,
    routes: ca.routes,
    collectionWindows: ca.collectionWindows,
    timeBands: ca.timeBands,
    contestedCases: ca.contestedCases,
    currentWrong: 0,
    currentInvariantViolations: 0,
    selectionsWhileNotFresh: 0,
    correctToWrong: 0,
    newWrong: 0,
    providerPaths: ["tapso-public-api"],
    ...overrides,
  };
}

const COUNTERFACTUALS: NonNullable<GateEvidence["counterfactualsOnLiveBases"]> = {
  families: 30,
  expectationFailures: 0,
  wrongAgainstRederivedTruth: 0,
  invariantViolations: 0,
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
  for (const id of ["SH-1", "SH-2", "SH-3", "SH-4", "SH-5", "SH-6"]) assert.equal(status(bare, id), "MISSING", id);
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
    ["CA-2", { currentWrong: 1 }],
    ["CA-2", { currentInvariantViolations: 1 }],
    ["CA-2", { selectionsWhileNotFresh: 1 }],
    ["CA-3", { correctToWrong: 1 }],
    ["CA-3", { newWrong: 1 }],
    ["CA-4", { deterministicAcrossRuns: false }],
    ["CA-6", { trajectories: ca.trajectories - 1 }],
    ["CA-6", { vehicles: ca.vehicles - 1 }],
    ["CA-6", { contestedCases: ca.contestedCases - 1 }],
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
  // Its measured dimensions: 29 trajectories, 27 vehicles, 46 contested cases,
  // 5 routes, 1 window, 1 time band. Even a clean replay of it stays below
  // confirmation-assisted, and that is by design, not by tuning.
  const v3 = liveReplay({
    collections: 1, trajectories: 29, vehicles: 27, contestedCases: 46, routes: 5, collectionWindows: 1, timeBands: 1,
  });
  const result = evaluateGate(confirmationEvidence({ liveReplay: v3 }));
  assert.equal(result.awarded, "READY_FOR_SHADOW");
  assert.deepEqual(result.nextLevel?.blockedBy.map((row) => row.id), ["CA-6", "CA-7"]);
});

test("bounded automation needs 300 trajectories, direct-TAGO evidence and the client mitigations", () => {
  const ba = MINIMUMS.boundedAutomation;
  const large = liveReplay({
    trajectories: ba.trajectories, vehicles: ba.vehicles, routes: ba.routes, contestedCases: ba.contestedCases,
    collectionWindows: ba.collectionWindows, timeBands: ba.timeBands, providerPaths: ["tapso-public-api", "tago-direct"],
  });
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

  // The cached public path alone is not session-cadence evidence.
  const cachedOnly = confirmationEvidence({ liveReplay: { ...large, providerPaths: ["tapso-public-api"] }, humanOnlyMitigations: allMitigations });
  assert.equal(status(cachedOnly, "BA-2"), "FAIL");
  assert.equal(evaluateGate(cachedOnly).awarded, "READY_FOR_CONFIRMATION_ASSISTED");

  for (const key of ["trajectories", "vehicles", "routes", "contestedCases", "collectionWindows", "timeBands"] as const) {
    const short = confirmationEvidence({ liveReplay: { ...large, [key]: ba[key] - 1 }, humanOnlyMitigations: allMitigations });
    assert.equal(status(short, "BA-1"), "FAIL", key);
  }
});

test("automatic matching needs rider behaviour measured by humans; no passive evidence can award it", () => {
  const ba = MINIMUMS.boundedAutomation;
  const huge = liveReplay({
    trajectories: ba.trajectories * 10, vehicles: ba.vehicles * 10, routes: ba.routes * 2, contestedCases: ba.contestedCases * 10,
    collectionWindows: ba.collectionWindows * 10, timeBands: 5, providerPaths: ["tago-direct"],
  });
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
