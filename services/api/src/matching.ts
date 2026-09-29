/**
 * Vehicle matching under the `directed-route-progress-v1` policy.
 *
 * The previous policy scored the boarding position as `20 − 5·|seq − S|`. That
 * term is symmetric: a bus two stops *past* the rider's stop scored exactly like
 * one two stops *before* it. Replayed blind over real passive observations,
 * it committed to buses that had already left the rider's stop 268 times
 * (Passive Shadow v3, finding F1). This module replaces the symmetric term with
 * directed route progress. The old policy survives only in
 * `matchingLegacy.ts`, for comparison.
 *
 * ## The safety contract
 *
 * **Before evidence establishes that the rider is aboard, no automatically
 * selected vehicle may be at or past the boarding stop in route order.**
 * `assertDirectedInvariant` checks that on every result before it is returned;
 * a violation throws rather than reaching a rider.
 *
 * ## Why the boarding stop itself is not selectable
 *
 * TAGO's `nodeord` is not documented as "last stop passed" or "next stop", nor
 * whether it changes when a bus arrives or when it leaves. Under the four
 * readings, a bus dwelling at the boarding stop S reports S − 1, S, or S + 1,
 * and a bus reporting S may already have left. So:
 *
 * | Stops past S (`offset`) | Waiting rider | Why |
 * |---|---|---|
 * | ≤ −5 | not selectable, not competing | beyond the approach window |
 * | −4 … −1 | **selectable** when fresh | before S under every reading (at worst dwelling at S, which the rider boards) |
 * | 0, +1 | not selectable, **blocks every selection** | may be dwelling at S, may have left; unknowable |
 * | ≥ +2 | not selectable, not competing | has left S under every reading |
 *
 * A rider on board mirrors it: `+1 … +4` selectable, `−1` and `0` block, and
 * the vehicle must be the only one of the route anywhere in that window.
 *
 * ## What else fails closed
 *
 * - A candidate without a usable stop sequence: route progress is unknown, so
 *   it cannot be selected and it blocks (coordinates alone cannot say which
 *   side of the stop a bus is on).
 * - A candidate that is not `fresh` cannot be selected — and it still competes.
 *   A leading bus stuck at a light does not stop being the first to arrive.
 * - A vehicle absent from this snapshot but seen inside the evidence window
 *   (`recentlySeen`) cannot be selected and still competes. Losing a row is not
 *   evidence the bus is gone; otherwise dropping evidence would *raise*
 *   certainty.
 * - Only the leading approaching vehicle can be selected, and only when every
 *   other vehicle heading for the stop is at least three stops further back
 *   (`marginStops`), wherever it is: the approach window bounds what may be
 *   selected, not which buses may overtake the leader (finding F9).
 * - Without the route's stops, or when the boarding stop appears twice on the
 *   route, automatic selection is withheld.
 * - Session memory (`PassageMemory`, finding F4): once any bus has been seen at
 *   the boarding stop, or seen crossing it (in this poll or only remembered,
 *   F10), during a waiting session, the rider may be aboard it, and no other
 *   bus is ever selected automatically in that session. Without this, the bus
 *   behind the one the rider boarded becomes the "leading approaching vehicle"
 *   the moment the first one leaves. The same holds when the session's first
 *   look comes late and a bus now past the stop could have been at it (F12).
 *   The on-board rule mirrors it: a bus that reached the stop after the rider
 *   said they had boarded is not theirs, and a bus leaving the on-board window
 *   withholds selection for good.
 *
 * There is no "best available guess". A numerical score never overrides a
 * violated rule: rules are applied first, and the score only orders what the
 * rules already allow.
 */

import type {
  MatchRequest,
  MatchResult,
  PassageMemory,
  RankedCandidate,
  RiderState,
  StopOnRoute,
  VehicleObservation,
} from "./domain.ts";
import type { SourceFreshnessEvidence } from "./sourceFreshness.ts";

export const MATCHER_POLICY_VERSION = "directed-route-progress-v1";

