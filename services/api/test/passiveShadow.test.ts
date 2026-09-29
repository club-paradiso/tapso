import assert from "node:assert/strict";
import test from "node:test";

import type { RiderState } from "../src/domain.ts";
import { MATCHER_POLICY_VERSION } from "../src/matching.ts";
import { LEGACY_MATCHER_POLICY_VERSION, matchVehicleLegacySymmetricV0 } from "../src/matchingLegacy.ts";
import { replayMatching, type MatchGateEvidence, type ReplayOptions } from "../src/matchReplay.ts";
import type { RideCapture } from "../src/rideCapture.ts";
import {
  BLIND_INPUT_KEYS,
  GroundTruthLeakError,
  PASSIVE_CASE_POLICY_V1,
  assertBlindMatcherInput,
  extractTrajectories,
  generatePassiveCases,
  validatePassiveStream,
  type PassiveCase,
  type PassiveMatcherInput,
} from "../src/passiveShadow.ts";
import { blindLabels, evaluatePassiveCase, type EvaluateOptions, type ReplayFunction } from "../src/passiveShadowEvaluate.ts";
import { evaluatePerturbations, PERTURBATIONS } from "../src/passiveShadowPerturb.ts";
import { buildWrongCommitLedger, difficultyProfile, rateMetrics, summarizeAdversarial, summarizeLive } from "../src/passiveShadowSummary.ts";
import { runPassiveShadowPipeline, type PipelineOutput } from "../src/passiveShadowPipeline.ts";
import { SYN_ROUTE, T0, syntheticStream } from "./syntheticPassive.ts";

const DECOY = "SYN-DECOY-0001";
const TRUTH = "SYN-TRUTH-0002";
const UNPLACED = "SYN-UNPLACED-0003";

/**
 * The legacy `symmetric-stop-distance-v0` policy, injected on purpose: it is
 * the one that commits to buses that have already left the stop (finding F1).
 * Tests use it only where they need those wrong commits to exist, and every
 * result it produces names its own policy.
 */
const LEGACY = { matcher: matchVehicleLegacySymmetricV0, matcherPolicy: LEGACY_MATCHER_POLICY_VERSION };
const legacyReplay: ReplayFunction = (capture, options) => replayMatching(capture, { ...options, ...LEGACY });

/**
 * A departed decoy two stops past the boarding stop, and the bus the rider
 * will board five stops away: the F1 hazard, built synthetically.
 */
function departedDecoyStream() {
  return syntheticStream({
    buses: [
      { id: DECOY, startSequence: 11, msPerStop: 30_000, offsetMs: -15_000 },
      { id: TRUTH, startSequence: 4, msPerStop: 30_000, offsetMs: -10_000 },
    ],
    durationMs: 700_000,
  });
}

/**
 * The bus the rider boards reaches stop 10 at +240 s, one stop a minute, so
 * when the feed freezes two minutes earlier it is two stops out and moving.
 * Until that instant the feed also carries a bus of the route with no readable
 * stop sequence, which then leaves it. Present, then remembered for the 90 s
 * evidence window, its unknown progress withholds every decision for exactly
 * as long as the approaching bus's last real move still counts as fresh.
 * Without it that bus would already be committed in the first seconds of the
 * freeze, before the part under test: frozen content cannot be told from a bus
 * that just moved until it fills the window. After that, only the frozen
 * content stands between the approaching bus and a selection.
 */
function frozenFeedStream() {
  return syntheticStream({
    buses: [
      { id: TRUTH, startSequence: 6, msPerStop: 60_000 },
      { id: UNPLACED, startSequence: 3, msPerStop: 60_000, withoutStopSequence: true, hidden: [[120_000, Number.POSITIVE_INFINITY]] },
    ],
    durationMs: 700_000,
  });
}

function caseAt(cases: PassiveCase[], stop: number, startAt = T0, scenario = "WAIT_AT_STOP"): PassiveCase {
  const found = cases.find((item) => item.meta.boardingSequence === stop
    && item.meta.scenario === scenario
    && Date.parse(item.meta.sessionStartAt) === startAt);
  assert.ok(found, `no ${scenario} case at stop ${stop}`);
  return found!;
}

/** A replay double that commits to whichever raw vehicle id it is told to. */
function committingReplay(vehicleId: string | undefined, extra: Partial<MatchGateEvidence> = {}): ReplayFunction {
  return (capture, options) => {
    const real = replayMatching(capture, options);
    const label = vehicleId === undefined ? undefined : options.labels.get(vehicleId);
    return {
      ...real,
      ...(label ? { firstCommit: { at: capture.snapshots.at(-1)!.capturedAt, selectedLabel: label, eligibleCount: 1, snapshotsBefore: 0 } } : {}),
      ...(label ? {} : { firstCommit: undefined }),
      decisions: (real.decisions ?? []).map((decision) => ({ ...decision, status: label ? decision.status : "unavailable" as const })),
      ...extra,
    };
  };
}

/**
 * The directed side of a legacy comparison: no case and no adversarial variant
 * commits, for a waiting rider, to a bus at or past the boarding stop, or, for
 * a rider on board, to one that has not yet left it.
 */
