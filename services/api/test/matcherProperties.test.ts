/**
 * Property-based verification of the directed matcher. SYNTHETIC: every case
 * is generated from a seed by `propertyKit.ts`; nothing here is field evidence.
 *
 * Each property is one of the fifteen safety invariants the release gate names
 * (`docs/exec-plans/HUMAN_LABOR_ELIMINATION.md`). A failure prints its seed;
 * the seed then goes into `fixtures/matcher-property-regressions.json`, which
 * is replayed first on every run, for ever.
 *
 * `TAPSO_PROPERTY_CASES=<n>` explores n fresh seeds per property instead of the
 * default; CI runs the default, a deep run can ask for more.
 */

import test from "node:test";
import assert from "node:assert/strict";

import type { MatchRequest, VehicleObservation } from "../src/domain.ts";
import {
  assertDirectedInvariant,
  classifyRouteProgress,
  matchVehicle,
  matchVehicleWithSourceFreshness,
  routeTopologyFacts,
} from "../src/matching.ts";
import { replayMatching } from "../src/matchReplay.ts";
import { RIDE_CAPTURE_SCHEMA_VERSION, type RideCapture } from "../src/rideCapture.ts";
import { classifyTagoCadenceFreshness } from "../src/sourceFreshness.ts";
import { JourneySessionCoordinator } from "../src/journeySession.ts";
import type { RouteRequest, StopOnRoute } from "../src/domain.ts";
import {
  EPOCH,
  NOW,
  ROUTE,
  chance,
  forAllSeeds,
  forAllSeedsAsync,
  freshness,
  generateMatch,
  generateTrajectory,
  int,
  offsetOf,
  pick,
  rng,
} from "./propertyKit.ts";

const MATCHER_CASES = 2_000;
const REPLAY_CASES = 150;
const SESSION_CASES = 60;

function decide(request: MatchRequest, trusted: Map<string, ReturnType<typeof freshness>>) {
  return matchVehicleWithSourceFreshness(request, trusted);
}

function captureOf(trajectory: ReturnType<typeof generateTrajectory>, overrides: Partial<RideCapture> = {}): RideCapture {
  return {
    schemaVersion: RIDE_CAPTURE_SCHEMA_VERSION,
    startedAt: trajectory.snapshots[0]!.capturedAt,
    endedAt: trajectory.snapshots.at(-1)!.capturedAt,
    routeId: ROUTE,
    cityCode: "999",
    boardingStopSequence: trajectory.boarding,
    destinationStopSequence: Math.min(trajectory.stops.length, trajectory.boarding + 3),
    intervalMs: 10_000,
    stops: trajectory.stops,
    snapshots: trajectory.snapshots,
    markers: [],
    ...overrides,
  };
}

/* ------------------------------------------------------------ invariant 1 */

test("P1: a waiting rider's automatic selection is always 1-4 stops before the stop, never at or past it", () => {
  const explored = forAllSeeds("P1", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed, { riderState: "waiting_at_stop" });
    const result = decide(request, trusted);
    if (result.status !== "matched") return;
    const offset = offsetOf(request, result.selectedVehicleId!);
    assert.ok(offset !== undefined && offset <= -1 && offset >= -4, `selected offset ${offset}`);
    // And for an on-board rider the mirror image.
    const onBoard = decide({ ...request, riderState: "on_board" }, trusted);
    if (onBoard.status === "matched") {
      const onBoardOffset = offsetOf(request, onBoard.selectedVehicleId!);
      assert.ok(onBoardOffset !== undefined && onBoardOffset >= 1 && onBoardOffset <= 4, `on-board offset ${onBoardOffset}`);
    }
  });
  assert.ok(explored >= MATCHER_CASES);
});

/* ------------------------------------------------------------ invariant 2 */

