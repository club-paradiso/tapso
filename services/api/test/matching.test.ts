import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { MatchRequest, MatchResult, RankedCandidate, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import {
  assertDirectedInvariant,
  MATCHER_POLICY_VERSION,
  MatcherInvariantError,
  matchVehicle,
  matchVehicleWithSourceFreshness,
} from "../src/matching.ts";
// The legacy symmetric policy, imported on purpose: a negative control showing
// that the F1 scenarios below are ones the old matcher really committed on.
import { matchVehicleLegacySymmetricV0 } from "../src/matchingLegacy.ts";
import type { SourceFreshnessEvidence, SourceFreshnessState } from "../src/sourceFreshness.ts";

/**
 * Synthetic fixtures only: invented routes, stops and vehicle ids. Nothing
 * here was observed on a real bus.
 *
 * A straight route of twenty stops with the rider boarding at sequence 10, so
 * every zone boundary has room on both sides of the stop. An `offset` is stops
 * past the boarding stop in route order; negative is before it. A waiting
 * rider's bus is one to four stops before the stop, so every test that expects
 * a selection for a waiting rider puts the bus there.
 */
const now = "2026-08-20T03:00:00.000Z";
const ROUTE = "route-201";
const BOARDING = 10;
const stops: StopOnRoute[] = Array.from({ length: 20 }, (_, index) => ({
  stopId: `SYN-${index + 1}`,
  name: `Synthetic ${index + 1}`,
  sequence: index + 1,
}));

function secondsAgo(seconds: number): string {
  return new Date(Date.parse(now) - seconds * 1_000).toISOString();
}

function signed(offset: number): string {
  return offset > 0 ? `+${offset}` : String(offset);
}

/** A provider-timestamped observation, current at `now` unless overridden. */
function bus(
  vehicleId: string,
  stopSequence: number | undefined,
  overrides: Partial<VehicleObservation> = {},
): VehicleObservation {
  return {
    vehicleId,
    routeId: ROUTE,
    directionCode: "1",
    observedAt: now,
    ...(stopSequence === undefined ? {} : { stopSequence }),
    ...overrides,
  };
}

/**
 * A TAGO-shaped observation: no provider time, only TAPSO's receipt. Rows in
 * `recentlySeen` have this shape in production, because only TAGO rows enter
 * the cadence history they are drawn from.
 */
function tago(vehicleId: string, stopSequence: number | undefined, receivedSecondsAgo = 0): VehicleObservation {
  return {
    vehicleId,
    routeId: ROUTE,
    directionCode: "1",
    ...(stopSequence === undefined ? {} : { stopSequence }),
    observedAt: new Date(0).toISOString(),
    receivedAt: secondsAgo(receivedSecondsAgo),
    timestampSource: "unavailable",
  };
}

function cadence(state: SourceFreshnessState): SourceFreshnessEvidence {
  return {
    state,
    sampleCount: 3,
    spanSeconds: 10,
    latestReceiptAgeSeconds: 0,
    maxReceiptGapSeconds: 5,
    contentChangeCount: state === "fresh" ? 1 : 0,
    sequenceDecreaseCount: 0,
    reason: `synthetic ${state} cadence`,
  };
}

/** A waiting rider on the synthetic route, unless `overrides` say otherwise. */
function request(candidates: VehicleObservation[], overrides: Partial<MatchRequest> = {}): MatchRequest {
  return { routeId: ROUTE, boardingStopSequence: BOARDING, directionCode: "1", now, stops, candidates, ...overrides };
}

function onBoard(candidates: VehicleObservation[], overrides: Partial<MatchRequest> = {}): MatchRequest {
  return request(candidates, { riderState: "on_board", ...overrides });
}

function candidateIn(result: MatchResult, vehicleId: string): RankedCandidate {
  const found = result.ranked.find((candidate) => candidate.vehicleId === vehicleId);
  assert.ok(found, `${vehicleId} is ranked`);
  return found;
}

function assertSelected(result: MatchResult, vehicleId: string, message = result.explanation): void {
  assert.equal(result.status, "matched", message);
  assert.equal(result.selectedVehicleId, vehicleId, message);
  assert.deepEqual(result.abstentionReasons, [], message);
}

/** Withheld although a vehicle was individually selectable, with `reason` among the reasons why. */
function assertWithheld(result: MatchResult, reason: string, message = ""): void {
  assert.equal(result.status, "ambiguous", message);
  assert.equal(result.selectedVehicleId, undefined, message);
  assert.ok(
    result.abstentionReasons?.includes(reason),
    `${message} expected ${reason} among ${JSON.stringify(result.abstentionReasons)}`,
  );
}

test("selects one fresh route and direction candidate", () => {
  // Both buses approach the rider's stop. The wrong-direction one is three
  // stops further back, so it is rejected on direction and cannot hold up the
  // selection by being close.
  const result = matchVehicle({
    routeId: "route-201",
    boardingStopSequence: 10,
    directionCode: "1",
    now,
    stops,
    candidates: [
      { vehicleId: "correct", routeId: "route-201", directionCode: "1", stopSequence: 9, observedAt: now },
      { vehicleId: "wrong", routeId: "route-201", directionCode: "2", stopSequence: 6, observedAt: now },
    ],
  });
  assert.equal(result.status, "matched");
  assert.equal(result.selectedVehicleId, "correct");
  assert.deepEqual(candidateIn(result, "wrong").rejectedReasons, ["wrong_direction"]);
});

test("fails closed when candidates are tied", () => {
  const candidates = ["bus-a", "bus-b"].map((vehicleId) => ({
    vehicleId, routeId: "route-201", directionCode: "1", stopSequence: 8, observedAt: now,
  }));
  const result = matchVehicle({ routeId: "route-201", boardingStopSequence: 10, directionCode: "1", now, stops, candidates });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.selectedVehicleId, undefined);
  assert.deepEqual(result.abstentionReasons, ["leading_vehicle_not_selectable"]);
});

test("rejects stale candidates", () => {
  const result = matchVehicle({
    routeId: "route-201",
    boardingStopSequence: 10,
    directionCode: "1",
    now,
    stops,
    candidates: [{
      vehicleId: "stale", routeId: "route-201", directionCode: "1", stopSequence: 8,
      observedAt: "2026-08-20T02:55:00.000Z",
    }],
  });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.ranked[0]?.rejectedReasons, ["stale_or_invalid_timestamp"]);
});


test("trusted server cadence can admit TAGO candidates without inventing provider time", () => {
  const candidate = {
    vehicleId: "tago-live",
    routeId: "route-201",
    directionCode: "1",
    stopSequence: 8,
    observedAt: new Date(0).toISOString(),
    receivedAt: now,
    timestampSource: "unavailable" as const,
  };
  const result = matchVehicleWithSourceFreshness({
    routeId: "route-201",
    boardingStopSequence: 10,
    directionCode: "1",
    now,
    stops,
    candidates: [candidate],
  }, new Map([
    ["tago-live", {
      state: "fresh" as const,
      sampleCount: 3,
      spanSeconds: 10,
      latestReceiptAgeSeconds: 0,
      maxReceiptGapSeconds: 5,
      contentChangeCount: 1,
      sequenceDecreaseCount: 0,
      reason: "synthetic trusted cadence",
    }],
  ]));
  assert.equal(result.status, "matched");
  assert.equal(result.selectedVehicleId, "tago-live");
  assert.ok(result.ranked[0]?.evidence.includes("fresh_source_cadence"));
});

test("stateless matching still rejects the same TAGO candidate", () => {
  const result = matchVehicle({
    routeId: "route-201",
    boardingStopSequence: 10,
    directionCode: "1",
    now,
    stops,
    candidates: [{
      vehicleId: "tago-untrusted",
      routeId: "route-201",
      directionCode: "1",
      stopSequence: 8,
      observedAt: new Date(0).toISOString(),
      receivedAt: now,
      timestampSource: "unavailable",
    }],
  });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.ranked[0]?.rejectedReasons, ["stale_or_invalid_timestamp"]);
});

/* ------------------------------------------- waiting rider: route progress */

const WAITING_ZONES: Array<{ name: string; offset: number; zone: string; reason?: string }> = [
  {
    name: "five stops before the stop is beyond the approach window",
    offset: -5, zone: "beyond_window", reason: "implausible_boarding_position",
  },
  { name: "four stops before the stop is the far edge of the approach window", offset: -4, zone: "approaching" },
  { name: "one stop before the stop is the near edge of the approach window", offset: -1, zone: "approaching" },
  {
    name: "a bus reporting the boarding stop itself is not selectable",
    offset: 0, zone: "boarding_stop_unresolved", reason: "boarding_stop_position_unresolved",
  },
  {
    name: "one stop past the stop is not selectable",
    offset: 1, zone: "boarding_stop_unresolved", reason: "boarding_stop_position_unresolved",
  },
  { name: "two stops past the stop has departed", offset: 2, zone: "departed", reason: "departed_boarding_stop" },
];

for (const row of WAITING_ZONES) {
  test(`waiting rider, one fresh bus: ${row.name}`, () => {
    const result = matchVehicle(request([bus("solo", BOARDING + row.offset)]));
    const solo = candidateIn(result, "solo");
    assert.equal(solo.stopOffset, row.offset);
    assert.equal(solo.zone, row.zone);
    if (row.reason === undefined) {
      assertSelected(result, "solo");
      assert.deepEqual(solo.rejectedReasons, []);
    } else {
      assert.equal(result.status, "unavailable");
      assert.equal(result.selectedVehicleId, undefined);
      assert.deepEqual(solo.rejectedReasons, [row.reason]);
    }
  });
}

test("a bus at the boarding stop or one past it blocks a fresh approaching leader", () => {
  assertSelected(matchVehicle(request([bus("leader", BOARDING - 2)])), "leader", "control: the leader alone");
  // Dwelling at the stop or already gone: the unresolved nodeord reading
  // cannot tell, and the rider may be boarding it.
  for (const offset of [0, 1]) {
    const result = matchVehicle(request([bus("leader", BOARDING - 2), bus("dwelling", BOARDING + offset)]));
    assertWithheld(result, "vehicle_at_boarding_stop_unresolved", `offset ${signed(offset)}`);
  }
});

test("a bus at the boarding stop blocks even when it is stale or only remembered", () => {
  const stale = matchVehicle(request([
    bus("leader", BOARDING - 2),
    bus("dwelling", BOARDING, { observedAt: secondsAgo(300) }),
  ]));
  assertWithheld(stale, "vehicle_at_boarding_stop_unresolved", "stale");
  const remembered = matchVehicle(request([bus("leader", BOARDING - 2)], {
    recentlySeen: [tago("dwelling", BOARDING, 20)],
  }));
  assertWithheld(remembered, "vehicle_at_boarding_stop_unresolved", "remembered");
});

test("coordinates alone never make a bus selectable", () => {
  // No stop sequence, parked exactly on the boarding stop's coordinates. A
  // point on the map cannot say which side of the stop the bus is on.
  const input = request([bus("mapped", undefined, { latitude: 33.5, longitude: 126.5 })], {
    boardingLatitude: 33.5,
    boardingLongitude: 126.5,
  });
  assert.equal(matchVehicleLegacySymmetricV0(input, new Map()).status, "matched", "negative control: legacy committed");
  const result = matchVehicle(input);
  assert.equal(result.status, "unavailable");
  assert.equal(candidateIn(result, "mapped").zone, "route_progress_unknown");
  assert.deepEqual(candidateIn(result, "mapped").rejectedReasons, ["route_progress_unknown"]);
});

test("a bus without a usable stop sequence blocks a fresh approaching leader", () => {
  // None at all, not a whole stop, or a stop the twenty-stop route does not have.
  for (const stopSequence of [undefined, 9.5, Number.NaN, 0, 21]) {
    const result = matchVehicle(request([
      bus("leader", BOARDING - 2),
      bus("unplaced", stopSequence, { latitude: 33.5, longitude: 126.5 }),
    ]));
    assertWithheld(result, "candidate_route_progress_unknown", `stopSequence ${stopSequence}`);
    assert.equal(candidateIn(result, "unplaced").zone, "route_progress_unknown", `stopSequence ${stopSequence}`);
  }
});

