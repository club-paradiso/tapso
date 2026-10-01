/**
 * Passive counterfactuals over SYNTHETIC bases only: invented routes, invented
 * vehicles, coordinate grids that are not places. Nothing here is evidence
 * about TAGO, a bus or a rider. It is evidence about the counterfactual
 * machinery, and about what the production matcher does in constructed worlds.
 *
 * The bases are built here rather than in syntheticPassive.ts because their
 * buses move continuously: coordinates change every poll like a GPS fix, and
 * the stop sequence changes once per stop.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { MatchRequest, MatchResult, VehicleObservation } from "../src/domain.ts";
import { replayMatching, type ReplayOptions } from "../src/matchReplay.ts";
import { LEGACY_MATCHER_POLICY_VERSION, matchVehicleLegacySymmetricV0 } from "../src/matchingLegacy.ts";
import type { RideCapture } from "../src/rideCapture.ts";
import {
  generatePassiveCases,
  sortedSnapshots,
  toBlindCapture,
  type PassiveObservationStream,
  type PassiveScenario,
} from "../src/passiveShadow.ts";
import { blindLabels, type ReplayFunction } from "../src/passiveShadowEvaluate.ts";
import { summarizeLive } from "../src/passiveShadowSummary.ts";
import {
  COUNTERFACTUALS,
  COUNTERFACTUAL_POLICY_V1,
  INJECTED_ID_PREFIX,
  counterfactualContext,
  counterfactualGateEvidence,
  evaluateCounterfactual,
  rederiveGroundTruth,
  runCounterfactuals,
  type Counterfactual,
  type CounterfactualFamily,
  type CounterfactualRow,
  type CounterfactualRun,
} from "../src/passiveCounterfactual.ts";

import {
  EPOCH,
  T0,
  TRUE_BUS_A,
  baseA,
  baseR,
  baseSlow,
  inBaseA,
  inBaseR,
  syntheticStream,
} from "./syntheticCounterfactualBases.ts";

/**
 * A SYNTHETIC stand-in for a live collection: invented vehicles on an invented
 * route, labelled LIVE_PASSIVE by hand (with the provider path that label
 * requires) only so the labelling and sanitizing rules can be tested. It is not
 * an observation and never leaves this file.
 */
function liveStandIn(): PassiveObservationStream {
  return syntheticStream({
    streamId: "cf-standin-live-labelled",
    routeId: "SYN-CF-L",
    stopCount: 30,
    durationMs: 1_200_000,
    pollMs: 10_000,
    providerPath: "tago-direct",
    sourceClass: "LIVE_PASSIVE",
    buses: [
      { id: "SYN-STANDIN-7001", startSequence: 2, msPerStop: 40_000 },
      { id: "SYN-STANDIN-7002", startSequence: 1, msPerStop: 40_000, appearsAtMs: 120_000 },
    ],
  });
}

/* ------------------------------------------------------------- helpers */

const FAMILIES = [...new Set(COUNTERFACTUALS.map((counterfactual) => counterfactual.family))];

function counterfactual(id: string): Counterfactual {
  const found = COUNTERFACTUALS.find((item) => item.id === id);
  assert.ok(found, `no counterfactual ${id}`);
  return found;
}

const pick = (...ids: string[]) => ids.map(counterfactual);

function row(rows: CounterfactualRow[], id: string): CounterfactualRow {
  const found = rows.find((item) => item.id === id);
  assert.ok(found, `no row ${id}`);
  return found;
}

function baseCase(stream: PassiveObservationStream, stop: number, scenario: PassiveScenario, startAt: number) {
  const generated = generatePassiveCases([stream]);
  const passiveCase = generated.cases.find((item) => item.meta.boardingSequence === stop
    && item.meta.scenario === scenario
    && Date.parse(item.meta.sessionStartAt) === startAt);
  assert.ok(passiveCase, `no ${scenario} case at stop ${stop} starting ${new Date(startAt).toISOString()}`);
  const truth = generated.vault.reveal(passiveCase.meta.caseId);
  return { passiveCase, truth, context: counterfactualContext(passiveCase, truth, sortedSnapshots(stream)) };
}

let sharedRunA: CounterfactualRun | undefined;
/** Every counterfactual over base A, once, with every evaluation kept. */
function runA(): CounterfactualRun {
  sharedRunA ??= runCounterfactuals([baseA()], { caseFilter: inBaseA, keepEvaluations: true });
  return sharedRunA;
}

function evaluationsOf(run: CounterfactualRun, id: string) {
  return (run.evaluations ?? []).filter((evaluation) => evaluation.counterfactualId === id);
}

/* ------------------------------------------- one test per family (base A) */

