import test from "node:test";
import assert from "node:assert/strict";
import type { StopOnRoute, VehicleObservation } from "../src/domain.ts";
import {
  analyzeRideCapture,
  RIDE_CAPTURE_SCHEMA_VERSION,
  type RideCapture,
  type RideMarker,
  type RideSnapshot,
} from "../src/rideCapture.ts";
import {
  declaredRiderStateAtStart,
  replayBlind,
  replayMatching,
  type MatchGateEvidence,
  type ReplayOptions,
} from "../src/matchReplay.ts";
import { MATCHER_POLICY_VERSION } from "../src/matching.ts";
// The legacy symmetric policy, imported on purpose: a negative control showing
// that the capture this suite once scored as a wrong commit was finding F1, and
// the stand-in for any replacement matcher a comparison replay injects.
import { LEGACY_MATCHER_POLICY_VERSION, matchVehicleLegacySymmetricV0 } from "../src/matchingLegacy.ts";

/**
 * Synthetic fixture. Vehicle numbers are invented and the route is not real.
 *
 * The boarding stop is sequence 3. The stops carry coordinates, as real
 * captures do. The directed matcher never selects on them — only a stop
 * sequence says which side of the boarding stop a bus is on — but the cadence
 * surrogate fingerprints them, so a bus whose coordinates change is moving
 * even while its stop sequence stays put. The replay also hands the matcher
 * these stops as the route's topology; without them it withholds every
 * selection.
 *
 * `capture()` stamps the `boarded` marker at the first snapshot, as the Railway
 * and beta flows do, so `replayMatching` decides for a rider already on board
 * (`declaredRiderStateAtStart`): a bus may be selected one to four stops past
 * the boarding stop, and only when it is the one bus of the route there. The
 * lone-bus rides below start at the boarding stop and move away from it, as
 * the bus a rider has just boarded does.
 */
const base = Date.parse("2026-09-22T09:00:00+09:00");
const stops: StopOnRoute[] = Array.from({ length: 8 }, (_, index) => ({
  stopId: `SYN-${index + 1}`,
  name: `Synthetic ${index + 1}`,
  sequence: index + 1,
  latitude: 33.5 + index * 0.01,
  longitude: 126.5,
}));

const BOARDED = "제주79자9999";
const OTHER = "제주79자8888";

function at(seconds: number): string {
  return new Date(base + seconds * 1_000).toISOString();
}

function tago(
  vehicleId: string,
  seconds: number,
  stopSequence: number,
  overrides: Partial<VehicleObservation> = {},
): VehicleObservation {
  const stop = stops[stopSequence - 1]!;
  return {
    vehicleId,
    routeId: "SYN-ROUTE",
    observedAt: new Date(0).toISOString(),
    receivedAt: at(seconds),
    timestampSource: "unavailable",
    stopId: stop.stopId,
    stopSequence,
    latitude: stop.latitude,
    longitude: stop.longitude,
    directionCode: "1",
    receiveType: "TAGO_SNAPSHOT",
    ...overrides,
  };
}

function capture(snapshots: RideSnapshot[], overrides: Partial<RideCapture> = {}): RideCapture {
  return {
    schemaVersion: RIDE_CAPTURE_SCHEMA_VERSION,
    startedAt: at(0),
    endedAt: at(60),
    routeId: "SYN-ROUTE",
    cityCode: "999",
    boardingStopSequence: 3,
    destinationStopSequence: 7,
    boardedVehicleId: BOARDED,
    intervalMs: 5_000,
    stops,
    snapshots,
    markers: [{ at: at(0), kind: "boarded", stopSequence: 3 }],
    ...overrides,
  };
}

const labels = new Map([[BOARDED, "tracked"], [OTHER, "V1"]]);

function replay(
  snapshots: RideSnapshot[],
  overrides: Partial<RideCapture> = {},
  options: Partial<ReplayOptions> = {},
) {
  return replayMatching(capture(snapshots, overrides), { labels, boardedVehicleId: BOARDED, ...options });
}