test("a remembered bus without a stop sequence still blocks", () => {
  // It blocked while present; dropping out of one poll must not raise certainty.
  const result = matchVehicle(request([bus("leader", BOARDING - 2)], {
    recentlySeen: [tago("unplaced", undefined, 20)],
  }));
  assertWithheld(result, "candidate_route_progress_unknown");
});

test("a departed bus farther past the stop never becomes selectable", () => {
  for (const offset of [2, 3, 4, 6, 10]) {
    const result = matchVehicle(request([bus("gone", BOARDING + offset)]));
    assert.equal(result.status, "unavailable", `offset ${signed(offset)}`);
    assert.equal(candidateIn(result, "gone").zone, "departed", `offset ${signed(offset)}`);
    assert.deepEqual(candidateIn(result, "gone").rejectedReasons, ["departed_boarding_stop"], `offset ${signed(offset)}`);
  }
});

test("a departed bus does not hold up the bus that is coming", () => {
  const result = matchVehicle(request([
    bus("leader", BOARDING - 1),
    bus("gone", BOARDING + 2),
    bus("long-gone", BOARDING + 4),
  ]));
  assertSelected(result, "leader");
});

test("F1 regression: a lone fresh bus one to four stops past the stop is refused", () => {
  for (const offset of [1, 2, 3, 4]) {
    const input = request([bus("departed", BOARDING + offset)]);
    // The legacy policy scored this exactly like a bus the same distance
    // before the stop, and committed to it.
    const legacy = matchVehicleLegacySymmetricV0(input, new Map());
    assert.equal(legacy.selectedVehicleId, "departed", `negative control: legacy commits at ${signed(offset)}`);
    const result = matchVehicle(input);
    assert.equal(result.status, "unavailable", `offset ${signed(offset)}`);
    assert.equal(result.selectedVehicleId, undefined, `offset ${signed(offset)}`);
  }
});

/* ---------------------------------------- waiting rider: leader and margin */

test("a bus ahead of the fresh leader blocks it even when that bus is not fresh", () => {
  assertSelected(matchVehicle(request([bus("leader", BOARDING - 3)])), "leader", "control: the leader alone");
  // Not fresh is not gone: a leading bus stuck at a light still arrives first.
  const staleAhead = matchVehicle(request([
    bus("leader", BOARDING - 3),
    bus("ahead", BOARDING - 1, { observedAt: secondsAgo(300) }),
  ]));
  assertWithheld(staleAhead, "leading_vehicle_not_selectable", "stale provider row ahead");
  const agingAhead = matchVehicleWithSourceFreshness(
    request([tago("leader", BOARDING - 3), tago("ahead", BOARDING - 1)]),
    new Map([["leader", cadence("fresh")], ["ahead", cadence("aging")]]),
  );
  assertWithheld(agingAhead, "leading_vehicle_not_selectable", "TAGO row ahead holding still");
});

test("the three-stop margin holds at the edge of the approach window (F9)", () => {
  // The window bounds what may be selected, not which buses may overtake the
  // leader. A leader four stops out with a bus one or two stops behind it is
  // exactly as contested as a leader one stop out with a bus two behind.
  for (const [leader, follower] of [[-4, -5], [-4, -6], [-3, -5], [-2, -4]] as const) {
    assertWithheld(
      matchVehicle(request([bus("leader", BOARDING + leader), bus("follower", BOARDING + follower)])),
      "candidates_too_close",
      `leader ${leader}, follower ${follower}`,
    );
  }
  // Three stops behind is clear, wherever the pair is.
  for (const [leader, follower] of [[-4, -7], [-3, -6], [-1, -4]] as const) {
    assertSelected(
      matchVehicle(request([bus("leader", BOARDING + leader), bus("follower", BOARDING + follower)])),
      "leader",
      `leader ${leader}, follower ${follower}`,
    );
  }
  // A follower that is stale, or only remembered, counts the same.
  assertWithheld(
    matchVehicleWithSourceFreshness(
      request([tago("leader", BOARDING - 4), tago("follower", BOARDING - 5)]),
      new Map([["leader", cadence("fresh")], ["follower", cadence("stale")]]),
    ),
    "candidates_too_close",
    "stale follower behind the window edge",
  );
  // The legacy margin, which stopped counting at the window edge, committed here.
  const edge = request([bus("leader", BOARDING - 4), bus("follower", BOARDING - 5)]);
  assert.equal(matchVehicleLegacySymmetricV0(edge, new Map()).selectedVehicleId, "leader");
});

test("a remembered bus ahead of the fresh leader blocks it", () => {
  // Missing from this poll, last seen twenty seconds ago: not shown to be gone.
  const result = matchVehicle(request([bus("leader", BOARDING - 3)], {
    recentlySeen: [tago("dropped", BOARDING - 1, 20)],
  }));
  assertWithheld(result, "leading_vehicle_not_selectable");
  // Twenty seconds buys one stop plus one per fifteen seconds. From seven back
  // it may now be five back: two stops behind the leader, too close to call,
  // although outside the approach window (finding F9).
  assertWithheld(
    matchVehicle(request([bus("leader", BOARDING - 3)], { recentlySeen: [tago("dropped", BOARDING - 7, 20)] })),
    "candidates_too_close",
    "remembered at -7",
  );
  // Remembered where it cannot come within three stops of the leader even
  // after moving on, or departed (which only departs further): nothing changes.
  for (const stopSequence of [BOARDING - 8, BOARDING + 3]) {
    const outside = matchVehicle(request([bus("leader", BOARDING - 3)], {
      recentlySeen: [tago("dropped", stopSequence, 20)],
    }));
    assertSelected(outside, "leader", `remembered at ${signed(stopSequence - BOARDING)}`);
  }
});

test("the current snapshot supersedes a vehicle's remembered sighting", () => {
  // The leader's own earlier sighting, one stop further back, is not a second bus.
  const result = matchVehicle(request([bus("leader", BOARDING - 2)], {
    recentlySeen: [tago("leader", BOARDING - 3, 20)],
  }));
  assertSelected(result, "leader");
});

test("two stops of separation is too close to call", () => {
  const result = matchVehicle(request([bus("leader", BOARDING - 1), bus("follower", BOARDING - 3)]));
  assert.equal(result.status, "ambiguous");
  assert.equal(result.selectedVehicleId, undefined);
  assert.deepEqual(result.abstentionReasons, ["candidates_too_close"]);
});

test("three stops of separation is enough to select the leader", () => {
  assertSelected(matchVehicle(request([bus("leader", BOARDING - 1), bus("follower", BOARDING - 4)])), "leader");
});

test("F21 regression: an approach once contested inside the margin must not become automatically selectable just because the gap later opens", () => {
  const contested = matchVehicle(request([
    bus("leader", BOARDING - 4),
    bus("follower", BOARDING - 6),
  ]));
  assertWithheld(contested, "candidates_too_close", "initially contested");
  assert.ok(contested.passage);

  // The leader has pulled away for the moment, but the session already saw
  // the follower close enough that instantaneous spacing cannot prove which
  // one will reach the stop first. The real-base follower_overtaking
  // counterfactual found 61 wrong commits after exactly this uncertainty was
  // forgotten.
  const later = matchVehicle(request([
    bus("leader", BOARDING - 1),
    bus("follower", BOARDING - 5),
  ], { passage: contested.passage }));
  assertWithheld(later, "approach_contested_during_session", "gap opened after a contested approach");
});

test("F22 regression: a follower seen inside the margin while nothing was selectable yet still contests the approach", () => {
  // The first look: the leader's cadence is not fresh yet, as in a session's
  // first polls, so there is no selectable leader and the F21 check never ran.
  // The follower is two stops behind it.
  const early = matchVehicle(request([
    bus("leader", BOARDING - 4, { observedAt: secondsAgo(300) }),
    bus("follower", BOARDING - 6),
  ]));
  assert.equal(early.status, "unavailable");
  assert.ok(early.passage?.contestedApproach, "the contest is remembered although nothing was selectable");

  // Fresh now, and three stops clear: exactly the decision the real-base
  // follower_overtaking traces show committing before the follower overtook.
  const later = matchVehicle(request([
    bus("leader", BOARDING - 1),
    bus("follower", BOARDING - 4),
  ], { passage: early.passage }));
  assertWithheld(later, "approach_contested_during_session", "gap opened after a contest seen before any leader was selectable");
});

test("F22 regression: a pair inside the margin beyond the approach window contests the approach", () => {
  const far = matchVehicle(request([bus("leader", BOARDING - 6), bus("follower", BOARDING - 8)]));
  assert.equal(far.status, "unavailable", "nothing is selectable beyond the window");
  assert.ok(far.passage?.contestedApproach);
  const near = matchVehicle(request([bus("leader", BOARDING - 3), bus("follower", BOARDING - 7)], { passage: far.passage }));
  assertWithheld(near, "approach_contested_during_session");
});

test("F22 keeps a session that never saw the two nearest buses inside the margin selectable", () => {
  const far = matchVehicle(request([bus("leader", BOARDING - 6), bus("follower", BOARDING - 9)]));
  assert.equal(far.passage?.contestedApproach, undefined, "three stops apart is not a contest");
  const near = matchVehicle(request([bus("leader", BOARDING - 2), bus("follower", BOARDING - 6)], { passage: far.passage }));
  assertSelected(near, "leader");
});

test("F22 counts a vehicle once: one bus reported at two nearby places is not a pair", () => {
  const twice = matchVehicle(request([bus("solo", BOARDING - 6), bus("solo", BOARDING - 7)]));
  assert.equal(twice.passage?.contestedApproach, undefined);
  const near = matchVehicle(request([bus("solo", BOARDING - 2)], { passage: twice.passage }));
  assertSelected(near, "solo");
});

test("F22 does not apply round a loop, where F21's contest does not either", () => {
  const loopStops: StopOnRoute[] = [...stops, { stopId: "SYN-1", name: "Synthetic 1", sequence: 21 }];
  const result = matchVehicle(request([bus("leader", BOARDING - 6), bus("follower", BOARDING - 8)], { stops: loopStops }));
  assert.equal(result.passage?.contestedApproach, undefined);
});

test("a follower counts against the margin whether stale or only remembered", () => {
  const stale = matchVehicle(request([
    bus("leader", BOARDING - 1),
    bus("follower", BOARDING - 3, { observedAt: secondsAgo(300) }),
  ]));
  assertWithheld(stale, "candidates_too_close", "stale follower");
  // Remembered, it is worse than close: twenty seconds out of sight it may have
  // caught up with the leader, so the leader is no longer provably leading.
  const remembered = matchVehicle(request([bus("leader", BOARDING - 1)], {
    recentlySeen: [tago("follower", BOARDING - 3, 20)],
  }));
  assertWithheld(remembered, "leading_vehicle_not_selectable", "remembered follower");
});

/* ---------------------------------------------------------- on-board rider */

const ON_BOARD_ZONES: Array<{ name: string; offset: number; zone: string; reason?: string }> = [
  {
    name: "two stops before the stop cannot be the bus just boarded",
    offset: -2, zone: "not_yet_at_boarding_stop", reason: "not_yet_at_boarding_stop",
  },
  {
    name: "one stop before the stop is not selectable",
    offset: -1, zone: "boarding_stop_unresolved", reason: "boarding_stop_position_unresolved",
  },
  {
    name: "a bus reporting the boarding stop itself is not selectable",
    offset: 0, zone: "boarding_stop_unresolved", reason: "boarding_stop_position_unresolved",
  },
  { name: "one stop past the stop is the near edge of the on-board window", offset: 1, zone: "departed_within_on_board_window" },
  { name: "four stops past the stop is the far edge of the on-board window", offset: 4, zone: "departed_within_on_board_window" },
  {
    name: "five stops past the stop is beyond the on-board window",
    offset: 5, zone: "beyond_window", reason: "implausible_boarding_position",
  },
];

for (const row of ON_BOARD_ZONES) {
  test(`on-board rider, one fresh bus: ${row.name}`, () => {
    const result = matchVehicle(onBoard([bus("solo", BOARDING + row.offset)]));
    const solo = candidateIn(result, "solo");
    assert.equal(result.riderState, "on_board");
    assert.equal(solo.stopOffset, row.offset);
    assert.equal(solo.zone, row.zone);
    if (row.reason === undefined) {
      assertSelected(result, "solo");
      assert.deepEqual(solo.rejectedReasons, []);
    } else {
      assert.equal(result.status, "unavailable");
      assert.equal(result.selectedVehicleId, undefined);
      assert.ok(solo.rejectedReasons.includes(row.reason), JSON.stringify(solo.rejectedReasons));
    }
  });
}