/** What each family must also show on base A, beyond "no expectation failed": that it built what it says. */
const FAMILY_CHECKS: Partial<Record<CounterfactualFamily, (rows: CounterfactualRow[], run: CounterfactualRun) => void>> = {
  departed_decoy: (rows) => {
    for (const item of rows) assert.equal(item.selectionsOfInjected, 0, item.id);
    // One stop past is where dwelling and departing cannot be told apart: session memory withholds for good.
    assert.equal(row(rows, "departed_decoy_s1").correct, 0);
    assert.ok(row(rows, "departed_decoy_s2").correct > 0, "a decoy two stops past must not stop the true bus being found");
    assert.ok(row(rows, "departed_decoy_s4").correct > 0);
  },
  true_bus_approaching: (rows) => assert.ok(rows[0]!.correct > 0),
  approaching_vs_departed: (rows, run) => {
    assert.ok(rows[0]!.correct > 0);
    // The geometry was really built: some pre-boarding decision saw a bus approaching while the decoy sat past the stop.
    assert.ok(evaluationsOf(run, rows[0]!.id).some((evaluation) => (evaluation.result?.approachingVsDepartedDecisions ?? 0) > 0));
  },
  leader_follower: (rows) => {
    for (const item of rows) assert.equal(item.selectionsOfInjected, 0, item.id);
    for (const id of ["follower_behind_k3", "follower_behind_k4", "follower_behind_k5", "follower_behind_k10"]) {
      assert.ok(row(rows, id).correct > 0, `${id}: three or more stops of lead still lets the true bus be picked`);
    }
  },
  follower_overtaking: (rows) => {
    assert.ok(rows[0]!.gtQualified > 0);
    assert.equal(rows[0]!.gtChanged, rows[0]!.gtQualified, "the re-derived answer is the overtaking phantom");
  },
  leader_ahead: (rows) => {
    for (const item of rows) {
      assert.ok(item.gtQualified > 0, item.id);
      assert.equal(item.gtChanged, item.gtQualified, `${item.id}: the re-derived answer is the phantom`);
    }
    assert.ok(row(rows, "leader_ahead_k3").commitsToInjected > 0, "a phantom three stops ahead is the bus to pick");
  },
  boarding_stop_dwell: (rows) => {
    for (const item of rows) assert.ok(item.correct > 0, item.id);
  },
  true_bus_absent: (rows) => {
    assert.ok(rows[0]!.gtChanged > 0, "without the true bus the follower becomes the answer");
    assert.ok(rows[0]!.correct > 0);
  },
  decoys_absent: (rows) => assert.ok(rows[0]!.correct > 0),
  late_appearance: (rows) => assert.ok(rows[0]!.correct > 0),
  candidate_disappearance: (rows) => assert.ok(rows[0]!.correct > 0),
  lost_leader: (rows) => {
    for (const item of rows) assert.equal(item.selectionsOfInjected, 0, `${item.id}: the follower is never picked while the leader may be ahead of it`);
  },
  reappearance: (rows) => assert.ok(rows[0]!.correct > 0),
  stale_repeated_frames: (rows) => assert.ok(rows[0]!.correct > 0),
  coordinate_freeze: (rows) => assert.ok(rows[0]!.correct > 0),
  content_freeze: (rows) => assert.equal(rows[0]!.gtIndeterminate, rows[0]!.applicable, "in a frozen feed nothing is seen to reach the stop"),
  long_polling_gap: (rows) => assert.equal(rows[0]!.gtIndeterminate, rows[0]!.applicable),
  route_loop_seam: (rows, run) => {
    // Near the route start, the bus finishing its trip now approaches "across the seam": it competes and is never picked.
    const unchanged = row(run.report.counterfactuals, "session_start_waiting").correct + row(run.report.counterfactuals, "session_start_on_board").correct;
    assert.ok(rows[0]!.correct < unchanged, `the seam must cost coverage at stop 3 (${rows[0]!.correct} vs ${unchanged})`);
  },
  duplicated_stop_name: (rows) => {
    const item = rows[0]!;
    assert.equal(item.correct + item.wrong + item.staleFailure + item.directionFailure + item.indeterminateCommitted, 0);
  },
  route_variant_twin: (rows) => assert.equal(rows[0]!.selectionsOfInjected, 0),
  backwards_decoy: (rows) => assert.equal(rows[0]!.selectionsOfInjected, 0),
  multiple_eligible: (rows) => assert.ok(rows[0]!.correct > 0, "a lead of three stops over both phantoms still picks the true bus"),
  zero_eligible: (rows) => {
    const item = rows[0]!;
    assert.equal(item.correct + item.wrong + item.staleFailure + item.indeterminateCommitted, 0);
  },
  session_start_waiting: (rows) => assert.ok(rows[0]!.correct > 0),
  session_start_on_board: (rows) => assert.ok(rows[0]!.correct > 0),
  delayed_on_board_start: (rows) => {
    for (const item of rows) assert.ok(item.correct > 0, item.id);
  },
};

