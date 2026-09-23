/**
 * A journey-session store backed by Upstash Redis over its REST API.
 *
 * No client library. Upstash's REST endpoint is an HTTPS POST carrying a JSON
 * command array and a bearer token, so the whole client is `fetch` plus error
 * handling. `services/api` ships one runtime dependency on purpose; adding a
 * package to build a request body `fetch` already builds would spend
 * supply-chain surface on nothing.
 *
 * `UNVERIFIED_AGAINST_LIVE_SERVICE`. Every path below is covered by tests
 * driving a stub `fetch`, which proves this module's behaviour but not
 * Upstash's. Nothing here may be called production-ready until a live round
 * trip is recorded in `docs/exec-plans/DURABLE_JOURNEY_SESSIONS.md`.
 */

import { DEFAULT_SESSION_KEY_PREFIX, validateSessionKeyPrefix } from "./sessionKeyPrefix.ts";
import {
  SessionStoreError,
  type JourneySessionStore,
  type SaveOutcome,
  type StoredJourneySession,
  type VersionedJourneySession,
} from "./sessionStore.ts";

/**
 * How long a row outlives the session's own expiry.
 *
 * The coordinator decides a session has expired and answers `410`. If Redis
 * evicted the row at exactly that instant the answer would be `404` instead,
 * and a rider returning a minute late could not tell a finished ride from a
 * mistyped id. The row therefore lingers past the boundary, doing nothing
 * except letting the coordinator give the accurate answer.
 */
export const DEFAULT_EXPIRY_GRACE_MS = 5 * 60 * 1_000;

/**
 * Compare-and-set in one round trip.
 *
 * The stored value is `"<version>:<json>"`. A plain string prefix keeps the
 * version readable with `string.match`, so the script needs neither `cjson`
 * nor a second key that could drift out of step with the first.
 *
 * Returns `{code, current}`: `1` saved, `0` no such row, `-1` version
 * mismatch with the winning row alongside it, so the caller can answer with
 * real stored state instead of a second fetch.
 */
