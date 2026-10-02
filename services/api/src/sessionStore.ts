/**
 * Where a journey session lives between requests.
 *
 * The interesting part of this contract is not `load` and `save`. It is that
 * `save` is a compare-and-set.
 *
 * `JourneySessionCoordinator` refuses to move a rider backward along a route:
 * a resolved stop earlier than the last accepted one is discarded. That
 * guarantee holds inside one process because one object is the only copy. On a
 * horizontally scaled runtime it is two instances reading the same session,
 * both deriving progress from what they read, and the slower write winning.
 * The rider's stop sequence goes backward, silently, through a code path that
 * explicitly forbids going backward.
 *
 * So every load carries a version and every save states the version it read.
 * A save whose version is stale does not overwrite; it loses, and the loser is
 * expected to return what the winner stored rather than guess. Fail closed,
 * the same way the rest of this service does.
 */

import type { PassageMemory, StopOnRoute, VehicleObservation } from "./domain.ts";
import type { BoardingWatch, JourneyProgressView } from "./journeySession.ts";
import type { LiveActivityDelivery } from "./liveActivityContent.ts";

/** Bumped when the persisted shape changes in a way an old row cannot satisfy. */
export const JOURNEY_SESSION_SCHEMA_VERSION = 1;

export type StoredMatchConfidence = "high" | "medium" | "low" | "unknown";

/**
 * A journey session as it is persisted: plain JSON, no `Map`, no `Date`, no
 * class instance. The in-memory `SessionRecord` keeps `cadenceHistory` as a
 * `Map` because that is what the coordinator reads; `JSON.stringify` turns a
 * `Map` into `{}` without complaining, so the conversion is explicit here
 * rather than left to a serializer to get wrong.
 */
export interface StoredJourneySession {
  schemaVersion: number;
  id: string;
  routeId: string;
  cityCode: string;
  boardingStopSequence: number;
  destinationStopSequence: number;
  directionCode?: string;
  /** Absent on rows written before rider states existed; read as `waiting_at_stop`. */
  riderState?: "waiting_at_stop" | "on_board";
  stops: StopOnRoute[];
  boardingStop: StopOnRoute;
  destinationStop: StopOnRoute;
  selectedVehicleId?: string;
  selectionMode?: "automatic" | "explicit";
  matchConfidence: StoredMatchConfidence;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  lastObservation?: VehicleObservation;
  lastProgress?: JourneyProgressView;
  /** The `Map` flattened to entries, in insertion order. */
  cadenceHistory: Array<[string, VehicleObservation[]]>;
  consecutiveProviderFailures: number;
  /** Matcher memory of passages past the boarding stop. Absent on older rows: an empty memory. */
  passage?: PassageMemory;
  /** After an automatic selection for a waiting rider (finding F20). See `BoardingWatch`. */
  boardingWatch?: BoardingWatch;
  /** Absent until the app registers its Live Activity's push token. See `LiveActivityPushToken`. */
  liveActivityPush?: LiveActivityPushToken;
}

/**
 * The ActivityKit push token of the Live Activity that follows this ride
 * (`docs/exec-plans/LIVE_ACTIVITY_PUSH.md`, milestone 2).
 *
 * The token is a capability: whoever holds it can update the rider's Lock
 * Screen. It is never logged and never returned; logs and answers carry the
 * fingerprint. It lives in the session row and nowhere else, so ending the
 * ride or the row's TTL removes it.
 */
export interface LiveActivityPushToken {
  token: string;
  fingerprint: string;
  registeredAtMs: number;
  /**
   * What was last pushed to this ride's activity (`liveActivityContent.ts`).
   * Absent until the first accepted push; kept across a token rotation, since
   * a rotated token belongs to the same activity.
   */
  delivery?: LiveActivityDelivery;
}

/**
 * A session together with the version it was read at.
 *
 * `version` is opaque to the coordinator: it reads one and hands the same one
 * back. Only the store decides what it means.
 */