test("on-board rider: any second bus in the on-board window withholds selection", () => {
  assertSelected(matchVehicle(onBoard([bus("boarded", BOARDING + 1)])), "boarded", "control: alone");
  assertSelected(
    matchVehicle(onBoard([bus("boarded", BOARDING + 1), bus("far", BOARDING + 5)])),
    "boarded",
    "control: a second bus beyond the window",
  );
  const withSecondBus = {
    fresh: matchVehicle(onBoard([bus("boarded", BOARDING + 1), bus("other", BOARDING + 3)])),
    stale: matchVehicle(onBoard([
      bus("boarded", BOARDING + 1),
      bus("other", BOARDING + 3, { observedAt: secondsAgo(300) }),
    ])),
    remembered: matchVehicle(onBoard([bus("boarded", BOARDING + 1)], {
      recentlySeen: [tago("other", BOARDING + 3, 20)],
    })),
  };
  for (const [kind, result] of Object.entries(withSecondBus)) {
    assertWithheld(result, "multiple_vehicles_in_on_board_window", kind);
  }
});

test("an absent rider state applies the waiting rule", () => {
  const departed = [bus("gone", BOARDING + 2)];
  const absent = matchVehicle(request(departed));
  assert.equal(absent.riderState, "waiting_at_stop");
  assert.equal(absent.status, "unavailable");
  assert.deepEqual(matchVehicle(request(departed, { riderState: "waiting_at_stop" })), absent);
  // Only an explicit on-board declaration admits a bus past the stop.
  assertSelected(matchVehicle(onBoard(departed)), "gone");
});

/* ---------------------------------------------------------- route topology */

test("without the route's stops, automatic selection is withheld", () => {
  for (const missing of [{ stops: undefined }, { stops: [] }]) {
    const result = matchVehicle(request([bus("leader", BOARDING - 2)], missing));
    assert.equal(result.status, "ambiguous", JSON.stringify(missing));
    assert.equal(result.selectedVehicleId, undefined);
    assert.deepEqual(result.abstentionReasons, ["route_topology_unverified"]);
  }
  // With nothing selectable either, the result is unavailable and still says why.
  const nothing = matchVehicle(request([bus("gone", BOARDING + 3)], { stops: undefined }));
  assert.equal(nothing.status, "unavailable");
  assert.deepEqual(nothing.abstentionReasons, ["route_topology_unverified"]);
});

test("a boarding stop missing from the route's stops withholds selection", () => {
  const result = matchVehicle(request([bus("leader", BOARDING - 2)], {
    stops: stops.filter((stop) => stop.sequence !== BOARDING),
  }));
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.abstentionReasons, ["boarding_stop_not_on_route"]);
});

test("a boarding stop whose id repeats on the route withholds selection", () => {
  const repeated = stops.map((stop) => (stop.sequence === 16 ? { ...stop, stopId: "SYN-10" } : stop));
  const result = matchVehicle(request([bus("leader", BOARDING - 2)], { stops: repeated }));
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.abstentionReasons, ["boarding_stop_repeats_on_route"]);
});

test("a boarding stop whose name repeats on the route withholds selection", () => {
  // One stop served in both directions: two ids, one name, spacing aside.
  const repeated = stops.map((stop) => (stop.sequence === 16 ? { ...stop, name: " Synthetic  10 " } : stop));
  const result = matchVehicle(request([bus("leader", BOARDING - 2)], { stops: repeated }));
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.abstentionReasons, ["boarding_stop_repeats_on_route"]);
});

/**
 * Synthetic loop: eleven stops, then a twelfth that is the first stop again,
 * which is how a route that closes on itself lists its stops.
 */
const loopStops: StopOnRoute[] = [
  ...Array.from({ length: 11 }, (_, index) => ({
    stopId: `SYN-LOOP-${index + 1}`,
    name: `Synthetic loop ${index + 1}`,
    sequence: index + 1,
  })),
  { stopId: "SYN-LOOP-1", name: "Synthetic loop 1", sequence: 12 },
];

test("loop: a bus one stop past the boarding stop via the seam blocks", () => {
  // Boarding at 11, the last stop of the lap. A bus reporting 1 has passed 11
  // and wrapped: one stop past the rider, though its plain offset is -10.
  const input = request([bus("leader", 9), bus("wrapped", 1)], { stops: loopStops, boardingStopSequence: 11 });
  assertSelected(matchVehicle({ ...input, candidates: [bus("leader", 9)] }), "leader", "control: the leader alone");
  const result = matchVehicle(input);
  assertWithheld(result, "vehicle_at_boarding_stop_unresolved");
  assert.equal(candidateIn(result, "wrapped").stopOffset, -10);
  assert.equal(candidateIn(result, "wrapped").zone, "boarding_stop_unresolved");
  // On a straight route the same report is ten stops back and irrelevant.
  assertSelected(matchVehicle({ ...input, stops }), "leader", "control: straight route");
});

test("loop: a bus approaching across the seam is never selected", () => {
  // Boarding at 2. A bus at 11 reaches it by wrapping (11, 1, 2), but at the
  // end of its lap it may lay over or leave service instead.
  const result = matchVehicle(request([bus("wrapping", 11)], { stops: loopStops, boardingStopSequence: 2 }));
  assert.equal(result.status, "unavailable");
  assert.equal(candidateIn(result, "wrapping").zone, "approaching_across_loop_seam");
  assert.deepEqual(candidateIn(result, "wrapping").rejectedReasons, ["approaching_across_loop_seam"]);
});

test("loop: a bus approaching across the seam still competes", () => {
  // Boarding at 3, the leader one stop out at 2. The wrapping bus at 11 is
  // three stops out (11, 1, 2, 3): only two behind the leader.
  const input = request([bus("leader", 2), bus("wrapping", 11)], { stops: loopStops, boardingStopSequence: 3 });
  assertSelected(matchVehicle({ ...input, candidates: [bus("leader", 2)] }), "leader", "control: the leader alone");
  const result = matchVehicle(input);
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.abstentionReasons, ["candidates_too_close"]);
});

/* ----------------------------------------------------- session memory (F4) */

test("waiting rider: a bus seen crossing the stop withholds every later selection", () => {
  const first = matchVehicle(request([bus("front", BOARDING - 1), bus("behind", BOARDING - 2)]));
  assertWithheld(first, "candidates_too_close", "snapshot 1");
  // The front bus has crossed the stop, perhaps with the rider on it. Judged on
  // this snapshot alone, the bus behind is now a clear leader.
  const second = [bus("front", BOARDING + 2), bus("behind", BOARDING - 1)];
  assertSelected(matchVehicle(request(second)), "behind", "control: without memory");
  assertWithheld(
    matchVehicle(request(second, { passage: first.passage })),
    "boarding_stop_reached_during_session",
    "with memory",
  );
});

test("waiting rider: once withheld, the session stays withheld", () => {
  // A bus dwelling at the stop: the rider may be boarding it.
  const first = matchVehicle(request([bus("dwelling", BOARDING), bus("next", BOARDING - 4)]));
  assert.equal(first.passage?.withheld?.reason, "boarding_stop_reached_during_session");
  // Two minutes later only the next bus is in sight, a clean approach on its own.
  const later = new Date(Date.parse(now) + 120_000).toISOString();
  const input = request([bus("next", BOARDING - 1, { observedAt: later })], { now: later });
  assertSelected(matchVehicle(input), "next", "control: without memory");
  const result = matchVehicle({ ...input, passage: first.passage });
  assertWithheld(result, "boarding_stop_reached_during_session", "with memory");
  assert.deepEqual(result.passage?.withheld, first.passage?.withheld, "set once, never moved or cleared");
});

test("on-board rider: a bus that reached the stop after the rider boarded is never theirs", () => {
  const first = matchVehicle(onBoard([bus("late", BOARDING - 2)]));
  assert.equal(first.status, "unavailable", "snapshot 1");
  // One stop past the stop now. Alone, it would pass for the rider's bus.
  const second = [bus("late", BOARDING + 1)];
  assertSelected(matchVehicle(onBoard(second)), "late", "control: without memory");
  const result = matchVehicle(onBoard(second, { passage: first.passage }));
  assert.equal(result.status, "unavailable");
  assert.ok(candidateIn(result, "late").rejectedReasons.includes("reached_boarding_stop_after_rider_boarded"));
});

test("on-board rider: a bus absent when the rider said they were aboard is never theirs", () => {
  // The rider declared they were aboard with one bus in the feed. A bus that
  // was not in that first snapshot cannot be the one they were already on,
  // however alone and well placed it later appears.
  const first = matchVehicle(onBoard([bus("present", BOARDING + 2)]));
  const later = [bus("newcomer", BOARDING + 3)];
  assertSelected(matchVehicle(onBoard(later)), "newcomer", "control: without memory");
  const result = matchVehicle(onBoard(later, { passage: first.passage }));
  assert.equal(result.selectedVehicleId, undefined);
  assert.ok(candidateIn(result, "newcomer").rejectedReasons.includes("not_present_when_rider_boarded"));
});

test("waiting rider: a crossing is remembered when the row that shows it drops out of the poll", () => {
  // Seen one stop before the stop, then three stops past it: the rider may be
  // aboard. If that second row is missing from this poll and only remembered,
  // the memory must still read it as a crossing (property P3, seed 16661).
  const first = matchVehicle(request([bus("crosser", BOARDING - 1), bus("next", BOARDING - 5)]));
  const crossed = [bus("crosser", BOARDING + 3), bus("next", BOARDING - 3)];
  assertWithheld(matchVehicle(request(crossed, { passage: first.passage })), "boarding_stop_reached_during_session", "in the poll");
  assertWithheld(
    matchVehicle(request([bus("next", BOARDING - 3)], {
      passage: first.passage,
      recentlySeen: [tago("crosser", BOARDING + 3, 5)],
    })),
    "boarding_stop_reached_during_session",
    "only remembered",
  );
});

test("on-board rider: leaving the window is remembered when the row that shows it drops out of the poll", () => {
  const first = matchVehicle(onBoard([bus("rider", BOARDING + 3), bus("other", BOARDING + 1)]));
  assertWithheld(
    matchVehicle(onBoard([bus("other", BOARDING + 2)], {
      passage: first.passage,
      recentlySeen: [tago("rider", BOARDING + 5, 5)],
    })),
    "vehicle_left_on_board_window_during_session",
    "only remembered",
  );
});

test("waiting rider: a late first decision withholds when a bus past the stop could have been at it", () => {
  // The rider said they were waiting 40 s ago, and this is the session's first
  // look. The bus two stops past could have been at the stop 40 s ago (one
  // stop plus one per 15 s = 3), with the rider stepping on; the bus behind is
  // only a clear leader if nobody boarded in between.
  const snapshot = [bus("gone", BOARDING + 2), bus("next", BOARDING - 2)];
  assertSelected(matchVehicle(request(snapshot)), "next", "control: a stateless match asks nothing about the past");
  assertSelected(matchVehicle(request(snapshot, { declaredAt: now })), "next", "control: first look at declaration");
  const late = matchVehicle(request(snapshot, { declaredAt: secondsAgo(40) }));
  assertWithheld(late, "vehicle_may_have_reached_boarding_stop_before_first_observation");
  // Out of reach: four stops past cannot have been at the stop 40 s ago.
  assertSelected(
    matchVehicle(request([bus("gone", BOARDING + 4), bus("next", BOARDING - 2)], { declaredAt: secondsAgo(40) })),
    "next",
    "four stops in 40 s is beyond reach",
  );
  // And the withhold is session memory: it survives the next snapshot.
  assertWithheld(
    matchVehicle(request([bus("next", BOARDING - 1)], { passage: late.passage, declaredAt: secondsAgo(45) })),
    "vehicle_may_have_reached_boarding_stop_before_first_observation",
    "sticky",
  );
});