for (const family of FAMILIES) {
  test(`${family}: its metamorphic expectations hold under the production directed matcher (synthetic base A)`, () => {
    const run = runA();
    const rows = run.report.counterfactuals.filter((item) => item.family === family);
    assert.ok(rows.length > 0);
    for (const item of rows) {
      assert.ok(item.applicable > 0, `${item.id} never applied: ${JSON.stringify(item.skippedByReason)}`);
      // Applied is not judged: a counterfactual whose own expectations can
      // never be decided checks nothing but the invariant (finding R26). The
      // one exception is by design: the canonical GT_INDETERMINATE case.
      if (item.id !== "long_polling_gap_120s") {
        assert.ok(item.exercised > 0, `${item.id} applied ${item.applicable} times and never decided its own expectations`);
      }
      assert.equal(item.expectationFailures.count, 0, `${item.id}: ${JSON.stringify(item.expectationFailures)}`);
      assert.equal(item.invariantViolations, 0, item.id);
      assert.equal(item.wrong, 0, item.id);
      assert.equal(item.groundTruthShiftMismatches.count, 0, item.id);
    }
    FAMILY_CHECKS[family]?.(rows, run);
  });
}

/* ------------------------------------------------------ the machinery */

test("counterfactual ids are unique, stable and documented, over at least 30 families", () => {
  const ids = COUNTERFACTUALS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(FAMILIES.length >= 30, `${FAMILIES.length} families`);
  for (const item of COUNTERFACTUALS) {
    assert.match(item.id, /^[a-z0-9_]+$/);
    assert.ok(item.doc.length > 20 && !item.doc.includes("\n"), `${item.id} needs a one-line doc`);
    assert.ok(item.expectations.length > 0 && item.scenarios.length > 0, item.id);
  }
  assert.deepEqual(ids, [
    "departed_decoy_s1", "departed_decoy_s2", "departed_decoy_s4",
    "true_bus_approaching", "approaching_vs_departed_s2",
    "follower_behind_k1", "follower_behind_k2", "follower_behind_k3", "follower_behind_k4", "follower_behind_k5", "follower_behind_k10",
    "follower_overtaking",
    "leader_ahead_k1", "leader_ahead_k2", "leader_ahead_k3", "leader_ahead_k4", "leader_ahead_k5", "leader_ahead_k10",
    "boarding_stop_dwell_60s", "boarding_stop_dwell_120s",
    "true_bus_absent", "decoys_absent", "late_appearance_s_minus_2", "candidate_disappearance_60s",
    "lost_leader_follower_k3_180s", "lost_leader_follower_k3_360s", "reappearance_60s", "reappearance_100s",
    "stale_repeated_frames_60s", "coordinate_freeze", "content_freeze_from_60s_before_boarding",
    "receipt_jitter_10s", "receipt_jitter_20s", "receipt_jitter_40s", "packet_loss_20pct", "packet_loss_50pct",
    "long_polling_gap_120s", "long_polling_gap_110s_resumed", "provider_error_burst_60s",
    "route_loop_seam", "duplicated_stop_name", "repeated_route_geometry", "route_variant_twin", "backwards_decoy",
    "delayed_movement_20s", "delayed_movement_40s", "early_movement_20s",
    "multiple_eligible_candidates", "zero_eligible", "identity_churn",
    "session_start_waiting", "session_start_on_board", "delayed_on_board_start_30s", "delayed_on_board_start_90s",
  ]);
});

test("a phantom that leads the true bus becomes the re-derived ground truth, and committing to it is correct", () => {
  const { passiveCase, context } = baseCase(baseA(), 12, "WAIT_AT_STOP", T0);
  assert.equal(context.truth.vehicleId, TRUE_BUS_A);

  const unchanged = rederiveGroundTruth(passiveCase.meta, counterfactual("session_start_waiting").apply(passiveCase, context)!);
  assert.equal(unchanged.status === "QUALIFIED" ? unchanged.truth.vehicleId : unchanged.reason, TRUE_BUS_A);

  const leader = counterfactual("leader_ahead_k3");
  const application = leader.apply(passiveCase, context)!;
  const rederived = rederiveGroundTruth(passiveCase.meta, application);
  assert.equal(rederived.status, "QUALIFIED");
  if (rederived.status !== "QUALIFIED") return;
  assert.equal(rederived.truth.vehicleId, `${INJECTED_ID_PREFIX}leader_ahead-1`);
  assert.ok(Date.parse(rederived.truth.provenance.crossingNextAt) < context.boardingAt, "the phantom reaches the stop first");

  const evaluation = evaluateCounterfactual(passiveCase, context, leader, application);
  assert.equal(evaluation.outcome, "correct");
  assert.equal(evaluation.committedVehicleId, `${INJECTED_ID_PREFIX}leader_ahead-1`);
  assert.equal(evaluation.committedToInjected, true);
  // Scored against the new answer, not the base one: committing to the base bus here would be wrong.
  assert.equal(evaluation.result?.groundTruthVehicleId, `${INJECTED_ID_PREFIX}leader_ahead-1`);
});