export interface DirectedMatcherPolicy {
  /**
   * Stops before the boarding stop in which a waiting rider's bus may be
   * selected. Kept at the reach of the legacy ±4 plausibility bound, so the
   * change removes the departed half of that range and adds nothing.
   */
  approachWindowStops: number;
  /** Stops past the boarding stop in which an on-board rider's bus may be selected. Same reach. */
  onBoardWindowStops: number;
  /**
   * Stops of lead a waiting rider's selected vehicle needs over every other
   * vehicle heading for the stop, measured in route order and not limited to
   * the approach window; two stops is withheld. The legacy policy expressed
   * the same three stops as 12 position points, which stopped counting at the
   * window edge: a leader four stops out was "clear" of a bus one stop behind
   * it (finding F9).
   */
  marginStops: number;
  /** Oldest provider-timestamped observation that may count as current. Unchanged. */
  maxProviderObservationAgeSeconds: number;
  /**
   * How long a vehicle absent from the feed is remembered. Equal to the cadence
   * evidence window, because that is the history a session keeps.
   */
  memoryWindowSeconds: number;
  /**
   * The fastest a vehicle is assumed to progress while nobody can see it: one
   * stop per this many seconds, plus the one stop it may have been about to
   * reach. Deliberately faster than the 30 s per stop that the passive
   * generator's widest accepted crossing (3 stops in 90 s) implies, so memory
   * errs toward "it may already be here". `INFERRED`, conservative.
   */
  rememberedSecondsPerStop: number;
}

export const DIRECTED_MATCHER_POLICY_V1: DirectedMatcherPolicy = {
  approachWindowStops: 4,
  onBoardWindowStops: 4,
  marginStops: 3,
  maxProviderObservationAgeSeconds: 90,
  memoryWindowSeconds: 90,
  rememberedSecondsPerStop: 15,
};

/** Where a candidate sits relative to the boarding stop, for one rider state. */
export type RouteProgressZone =
  /** Waiting rider: 1–4 stops before the stop. The only zone a waiting rider's bus is selected from. */
  | "approaching"
  /** On-board rider: 1–4 stops past the stop. The only zone an on-board rider's bus is selected from. */
  | "departed_within_on_board_window"
  /** At the stop or one stop either side of the reading boundary: dwell and departure cannot be told apart. Blocks. */
  | "boarding_stop_unresolved"
  /** Waiting rider: two or more stops past the stop. Has left under every reading. */
  | "departed"
  /** On-board rider: two or more stops before the stop. Cannot be the bus the rider just boarded. */
  | "not_yet_at_boarding_stop"
  /** Further from the stop than the window. */
  | "beyond_window"
  /** Only a loop's seam can place a vehicle here: it may reach the stop by wrapping, so it competes, but it is never selected. */
  | "approaching_across_loop_seam"
  /** No usable stop sequence. Blocks. */
  | "route_progress_unknown";

export type MatcherFunction = (
  request: MatchRequest,
  trustedFreshness: ReadonlyMap<string, SourceFreshnessEvidence>,
) => MatchResult;

export class MatcherInvariantError extends Error {
  readonly code = "MATCHER_INVARIANT_VIOLATION";
}

/**
 * Stateless ranking with no trusted cadence. A TAGO candidate can never be
 * selected here, because nothing has watched it move.
 */
export function matchVehicle(request: MatchRequest): MatchResult {
  return decide(request, new Map(), DIRECTED_MATCHER_POLICY_V1);
}

export function matchVehicleWithSourceFreshness(
  request: MatchRequest,
  trustedFreshness: ReadonlyMap<string, SourceFreshnessEvidence>,
): MatchResult {
  return decide(request, trustedFreshness, DIRECTED_MATCHER_POLICY_V1);
}

/** For tests and replays that need to vary a policy number deliberately. */
export function matchVehicleWithPolicy(
  request: MatchRequest,
  trustedFreshness: ReadonlyMap<string, SourceFreshnessEvidence>,
  policy: DirectedMatcherPolicy,
): MatchResult {
  return decide(request, trustedFreshness, policy);
}

/* ------------------------------------------------------------- topology */

export interface RouteTopologyFacts {
  /** Every stop sequence the route actually has. A position outside it is not a position. */
  sequences: ReadonlySet<number>;
  /** A loop closes on its first stop: the last stop is the first stop again. */
  loop: boolean;
  /** Stops in one lap of a loop; the stop count on a straight route. */
  cycleLength: number;
  boardingStopFound: boolean;
  /** The boarding stop's id or name occurs more than once on the route. */
  boardingStopRepeats: boolean;
}