function assertNoDepartedCommit(output: PipelineOutput): void {
  const variants = output.perturbed.flatMap((entry) => entry.variants.flatMap((variant) => (variant.result ? [variant.result] : [])));
  assert.ok(output.results.length > 0 && variants.length > 0);
  for (const result of [...output.results, ...variants]) {
    const label = `${result.caseId}${result.perturbation ? ` (${result.perturbation})` : ""}`;
    assert.equal(result.matcherPolicy, MATCHER_POLICY_VERSION, label);
    assert.notEqual(result.wrongKind, "DEPARTED_VEHICLE", label);
    assert.equal(result.directedInvariantViolated, false, label);
  }
}

/* ------------------------------------------------------------ leak guard */

test("matcher input carries only the blind fields and verbatim provider snapshots", () => {
  const stream = departedDecoyStream();
  const { cases } = generatePassiveCases([stream]);
  assert.ok(cases.length > 0);
  for (const passiveCase of cases) {
    assert.deepEqual(new Set(Object.keys(passiveCase.input)), new Set(BLIND_INPUT_KEYS));
    const encoded = JSON.stringify(passiveCase.input);
    for (const forbidden of ["boardedVehicleId", "groundTruth", "truth", "expected", "plate", "tracked"]) {
      assert.equal(encoded.includes(`"${forbidden}`), false, `input leaks ${forbidden}`);
    }
    // Every window snapshot is byte-for-byte a stream snapshot, in provider order.
    for (const snapshot of passiveCase.input.snapshots) {
      const original = stream.snapshots.find((item) => item.capturedAt === snapshot.capturedAt);
      assert.deepEqual(snapshot, original);
    }
  }
});

test("the replay never receives the answer, and the vault opens only after it", () => {
  const stream = departedDecoyStream();
  const { cases, vault } = generatePassiveCases([stream]);
  const passiveCase = caseAt(cases, 10);
  const calls: Array<{ capture: RideCapture; options: ReplayOptions; revealedBefore: boolean }> = [];
  const spy: ReplayFunction = (capture, options) => {
    calls.push({ capture, options, revealedBefore: vault.wasRevealed(passiveCase.meta.caseId) });
    return replayMatching(capture, options);
  };
  evaluatePassiveCase(passiveCase, vault, { replay: spy });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call!.options.boardedVehicleId, undefined);
  assert.equal("boardedVehicleId" in call!.capture, false);
  assert.equal(call!.revealedBefore, false);
  assert.equal(vault.wasRevealed(passiveCase.meta.caseId), true);
  // Pseudonyms come from the input alone: first appearance order, no `tracked`.
  assert.deepEqual([...call!.options.labels.values()].sort(), ["C1", "C2"]);
});

test("a ground-truth field smuggled into the matcher input is refused", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
  const passiveCase = caseAt(cases, 10);
  const leaked = { ...passiveCase.input, boardedVehicleId: TRUTH } as unknown as PassiveMatcherInput;
  assert.throws(() => assertBlindMatcherInput(leaked), GroundTruthLeakError);
  assert.throws(() => evaluatePassiveCase({ ...passiveCase, input: leaked }, vault), GroundTruthLeakError);
  const annotated = {
    ...passiveCase.input,
    snapshots: passiveCase.input.snapshots.map((snapshot, index) => (index === 0 ? { ...snapshot, answer: TRUTH } : snapshot)),
  } as unknown as PassiveMatcherInput;
  assert.throws(() => assertBlindMatcherInput(annotated), GroundTruthLeakError);
});

test("a ground-truth field smuggled into a vehicle row or a route stop is refused", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
  const passiveCase = caseAt(cases, 10);
  const withVehicles = passiveCase.input.snapshots.findIndex((snapshot) => snapshot.vehicles.length > 0);
  assert.ok(withVehicles >= 0, "the fixture has a snapshot with vehicles");
  // A per-vehicle flag is the most direct way to hand the matcher its answer;
  // the guard must look inside every row, not only at the envelope.
  const flagged = {
    ...passiveCase.input,
    snapshots: passiveCase.input.snapshots.map((snapshot, index) => (index !== withVehicles ? snapshot : {
      ...snapshot,
      vehicles: snapshot.vehicles.map((vehicle) => ({ ...vehicle, isGroundTruth: vehicle.vehicleId === TRUTH })),
    })),
  } as unknown as PassiveMatcherInput;
  assert.throws(() => assertBlindMatcherInput(flagged), (error: unknown) =>
    error instanceof GroundTruthLeakError && /vehicle row carries non-blind field "isGroundTruth"/.test(error.message));
  assert.throws(() => evaluatePassiveCase({ ...passiveCase, input: flagged }, vault), GroundTruthLeakError);

  const annotatedStops = {
    ...passiveCase.input,
    stops: passiveCase.input.stops.map((stop, index) => (index === 0 ? { ...stop, boardedHere: TRUTH } : stop)),
  } as unknown as PassiveMatcherInput;
  assert.throws(() => assertBlindMatcherInput(annotatedStops), (error: unknown) =>
    error instanceof GroundTruthLeakError && /route stop carries non-blind field "boardedHere"/.test(error.message));

  // Every field a real provider row carries is still accepted.
  assert.doesNotThrow(() => assertBlindMatcherInput(passiveCase.input));
});