test("waiting rider: a first decision later than the memory window cannot account for the gap", () => {
  const result = matchVehicle(request([bus("next", BOARDING - 2)], { declaredAt: secondsAgo(91) }));
  assertWithheld(result, "session_first_observed_late");
  // The rule reads only the gap before the first decision; memory carries on.
  assertSelected(matchVehicle(request([bus("next", BOARDING - 2)], { declaredAt: secondsAgo(90) })), "next");
});

test("on-board rider: a bus leaving the on-board window withholds every later selection", () => {
  const first = matchVehicle(onBoard([bus("rider", BOARDING + 3), bus("other", BOARDING + 1)]));
  assertWithheld(first, "multiple_vehicles_in_on_board_window", "snapshot 1");
  // One bus has left the window, possibly with the rider; the other is alone in it.
  const second = [bus("rider", BOARDING + 5), bus("other", BOARDING + 2)];
  assertSelected(matchVehicle(onBoard(second)), "other", "control: without memory");
  assertWithheld(
    matchVehicle(onBoard(second, { passage: first.passage })),
    "vehicle_left_on_board_window_during_session",
    "with memory",
  );
});

/* -------------------- out of sight, first sightings, loops (F15 to F19) */

test("waiting rider: a bus out of sight past the memory window still competes where it may be by now (F15)", () => {
  // Seen eight stops out, ahead of the bus behind it, then gone from the feed.
  // By the policy's own motion model (one stop plus one per 15 s) it may since
  // have come within one stop of the rider: still ahead of the bus behind.
  const sighting = { min: -8, max: -8, last: -8 };
  const passageAfter = (seconds: number) => ({ offsets: { lost: { ...sighting, lastSeenAt: secondsAgo(seconds) } }, initial: ["lost", "next"] });
  const snapshot = [bus("next", BOARDING - 3)];
  assertSelected(matchVehicle(request(snapshot)), "next", "control: without memory");
  assertWithheld(
    matchVehicle(request(snapshot, { passage: passageAfter(89), recentlySeen: [tago("lost", BOARDING - 8, 89)] })),
    "leading_vehicle_not_selectable",
    "remembered, 89 s",
  );
  // One second later it has left the evidence window. It has not left the road.
  const forgotten = matchVehicle(request(snapshot, { passage: passageAfter(91) }));
  assertWithheld(forgotten, "leading_vehicle_not_selectable", "out of sight, 91 s");
  assert.equal(forgotten.passage?.withheld, undefined, "not yet able to have reached the stop");
  // After 120 s it could have reached the stop, and the rider may be aboard it.
  const reached = matchVehicle(request(snapshot, { passage: passageAfter(120) }));
  assertWithheld(reached, "vehicle_may_have_reached_boarding_stop_unobserved", "out of sight, 120 s");
  assert.equal(reached.passage?.withheld?.reason, "vehicle_may_have_reached_boarding_stop_unobserved", "for good");
  // Its memory is kept, not dropped: the next decision still knows it.
  assert.deepEqual(reached.passage?.offsets.lost, { ...sighting, lastSeenAt: secondsAgo(120) });
});

test("on-board rider: a bus out of sight past the memory window still competes for the window (F15)", () => {
  const passage = {
    offsets: {
      rider: { min: 1, max: 1, last: 1, lastSeenAt: secondsAgo(100) },
      other: { min: 0, max: 0, last: 0, lastSeenAt: secondsAgo(100) },
    },
    initial: ["other", "rider"],
  };
  const snapshot = [bus("other", BOARDING + 2)];
  assertSelected(matchVehicle(onBoard(snapshot)), "other", "control: without memory");
  assertWithheld(matchVehicle(onBoard(snapshot, { passage })), "multiple_vehicles_in_on_board_window", "the rider may be on the lost bus");
});

test("a bus of unknown progress that leaves the feed withholds for good (F15)", () => {
  const first = matchVehicle(request([bus("unplaced", undefined), bus("next", BOARDING - 3)]));
  assertWithheld(first, "candidate_route_progress_unknown", "present");
  assert.deepEqual(Object.keys(first.passage?.unknownProgress ?? {}), ["unplaced"]);
  // Remembered from the evidence window, it blocks this poll only.
  const remembered = matchVehicle(request([bus("next", BOARDING - 2)], {
    passage: first.passage,
    recentlySeen: [tago("unplaced", undefined, 30)],
  }));
  assertWithheld(remembered, "candidate_route_progress_unknown", "remembered");
  assert.equal(remembered.passage?.withheld, undefined);
  // Out of sight, it may have been at the stop: nothing will ever say it was not.
  const gone = matchVehicle(request([bus("next", BOARDING - 2)], { passage: first.passage }));
  assertWithheld(gone, "vehicle_of_unknown_progress_out_of_sight", "out of sight");
  assert.equal(gone.passage?.withheld?.reason, "vehicle_of_unknown_progress_out_of_sight");
  // Seen again at a known position, it is an ordinary bus again.
  const placed = matchVehicle(request([bus("unplaced", BOARDING - 8), bus("next", BOARDING - 2)], { passage: first.passage }));
  assert.equal(placed.passage?.unknownProgress, undefined);
  assertSelected(placed, "next", "placed eight stops out, behind the leader");
});

test("waiting rider: a bus first seen past the stop mid-session withholds if it could have been at the stop since the rider began waiting (F16)", () => {
  const declaredAt = secondsAgo(60);
  const early = (candidates: VehicleObservation[]) => matchVehicle(request(candidates, { now: declaredAt, declaredAt }));
  const snapshot = [bus("gone", BOARDING + 2), bus("next", BOARDING - 3)];
  // The session looked at declaration and did not see that bus: that look
  // says nothing about where it was. Two stops past now, it may have been at
  // the stop within the last 60 s (one stop plus one per 15 s = 5).
  for (const [label, first] of [
    ["an earlier look without it", early([bus("next", BOARDING - 6, { observedAt: declaredAt })])],
    ["an earlier empty look", early([])],
  ] as const) {
    assertWithheld(
      matchVehicle(request(snapshot, { passage: first.passage, declaredAt })),
      "vehicle_first_seen_past_boarding_stop",
      label,
    );
  }
  // The same snapshot as the first look withholds too (F12).
  assertWithheld(matchVehicle(request(snapshot, { declaredAt })), "vehicle_may_have_reached_boarding_stop_before_first_observation");
  // Six stops past cannot have been at the stop in 60 s: it left before the rider came.
  const first = early([bus("next", BOARDING - 6, { observedAt: declaredAt })]);
  assertSelected(
    matchVehicle(request([bus("gone", BOARDING + 6), bus("next", BOARDING - 3)], { passage: first.passage, declaredAt })),
    "next",
    "out of reach",
  );
});

test("on-board rider: a bus missing from the first snapshot is never selected, and still competes (F16)", () => {
  // Not in the first snapshot, it cannot be shown to be the rider's bus; but
  // the feed may have missed it then, so it may be theirs, and the bus the
  // rider was seen near cannot be shown to be the only one.
  const first = matchVehicle(onBoard([bus("present", BOARDING + 2)]));
  const later = [bus("present", BOARDING + 3), bus("newcomer", BOARDING + 2)];
  const result = matchVehicle(onBoard(later, { passage: first.passage }));
  assertWithheld(result, "multiple_vehicles_in_on_board_window");
  assert.ok(candidateIn(result, "newcomer").rejectedReasons.includes("not_present_when_rider_boarded"));
  // A bus seen before the stop after the rider boarded is shown not to be theirs, and does not compete.
  const reached = matchVehicle(onBoard([bus("present", BOARDING + 2), bus("follower", BOARDING - 2)]));
  assertSelected(
    matchVehicle(onBoard([bus("present", BOARDING + 3), bus("follower", BOARDING + 1)], { passage: reached.passage })),
    "present",
    "the follower reached the stop after the rider boarded",
  );
});

test("loop: a bus seen crossing the stop through the seam withholds (F17)", () => {
  // Boarding at 11, the last stop of the lap. One bus one stop out, another
  // three out: too close to call. The first then reports stop 2: it has
  // passed 11 and the terminal, two stops past the rider, though its plain
  // offset (-9) reads as far away.
  const loop = { stops: loopStops, boardingStopSequence: 11 };
  const first = matchVehicle(request([bus("crosser", 10), bus("next", 8)], loop));
  assertWithheld(first, "candidates_too_close", "snapshot 1");
  const second = [bus("crosser", 2), bus("next", 9)];
  assertSelected(matchVehicle(request(second, loop)), "next", "control: without memory");
  assertWithheld(matchVehicle(request(second, { ...loop, passage: first.passage })), "boarding_stop_reached_during_session", "with memory");
});

test("loop: a bus lost across the seam may reach the stop unobserved (F17)", () => {
  // Boarding at 5. A bus last seen at 11 is five stops out through the seam
  // (11, 1, 2, 3, 4, 5); 100 s later it may have reached the stop.
  const earlier = secondsAgo(100);
  const loop = { stops: loopStops, boardingStopSequence: 5 };
  const first = matchVehicle(request([bus("lost", 11, { observedAt: earlier }), bus("next", 1, { observedAt: earlier })], { ...loop, now: earlier }));
  assertWithheld(
    matchVehicle(request([bus("next", 2)], { ...loop, passage: first.passage })),
    "vehicle_may_have_reached_boarding_stop_unobserved",
  );
  // On a straight route the same bus is six stops past the stop, gone for good.
  const straight = matchVehicle(request([bus("lost", 11, { observedAt: earlier }), bus("next", 1, { observedAt: earlier })], { boardingStopSequence: 5, now: earlier }));
  assertSelected(matchVehicle(request([bus("next", 2)], { boardingStopSequence: 5, passage: straight.passage })), "next", "control: straight route");
  // Lost three stops past the stop, it keeps going round: 120 s later it may be back at it.
  const past = matchVehicle(request([bus("lost", 8, { observedAt: secondsAgo(120) }), bus("next", 1, { observedAt: secondsAgo(120) })], { ...loop, now: secondsAgo(120) }));
  assert.equal(past.passage?.offsets.lost?.last, 3, "three stops past the stop");
  const around = matchVehicle(request([bus("next", 2)], { ...loop, passage: past.passage }));
  assert.equal(around.passage?.withheld?.reason, "vehicle_may_have_reached_boarding_stop_unobserved", "round the loop");
  assertSelected(matchVehicle(request([bus("next", 2)], { boardingStopSequence: 5, passage: past.passage })), "next", "control: straight route");
});

test("loop: however short the lap, a bus in the on-board window is never read as one before the stop (F17)", () => {
  // Eight stops round, boarding at 2. A bus four stops past is also four
  // stops before the stop the other way round: it may be the rider's bus, so
  // it competes, and the bus one stop past is not the only one.
  const short: StopOnRoute[] = [
    ...Array.from({ length: 8 }, (_, index) => ({ stopId: `SYN-SHORT-${index + 1}`, name: `Synthetic short ${index + 1}`, sequence: index + 1 })),
    { stopId: "SYN-SHORT-1", name: "Synthetic short 1", sequence: 9 },
  ];
  const aboard = { stops: short, boardingStopSequence: 2 };
  const first = matchVehicle(onBoard([bus("far", 6), bus("near", 3)], aboard));
  assertWithheld(first, "multiple_vehicles_in_on_board_window", "a bus four stops past competes");
  // One stop further it has left the window, possibly with the rider.
  assertWithheld(
    matchVehicle(onBoard([bus("far", 7), bus("near", 4)], { ...aboard, passage: first.passage })),
    "vehicle_left_on_board_window_during_session",
    "leaving the window across half the lap",
  );
  // A waiting rider: a bus one stop out, next seen four stops past (more than
  // half the lap). Its distance to the stop grew by three: it went past it.
  const waiting = { stops: short, boardingStopSequence: 2 };
  const seen = matchVehicle(request([bus("crosser", 1), bus("next", 5)], waiting));
  const later = matchVehicle(request([bus("crosser", 6), bus("next", 6)], { ...waiting, passage: seen.passage }));
  assert.equal(later.passage?.withheld?.reason, "boarding_stop_reached_during_session", "a crossing longer than half the lap");
  // Five stops past is also two stops back from where it was: it may have
  // gone past the stop, and that still withholds, but it is not seen to (R43).
  const back = matchVehicle(request([bus("crosser", 7), bus("next", 6)], { ...waiting, passage: seen.passage }));
  assert.equal(back.passage?.withheld?.reason, "vehicle_may_have_reached_boarding_stop_unobserved", "or a reading two stops back");
});