/**
 * A capture begun while the rider was still waiting: the `boarded` marker is
 * stamped when they step on, after the first snapshot, so the replay decides
 * for `waiting_at_stop` and only a bus one to four stops short of the boarding
 * stop may be selected. The boarding stop moves to sequence 6 so that all four
 * of those stops exist behind it.
 */
const WAITING_STOP = 6;
const waitingAtStop: Partial<RideCapture> = {
  boardingStopSequence: WAITING_STOP,
  destinationStopSequence: 8,
  markers: [{ at: at(40), kind: "boarded", stopSequence: WAITING_STOP }],
};

/**
 * Three changing receipts ten seconds apart is the minimum the cadence
 * surrogate accepts, so every fixture that expects a selection has to move the
 * bus at least that much first.
 */
function movingRide(vehicleId: string, startStop: number): RideSnapshot[] {
  return [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [tago(vehicleId, seconds, startStop + index)],
  }));
}

test("a lone boarded vehicle is selected once its cadence becomes fresh", () => {
  const evidence = replay(movingRide(BOARDED, 3));

  assert.equal(evidence.evaluatedSnapshots, 3);
  assert.equal(evidence.selectionVerdict, "correct");
  assert.equal(evidence.firstCommit?.selectedLabel, "tracked");
  // Not the first snapshot: the surrogate needs repeated changing receipts, so
  // the matcher withholds until it has them. That delay is the feature.
  assert.equal(evidence.firstCommit?.snapshotsBefore, 2);
  assert.equal(evidence.outcomeCounts.selected_other, 0);
  assert.equal(evidence.outcomeCounts.withheld_unavailable, 2);
  assert.equal(evidence.usableForGate, true);
  assert.deepEqual(evidence.warnings, []);
});

/**
 * The rider waits at stop 6 and lets the first bus go. The decoy is two stops
 * short of the stop, then one, moving all the while; the bus the rider actually
 * boards sits at stop 1, three stops behind the decoy at the first look and
 * four after, a lead clear by the margin at every decision. The matcher has no
 * way to know the rider will skip the leading bus, and it commits to it. (A
 * decoy that began inside the margin of the boarded bus would contest the
 * approach for the session and never be selected: finding F22.)
 */
function letTheLeaderGo(): RideSnapshot[] {
  return [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [
      tago(OTHER, seconds, [4, 5, 5][index]!, { latitude: 33.53 + index * 0.0005 }),
      tago(BOARDED, seconds, 1),
    ],
  }));
}

test("a capture where the matcher would have picked the wrong bus fails the gate", () => {
  const snapshots = letTheLeaderGo();
  const evidence = replay(snapshots, waitingAtStop, { recordDecisions: true });

  assert.equal(evidence.riderState, "waiting_at_stop");
  assert.equal(evidence.selectionVerdict, "wrong", "this is the catastrophic outcome the gate exists to count");
  assert.equal(evidence.firstCommit?.selectedLabel, "V1");
  assert.ok(evidence.outcomeCounts.selected_other > 0);
  assert.equal(evidence.outcomeCounts.selected_boarded, 0);
  assert.match(evidence.warnings.join(" "), /would have committed to a vehicle the rider did not board/);

  // Why it went wrong matters as much as that it did. The boarded bus was not
  // outscored — it was excluded, because a vehicle that never moves reads as
  // `aging` and `aging` never unlocks matching. It still competed, as every bus
  // of the route approaching the stop does, but three stops behind the leader
  // it could not hold the decision. Only the decoy was eligible.
  assert.equal(evidence.firstCommit?.eligibleCount, 1);
  assert.equal(evidence.staleData.boardedCadenceStates.fresh, 0);
  assert.ok(evidence.staleData.boardedCadenceStates.aging > 0);

  // And it is the wrong the directed policy cannot rule out — a bus still
  // approaching the stop — never F1's bus that had already left it.
  const commit = evidence.decisions?.find((decision) => decision.selectedLabel === "V1");
  assert.equal(commit?.candidates.find((candidate) => candidate.label === "V1")?.zone, "approaching");
});