test("the replay receives the scenario's rider state and nothing else from the case metadata", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
  const waiting = caseAt(cases, 10);
  const onBoard = caseAt(cases, 10, T0 + 170_000, "ON_BOARD_START");
  const runs: Array<{ passiveCase: PassiveCase; riderState: RiderState; evaluate: EvaluateOptions; keys: string[] }> = [
    { passiveCase: waiting, riderState: "waiting_at_stop", evaluate: {}, keys: ["labels", "recordDecisions", "riderState"] },
    { passiveCase: onBoard, riderState: "on_board", evaluate: {}, keys: ["labels", "recordDecisions", "riderState"] },
    // A comparison replay adds the matcher it names, and still nothing from the case.
    { passiveCase: waiting, riderState: "waiting_at_stop", evaluate: LEGACY, keys: ["labels", "matcher", "matcherPolicy", "recordDecisions", "riderState"] },
  ];
  for (const run of runs) {
    const calls: Array<{ capture: RideCapture; options: ReplayOptions }> = [];
    const spy: ReplayFunction = (capture, options) => {
      calls.push({ capture, options });
      return replayMatching(capture, options);
    };
    evaluatePassiveCase(run.passiveCase, vault, { ...run.evaluate, replay: spy });
    assert.equal(calls.length, 1);
    const { capture, options } = calls[0]!;
    assert.deepEqual(Object.keys(options).sort(), run.keys);
    assert.equal(options.riderState, run.riderState);
    assert.deepEqual(new Set(Object.keys(capture)), new Set(BLIND_INPUT_KEYS));
    // Not even inside an allowed field: no trajectory, event, case or time the generator knows.
    const encoded = JSON.stringify({ ...options, labels: [...options.labels] });
    for (const field of ["caseId", "streamId", "collectionId", "scenario", "sessionStartAt", "windowEndAt", "boardingEventId", "trajectoryId"] as const) {
      assert.equal(encoded.includes(run.passiveCase.meta[field]), false, `the replay received meta.${field}`);
    }
  }
});

/* ------------------------------------------------------- real matcher */

test("the legacy symmetric matcher commits to a departed decoy: PASSIVE_WRONG, DEPARTED_VEHICLE (finding F1, synthetic)", () => {
  // The legacy policy, injected on purpose: the permanent demonstration that
  // this evaluation catches F1 in any matcher that has it.
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
  const result = evaluatePassiveCase(caseAt(cases, 10), vault, LEGACY);
  assert.equal(result.matcherPolicy, LEGACY_MATCHER_POLICY_VERSION);
  assert.equal(result.groundTruthVehicleId, TRUTH);
  assert.equal(result.bucket, "PASSIVE_WRONG");
  assert.equal(result.committedVehicleId, DECOY);
  assert.equal(result.wrongKind, "DEPARTED_VEHICLE");
  assert.equal(result.difficulty, "DEPARTED_DECOY");
  assert.equal(result.directedInvariantViolated, true);
  assert.equal(result.sourceClass, "SYNTHETIC_OR_PERTURBED");
  assert.ok(result.timeline && result.timeline.length > 0, "a failed case keeps its decision timeline");
});

test("the directed matcher never commits to the departed decoy (finding F1, synthetic)", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
  const passiveCase = caseAt(cases, 10);
  const replayed: MatchGateEvidence[] = [];
  const result = evaluatePassiveCase(passiveCase, vault, {
    replay: (capture, options) => {
      const evidence = replayMatching(capture, options);
      replayed.push(evidence);
      return evidence;
    },
  });
  assert.equal(result.matcherPolicy, MATCHER_POLICY_VERSION);
  assert.notEqual(result.bucket, "PASSIVE_WRONG");
  assert.notEqual(result.committedVehicleId, DECOY);
  assert.equal(result.wrongKind, undefined);
  assert.equal(result.directedInvariantViolated, false);
  // Refused on its position at every decision, not by an accident of timing:
  // first at the boarding stop's unresolved edge, then as departed.
  const decoy = blindLabels(passiveCase.input).get(DECOY);
  const decisions = replayed[0]!.decisions!;
  assert.ok(decisions.some((decision) => decision.candidates.some((candidate) => candidate.label === decoy)));
  for (const decision of decisions) {
    assert.notEqual(decision.selectedLabel, decoy, `decoy selected at ${decision.at}`);
    const row = decision.candidates.find((candidate) => candidate.label === decoy);
    if (!row) continue;
    assert.ok(
      row.rejectedReasons.includes("boarding_stop_position_unresolved") || row.rejectedReasons.includes("departed_boarding_stop"),
      `decoy not refused on position at ${decision.at}`,
    );
  }
});

test("an approaching bus with no decoy nearby is PASSIVE_CORRECT", () => {
  const stream = syntheticStream({
    buses: [
      { id: TRUTH, startSequence: 8, msPerStop: 30_000, offsetMs: -5_000 },
      { id: DECOY, startSequence: 18, msPerStop: 30_000 },
    ],
    durationMs: 600_000,
  });
  const { cases, vault } = generatePassiveCases([stream]);
  const result = evaluatePassiveCase(caseAt(cases, 10), vault);
  assert.equal(result.bucket, "PASSIVE_CORRECT");
  assert.equal(result.committedVehicleId, TRUTH);
  assert.equal(result.timeline, undefined);
});