test("every injected vehicle is SYNTHETIC-CF-<family>-<n>, declared, and follows the real rows' receipt pattern", () => {
  const stream = baseA();
  const generated = generatePassiveCases([stream]);
  const snapshots = sortedSnapshots(stream);
  const realIds = new Set(stream.snapshots.flatMap((snapshot) => snapshot.vehicles.map((vehicle) => vehicle.vehicleId)));
  const injectedRows = new Map<string, number>();
  for (const passiveCase of generated.cases.filter((item) => inBaseA(item.meta))) {
    const context = counterfactualContext(passiveCase, generated.vault.reveal(passiveCase.meta.caseId), snapshots);
    for (const item of COUNTERFACTUALS) {
      if (!item.scenarios.includes(passiveCase.meta.scenario)) continue;
      const application = item.apply(passiveCase, context);
      if (!application) continue;
      for (const id of application.injected) assert.match(id, new RegExp(`^SYNTHETIC-CF-${item.family}-\\d+$`));
      for (const snapshot of [...application.leadIn, ...application.input.snapshots]) {
        for (const vehicle of snapshot.vehicles) {
          if (realIds.has(vehicle.vehicleId)) continue;
          assert.ok(vehicle.vehicleId.startsWith(INJECTED_ID_PREFIX), `${item.id} invented ${vehicle.vehicleId}`);
          assert.ok(application.injected.includes(vehicle.vehicleId), `${item.id} introduced ${vehicle.vehicleId} without declaring it`);
          // The pattern of the real rows: receipt time is the snapshot's, no provider observation time is invented.
          assert.equal(vehicle.receivedAt, snapshot.capturedAt, item.id);
          assert.equal(vehicle.timestampSource, "unavailable", item.id);
          assert.equal(vehicle.observedAt, EPOCH, item.id);
          injectedRows.set(item.family, (injectedRows.get(item.family) ?? 0) + 1);
        }
      }
    }
  }
  for (const family of ["departed_decoy", "approaching_vs_departed", "leader_follower", "follower_overtaking", "leader_ahead",
    "route_variant_twin", "backwards_decoy", "multiple_eligible", "identity_churn"] as const) {
    assert.ok((injectedRows.get(family) ?? 0) > 0, `${family} injected nothing`);
  }
});

test("injected decoys and phantoms become fresh: one that could never be fresh would prove nothing", () => {
  const { passiveCase, context } = baseCase(baseA(), 12, "WAIT_AT_STOP", T0);
  for (const id of ["departed_decoy_s2", "approaching_vs_departed_s2", "leader_ahead_k3", "follower_behind_k3", "multiple_eligible_candidates"]) {
    const application = counterfactual(id).apply(passiveCase, context);
    assert.ok(application, id);
    const labels = blindLabels(application.input);
    const evidence = replayMatching(toBlindCapture(application.input), { labels, recordDecisions: true });
    for (const injected of application.injected) {
      const label = labels.get(injected);
      assert.ok(label, `${id}: ${injected} is not in the replayed window`);
      assert.ok(evidence.decisions!.some((decision) => decision.candidates.some((candidate) => candidate.label === label && candidate.cadence === "fresh")),
        `${id}: ${injected} never reached fresh cadence`);
    }
  }
});

test("the identity counterfactuals re-derive exactly the generator's answer on every case, at both cadences", () => {
  for (const stream of [baseA(), baseR()]) {
    const run = runCounterfactuals([stream], { counterfactuals: pick("session_start_waiting", "session_start_on_board") });
    assert.ok(run.report.baseCases.generated > 100, stream.streamId);
    assert.equal(run.report.totals.applicable, run.report.baseCases.generated, stream.streamId);
    assert.equal(run.report.totals.gtQualified, run.report.baseCases.generated, stream.streamId);
    for (const item of run.report.counterfactuals) {
      assert.equal(item.expectationFailures.count, 0, `${stream.streamId} ${item.id}: ${JSON.stringify(item.expectationFailures)}`);
    }
  }
});

test("without the lead-in the model could not reproduce the generator, which is why it gets one", () => {
  const run = runCounterfactuals([baseR()], {
    counterfactuals: pick("session_start_waiting", "session_start_on_board"),
    counterfactualPolicy: { ...COUNTERFACTUAL_POLICY_V1, leadInMs: 0 },
  });
  // An on-board crossing's last sighting before the stop precedes the rider's declaration.
  const onBoard = row(run.report.counterfactuals, "session_start_on_board");
  assert.ok(onBoard.applicable > 0);
  assert.equal(onBoard.gtIndeterminateReasons.GT_ON_BOARD_CROSSING_NOT_FOUND, onBoard.applicable);
  // Off the start grid, a bus already past the stop at the first receipt would count as "appeared past the stop".
  const waiting = row(run.report.counterfactuals, "session_start_waiting");
  assert.ok((waiting.expectationFailures.byExpectation.GROUND_TRUTH_REPRODUCED ?? 0) > 0);
});