export function routeTopologyFacts(stops: StopOnRoute[], boardingStopSequence: number): RouteTopologyFacts {
  const ordered = [...stops].sort((left, right) => left.sequence - right.sequence);
  const first = ordered[0];
  const last = ordered.at(-1);
  const loop = ordered.length >= 3 && first !== undefined && last !== undefined && first.stopId === last.stopId;
  const boarding = ordered.find((stop) => stop.sequence === boardingStopSequence);
  // On a loop the closing stop legitimately repeats the first. Anything else
  // repeating is a route that passes the same place twice.
  const lap = loop ? ordered.slice(0, -1) : ordered;
  const boardingStopRepeats = boarding !== undefined && lap.filter(
    (stop) => stop.stopId === boarding.stopId || normalizedName(stop.name) === normalizedName(boarding.name),
  ).length > 1;
  return {
    sequences: new Set(ordered.map((stop) => stop.sequence)),
    loop,
    cycleLength: Math.max(1, lap.length),
    boardingStopFound: boarding !== undefined,
    boardingStopRepeats,
  };
}

function normalizedName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

/* ------------------------------------------------------------ positions */

interface PositionFacts {
  zone: RouteProgressZone;
  offset?: number;
  /** Stops still to travel before reaching the boarding stop, when that is finite. */
  forward?: number;
  /** Stops travelled since leaving the boarding stop, when that is finite. */
  backward?: number;
  selectable: boolean;
  blocks: boolean;
  competes: boolean;
}

/**
 * Pure: where one stop sequence sits relative to the boarding stop.
 *
 * On a straight route the distances are the plain difference. On a loop a
 * position is both some stops before the stop and some stops past it, so both
 * are computed modulo the lap and a vehicle is judged on whichever is shorter
 * for blocking and competing — but it is only ever *selected* on the plain,
 * seam-free reading, because a bus about to finish its lap may lay over or
 * leave service instead of wrapping round to the rider.
 */
export function classifyRouteProgress(
  stopSequence: number | undefined,
  boardingStopSequence: number,
  riderState: RiderState,
  topology: (Pick<RouteTopologyFacts, "loop" | "cycleLength"> & Partial<Pick<RouteTopologyFacts, "sequences">>) | undefined,
  policy: DirectedMatcherPolicy = DIRECTED_MATCHER_POLICY_V1,
): PositionFacts {
  if (stopSequence === undefined || !Number.isInteger(stopSequence)
    || (topology?.sequences !== undefined && !topology.sequences.has(stopSequence))) {
    // No stop sequence, or one the route does not have: either way nothing
    // says which side of the boarding stop this vehicle is on.
    return { zone: "route_progress_unknown", selectable: false, blocks: true, competes: false };
  }
  const offset = stopSequence - boardingStopSequence;
  let forward: number | undefined;
  let backward: number | undefined;
  if (topology?.loop) {
    const lap = topology.cycleLength;
    forward = mod(boardingStopSequence - stopSequence, lap);
    backward = mod(stopSequence - boardingStopSequence, lap);
  } else if (offset < 0) {
    forward = -offset;
  } else {
    backward = offset;
    if (offset === 0) forward = 0;
  }

  if (riderState === "on_board") {
    const window = policy.onBoardWindowStops;
    const blocks = backward === 0 || forward === 1;
    const competes = backward !== undefined && backward >= 1 && backward <= window;
    const selectable = offset >= 1 && offset <= window;
    if (blocks) return { zone: "boarding_stop_unresolved", offset, forward, backward, selectable: false, blocks: true, competes: false };
    if (selectable) return { zone: "departed_within_on_board_window", offset, forward, backward, selectable: true, blocks: false, competes: true };
    if (competes) return { zone: "departed_within_on_board_window", offset, forward, backward, selectable: false, blocks: false, competes: true };
    if (offset < 0) return { zone: "not_yet_at_boarding_stop", offset, forward, backward, selectable: false, blocks: false, competes: false };
    return { zone: "beyond_window", offset, forward, backward, selectable: false, blocks: false, competes: false };
  }

  const window = policy.approachWindowStops;
  const blocks = forward === 0 || backward === 1;
  const competes = forward !== undefined && forward >= 1 && forward <= window;
  const selectable = offset <= -1 && offset >= -window;
  if (blocks) return { zone: "boarding_stop_unresolved", offset, forward, backward, selectable: false, blocks: true, competes: false };
  if (selectable) return { zone: "approaching", offset, forward, backward, selectable: true, blocks: false, competes: true };
  if (competes) return { zone: "approaching_across_loop_seam", offset, forward, backward, selectable: false, blocks: false, competes: true };
  if (offset > 0) return { zone: "departed", offset, forward, backward, selectable: false, blocks: false, competes: false };
  return { zone: "beyond_window", offset, forward, backward, selectable: false, blocks: false, competes: false };
}

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** 20 at the boarding stop, 5 fewer per stop away — the legacy scale, applied to directed distance only. */
function positionScore(facts: PositionFacts, riderState: RiderState): number {
  if (riderState === "on_board") {
    return facts.backward === undefined ? 0 : Math.max(0, 25 - 5 * facts.backward);
  }
  return facts.forward === undefined ? 0 : Math.max(0, 20 - 5 * facts.forward);
}

