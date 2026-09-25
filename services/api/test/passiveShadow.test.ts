import assert from "node:assert/strict";
import test from "node:test";

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
import { blindLabels, evaluatePassiveCase, type ReplayFunction } from "../src/passiveShadowEvaluate.ts";
import { evaluatePerturbations, PERTURBATIONS } from "../src/passiveShadowPerturb.ts";
import { rateMetrics, summarizeAdversarial, summarizeLive } from "../src/passiveShadowSummary.ts";
import { runPassiveShadowPipeline } from "../src/passiveShadowPipeline.ts";
import { SYN_ROUTE, T0, syntheticStream } from "./syntheticPassive.ts";

const DECOY = "SYN-DECOY-0001";
const TRUTH = "SYN-TRUTH-0002";

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

/* ------------------------------------------------------- real matcher */

test("the real matcher commits to a departed decoy: PASSIVE_WRONG, DEPARTED_VEHICLE (finding F1, synthetic)", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
  const result = evaluatePassiveCase(caseAt(cases, 10), vault);
  assert.equal(result.groundTruthVehicleId, TRUTH);
  assert.equal(result.bucket, "PASSIVE_WRONG");
  assert.equal(result.committedVehicleId, DECOY);
  assert.equal(result.wrongKind, "DEPARTED_VEHICLE");
  assert.equal(result.difficulty, "DEPARTED_DECOY");
  assert.equal(result.sourceClass, "SYNTHETIC_OR_PERTURBED");
  assert.ok(result.timeline && result.timeline.length > 0, "a failed case keeps its decision timeline");
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
  const variants = evaluatePerturbations(caseAt(cases, 10), vault);
  assert.equal(variants.length, PERTURBATIONS.length);
  for (const variant of variants) {
    if (!variant.result) continue;
    assert.equal(variant.result.sourceClass, "SYNTHETIC_OR_PERTURBED");
    assert.equal(variant.result.perturbation, variant.perturbation.id);
  }
  const opposite = variants.find((variant) => variant.perturbation.id === "synthetic_opposite_route_twin")!;
  assert.ok(opposite.result!.directionRejections > 0, "an opposite-route twin must be rejected on route");
  assert.ok(PERTURBATIONS.filter((item) => item.usesTruthIdentity).length >= 3);
});

test("frozen provider content never unlocks a selection once it fills the cadence window", () => {
  const { cases, vault } = generatePassiveCases([departedDecoyStream()]);
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
  const output = runPassiveShadowPipeline([stream], { createdAt: "2026-09-25T00:00:00.000Z" });
  const encoded = JSON.stringify(output.summary);
  assert.equal(encoded.includes("1234"), false);
  assert.equal(encoded.includes("5678"), false);
  assert.ok(encoded.includes("veh-01"));
  assert.equal(output.summary.automaticMatching, "disabled");
  assert.equal(output.summary.gateClosed, false);
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
  assert.equal(frozen.groundTruthNeverFresh, true);
  const live = evaluatePassiveCase(passiveCase, vault);
  assert.equal(live.groundTruthNeverFresh, false);
  const adversarial = summarizeAdversarial([{
    baseline: live,
    variants: [{ perturbation: PERTURBATIONS[0]!, result: { ...frozen, sourceClass: "SYNTHETIC_OR_PERTURBED" } }],
  }]);
  assert.equal(adversarial.variants[0]!.staleRejection, 1);
  // A wrong commit is never counted as a freshness rejection, whatever its cadence history.
  const wrongAdversarial = summarizeAdversarial([{
    baseline: live,
    variants: [{ perturbation: PERTURBATIONS[0]!, result: { ...live, groundTruthNeverFresh: true, sourceClass: "SYNTHETIC_OR_PERTURBED" } }],
  }]);
  assert.equal(wrongAdversarial.variants[0]!.staleRejection, 0);
});

test("the wrong-commit profile covers every wrong commit and records how far past the stop it was", () => {
  const output = runPassiveShadowPipeline([departedDecoyStream()], { createdAt: "2026-09-25T00:00:00.000Z" });
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
});
