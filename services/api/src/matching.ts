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
 *   certainty. Nor is leaving the window: a vehicle in session memory that has
 *   been out of sight for longer still blocks and competes from every position
 *   its last sighting and the time since allow, uncapped (finding F15).
 * - Only the leading approaching vehicle can be selected, and only when every
 *   other vehicle heading for the stop is at least three stops further back
 *   (`marginStops`), wherever it is: the approach window bounds what may be
 *   selected, not which buses may overtake the leader (finding F9).
 * - Without the route's stops, when the boarding stop appears twice on the
 *   route, or when two stops are listed under one sequence, automatic
 *   selection is withheld. A loop's lap is measured in sequences, never by
 *   counting rows (finding F18).
 * - Session memory (`PassageMemory`, finding F4): once any bus has been seen at
 *   the boarding stop, or seen crossing it (in this poll or only remembered,
 *   F10), during a waiting session, the rider may be aboard it, and no other
 *   bus is ever selected automatically in that session. Without this, the bus
 *   behind the one the rider boarded becomes the "leading approaching vehicle"
 *   the moment the first one leaves. The same holds when a bus seen for the
 *   first time already past the stop could have been at it since the rider
 *   began waiting, at the session's first look (F12) or any later one (F16);
 *   when a bus out of sight could, by now, have reached the stop (F15); and
 *   when a bus of unknown progress leaves the feed. Round a loop, a sighting
 *   is compared with the last one by its distance to the stop each way, so a
 *   crossing next to the seam is still a crossing, however short the lap
 *   (F17). The on-board rule mirrors it: a bus that reached
 *   the stop after the rider said they had boarded is not theirs, a bus
 *   missing from their first snapshot is never selected but still competes
 *   (F16), and a bus leaving the on-board window withholds selection for good.
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

/**
 * How far after `now` a sighting or a declaration may be dated before the
 * time since it counts as unknown (the clock stepped back) rather than as
 * none: the same 10 s a provider timestamp from the future is allowed.
 */
const CLOCK_SKEW_TOLERANCE_MS = 10_000;

/** Seconds from `thenMs` to `nowMs`; unbounded when `thenMs` cannot be read or lies too far after `nowMs`. */
function secondsSince(thenMs: number, nowMs: number): number {
  if (!Number.isFinite(thenMs) || thenMs > nowMs + CLOCK_SKEW_TOLERANCE_MS) return Number.POSITIVE_INFINITY;
  return Math.max(0, (nowMs - thenMs) / 1_000);
}

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
  /**
   * Sequence steps in one lap of a loop (from the first stop to its repetition);
   * the stop count on a straight route.
   */
  cycleLength: number;
  boardingStopFound: boolean;
  /** The boarding stop's id or name occurs more than once on the route. */
  boardingStopRepeats: boolean;
  /** Two different stops are listed under one sequence: no position on the route can be trusted. */
  sequenceConflict: boolean;
}