/* ------------------------------------------------------------- decision */

interface Assessed {
  ranked: RankedCandidate;
  facts: PositionFacts;
  observation: VehicleObservation;
  rightRoute: boolean;
  /** No candidate-level rejection: route, direction, freshness and position all allow selection. */
  selectable: boolean;
  positionScore: number;
}

interface Remembered {
  vehicleId: string;
  facts: PositionFacts;
  positionScore: number;
  /** For a waiting rider: the fewest stops before the stop it may by now be, if it is heading for it. */
  closestForward?: number;
}

function decide(
  request: MatchRequest,
  trustedFreshness: ReadonlyMap<string, SourceFreshnessEvidence>,
  policy: DirectedMatcherPolicy,
): MatchResult {
  const riderState: RiderState = request.riderState === "on_board" ? "on_board" : "waiting_at_stop";
  const nowMs = new Date(request.now).valueOf();
  const abstentions = new Set<string>();

  let topology: RouteTopologyFacts | undefined;
  if (request.stops && request.stops.length > 0) {
    topology = routeTopologyFacts(request.stops, request.boardingStopSequence);
    if (!topology.boardingStopFound) abstentions.add("boarding_stop_not_on_route");
    if (topology.boardingStopRepeats) abstentions.add("boarding_stop_repeats_on_route");
  } else {
    abstentions.add("route_topology_unverified");
  }

  const current = new Set(request.candidates.map((candidate) => candidate.vehicleId));
  const assessed = request.candidates.map((candidate) =>
    assess(candidate, request, riderState, nowMs, trustedFreshness.get(candidate.vehicleId), topology, policy));
  const ranked = assessed
    .map((row) => row.ranked)
    .sort((left, right) => right.score - left.score || left.vehicleId.localeCompare(right.vehicleId));

  const remembered: Remembered[] = (request.recentlySeen ?? [])
    .filter((row) => row.routeId === request.routeId && !current.has(row.vehicleId))
    .map((row) => rememberedPosition(row, request, riderState, nowMs, topology, policy));

  const onRoute = assessed.filter((row) => row.rightRoute);
  if (onRoute.some((row) => row.facts.zone === "route_progress_unknown")
    || remembered.some((row) => row.facts.zone === "route_progress_unknown")) {
    abstentions.add("candidate_route_progress_unknown");
  }
  // One vehicle reported at two positions in the same snapshot is an identity
  // the provider itself is unsure of. Nothing about it can be trusted.
  // Only a conflict that touches the decision matters: a vehicle reported at
  // two positions that are both irrelevant to this rider cannot be their bus,
  // a competitor or a blocker, and dropping it must not change the answer.
  const positionsByVehicle = new Map<string, { positions: Set<string>; relevant: boolean }>();
  for (const row of onRoute) {
    const entry = positionsByVehicle.get(row.ranked.vehicleId) ?? { positions: new Set<string>(), relevant: false };
    entry.positions.add(String(row.observation.stopSequence));
    entry.relevant ||= row.facts.selectable || row.facts.competes || row.facts.blocks;
    positionsByVehicle.set(row.ranked.vehicleId, entry);
  }
  if ([...positionsByVehicle.values()].some((entry) => entry.positions.size > 1 && entry.relevant)) {
    abstentions.add("vehicle_reported_at_two_positions");
  }
  if (onRoute.some((row) => row.facts.zone === "boarding_stop_unresolved")
    || remembered.some((row) => row.facts.zone === "boarding_stop_unresolved")) {
    abstentions.add("vehicle_at_boarding_stop_unresolved");
  }

  const passage = rememberPassage(request, onRoute, riderState, policy);
  if (passage.memory.withheld) abstentions.add(passage.memory.withheld.reason);
  for (const row of onRoute) {
    const reason = passage.excluded.get(row.ranked.vehicleId);
    if (!reason) continue;
    row.selectable = false;
    row.facts = { ...row.facts, selectable: false, competes: false };
    if (!row.ranked.rejectedReasons.includes(reason)) row.ranked.rejectedReasons.push(reason);
  }

  const selectable = assessed.filter((row) => row.selectable);
  const leader = pickLeader(selectable, riderState);

  if (leader) {
    if (riderState === "on_board") {
      const competitors = [
        ...onRoute.filter((row) => row.ranked.vehicleId !== leader.ranked.vehicleId && row.facts.competes),
        ...remembered.filter((row) => row.facts.competes && !passage.excluded.has(row.vehicleId)),
      ];
      if (competitors.length > 0) abstentions.add("multiple_vehicles_in_on_board_window");
    } else {
      // Every other vehicle heading for the stop, current or remembered, fresh
      // or not, inside the approach window or behind it: the closest it is or
      // may by now be, in stops before the stop.
      const leaderForward = leader.facts.forward ?? Number.POSITIVE_INFINITY;
      const others = [
        ...onRoute
          .filter((row) => row.ranked.vehicleId !== leader.ranked.vehicleId && !passage.excluded.has(row.ranked.vehicleId))
          .map((row) => row.facts.forward),
        ...remembered.filter((row) => !passage.excluded.has(row.vehicleId)).map((row) => row.closestForward),
      ].filter((forward): forward is number => forward !== undefined && forward >= 1);
      if (others.some((forward) => forward <= leaderForward)) {
        abstentions.add("leading_vehicle_not_selectable");
      } else if (others.some((forward) => forward < leaderForward + policy.marginStops)) {
        abstentions.add("candidates_too_close");
      }
    }
  }

  const abstentionReasons = [...abstentions].sort();
  const base = { ranked, policyVersion: MATCHER_POLICY_VERSION, riderState, abstentionReasons, passage: passage.memory };

  let result: MatchResult;
  if (!leader) {
    result = {
      ...base,
      status: "unavailable",
      confidence: "unknown",
      explanation: riderState === "on_board"
        ? "No fresh vehicle of this route has just left the boarding stop."
        : "No fresh vehicle of this route is approaching the boarding stop.",
    };
  } else if (abstentionReasons.length > 0) {
    result = {
      ...base,
      status: "ambiguous",
      confidence: "low",
      explanation: `Automatic selection is withheld: ${abstentionReasons.join(", ")}.`,
    };
  } else {
    result = {
      ...base,
      status: "matched",
      confidence: leader.ranked.score >= 75 ? "high" : "medium",
      selectedVehicleId: leader.ranked.vehicleId,
      explanation: riderState === "on_board"
        ? "The only fresh vehicle of this route that has just left the boarding stop."
        : "The leading fresh vehicle approaching the boarding stop, with a sufficient lead over every other.",
    };
  }
  assertDirectedInvariant(request, result, policy);
  return result;
}