test("an ON_BOARD_START case replays as a rider already aboard and commits only once the bus has left the stop", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()], { scenarios: ["ON_BOARD_START"] });
  const passiveCase = caseAt(cases, 10, T0 + 170_000, "ON_BOARD_START");
  const replayed: MatchGateEvidence[] = [];
  const result = evaluatePassiveCase(passiveCase, vault, {
    replay: (capture, options) => {
      const evidence = replayMatching(capture, options);
      replayed.push(evidence);
      return evidence;
    },
  });
  assert.equal(replayed[0]!.riderState, "on_board");
  assert.equal(result.riderState, "on_board");
  assert.equal(result.bucket, "PASSIVE_CORRECT");
  assert.equal(result.committedVehicleId, TRUTH);
  assert.ok(result.committedStopOffset! >= 1 && result.committedStopOffset! <= 4, `committed at offset ${result.committedStopOffset}`);
  assert.equal(result.directedInvariantViolated, false);
  // Replayed as a waiting rider instead, the same capture never commits: the
  // bus is at the boarding stop from the first snapshot.
  const asWaiting = evaluatePassiveCase(passiveCase, vault, {
    replay: (capture, options) => replayMatching(capture, { ...options, riderState: "waiting_at_stop" }),
  });
  assert.equal(asWaiting.committedVehicleId, undefined);
});

/* ------------------------------------------------------- buckets */

test("changing only the matcher's output changes the verdict", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
  const passiveCase = caseAt(cases, 10);
  assert.equal(evaluatePassiveCase(passiveCase, vault, { replay: committingReplay(TRUTH) }).bucket, "PASSIVE_CORRECT");
  assert.equal(evaluatePassiveCase(passiveCase, vault, { replay: committingReplay(DECOY) }).bucket, "PASSIVE_WRONG");
  assert.equal(evaluatePassiveCase(passiveCase, vault, { replay: committingReplay(undefined) }).bucket, "PASSIVE_ABSTAINED");
});

test("abstention is never counted as correct", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
  const abstained = evaluatePassiveCase(caseAt(cases, 10), vault, { replay: committingReplay(undefined) });
  const correct = evaluatePassiveCase(caseAt(cases, 10), vault, { replay: committingReplay(TRUTH) });
  assert.equal(abstained.bucket, "PASSIVE_ABSTAINED");
  const metrics = rateMetrics([abstained, correct]);
  assert.equal(metrics.committed, 1);
  assert.equal(metrics.committedSelectionPrecision, 1);
  assert.equal(metrics.coverage, 0.5);
  assert.equal(metrics.abstentionRate, 0.5);
});

test("a commit made on non-fresh cadence is PASSIVE_STALE_FAILURE even when it is the right bus", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
  const passiveCase = caseAt(cases, 10);
  const stale = committingReplay(TRUTH);
  const replay: ReplayFunction = (capture, options) => {
    const evidence = stale(capture, options);
    return { ...evidence, staleData: { ...evidence.staleData, selectionsWhileNotFresh: 1 } };
  };
  assert.equal(evaluatePassiveCase(passiveCase, vault, { replay }).bucket, "PASSIVE_STALE_FAILURE");
});

test("a committed vehicle that reversed before the commit is PASSIVE_DIRECTION_FAILURE", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
  const passiveCase = caseAt(cases, 10);
  // The truth bus reports one stop backwards in the second snapshot.
  const reversed: PassiveCase = {
    ...passiveCase,
    input: {
      ...passiveCase.input,
      snapshots: passiveCase.input.snapshots.map((snapshot, index) => index !== 1 ? snapshot : {
        ...snapshot,
        vehicles: snapshot.vehicles.map((vehicle) => vehicle.vehicleId === TRUTH
          ? { ...vehicle, stopSequence: vehicle.stopSequence! - 2 }
          : vehicle),
      }),
    },
  };
  assert.equal(evaluatePassiveCase(reversed, vault, { replay: committingReplay(TRUTH) }).bucket, "PASSIVE_DIRECTION_FAILURE");
});

test("provider failures are classified, never read as an empty route", () => {
  const stream = syntheticStream({
    buses: [{ id: TRUTH, startSequence: 8, msPerStop: 30_000, offsetMs: -5_000 }],
    durationMs: 600_000,
    // Every other poll fails between 20 s and 90 s.
    failedPolls: (index, offset) => offset >= 20_000 && offset < 90_000 && index % 2 === 0,
  });
  for (const snapshot of stream.snapshots.filter((item) => item.error)) assert.deepEqual(snapshot.vehicles, []);
  const { cases, vault } = generatePassiveCases([stream]);
  const passiveCase = caseAt(cases, 10);
  const result = evaluatePassiveCase(passiveCase, vault, { replay: committingReplay(undefined) });
  assert.ok(result.failedPolls > 0);
  // Failures are counted; the case is not silently turned into "no bus".
  assert.equal(result.totalPolls, passiveCase.input.snapshots.length);
  // Nor is a failed poll replayed as a decision over an empty route.
  assert.equal(result.decisionsEvaluated, passiveCase.input.snapshots.filter((snapshot) => !snapshot.error).length);

  const heavy = syntheticStream({
    buses: [{ id: TRUTH, startSequence: 8, msPerStop: 30_000, offsetMs: -5_000 }],
    durationMs: 600_000,
    failedPolls: (_index, offset) => offset >= 10_000 && offset < 45_000,
  });
  const heavyCases = generatePassiveCases([heavy]);
  const heavyResult = evaluatePassiveCase(caseAt(heavyCases.cases, 10), heavyCases.vault, { replay: committingReplay(undefined) });
  assert.equal(heavyResult.bucket, "PASSIVE_PROVIDER_FAILURE");

  const corrupt = structuredClone(heavy);
  corrupt.snapshots[3] = { ...corrupt.snapshots[3]!, vehicles: corrupt.snapshots[20]!.vehicles };
  corrupt.snapshots[3]!.error = "SYNTHETIC";
  assert.throws(() => validatePassiveStream(corrupt), /failed snapshot that also claims vehicles/);
});