test("a bus the snapshot places at two positions is remembered as of unknown progress, whatever the order of its rows", () => {
  // Thirty stops, boarding at 20. The second bus is reported five stops out and
  // nineteen stops out in one snapshot, then leaves the feed. Before, memory
  // kept whichever row came last, so 91 s later the leader was selected or
  // not by row order alone.
  const long: StopOnRoute[] = Array.from({ length: 30 }, (_, index) => ({ stopId: `SYN-LONG-${index + 1}`, name: `Synthetic long ${index + 1}`, sequence: index + 1 }));
  const route = { stops: long, boardingStopSequence: 20 };
  const early = secondsAgo(91);
  const twice = [bus("twice", 15, { observedAt: early }), bus("twice", 1, { observedAt: early })];
  const outcomes = [twice, [...twice].reverse()].map((rows) => {
    const first = matchVehicle(request([bus("leader", 16, { observedAt: early }), ...rows], { ...route, now: early }));
    assert.deepEqual(Object.keys(first.passage?.unknownProgress ?? {}), ["twice"]);
    assert.equal(first.passage?.offsets.twice?.last, -5, "the position nearest the stop ahead");
    const later = matchVehicle(request([bus("leader", 18)], { ...route, passage: first.passage }));
    assert.equal(later.status, "ambiguous", `rows ${rows.map((row) => row.stopSequence).join(", ")}`);
    return later.passage?.withheld?.reason;
  });
  assert.ok(outcomes[0], "withheld for good");
  assert.equal(outcomes[1], outcomes[0], "whatever the order of the rows");
});

test("a remembered row does not place a bus whose latest sighting had no position", () => {
  // One snapshot reported the bus both with and without a stop sequence; the
  // evidence window kept the row with one. That row is not where the bus is.
  const first = matchVehicle(request([bus("leader", BOARDING - 4), bus("blur", 1), bus("blur", undefined)]));
  assert.deepEqual(Object.keys(first.passage?.unknownProgress ?? {}), ["blur"]);
  const later = new Date(Date.parse(now) + 60_000).toISOString();
  const kept = { ...tago("blur", 1), receivedAt: now };
  assertWithheld(
    matchVehicle(request([bus("leader", BOARDING - 3, { observedAt: later })], { now: later, passage: first.passage, recentlySeen: [kept] })),
    "candidate_route_progress_unknown",
  );
  // Seen since at a known position, the remembered row places it again.
  const placed = { ...tago("blur", 1), receivedAt: new Date(Date.parse(now) + 30_000).toISOString() };
  assertSelected(
    matchVehicle(request([bus("leader", BOARDING - 3, { observedAt: later })], { now: later, passage: first.passage, recentlySeen: [placed] })),
    "leader",
  );
});

test("a sighting or a declaration dated after now gives no bound on the time since", () => {
  // The server clock stepped back 30 s. A bus lost five stops out cannot be
  // taken to have been seen "just now": nothing bounds where it is.
  const ahead = new Date(Date.parse(now) + 30_000).toISOString();
  const passage = { offsets: { lost: { min: -5, max: -5, last: -5, lastSeenAt: ahead } }, initial: ["leader", "lost"] };
  const result = matchVehicle(request([bus("leader", BOARDING - 1)], { passage }));
  assert.equal(result.status, "ambiguous");
  assert.equal(result.passage?.withheld?.reason, "vehicle_may_have_reached_boarding_stop_unobserved");
  // A first decision before the rider's own declaration cannot say how long they waited.
  assertWithheld(matchVehicle(request([bus("leader", BOARDING - 2)], { declaredAt: ahead })), "session_first_observed_late");
});

test("a remembered row of the sighting that left a bus unplaced stays unplaced, though received a moment after now (R28)", () => {
  // In production a decision reads `now` and then fetches, so each row of the
  // snapshot is received a few milliseconds later. The evidence window keeps
  // the row with a stop sequence; it is still that same, unplaced sighting.
  const received = new Date(Date.parse(now) + 300).toISOString();
  const placedRow = { ...tago("blur", 1), receivedAt: received };
  const blurRow = { ...tago("blur", undefined), receivedAt: received };
  const later = new Date(Date.parse(now) + 60_000).toISOString();
  for (const rows of [[placedRow, blurRow], [blurRow, placedRow]]) {
    const first = matchVehicle(request([bus("leader", BOARDING - 4), ...rows]));
    assertWithheld(
      matchVehicle(request([bus("leader", BOARDING - 3, { observedAt: later })], { now: later, passage: first.passage, recentlySeen: [placedRow] })),
      "candidate_route_progress_unknown",
      rows.map((row) => String(row.stopSequence)).join(", "),
    );
  }
});

test("a sighting the session recorded, dated after now by however little, gives no bound on the time since (R29)", () => {
  // The clock stepped back 5 s: inside the tolerance a provider's time gets,
  // but the session's own last sighting of a bus cannot be later than now.
  const ahead = new Date(Date.parse(now) + 5_000).toISOString();
  const lost = { offsets: { lost: { min: -5, max: -5, last: -5, lastSeenAt: ahead } }, initial: ["leader", "lost"] };
  assert.equal(matchVehicle(request([bus("leader", BOARDING - 1)], { passage: lost })).passage?.withheld?.reason,
    "vehicle_may_have_reached_boarding_stop_unobserved", "out of sight");
  // Round a loop, seen again: it may have gone round through the stop.
  const loop = { stops: loopStops, boardingStopSequence: 11 };
  const seen = { offsets: { round: { min: -8, max: -8, last: -8, lastSeenAt: ahead } }, initial: ["round", "c"] };
  assert.equal(matchVehicle(request([bus("round", 6), bus("c", 10)], { ...loop, passage: seen })).passage?.withheld?.reason,
    "vehicle_may_have_reached_boarding_stop_unobserved", "seen again round a loop");
});

test("on-board rider: a bus shown not to be theirs does not compete once it is out of sight", () => {
  // The follower was seen before the stop after the rider boarded, then past
  // it: not the rider's bus. Out of sight since, it may still be in the
  // window, but it cannot be theirs, so the rider's bus is the only candidate.
  const at = (seconds: number) => secondsAgo(seconds);
  const first = matchVehicle(onBoard([bus("rider", BOARDING + 2, { observedAt: at(200) }), bus("follower", BOARDING - 3, { observedAt: at(200) })], { now: at(200) }));
  const second = matchVehicle(onBoard([bus("rider", BOARDING + 2, { observedAt: at(140) }), bus("follower", BOARDING + 1, { observedAt: at(140) })], { now: at(140), passage: first.passage }));
  assert.ok(candidateIn(second, "follower").rejectedReasons.includes("reached_boarding_stop_after_rider_boarded"));
  assertSelected(matchVehicle(onBoard([bus("rider", BOARDING + 3)], { passage: second.passage })), "rider", "the follower, out of sight, is still not theirs");
});

test("on-board rider on a loop: a bus once seen before the stop is never theirs, however it reads later (F17)", () => {
  // Fourteen stops round, boarding at 7. A bus at 13 is eight stops before the
  // stop the way it travels (its plain offset, +6, reads as past it). It
  // reached the stop after the rider said they were aboard: it is not their
  // bus, at every later decision, whatever the extremes of its plain offsets say.
  const ring: StopOnRoute[] = [
    ...Array.from({ length: 14 }, (_, index) => ({ stopId: `SYN-RING-${index + 1}`, name: `Synthetic ring ${index + 1}`, sequence: index + 1 })),
    { stopId: "SYN-RING-1", name: "Synthetic ring 1", sequence: 15 },
  ];
  const aboard = { stops: ring, boardingStopSequence: 7 };
  let passage = matchVehicle(onBoard([bus("late", 13)], aboard)).passage;
  assert.deepEqual(passage?.reachedAfterBoarding, ["late"]);
  for (const sequence of [8, 9, 10]) {
    const result = matchVehicle(onBoard([bus("late", sequence)], { ...aboard, passage }));
    assert.equal(result.status, "unavailable", `at ${sequence}`);
    assert.ok(candidateIn(result, "late").rejectedReasons.includes("reached_boarding_stop_after_rider_boarded"), `at ${sequence}`);
    passage = result.passage;
  }
});

/** Synthetic ring of `lap` stops, the last row the first stop again. */
function ring(lap: number): StopOnRoute[] {
  return [
    ...Array.from({ length: lap }, (_, index) => ({ stopId: `SYN-R${lap}-${index + 1}`, name: `Synthetic ring ${lap} ${index + 1}`, sequence: index + 1 })),
    { stopId: `SYN-R${lap}-1`, name: `Synthetic ring ${lap} 1`, sequence: lap + 1 },
  ];
}

test("on board round a loop, a bus seen clear of the stop and later back at it or closer past it is never selected, and still competes (R23)", () => {
  // Fourteen stops round, boarding at 7: stops 8 to 11 are one to four past it.
  const aboard = { stops: ring(14), boardingStopSequence: 7 };
  // Four stops past, then one: it went through the stop after the rider boarded,
  // or read three stops back. Without the earlier sighting it would be theirs.
  const first = matchVehicle(onBoard([bus("round", 11)], aboard));
  assertSelected(first, "round", "control: alone in the window");
  assertSelected(matchVehicle(onBoard([bus("round", 8)], aboard)), "round", "control: without memory");
  const back = matchVehicle(onBoard([bus("round", 8)], { ...aboard, passage: first.passage }));
  assert.equal(back.status, "unavailable");
  assert.deepEqual(candidateIn(back, "round").rejectedReasons, ["may_have_reached_boarding_stop_after_rider_boarded"]);
  assert.deepEqual(back.passage?.returnedToStop, ["round"]);
  // One stop back is enough: a stop read back is as unsafe as a lap.
  const jitter = matchVehicle(onBoard([bus("round", 10)], { ...aboard, passage: matchVehicle(onBoard([bus("round", 11)], aboard)).passage }));
  assert.equal(jitter.status, "unavailable", "one stop back");
  // Back at the stop before it (it may be arriving) counts too, for good.
  let passage = matchVehicle(onBoard([bus("round", 6)], { ...aboard, passage: first.passage })).passage;
  const later = matchVehicle(onBoard([bus("round", 9)], { ...aboard, passage }));
  assert.equal(later.status, "unavailable", "sticky after the stop before it");
  // It still competes: with it in the window, the rider's bus is not the only one.
  passage = matchVehicle(onBoard([bus("round", 11), bus("rider", 9)], aboard)).passage;
  assertWithheld(matchVehicle(onBoard([bus("round", 8), bus("rider", 10)], { ...aboard, passage })), "multiple_vehicles_in_on_board_window");
  // The rider's own bus dwelling at the stop reads the stop before it, then the
  // stop, then moves on: never clear of the stop first, so it stays theirs.
  passage = matchVehicle(onBoard([bus("dwell", 6)], aboard)).passage;
  passage = matchVehicle(onBoard([bus("dwell", 7)], { ...aboard, passage })).passage;
  assertSelected(matchVehicle(onBoard([bus("dwell", 9)], { ...aboard, passage })), "dwell", "the rider's bus leaving the stop");
});

test("on board round a loop, a bus seen again after long enough to have gone round through the stop is never selected (R23)", () => {
  // Three stops past at the first look, four past at the next. 400 s is time
  // for eleven stops to the stop and four on; 20 s is not.
  const aboard = { stops: ring(14), boardingStopSequence: 7 };
  const at = (seconds: number) => matchVehicle(onBoard([bus("slow", 10, { observedAt: secondsAgo(seconds) })], { ...aboard, now: secondsAgo(seconds) }));
  assert.equal(matchVehicle(onBoard([bus("slow", 11)], { ...aboard, passage: at(400).passage })).status, "unavailable");
  assertSelected(matchVehicle(onBoard([bus("slow", 11)], { ...aboard, passage: at(20).passage })), "slow", "control: 20 s");
});

