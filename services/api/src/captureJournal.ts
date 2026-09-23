/**
 * A durable journal of one in-progress Railway capture, so a beta ride
 * survives a collector restart.
 *
 * The coordinator keeps its working state in process memory, as before. For a
 * session started `durable`, it also writes every piece of evidence here as it
 * is collected: the capture header once, then each snapshot, marker and
 * lifecycle event appended in order, and the phase whenever it changes. A new
 * process reads the journal back, rebuilds the exact `RideCapture`, and resumes
 * polling. Nothing is invented for the time the collector was down: that
 * interval is simply absent, and a `resumed` event says why.
 *
 * Exactly one process may write a journal. Ownership is a lease (a key holding
 * the owner's random instance id, with a TTL renewed by every write). Every
 * write is fenced in one atomic script: it fails whenever a different
 * collector holds the lease. A process that lost its lease — a zombie during a
 * redeploy overlap — has its writes refused and stops polling, so two
 * collectors never append to one ride.
 *
 * Operator sessions never use this: they stay process-memory, exactly as before.
 */

import type { RideCapture, RideEvent, RideMarker, RideSnapshot } from "./rideCapture.ts";
import { upstashCommand, type UpstashConnection } from "./upstashRest.ts";

export const JOURNAL_LEASE_SECONDS = 30;

export type JournalList = "snapshots" | "markers" | "events";

export interface JournalHeader {
  /** The capture without its growing lists. */
  capture: Omit<RideCapture, "snapshots" | "markers" | "events">;
  mode: "field" | "background_acceptance";
  destinationKnown: boolean;
}

export interface JournalState {
  phase: "active" | "post_alight" | "completed";
  alightedAtMs?: number;
  endedAt?: string;
}

export interface JournalRecord {
  sessionId: string;
  header: JournalHeader;
  state: JournalState;
  snapshots: RideSnapshot[];
  markers: RideMarker[];
  events: RideEvent[];
}

export class CaptureJournalError extends Error {}

export interface CaptureJournal {
  /** Take the lease and write the opening state. Throws if the lease is held elsewhere. */
  begin(sessionId: string, owner: string, header: JournalHeader, initial: Omit<JournalRecord, "sessionId" | "header">): Promise<void>;
  /** SET NX EX: take a free lease. False when another live owner holds it. */
  acquire(sessionId: string, owner: string): Promise<boolean>;
  /** Fenced append. False when `owner` no longer holds the lease; nothing was written. */
  append(sessionId: string, owner: string, list: JournalList, value: unknown): Promise<boolean>;
  /** Fenced state write. */
  setState(sessionId: string, owner: string, state: JournalState): Promise<boolean>;
  load(sessionId: string): Promise<JournalRecord | undefined>;
  /** Journals not yet closed: rides a restarted collector must pick up. */
  listOpen(): Promise<string[]>;
  /** The ride is stored (or given up); drop it from the open set and free its keys. */
  close(sessionId: string, options?: { keepEvidence?: boolean }): Promise<void>;
}

/* ------------------------------------------------------------------ memory */

/**
 * Process memory, shared between two coordinator instances in tests to
 * simulate a restart. Lease expiry follows the injected clock.
 */
export class MemoryCaptureJournal implements CaptureJournal {
  readonly values = new Map<string, string>();
  readonly lists = new Map<string, string[]>();
  readonly open = new Set<string>();
  private readonly leases = new Map<string, { owner: string; expiresAt: number }>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  async begin(sessionId: string, owner: string, header: JournalHeader, initial: Omit<JournalRecord, "sessionId" | "header">) {
    if (!await this.acquire(sessionId, owner)) throw new CaptureJournalError("journal lease is held by another collector");
    this.values.set(`${sessionId}:header`, JSON.stringify(header));
    this.values.set(`${sessionId}:state`, JSON.stringify(initial.state));
    for (const list of ["snapshots", "markers", "events"] as const) {
      this.lists.set(`${sessionId}:${list}`, initial[list].map((value) => JSON.stringify(value)));
    }
    this.open.add(sessionId);
  }