test("P2: moving a departed or at-stop bus farther past the stop never makes it selectable or raises its score", () => {
  forAllSeeds("P2", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed, { riderState: "waiting_at_stop" });
    const random = rng(seed ^ 0x5eed);
    const past = request.candidates.filter((row) => row.routeId === ROUTE && row.stopSequence !== undefined
      && row.stopSequence - request.boardingStopSequence >= 0);
    if (past.length === 0) return;
    const decoy = pick(random, past);
    const lastSequence = request.stops?.length ?? request.boardingStopSequence + 8;
    const moved = decoy.stopSequence! + int(random, 1, 5);
    if (moved > lastSequence) return;
    const before = decide(request, trusted);
    const farther: MatchRequest = {
      ...request,
      candidates: request.candidates.map((row) => row === decoy ? { ...row, stopSequence: moved } : row),
    };
    const after = decide(farther, trusted);
    assert.notEqual(before.selectedVehicleId, decoy.vehicleId);
    assert.notEqual(after.selectedVehicleId, decoy.vehicleId);
    const rowBefore = before.ranked.find((row) => row.vehicleId === decoy.vehicleId && row.stopOffset === decoy.stopSequence! - request.boardingStopSequence);
    const rowAfter = after.ranked.find((row) => row.vehicleId === decoy.vehicleId && row.stopOffset === moved - request.boardingStopSequence);
    assert.ok(rowAfter && rowAfter.rejectedReasons.length > 0, "the moved bus became individually eligible");
    // On a loop, farther past the stop is also closer to it the other way
    // round; there the bus scores as a competitor, which only ever makes the
    // decision more cautious. On a straight route the score must not rise.
    const loop = request.stops !== undefined && request.stops[0]!.stopId === request.stops.at(-1)!.stopId;
    if (!loop && rowBefore && rowAfter) {
      assert.ok(rowAfter.score <= rowBefore.score, `score rose from ${rowBefore.score} to ${rowAfter.score}`);
    }
  });
});

/* ------------------------------------------------------------ invariant 3 */

test("P3: removing evidence never turns a withheld decision into a selection", () => {
  forAllSeeds("P3", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed);
    const before = decide(request, trusted);
    if (before.status === "matched") return;
    const random = rng(seed ^ 0xd20f);
    // (a) A competitor drops out of this poll: it moves to memory.
    const onRoute = request.candidates.filter((row) => row.routeId === ROUTE);
    if (onRoute.length > 0) {
      const dropped = pick(random, onRoute);
      // Every row the vehicle had in the snapshot goes to memory, as the
      // cadence history would hold it.
      const droppedRows = request.candidates.filter((row) => row.vehicleId === dropped.vehicleId);
      const dropout = decide({
        ...request,
        candidates: request.candidates.filter((row) => row.vehicleId !== dropped.vehicleId),
        recentlySeen: [...(request.recentlySeen ?? []), ...droppedRows],
      }, trusted);
      assert.notEqual(dropout.status, "matched", "a dropped row must keep competing from memory");
    }
    // (b) A candidate's cadence evidence is lost.
    if (trusted.size > 0) {
      const lost = new Map(trusted);
      lost.delete(pick(random, [...lost.keys()]));
      assert.notEqual(decide(request, lost).status, "matched", "losing cadence evidence must not unlock a selection");
    }
    // (c) Topology is lost.
    const { stops: _stops, ...withoutStops } = request;
    assert.notEqual(decide(withoutStops, trusted).status, "matched", "losing the route's stops must not unlock a selection");
  });
});

test("P3: a withheld passage memory is never overridden by any snapshot", () => {
  forAllSeeds("P3-memory", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed);
    const withheld = decide({
      ...request,
      passage: { offsets: request.passage?.offsets ?? {}, withheld: { reason: "boarding_stop_reached_during_session", at: NOW } },
    }, trusted);
    assert.notEqual(withheld.status, "matched");
    assert.ok(withheld.passage?.withheld, "the memory stays withheld");
  });
});

test("P3: a vehicle out of sight past the memory window never releases a decision its remembered sighting withheld", () => {
  forAllSeeds("P3-forgotten", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed);
    const ghosts = (request.recentlySeen ?? []).filter((row) => row.routeId === ROUTE && row.stopSequence !== undefined);
    if (ghosts.length === 0) return;
    const random = rng(seed ^ 0xf15);
    const ghost = pick(random, ghosts);
    // The session's own memory of the ghost at its last sighting, written by
    // the matcher when the ghost was in the snapshot.
    const sighting = decide({ ...request, now: ghost.receivedAt!, candidates: [ghost], recentlySeen: [] }, trusted);
    const entry = sighting.passage?.offsets[ghost.vehicleId];
    if (!entry) return;
    const passage = {
      ...(request.passage ?? {}),
      offsets: { ...(request.passage?.offsets ?? {}), [ghost.vehicleId]: entry },
    };
    const remembered = decide({ ...request, passage }, trusted);
    if (remembered.status === "matched") return;
    // Then it stays out of sight: gone from the evidence window, and seen
    // longer ago than it was.
    const older = new Date(Date.parse(entry.lastSeenAt!) - int(random, 1, 600) * 1_000).toISOString();
    const forgotten = decide({
      ...request,
      recentlySeen: request.recentlySeen!.filter((row) => row.vehicleId !== ghost.vehicleId),
      passage: { ...passage, offsets: { ...passage.offsets, [ghost.vehicleId]: { ...entry, lastSeenAt: older } } },
    }, trusted);
    assert.notEqual(forgotten.status, "matched", "losing sight of a vehicle for longer released a withheld decision");
  });
});