export interface VersionedJourneySession {
  session: StoredJourneySession;
  version: number;
}

/**
 * The outcome of a compare-and-set.
 *
 * `stored` on a loss is the row that won, so a caller can answer the request
 * with real persisted state instead of its own rejected copy. It is absent
 * only when the row disappeared entirely — expired or deleted between the load
 * and the save.
 */
export type SaveOutcome =
  | { outcome: "saved"; version: number }
  | { outcome: "conflict"; stored?: VersionedJourneySession };

export interface JourneySessionStore {
  /**
   * Undefined only when no row exists. An expired row is returned as-is; the
   * coordinator owns the expiry decision so `410` stays distinguishable
   * from `404`.
   */
  load(id: string): Promise<VersionedJourneySession | undefined>;
  /**
   * Create a session that must not already exist. A duplicate id is a
   * `conflict`, which makes id collision a caught error rather than a
   * silent overwrite of somebody's ride.
   */
  create(session: StoredJourneySession): Promise<SaveOutcome>;
  /**
   * Replace a session only if it is still at `expectedVersion`.
   */
  save(session: StoredJourneySession, expectedVersion: number): Promise<SaveOutcome>;
  delete(id: string): Promise<void>;
}

/**
 * The single-process store, and the default.
 *
 * It is correct for the local Node server and for tests, and wrong for
 * serverless — which is why `TRANSIT_SESSIONS_ENABLED` defaults to false
 * whenever `VERCEL` is set. It implements the same CAS contract as the durable
 * store so the coordinator has exactly one code path, and so a concurrency bug
 * is reproducible in a unit test without a network.
 */
export class MemoryJourneySessionStore implements JourneySessionStore {
  private readonly rows = new Map<string, { session: string; version: number }>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Returns an expired row rather than hiding it.
   *
   * The coordinator, not the store, decides that a session has expired, so a
   * rider who comes back late gets `410 SESSION_EXPIRED` instead of a `404`
   * that cannot tell them apart from a wrong id. A durable store sets its own
   * TTL past that boundary for the same reason; see `upstashSessionStore.ts`.
   */
  async load(id: string): Promise<VersionedJourneySession | undefined> {
    const row = this.rows.get(id);
    if (!row) return undefined;
    return { session: JSON.parse(row.session) as StoredJourneySession, version: row.version };
  }

  async create(session: StoredJourneySession): Promise<SaveOutcome> {
    const existing = await this.load(session.id);
    if (existing) return { outcome: "conflict", stored: existing };
    this.rows.set(session.id, { session: serialize(session), version: 1 });
    return { outcome: "saved", version: 1 };
  }

  async save(session: StoredJourneySession, expectedVersion: number): Promise<SaveOutcome> {
    const existing = await this.load(session.id);
    if (!existing) return { outcome: "conflict" };
    if (existing.version !== expectedVersion) return { outcome: "conflict", stored: existing };
    const version = expectedVersion + 1;
    this.rows.set(session.id, { session: serialize(session), version });
    return { outcome: "saved", version };
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  /** Bounded growth for a long-lived local process. */
  pruneExpired(): void {
    const nowMs = this.now().getTime();
    for (const [id, row] of this.rows) {
      const session = JSON.parse(row.session) as StoredJourneySession;
      if (session.expiresAtMs <= nowMs) this.rows.delete(id);
    }
  }
}

/**
 * Serialize through the same JSON both stores persist.
 *
 * The memory store could hold the object directly and be faster. It does not,
 * on purpose: holding a live reference would let a coordinator mutate stored
 * state without saving, which is precisely the aliasing the durable store
 * makes impossible. Both stores behave identically or the memory one is not a
 * test double for anything.
 */
function serialize(session: StoredJourneySession): string {
  return JSON.stringify(session);
}

export class SessionStoreError extends Error {
  readonly code = "SESSION_STORE_UNAVAILABLE";
}