/**
 * Fold this snapshot into the session's memory, and say what the memory now
 * forbids.
 *
 * Waiting rider: a bus seen at the boarding stop, or seen before it and now at
 * or past it, may be the bus the rider boarded. So may a bus that dropped out
 * of the feed while it could have reached the stop and was never seen again
 * inside the memory window. From then on no other bus can be selected
 * automatically: the rider may already be riding. Legacy matching got such
 * cases "right" only by committing to a bus sitting at the stop.
 *
 * On-board rider: the rider said they were aboard when the session began, so
 * only a vehicle in that first snapshot can be theirs; a bus seen two or more
 * stops before the boarding stop reached it after they boarded; and a bus seen
 * inside the on-board window and later beyond it may be the rider's bus
 * leaving the window, so selection is withheld for the rest of the session.
 */
function rememberPassage(
  request: MatchRequest,
  onRoute: Assessed[],
  riderState: RiderState,
  policy: DirectedMatcherPolicy,
): { memory: PassageMemory; excluded: Map<string, string> } {
  const prior = request.passage;
  const seenBefore = prior?.offsets ?? {};
  const offsets = new Map(Object.entries(seenBefore).map(([vehicleId, range]) => [vehicleId, { ...range }]));
  let withheld = prior?.withheld;
  const withhold = (reason: string) => { if (!withheld) withheld = { reason, at: request.now }; };
  const initial = prior?.initial ?? [...new Set(onRoute.map((row) => row.ranked.vehicleId))].sort();
  const excluded = new Map<string, string>();

  for (const row of onRoute) {
    const offset = row.facts.offset;
    const vehicleId = row.ranked.vehicleId;
    if (riderState === "on_board" && !initial.includes(vehicleId)) excluded.set(vehicleId, "not_present_when_rider_boarded");
    if (offset === undefined) continue;
    const seen = seenBefore[vehicleId];
    if (riderState === "waiting_at_stop") {
      if (row.facts.zone === "boarding_stop_unresolved" || (seen !== undefined && seen.min <= -1 && offset >= 0)) {
        withhold("boarding_stop_reached_during_session");
      }
    } else {
      if (offset <= -2 || (seen !== undefined && seen.min <= -2)) {
        excluded.set(vehicleId, excluded.get(vehicleId) ?? "reached_boarding_stop_after_rider_boarded");
      }
      const window = policy.onBoardWindowStops;
      if (seen !== undefined && seen.max >= -1 && seen.max <= window && offset > window) {
        withhold("vehicle_left_on_board_window_during_session");
      }
    }
    const range = offsets.get(vehicleId);
    offsets.set(vehicleId, {
      min: range ? Math.min(range.min, offset) : offset,
      max: range ? Math.max(range.max, offset) : offset,
      last: offset,
      lastSeenAt: request.now,
    });
  }

  // A vehicle missing from this poll but still remembered is judged on its
  // last sighting against the same memory: dropping the row that shows a
  // crossing (or a departure from the on-board window) must not forget it.
  const current = new Set(onRoute.map((row) => row.ranked.vehicleId));
  for (const row of request.recentlySeen ?? []) {
    if (row.routeId !== request.routeId || current.has(row.vehicleId) || row.stopSequence === undefined) continue;
    const seen = seenBefore[row.vehicleId];
    if (seen === undefined) continue;
    const offset = row.stopSequence - request.boardingStopSequence;
    if (riderState === "waiting_at_stop") {
      if (seen.min <= -1 && offset >= 0) withhold("boarding_stop_reached_during_session");
    } else if (seen.max >= -1 && seen.max <= policy.onBoardWindowStops && offset > policy.onBoardWindowStops) {
      withhold("vehicle_left_on_board_window_during_session");
    }
  }

  if (riderState === "waiting_at_stop" && prior === undefined && request.declaredAt !== undefined) {
    // The session's first decision, made some time after the rider said they
    // were waiting (the first poll failed, or was slow). Whatever crossed the
    // stop in between was never observed: a bus now past the stop that could
    // have been at it when the rider began waiting may be the one they
    // boarded. Past the memory window, not even that can be bounded.
    const gapSeconds = (Date.parse(request.now) - Date.parse(request.declaredAt)) / 1_000;
    if (Number.isFinite(gapSeconds) && gapSeconds > 0) {
      if (gapSeconds > policy.memoryWindowSeconds) withhold("session_first_observed_late");
      const reach = 1 + Math.floor(gapSeconds / policy.rememberedSecondsPerStop);
      for (const row of onRoute) {
        const past = row.facts.backward;
        if (past !== undefined && past >= 1 && past <= reach) {
          withhold("vehicle_may_have_reached_boarding_stop_before_first_observation");
        }
      }
    }
  }

  if (riderState === "waiting_at_stop") {
    // A vehicle neither in this snapshot nor still remembered has been out of
    // sight for longer than the memory window. If, in that time, it could have
    // reached the stop, the rider may have boarded it unobserved.
    const remembered = new Set((request.recentlySeen ?? []).map((row) => row.vehicleId));
    for (const [vehicleId, range] of Object.entries(seenBefore)) {
      if (current.has(vehicleId) || remembered.has(vehicleId) || range.last === undefined) continue;
      const reach = 1 + Math.floor(policy.memoryWindowSeconds / policy.rememberedSecondsPerStop);
      if (range.last <= 1 && range.last + reach >= 0) withhold("vehicle_may_have_reached_boarding_stop_unobserved");
    }
  }

  const memory: PassageMemory = {
    offsets: Object.fromEntries([...offsets].sort(([left], [right]) => left.localeCompare(right))),
    initial,
    ...(withheld ? { withheld } : {}),
  };
  return { memory, excluded };
}