/* ------------------------------------------------------- generator */

test("an insufficient trajectory never becomes a case", () => {
  // The bus crosses stop 10 across a 120 s hole: the bracket is too wide to
  // say when it arrived, so nothing at stop 10 may be scored against it.
  const stream = syntheticStream({
    buses: [{ id: TRUTH, startSequence: 6, msPerStop: 30_000, hidden: [[80_000, 200_000]] }],
    durationMs: 700_000,
  });
  const generated = generatePassiveCases([stream]);
  assert.equal(generated.cases.filter((item) => item.meta.boardingSequence === 10).length, 0);
  assert.ok(generated.rejections.GT_BRACKET_TOO_WIDE + generated.rejections.GT_IDENTITY_UNCERTAIN > 0);

  // A bus seen in one snapshot only has no crossing at all.
  const blip = syntheticStream({
    buses: [{ id: TRUTH, startSequence: 9, msPerStop: 30_000, hidden: [[5_000, 10_000_000]] }],
    durationMs: 600_000,
  });
  assert.equal(generatePassiveCases([blip]).cases.length, 0);
});

test("a bus that appears already past the stop makes the first arrival unknowable", () => {
  const stream = syntheticStream({
    buses: [
      { id: TRUTH, startSequence: 6, msPerStop: 30_000 },
      // Enters the feed at +60 s already at stop 11: it may have passed 10 unseen.
      { id: DECOY, startSequence: 11, msPerStop: 30_000, offsetMs: 60_000, hidden: [[0, 60_000]] },
    ],
    durationMs: 700_000,
  });
  const generated = generatePassiveCases([stream]);
  assert.equal(generated.cases.some((item) => item.meta.boardingSequence === 10 && Date.parse(item.meta.sessionStartAt) === T0), false);
  assert.ok(generated.rejections.GT_IDENTITY_UNCERTAIN > 0);
});

test("a bus sitting at the boarding stop when the rider arrives makes the first arrival unknowable", () => {
  const stream = syntheticStream({
    buses: [
      // At stop 10 from −10 s to +50 s: the rider arriving at T0 might board it.
      { id: DECOY, startSequence: 10, msPerStop: 60_000, offsetMs: -10_000 },
      { id: TRUTH, startSequence: 6, msPerStop: 30_000 },
    ],
    durationMs: 700_000,
  });
  const generated = generatePassiveCases([stream], { scenarios: ["WAIT_AT_STOP"] });
  assert.equal(generated.cases.some((item) => item.meta.boardingSequence === 10 && Date.parse(item.meta.sessionStartAt) === T0), false);
  assert.ok(generated.rejections.GT_VEHICLE_AT_STOP_AT_START > 0);
});