test("on board, a loop too short to tell the stops just past the boarding stop from those just before it selects nothing (R23)", () => {
  // Nine stops round: a bus two stops past the stop is also seven before it,
  // and a stop read either way brings the window and the approach together.
  const short = matchVehicle(onBoard([bus("only", 4)], { stops: ring(9), boardingStopSequence: 2 }));
  assert.equal(short.status, "ambiguous");
  assert.deepEqual(short.abstentionReasons, ["loop_too_short_for_on_board_selection"]);
  assertSelected(matchVehicle(onBoard([bus("only", 4)], { stops: ring(10), boardingStopSequence: 2 })), "only", "control: ten stops round");
  // A waiting rider on the same loop is judged as before.
  assertSelected(matchVehicle(request([bus("only", 8)], { stops: ring(9), boardingStopSequence: 9 })), "only", "control: waiting");
});

test("waiting round a loop, a bus seen again after long enough to have gone round through the stop withholds for good (R24)", () => {
  // Boarding at 11, the lap's last stop. B is eight stops out, then five; C
  // nine, then one. In 200 s B had time to reach the stop, take the rider and
  // go on round to five stops out (8 + 6 stops).
  const loop = { stops: loopStops, boardingStopSequence: 11 };
  const look = (seconds: number) => matchVehicle(request(
    [bus("b", 3, { observedAt: secondsAgo(seconds) }), bus("c", 2, { observedAt: secondsAgo(seconds) })],
    { ...loop, now: secondsAgo(seconds) },
  ));
  const later = [bus("b", 6), bus("c", 10)];
  const withheld = matchVehicle(request(later, { ...loop, passage: look(200).passage }));
  assert.equal(withheld.status, "ambiguous");
  assert.equal(withheld.passage?.withheld?.reason, "vehicle_may_have_reached_boarding_stop_unobserved");
  assertSelected(matchVehicle(request(later, { ...loop, passage: look(20).passage })), "c", "control: 20 s");
  // At the terminal both times, read as the first stop and then as the
  // closing row: a relabel, unless there was time for the whole lap.
  const terminal = { stops: ring(10), boardingStopSequence: 6 };
  const atTerminal = (seconds: number) => matchVehicle(request(
    [bus("x", 1, { observedAt: secondsAgo(seconds) }), bus("l", 2, { observedAt: secondsAgo(seconds) })],
    { ...terminal, now: secondsAgo(seconds) },
  ));
  const relabelled = [bus("x", 11), bus("l", 5)];
  assert.equal(matchVehicle(request(relabelled, { ...terminal, passage: atTerminal(150).passage })).passage?.withheld?.reason,
    "vehicle_may_have_reached_boarding_stop_unobserved", "a lap in 150 s");
  assertSelected(matchVehicle(request(relabelled, { ...terminal, passage: atTerminal(10).passage })), "l", "control: a relabel in 10 s");
});

test("round a loop, a reason a sighting raises is kept before one the time since allows, whatever the order of the rows", () => {
  // Boarding at 11. Seen 200 s ago, "round" was eight stops out and "crosser"
  // one; now "round" is five out (it had time to go round) and "crosser" is two
  // past (it crossed). The session keeps the crossing: the journey session's
  // boarding watch withdraws a selection on a sighting, never on the time since.
  const loop = { stops: loopStops, boardingStopSequence: 11 };
  const earlier = secondsAgo(200);
  const first = matchVehicle(request(
    [bus("round", 3, { observedAt: earlier }), bus("crosser", 10, { observedAt: earlier })],
    { ...loop, now: earlier },
  ));
  for (const rows of [[bus("round", 6), bus("crosser", 2)], [bus("crosser", 2), bus("round", 6)]]) {
    const result = matchVehicle(request(rows, { ...loop, passage: first.passage }));
    assert.equal(result.passage?.withheld?.reason, "boarding_stop_reached_during_session", rows.map((row) => row.vehicleId).join(", "));
  }
});

test("on board, a bus the snapshot places twice is never excluded by one of the places, and keeps competing (R27)", () => {
  // The rider's bus is two stops past the stop. "twice" is reported three
  // past and three before at once, or three before and, under another route,
  // two past. The place before the stop would say it reached the stop after
  // the rider boarded and stop it competing; nothing about it can be trusted.
  const twins: Array<[string, VehicleObservation[]]> = [
    ["two stops", [bus("twice", BOARDING + 3), bus("twice", BOARDING - 3)]],
    ["another route", [bus("twice", BOARDING - 3), bus("twice", BOARDING + 2, { routeId: "route-other" })]],
  ];
  for (const [label, rows] of twins) {
    const first = matchVehicle(onBoard([bus("rider", BOARDING + 2), ...rows]));
    assert.equal(first.passage?.reachedAfterBoarding, undefined, label);
    assert.equal(first.passage?.offsets.twice, undefined, `${label}: memory keeps no place for it`);
    assert.notEqual(first.passage?.unknownProgress?.twice, undefined, `${label}: it is of unknown progress (R30)`);
    const later = matchVehicle(onBoard([bus("rider", BOARDING + 3), bus("twice", BOARDING + 4)], { passage: first.passage }));
    assertWithheld(later, "multiple_vehicles_in_on_board_window", label);
  }
  // Seen before the stop at one place, it is excluded as before.
  const once = matchVehicle(onBoard([bus("rider", BOARDING + 2), bus("once", BOARDING - 3)]));
  assertSelected(matchVehicle(onBoard([bus("rider", BOARDING + 3), bus("once", BOARDING + 4)], { passage: once.passage })), "rider", "control");
});

test("on board, the rider's bus listed at two places, or also at none, still withholds when it leaves the window (R30)", () => {
  // The rider rides "rider", listed one and two stops past the stop at once
  // (or one past and once with no stop); "behind" dwells a stop short. A
  // minute later "rider" is five past, beyond the window, and "behind" is in
  // it. Forgetting the garbled sighting would select "behind".
  const minuteLater = new Date(Date.parse(now) + 60_000).toISOString();
  const firsts: Array<[string, VehicleObservation[]]> = [
    ["two places", [bus("rider", BOARDING + 1), bus("rider", BOARDING + 2)]],
    ["a place and none", [bus("rider", BOARDING + 1), bus("rider", undefined)]],
    ["listed once (control)", [bus("rider", BOARDING + 1)]],
  ];
  for (const [label, rows] of firsts) {
    const first = matchVehicle(onBoard([...rows, bus("behind", BOARDING - 1)]));
    assert.notEqual(first.status, "matched", label);
    const later = matchVehicle(onBoard(
      [bus("rider", BOARDING + 5, { observedAt: minuteLater }), bus("behind", BOARDING + 1, { observedAt: minuteLater })],
      { now: minuteLater, passage: first.passage },
    ));
    assertWithheld(later, "vehicle_left_on_board_window_during_session", label);
    assert.equal(later.passage?.withheld?.reason, "vehicle_left_on_board_window_during_session", label);
  }
});

test("on board, a bus seen only at no place and then beyond the window may be the rider's bus leaving it (R30)", () => {
  const minuteLater = new Date(Date.parse(now) + 60_000).toISOString();
  const first = matchVehicle(onBoard([bus("rider", undefined), bus("behind", BOARDING - 1)]));
  const later = matchVehicle(onBoard(
    [bus("rider", BOARDING + 5, { observedAt: minuteLater }), bus("behind", BOARDING + 1, { observedAt: minuteLater })],
    { now: minuteLater, passage: first.passage },
  ));
  assertWithheld(later, "vehicle_left_on_board_window_during_session");
  // Seen at a place in between, the ordinary rule decides: placed beyond the
  // window from the start, it never was in it.
  const placedFar = matchVehicle(onBoard([bus("far", BOARDING + 7), bus("rider", BOARDING + 1)]));
  assertSelected(matchVehicle(onBoard(
    [bus("far", BOARDING + 8, { observedAt: minuteLater }), bus("rider", BOARDING + 2, { observedAt: minuteLater })],
    { now: minuteLater, passage: placedFar.passage },
  )), "rider", "control");
});

test("on board, a bus in the window listed at two places or under another route keeps competing once out of sight (R30)", () => {
  // "twice" is in the on-board window, and also listed elsewhere: at a second
  // stop, or under another route. Then it leaves the feed for longer than the
  // evidence window. It may be the rider's bus: "rider" is never the only one.
  const later = new Date(Date.parse(now) + 100_000).toISOString();
  const twins: Array<[string, VehicleObservation[]]> = [
    ["two stops", [bus("twice", BOARDING + 3), bus("twice", BOARDING + 7)]],
    ["another route", [bus("twice", BOARDING + 3), bus("twice", BOARDING + 3, { routeId: "route-other" })]],
  ];
  for (const [label, rows] of twins) {
    const first = matchVehicle(onBoard([bus("rider", BOARDING + 2), ...rows]));
    assert.notEqual(first.passage?.unknownProgress?.twice, undefined, `${label}: marked as of unknown progress`);
    const gone = matchVehicle(onBoard([bus("rider", BOARDING + 3, { observedAt: later })], { now: later, passage: first.passage }));
    assertWithheld(gone, "vehicle_of_unknown_progress_out_of_sight", label);
  }
});

test("on board, the rider's bus never placed still withholds when it leaves the window: round a loop, across its seam, or listed twice again (R37)", () => {
  // The rider rides "rider", listed one and two stops past the stop at once;
  // "behind" dwells a stop short. A minute later "rider" is five past, beyond
  // the window, and "behind" is one past. Twenty stops round, boarding at 10
  // the five past is plain; boarding at 18 it is stop 3, across the seam,
  // fifteen stops before the stop by its plain offset.
  const minuteLater = new Date(Date.parse(now) + 60_000).toISOString();
  for (const boardingStopSequence of [10, 18]) {
    const aboard = { stops: ring(20), boardingStopSequence };
    const past = (stops: number) => ((boardingStopSequence + stops - 1) % 20) + 1;
    const first = matchVehicle(onBoard([bus("rider", past(1)), bus("rider", past(2)), bus("behind", past(-1))], aboard));
    assert.notEqual(first.status, "matched", `boarding at ${boardingStopSequence}`);
    const later = matchVehicle(onBoard(
      [bus("rider", past(5), { observedAt: minuteLater }), bus("behind", past(1), { observedAt: minuteLater })],
      { ...aboard, now: minuteLater, passage: first.passage },
    ));
    assertWithheld(later, "vehicle_left_on_board_window_during_session", `boarding at ${boardingStopSequence}`);
  }
  // On a straight route, listed at two places again, both beyond the window.
  const twice = matchVehicle(onBoard([bus("rider", BOARDING + 1), bus("rider", BOARDING + 2), bus("behind", BOARDING - 1)]));
  assertWithheld(matchVehicle(onBoard(
    [
      bus("rider", BOARDING + 5, { observedAt: minuteLater }),
      bus("rider", BOARDING + 6, { observedAt: minuteLater }),
      bus("behind", BOARDING + 1, { observedAt: minuteLater }),
    ],
    { now: minuteLater, passage: twice.passage },
  )), "vehicle_left_on_board_window_during_session", "listed twice again");
  // At the window's last stop it has left nothing: it is the rider's bus.
  const unplaced = matchVehicle(onBoard([bus("rider", undefined)]));
  assertSelected(matchVehicle(onBoard(
    [bus("rider", BOARDING + 4, { observedAt: minuteLater })],
    { now: minuteLater, passage: unplaced.passage },
  )), "rider", "at the window's last stop");
});