test("a wrong match is still caught when both candidates are eligible and it is decided on score", () => {
  // Both buses report changing coordinates, so both reach `fresh` and both are
  // eligible. Their stop sequences stay put, which keeps their approach scores
  // apart: the decoy is one stop short of the rider's stop and the boarded bus
  // four, a three-stop lead worth 15 points that clears the 12-point ambiguity
  // margin. Two stops is withheld as ambiguous, which is the matcher working.
  // The rider lets the leader go and boards the follower.
  const snapshots: RideSnapshot[] = [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [
      tago(OTHER, seconds, 5, { latitude: 33.54 + index * 0.0005 }),
      tago(BOARDED, seconds, 2, { latitude: 33.51 + index * 0.0005 }),
    ],
  }));
  const evidence = replay(snapshots, waitingAtStop);

  assert.equal(evidence.selectionVerdict, "wrong");
  assert.equal(evidence.firstCommit?.selectedLabel, "V1");
  assert.equal(evidence.firstCommit?.eligibleCount, 2, "both were eligible; the matcher chose between them");
  assert.ok(evidence.contestedDecisions > 0);
  // The margin that produced a wrong answer is exactly the number the policy's
  // `ambiguityMargin` has to be calibrated against.
  assert.equal(typeof evidence.firstCommit?.margin, "number");
  assert.ok((evidence.firstCommit?.margin ?? 0) >= 12, "below the ambiguity margin nothing would have been committed");
});

test("candidate margin is only measured where a second eligible candidate existed", () => {
  const alone = replay(movingRide(BOARDED, 3));
  assert.equal(alone.contestedDecisions, 0);
  assert.equal(alone.candidateMargin.count, 0, "a margin from an uncontested ride would be a fiction");

  const contested: RideSnapshot[] = [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [tago(BOARDED, seconds, 3 + index), tago(OTHER, seconds, 4 + index)],
  }));
  const evidence = replay(contested);
  assert.ok(evidence.contestedDecisions > 0);
  assert.equal(evidence.candidateMargin.count, evidence.contestedDecisions);
  assert.ok((evidence.candidateMargin.median ?? -1) >= 0);
});

test("a ride the matcher never commits to is safe, not correct", () => {
  // Present the whole time and never moving: continuous receipts, unchanged
  // content. The surrogate calls that `aging`, which never unlocks matching.
  // The capture starts with a boarded marker, so the rider is on board, and
  // the bus sits two stops past the boarding stop: inside the on-board window,
  // the only one there, so its frozen cadence is the one thing refusing it.
  const stationary: RideSnapshot[] = [0, 5, 10, 15].map((seconds) => ({
    capturedAt: at(seconds),
    vehicles: [tago(BOARDED, seconds, 5)],
  }));
  const evidence = replay(stationary);

  assert.equal(evidence.selectionVerdict, "never_committed");
  assert.equal(evidence.firstCommit, undefined);
  assert.equal(evidence.staleData.selectionsWhileNotFresh, 0);
  assert.ok(evidence.staleData.boardedCadenceStates.aging > 0);
  assert.equal(evidence.staleData.boardedCadenceStates.fresh, 0);
});

test("the matcher never selects a TAGO vehicle whose cadence is not fresh", () => {
  // A long hole in the middle: receipts resume but the gap exceeds the policy,
  // so the surrogate reports `stale` rather than picking up where it left off.
  const snapshots: RideSnapshot[] = [
    { capturedAt: at(0), vehicles: [tago(BOARDED, 0, 3)] },
    { capturedAt: at(5), vehicles: [tago(BOARDED, 5, 4)] },
    { capturedAt: at(60), vehicles: [tago(BOARDED, 60, 5)] },
    { capturedAt: at(65), vehicles: [tago(BOARDED, 65, 6)] },
  ];
  const evidence = replay(snapshots);

  assert.equal(evidence.staleData.selectionsWhileNotFresh, 0, "a non-zero value here is a bug, not a threshold");
  assert.ok(evidence.staleData.boardedNotFreshDecisions > 0);
  assert.ok(evidence.staleData.boardedCadenceStates.stale > 0);
});