test("duplicate starts that resolve to the same window are deduplicated", () => {
  const stream = departedDecoyStream();
  // A 2 s grid on a 5 s poll: several starts share their first snapshot.
  const generated = generatePassiveCases([stream], { policy: { ...PASSIVE_CASE_POLICY_V1, startGridMs: 2_000 }, scenarios: ["WAIT_AT_STOP"] });
  assert.ok(generated.rejections.DUPLICATE_CASE > 0);
  const keys = generated.cases.map((item) => `${item.meta.boardingSequence}|${item.input.snapshots[0]!.capturedAt}|${item.meta.trajectoryId}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("correlated cases stay traceable to one trajectory and one boarding event", () => {
  const stream = syntheticStream({
    buses: [{ id: TRUTH, startSequence: 2, msPerStop: 30_000 }],
    durationMs: 900_000,
  });
  const generated = generatePassiveCases([stream], { scenarios: ["WAIT_AT_STOP"] });
  const trajectories = extractTrajectories(stream);
  assert.equal(trajectories.length, 1);
  assert.ok(generated.cases.length > 5);
  assert.equal(new Set(generated.cases.map((item) => item.meta.trajectoryId)).size, 1);
  assert.ok(new Set(generated.cases.map((item) => item.meta.boardingEventId)).size < generated.cases.length);
  const output = runPassiveShadowPipeline([stream], { createdAt: "2026-09-25T00:00:00.000Z" });
  // Grouped counting sees one trajectory however many cases it produced.
  const grouped = output.results.length;
  assert.equal(new Set(output.results.map((result) => result.meta.trajectoryId)).size, 1);
  assert.ok(grouped > 1);
});

test("a new trip after a sequence reset is a new trajectory", () => {
  const stream = syntheticStream({
    buses: [
      { id: TRUTH, startSequence: 15, msPerStop: 60_000, hidden: [[180_000, 200_000]] },
    ],
    durationMs: 300_000,
  });
  // Rewrite the second half so the same vehicle restarts at stop 1.
  for (const snapshot of stream.snapshots) {
    if (Date.parse(snapshot.capturedAt) - T0 >= 240_000) {
      for (const vehicle of snapshot.vehicles) vehicle.stopSequence = 1;
    }
  }
  assert.equal(extractTrajectories(stream).length, 2);
});

/* ------------------------------------------------ evidence separation */

test("synthetic results can never enter the live section", () => {
  const output = runPassiveShadowPipeline([departedDecoyStream()], { createdAt: "2026-09-25T00:00:00.000Z" });
  assert.ok(output.results.length > 0);
  assert.equal(output.summary.live.cases, 0);
  assert.equal(output.summary.live.captures, 0);
  assert.ok(output.summary.adversarial.variants.length > 0);
  assert.throws(
    () => summarizeLive([], output.generated, output.results, (id) => id),
    /cannot enter the live section/,
  );
});

test("a stream cannot claim to be live when it was not collected from a live provider", () => {
  const stream = syntheticStream({ buses: [{ id: TRUTH, startSequence: 2, msPerStop: 30_000 }], sourceClass: "LIVE_PASSIVE" });
  assert.throws(() => validatePassiveStream(stream), /claims LIVE_PASSIVE/);
});

test("every perturbation is labelled synthetic and the ones that need the answer say so", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
  const passiveCase = caseAt(cases, 10);
  const variants = evaluatePerturbations(passiveCase, vault);
  assert.equal(variants.length, PERTURBATIONS.length);
  for (const variant of variants) {
    if (!variant.result) continue;
    assert.equal(variant.result.sourceClass, "SYNTHETIC_OR_PERTURBED");
    assert.equal(variant.result.perturbation, variant.perturbation.id);
  }
  // A perturbed live case is synthetic too: checked through a relabelled copy that never leaves this test.
  const relabelled: PassiveCase = { ...passiveCase, meta: { ...passiveCase.meta, sourceClass: "LIVE_PASSIVE" } };
  const fromLive = evaluatePerturbations(relabelled, vault).filter((variant) => variant.result !== undefined);
  assert.ok(fromLive.length > 0);
  for (const variant of fromLive) assert.equal(variant.result!.sourceClass, "SYNTHETIC_OR_PERTURBED", variant.perturbation.id);
  const opposite = variants.find((variant) => variant.perturbation.id === "synthetic_opposite_route_twin")!;
  assert.ok(opposite.result!.directionRejections > 0, "an opposite-route twin must be rejected on route");
  assert.ok(PERTURBATIONS.filter((item) => item.usesTruthIdentity).length >= 3);
  // A variant whose input changes with the answer's identity used it, whatever it declares.
  const truth = vault.reveal(passiveCase.meta.caseId);
  const context = { boardingAt: Date.parse(truth.provenance.crossingNextAt), truthVehicleId: truth.vehicleId, seed: 1 };
  const dependent = PERTURBATIONS.filter((perturbation) =>
    JSON.stringify(perturbation.apply(passiveCase.input, context) ?? null)
      !== JSON.stringify(perturbation.apply(passiveCase.input, { ...context, truthVehicleId: DECOY }) ?? null));
  assert.ok(dependent.length >= 3);
  for (const perturbation of dependent) assert.equal(perturbation.usesTruthIdentity, true, `${perturbation.id} depends on the answer's identity`);
  // Likewise for the answer's timing: a variant whose input moves with the
  // boarding instant used it, whatever it declares.
  const timed = PERTURBATIONS.filter((perturbation) =>
    JSON.stringify(perturbation.apply(passiveCase.input, context) ?? null)
      !== JSON.stringify(perturbation.apply(passiveCase.input, { ...context, boardingAt: context.boardingAt - 30_000 }) ?? null));
  assert.ok(timed.length >= 3);
  for (const perturbation of timed) assert.equal(perturbation.usesTruthTiming, true, `${perturbation.id} depends on the answer's timing`);
});

test("frozen provider content never unlocks a selection once it fills the cadence window", () => {
  const { cases, vault } = generatePassiveCases([frozenFeedStream()]);
  const passiveCase = caseAt(cases, 10);
  const boardingAt = Date.parse(vault.reveal(passiveCase.meta.caseId).provenance.crossingNextAt);
  const [frozen] = evaluatePerturbations(passiveCase, vault, {
    perturbations: PERTURBATIONS.filter((item) => item.id === "stale_repetition_120s_before_boarding"),
  });
  // After 90 s of identical rows the whole cadence window is unchanged content.
  const frozenTail = frozen!.result!.timeline!.filter((decision) => {
    const at = Date.parse(decision.at);
    return at >= boardingAt - 120_000 + 95_000 && at <= boardingAt;
  });
  assert.ok(frozenTail.length >= 3, "the frozen tail must contain decisions to judge");
  for (const decision of frozenTail) {
    assert.notEqual(decision.status, "matched", `selection on frozen content at ${decision.at}`);
    for (const candidate of decision.candidates) assert.notEqual(candidate.cadence, "fresh");
    // And the bus approaching the stop is refused for its frozen content alone:
    // it has no other rejection and no competitor is present or remembered.
    const approaching = decision.candidates.filter((candidate) => candidate.zone === "approaching");
    assert.equal(approaching.length, 1, `one approaching bus at ${decision.at}`);
    assert.deepEqual(approaching[0]!.rejectedReasons, ["source_cadence_not_fresh"]);
    assert.equal(decision.rememberedVehicles, undefined);
    // Nothing else withholds: frozen content is what refuses the bus.
    assert.equal(decision.abstentionReasons, undefined, `unexpected withholding reasons at ${decision.at}`);
  }
});

test("the opt-in decision timeline changes no existing replay output", () => {
  const { cases } = generatePassiveCases([departedDecoyStream()]);
  const input = caseAt(cases, 10).input;
  const labels = blindLabels(input);
  const plain = replayMatching({ ...input }, { labels });
  const recorded = replayMatching({ ...input }, { labels, recordDecisions: true });
  assert.equal("decisions" in plain, false);
  const { decisions, ...rest } = recorded;
  assert.deepEqual(rest, plain);
  assert.equal(decisions!.length, plain.evaluatedSnapshots);
});

test("the summary exposes no raw vehicle number", () => {
  const stream = syntheticStream({
    buses: [
      { id: "제주70자1234", startSequence: 11, msPerStop: 30_000, offsetMs: -15_000 },
      { id: "제주70자5678", startSequence: 4, msPerStop: 30_000, offsetMs: -10_000 },
    ],
    durationMs: 700_000,
  });
  // Under the legacy policy too, injected on purpose: on this stream only it
  // makes the wrong commits whose diagnostics name a committed vehicle.
  for (const replay of [undefined, legacyReplay]) {
    const output = runPassiveShadowPipeline([stream], { createdAt: "2026-09-25T00:00:00.000Z", ...(replay ? { replay } : {}) });
    const encoded = JSON.stringify(output.summary);
    assert.equal(encoded.includes("1234"), false);
    assert.equal(encoded.includes("5678"), false);
    assert.ok(encoded.includes("veh-01"));
    if (replay) assert.ok(output.summary.diagnostics.some((diagnostic) => diagnostic.matcherFinalChoice !== null));
    assert.equal(output.summary.automaticMatching, "disabled");
    assert.equal(output.summary.gateClosed, false);
  }
  assert.equal(SYN_ROUTE, stream.routeId);
});

test("an abstention is attributed to the freshness gate only when the true bus was never fresh", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
  const passiveCase = caseAt(cases, 10);
  // Every row frozen: no candidate can ever be fresh, so nothing may commit.
  const frozenAll: PassiveCase = {
    ...passiveCase,
    input: {
      ...passiveCase.input,
      snapshots: passiveCase.input.snapshots.map((snapshot) => ({
        ...snapshot,
        vehicles: passiveCase.input.snapshots[0]!.vehicles.map((vehicle) => ({ ...vehicle, receivedAt: snapshot.capturedAt })),
      })),
    },
  };
  const frozen = evaluatePassiveCase(frozenAll, vault);
  assert.equal(frozen.committedVehicleId, undefined);
  // Not even the legacy policy commits here, and on the live rows it commits to the decoy (below).
  assert.equal(evaluatePassiveCase(frozenAll, vault, LEGACY).committedVehicleId, undefined);
  assert.equal(frozen.groundTruthNeverFresh, true);
  const live = evaluatePassiveCase(passiveCase, vault);
  assert.equal(live.groundTruthNeverFresh, false);
  const adversarial = summarizeAdversarial([{
    baseline: live,
    variants: [{ perturbation: PERTURBATIONS[0]!, result: { ...frozen, sourceClass: "SYNTHETIC_OR_PERTURBED" } }],
  }]);
  assert.equal(adversarial.variants[0]!.staleRejection, 1);
  // A wrong commit is never counted as a freshness rejection, whatever its
  // cadence history. The directed matcher makes none on this case, so the wrong
  // commit is the legacy policy's, injected on purpose.
  const wrong = evaluatePassiveCase(passiveCase, vault, LEGACY);
  assert.equal(wrong.bucket, "PASSIVE_WRONG");
  const wrongAdversarial = summarizeAdversarial([{
    baseline: live,
    variants: [{ perturbation: PERTURBATIONS[0]!, result: { ...wrong, groundTruthNeverFresh: true, sourceClass: "SYNTHETIC_OR_PERTURBED" } }],
  }]);
  assert.equal(wrongAdversarial.variants[0]!.staleRejection, 0);
});