test("P3: a bus seen before the stop and later past it withholds the session for good, across a loop's seam too", () => {
  forAllSeeds("P3-crossing", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed, { riderState: "waiting_at_stop" });
    if (!request.stops) return;
    const topology = routeTopologyFacts(request.stops, request.boardingStopSequence);
    if (!topology.boardingStopFound) return;
    const random = rng(seed ^ 0xc05);
    const facts = (sequence: number) => classifyRouteProgress(sequence, request.boardingStopSequence, "waiting_at_stop", topology);
    const sequences = [...topology.sequences];
    // Before: k stops out, the shorter way round. After: m stops past, likewise.
    const k = int(random, 1, 4);
    const m = int(random, 0, 3);
    const befores = sequences.filter((sequence) => facts(sequence).forward === k && (facts(sequence).backward ?? Infinity) > k);
    const afters = sequences.filter((sequence) => facts(sequence).backward === m && (m === 0 || (facts(sequence).forward ?? Infinity) > m));
    if (befores.length === 0 || afters.length === 0) return;
    const crosser = (stopSequence: number): VehicleObservation => ({
      vehicleId: `SYNTHETIC-${seed}-crosser`, routeId: ROUTE, observedAt: NOW, timestampSource: "provider", stopSequence,
    });
    const first = decide({ ...request, candidates: [...request.candidates, crosser(pick(random, befores))] }, trusted);
    const second = decide({ ...request, candidates: [...request.candidates, crosser(pick(random, afters))], passage: first.passage }, trusted);
    assert.notEqual(second.status, "matched", "a crossing was not remembered");
    assert.ok(second.passage?.withheld, "the crossing withholds for good");
  });
});

test("P3: an earlier look that saw nothing never releases a later decision", () => {
  forAllSeeds("P3-empty-look", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed);
    if (request.passage) return;
    const random = rng(seed ^ 0xe7);
    const declaredAt = new Date(Date.parse(NOW) - int(random, 1, 90) * 1_000).toISOString();
    const withoutLook = decide({ ...request, declaredAt }, trusted);
    if (withoutLook.status === "matched") return;
    const empty = decide({ ...request, now: declaredAt, declaredAt, candidates: [], recentlySeen: [] }, trusted);
    const withLook = decide({ ...request, declaredAt, passage: empty.passage }, trusted);
    assert.notEqual(withLook.status, "matched", "an empty earlier look released a withheld decision");
  });
});

/* ------------------------------------------------------------ invariant 4 */

test("P4: older evidence never improves a candidate's eligibility or score", () => {
  forAllSeeds("P4", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed);
    const random = rng(seed ^ 0x01d);
    if (request.candidates.length === 0) return;
    const target = pick(random, request.candidates);
    const before = decide(request, trusted);
    let aged: MatchRequest = request;
    let agedTrust = trusted;
    if (target.timestampSource === "provider") {
      aged = {
        ...request,
        candidates: request.candidates.map((row) => row === target
          ? { ...row, observedAt: new Date(Date.parse(row.observedAt) - int(random, 1, 200) * 1_000).toISOString() }
          : row),
      };
    } else {
      agedTrust = new Map(trusted);
      agedTrust.set(target.vehicleId, freshness(pick(random, ["aging", "stale", "unknown"] as const)));
    }
    const after = decide(aged, agedTrust);
    const rowBefore = before.ranked.find((row) => row.vehicleId === target.vehicleId)!;
    const rowAfter = after.ranked.find((row) => row.vehicleId === target.vehicleId)!;
    assert.ok(rowAfter.score <= rowBefore.score, `score rose from ${rowBefore.score} to ${rowAfter.score}`);
    if (rowBefore.rejectedReasons.length > 0) assert.ok(rowAfter.rejectedReasons.length > 0, "a rejected candidate became eligible by ageing");
    if (before.selectedVehicleId !== target.vehicleId) assert.notEqual(after.selectedVehicleId, target.vehicleId);
  });
});