test("on board, a bus never placed and then beyond the window is the rider's leaving it only if their bus could have got there since they said they were aboard (R40)", () => {
  // The rider says they are aboard at `now`, and "rider" is a stop past the
  // stop. "far" is listed at two places at once, both beyond the window. In
  // fifteen seconds the rider's bus can have gone two stops past the window's
  // far edge, three for a misread: "far" five beyond is not theirs; three
  // beyond, or five beyond a minute on, it may be.
  const declared = { declaredAt: now };
  const after = (seconds: number) => new Date(Date.parse(now) + seconds * 1_000).toISOString();
  const first = matchVehicle(onBoard([bus("rider", BOARDING + 1), bus("far", BOARDING + 7), bus("far", BOARDING + 8)], declared));
  const look = (seconds: number, far: number, overrides: Partial<MatchRequest> = declared) => matchVehicle(onBoard(
    [bus("rider", BOARDING + 2, { observedAt: after(seconds) }), bus("far", far, { observedAt: after(seconds) })],
    { ...overrides, now: after(seconds), passage: first.passage },
  ));
  assertSelected(look(15, BOARDING + 9), "rider", "five beyond after 15 s");
  assertWithheld(look(15, BOARDING + 7), "vehicle_left_on_board_window_during_session", "three beyond after 15 s");
  assertWithheld(look(60, BOARDING + 9), "vehicle_left_on_board_window_during_session", "five beyond after 60 s");
  assertWithheld(look(15, BOARDING + 9, {}), "vehicle_left_on_board_window_during_session", "no declaration, no bound");
  // Round a loop a bus before the stop is past it the long way round. Twenty
  // stops round, boarding at 10: "behind", first at no place, then four stops
  // before the stop, is sixteen past. Fifteen seconds on it is not the
  // rider's bus; 200 s on, it could have gone round to there.
  const aboard = { stops: ring(20), boardingStopSequence: 10, declaredAt: now };
  const unplaced = matchVehicle(onBoard([bus("rider", 11), bus("behind", undefined)], aboard));
  const loopLook = (seconds: number) => matchVehicle(onBoard(
    [bus("rider", 12, { observedAt: after(seconds) }), bus("behind", 6, { observedAt: after(seconds) })],
    { ...aboard, now: after(seconds), passage: unplaced.passage },
  ));
  assertSelected(loopLook(15), "rider", "round a loop after 15 s");
  assertWithheld(loopLook(200), "vehicle_left_on_board_window_during_session", "round a loop after 200 s");
});

test("on board, the rider's bus read at the window's far edge may stand a stop further on and be read a stop further still (R46)", () => {
  // The window is a window of readings. "rider" is read at the window's last
  // stop and also under another route, or at it and the next: no place the
  // matcher trusts. "behind" dwells a stop short. In ten seconds a bus can go
  // one stop; "rider" may have stood at B+5, gone to B+6, and be read at B+7.
  // It is leaving the window, and "behind" is not the rider's bus.
  const declared = { declaredAt: now, stops: Array.from({ length: 40 }, (_, index) => ({ stopId: `SYN-LS-${index + 1}`, name: `Synthetic long ${index + 1}`, sequence: index + 1 })) };
  const after = (seconds: number) => new Date(Date.parse(now) + seconds * 1_000).toISOString();
  const firsts: Array<[string, VehicleObservation[]]> = [
    ["another route", [bus("rider", BOARDING + 4), bus("rider", BOARDING + 4, { routeId: "route-other" })]],
    ["two places", [bus("rider", BOARDING + 4), bus("rider", BOARDING + 5)]],
  ];
  for (const [label, rows] of firsts) {
    const first = matchVehicle(onBoard([...rows, bus("behind", BOARDING - 1)], declared));
    assert.notEqual(first.status, "matched", label);
    const look = (seconds: number, rider: number) => matchVehicle(onBoard(
      [bus("rider", rider, { observedAt: after(seconds) }), bus("behind", BOARDING + 1, { observedAt: after(seconds) })],
      { ...declared, now: after(seconds), passage: first.passage },
    ));
    // The edge of what a misread at each end allows: beyond the window by
    // the motion model's reach (1 in 10 s, 2 in 15 s, 5 in 60 s) and two.
    assertWithheld(look(10, BOARDING + 7), "vehicle_left_on_board_window_during_session", `${label}: 10 s`);
    assertWithheld(look(15, BOARDING + 8), "vehicle_left_on_board_window_during_session", `${label}: 15 s`);
    assertWithheld(look(60, BOARDING + 11), "vehicle_left_on_board_window_during_session", `${label}: 60 s`);
    // One stop further it cannot be the rider's bus, and the bus behind is.
    assertSelected(look(10, BOARDING + 8), "behind", `${label}: 10 s, one further`);
    assertSelected(look(15, BOARDING + 9), "behind", `${label}: 15 s, one further`);
    assertSelected(look(60, BOARDING + 12), "behind", `${label}: 60 s, one further`);
  }
});

test("on board round a loop, the never-placed bound counts stops past the stop the same way, across the seam too (R47)", () => {
  // Twenty stops round. "rider" is listed at the window's last two stops, or
  // one stop short of them, at the declaration; "behind" dwells a stop short.
  // Fifteen seconds on, "rider" reads at the edge of what a misread at each
  // end allows (reach 2, and two): B+8, and withholds; one further, it does not.
  const declared = { declaredAt: now };
  const after = (seconds: number) => new Date(Date.parse(now) + seconds * 1_000).toISOString();
  for (const boardingStopSequence of [10, 18]) {
    const aboard = { stops: ring(20), boardingStopSequence };
    const past = (stops: number) => ((boardingStopSequence + stops - 1) % 20) + 1;
    const first = matchVehicle(onBoard([bus("rider", past(3)), bus("rider", past(4)), bus("behind", past(-1))], { ...aboard, ...declared }));
    assert.notEqual(first.status, "matched", `boarding at ${boardingStopSequence}`);
    const look = (rider: number) => matchVehicle(onBoard(
      [bus("rider", past(rider), { observedAt: after(15) }), bus("behind", past(1), { observedAt: after(15) })],
      { ...aboard, ...declared, now: after(15), passage: first.passage },
    ));
    assertWithheld(look(7), "vehicle_left_on_board_window_during_session", `boarding at ${boardingStopSequence}: B+7`);
    assertWithheld(look(8), "vehicle_left_on_board_window_during_session", `boarding at ${boardingStopSequence}: B+8`);
    assertSelected(look(9), "behind", `boarding at ${boardingStopSequence}: B+9`);
  }
});

test("waiting round a loop, a sighting is kept before what the time allows, whatever else the same poll shows (R48)", () => {
  // Boarding at 5 on the eleven-stop loop. Sixty seconds after the rider began
  // waiting, "far" reads a stop back (8 to 7: what the time allows) while
  // "fresh" is seen for the first time two past the stop, where it could have
  // been at the stop since: a sighting, kept first.
  const loop = { stops: loopStops, boardingStopSequence: 5 };
  const earlier = secondsAgo(60);
  const first = matchVehicle(request(
    [bus("lead", 3, { observedAt: earlier }), bus("far", 8, { observedAt: earlier })],
    { ...loop, now: earlier, declaredAt: earlier },
  ));
  const later = matchVehicle(request([bus("lead", 4), bus("far", 7), bus("fresh", 7)], { ...loop, passage: first.passage, declaredAt: earlier }));
  assert.equal(later.passage?.withheld?.reason, "vehicle_first_seen_past_boarding_stop");

  // A remembered row that shows a crossing memory lacks is a sighting too:
  // "gone" was two out, and its row in the evidence window is three past.
  const seen = matchVehicle(request([bus("gone", 3, { observedAt: earlier }), bus("far", 8, { observedAt: earlier })], { ...loop, now: earlier }));
  const remembered = matchVehicle(request([bus("far", 7)], { ...loop, passage: seen.passage, recentlySeen: [bus("gone", 8)] }));
  assert.equal(remembered.passage?.withheld?.reason, "boarding_stop_reached_during_session");
});

test("waiting round a loop, a remembered row a stop behind memory is what the time allows, not a sighting (R43)", () => {
  // Boarding at 5 on the eleven-stop loop. "twice" is listed at 3 and 2 at
  // once; memory keeps 3, the place nearer the stop. It then drops out, and
  // the evidence window kept its row at 2. Against memory its distance to the
  // stop grew by one: a stop read back, or all the way round.
  const loop = { stops: loopStops, boardingStopSequence: 5 };
  const first = matchVehicle(request([bus("twice", 3), bus("twice", 2)], loop));
  assert.equal(first.passage?.offsets.twice?.last, -2);
  const later = matchVehicle(request([bus("other", 9)], { ...loop, passage: first.passage, recentlySeen: [bus("twice", 2)] }));
  assert.equal(later.passage?.withheld?.reason, "vehicle_may_have_reached_boarding_stop_unobserved");
});

test("a loop with a very long sequence span never throws, however long a bus has been out of sight (R25)", () => {
  // A stop list whose lap spans 400,000 sequences. A bus out of sight with no
  // bound on the time since is walked round the whole lap.
  const sparse: StopOnRoute[] = [
    { stopId: "SYN-SPARSE-A", name: "Synthetic sparse A", sequence: 1 },
    { stopId: "SYN-SPARSE-B", name: "Synthetic sparse B", sequence: 2 },
    { stopId: "SYN-SPARSE-A", name: "Synthetic sparse A", sequence: 400_001 },
  ];
  for (const lastSeenAt of [undefined, new Date(Date.parse(now) + 60_000).toISOString()]) {
    const passage = { offsets: { gone: { min: -1, max: -1, last: -1, ...(lastSeenAt ? { lastSeenAt } : {}) } }, initial: ["gone"] };
    const result = matchVehicle(request([bus("x", 1)], { stops: sparse, boardingStopSequence: 2, passage }));
    assert.notEqual(result.status, "matched", `lastSeenAt ${lastSeenAt}`);
  }
});

test("loop: the lap is measured in sequences, so a missing or repeated stop row cannot move the seam (F18)", () => {
  // Boarding at 11. A bus at 1 has wrapped: one stop past the rider, blocking.
  const input = request([bus("leader", 9), bus("wrapped", 1)], { stops: loopStops, boardingStopSequence: 11 });
  const variants: Array<[string, StopOnRoute[]]> = [
    ["a repeated row", [...loopStops.slice(0, 5), loopStops[4]!, ...loopStops.slice(5)]],
    ["a missing row", loopStops.filter((stop) => stop.sequence !== 5)],
  ];
  for (const [label, variant] of variants) {
    const result = matchVehicle({ ...input, stops: variant });
    assertWithheld(result, "vehicle_at_boarding_stop_unresolved", label);
    assert.equal(candidateIn(result, "wrapped").zone, "boarding_stop_unresolved", label);
  }
  // With the stop at 5 missing, a bus at 2 is still two stops past the rider,
  // not one: counting rows would put it on the unresolved side of the stop.
  const missing = loopStops.filter((stop) => stop.sequence !== 5);
  for (const variant of [loopStops, missing]) {
    assertSelected(
      matchVehicle(request([bus("leader", 9), bus("gone", 2)], { stops: variant, boardingStopSequence: 11 })),
      "leader",
      `${variant.length} rows`,
    );
  }
  // Two different stops under one sequence: nothing about positions holds.
  const conflicting = [...loopStops, { stopId: "SYN-ELSEWHERE", name: "Synthetic elsewhere", sequence: 5 }];
  assertWithheld(matchVehicle({ ...input, candidates: [bus("leader", 9)], stops: conflicting }), "route_stop_sequences_conflict");
});

test("a vehicle also reported under another route is a second position, in either order (F19)", () => {
  const right = bus("twin", BOARDING - 2);
  const wrong = bus("twin", BOARDING, { routeId: "route-other" });
  for (const candidates of [[wrong, right], [right, wrong]]) {
    const result = matchVehicle(request(candidates));
    assert.equal(result.status, "ambiguous");
    assert.deepEqual(result.abstentionReasons, ["vehicle_reported_at_two_positions"]);
  }
  // The invariant judges the rows of the request's route, whatever else shares the id.
  assert.doesNotThrow(() => assertDirectedInvariant(
    { routeId: ROUTE, boardingStopSequence: BOARDING, candidates: [wrong, right] },
    { status: "matched", selectedVehicleId: "twin" },
  ));
  assertViolation(() => assertDirectedInvariant(
    { routeId: ROUTE, boardingStopSequence: BOARDING, candidates: [wrong, right, bus("twin", BOARDING + 2)] },
    { status: "matched", selectedVehicleId: "twin" },
  ), "every row of the selected vehicle on the route is checked");
});

/* ---------------------------------------- evidence the decision must weigh */

test("one vehicle reported at two positions in one snapshot withholds selection", () => {
  const result = matchVehicle(request([bus("twin", BOARDING - 2), bus("twin", BOARDING - 3)]));
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.abstentionReasons, ["vehicle_reported_at_two_positions"]);
  // A row repeated verbatim is one position, not two.
  assertSelected(
    matchVehicle(request([bus("twin", BOARDING - 2), bus("twin", BOARDING - 2)])),
    "twin",
    "control: an exact duplicate row",
  );
});