test("the wrong-commit profile covers every wrong commit and records how far past the stop it was", () => {
  // The legacy policy, injected on purpose: the profile needs wrong commits to
  // cover, and on this stream only the legacy policy makes any.
  const output = runPassiveShadowPipeline([departedDecoyStream()], { createdAt: "2026-09-25T00:00:00.000Z", replay: legacyReplay });
  assert.ok(output.results.every((result) => result.matcherPolicy === LEGACY_MATCHER_POLICY_VERSION));
  const wrong = output.results.filter((result) => result.bucket === "PASSIVE_WRONG");
  assert.ok(wrong.length > 0);
  for (const result of wrong) assert.ok(result.committedStopOffset !== undefined);
  const decoy = wrong.find((result) => result.meta.boardingSequence === 10 && Date.parse(result.meta.sessionStartAt) === T0)!;
  assert.ok(decoy.committedStopOffset! > 0, "a departed decoy is past the boarding stop");
  // summarizeLive refuses synthetic results, so the profile is checked through a relabelled copy that never leaves this test.
  const relabelled = wrong.map((result) => ({ ...result, sourceClass: "LIVE_PASSIVE" as const }));
  const profile = summarizeLive([], output.generated, relabelled, (id) => id).wrongCommitProfile;
  assert.equal(profile.total, wrong.length);
  assert.equal(Object.values(profile.byWrongKind).reduce((sum, value) => sum + value, 0), wrong.length);
  // The same stream under the directed matcher.
  assertNoDepartedCommit(runPassiveShadowPipeline([departedDecoyStream()], { createdAt: "2026-09-25T00:00:00.000Z" }));
});