/**
 * Where a vehicle absent from this snapshot may be now. Its last sighting is
 * a lower bound: it may have moved on by up to one stop plus one per
 * `rememberedSecondsPerStop` since. It blocks or competes if any of those
 * positions would, and it is never selectable.
 */
function rememberedPosition(
  row: VehicleObservation,
  request: MatchRequest,
  riderState: RiderState,
  nowMs: number,
  topology: RouteTopologyFacts | undefined,
  policy: DirectedMatcherPolicy,
): Remembered {
  const base = classifyRouteProgress(row.stopSequence, request.boardingStopSequence, riderState, topology, policy);
  if (row.stopSequence === undefined || base.zone === "route_progress_unknown") {
    return { vehicleId: row.vehicleId, facts: base, positionScore: 0 };
  }
  const seenAtMs = row.receivedAt ? Date.parse(row.receivedAt) : Number.NaN;
  const ageSeconds = Number.isFinite(seenAtMs) ? Math.max(0, (nowMs - seenAtMs) / 1_000) : policy.memoryWindowSeconds;
  const reach = 1 + Math.floor(Math.min(ageSeconds, policy.memoryWindowSeconds) / policy.rememberedSecondsPerStop);
  const sequences = topology ? [...topology.sequences].sort((left, right) => left - right) : undefined;
  const last = sequences?.at(-1) ?? row.stopSequence + reach;
  const possible: PositionFacts[] = [];
  for (let step = 0; step <= reach; step += 1) {
    let sequence = row.stopSequence + step;
    if (sequence > last) {
      if (!topology?.loop) break;
      sequence = ((sequence - 1) % topology.cycleLength) + 1;
    }
    possible.push(classifyRouteProgress(sequence, request.boardingStopSequence, riderState, topology, policy));
  }
  const blocks = possible.some((facts) => facts.blocks);
  const competing = possible.filter((facts) => facts.competes);
  const nearest = (facts: PositionFacts) => (riderState === "on_board" ? facts.backward : facts.forward) ?? Number.POSITIVE_INFINITY;
  const closest = [...competing].sort((left, right) => nearest(left) - nearest(right))[0];
  const facts: PositionFacts = {
    zone: blocks ? "boarding_stop_unresolved" : closest?.zone ?? base.zone,
    offset: base.offset,
    ...(closest?.forward === undefined ? (base.forward === undefined ? {} : { forward: base.forward }) : { forward: closest.forward }),
    ...(closest?.backward === undefined ? (base.backward === undefined ? {} : { backward: base.backward }) : { backward: closest.backward }),
    selectable: false,
    blocks,
    competes: competing.length > 0,
  };
  const score = Math.max(0, ...possible.filter((candidate) => candidate.competes).map((candidate) => positionScore(candidate, riderState)));
  const approaching = possible.map((candidate) => candidate.forward).filter((forward): forward is number => forward !== undefined && forward >= 1);
  return {
    vehicleId: row.vehicleId,
    facts,
    positionScore: score,
    ...(approaching.length > 0 ? { closestForward: Math.min(...approaching) } : {}),
  };
}