test("a bus of another route never blocks, competes or counts from memory", () => {
  const other = { routeId: "route-202" };
  const result = matchVehicle(request([
    bus("leader", BOARDING - 3),
    bus("other-at-stop", BOARDING, other),
    bus("other-just-past", BOARDING + 1, other),
    bus("other-ahead", BOARDING - 1, other),
    bus("other-unplaced", undefined, other),
  ], {
    recentlySeen: [{ ...tago("other-remembered", BOARDING, 20), ...other }],
  }));
  assertSelected(result, "leader");
  for (const vehicleId of ["other-at-stop", "other-just-past", "other-ahead", "other-unplaced"]) {
    assert.ok(candidateIn(result, vehicleId).rejectedReasons.includes("wrong_route"), vehicleId);
  }
});

test("a wrong-direction bus is never selected, even alone", () => {
  const input = request([bus("opposite", BOARDING - 2, { directionCode: "2" })]);
  const result = matchVehicle(input);
  assert.equal(result.status, "unavailable");
  assert.deepEqual(candidateIn(result, "opposite").rejectedReasons, ["wrong_direction"]);
  // Control: when the session asked for no direction, the same bus is selected.
  assertSelected(matchVehicle({ ...input, directionCode: undefined }), "opposite");
});

test("a wrong-direction report inside the approach window still competes", () => {
  // A report beside the rider's stop that contradicts the requested direction
  // is conflicting evidence about that stretch of route. It can only lower
  // certainty, never raise it.
  const result = matchVehicle(request([
    bus("leader", BOARDING - 3),
    bus("contradictory", BOARDING - 1, { directionCode: "2" }),
  ]));
  assertWithheld(result, "leading_vehicle_not_selectable");
});

test("a provider timestamp counts as current up to 90 seconds old", () => {
  assertSelected(matchVehicle(request([bus("recent", BOARDING - 2, { observedAt: secondsAgo(90) })])), "recent");
  const old = matchVehicle(request([bus("old", BOARDING - 2, { observedAt: secondsAgo(91) })]));
  assert.equal(old.status, "unavailable");
  assert.deepEqual(candidateIn(old, "old").rejectedReasons, ["stale_or_invalid_timestamp"]);
});

test("a TAGO bus is selectable only on a fresh server-observed cadence", () => {
  for (const state of ["aging", "stale", "unknown"] as const) {
    const result = matchVehicleWithSourceFreshness(
      request([tago("tago", BOARDING - 2)]),
      new Map([["tago", cadence(state)]]),
    );
    assert.equal(result.status, "unavailable", state);
    assert.deepEqual(candidateIn(result, "tago").rejectedReasons, ["source_cadence_not_fresh"], state);
  }
  assertSelected(
    matchVehicleWithSourceFreshness(request([tago("tago", BOARDING - 2)]), new Map([["tago", cadence("fresh")]])),
    "tago",
  );
});

/* -------------------------------------------------- determinism and output */

/** Every ordering of `items`: 24 for four. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

test("identical input gives an identical result and leaves the input untouched", () => {
  const input = request([
    bus("leader", BOARDING - 1),
    bus("follower", BOARDING - 4),
    bus("gone", BOARDING + 3),
    bus("other-route", BOARDING, { routeId: "route-202" }),
  ], { recentlySeen: [tago("dropped", BOARDING - 8, 20)] });
  const before = structuredClone(input);
  const first = matchVehicle(input);
  assertSelected(first, "leader");
  assert.deepEqual(matchVehicle(input), first);
  assert.deepEqual(input, before);
});

test("candidate order does not change the decision", () => {
  const selecting = [
    bus("leader", BOARDING - 1),
    bus("follower", BOARDING - 4),
    bus("gone", BOARDING + 3),
    bus("other-route", BOARDING, { routeId: "route-202" }),
  ];
  const tied = [bus("bus-a", BOARDING - 2), bus("bus-b", BOARDING - 2), bus("bus-c", BOARDING - 4)];
  assertSelected(matchVehicle(request(selecting)), "leader");
  assertWithheld(matchVehicle(request(tied)), "leading_vehicle_not_selectable");
  for (const candidates of [selecting, tied]) {
    const reference = matchVehicle(request(candidates));
    for (const order of permutations(candidates)) {
      const result = matchVehicle(request(order));
      const label = order.map((candidate) => candidate.vehicleId).join(",");
      assert.equal(result.status, reference.status, label);
      assert.equal(result.selectedVehicleId, reference.selectedVehicleId, label);
      assert.deepEqual(result.abstentionReasons, reference.abstentionReasons, label);
      assert.deepEqual(result.ranked, reference.ranked, label);
    }
  }
});

test("every result names the directed policy, the rider state and each candidate's zone", () => {
  assert.equal(MATCHER_POLICY_VERSION, "directed-route-progress-v1");
  const results = [
    matchVehicle(request([bus("leader", BOARDING - 2)])),
    matchVehicle(request([bus("bus-a", BOARDING - 2), bus("bus-b", BOARDING - 2)])),
    matchVehicle(request([bus("gone", BOARDING + 2)])),
  ];
  assert.deepEqual(results.map((result) => result.status), ["matched", "ambiguous", "unavailable"]);
  for (const result of results) {
    assert.equal(result.policyVersion, MATCHER_POLICY_VERSION);
    assert.equal(result.riderState, "waiting_at_stop");
    assert.ok(Array.isArray(result.abstentionReasons));
    for (const candidate of result.ranked) {
      assert.equal(typeof candidate.stopOffset, "number", candidate.vehicleId);
      assert.equal(typeof candidate.zone, "string", candidate.vehicleId);
    }
  }
});

/* --------------------------------------------------------------- invariant */

function assertViolation(check: () => void, message: string): void {
  assert.throws(
    check,
    (error: unknown) => error instanceof MatcherInvariantError && error.code === "MATCHER_INVARIANT_VIOLATION",
    message,
  );
}

test("the invariant throws for a waiting-rider selection at or past the stop, or beyond the window", () => {
  for (const offset of [0, 1, 2, -5]) {
    assertViolation(
      () => assertDirectedInvariant(
        { boardingStopSequence: BOARDING, candidates: [bus("picked", BOARDING + offset)] },
        { status: "matched", selectedVehicleId: "picked" },
      ),
      `offset ${signed(offset)}`,
    );
  }
  for (const offset of [-1, -4]) {
    assert.doesNotThrow(() => assertDirectedInvariant(
      { boardingStopSequence: BOARDING, candidates: [bus("picked", BOARDING + offset)] },
      { status: "matched", selectedVehicleId: "picked" },
    ), `offset ${signed(offset)}`);
  }
});

test("the invariant throws for an on-board selection outside one to four stops past the stop", () => {
  for (const offset of [-1, 0, 5]) {
    assertViolation(
      () => assertDirectedInvariant(
        { boardingStopSequence: BOARDING, riderState: "on_board", candidates: [bus("picked", BOARDING + offset)] },
        { status: "matched", selectedVehicleId: "picked" },
      ),
      `offset ${signed(offset)}`,
    );
  }
  for (const offset of [1, 4]) {
    assert.doesNotThrow(() => assertDirectedInvariant(
      { boardingStopSequence: BOARDING, riderState: "on_board", candidates: [bus("picked", BOARDING + offset)] },
      { status: "matched", selectedVehicleId: "picked" },
    ), `offset ${signed(offset)}`);
  }
});

test("the invariant throws for a withheld result that carries a selection", () => {
  const input = { boardingStopSequence: BOARDING, candidates: [bus("picked", BOARDING - 2)] };
  for (const status of ["ambiguous", "unavailable"] as const) {
    assertViolation(() => assertDirectedInvariant(input, { status, selectedVehicleId: "picked" }), status);
    assert.doesNotThrow(() => assertDirectedInvariant(input, { status }), status);
  }
});

test("the invariant throws for a selection it cannot place on the route", () => {
  assertViolation(
    () => assertDirectedInvariant({ boardingStopSequence: BOARDING, candidates: [] }, {
      status: "matched",
      selectedVehicleId: "absent",
    }),
    "absent from the snapshot",
  );
  assertViolation(
    () => assertDirectedInvariant({ boardingStopSequence: BOARDING, candidates: [bus("unplaced", undefined)] }, {
      status: "matched",
      selectedVehicleId: "unplaced",
    }),
    "no stop sequence",
  );
});

/* -------------------------------------------------------- legacy isolation */

const serviceRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * Modules that replay the legacy policy on purpose, to compare it with the
 * current one. They may import `matchingLegacy.ts`, and the scan below fails
 * if anything in `src/` or `api/` imports them in turn, so they stay reachable
 * only from offline scripts. The release gate checks the same from the
 * serving entry points (`scripts/matcher-evidence/gate.ts`, SH-1).
 */
const LEGACY_COMPARISON_MODULES = new Set([
  // The old-versus-new migration over the same passive evidence. Only the
  // offline `scripts/passive-shadow/migrate.ts` calls it.
  "src/passiveShadowMigration",
]);

/** Relative module specifiers a source imports or re-exports, statically or dynamically. */
function relativeImports(source: string): string[] {
  const pattern = /\bfrom\s*["'`]([^"'`]+)["'`]|\bimport\s*\(?\s*["'`]([^"'`]+)["'`]|\brequire\s*\(\s*["'`]([^"'`]+)["'`]/g;
  return [...source.matchAll(pattern)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((specifier) => specifier.startsWith("."));
}

/** A module by its path from the service root, without extension, so `./x`, `./x.ts` and `./x.js` agree. */
function moduleKey(path: string): string {
  return relative(serviceRoot, path).replaceAll("\\", "/").replace(/\.(?:d\.)?[cm]?[jt]sx?$/, "");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(join(serviceRoot, directory), { recursive: true, encoding: "utf8" })
    .filter((path) => /\.[cm]?[jt]sx?$/.test(path))
    .map((path) => join(serviceRoot, directory, path));
}

test("decide() asserts the directed invariant on the result it returns, on every path", () => {
  // Behaviourally invisible while the rules hold, so only the source can show
  // it: one return in decide(), immediately after the assertion on that result.
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/matching.ts"), "utf8");
  const start = source.indexOf("function decide(");
  assert.ok(start >= 0, "decide() exists");
  const end = source.indexOf("\n}\n", start);
  const body = source.slice(start, end);
  assert.match(body, /assertDirectedInvariant\(request, result, policy\);\s*return result;\s*$/);
  assert.equal(body.match(/\breturn\b/g)?.length, 1, "decide() has exactly one return");
});

test("no serving module reaches the legacy matcher; its one offline comparison module is imported by nothing in src/ or api/", () => {
  const imports = new Map([...sourceFiles("src"), ...sourceFiles("api")].map((file) => [
    moduleKey(file),
    relativeImports(readFileSync(file, "utf8")).map((specifier) => moduleKey(resolve(dirname(file), specifier))),
  ]));
  // An empty or unresolved graph would pass vacuously, so prove the scan works.
  assert.ok(imports.has("src/matchingLegacy"), "the legacy module is in the scanned tree");
  assert.ok(imports.get("src/journeySession")?.includes("src/matching"), "real imports resolve");
  assert.ok(imports.get("api/health")?.includes("src/apiRuntime"), "Vercel handlers are scanned");
  assert.deepEqual(
    relativeImports([
      'import { matchVehicleLegacySymmetricV0 } from "./matchingLegacy.ts";',
      'import type { MatchResult } from "./matchingLegacy.ts";',
      'export * from "./matchingLegacy.ts";',
      'const legacy = await import("./matchingLegacy.ts");',
    ].join("\n")),
    Array(4).fill("./matchingLegacy.ts"),
    "every import form is detected",
  );

  // Everything that reaches the legacy module, directly or transitively.
  const reaches = new Set(["src/matchingLegacy"]);
  let grew: boolean;
  do {
    grew = false;
    for (const [importer, targets] of imports) {
      if (reaches.has(importer) || !targets.some((target) => reaches.has(target))) continue;
      reaches.add(importer);
      grew = true;
    }
  } while (grew);
  reaches.delete("src/matchingLegacy");
  assert.deepEqual([...reaches].filter((importer) => !LEGACY_COMPARISON_MODULES.has(importer)).sort(), []);
});