test("a direction change on the boarded vehicle is counted as a reversal", () => {
  const snapshots: RideSnapshot[] = [
    { capturedAt: at(0), vehicles: [tago(BOARDED, 0, 3, { directionCode: "1" })] },
    { capturedAt: at(5), vehicles: [tago(BOARDED, 5, 4, { directionCode: "0" })] },
    { capturedAt: at(10), vehicles: [tago(BOARDED, 10, 5, { directionCode: "1" })] },
  ];
  const evidence = replay(snapshots);

  // Two changes, not two distinct codes: 1→0→1 reverses twice and would look
  // like a single anomaly if only distinct values were counted.
  assert.equal(evidence.directionReversal.boardedDirectionChanges, 2);
  assert.equal(evidence.directionReversal.boardedDirectionCodes, 2);
});

test("a capture with no boarded vehicle is refused rather than scored", () => {
  const evidence = replayMatching(
    capture(movingRide(BOARDED, 3), { boardedVehicleId: undefined }),
    { labels },
  );
  assert.equal(evidence.selectionVerdict, "no_boarded_vehicle");
  assert.equal(evidence.usableForGate, false);
  assert.match(evidence.warnings.join(" "), /No boarded vehicle was recorded/);
});

test("a capture whose vehicles carry provider timestamps is not gate evidence for TAGO", () => {
  // TAGO never does this. A fixture that does would exercise the provider
  // timestamp path and prove nothing about the surrogate production relies on.
  const snapshots: RideSnapshot[] = [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [tago(BOARDED, seconds, 3 + index, {
      observedAt: at(seconds),
      timestampSource: "provider",
    })],
  }));
  const evidence = replay(snapshots);

  assert.equal(evidence.usableForGate, false);
  assert.match(evidence.warnings.join(" "), /cadence surrogate TAGO relies on was never exercised/);
});

test("failed snapshots are skipped without breaking cadence continuity", () => {
  const snapshots: RideSnapshot[] = [
    { capturedAt: at(0), vehicles: [tago(BOARDED, 0, 3)] },
    { capturedAt: at(5), vehicles: [], error: "TAGO payload has no body object" },
    { capturedAt: at(10), vehicles: [tago(BOARDED, 10, 4)] },
    { capturedAt: at(15), vehicles: [tago(BOARDED, 15, 5)] },
  ];
  const evidence = replay(snapshots);

  assert.equal(evidence.evaluatedSnapshots, 3, "the failed poll is not a decision point");
  assert.equal(evidence.selectionVerdict, "correct");
});

test("the gate evidence reaches the sanitized report and carries no vehicle number", () => {
  const report = analyzeRideCapture(capture(movingRide(BOARDED, 3)));

  assert.equal(report.matchGate.selectionVerdict, "correct");
  assert.equal(report.matchGate.firstCommit?.selectedLabel, "tracked");
  assert.equal(report.matchGate.usableForGate, true);

  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(BOARDED), "the report generator refuses raw identifiers; so must this section");
  assert.ok(!serialized.includes(OTHER));
});

test("a report whose matcher picked another vehicle still refuses to name it", () => {
  // The rider lets the leading bus go, as in the gate-failure test above.
  const snapshots = letTheLeaderGo();
  const report = analyzeRideCapture(capture(snapshots, waitingAtStop));

  assert.equal(report.matchGate.selectionVerdict, "wrong");
  assert.equal(report.matchGate.firstCommit?.selectedLabel, "V1");
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(OTHER), "a wrong match is exactly when a raw number must not leak");
  assert.ok(!serialized.includes(BOARDED));
});