function pickLeader(selectable: Assessed[], riderState: RiderState): Assessed | undefined {
  // Waiting: the vehicle closest to the stop from behind. On board: the one
  // closest to the stop from ahead. Ties go to the vehicle id, so identical
  // input always gives an identical answer.
  return [...selectable].sort((left, right) => {
    const a = left.facts.offset ?? 0;
    const b = right.facts.offset ?? 0;
    const byPosition = riderState === "on_board" ? a - b : b - a;
    return byPosition || left.ranked.vehicleId.localeCompare(right.ranked.vehicleId);
  })[0];
}

function assess(
  candidate: VehicleObservation,
  request: MatchRequest,
  riderState: RiderState,
  nowMs: number,
  trustedFreshness: SourceFreshnessEvidence | undefined,
  topology: RouteTopologyFacts | undefined,
  policy: DirectedMatcherPolicy,
): Assessed {
  let score = 0;
  const evidence: string[] = [];
  const rejectedReasons: string[] = [];

  const rightRoute = candidate.routeId === request.routeId;
  if (!rightRoute) rejectedReasons.push("wrong_route");
  else {
    score += 30;
    evidence.push("route_id");
  }

  if (request.directionCode && candidate.directionCode !== request.directionCode) {
    rejectedReasons.push("wrong_direction");
  } else if (request.directionCode) {
    score += 25;
    evidence.push("direction");
  }

  if (candidate.timestampSource === "unavailable") {
    if (trustedFreshness === undefined) {
      rejectedReasons.push("stale_or_invalid_timestamp");
    } else if (trustedFreshness.state === "fresh") {
      score += 25;
      evidence.push("fresh_source_cadence");
    } else {
      rejectedReasons.push("source_cadence_not_fresh");
    }
  } else {
    const ageSeconds = (nowMs - new Date(candidate.observedAt).valueOf()) / 1_000;
    if (!Number.isFinite(ageSeconds) || ageSeconds < -10 || ageSeconds > policy.maxProviderObservationAgeSeconds) {
      rejectedReasons.push("stale_or_invalid_timestamp");
    } else {
      // A timestamp from the future (clock skew, tolerated up to 10 s) earns
      // no more than one from now.
      score += Math.max(0, 25 - Math.max(0, ageSeconds) / 6);
      evidence.push("fresh_observation");
    }
  }

  const facts = classifyRouteProgress(candidate.stopSequence, request.boardingStopSequence, riderState, topology, policy);
  const position = positionScore(facts, riderState);
  score += position;
  if (facts.offset !== undefined) evidence.push(`boarding_stop_offset_${facts.offset}`);
  evidence.push(`zone_${facts.zone}`);
  const positionReason = positionRejection(facts.zone);
  if (positionReason) rejectedReasons.push(positionReason);

  const ranked: RankedCandidate = {
    vehicleId: candidate.vehicleId,
    score: Math.round(score * 10) / 10,
    evidence,
    rejectedReasons,
    ...(facts.offset === undefined ? {} : { stopOffset: facts.offset }),
    zone: facts.zone,
  };
  return {
    ranked,
    facts,
    observation: candidate,
    rightRoute,
    selectable: rejectedReasons.length === 0 && facts.selectable,
    positionScore: position,
  };
}