  async acquire(sessionId: string, owner: string) {
    const lease = this.leases.get(sessionId);
    if (lease && lease.expiresAt > this.now() && lease.owner !== owner) return false;
    this.leases.set(sessionId, { owner, expiresAt: this.now() + JOURNAL_LEASE_SECONDS * 1_000 });
    return true;
  }

  async append(sessionId: string, owner: string, list: JournalList, value: unknown) {
    if (!this.renew(sessionId, owner)) return false;
    const key = `${sessionId}:${list}`;
    this.lists.set(key, [...(this.lists.get(key) ?? []), JSON.stringify(value)]);
    return true;
  }

  async setState(sessionId: string, owner: string, state: JournalState) {
    if (!this.renew(sessionId, owner)) return false;
    this.values.set(`${sessionId}:state`, JSON.stringify(state));
    return true;
  }

  async load(sessionId: string) {
    const header = this.values.get(`${sessionId}:header`);
    const state = this.values.get(`${sessionId}:state`);
    if (!header || !state) return undefined;
    const read = (list: JournalList) => (this.lists.get(`${sessionId}:${list}`) ?? []).map((value) => JSON.parse(value));
    return {
      sessionId,
      header: JSON.parse(header) as JournalHeader,
      state: JSON.parse(state) as JournalState,
      snapshots: read("snapshots") as RideSnapshot[],
      markers: read("markers") as RideMarker[],
      events: read("events") as RideEvent[],
    };
  }

  async listOpen() {
    return [...this.open].sort();
  }

  async close(sessionId: string, options: { keepEvidence?: boolean } = {}) {
    this.open.delete(sessionId);
    this.leases.delete(sessionId);
    if (options.keepEvidence) return;
    this.values.delete(`${sessionId}:header`);
    this.values.delete(`${sessionId}:state`);
    for (const list of ["snapshots", "markers", "events"]) this.lists.delete(`${sessionId}:${list}`);
  }

  /** Test hook: the lease owner right now, if any. */
  leaseOwner(sessionId: string): string | undefined {
    const lease = this.leases.get(sessionId);
    return lease && lease.expiresAt > this.now() ? lease.owner : undefined;
  }

  /** Same rule as the Upstash script: refuse only a lease another live owner holds. */
  private renew(sessionId: string, owner: string): boolean {
    const lease = this.leases.get(sessionId);
    if (lease && lease.owner !== owner && lease.expiresAt > this.now()) return false;
    this.leases.set(sessionId, { owner, expiresAt: this.now() + JOURNAL_LEASE_SECONDS * 1_000 });
    return true;
  }
}

/* ------------------------------------------------------------------ upstash */

/**
 * Renew the lease and write, atomically, unless another owner holds it. A
 * lapsed lease nobody took (a long poll gap) is re-taken by its writer; one
 * held by a different collector refuses the write.
 * KEYS[1] lease, KEYS[2] target. ARGV owner, ttl, op (RPUSH|SET), value.
 */
const FENCED_WRITE = [
  "local holder = redis.call('GET', KEYS[1])",
  "if holder and holder ~= ARGV[1] then return 0 end",
  "redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))",
  "if ARGV[3] == 'RPUSH' then redis.call('RPUSH', KEYS[2], ARGV[4]) else redis.call('SET', KEYS[2], ARGV[4]) end",
  "return 1",
].join("\n");

/**
 * Keys, under the beta-tester namespace (`tapso:beta-tester:v1:`):
 *
 *   journals:open                 set of session ids with an unfinished journal
 *   journal:<id>:header           capture header (route, stops, boarded vehicle: sensitive)
 *   journal:<id>:state            {phase, alightedAtMs, endedAt}
 *   journal:<id>:snapshots        list, one JSON snapshot per poll (sensitive)
 *   journal:<id>:markers          list
 *   journal:<id>:events           list
 *   journal:<id>:lease            owner instance id, 30 s TTL
 *
 * The journal holds raw vehicle numbers and coordinates exactly like the raw
 * chunks of the field-validation store, and is deleted once the ride is stored
 * there. Key names carry only the random session id.
 */