test("the F1 capture this suite once scored as a wrong commit is refused by the directed policy", () => {
  // The scenario the gate-failure test above was first built on: the decoy
  // pulls away from the boarding stop itself and is two stops past it by the
  // time its cadence is fresh, while the boarded bus sits four stops past it.
  const snapshots: RideSnapshot[] = [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [tago(OTHER, seconds, 3 + index), tago(BOARDED, seconds, 7)],
  }));

  // The legacy policy, injected here on purpose as a negative control. It
  // scored |stopSequence − boardingStopSequence|, blind to which side of the
  // stop a bus was on, so for a waiting rider it committed to a bus that had
  // already left: finding F1.
  const legacy = replay(snapshots, {}, {
    riderState: "waiting_at_stop",
    matcher: matchVehicleLegacySymmetricV0,
    matcherPolicy: LEGACY_MATCHER_POLICY_VERSION,
    recordDecisions: true,
  });
  assert.equal(legacy.selectionVerdict, "wrong");
  const commit = legacy.decisions?.find((decision) => decision.selectedLabel === "V1");
  assert.equal(commit?.candidates.find((candidate) => candidate.label === "V1")?.stopSequence, 5, "two stops past the stop");

  // The directed policy refuses it whichever way the rider is read. On board,
  // as the capture's own marker says, the boarded bus is inside the on-board
  // window too, so the decoy is not the one bus of the route there. Waiting,
  // the decoy was seen at the stop and has left it, which withholds for the
  // rest of the session.
  const onBoard = replay(snapshots);
  const waiting = replay(snapshots, {}, { riderState: "waiting_at_stop" });
  assert.equal(onBoard.riderState, "on_board");
  for (const directed of [onBoard, waiting]) {
    assert.equal(directed.matcherPolicy, MATCHER_POLICY_VERSION);
    assert.equal(directed.selectionVerdict, "never_committed", directed.riderState);
    assert.equal(directed.outcomeCounts.selected_other, 0, directed.riderState);
  }
});

test("a bus that drops out of one poll still competes in the replay", () => {
  // The rider's bus leads the approach, and TAGO leaves its row out of the last
  // poll. A live session keeps it competing from the cadence history; so must
  // the replay, or losing a row would hand the follower a commit no live
  // session would make, and the gate would count it.
  const snapshots: RideSnapshot[] = [
    { capturedAt: at(0), vehicles: [tago(BOARDED, 0, 3), tago(OTHER, 0, 2)] },
    { capturedAt: at(5), vehicles: [tago(BOARDED, 5, 4), tago(OTHER, 5, 2, { latitude: 33.5105 })] },
    { capturedAt: at(10), vehicles: [tago(BOARDED, 10, 5), tago(OTHER, 10, 3)] },
    { capturedAt: at(15), vehicles: [tago(OTHER, 15, 4)] },
  ];
  const evidence = replay(snapshots, waitingAtStop, { recordDecisions: true });

  assert.equal(evidence.selectionVerdict, "never_committed");
  assert.equal(evidence.outcomeCounts.selected_other, 0);
  const last = evidence.decisions?.at(-1);
  assert.equal(last?.rememberedVehicles, 1, "the missing bus competed from memory");
  assert.deepEqual(last?.candidates.map((candidate) => candidate.label), ["V1"], "and only from memory");
});