export function routeTopologyFacts(stops: StopOnRoute[], boardingStopSequence: number): RouteTopologyFacts {
  // One row per sequence. A provider that pages its stop list can repeat a
  // row, which is harmless; two different stops under one sequence are not.
  const bySequence = new Map<number, StopOnRoute>();
  let sequenceConflict = false;
  for (const stop of stops) {
    const listed = bySequence.get(stop.sequence);
    if (listed === undefined) bySequence.set(stop.sequence, stop);
    else if (listed.stopId !== stop.stopId) sequenceConflict = true;
  }
  const ordered = [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
  const first = ordered[0];
  const last = ordered.at(-1);
  const loop = ordered.length >= 3 && first !== undefined && last !== undefined && first.stopId === last.stopId;
  const boarding = bySequence.get(boardingStopSequence);
  // On a loop the closing stop legitimately repeats the first. Anything else
  // repeating is a route that passes the same place twice.
  const lap = loop ? ordered.slice(0, -1) : ordered;
  const boardingStopRepeats = boarding !== undefined && lap.filter(
    (stop) => stop.stopId === boarding.stopId || normalizedName(stop.name) === normalizedName(boarding.name),
  ).length > 1;
  return {
    sequences: new Set(bySequence.keys()),
    loop,
    // A lap is measured in sequence numbers, from the first stop to its
    // repetition, never by counting rows: a missing or repeated row must not
    // move the seam (finding F18).
    cycleLength: loop ? Math.max(1, last!.sequence - first!.sequence) : Math.max(1, ordered.length),
    boardingStopFound: boarding !== undefined,
    boardingStopRepeats,
    sequenceConflict,
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
    if (topology.sequenceConflict) abstentions.add("route_stop_sequences_conflict");
    // On board round a loop too short for its stops just past the boarding
    // stop to be told from those just before it, under any reading of TAGO's
    // nodeord, no position says which bus the rider boarded (finding R23).
    if (riderState === "on_board" && topology.loop && topology.cycleLength < 2 * policy.onBoardWindowStops + 2) {
      abstentions.add("loop_too_short_for_on_board_selection");
    }
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
    .map((row) => rememberedPosition(placedOnlyIfKnown(row, request.passage), request, riderState, nowMs, topology, policy));

  const onRoute = assessed.filter((row) => row.rightRoute);
  // A vehicle out of sight for longer than the memory window is not gone: it
  // is anywhere its last sighting and the time since allow, and that only
  // widens. It keeps blocking and competing from session memory, uncapped
  // (finding F15); forgetting it would raise certainty exactly when the
  // uncertainty is largest.
  remembered.push(...forgottenVehicles(request, onRoute, remembered, topology)
    .map((row) => rememberedPosition(row, request, riderState, nowMs, topology, policy, Number.POSITIVE_INFINITY)));
  if (onRoute.some((row) => row.facts.zone === "route_progress_unknown")
    || remembered.some((row) => row.facts.zone === "route_progress_unknown")) {
    abstentions.add("candidate_route_progress_unknown");
  }
  // One vehicle reported at two positions in the same snapshot is an identity
  // the provider itself is unsure of. Nothing about it can be trusted.
  // Only a conflict that touches the decision matters: a vehicle reported at
  // two positions that are both irrelevant to this rider cannot be their bus,
  // a competitor or a blocker, and dropping it must not change the answer.
  // A row of the same vehicle under another route is a second position too
  // (finding F19): the provider cannot say where, or on what, that bus is.
  const positionsByVehicle = new Map<string, { positions: Set<string>; relevant: boolean }>();
  for (const row of assessed) {
    const entry = positionsByVehicle.get(row.ranked.vehicleId) ?? { positions: new Set<string>(), relevant: false };
    entry.positions.add(`${row.observation.routeId}\u0000${String(row.observation.stopSequence)}`);
    if (row.rightRoute) entry.relevant ||= row.facts.selectable || row.facts.competes || row.facts.blocks;
    positionsByVehicle.set(row.ranked.vehicleId, entry);
  }
  if ([...positionsByVehicle.values()].some((entry) => entry.positions.size > 1 && entry.relevant)) {
    abstentions.add("vehicle_reported_at_two_positions");
  }
  if (onRoute.some((row) => row.facts.zone === "boarding_stop_unresolved")
    || remembered.some((row) => row.facts.zone === "boarding_stop_unresolved")) {
    abstentions.add("vehicle_at_boarding_stop_unresolved");
  }

  const reportedTwice = new Set([...positionsByVehicle].filter(([, entry]) => entry.positions.size > 1).map(([vehicleId]) => vehicleId));
  const passage = rememberPassage(request, onRoute, riderState, topology, policy, reportedTwice);
  if (passage.memory.withheld) abstentions.add(passage.memory.withheld.reason);
  for (const row of onRoute) {
    const excluded = passage.excluded.get(row.ranked.vehicleId);
    const reason = excluded ?? passage.unproven.get(row.ranked.vehicleId);
    if (!reason) continue;
    row.selectable = false;
    // Shown not to be the rider's bus: it neither is selected nor competes.
    // Merely not shown to be theirs: never selected, and it still competes.
    row.facts = { ...row.facts, selectable: false, ...(excluded ? { competes: false } : {}) };
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
 * Offsets in memory are plain sequence differences from the boarding stop. On
 * a straight route they order everything. Round a loop they do not: a
 * sighting is compared with the last one by its distance to the stop each
 * way, so a bus that crosses the stop next to the seam is still seen to cross
 * it, and a bus in the on-board window is never read as one before the stop,
 * however short the lap (finding F17).
 *
 * Waiting rider: a bus seen at the boarding stop, or seen before it and now at
 * or past it, may be the bus the rider boarded. So may a bus that dropped out
 * of the feed and could, by its last sighting and the time since, have reached
 * the stop (finding F15: the time since is not capped at the memory window);
 * a bus seen for the first time already past the stop that could have been at
 * it since the rider began waiting (finding F16: at every decision, not only
 * the first); and a bus whose route progress was unknown when it left the
 * feed. From then on no other bus can be selected automatically: the rider may
 * already be riding. Legacy matching got such cases "right" only by committing
 * to a bus sitting at the stop.
 *
 * On-board rider: the rider said they were aboard when the session began, so
 * a vehicle missing from that first snapshot is never selected (it may still
 * be theirs, missing from the feed, so it keeps competing); a bus seen two or
 * more stops before the boarding stop reached it after they boarded and is not
 * theirs; and a bus seen inside the on-board window and later beyond it may be
 * the rider's bus leaving the window, so selection is withheld for good.
 */
function rememberPassage(
  request: MatchRequest,
  onRoute: Assessed[],
  riderState: RiderState,
  topology: RouteTopologyFacts | undefined,
  policy: DirectedMatcherPolicy,
  /** Vehicles this snapshot reports at more than one place (another route or no stop included). */
  reportedTwice: ReadonlySet<string>,
): { memory: PassageMemory; excluded: Map<string, string>; unproven: Map<string, string> } {
  const prior = request.passage;
  const seenBefore = prior?.offsets ?? {};
  const offsets = new Map(Object.entries(seenBefore).map(([vehicleId, range]) => [vehicleId, { ...range }]));
  const unknownProgress = new Map(Object.entries(prior?.unknownProgress ?? {}));
  const reachedAfterBoarding = new Set(prior?.reachedAfterBoarding ?? []);
  const returnedToStop = new Set(prior?.returnedToStop ?? []);
  let withheld = prior?.withheld;
  const withhold = (reason: string) => { if (!withheld) withheld = { reason, at: request.now }; };
  const initial = prior?.initial ?? [...new Set(onRoute.map((row) => row.ranked.vehicleId))].sort();
  const excluded = new Map<string, string>();
  const unproven = new Map<string, string>();
  const nowMs = Date.parse(request.now);
  const reachAfter = (seconds: number) => 1 + Math.floor(seconds / policy.rememberedSecondsPerStop);
  const declaredMs = request.declaredAt === undefined ? Number.NaN : Date.parse(request.declaredAt);
  // A declaration dated well after `now` (the clock stepped back) leaves the
  // time since it unknown: unbounded, never zero.
  const sinceDeclared = request.declaredAt === undefined ? Number.NaN : secondsSince(declaredMs, nowMs);
  const window = policy.onBoardWindowStops;
  const loop = topology?.loop === true;
  // Round a loop, where a sighting sits is read from its distance to the stop each way.
  const around = (offset: number): Distances => ({ forward: mod(-offset, topology!.cycleLength), backward: mod(offset, topology!.cycleLength) });
  // The last sighting in memory; memory written before `last` existed keeps
  // only the extremes, and the furthest one stands in for it.
  const lastOf = (seen: { max: number; last?: number } | undefined) => (seen === undefined ? undefined : seen.last ?? seen.max);
  // Since the last sighting, the distance still to travel to the stop grew:
  // the bus went past the stop (or went backwards, which is no better).
  const passedOnLoop = (seen: { max: number; last?: number } | undefined, now: Distances) => {
    const last = lastOf(seen);
    return last !== undefined && now.forward !== undefined && now.forward > around(last).forward!;
  };
  // On board: inside the window, or one stop before the stop, where the rider's
  // bus may still read while it dwells.
  const nearWindow = (at: Distances) => (at.backward !== undefined && at.backward <= window) || at.forward === 1;
  // Before the stop, beyond any reading of the window: it reached the stop after the rider boarded.
  const beforeStop = (at: Distances) => at.forward !== undefined && at.forward >= 2 && !nearWindow(at);
  // On board: shown by an earlier sighting to have reached the stop after the rider boarded.
  const reachedEarlier = (vehicleId: string, seen: { min: number; last?: number } | undefined) =>
    reachedAfterBoarding.has(vehicleId) || (seen !== undefined && (loop
      ? [seen.last, seen.min].some((value) => value !== undefined && beforeStop(around(value)))
      : seen.min <= -2));
  // Two or more stops from the stop each way: no reading of TAGO's nodeord puts a bus there at the stop.
  const clearOfStop = (at: Distances) => (at.forward ?? 0) >= 2 && (at.backward ?? 0) >= 2;
  // Round a loop: whether, since its last sighting, the vehicle had time to go
  // through the stop and on to where it is now. `throughStop` is how far that
  // last sighting was from passing the stop in the sense that matters.
  const hadTimeToPass = (seen: { lastSeenAt?: string } | undefined, throughStop: number, now: Distances) => {
    if (seen === undefined || now.backward === undefined) return false;
    const seconds = secondsSince(seen.lastSeenAt === undefined ? Number.NaN : Date.parse(seen.lastSeenAt), nowMs);
    return throughStop + now.backward <= reachAfter(seconds);
  };

  const sawUnknown = new Set<string>();
  const sawKnown = new Set<string>();
  // A vehicle this snapshot places at two positions has no position that can
  // be trusted, whatever the order of its rows: it is remembered as of
  // unknown progress, and its last offset is the one nearest the stop ahead.
  const positionsNow = new Map<string, number[]>();
  for (const row of onRoute) {
    if (row.facts.offset === undefined) continue;
    positionsNow.set(row.ranked.vehicleId, [...(positionsNow.get(row.ranked.vehicleId) ?? []), row.facts.offset]);
  }
  const nearestAhead = (offsets: number[]) => [...offsets].sort((left, right) => aheadOf(left) - aheadOf(right) || right - left)[0]!;
  const aheadOf = (offset: number) => (loop ? around(offset).forward! : offset <= 0 ? -offset : Number.POSITIVE_INFINITY);
  let firstSeenPast = false;
  let wentRound = false;
  for (const row of onRoute) {
    const vehicleId = row.ranked.vehicleId;
    if (riderState === "on_board" && !initial.includes(vehicleId)) unproven.set(vehicleId, "not_present_when_rider_boarded");
    const offset = row.facts.offset;
    if (offset === undefined) {
      sawUnknown.add(vehicleId);
      continue;
    }
    sawKnown.add(vehicleId);
    const seen = seenBefore[vehicleId];
    if (riderState === "waiting_at_stop") {
      const crossed = loop ? passedOnLoop(seen, row.facts) : seen !== undefined && seen.min <= -1 && offset >= 0;
      if (row.facts.zone === "boarding_stop_unresolved" || crossed) {
        withhold("boarding_stop_reached_during_session");
      }
      // Round a loop, seen again after long enough to have gone through the
      // stop and round to where it is now: it reads as not having crossed, and
      // may have taken the rider (finding R24).
      const last = lastOf(seen);
      if (loop && last !== undefined && hadTimeToPass(seen, around(last).forward!, row.facts)) wentRound = true;
      // Its first known position this session. Already past the stop, it
      // could have been at the stop at any time up to the point its distance
      // past it allows; if that is after the rider began waiting, the rider
      // may have boarded it. Asked at every decision, not only the first: an
      // earlier look that did not see this bus says nothing about it.
      const past = row.facts.backward;
      if (seen === undefined && !Number.isNaN(sinceDeclared) && sinceDeclared > 0
        && past !== undefined && past >= 1 && past <= reachAfter(sinceDeclared)) {
        firstSeenPast = true;
      }
    } else {
      // Seen before the stop at any time in the session, it reached the stop
      // after the rider boarded, for good. Round a loop the extremes of plain
      // offsets do not say where it was, so every such sighting is recorded.
      // A bus the snapshot places twice has no place to be excluded by: an
      // exclusion stops it competing, so it takes a sighting that can be
      // trusted (finding R27).
      const beforeNow = !reportedTwice.has(vehicleId) && (loop ? beforeStop(row.facts) : offset <= -2);
      if (beforeNow) reachedAfterBoarding.add(vehicleId);
      if (beforeNow || reachedEarlier(vehicleId, seen)) excluded.set(vehicleId, excluded.get(vehicleId) ?? "reached_boarding_stop_after_rider_boarded");
      const lastSeen = lastOf(seen);
      if (loop && lastSeen !== undefined) {
        // Seen clear of the stop and now back at it, or closer past it: it
        // went through the stop after the rider boarded, or read a stop back.
        // Seen again after long enough to have gone round through it (from a
        // sighting at the stop, a whole lap: that pass may be the boarding
        // itself): it may have. Never theirs by selection, it still competes,
        // as a bus the feed may have garbled must (finding R23).
        const then = around(lastSeen);
        const clearThen = clearOfStop(then);
        const back = clearThen && (row.facts.forward === 1 || row.facts.backward! < then.backward!);
        if (back || hadTimeToPass(seen, clearThen ? then.forward! : topology!.cycleLength - 1, row.facts)) returnedToStop.add(vehicleId);
      }
      if (returnedToStop.has(vehicleId)) unproven.set(vehicleId, unproven.get(vehicleId) ?? "may_have_reached_boarding_stop_after_rider_boarded");
      const left = loop
        ? lastSeen !== undefined && nearWindow(around(lastSeen)) && !nearWindow(row.facts)
        : seen !== undefined && seen.max >= -1 && seen.max <= window && offset > window;
      if (left) withhold("vehicle_left_on_board_window_during_session");
    }
    const range = offsets.get(vehicleId);
    const placed = positionsNow.get(vehicleId)!;
    // On board, memory is what later exclusions are read from, so a sighting
    // at two places leaves it as it was (finding R27). Waiting, every place
    // counts: there memory only ever makes the matcher more careful.
    if (riderState === "on_board" && reportedTwice.has(vehicleId)) {
      if (new Set(placed).size > 1) sawUnknown.add(vehicleId);
      continue;
    }
    offsets.set(vehicleId, {
      min: range ? Math.min(range.min, offset) : offset,
      max: range ? Math.max(range.max, offset) : offset,
      last: new Set(placed).size > 1 ? nearestAhead(placed) : offset,
      lastSeenAt: request.now,
    });
    if (new Set(placed).size > 1) sawUnknown.add(vehicleId);
  }
  for (const vehicleId of sawUnknown) unknownProgress.set(vehicleId, request.now);
  for (const vehicleId of sawKnown) if (!sawUnknown.has(vehicleId)) unknownProgress.delete(vehicleId);

  // A vehicle missing from this poll but still remembered is judged on its
  // last sighting against the same memory: dropping the row that shows a
  // crossing (or a departure from the on-board window) must not forget it.
  const current = new Set(onRoute.map((row) => row.ranked.vehicleId));
  const remembered = new Set<string>();
  for (const row of request.recentlySeen ?? []) {
    if (row.routeId !== request.routeId || current.has(row.vehicleId)) continue;
    remembered.add(row.vehicleId);
    const seen = seenBefore[row.vehicleId];
    if (seen === undefined) continue;
    const facts = classifyRouteProgress(row.stopSequence, request.boardingStopSequence, riderState, topology, policy);
    const offset = facts.offset;
    if (offset === undefined) continue;
    if (riderState === "waiting_at_stop") {
      if (loop ? passedOnLoop(seen, facts) : seen.min <= -1 && offset >= 0) withhold("boarding_stop_reached_during_session");
    } else if (loop
      ? nearWindow(around(lastOf(seen)!)) && !nearWindow(facts)
      : seen.max >= -1 && seen.max <= window && offset > window) {
      withhold("vehicle_left_on_board_window_during_session");
    }
  }

  if (riderState === "waiting_at_stop" && prior === undefined && !Number.isNaN(sinceDeclared) && sinceDeclared > policy.memoryWindowSeconds) {
    // The session's first decision, made long after the rider said they were
    // waiting (the first poll failed, or was slow). Whatever crossed the stop
    // in between and left the feed was never observed, and past the memory
    // window not even that can be bounded.
    withhold("session_first_observed_late");
  }
  if (firstSeenPast) {
    withhold(prior === undefined
      ? "vehicle_may_have_reached_boarding_stop_before_first_observation"
      : "vehicle_first_seen_past_boarding_stop");
  }
  // Every reason above was raised by a sighting; every one below only by what
  // the time since allows. The first reason is the one kept, and the journey
  // session's boarding watch tells the two kinds apart by it.
  if (wentRound) withhold("vehicle_may_have_reached_boarding_stop_unobserved");

  if (riderState === "on_board") {
    // A bus shown to have reached the stop after the rider boarded is not
    // theirs wherever it is now: remembered or out of sight, it does not
    // compete either (it still blocks by where it may be, as a visible one does).
    for (const [vehicleId, range] of Object.entries(seenBefore)) {
      if (!current.has(vehicleId) && reachedEarlier(vehicleId, range)) excluded.set(vehicleId, "reached_boarding_stop_after_rider_boarded");
    }
  }

  for (const [vehicleId, range] of Object.entries(seenBefore)) {
    if (current.has(vehicleId) || remembered.has(vehicleId)) continue;
    // Neither in this snapshot nor remembered: out of sight for longer than
    // the memory window. If, by its last sighting and the time since, it
    // could have reached the stop, the rider may have boarded it unobserved.
    if (riderState !== "waiting_at_stop") continue;
    const seenAtMs = range.lastSeenAt === undefined ? Number.NaN : Date.parse(range.lastSeenAt);
    // A sighting time that cannot be read, or lies well after `now`, gives no bound.
    const unseenSeconds = secondsSince(seenAtMs, nowMs);
    const toStop = stopsToBoardingStop(range.last ?? range.max, topology);
    if (toStop !== undefined && toStop <= reachAfter(unseenSeconds)) withhold("vehicle_may_have_reached_boarding_stop_unobserved");
  }
  for (const vehicleId of unknownProgress.keys()) {
    // Its route progress was unknown when last seen: it may have been at the
    // stop, or been the rider's bus. Out of sight, nothing will say otherwise.
    if (!current.has(vehicleId) && !remembered.has(vehicleId)) withhold("vehicle_of_unknown_progress_out_of_sight");
  }

  const memory: PassageMemory = {
    offsets: Object.fromEntries([...offsets].sort(([left], [right]) => left.localeCompare(right))),
    initial,
    ...(unknownProgress.size > 0
      ? { unknownProgress: Object.fromEntries([...unknownProgress].sort(([left], [right]) => left.localeCompare(right))) }
      : {}),
    ...(reachedAfterBoarding.size > 0 ? { reachedAfterBoarding: [...reachedAfterBoarding].sort() } : {}),
    ...(returnedToStop.size > 0 ? { returnedToStop: [...returnedToStop].sort() } : {}),
    ...(withheld ? { withheld } : {}),
  };
  return { memory, excluded, unproven };
}

interface Distances {
  forward?: number;
  backward?: number;
}

/**
 * Stops a vehicle last seen at offset `last` still has to travel to reach the
 * boarding stop: round a loop, whichever side it was on; on a straight route,
 * undefined once it has passed it for good. At the stop, or one past it under
 * an unresolved reading, is 0.
 */
function stopsToBoardingStop(last: number, topology: RouteTopologyFacts | undefined): number | undefined {
  if (topology?.loop) return mod(-last, topology.cycleLength);
  return last <= 1 ? Math.max(0, -last) : undefined;
}

/**
 * A remembered row whose vehicle's latest sighting in the session had no
 * usable position (or two) does not place it: the evidence window may have
 * kept another row of that same sighting. Such a row is judged unplaced.
 */
function placedOnlyIfKnown(row: VehicleObservation, passage: PassageMemory | undefined): VehicleObservation {
  const since = passage?.unknownProgress?.[row.vehicleId];
  if (since === undefined || Date.parse(row.receivedAt ?? "") > Date.parse(since)) return row;
  const { stopSequence: _sequence, ...unplaced } = row;
  return unplaced;
}

/**
 * Vehicles in session memory that are neither in this snapshot nor
 * remembered from the evidence window, as observations at their last
 * sighting. Their age is the time since, uncapped.
 */
function forgottenVehicles(
  request: MatchRequest,
  onRoute: Assessed[],
  remembered: Remembered[],
  topology: RouteTopologyFacts | undefined,
): VehicleObservation[] {
  const present = new Set([...onRoute.map((row) => row.ranked.vehicleId), ...remembered.map((row) => row.vehicleId)]);
  const rows: VehicleObservation[] = [];
  for (const [vehicleId, range] of Object.entries(request.passage?.offsets ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    if (present.has(vehicleId)) continue;
    let stopSequence = request.boardingStopSequence + (range.last ?? range.max);
    if (topology?.loop) {
      let first = Number.POSITIVE_INFINITY;
      for (const sequence of topology.sequences) first = Math.min(first, sequence);
      stopSequence = first + mod(stopSequence - first, topology.cycleLength);
    }
    rows.push({
      vehicleId,
      routeId: request.routeId,
      observedAt: "1970-01-01T00:00:00.000Z",
      ...(range.lastSeenAt === undefined ? {} : { receivedAt: range.lastSeenAt }),
      timestampSource: "unavailable",
      stopSequence,
    });
  }
  return rows;
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
  /** The longest the vehicle may be taken to have been moving unseen: the memory window, or unbounded for one out of sight longer. */
  ageLimitSeconds: number = policy.memoryWindowSeconds,
): Remembered {
  const base = classifyRouteProgress(row.stopSequence, request.boardingStopSequence, riderState, topology, policy);
  if (row.stopSequence === undefined || base.zone === "route_progress_unknown") {
    return { vehicleId: row.vehicleId, facts: base, positionScore: 0 };
  }
  const seenAtMs = row.receivedAt ? Date.parse(row.receivedAt) : Number.NaN;
  // A receipt time that cannot be read, or lies well after `now`, gives no
  // bound short of the limit.
  const ageSeconds = Math.min(secondsSince(seenAtMs, nowMs), ageLimitSeconds);
  // A straight route ends at its last stop and a loop repeats after one lap;
  // without the stop list nothing can be selected, and the window's reach is
  // walked only to say what the vehicle blocks.
  const walkLimit = !topology
    ? 1 + Math.floor(policy.memoryWindowSeconds / policy.rememberedSecondsPerStop)
    : topology.loop ? topology.cycleLength : Number.POSITIVE_INFINITY;
  const reach = Math.min(walkLimit, 1 + Math.floor(Math.min(ageSeconds, ageLimitSeconds) / policy.rememberedSecondsPerStop));
  const sequences = topology ? [...topology.sequences].sort((left, right) => left - right) : undefined;
  const first = sequences?.[0] ?? 1;
  const last = sequences?.at(-1) ?? row.stopSequence + reach;
  // Where it may be now is a matter of sequence arithmetic: a sequence the stop
  // list happens to lack is still a place it may have reached, not an unknown.
  const shape = topology ? { loop: topology.loop, cycleLength: topology.cycleLength } : undefined;
  // Folded step by step: a long walk (a lap measured in sequences can be
  // long) never builds a list, nor spreads one into an argument list.
  const nearest = (facts: PositionFacts) => (riderState === "on_board" ? facts.backward : facts.forward) ?? Number.POSITIVE_INFINITY;
  let blocks = false;
  let closest: PositionFacts | undefined;
  let score = 0;
  let closestForward: number | undefined;
  for (let step = 0; step <= reach; step += 1) {
    let sequence = row.stopSequence + step;
    if (sequence > last) {
      if (!topology?.loop) break;
      sequence = first + mod(sequence - first, topology.cycleLength);
    }
    const possible = classifyRouteProgress(sequence, request.boardingStopSequence, riderState, shape, policy);
    blocks ||= possible.blocks;
    if (possible.competes) {
      // The first of the nearest, in walk order.
      if (closest === undefined || nearest(possible) < nearest(closest)) closest = possible;
      score = Math.max(score, positionScore(possible, riderState));
    }
    if (possible.forward !== undefined && possible.forward >= 1 && (closestForward === undefined || possible.forward < closestForward)) {
      closestForward = possible.forward;
    }
  }
  const facts: PositionFacts = {
    zone: blocks ? "boarding_stop_unresolved" : closest?.zone ?? base.zone,
    offset: base.offset,
    ...(closest?.forward === undefined ? (base.forward === undefined ? {} : { forward: base.forward }) : { forward: closest.forward }),
    ...(closest?.backward === undefined ? (base.backward === undefined ? {} : { backward: base.backward }) : { backward: closest.backward }),
    selectable: false,
    blocks,
    competes: closest !== undefined,
  };
  return {
    vehicleId: row.vehicleId,
    facts,
    positionScore: score,
    ...(closestForward === undefined ? {} : { closestForward }),
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
  request: Pick<MatchRequest, "boardingStopSequence" | "candidates" | "riderState"> & Partial<Pick<MatchRequest, "routeId">>,
  result: Pick<MatchResult, "status" | "selectedVehicleId">,
  policy: DirectedMatcherPolicy = DIRECTED_MATCHER_POLICY_V1,
): void {
  if (result.status !== "matched") {
    if (result.selectedVehicleId !== undefined) {
      throw new MatcherInvariantError("a withheld result must not carry a selected vehicle");
    }
    return;
  }
  // Every row of the selected vehicle on the request's route. A row with the
  // same id under another route is not the row that was selected, and must
  // neither pass nor fail the check in its place (finding F19).
  const rows = request.candidates.filter((candidate) => candidate.vehicleId === result.selectedVehicleId
    && (request.routeId === undefined || candidate.routeId === request.routeId));
  if (rows.length === 0) throw new MatcherInvariantError("a selected vehicle must be present with a known stop sequence");
  for (const selected of rows) {
    if (selected.stopSequence === undefined || !Number.isInteger(selected.stopSequence)) {
      throw new MatcherInvariantError("a selected vehicle must be present with a known stop sequence");
    }
    const offset = selected.stopSequence - request.boardingStopSequence;
    if (request.riderState === "on_board") {
      if (offset < 1 || offset > policy.onBoardWindowStops) {
        throw new MatcherInvariantError(`on-board selection at offset ${offset} is outside 1..${policy.onBoardWindowStops}`);
      }
      continue;
    }
    if (offset > -1 || offset < -policy.approachWindowStops) {
      throw new MatcherInvariantError(
        `waiting-rider selection at offset ${offset} is at or past the boarding stop, or outside the approach window`,
      );
    }
  }
}