test("P4: a remembered vehicle competes at least as hard as its sighting grows older", () => {
  forAllSeeds("P4-memory", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed);
    if (!request.recentlySeen?.length) return;
    const random = rng(seed ^ 0x4b);
    const before = decide(request, trusted);
    if (before.status === "matched") return;
    const older = decide({
      ...request,
      recentlySeen: request.recentlySeen.map((row) => ({
        ...row,
        receivedAt: new Date(Date.parse(row.receivedAt ?? NOW) - int(random, 1, 60) * 1_000).toISOString(),
      })),
    }, trusted);
    assert.notEqual(older.status, "matched", "an older sighting released a withheld decision");
  });
});

/* ------------------------------------------------------------ invariant 5 */

test("P5: server receipt time alone never manufactures freshness", () => {
  forAllSeeds("P5", MATCHER_CASES, (seed) => {
    const random = rng(seed);
    const receipts = int(random, 1, 12);
    let at = Date.parse(NOW);
    const rows: VehicleObservation[] = [];
    for (let index = 0; index < receipts; index += 1) {
      at += int(random, 1, 40) * 1_000;
      rows.push({ vehicleId: "SYNTHETIC-P5", routeId: ROUTE, observedAt: EPOCH, receivedAt: new Date(at).toISOString(), timestampSource: "unavailable", stopSequence: 5, latitude: 33.3, longitude: 126.4 });
    }
    // Identical content at any receipt schedule: never fresh.
    assert.notEqual(classifyTagoCadenceFreshness(rows, new Date(at)).state, "fresh");
    // And no stateless decision ever admits a receipt-timed candidate.
    const stateless = matchVehicle({
      routeId: ROUTE,
      boardingStopSequence: 7,
      now: new Date(at).toISOString(),
      candidates: [rows.at(-1)!],
      stops: Array.from({ length: 12 }, (_, index) => ({ stopId: `S${index + 1}`, name: `S${index + 1}`, sequence: index + 1 })),
    });
    assert.notEqual(stateless.status, "matched");
  });
});

/* ------------------------------------------------------------ invariant 6 */

test("P6: repeated unchanged provider content never unlocks automatic matching in a replay", () => {
  forAllSeeds("P6", REPLAY_CASES, (seed) => {
    const trajectory = generateTrajectory(seed);
    // Freeze every vehicle's content at its first sighting; receipts keep coming.
    const firstSeen = new Map<string, VehicleObservation>();
    const frozen = trajectory.snapshots.map((snapshot) => ({
      ...snapshot,
      vehicles: snapshot.vehicles.map((vehicle) => {
        if (!firstSeen.has(vehicle.vehicleId)) firstSeen.set(vehicle.vehicleId, vehicle);
        const first = firstSeen.get(vehicle.vehicleId)!;
        return { ...vehicle, stopId: first.stopId, stopSequence: first.stopSequence, latitude: first.latitude, longitude: first.longitude };
      }),
    }));
    for (const riderState of ["waiting_at_stop", "on_board"] as const) {
      const evidence = replayMatching(captureOf({ ...trajectory, snapshots: frozen }), { labels: new Map(), riderState });
      assert.equal(evidence.firstCommit, undefined, `${riderState} committed on frozen content`);
    }
  });
});

/* ------------------------------------------------------------ invariant 7 */

test("P7: a failed provider poll counts exactly as nothing — never as a sample, an absence or a decision", () => {
  forAllSeeds("P7", REPLAY_CASES, (seed) => {
    const trajectory = generateTrajectory(seed);
    const random = rng(seed ^ 0xe770);
    const failed = new Set<number>();
    const failing = trajectory.snapshots.map((snapshot, index) => {
      if (snapshot.error || !chance(random, 0.25)) return snapshot;
      failed.add(index);
      return { capturedAt: snapshot.capturedAt, vehicles: [], error: "synthetic provider failure" };
    });
    const withFailures = replayMatching(captureOf({ ...trajectory, snapshots: failing }), { labels: new Map(), recordDecisions: true });
    // The same polls simply never made: a failure must be worth no more.
    const absent = trajectory.snapshots.filter((_, index) => !failed.has(index));
    const withoutThem = replayMatching(captureOf({ ...trajectory, snapshots: absent }), { labels: new Map(), recordDecisions: true });
    assert.deepEqual(withFailures.decisions, withoutThem.decisions);
    assert.deepEqual(withFailures.firstCommit, withoutThem.firstCommit);
    assert.equal(withFailures.evaluatedSnapshots, failing.filter((snapshot) => !snapshot.error).length, "a failed poll is never a decision");
    assert.equal(withFailures.staleData.selectionsWhileNotFresh, 0);
  });
});