test("the matcher replays only the transformed session window: no lead-in, no answer", () => {
  const stream = baseA();
  const calls: Array<{ capture: RideCapture; options: ReplayOptions }> = [];
  const spy: ReplayFunction = (capture, options) => {
    calls.push({ capture, options });
    return replayMatching(capture, options);
  };
  const run = runCounterfactuals([stream], {
    counterfactuals: pick("departed_decoy_s2", "leader_ahead_k3", "delayed_on_board_start_90s"),
    caseFilter: (meta) => meta.boardingSequence === 12,
    replay: spy,
    keepEvaluations: true,
  });
  const evaluations = run.evaluations!;
  assert.ok(evaluations.length > 0);
  assert.equal(calls.length, evaluations.length);
  evaluations.forEach((evaluation, index) => {
    const { capture, options } = calls[index]!;
    assert.equal(options.boardedVehicleId, undefined);
    assert.equal("boardedVehicleId" in capture, false);
    assert.deepEqual(capture.markers, []);
    const start = Date.parse(evaluation.sessionStartAt);
    assert.ok(capture.snapshots.every((snapshot) => Date.parse(snapshot.capturedAt) >= start), `${evaluation.counterfactualId} leaked history into the replay`);
  });
  // ...while the model did have history to read.
  const { context } = baseCase(stream, 12, "WAIT_AT_STOP", T0 + 240_000);
  assert.ok(context.leadIn.length > 0);
});

test("a transformed world whose answer the model cannot name is GT_INDETERMINATE: checked, never scored", () => {
  const run = runA();
  const gap = evaluationsOf(run, "long_polling_gap_120s");
  assert.ok(gap.length > 0);
  for (const evaluation of gap) {
    assert.equal(evaluation.groundTruth.status, "GT_INDETERMINATE");
    assert.equal(evaluation.result, undefined);
    assert.equal(evaluation.outcome, undefined);
    assert.deepEqual(evaluation.expectationFailures, []);
  }
  const item = row(run.report.counterfactuals, "long_polling_gap_120s");
  assert.equal(item.correct + item.wrong + item.abstain + item.providerFailure + item.insufficient, 0);
});

test("real-cadence base R: every family applies and holds", () => {
  const run = runCounterfactuals([baseR()], { caseFilter: inBaseR });
  assert.equal(run.report.families, FAMILIES.length);
  for (const item of run.report.counterfactuals) {
    assert.equal(item.expectationFailures.count, 0, `${item.id}: ${JSON.stringify(item.expectationFailures)}`);
    assert.equal(item.invariantViolations, 0, item.id);
    assert.equal(item.wrong, 0, item.id);
    assert.equal(item.groundTruthShiftMismatches.count, 0, item.id);
  }
});

// Finding F9, found by this family: the legacy-scaled margin compared only
// vehicles 1-4 stops before the stop, so a leader at S-4 was committed with a
// same-route bus one stop behind it at S-5, and the overtaking bus arrived
// first. The margin is now counted in stops wherever the follower is.
test("follower_overtaking: no wrong commit when a bus overtakes from just beyond the approach window", () => {
  const run = runCounterfactuals([baseSlow(), baseR()], {
    counterfactuals: pick("follower_overtaking"),
    caseFilter: (meta) => meta.scenario === "WAIT_AT_STOP" && (meta.routeId === "SYN-CF-S" ? meta.boardingSequence === 12 : inBaseR(meta)),
  });
  const item = run.report.counterfactuals[0]!;
  assert.ok(item.applicable > 0);
  assert.equal(item.wrong, 0, JSON.stringify(run.report.records.map((record) => ({
    caseId: record.caseId, committed: record.committed, committedStopOffset: record.committedStopOffset, groundTruth: record.groundTruth,
  }))));
});

/**
 * Issue #61 (findings F21, F22). #63 once made this family refuse every case in
 * which the true bus, read sparsely, jumps three or more stops clear of the
 * smoothly moving phantom before the phantom overtakes it, calling the
 * overtake unknowable. It was knowable: the phantom starts inside the margin,
 * and the session sees it there. Refusing those cases hid all 61 real-base
 * wrong commits the issue reported (ablation run 36823397781). The family keeps
 * them. On this synthetic base the matcher commits no wrong bus on them with or
 * without F22; the regressions that fail without F21 and F22 are in
 * matching.test.ts, and the real-base runs are the evidence.
 */