test("once a bus has reached the boarding stop the replay never commits to the one behind it", () => {
  // The rider boards the first bus at the stop. From then on the bus behind it
  // is the leading approaching vehicle: fresh, alone in the approach window,
  // and the wrong bus. Only the session's memory that a bus reached the stop
  // keeps it from being committed, and the replay has to carry that memory
  // from one decision to the next as a live session does.
  const snapshots: RideSnapshot[] = [
    { capturedAt: at(0), vehicles: [tago(BOARDED, 0, 4), tago(OTHER, 0, 1)] },
    { capturedAt: at(5), vehicles: [tago(BOARDED, 5, 5), tago(OTHER, 5, 1)] },
    { capturedAt: at(10), vehicles: [tago(BOARDED, 10, 6), tago(OTHER, 10, 2)] },
    { capturedAt: at(15), vehicles: [tago(BOARDED, 15, 7), tago(OTHER, 15, 3)] },
    { capturedAt: at(20), vehicles: [tago(BOARDED, 20, 8), tago(OTHER, 20, 4)] },
  ];
  const evidence = replay(snapshots, {
    ...waitingAtStop,
    markers: [{ at: at(10), kind: "boarded", stopSequence: WAITING_STOP }],
  }, { recordDecisions: true });

  assert.equal(evidence.riderState, "waiting_at_stop");
  assert.equal(evidence.selectionVerdict, "never_committed");
  assert.equal(evidence.outcomeCounts.selected_other, 0);
  // By the last poll the boarded bus is two stops past the stop and holds
  // nothing up by itself: the session's memory alone withholds the decision.
  assert.deepEqual(evidence.decisions?.at(-1)?.abstentionReasons, ["boarding_stop_reached_during_session"]);
});

/**
 * A provider that reports a direction code on every row, and a decoy whose code
 * differs from the boarded bus's. Replayed with `waitingAtStop`, the decoy
 * approaches stop 6 and ends one stop short of it, and the bus the rider boards
 * is four stops back, its coordinates creeping forward so that it is fresh too.
 *
 * Before F3 the replay took the ride's direction from the boarded bus, so the
 * decoy was rejected as `wrong_direction` exactly when the answer was known.
 */
function directionScenario(): RideSnapshot[] {
  return [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [
      tago(OTHER, seconds, [4, 5, 5][index]!, { directionCode: "2", latitude: 33.53 + index * 0.0005 }),
      tago(BOARDED, seconds, 1, { latitude: 33.5 + index * 0.0005 }),
    ],
  }));
}

test("replayBlind has no parameter for the boarded vehicle, and ignores one smuggled in", () => {
  // One positional parameter before the defaulted options. `length` stops
  // counting at the first default, so the parameter list is read as well: a
  // third parameter could otherwise hide behind it.
  assert.equal(replayBlind.length, 1);
  const parameters = /^function replayBlind\(([^)]*)\)/.exec(replayBlind.toString())?.[1]
    ?.split(",")
    .map((parameter) => parameter.split("=")[0]!.trim())
    .filter(Boolean);
  assert.deepEqual(parameters, ["capture", "options"]);

  const ride = capture(directionScenario(), waitingAtStop);
  const blind = replayBlind(ride);
  assert.ok(
    blind.decisions.some((decision) => decision.result.status === "matched"),
    "a replay that decides nothing would compare equal for the wrong reason",
  );
  // The answer slipped into the options, a capture naming another boarded
  // vehicle, and a capture naming none: the same decisions, down to the score.
  const smuggled = { riderState: "waiting_at_stop" as const, boardedVehicleId: BOARDED };
  assert.deepEqual(replayBlind(ride, smuggled), blind);
  assert.deepEqual(replayBlind({ ...ride, boardedVehicleId: OTHER }), blind);
  assert.deepEqual(replayBlind({ ...ride, boardedVehicleId: undefined }), blind);
});

test("the boarded vehicle cannot change a single replayed decision, even where the provider reports a direction", () => {
  const ride = capture(directionScenario(), waitingAtStop);
  const scored = replayMatching(ride, { labels, boardedVehicleId: BOARDED, recordDecisions: true });
  const unscored = replayMatching(ride, { labels, recordDecisions: true });

  assert.equal(scored.decisions?.length, 3);
  assert.equal(JSON.stringify(scored.decisions), JSON.stringify(unscored.decisions));
  assert.deepEqual(scored.firstCommit, unscored.firstCommit);
  // Nobody declared a direction, so no candidate is rejected for one: not even
  // the decoy whose code differs from the bus the rider boarded.
  assert.equal(scored.directionReversal.wrongDirectionRejections, 0);
  assert.equal(unscored.directionReversal.wrongDirectionRejections, 0);
  // The answer is read only to score: the same commit is wrong once it is known.
  assert.equal(scored.selectionVerdict, "wrong");
  assert.equal(unscored.selectionVerdict, "no_boarded_vehicle");
});