test("P7: a window of nothing but failed polls never commits", () => {
  forAllSeeds("P7-all-failed", REPLAY_CASES, (seed) => {
    const trajectory = generateTrajectory(seed);
    const failing = trajectory.snapshots.map((snapshot) => ({ capturedAt: snapshot.capturedAt, vehicles: [], error: "synthetic provider failure" }));
    const evidence = replayMatching(captureOf({ ...trajectory, snapshots: failing }), { labels: new Map() });
    assert.equal(evidence.evaluatedSnapshots, 0);
    assert.equal(evidence.firstCommit, undefined);
  });
});

/* ------------------------------------------------------------ invariant 8 */

test("P8: a stop-sequence regression inside the window fails closed", () => {
  forAllSeeds("P8", MATCHER_CASES, (seed) => {
    const random = rng(seed);
    let at = Date.parse(NOW);
    let sequence = int(random, 3, 10);
    const rows: VehicleObservation[] = [];
    const regressAt = int(random, 1, 5);
    for (let index = 0; index < 6; index += 1) {
      at += int(random, 3, 12) * 1_000;
      sequence = index === regressAt ? sequence - int(random, 1, 3) : sequence + (chance(random, 0.6) ? 1 : 0);
      rows.push({ vehicleId: "SYNTHETIC-P8", routeId: ROUTE, observedAt: EPOCH, receivedAt: new Date(at).toISOString(), timestampSource: "unavailable", stopSequence: sequence, latitude: 33.3 + index * 0.001, longitude: 126.4 });
    }
    const state = classifyTagoCadenceFreshness(rows, new Date(at)).state;
    assert.equal(state, "stale");
  });
});

/* ------------------------------------------------------------ invariant 9 */

test("P9: once a session selects a vehicle, the selection never changes", async () => {
  await forAllSeedsAsync("P9", SESSION_CASES, async (seed) => {
    const trajectory = generateTrajectory(seed);
    let cursor = 0;
    let nowMs = Date.parse(trajectory.snapshots[0]!.capturedAt);
    const provider = {
      async stops(_request: RouteRequest): Promise<StopOnRoute[]> { return trajectory.stops; },
      async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> {
        const snapshot = trajectory.snapshots[Math.min(cursor, trajectory.snapshots.length - 1)]!;
        if (snapshot.error) throw new Error(snapshot.error);
        return snapshot.vehicles.map((vehicle) => ({ ...vehicle, receivedAt: new Date(nowMs).toISOString() }));
      },
    };
    const sessions = new JourneySessionCoordinator(provider, {
      now: () => new Date(nowMs),
      idFactory: () => `session-${seed}`,
      automaticMatchingEnabled: true,
      maxConsecutiveProviderFailures: 1_000,
    });
    // The first snapshot may be a failure; start on a successful one.
    while (trajectory.snapshots[cursor]?.error) { cursor += 1; nowMs += 10_000; }
    const created = await sessions.create({
      routeId: ROUTE, cityCode: "999", boardingStopSequence: trajectory.boarding,
      destinationStopSequence: Math.min(trajectory.stops.length, trajectory.boarding + 3),
    });
    let selected = created.selectedVehicleId;
    for (cursor += 1; cursor < trajectory.snapshots.length; cursor += 1) {
      nowMs += 10_000;
      let view;
      try {
        view = await sessions.refresh(created.id);
      } catch {
        continue;
      }
      if (selected !== undefined) assert.equal(view.selectedVehicleId, selected, `seed ${seed}: selection switched`);
      selected = view.selectedVehicleId ?? selected;
    }
  });
});

/* ----------------------------------------------------------- invariant 10 */

