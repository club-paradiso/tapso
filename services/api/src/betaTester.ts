/**
 * Beta-tester identity: invites, scoped credentials, and capture ownership.
 *
 * A beta tester is a friend with a private link, not an operator. The only
 * secret they ever hold is their own tester credential, and that credential
 * can do exactly five things: authenticate, start one capture, read, finish
 * and (implicitly) submit captures it owns. It can never read a raw capture,
 * read a campaign, administer invites, or reach an operator route, and nothing
 * about it is derived from `RIDE_CAPTURE_OPERATOR_TOKEN`.
 *
 * Secrets:
 *   invite secret      `tbi_` + 32 random bytes (base64url). Shown once, to the
 *                      operator, inside the share link's URL fragment.
 *   tester credential  `tbt_` + 32 random bytes (base64url). Issued once, when
 *                      the invite is redeemed, and held by the tester's browser.
 * Only SHA-256 digests of either are stored. Both are 256-bit random values,
 * so a fast hash is enough: there is no low-entropy password to stretch.
 *
 * Storage is the collector's existing Upstash database, under its own
 * `tapso:beta-tester:v1:` namespace. Key names carry random ids or secret
 * digests only, never a route, a stop, a vehicle or a time.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { upstashCommand, type UpstashConnection } from "./upstashRest.ts";

export const BETA_TESTER_KEY_PREFIX = "tapso:beta-tester:v1:";
export const INVITE_SECRET_PREFIX = "tbi_";
export const TESTER_CREDENTIAL_PREFIX = "tbt_";
export const DEFAULT_INVITE_DAYS = 14;
export const MAX_INVITE_DAYS = 30;
export const DEFAULT_MAX_RIDES = 10;
export const MAX_MAX_RIDES = 50;
export const MAX_LABEL_LENGTH = 40;
/**
 * After a tester's access expires they may still read and finish a capture
 * they started before it expired, for this long. A ride is capped at 90
 * minutes and a completed session is held for two hours, so this covers a
 * normal ride that straddles the expiry without keeping access open for days.
 */
export const EXPIRED_ACTIVE_RIDE_GRACE_MS = 4 * 60 * 60 * 1_000;

const SECRET_BODY = /^[A-Za-z0-9_-]{43}$/;

export class BetaTesterError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ records */

export interface BetaInvite {
  id: string;
  /** SHA-256 of the invite secret. The secret itself is never stored. */
  secretHash: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  maxRides: number;
  /** Set once, on the one successful redemption. */
  testerId?: string;
  redeemedAt?: string;
}

export interface BetaCredentialRecord {
  testerId: string;
  inviteId: string;
  createdAt: string;
}

export type BetaCaptureState =
  /** Registered; the collector has not confirmed the start yet. */
  | "starting"
  /** The collector is recording. */
  | "recording"
  /** The tester tapped 하차 완료; the collector is closing the capture. */
  | "finishing"
  /** The capture is complete and was stored in the beta campaign. Terminal. */
  | "submitted"
  /** The capture is complete but storing it failed; retried on the next read. */
  | "submit_failed"
  /** The collector no longer holds the capture (restart or retention). Terminal. */
  | "lost"
  /** The start never reached the collector. Terminal. */
  | "start_failed"
  /** The tester was revoked before the ride was stored; held for the operator. Terminal. */
  | "held_revoked";

export const TERMINAL_CAPTURE_STATES: ReadonlySet<BetaCaptureState> = new Set([
  "submitted",
  "lost",
  "start_failed",
  "held_revoked",
]);