const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return {0, ''} end
local version = tonumber(string.match(current, '^(%d+):'))
if version ~= tonumber(ARGV[1]) then return {-1, current} end
redis.call('SET', KEYS[1], ARGV[2], 'PX', tonumber(ARGV[3]))
return {1, ''}
`.trim();

export interface UpstashSessionStoreOptions {
  restUrl: string;
  restToken: string;
  now?: () => Date;
  expiryGraceMs?: number;
  /**
   * The namespace every key this store touches lives under. Defaults to
   * `DEFAULT_SESSION_KEY_PREFIX`, the format existing rows already use.
   * Injected by the wiring layer from `TRANSIT_SESSION_KEY_PREFIX`; the store
   * never reads the environment itself. See `sessionKeyPrefix.ts`.
   */
  keyPrefix?: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export class UpstashJourneySessionStore implements JourneySessionStore {
  readonly keyPrefix: string;
  private readonly restUrl: string;
  private readonly restToken: string;
  private readonly now: () => Date;
  private readonly expiryGraceMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: UpstashSessionStoreOptions) {
    this.restUrl = options.restUrl.replace(/\/+$/, "");
    this.restToken = options.restToken;
    this.now = options.now ?? (() => new Date());
    this.expiryGraceMs = options.expiryGraceMs ?? DEFAULT_EXPIRY_GRACE_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    // Validated here too, not only at boot: a store built by a script or a
    // test must not be able to reach outside a safe namespace either.
    this.keyPrefix = validateSessionKeyPrefix(options.keyPrefix ?? DEFAULT_SESSION_KEY_PREFIX);
  }

  /** The Redis key a session id maps to. Every command goes through this. */
  keyFor(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  async load(id: string): Promise<VersionedJourneySession | undefined> {
    const result = await this.command(["GET", this.keyFor(id)]);
    if (result === null || result === undefined) return undefined;
    return decode(expectString(result, "GET"));
  }

  async create(session: StoredJourneySession): Promise<SaveOutcome> {
    // `NX` is what makes this a create rather than a blind write: a colliding
    // id loses instead of overwriting a ride already in progress.
    const result = await this.command([
      "SET",
      this.keyFor(session.id),
      encode(session, 1),
      "NX",
      "PX",
      String(this.ttlMs(session)),
    ]);
    if (result === null || result === undefined) {
      const stored = await this.load(session.id);
      return stored ? { outcome: "conflict", stored } : { outcome: "conflict" };
    }
    return { outcome: "saved", version: 1 };
  }

  async save(session: StoredJourneySession, expectedVersion: number): Promise<SaveOutcome> {
    const version = expectedVersion + 1;
    const reply = await this.command([
      "EVAL",
      CAS_SCRIPT,
      "1",
      this.keyFor(session.id),
      String(expectedVersion),
      encode(session, version),
      String(this.ttlMs(session)),
    ]);

    if (!Array.isArray(reply) || reply.length < 2) {
      throw new SessionStoreError("the session store returned an unrecognised compare-and-set reply");
    }
    const code = Number(reply[0]);
    if (code === 1) return { outcome: "saved", version };
    if (code === 0) return { outcome: "conflict" };
    // Someone else wrote first. Hand their row back rather than ours.
    const current = typeof reply[1] === "string" && reply[1].length > 0 ? decode(reply[1]) : undefined;
    return current ? { outcome: "conflict", stored: current } : { outcome: "conflict" };
  }

  async delete(id: string): Promise<void> {
    await this.command(["DEL", this.keyFor(id)]);
  }

  /**
   * Never returns a value the caller could mistake for "no such session".
   *
   * A store that is unreachable must not read as an absent row: that would
   * make a rider's live session disappear mid-journey and, worse, look like a
   * legitimate `404`. Every transport and protocol failure throws instead.
   */
  private async command(command: string[]): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.restUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.restToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(command),
      });
    } catch {
      // The message is ours, never the thrown one: a transport error can carry
      // the request URL, and the URL carries the credential's host.
      throw new SessionStoreError("the session store could not be reached");
    }

    if (!response.ok) {
      throw new SessionStoreError(`the session store rejected a command with status ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SessionStoreError("the session store returned a malformed response");
    }
    if (!payload || typeof payload !== "object") {
      throw new SessionStoreError("the session store returned a malformed response");
    }
    if ("error" in payload) {
      throw new SessionStoreError("the session store reported a command error");
    }
    if (!("result" in payload)) {
      throw new SessionStoreError("the session store returned a response with no result");
    }
    return (payload as { result: unknown }).result;
  }

  /**
   * Milliseconds Redis should keep the row.
   *
   * Clamped to at least a second: a session already past its expiry still has
   * to be storable, because the coordinator is the thing that reports it
   * expired and it can only do that if it can read the row.
   */
  private ttlMs(session: StoredJourneySession): number {
    const remaining = session.expiresAtMs - this.now().getTime() + this.expiryGraceMs;
    return Math.max(1_000, Math.round(remaining));
  }
}

function encode(session: StoredJourneySession, version: number): string {
  return `${version}:${JSON.stringify(session)}`;
}

function decode(raw: string): VersionedJourneySession {
  const separator = raw.indexOf(":");
  if (separator <= 0) {
    throw new SessionStoreError("the session store holds a row with no version prefix");
  }
  const version = Number(raw.slice(0, separator));
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new SessionStoreError("the session store holds a row with an unreadable version");
  }
  let session: StoredJourneySession;
  try {
    session = JSON.parse(raw.slice(separator + 1)) as StoredJourneySession;
  } catch {
    throw new SessionStoreError("the session store holds a row that is not valid JSON");
  }
  // A row written by an older, incompatible build is refused rather than
  // half-read. Sessions are short-lived, so refusing costs one ride and
  // guessing could cost the wrong bus.
  if (!session || typeof session !== "object" || typeof session.id !== "string") {
    throw new SessionStoreError("the session store holds a row that is not a journey session");
  }
  return { session, version };
}

function expectString(value: unknown, command: string): string {
  if (typeof value !== "string") {
    throw new SessionStoreError(`the session store answered ${command} with an unexpected type`);
  }
  return value;
}