test("P10: the boarded vehicle's identity never changes a single replayed decision", () => {
  forAllSeeds("P10", REPLAY_CASES, (seed) => {
    const trajectory = generateTrajectory(seed);
    const capture = captureOf(trajectory);
    const labels = new Map(trajectory.vehicles.map((vehicleId, index) => [vehicleId, `C${index + 1}`]));
    const answers: Array<string | undefined> = [undefined, ...trajectory.vehicles, "SYNTHETIC-NOT-PRESENT"];
    const timelines = answers.map((boardedVehicleId) => {
      const evidence = replayMatching(capture, { labels, recordDecisions: true, ...(boardedVehicleId ? { boardedVehicleId } : {}) });
      return JSON.stringify({ decisions: evidence.decisions, firstCommit: evidence.firstCommit, contested: evidence.contestedDecisions });
    });
    for (const timeline of timelines) assert.equal(timeline, timelines[0]);
  });
});

/* ----------------------------------------------------------- invariant 11 */

test("P11: unknown route progress fails closed", () => {
  forAllSeeds("P11", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed);
    const random = rng(seed ^ 0x11);
    // A right-route vehicle with no stop sequence anywhere in the snapshot.
    const unknown: VehicleObservation = {
      vehicleId: `SYNTHETIC-${seed}-unknown`,
      routeId: ROUTE,
      observedAt: EPOCH,
      receivedAt: NOW,
      timestampSource: "unavailable",
      latitude: 33.3,
      longitude: 126.4,
    };
    const withUnknown = { ...request, candidates: [...request.candidates, unknown] };
    const trust = new Map(trusted);
    trust.set(unknown.vehicleId, freshness("fresh"));
    assert.notEqual(decide(withUnknown, trust).status, "matched");
    // A right-route vehicle at the stop or one past it (waiting) blocks too.
    if (request.riderState !== "on_board") {
      const atStop: VehicleObservation = { ...unknown, vehicleId: `SYNTHETIC-${seed}-at-stop`, stopSequence: request.boardingStopSequence + int(random, 0, 1) };
      trust.set(atStop.vehicleId, freshness(pick(random, ["fresh", "aging", "stale", "unknown"] as const)));
      assert.notEqual(decide({ ...request, candidates: [...request.candidates, atStop] }, trust).status, "matched");
    }
  });
});

/* ----------------------------------------------------------- invariant 12 */

test("P12: two plausible vehicles too close together never produce a selection", () => {
  forAllSeeds("P12", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed);
    const random = rng(seed ^ 0x12);
    const onBoard = request.riderState === "on_board";
    const first = onBoard ? int(random, 1, 4) : -int(random, 1, 4);
    const second = onBoard ? int(random, 1, 4) : Math.max(-4, Math.min(-1, first - int(random, 0, 2)));
    const pair: VehicleObservation[] = [first, second].map((offset, index) => ({
      vehicleId: `SYNTHETIC-${seed}-pair-${index}`,
      routeId: ROUTE,
      observedAt: EPOCH,
      receivedAt: NOW,
      timestampSource: "unavailable",
      stopSequence: request.boardingStopSequence + offset,
    }));
    const trust = new Map(trusted);
    trust.set(pair[0]!.vehicleId, freshness("fresh"));
    trust.set(pair[1]!.vehicleId, freshness(pick(random, ["fresh", "aging", "stale", "unknown"] as const)));
    // The pair must be the plausible vehicles: every other vehicle of the
    // route inside the window is removed, so no third bus can lead them.
    const window = onBoard ? [-1, 4] : [-4, 1];
    const others = request.candidates.filter((row) => row.routeId !== ROUTE || row.stopSequence === undefined
      || row.stopSequence - request.boardingStopSequence < window[0]! || row.stopSequence - request.boardingStopSequence > window[1]!);
    const result = decide({ ...request, candidates: [...others, ...pair] }, trust);
    assert.notEqual(result.status, "matched");
  });
});

/* ----------------------------------------------------------- invariant 13 */

test("P13: identical input gives an identical decision, whatever the candidate order", () => {
  forAllSeeds("P13", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed);
    const once = decide(request, trusted);
    const again = decide(structuredClone(request), new Map(trusted));
    assert.deepEqual(again, once);
    const random = rng(seed ^ 0x13);
    const shuffled = [...request.candidates].sort(() => random() - 0.5);
    const permuted = decide({ ...request, candidates: shuffled }, trusted);
    assert.equal(permuted.status, once.status);
    assert.equal(permuted.selectedVehicleId, once.selectedVehicleId);
    assert.deepEqual(permuted.abstentionReasons, once.abstentionReasons);
  });
});