test("only a declared direction constrains the replay", () => {
  const ride = capture(directionScenario(), waitingAtStop);
  const declaring = (
    declaredDirectionCode: string,
    answer: Pick<ReplayOptions, "boardedVehicleId"> = { boardedVehicleId: BOARDED },
  ) => replayMatching(ride, { labels, recordDecisions: true, declaredDirectionCode, ...answer });
  const rejectedOnDirection = (evidence: MatchGateEvidence, label: string) =>
    (evidence.decisions ?? []).filter((decision) => decision.candidates.some(
      (candidate) => candidate.label === label && candidate.rejectedReasons.includes("wrong_direction"),
    )).length;

  // Declared "1": the boarded bus's own code, which the replay used to derive
  // without anyone declaring it. The decoy is rejected in every decision and
  // the wrong commit the gate has to count disappears — the leak made the
  // matcher look safer than it is.
  const one = declaring("1");
  assert.equal(one.directionReversal.wrongDirectionRejections, 3);
  assert.equal(rejectedOnDirection(one, "V1"), 3);
  assert.equal(rejectedOnDirection(one, "tracked"), 0);
  assert.notEqual(one.selectionVerdict, "wrong");

  // Declared "2", it rules out the boarded bus instead. The constraint follows
  // the declaration, never the answer.
  const two = declaring("2");
  assert.equal(rejectedOnDirection(two, "tracked"), 3);
  assert.equal(rejectedOnDirection(two, "V1"), 0);

  // A declaration constrains the same with or without the answer, and a blank
  // one constrains nothing.
  assert.equal(JSON.stringify(declaring("1", {}).decisions), JSON.stringify(one.decisions));
  assert.equal(declaring("  ").directionReversal.wrongDirectionRejections, 0);
});

test("the rider state is read from when the boarded marker was stamped, never from which bus", () => {
  const polls: RideSnapshot[] = [
    { capturedAt: at(0), vehicles: [], error: "TAGO payload has no body object" },
    { capturedAt: at(5), vehicles: [tago(BOARDED, 5, 3)] },
    { capturedAt: at(10), vehicles: [tago(BOARDED, 10, 4)] },
  ];
  const boardedAt = (seconds: number): RideMarker => ({ at: at(seconds), kind: "boarded", stopSequence: 3 });
  const stateAtStart = (markers: RideMarker[], snapshots: RideSnapshot[] = polls) =>
    declaredRiderStateAtStart({ markers, snapshots });

  assert.equal(stateAtStart([boardedAt(5)]), "on_board", "stamped at the first successful snapshot");
  assert.equal(stateAtStart([boardedAt(-30)]), "on_board", "stamped before it");
  assert.equal(stateAtStart([boardedAt(10)]), "waiting_at_stop", "stamped later: the rider was waiting when the capture began");
  assert.equal(stateAtStart([]), "waiting_at_stop", "never stamped");
  assert.equal(
    stateAtStart([{ at: at(0), kind: "passed_stop", stopSequence: 3 }]),
    "waiting_at_stop",
    "only a boarded marker declares anything",
  );
  // A failed poll is not where the evidence starts: the marker at 3 s follows
  // the failed poll at 0 s but precedes the first successful snapshot at 5 s.
  assert.equal(stateAtStart([boardedAt(3)]), "on_board", "failed snapshots are ignored");
  assert.equal(stateAtStart([boardedAt(3)], polls.slice(0, 1)), "waiting_at_stop", "no successful snapshot, no declaration");

  // It is the replay's default whether or not a boarded vehicle was recorded,
  // and an explicit rider state overrides it.
  const aboard = capture(polls, { markers: [boardedAt(3)] });
  assert.equal(replayMatching(aboard, { labels, boardedVehicleId: BOARDED }).riderState, "on_board");
  assert.equal(replayMatching({ ...aboard, boardedVehicleId: undefined }, { labels }).riderState, "on_board");
  assert.equal(replayMatching(aboard, { labels, riderState: "waiting_at_stop" }).riderState, "waiting_at_stop");
  assert.equal(replayMatching(capture(polls, { markers: [boardedAt(10)] }), { labels }).riderState, "waiting_at_stop");
});