export class UpstashCaptureJournal implements CaptureJournal {
  private readonly connection: UpstashConnection;
  private readonly prefix: string;

  constructor(connection: UpstashConnection, prefix: string) {
    this.connection = connection;
    this.prefix = prefix;
  }

  async begin(sessionId: string, owner: string, header: JournalHeader, initial: Omit<JournalRecord, "sessionId" | "header">) {
    if (!await this.acquire(sessionId, owner)) throw new CaptureJournalError("journal lease is held by another collector");
    // A fresh session id, so these keys cannot already hold another ride.
    await this.command(["SET", this.key(sessionId, "header"), JSON.stringify(header)]);
    await this.command(["SET", this.key(sessionId, "state"), JSON.stringify(initial.state)]);
    for (const list of ["snapshots", "markers", "events"] as const) {
      if (initial[list].length === 0) continue;
      await this.command(["RPUSH", this.key(sessionId, list), ...initial[list].map((value) => JSON.stringify(value))]);
    }
    await this.command(["SADD", `${this.prefix}journals:open`, sessionId]);
  }

  async acquire(sessionId: string, owner: string) {
    const key = this.key(sessionId, "lease");
    if (await this.command(["SET", key, owner, "NX", "EX", String(JOURNAL_LEASE_SECONDS)]) === "OK") return true;
    // Re-acquiring our own (or a lapsed) lease is a renewal, not a conflict.
    return await this.fenced(sessionId, owner, "SET", this.key(sessionId, "lease-check"), "1");
  }

  async append(sessionId: string, owner: string, list: JournalList, value: unknown) {
    return this.fenced(sessionId, owner, "RPUSH", this.key(sessionId, list), JSON.stringify(value));
  }

  async setState(sessionId: string, owner: string, state: JournalState) {
    return this.fenced(sessionId, owner, "SET", this.key(sessionId, "state"), JSON.stringify(state));
  }

  async load(sessionId: string) {
    const [header, state] = await Promise.all([
      this.command(["GET", this.key(sessionId, "header")]),
      this.command(["GET", this.key(sessionId, "state")]),
    ]);
    if (typeof header !== "string" || typeof state !== "string") return undefined;
    const read = async (list: JournalList) => {
      const values = await this.command(["LRANGE", this.key(sessionId, list), "0", "-1"]);
      return (Array.isArray(values) ? values : []).map((value) => JSON.parse(String(value)));
    };
    return {
      sessionId,
      header: JSON.parse(header) as JournalHeader,
      state: JSON.parse(state) as JournalState,
      snapshots: await read("snapshots") as RideSnapshot[],
      markers: await read("markers") as RideMarker[],
      events: await read("events") as RideEvent[],
    };
  }

  async listOpen() {
    const ids = await this.command(["SMEMBERS", `${this.prefix}journals:open`]);
    return (Array.isArray(ids) ? ids.map(String) : []).sort();
  }

  async close(sessionId: string, options: { keepEvidence?: boolean } = {}) {
    await this.command(["SREM", `${this.prefix}journals:open`, sessionId]);
    const keys = options.keepEvidence
      ? ["lease", "lease-check"]
      : ["header", "state", "snapshots", "markers", "events", "lease", "lease-check"];
    await this.command(["DEL", ...keys.map((part) => this.key(sessionId, part))]);
  }

  private async fenced(sessionId: string, owner: string, op: "RPUSH" | "SET", target: string, value: string): Promise<boolean> {
    const reply = await this.command([
      "EVAL", FENCED_WRITE, "2", this.key(sessionId, "lease"), target, owner, String(JOURNAL_LEASE_SECONDS), op, value,
    ]);
    return Number(reply) === 1;
  }

  private key(sessionId: string, part: string): string {
    return `${this.prefix}journal:${sessionId}:${part}`;
  }

  private command(command: string[]): Promise<unknown> {
    return upstashCommand(this.connection, command, "the capture journal", (message) => new CaptureJournalError(message));
  }
}
