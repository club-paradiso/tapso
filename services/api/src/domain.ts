export type Direction = "outbound" | "inbound";

export interface RouteRequest {
  routeId: string;
  cityCode: string;
}

export interface StopOnRoute {
  stopId: string;
  name: string;
  sequence: number;
  directionCode?: string;
  latitude?: number;
  longitude?: number;
}

export interface VehicleObservation {
  vehicleId: string;
  routeId: string;
  /**
   * When the provider says it observed the vehicle — but only when
   * `timestampSource` is `"provider"`. Under `"unavailable"` this is the epoch
   * sentinel `1970-01-01T00:00:00.000Z` and carries no information at all.
   */
  observedAt: string;
  /**
   * When TAPSO's own server received the snapshot. Server receipt time, full
   * stop. It is never a provider observation time and must not be renamed,
   * serialised or described as one; a freshness rule built on it can only
   * claim that the provider kept answering, never when it looked.
   */
  receivedAt?: string;
  /**
   * `"unavailable"` means the provider publishes no observation time — TAGO's
   * realtime position feed is the case this exists for. Consumers must fail
   * closed on it rather than substituting `receivedAt`.
   */
  timestampSource?: "provider" | "unavailable";
  stopId?: string;
  stopName?: string;
  stopSequence?: number;
  directionCode?: string;
  latitude?: number;
  longitude?: number;
  speedKph?: number;
  headingDegrees?: number;
  eventCode?: string;
  receiveType?: string;
}

/**
 * What the rider said when the session started. It is input, not evidence:
 * the rider knows whether they are standing at the stop or already on a bus,
 * and the matcher applies a different, separately tested rule to each.
 *
 * - `waiting_at_stop` — the default whenever the field is absent. Only a
 *   vehicle that has not yet reached the boarding stop may be selected.
 * - `on_board` — the rider says they have just boarded at the boarding stop.
 *   Only a vehicle that has already left it may be selected, and only when it
 *   is the one vehicle of the route anywhere near it.
 *
 * Absence means `waiting_at_stop` because that is the rule whose failure mode
 * is abstaining: a rider who is really on board gets a confirmation prompt,
 * whereas treating a waiting rider as on board would admit departed buses.
 */
export type RiderState = "waiting_at_stop" | "on_board";

export interface MatchRequest {
  routeId: string;
  boardingStopSequence: number;
  boardingLatitude?: number;
  boardingLongitude?: number;
  directionCode?: string;
  now: string;
  candidates: VehicleObservation[];
  /** See `RiderState`. Absent means `waiting_at_stop`. */
  riderState?: RiderState;
  /**
   * The route's ordered stops. Required for automatic selection: without them
   * the matcher cannot tell a loop seam or a repeated stop from a straight
   * route, so it withholds (`route_topology_unverified`).
   */
  stops?: StopOnRoute[];
  /**
   * The last sighting of every vehicle seen inside the evidence window but
   * absent from this snapshot. Such a vehicle can never be selected, but it
   * still competes: a bus that dropped out of one poll has not been shown to
   * be gone, so it keeps blocking and keeps the decision ambiguous.
   */
  recentlySeen?: VehicleObservation[];
  /**
   * What this session has already seen, returned by the previous decision as
   * `MatchResult.passage`. Absent means a session that has seen nothing yet.
   */
  passage?: PassageMemory;
  /**
   * When the rider declared their state: the session start. It lets a
   * session's first decision ask whether a bus already past the stop could
   * have been at it when the rider began waiting, which one snapshot alone
   * cannot. Absent, that question is not asked (a stateless match).
   */
  declaredAt?: string;
}

/**
 * Session-scoped memory of how vehicles moved relative to the boarding stop.
 *
 * The matcher is otherwise a function of one snapshot, and one snapshot cannot
 * tell "the rider is still waiting" from "the rider boarded the bus that just
 * left". This memory can: once any bus has been seen at the boarding stop, or
 * seen crossing it, during a waiting session, the rider may be aboard it, and
 * automatic selection is withheld for the rest of that session. Nothing ever
 * clears it. It also keeps every vehicle seen in the session, so one that
 * leaves the feed for longer than the evidence window still counts where it
 * may be by now.
 */
export interface PassageMemory {
  /**
   * Per vehicle: lowest, highest and most recent stop offset from the boarding
   * stop observed during this session (sequence minus the boarding stop's), and
   * when it was last observed. Round a loop the matcher reads `last` by its
   * distance to the stop each way. `last`/`lastSeenAt` are absent in memory
   * written before they existed.
   */
  offsets: Record<string, { min: number; max: number; last?: number; lastSeenAt?: string }>;
  /**
   * Vehicles in the session's first snapshot. An on-board rider declared they
   * were aboard at that moment, so only one of these can be selected as their
   * bus.
   */
  initial?: string[];
  /**
   * Vehicles whose latest sighting had no usable route progress, and when.
   * Such a vehicle may be anywhere, the boarding stop included.
   */
  unknownProgress?: Record<string, string>;
  /**
   * On board: vehicles seen two or more stops before the boarding stop during
   * the session. They reached it after the rider boarded, so none of them is
   * the rider's bus. Round a loop the offsets' extremes cannot say this, so
   * it is recorded.
   */
  reachedAfterBoarding?: string[];
  /**
   * On board, round a loop: vehicles seen clear of the boarding stop and later
   * back at it or closer past it, or seen again after long enough to have gone
   * round through it. Each may have reached the stop after the rider boarded
   * (or read a stop back), so none of them is ever selected; they still compete.
   */
  returnedToStop?: string[];
  /** Set once and never cleared. */
  withheld?: { reason: string; at: string };
}

export interface RankedCandidate {
  vehicleId: string;
  score: number;
  evidence: string[];
  rejectedReasons: string[];
  /** Candidate stop sequence minus the boarding stop sequence. Positive = past the stop in route order. */
  stopOffset?: number;
  /** Where the directed policy placed the candidate relative to the boarding stop. */
  zone?: string;
}

export interface MatchResult {
  status: "matched" | "ambiguous" | "unavailable";
  confidence: "high" | "medium" | "low" | "unknown";
  selectedVehicleId?: string;
  ranked: RankedCandidate[];
  explanation: string;
  /** The matcher policy that produced this result. */
  policyVersion?: string;
  /** The rider state the result was computed for. */
  riderState?: RiderState;
  /**
   * Decision-level reasons the matcher withheld a selection even though a
   * candidate may have been individually eligible. Empty or absent on a match.
   */
  abstentionReasons?: string[];
  /** The session memory after this decision; hand it to the next one as `MatchRequest.passage`. */
  passage?: PassageMemory;
}