test("every live wrong commit gets its own ledger record with the mechanism read off the commit decision", () => {
  const stream = syntheticStream({
    buses: [
      { id: "제주70자1234", startSequence: 11, msPerStop: 30_000, offsetMs: -15_000 },
      { id: "제주70자5678", startSequence: 4, msPerStop: 30_000, offsetMs: -10_000 },
    ],
    durationMs: 700_000,
  });
  // The legacy policy, injected on purpose: the ledger needs wrong commits to
  // record, and on this stream only the legacy policy makes any.
  const output = runPassiveShadowPipeline([stream], { createdAt: "2026-09-25T00:00:00.000Z", replay: legacyReplay });
  // Synthetic results never enter the live ledger.
  assert.equal(output.wrongCommitLedger.total, 0);
  const wrong = output.results.filter((result) => result.bucket === "PASSIVE_WRONG");
  assert.ok(wrong.length > 0);
  // Relabelled copies that never leave this test, to exercise the live path.
  const ledger = buildWrongCommitLedger([stream], wrong.map((result) => ({ ...result, sourceClass: "LIVE_PASSIVE" as const })));
  assert.equal(ledger.total, wrong.length);
  assert.equal(ledger.records.length, wrong.length);
  const encoded = JSON.stringify(ledger);
  assert.equal(encoded.includes("1234"), false);
  assert.equal(encoded.includes("5678"), false);
  const record = ledger.records.find((item) => item.boardingSequence === 10 && Date.parse(item.sessionStartAt) === T0)!;
  assert.equal(record.mechanism, "SOLE_ELIGIBLE_DEPARTED__TRUTH_BEYOND_4_STOPS");
  assert.equal(record.commitDecision!.eligibleCount, 1);
  assert.ok(record.commitDecision!.candidates.some((candidate) => candidate.role === "SELECTED" && candidate.stopOffset! > 0));
  assert.ok(record.truthAtCommit.inFeed);
  assert.ok(record.truthAtCommit.rejected!.includes("implausible_boarding_position"));
  assert.ok(record.timeline.some((decision) => decision.status === "matched" && decision.selected === "SELECTED"));
  // The same stream under the directed matcher leaves nothing to record, even relabelled live.
  const directed = runPassiveShadowPipeline([stream], { createdAt: "2026-09-25T00:00:00.000Z" });
  assertNoDepartedCommit(directed);
  assert.equal(buildWrongCommitLedger([stream], directed.results.map((result) => ({ ...result, sourceClass: "LIVE_PASSIVE" as const }))).total, 0);
});

test("the difficulty profile separates trivial cases and counts abstentions that were safer than committing", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
  const passiveCase = caseAt(cases, 10);
  // The legacy policy, injected on purpose: only under it is the departed decoy eligible at all.
  const abstained = evaluatePassiveCase(passiveCase, vault, { replay: committingReplay(undefined), ...LEGACY });
  // The departed decoy was the first eligible candidate: forcing a commit would have picked it.
  assert.equal(abstained.forcedTopWouldBeWrong, true);
  assert.ok(abstained.approachingVsDepartedDecisions > 0);
  // The directed matcher never makes a departed bus eligible, so the same
  // counterfactual picks the approaching truth, and the case itself commits to
  // nothing at or past the stop.
  assert.equal(evaluatePassiveCase(passiveCase, vault, { replay: committingReplay(undefined) }).forcedTopWouldBeWrong, false);
  const directed = evaluatePassiveCase(passiveCase, vault);
  assert.notEqual(directed.wrongKind, "DEPARTED_VEHICLE");
  assert.equal(directed.directedInvariantViolated, false);
  const single = syntheticStream({
    buses: [{ id: TRUTH, startSequence: 8, msPerStop: 30_000, offsetMs: -5_000 }],
    durationMs: 600_000,
  });
  const singleCases = generatePassiveCases([single]);
  const correct = evaluatePassiveCase(caseAt(singleCases.cases, 10), singleCases.vault);
  assert.equal(correct.bucket, "PASSIVE_CORRECT");
  assert.ok(correct.maxNearbyCandidates <= 1);
  assert.equal(correct.forcedTopWouldBeWrong, undefined);
  const profile = difficultyProfile([abstained, correct]);
  assert.equal(profile.oneOrNoNearbyCandidate.cases, 1);
  assert.equal(profile.twoPlusNearbyCandidates.cases, 1);
  assert.equal(profile.abstentionCounterfactual.nonCommitted, 1);
  assert.equal(profile.abstentionCounterfactual.wouldBeWrong, 1);
  assert.equal(profile.departedDecoy.cases, 1);
});