test("follower_overtaking keeps the gap-opens-then-closes shape of issue #61, and the matcher withholds on it", () => {
  const stream = baseSlow();
  const generated = generatePassiveCases([stream]);
  const snapshots = sortedSnapshots(stream);
  const cf = counterfactual("follower_overtaking");
  let exercised = 0;

  for (const passiveCase of generated.cases.filter((item) => item.meta.scenario === "WAIT_AT_STOP")) {
    const truth = generated.vault.reveal(passiveCase.meta.caseId);
    const context = counterfactualContext(passiveCase, truth, snapshots);
    if (!cf.apply(passiveCase, context)) continue;

    for (let index = 1; index < passiveCase.input.snapshots.length; index += 1) {
      const variant = structuredClone(passiveCase);
      const snapshot = variant.input.snapshots[index]!;
      if (snapshot.error) continue;
      const truthRow = snapshot.vehicles.find((vehicle) => vehicle.vehicleId === truth.vehicleId);
      if (!truthRow?.stopSequence) continue;
      if (truthRow.stopSequence >= passiveCase.meta.boardingSequence - 1) continue;

      // The sparse-feed shape found in the live collection: the real bus
      // suddenly reports one stop short of the stop while the phantom keeps
      // its smooth motion, three or more stops behind it at that instant.
      truthRow.stopSequence = passiveCase.meta.boardingSequence - 1;
      const application = cf.apply(variant, context);
      assert.ok(application, "the family applies: the phantom was seen inside the margin before the gap opened");
      const evaluation = evaluateCounterfactual(variant, context, cf, application);
      assert.deepEqual(evaluation.expectationFailures, [], `${passiveCase.meta.caseId}: committed ${String(evaluation.committedStopOffset)}`);
      exercised += 1;
      break;
    }
    if (exercised >= 5) break;
  }

  assert.ok(exercised > 0, "the shape was constructed at least once");
});

/* ------------------------------------------------------------- honesty */

test("a counterfactual of a LIVE_PASSIVE case is SYNTHETIC_OR_PERTURBED, labelled COUNTERFACTUAL_OF_LIVE_PASSIVE, and kept out of every live count", () => {
  const stream = liveStandIn();
  const run = runCounterfactuals([stream], {
    counterfactuals: pick("departed_decoy_s2", "leader_ahead_k3", "route_variant_twin", "session_start_waiting"),
    caseFilter: (meta) => meta.boardingSequence === 12,
    keepEvaluations: true,
  });
  assert.equal(run.report.sourceClass, "SYNTHETIC_OR_PERTURBED");
  assert.equal(run.report.countsAsLiveEvidence, false);
  assert.equal(run.report.independentRides, 0);
  assert.deepEqual(Object.keys(run.report.evidenceLabels), ["COUNTERFACTUAL_OF_LIVE_PASSIVE"]);
  assert.deepEqual(Object.keys(run.report.baseSourceClasses), ["LIVE_PASSIVE"]);
  const evaluations = run.evaluations!;
  assert.ok(evaluations.length > 0);
  for (const evaluation of evaluations) {
    assert.equal(evaluation.baseSourceClass, "LIVE_PASSIVE");
    assert.equal(evaluation.sourceClass, "SYNTHETIC_OR_PERTURBED");
    assert.equal(evaluation.evidenceLabel, "COUNTERFACTUAL_OF_LIVE_PASSIVE");
    if (!evaluation.result) continue;
    assert.equal(evaluation.result.sourceClass, "SYNTHETIC_OR_PERTURBED");
    assert.equal(evaluation.result.meta.sourceClass, "SYNTHETIC_OR_PERTURBED");
    assert.equal(evaluation.result.perturbation, evaluation.counterfactualId);
  }
  const results = evaluations.flatMap((evaluation) => (evaluation.result ? [evaluation.result] : []));
  assert.ok(results.length > 0);
  assert.throws(() => summarizeLive([stream], generatePassiveCases([stream]), results, (id) => id), /cannot enter the live section/);

  // No raw vehicle id anywhere in a report; pseudonyms and SYNTHETIC-CF ids only. The legacy matcher is
  // replayed here only because it reliably produces per-case records that name real vehicles.
  const legacy = runCounterfactuals([stream], {
    counterfactuals: pick("departed_decoy_s2", "leader_ahead_k1"),
    caseFilter: (meta) => meta.boardingSequence === 12,
    matcher: matchVehicleLegacySymmetricV0,
    matcherPolicy: LEGACY_MATCHER_POLICY_VERSION,
  });
  assert.ok(legacy.report.records.length > 0);
  for (const report of [run.report, legacy.report]) {
    const encoded = JSON.stringify(report);
    for (const id of ["SYN-STANDIN-7001", "SYN-STANDIN-7002"]) assert.equal(encoded.includes(id), false, `${id} leaked`);
  }
  const records = JSON.stringify(legacy.report.records);
  assert.ok(records.includes("\"veh-01\""), "real vehicles appear as run pseudonyms");
  assert.ok(records.includes(`${INJECTED_ID_PREFIX}departed_decoy-1`), "injected vehicles appear under their SYNTHETIC-CF id");
});