test("the replay records which matcher policy made its decisions", () => {
  const ride = capture(movingRide(BOARDED, 3));

  const directed = replayBlind(ride);
  assert.equal(directed.matcherPolicy, "directed-route-progress-v1");
  assert.equal(replayMatching(ride, { labels, boardedVehicleId: BOARDED }).matcherPolicy, MATCHER_POLICY_VERSION);
  assert.equal(directed.decisions.length, 3);
  assert.ok(directed.decisions.every((decision) => decision.result.policyVersion === MATCHER_POLICY_VERSION));

  // The legacy policy, injected on purpose: a comparison replay says so, and
  // every decision in it really came from the injected matcher.
  const injected = { matcher: matchVehicleLegacySymmetricV0, matcherPolicy: LEGACY_MATCHER_POLICY_VERSION };
  const legacy = replayBlind(ride, injected);
  assert.equal(legacy.matcherPolicy, "symmetric-stop-distance-v0");
  assert.equal(
    replayMatching(ride, { labels, boardedVehicleId: BOARDED, ...injected }).matcherPolicy,
    LEGACY_MATCHER_POLICY_VERSION,
  );
  assert.equal(legacy.decisions.length, 3);
  assert.ok(legacy.decisions.every((decision) => decision.result.policyVersion === LEGACY_MATCHER_POLICY_VERSION));
});

test("a replacement matcher that does not name its policy is refused", () => {
  // Unlabelled evidence would be counted against the production gate as if the
  // production matcher had made every decision in it.
  const ride = capture(movingRide(BOARDED, 3));
  const unnamed = { matcher: matchVehicleLegacySymmetricV0 };
  assert.throws(() => replayMatching(ride, { labels, boardedVehicleId: BOARDED, ...unnamed }), /must name its policy/);
  assert.throws(() => replayBlind(ride, unnamed), /must name its policy/);
  assert.throws(() => replayBlind(ride, { ...unnamed, matcherPolicy: "" }), /must name its policy/);
});

test("a replay's policy label is checked against the matcher that decided it", () => {
  const snapshots: RideSnapshot[] = [0, 5, 10].map((seconds) => ({ capturedAt: at(seconds), vehicles: [tago(BOARDED, seconds, 2)] }));
  const ride = capture(snapshots);
  // The production matcher cannot be passed off as the legacy one...
  assert.throws(() => replayBlind(ride, { matcherPolicy: LEGACY_MATCHER_POLICY_VERSION }), /cannot be labelled/);
  // ...and a legacy run cannot be counted as production-policy evidence.
  assert.throws(
    () => replayBlind(ride, { matcher: matchVehicleLegacySymmetricV0, matcherPolicy: MATCHER_POLICY_VERSION }),
    /decided by symmetric-stop-distance-v0/,
  );
  // Correctly labelled runs of either policy go through.
  assert.equal(replayBlind(ride).matcherPolicy, MATCHER_POLICY_VERSION);
  assert.equal(
    replayBlind(ride, { matcher: matchVehicleLegacySymmetricV0, matcherPolicy: LEGACY_MATCHER_POLICY_VERSION }).matcherPolicy,
    LEGACY_MATCHER_POLICY_VERSION,
  );
});