export interface BetaCaptureOwnership {
  sessionId: string;
  testerId: string;
  inviteId: string;
  createdAt: string;
  state: BetaCaptureState;
  /** What the tester typed and picked. Their own ride, shown back only to them. */
  display: { routeNo: string; boardingStopName: string; destinationStopName?: string };
  finishRequestedAt?: string;
  submissionId?: string;
  submittedAt?: string;
  /** Operator-facing only. */
  bucket?: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ secrets */

export function newInviteSecret(): string {
  return INVITE_SECRET_PREFIX + randomBytes(32).toString("base64url");
}

export function newTesterCredential(): string {
  return TESTER_CREDENTIAL_PREFIX + randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Shape check before any lookup, so junk never reaches the store. */
export function wellFormedSecret(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.startsWith(prefix) && SECRET_BODY.test(value.slice(prefix.length));
}

export function digestsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function newInviteId(): string {
  return `inv_${randomBytes(9).toString("base64url")}`;
}

export function newTesterId(): string {
  return `tst_${randomUUID().replace(/-/g, "")}`;
}

/* ------------------------------------------------------------------ store */

export interface BetaTesterStore {
  putInvite(invite: BetaInvite): Promise<void>;
  getInvite(inviteId: string): Promise<BetaInvite | undefined>;
  listInvites(): Promise<BetaInvite[]>;
  /** secret digest → invite id, written once at creation. */
  putInviteSecretIndex(secretHash: string, inviteId: string): Promise<void>;
  findInviteBySecretHash(secretHash: string): Promise<string | undefined>;
  /** SET NX: exactly one redemption per invite, ever. */
  claimRedemption(inviteId: string, testerId: string): Promise<{ claimed: boolean; testerId: string }>;
  getRedemption(inviteId: string): Promise<string | undefined>;
  putCredential(credentialHash: string, record: BetaCredentialRecord): Promise<void>;
  getCredential(credentialHash: string): Promise<BetaCredentialRecord | undefined>;
  putCapture(record: BetaCaptureOwnership): Promise<void>;
  getCapture(sessionId: string): Promise<BetaCaptureOwnership | undefined>;
  getActive(testerId: string): Promise<string | undefined>;
  setActive(testerId: string, sessionId: string): Promise<void>;
  clearActive(testerId: string): Promise<void>;
  /** SADD: a ride slot per started session, idempotent. */
  addRide(testerId: string, sessionId: string): Promise<void>;
  removeRide(testerId: string, sessionId: string): Promise<void>;
  countRides(testerId: string): Promise<number>;
  /** SET NX with expiry: one start at a time per tester. */
  acquireStartLock(testerId: string, ttlSeconds: number): Promise<boolean>;
  releaseStartLock(testerId: string): Promise<void>;
  /** SET NX with expiry: one submission attempt per ride at a time, across collectors. */
  acquireSubmitLock(sessionId: string, ttlSeconds: number): Promise<boolean>;
  releaseSubmitLock(sessionId: string): Promise<void>;
}

/** Process memory. Tests only; never used by the deployed collector. */
export class MemoryBetaTesterStore implements BetaTesterStore {
  readonly values = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();

  async putInvite(invite: BetaInvite) {
    this.values.set(`invite:${invite.id}`, JSON.stringify(invite));
    this.set("invites").add(invite.id);
  }
  async getInvite(inviteId: string) {
    return this.json<BetaInvite>(`invite:${inviteId}`);
  }
  async listInvites() {
    const invites: BetaInvite[] = [];
    for (const id of this.set("invites")) {
      const invite = await this.getInvite(id);
      if (invite) invites.push(invite);
    }
    return invites.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  async putInviteSecretIndex(secretHash: string, inviteId: string) {
    this.values.set(`invite-secret:${secretHash}`, inviteId);
  }
  async findInviteBySecretHash(secretHash: string) {
    return this.values.get(`invite-secret:${secretHash}`);
  }
  async claimRedemption(inviteId: string, testerId: string) {
    const key = `invite:${inviteId}:redeemed`;
    const existing = this.values.get(key);
    if (existing) return { claimed: false, testerId: existing };
    this.values.set(key, testerId);
    return { claimed: true, testerId };
  }
  async getRedemption(inviteId: string) {
    return this.values.get(`invite:${inviteId}:redeemed`);
  }
  async putCredential(credentialHash: string, record: BetaCredentialRecord) {
    this.values.set(`credential:${credentialHash}`, JSON.stringify(record));
  }
  async getCredential(credentialHash: string) {
    return this.json<BetaCredentialRecord>(`credential:${credentialHash}`);
  }
  async putCapture(record: BetaCaptureOwnership) {
    this.values.set(`capture:${record.sessionId}`, JSON.stringify(record));
  }
  async getCapture(sessionId: string) {
    return this.json<BetaCaptureOwnership>(`capture:${sessionId}`);
  }
  async getActive(testerId: string) {
    return this.values.get(`tester:${testerId}:active`);
  }
  async setActive(testerId: string, sessionId: string) {
    this.values.set(`tester:${testerId}:active`, sessionId);
  }
  async clearActive(testerId: string) {
    this.values.delete(`tester:${testerId}:active`);
  }
  async addRide(testerId: string, sessionId: string) {
    this.set(`tester:${testerId}:rides`).add(sessionId);
  }
  async removeRide(testerId: string, sessionId: string) {
    this.set(`tester:${testerId}:rides`).delete(sessionId);
  }
  async countRides(testerId: string) {
    return this.set(`tester:${testerId}:rides`).size;
  }
  async acquireStartLock(testerId: string) {
    const key = `tester:${testerId}:start-lock`;
    if (this.values.has(key)) return false;
    this.values.set(key, "1");
    return true;
  }
  async releaseStartLock(testerId: string) {
    this.values.delete(`tester:${testerId}:start-lock`);
  }
  async acquireSubmitLock(sessionId: string) {
    const key = `capture:${sessionId}:submit-lock`;
    if (this.values.has(key)) return false;
    this.values.set(key, "1");
    return true;
  }
  async releaseSubmitLock(sessionId: string) {
    this.values.delete(`capture:${sessionId}:submit-lock`);
  }

  private set(key: string): Set<string> {
    let set = this.sets.get(key);
    if (!set) {
      set = new Set();
      this.sets.set(key, set);
    }
    return set;
  }
  private json<T>(key: string): T | undefined {
    const value = this.values.get(key);
    return value ? JSON.parse(value) as T : undefined;
  }
}

/**
 * Upstash Redis over REST. Keys, all under `BETA_TESTER_KEY_PREFIX`:
 *
 *   invites                          set of invite ids
 *   invite:<inviteId>                BetaInvite (secret digest, never the secret)
 *   invite-secret:<sha256(secret)>   invite id
 *   invite:<inviteId>:redeemed       tester id (SET NX; single use)
 *   credential:<sha256(credential)>  {testerId, inviteId, createdAt}
 *   capture:<sessionId>              BetaCaptureOwnership
 *   tester:<testerId>:active         session id of the tester's open capture
 *   tester:<testerId>:rides          set of session ids started (ride budget)
 *   tester:<testerId>:start-lock     "1", 30 s expiry
 *   capture:<sessionId>:submit-lock  "1", 60 s expiry
 *   journal:<sessionId>:*            the in-progress ride's durable evidence (captureJournal.ts)
 *
 * Only the locks and journal leases expire. Invites and ownership are small audit records;
 * like the field-validation store, this database must not evict keys.
 */
export class UpstashBetaTesterStore implements BetaTesterStore {
  private readonly connection: UpstashConnection;
  private readonly prefix: string;

  constructor(connection: UpstashConnection, prefix = BETA_TESTER_KEY_PREFIX) {
    this.connection = connection;
    this.prefix = prefix;
  }

  async putInvite(invite: BetaInvite) {
    await this.command(["SET", this.key(`invite:${invite.id}`), JSON.stringify(invite)]);
    await this.command(["SADD", this.key("invites"), invite.id]);
  }
  async getInvite(inviteId: string) {
    return this.json<BetaInvite>(`invite:${inviteId}`);
  }
  async listInvites() {
    const ids = await this.command(["SMEMBERS", this.key("invites")]);
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const values = await this.command(["MGET", ...ids.map((id) => this.key(`invite:${String(id)}`))]);
    return (Array.isArray(values) ? values : [])
      .filter((value): value is string => typeof value === "string")
      .map((value) => JSON.parse(value) as BetaInvite)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  async putInviteSecretIndex(secretHash: string, inviteId: string) {
    await this.command(["SET", this.key(`invite-secret:${secretHash}`), inviteId]);
  }
  async findInviteBySecretHash(secretHash: string) {
    const value = await this.command(["GET", this.key(`invite-secret:${secretHash}`)]);
    return typeof value === "string" ? value : undefined;
  }
  async claimRedemption(inviteId: string, testerId: string) {
    const key = this.key(`invite:${inviteId}:redeemed`);
    if (await this.command(["SET", key, testerId, "NX"]) === "OK") return { claimed: true, testerId };
    const existing = await this.command(["GET", key]);
    if (typeof existing !== "string") throw new BetaTesterError(503, "BETA_STORAGE_FAILED", "an invite claim vanished");
    return { claimed: false, testerId: existing };
  }
  async getRedemption(inviteId: string) {
    const value = await this.command(["GET", this.key(`invite:${inviteId}:redeemed`)]);
    return typeof value === "string" ? value : undefined;
  }
  async putCredential(credentialHash: string, record: BetaCredentialRecord) {
    await this.command(["SET", this.key(`credential:${credentialHash}`), JSON.stringify(record)]);
  }
  async getCredential(credentialHash: string) {
    return this.json<BetaCredentialRecord>(`credential:${credentialHash}`);
  }
  async putCapture(record: BetaCaptureOwnership) {
    await this.command(["SET", this.key(`capture:${record.sessionId}`), JSON.stringify(record)]);
  }
  async getCapture(sessionId: string) {
    return this.json<BetaCaptureOwnership>(`capture:${sessionId}`);
  }
  async getActive(testerId: string) {
    const value = await this.command(["GET", this.key(`tester:${testerId}:active`)]);
    return typeof value === "string" ? value : undefined;
  }
  async setActive(testerId: string, sessionId: string) {
    await this.command(["SET", this.key(`tester:${testerId}:active`), sessionId]);
  }
  async clearActive(testerId: string) {
    await this.command(["DEL", this.key(`tester:${testerId}:active`)]);
  }
  async addRide(testerId: string, sessionId: string) {
    await this.command(["SADD", this.key(`tester:${testerId}:rides`), sessionId]);
  }
  async removeRide(testerId: string, sessionId: string) {
    await this.command(["SREM", this.key(`tester:${testerId}:rides`), sessionId]);
  }
  async countRides(testerId: string) {
    const value = await this.command(["SCARD", this.key(`tester:${testerId}:rides`)]);
    return typeof value === "number" ? value : Number(value ?? 0);
  }
  async acquireStartLock(testerId: string, ttlSeconds: number) {
    return await this.command(["SET", this.key(`tester:${testerId}:start-lock`), "1", "NX", "EX", String(ttlSeconds)]) === "OK";
  }
  async releaseStartLock(testerId: string) {
    await this.command(["DEL", this.key(`tester:${testerId}:start-lock`)]);
  }
  async acquireSubmitLock(sessionId: string, ttlSeconds: number) {
    return await this.command(["SET", this.key(`capture:${sessionId}:submit-lock`), "1", "NX", "EX", String(ttlSeconds)]) === "OK";
  }
  async releaseSubmitLock(sessionId: string) {
    await this.command(["DEL", this.key(`capture:${sessionId}:submit-lock`)]);
  }

  private async json<T>(suffix: string): Promise<T | undefined> {
    const value = await this.command(["GET", this.key(suffix)]);
    return typeof value === "string" ? JSON.parse(value) as T : undefined;
  }
  private key(suffix: string): string {
    return `${this.prefix}${suffix}`;
  }
  private command(command: string[]): Promise<unknown> {
    return upstashCommand(this.connection, command, "the beta-tester store",
      (message) => new BetaTesterError(503, "BETA_STORAGE_FAILED", message));
  }
}