test("gate evidence exists only for a complete run over live bases under the production matcher", () => {
  assert.equal(counterfactualGateEvidence(runA().report), undefined, "synthetic bases are never gate evidence");
  // The whole catalogue over every generated case of a live-labelled stand-in.
  const live = runCounterfactuals([liveStandIn()]);
  const evidence = counterfactualGateEvidence(live.report);
  assert.ok(evidence);
  assert.equal(evidence.sourceClass, "SYNTHETIC_OR_PERTURBED");
  assert.equal(evidence.evidenceLabel, "COUNTERFACTUAL_OF_LIVE_PASSIVE");
  // Only families whose own expectations were decided somewhere count.
  assert.equal(evidence.families, live.report.familiesExercised);
  assert.ok(live.report.familiesExercised <= live.report.families);
  for (const [family, row] of Object.entries(live.report.byFamily)) {
    if (row.exercised === 0) assert.ok(row.applicable >= 0, `${family} applied but was never judged, so it does not count`);
  }
  assert.equal(evidence.expectationFailures, live.report.totals.expectationFailures);
  assert.equal(evidence.wrongAgainstRederivedTruth, live.report.totals.wrong);
  assert.equal(evidence.invariantViolations, live.report.totals.invariantViolations);

  // Any restriction makes it a partial run, and a partial run is no evidence.
  const subset = { counterfactuals: pick("departed_decoy_s2", "leader_ahead_k3", "session_start_waiting") };
  const filtered = { caseFilter: (meta: { boardingSequence: number }) => meta.boardingSequence === 12 };
  const partial = [
    runCounterfactuals([liveStandIn()], subset),
    runCounterfactuals([liveStandIn()], filtered),
    runCounterfactuals([liveStandIn()], { ...subset, maxCasesPerScenario: 1 }),
    runCounterfactuals([liveStandIn()], { ...subset, matcher: matchVehicleLegacySymmetricV0, matcherPolicy: LEGACY_MATCHER_POLICY_VERSION }),
    runCounterfactuals([liveStandIn()], { ...subset, replay: (capture, options) => replayMatching(capture, options) }),
  ];
  for (const run of partial) assert.equal(counterfactualGateEvidence(run.report), undefined, JSON.stringify(run.report.restrictions));
  assert.equal(partial[1]!.report.restrictions.caseFilter, true);
  assert.equal(partial[2]!.report.baseCases.capped, true);
});

/* -------------------------------------------------------------- teeth */

test("the legacy symmetric matcher breaks the departed-decoy expectation: the expectations have teeth", () => {
  const run = runCounterfactuals([baseA()], {
    counterfactuals: pick("departed_decoy_s1", "departed_decoy_s2", "departed_decoy_s4", "approaching_vs_departed_s2", "duplicated_stop_name"),
    caseFilter: inBaseA,
    matcher: matchVehicleLegacySymmetricV0,
    matcherPolicy: LEGACY_MATCHER_POLICY_VERSION,
  });
  assert.equal(run.report.matcherPolicy, LEGACY_MATCHER_POLICY_VERSION);
  for (const id of ["departed_decoy_s1", "departed_decoy_s2", "departed_decoy_s4", "approaching_vs_departed_s2"]) {
    const item = row(run.report.counterfactuals, id);
    assert.ok((item.expectationFailures.byExpectation.NEVER_SELECTS_INJECTED ?? 0) > 0, `${id}: ${JSON.stringify(item.expectationFailures)}`);
    assert.ok(item.expectationFailures.caseIds.length > 0);
    assert.ok(item.invariantViolations > 0, `${id}: the legacy policy commits at or past the stop`);
  }
  // The legacy policy never read the stop list, so a second stop of the same name does not stop it.
  assert.ok((row(run.report.counterfactuals, "duplicated_stop_name").expectationFailures.byExpectation.NO_COMMIT ?? 0) > 0);
});

test("a replacement matcher must name its policy", () => {
  assert.throws(() => runCounterfactuals([baseA()], { counterfactuals: [], matcher: matchVehicleLegacySymmetricV0 }), /must name its policy/);
});

/* ------------------------------------------------------- determinism */

test("runCounterfactuals is pure and deterministic", () => {
  const options = {
    counterfactuals: pick("departed_decoy_s2", "leader_ahead_k3", "follower_overtaking", "receipt_jitter_40s", "packet_loss_50pct",
      "identity_churn", "content_freeze_from_60s_before_boarding", "delayed_on_board_start_30s", "route_loop_seam"),
    caseFilter: inBaseR,
    keepEvaluations: true,
  };
  const stream = baseR();
  const before = JSON.stringify(stream);
  const first = runCounterfactuals([stream], options);
  assert.equal(JSON.stringify(stream), before, "the base stream must not be mutated");
  const second = runCounterfactuals([baseR()], options);
  assert.deepEqual(second, first);
  assert.ok(first.report.totals.applicable > 0);
});