function positionRejection(zone: RouteProgressZone): string | undefined {
  switch (zone) {
    case "approaching":
    case "departed_within_on_board_window":
      return undefined;
    case "departed":
      return "departed_boarding_stop";
    case "boarding_stop_unresolved":
      return "boarding_stop_position_unresolved";
    case "not_yet_at_boarding_stop":
      return "not_yet_at_boarding_stop";
    case "approaching_across_loop_seam":
      return "approaching_across_loop_seam";
    case "route_progress_unknown":
      return "route_progress_unknown";
    case "beyond_window":
      return "implausible_boarding_position";
  }
}

/**
 * The formal invariant, checked on every result.
 *
 * Waiting rider: a selected vehicle is strictly before the boarding stop, and
 * within the approach window. On-board rider: strictly past it, and within the
 * on-board window. Anything else is a bug, and it throws rather than reaching a
 * rider as a selection.
 */
export function assertDirectedInvariant(
  request: Pick<MatchRequest, "boardingStopSequence" | "candidates" | "riderState">,
  result: Pick<MatchResult, "status" | "selectedVehicleId">,
  policy: DirectedMatcherPolicy = DIRECTED_MATCHER_POLICY_V1,
): void {
  if (result.status !== "matched") {
    if (result.selectedVehicleId !== undefined) {
      throw new MatcherInvariantError("a withheld result must not carry a selected vehicle");
    }
    return;
  }
  const selected = request.candidates.find((candidate) => candidate.vehicleId === result.selectedVehicleId);
  if (!selected || selected.stopSequence === undefined || !Number.isInteger(selected.stopSequence)) {
    throw new MatcherInvariantError("a selected vehicle must be present with a known stop sequence");
  }
  const offset = selected.stopSequence - request.boardingStopSequence;
  if (request.riderState === "on_board") {
    if (offset < 1 || offset > policy.onBoardWindowStops) {
      throw new MatcherInvariantError(`on-board selection at offset ${offset} is outside 1..${policy.onBoardWindowStops}`);
    }
    return;
  }
  if (offset > -1 || offset < -policy.approachWindowStops) {
    throw new MatcherInvariantError(
      `waiting-rider selection at offset ${offset} is at or past the boarding stop, or outside the approach window`,
    );
  }
}