/* ----------------------------------------------------------- invariant 14 */

test("P14: a vehicle that is never valid is never committed, however long it is watched", () => {
  forAllSeeds("P14", REPLAY_CASES, (seed) => {
    const random = rng(seed);
    const stops = Array.from({ length: 20 }, (_, index) => ({ stopId: `SYN-${index + 1}`, name: `Synthetic ${index + 1}`, sequence: index + 1 }));
    const boarding = 10;
    const kind = pick(random, ["departed", "at_stop", "unknown", "far", "wrong_route"] as const);
    const snapshots = Array.from({ length: 180 }, (_, index) => {
      const at = new Date(Date.parse(NOW) + index * 10_000).toISOString();
      const base: VehicleObservation = { vehicleId: "SYNTHETIC-NEVER-VALID", routeId: kind === "wrong_route" ? "SYN-OTHER" : ROUTE, observedAt: EPOCH, receivedAt: at, timestampSource: "unavailable", latitude: 33.3 + index * 0.0001, longitude: 126.4 };
      const sequence = kind === "departed" ? Math.min(20, boarding + 2 + Math.floor(index / 30))
        : kind === "at_stop" ? boarding
          : kind === "far" ? boarding - 6
            : kind === "wrong_route" ? boarding - 2 : undefined;
      return { capturedAt: at, vehicles: [{ ...base, ...(sequence === undefined ? {} : { stopSequence: sequence }) }] };
    });
    const evidence = replayMatching({
      schemaVersion: RIDE_CAPTURE_SCHEMA_VERSION, startedAt: snapshots[0]!.capturedAt, routeId: ROUTE, cityCode: "999",
      boardingStopSequence: boarding, destinationStopSequence: 15, intervalMs: 10_000, stops, snapshots, markers: [],
    }, { labels: new Map() });
    assert.equal(evidence.firstCommit, undefined, `${kind} vehicle was committed`);
  });
});

test("P13: a vehicle also reported under another route is never selected and never makes the order matter", () => {
  forAllSeeds("P13-routes", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed);
    const onRoute = request.candidates.filter((row) => row.routeId === ROUTE);
    if (onRoute.length === 0) return;
    const random = rng(seed ^ 0x13b);
    const target = pick(random, onRoute);
    const twin: VehicleObservation = { ...target, routeId: "SYN-PROP-OTHER", stopSequence: int(random, 1, 40) };
    const first = decide({ ...request, candidates: [twin, ...request.candidates] }, trusted);
    const last = decide({ ...request, candidates: [...request.candidates, twin] }, trusted);
    assert.equal(first.status, last.status);
    assert.equal(first.selectedVehicleId, last.selectedVehicleId);
    assert.notEqual(first.selectedVehicleId, target.vehicleId, "a bus the provider also places on another route was selected");
  });
});

/* ----------------------------------------------------------- invariant 15 */

test("P15: whatever is missing from the feed, a selection is always individually valid", () => {
  forAllSeeds("P15", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed);
    const random = rng(seed ^ 0x15);
    // Hide a random subset of vehicles (the true bus may be among them).
    const visible = request.candidates.filter(() => !chance(random, 0.4));
    const result = decide({ ...request, candidates: visible }, trusted);
    assertDirectedInvariant({ ...request, candidates: visible }, result);
    if (result.status !== "matched") return;
    const selected = visible.find((row) => row.vehicleId === result.selectedVehicleId)!;
    const ranked = result.ranked.find((row) => row.vehicleId === result.selectedVehicleId)!;
    assert.equal(selected.routeId, ROUTE);
    assert.deepEqual(ranked.rejectedReasons, []);
    if (selected.timestampSource === "unavailable") assert.equal(trusted.get(selected.vehicleId)?.state, "fresh");
  });
});

/* ----------------------------------------------------------- robustness */

test("the matcher never throws on generated input (the invariant check never fires)", () => {
  forAllSeeds("never-throws", MATCHER_CASES, (seed) => {
    const { request, trusted } = generateMatch(seed);
    decide(request, trusted);
    decide({ ...request, riderState: request.riderState === "on_board" ? "waiting_at_stop" : "on_board" }, trusted);
  });
});