/* ------------------------------------------------ the checks have teeth */

/**
 * A matcher with every protection removed, for these tests only: it ignores
 * freshness, direction and which side of the stop a bus is on, prefers another
 * route's row, and commits at once to the row nearest the stop.
 */
const RECKLESS_POLICY = "reckless-test-matcher";
function reckless(request: MatchRequest): MatchResult {
  const distance = (row: VehicleObservation) => Math.abs((row.stopSequence ?? 1_000_000) - request.boardingStopSequence);
  const otherRoute = (row: VehicleObservation) => (row.routeId === request.routeId ? 1 : 0);
  const ranked = [...request.candidates].sort((left, right) =>
    otherRoute(left) - otherRoute(right) || distance(left) - distance(right) || (left.vehicleId < right.vehicleId ? -1 : 1));
  const chosen = ranked[0];
  return {
    status: chosen ? "matched" : "unavailable",
    confidence: chosen ? "high" : "unknown",
    ...(chosen ? { selectedVehicleId: chosen.vehicleId } : {}),
    ranked: ranked.map((row) => ({ vehicleId: row.vehicleId, score: 0, evidence: [], rejectedReasons: [] })),
    explanation: "test-only matcher with its protections removed",
    policyVersion: RECKLESS_POLICY,
  };
}

test("every family expectation bites: a matcher without protections fails each one", () => {
  const byExpectation = (run: CounterfactualRun, id: string) =>
    run.report.counterfactuals.find((row) => row.id === id)!.expectationFailures.byExpectation;
  const options = { matcher: reckless, matcherPolicy: RECKLESS_POLICY };

  const onA = runCounterfactuals([baseA()], {
    ...options,
    counterfactuals: pick("boarding_stop_dwell_60s", "route_variant_twin", "content_freeze_from_60s_before_boarding", "duplicated_stop_name", "departed_decoy_s1"),
  });
  assert.ok((byExpectation(onA, "boarding_stop_dwell_60s").NO_INVARIANT_VIOLATION ?? 0) > 0, "NO_INVARIANT_VIOLATION");
  assert.ok((byExpectation(onA, "route_variant_twin").NEVER_SELECTS_OTHER_ROUTE ?? 0) > 0, "NEVER_SELECTS_OTHER_ROUTE");
  assert.ok((byExpectation(onA, "content_freeze_from_60s_before_boarding").NO_SELECTION_ON_FROZEN_WINDOW ?? 0) > 0, "NO_SELECTION_ON_FROZEN_WINDOW");
  assert.ok((byExpectation(onA, "duplicated_stop_name").NO_COMMIT ?? 0) > 0, "NO_COMMIT");
  assert.ok((byExpectation(onA, "departed_decoy_s1").NEVER_SELECTS_INJECTED ?? 0) > 0, "NEVER_SELECTS_INJECTED");

  // NOT_WRONG: the overtaking bus is the re-derived answer, and a matcher that
  // commits at once takes the bus in front.
  const overtaking = runCounterfactuals([baseSlow(), baseR()], {
    ...options,
    counterfactuals: pick("follower_overtaking"),
    caseFilter: (meta) => meta.scenario === "WAIT_AT_STOP" && (meta.routeId === "SYN-CF-S" ? meta.boardingSequence === 12 : inBaseR(meta)),
  });
  assert.ok((byExpectation(overtaking, "follower_overtaking").NOT_WRONG ?? 0) > 0, "NOT_WRONG");

  // The same catalogue under the production matcher fails none of them.
  const production = runCounterfactuals([baseA()], {
    counterfactuals: pick("boarding_stop_dwell_60s", "route_variant_twin", "content_freeze_from_60s_before_boarding", "duplicated_stop_name", "departed_decoy_s1"),
  });
  assert.equal(production.report.totals.expectationFailures, 0);
});

test("the construction check catches a transformation that does not produce the answer it declares", () => {
  // The identity transformation, mislabelled as one whose answer becomes the
  // injected vehicle: the re-derived answer is the base bus, and it is flagged.
  const mislabelled: Counterfactual = { ...counterfactual("session_start_waiting"), id: "test_mislabelled_shift", groundTruthShift: "TO_INJECTED" };
  const run = runCounterfactuals([baseA()], { counterfactuals: [mislabelled] });
  const row = run.report.counterfactuals[0]!;
  assert.ok(row.gtQualified > 0);
  assert.equal(row.groundTruthShiftMismatches.count, row.gtQualified);
  assert.equal(run.report.totals.groundTruthShiftMismatches, row.gtQualified);
});
