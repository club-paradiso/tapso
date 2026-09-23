/**
 * The beta-tester ride flow, on top of the existing collector.
 *
 *   invite → redeem → tester credential
 *   start   → the collector's own BackgroundRideCaptureCoordinator.start
 *   finish  → the coordinator's own alight
 *   complete→ submitCompletedCapture into the beta campaign, automatically
 *
 * There is no second capture engine and no second matcher: capture, analysis,
 * replay, dedupe and storage are the production paths PR #51 already uses. What
 * this adds is who may touch which capture, and doing the submit for the tester.
 *
 * Ownership is enforced here, on the server, for every capture operation: the
 * ownership record written at start names one tester, and a request from any
 * other credential gets the same 404 a nonexistent session gets, so a guessed
 * or swapped session id reveals nothing.
 */

import { randomUUID } from "node:crypto";

import {
  BETA_MATCHER_CAMPAIGN_ID,
  summarizeBetaCampaign,
  type BetaCampaignSummary,
} from "./betaCampaign.ts";
import {
  BackgroundRideCaptureError,
  type BackgroundCaptureStartInput,
  type BackgroundCaptureStatus,
  type BackgroundRideCaptureCoordinator,
} from "./backgroundRideCapture.ts";
import {
  BetaTesterError,
  DEFAULT_INVITE_DAYS,
  DEFAULT_MAX_RIDES,
  EXPIRED_ACTIVE_RIDE_GRACE_MS,
  INVITE_SECRET_PREFIX,
  MAX_INVITE_DAYS,
  MAX_LABEL_LENGTH,
  MAX_MAX_RIDES,
  TERMINAL_CAPTURE_STATES,
  TESTER_CREDENTIAL_PREFIX,
  digestsEqual,
  hashSecret,
  newInviteId,
  newInviteSecret,
  newTesterCredential,
  newTesterId,
  wellFormedSecret,
  type BetaCaptureOwnership,
  type BetaInvite,
  type BetaTesterStore,
} from "./betaTester.ts";
import type { CaptureJournal } from "./captureJournal.ts";
import type { VehicleObservation } from "./domain.ts";
import { FieldValidationError, submitCompletedCapture, type FieldValidationStore } from "./fieldValidation.ts";
import type { TransitProvider } from "./provider.ts";

const ROUTE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CITY_CODE = /^[0-9]{1,6}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const START_LOCK_SECONDS = 30;
const DAY_MS = 24 * 60 * 60 * 1_000;
const BETA_INTERVAL_MS = 5_000;
const SUBMIT_LOCK_SECONDS = 60;

export interface BetaPrincipal {
  testerId: string;
  inviteId: string;
  invite: BetaInvite;
  /** Past `expiresAt`. Such a tester may only finish a ride started before it. */
  expired: boolean;
}

/** Everything a tester ever learns about a ride. No bucket, no count, no vehicle. */
export interface BetaRideView {
  sessionId: string;
  state: "recording" | "finishing" | "saving" | "done" | "retry" | "lost";
  routeNo: string;
  boardingStopName: string;
  destinationStopName?: string;
  startedAt: string;
  /** The collector closed the ride at its 90-minute cap before the tester finished it. */
  endedAutomatically?: boolean;
}

export interface BetaMeView {
  expiresAt: string;
  status: "active" | "expired";
  ridesUsed: number;
  maxRides: number;
  canStart: boolean;
  activeRide?: BetaRideView;
}

export interface BetaInviteView {
  inviteId: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "active" | "expired" | "revoked";
  redeemedAt?: string;
  revokedAt?: string;
  ridesUsed: number;
  maxRides: number;
}

export interface BetaStartInput {
  routeId: unknown;
  cityCode: unknown;
  routeNo: unknown;
  plateSuffix: unknown;
  boardingStopSequence: unknown;
  destinationStopSequence?: unknown;
}

export interface BetaServiceOptions {
  store: BetaTesterStore;
  fieldValidation: FieldValidationStore;
  captures: Pick<BackgroundRideCaptureCoordinator, "start" | "status" | "completedCapture" | "alight" | "restore" | "flush">;
  provider: Pick<TransitProvider, "stops" | "vehicles">;
  /**
   * Durable evidence for beta rides. With it, a ride survives a collector
   * restart; without it (tests of the in-memory path only), a restart loses
   * the ride and says so.
   */
  journal?: CaptureJournal;
  now?: () => Date;
  log?: (line: string) => void;
}

export class BetaService {
  private readonly store: BetaTesterStore;
  private readonly fieldValidation: FieldValidationStore;
  private readonly captures: BetaServiceOptions["captures"];
  private readonly provider: BetaServiceOptions["provider"];
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  private readonly journal?: CaptureJournal;
  private readonly submitting = new Map<string, Promise<BetaCaptureOwnership>>();

  constructor(options: BetaServiceOptions) {
    this.store = options.store;
    this.fieldValidation = options.fieldValidation;
    this.captures = options.captures;
    this.provider = options.provider;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((line) => console.info(line));
    this.journal = options.journal;
  }

  /* ------------------------------------------------------------ operator */

  async createInvite(input: { label?: unknown; days?: unknown; maxRides?: unknown }): Promise<{ invite: BetaInviteView; secret: string }> {
    const label = cleanLabel(input.label);
    const days = boundedInteger(input.days, DEFAULT_INVITE_DAYS, 1, MAX_INVITE_DAYS, "days");
    const maxRides = boundedInteger(input.maxRides, DEFAULT_MAX_RIDES, 1, MAX_MAX_RIDES, "maxRides");
    const secret = newInviteSecret();
    const now = this.now();
    const invite: BetaInvite = {
      id: newInviteId(),
      secretHash: hashSecret(secret),
      label,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
      maxRides,
    };
    // Index first: an invite record that exists is always redeemable.
    await this.store.putInviteSecretIndex(invite.secretHash, invite.id);
    await this.store.putInvite(invite);
    return { invite: await this.inviteView(invite), secret };
  }

  async listInvites(): Promise<BetaInviteView[]> {
    const invites = await this.store.listInvites();
    return Promise.all(invites.map((invite) => this.inviteView(invite)));
  }

  async revokeInvite(inviteId: string): Promise<BetaInviteView> {
    if (!/^inv_[A-Za-z0-9_-]{1,32}$/.test(inviteId)) throw new BetaTesterError(404, "NOT_FOUND", "no such invite");
    const invite = await this.store.getInvite(inviteId);
    if (!invite) throw new BetaTesterError(404, "NOT_FOUND", "no such invite");
    if (!invite.revokedAt) {
      invite.revokedAt = this.now().toISOString();
      await this.store.putInvite(invite);
    }
    return this.inviteView(invite);
  }

  async campaign(): Promise<BetaCampaignSummary> {
    return summarizeBetaCampaign(BETA_MATCHER_CAMPAIGN_ID, await this.fieldValidation.listCampaign(BETA_MATCHER_CAMPAIGN_ID));
  }

  /** Whether a collector session belongs to a beta tester. Used to keep beta rides out of v1. */
  async isBetaCapture(sessionId: string): Promise<boolean> {
    return Boolean(await this.store.getCapture(sessionId));
  }

  /* ------------------------------------------------------------ tester auth */

  /**
   * Exchange an invite secret for a tester credential. Single use: the first
   * redemption wins, and a second presentation of the same link — forwarded,
   * replayed, or reopened — is refused.
   */
  async redeem(secret: unknown): Promise<{ credential: string; expiresAt: string; maxRides: number }> {
    if (!wellFormedSecret(secret, INVITE_SECRET_PREFIX)) {
      throw new BetaTesterError(401, "INVITE_INVALID", "this invite link is not valid");
    }
    const secretHash = hashSecret(secret);
    const inviteId = await this.store.findInviteBySecretHash(secretHash);
    const invite = inviteId ? await this.store.getInvite(inviteId) : undefined;
    if (!invite || !digestsEqual(invite.secretHash, secretHash)) {
      throw new BetaTesterError(401, "INVITE_INVALID", "this invite link is not valid");
    }
    if (invite.revokedAt) throw new BetaTesterError(410, "INVITE_REVOKED", "this invite link was revoked");
    if (this.now().getTime() >= Date.parse(invite.expiresAt)) {
      throw new BetaTesterError(410, "INVITE_EXPIRED", "this invite link has expired");
    }

    const testerId = newTesterId();
    const credential = newTesterCredential();
    // The credential record is written before the claim, and authentication
    // checks it against the claim, so a credential whose claim lost the race
    // is inert rather than half-valid.
    await this.store.putCredential(hashSecret(credential), {
      testerId,
      inviteId: invite.id,
      createdAt: this.now().toISOString(),
    });
    const claim = await this.store.claimRedemption(invite.id, testerId);
    if (!claim.claimed) throw new BetaTesterError(409, "INVITE_USED", "this invite link was already used");
    invite.testerId = testerId;
    invite.redeemedAt = this.now().toISOString();
    await this.store.putInvite(invite);
    return { credential, expiresAt: invite.expiresAt, maxRides: invite.maxRides };
  }

  async authenticate(credential: string | undefined): Promise<BetaPrincipal> {
    if (!wellFormedSecret(credential, TESTER_CREDENTIAL_PREFIX)) {
      throw new BetaTesterError(401, "BETA_UNAUTHORIZED", "beta tester authorization required");
    }
    const record = await this.store.getCredential(hashSecret(credential));
    const invite = record ? await this.store.getInvite(record.inviteId) : undefined;
    if (!record || !invite) throw new BetaTesterError(401, "BETA_UNAUTHORIZED", "beta tester authorization required");
    const redeemedBy = invite.testerId ?? await this.store.getRedemption(invite.id);
    if (redeemedBy !== record.testerId) {
      throw new BetaTesterError(401, "BETA_UNAUTHORIZED", "beta tester authorization required");
    }
    if (invite.revokedAt) throw new BetaTesterError(401, "BETA_REVOKED", "this beta access was revoked");
    return {
      testerId: record.testerId,
      inviteId: invite.id,
      invite,
      expired: this.now().getTime() >= Date.parse(invite.expiresAt),
    };
  }

  /* ------------------------------------------------------------ tester flow */

  async me(principal: BetaPrincipal): Promise<BetaMeView> {
    let activeRide: BetaRideView | undefined;
    const activeId = await this.store.getActive(principal.testerId);
    if (activeId) {
      const own = await this.store.getCapture(activeId);
      if (own && own.testerId === principal.testerId && this.withinAccess(principal, own)) {
        activeRide = this.view(await this.advance(own));
      }
    }
    // Counted after advancing: a ride lost to a collector restart hands its slot back.
    const ridesUsed = await this.store.countRides(principal.testerId);
    return {
      expiresAt: principal.invite.expiresAt,
      status: principal.expired ? "expired" : "active",
      ridesUsed,
      maxRides: principal.invite.maxRides,
      canStart: !principal.expired && ridesUsed < principal.invite.maxRides
        && (!activeRide || activeRide.state === "done" || activeRide.state === "lost"),
      ...(activeRide ? { activeRide } : {}),
    };
  }

  async start(principal: BetaPrincipal, input: BetaStartInput): Promise<BetaRideView> {
    if (principal.expired) throw new BetaTesterError(403, "BETA_EXPIRED", "this beta access has expired");
    const parsed = parseStart(input);
    if (!await this.store.acquireStartLock(principal.testerId, START_LOCK_SECONDS)) {
      throw new BetaTesterError(409, "BETA_BUSY", "a ride is already being started");
    }
    try {
      const activeId = await this.store.getActive(principal.testerId);
      if (activeId) {
        const own = await this.store.getCapture(activeId);
        const current = own ? await this.advance(own) : undefined;
        if (current && !TERMINAL_CAPTURE_STATES.has(current.state)) {
          throw new BetaTesterError(409, "BETA_RIDE_IN_PROGRESS", "finish the ride in progress first");
        }
        await this.store.clearActive(principal.testerId);
      }
      if (await this.store.countRides(principal.testerId) >= principal.invite.maxRides) {
        throw new BetaTesterError(403, "BETA_RIDE_LIMIT", "this beta access has no rides left");
      }

      const request = { routeId: parsed.routeId, cityCode: parsed.cityCode };
      const stops = await this.provider.stops(request);
      const boarding = stops.find((stop) => stop.sequence === parsed.boardingStopSequence);
      if (!boarding) throw new BetaTesterError(400, "INVALID_INPUT", "the boarding stop is not on this route");
      let destination = parsed.destinationStopSequence === undefined
        ? undefined
        : stops.find((stop) => stop.sequence === parsed.destinationStopSequence);
      if (parsed.destinationStopSequence !== undefined && (!destination || destination.sequence <= boarding.sequence)) {
        throw new BetaTesterError(400, "INVALID_INPUT", "the destination must come after the boarding stop");
      }
      const lastSequence = Math.max(...stops.map((stop) => stop.sequence));
      if (lastSequence <= boarding.sequence) {
        throw new BetaTesterError(400, "INVALID_INPUT", "the boarding stop is the last stop on this route");
      }

      // The tester's plate suffix is resolved on an uncached provider read,
      // and must name exactly one bus on this route. The full vehicle number
      // never goes back to the browser.
      const vehicles = await this.provider.vehicles(request);
      const matches = vehicles.filter((vehicle) => plateSuffix(vehicle.vehicleId) === parsed.plateSuffix);
      if (matches.length === 0) throw new BetaTesterError(409, "BUS_NOT_FOUND", "no bus on this route has that plate right now");
      if (matches.length > 1) throw new BetaTesterError(409, "BUS_AMBIGUOUS", "more than one bus on this route has that plate suffix");
      const vehicle = matches[0] as VehicleObservation;

      const sessionId = randomUUID();
      const nowIso = this.now().toISOString();
      const own: BetaCaptureOwnership = {
        sessionId,
        testerId: principal.testerId,
        inviteId: principal.inviteId,
        createdAt: nowIso,
        state: "starting",
        display: {
          routeNo: parsed.routeNo,
          boardingStopName: boarding.name,
          ...(destination ? { destinationStopName: destination.name } : {}),
        },
        updatedAt: nowIso,
      };
      // Ownership exists before the collector does anything with this id.
      await this.store.putCapture(own);
      await this.store.setActive(principal.testerId, sessionId);
      await this.store.addRide(principal.testerId, sessionId);

      const startInput: BackgroundCaptureStartInput = {
        sessionId,
        routeId: parsed.routeId,
        cityCode: parsed.cityCode,
        boardedVehicleId: vehicle.vehicleId,
        boardingStopSequence: boarding.sequence,
        destinationStopSequence: destination?.sequence ?? lastSequence,
        destinationKnown: Boolean(destination),
        intervalMs: BETA_INTERVAL_MS,
        durable: Boolean(this.journal),
      };
      let started: BackgroundCaptureStatus;
      try {
        started = await this.captures.start(startInput);
      } catch (error) {
        await this.save(own, { state: "start_failed" });
        await this.store.clearActive(principal.testerId);
        await this.store.removeRide(principal.testerId, sessionId);
        if (error instanceof BackgroundRideCaptureError && error.kind === "conflict") {
          throw new BetaTesterError(409, "BUS_NOT_FOUND", "the bus is no longer reported on this route");
        }
        throw error;
      }
      if (started.captureEngine !== "railway-background") {
        throw new BetaTesterError(503, "BETA_UNAVAILABLE", "the collector did not confirm background capture");
      }
      return this.view(await this.save(own, { state: "recording" }));
    } finally {
      await this.store.releaseStartLock(principal.testerId).catch(() => undefined);
    }
  }

  async ride(principal: BetaPrincipal, sessionId: string): Promise<BetaRideView> {
    const own = await this.owned(principal, sessionId);
    return this.view(await this.advance(own));
  }

  /**
   * The one thing a tester does when getting off. Idempotent: a double tap, a
   * retry, or a tap after the ride already closed returns the same ride and
   * never creates, counts or submits anything twice.
   */
  async finish(principal: BetaPrincipal, sessionId: string): Promise<BetaRideView> {
    let own = await this.owned(principal, sessionId);
    if (TERMINAL_CAPTURE_STATES.has(own.state)) return this.view(own);
    if (own.state === "starting") throw new BetaTesterError(409, "BETA_NOT_STARTED", "the ride has not started yet");
    // The request is recorded first, so it is honoured wherever the ride runs:
    // here, or by the collector that still holds it after a restart.
    const requestedAt = own.finishRequestedAt ?? this.now().toISOString();
    if (!own.finishRequestedAt) own = await this.save(own, { finishRequestedAt: requestedAt });
    if (!await this.ensureLocal(own)) {
      return this.view(own.state === "recording" ? await this.save(own, { state: "finishing" }) : own);
    }
    try {
      this.captures.alight(sessionId, requestedAt);
      // The alight marker and phase are durable before we answer.
      await this.captures.flush(sessionId);
    } catch (error) {
      if (!(error instanceof BackgroundRideCaptureError && error.kind === "not_found")) throw error;
    }
    if (own.state === "recording") own = await this.save(own, { state: "finishing" });
    return this.view(await this.advance(own));
  }

  /**
   * Pick up every journaled beta ride this process does not run yet. Called at
   * startup and periodically; safe to call any number of times. A ride whose
   * lease another live collector holds is left to that collector.
   */
  async recoverAll(): Promise<{ restored: number; skipped: number; closed: number }> {
    const result = { restored: 0, skipped: 0, closed: 0 };
    if (!this.journal) return result;
    for (const sessionId of await this.journal.listOpen()) {
      try {
        const own = await this.store.getCapture(sessionId);
        if (!own || TERMINAL_CAPTURE_STATES.has(own.state)) {
          // Nothing left to collect. Keep the evidence unless it was stored.
          await this.journal.close(sessionId, { keepEvidence: own?.state !== "submitted" });
          result.closed += 1;
          continue;
        }
        if (await this.ensureLocal(own)) {
          result.restored += 1;
          await this.advance(own);
        } else {
          result.skipped += 1;
        }
      } catch (error) {
        result.skipped += 1;
        this.log(JSON.stringify({
          timestamp: this.now().toISOString(),
          level: "warn",
          event: "beta_recovery_failed",
          message: error instanceof Error ? error.message.slice(0, 200) : "unknown",
        }));
      }
    }
    return result;
  }

  /** Called by the coordinator when any capture completes. Submits beta rides nobody is waiting on. */
  async onCaptureComplete(sessionId: string): Promise<void> {
    try {
      const own = await this.store.getCapture(sessionId);
      if (!own || TERMINAL_CAPTURE_STATES.has(own.state)) return;
      await this.advance(own);
    } catch (error) {
      this.log(JSON.stringify({
        timestamp: this.now().toISOString(),
        level: "warn",
        event: "beta_auto_submit_failed",
        message: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }));
    }
  }

  /* ------------------------------------------------------------ internals */

  private async owned(principal: BetaPrincipal, sessionId: string): Promise<BetaCaptureOwnership> {
    // Nonexistent and someone else's are indistinguishable on purpose.
    if (!SESSION_ID.test(sessionId)) throw notFound();
    const own = await this.store.getCapture(sessionId);
    if (!own || own.testerId !== principal.testerId) throw notFound();
    if (!this.withinAccess(principal, own)) throw new BetaTesterError(403, "BETA_EXPIRED", "this beta access has expired");
    return own;
  }

  /** An expired tester keeps their own ride that started before expiry, for a bounded grace. */
  private withinAccess(principal: BetaPrincipal, own: BetaCaptureOwnership): boolean {
    if (!principal.expired) return true;
    const expiresAt = Date.parse(principal.invite.expiresAt);
    return Date.parse(own.createdAt) < expiresAt && this.now().getTime() < expiresAt + EXPIRED_ACTIVE_RIDE_GRACE_MS;
  }

  /** Move an ownership record forward to match the collector, submitting when complete. */
  private async advance(own: BetaCaptureOwnership): Promise<BetaCaptureOwnership> {
    if (TERMINAL_CAPTURE_STATES.has(own.state) || own.state === "starting") return own;
    let status: BackgroundCaptureStatus;
    try {
      status = this.captures.status(own.sessionId);
    } catch (error) {
      if (error instanceof BackgroundRideCaptureError && error.kind === "not_found") {
        const journaled = this.journal ? await this.journal.load(own.sessionId) : undefined;
        if (journaled) {
          // A restart, not a loss: the evidence is durable. Take the ride
          // over, or leave it to the collector that already holds it.
          try {
            await this.captures.restore(journaled);
          } catch (restoreError) {
            if (restoreError instanceof BackgroundRideCaptureError && restoreError.kind === "conflict") return own;
            throw restoreError;
          }
          return this.advance(own);
        }
        // No journal: the raw is gone, so there is nothing to submit. The
        // ride slot is handed back; the tester did nothing wrong.
        await this.store.clearActive(own.testerId);
        await this.store.removeRide(own.testerId, own.sessionId);
        return this.save(own, { state: "lost" });
      }
      throw error;
    }
    if (status.phase === "active" && own.finishRequestedAt) {
      // 하차 완료 reached another collector first (a restart overlap): apply it here.
      try {
        this.captures.alight(own.sessionId, own.finishRequestedAt);
      } catch {
        this.captures.alight(own.sessionId);
      }
      await this.captures.flush(own.sessionId);
      return this.advance(own);
    }
    if (status.phase === "active") return own.state === "recording" ? own : this.save(own, { state: "recording" });
    if (status.phase === "post_alight") return own.state === "finishing" ? own : this.save(own, { state: "finishing" });
    return this.submit(own);
  }

  /** Whether this process runs the ride, restoring it from the journal when it can. */
  private async ensureLocal(own: BetaCaptureOwnership): Promise<boolean> {
    try {
      this.captures.status(own.sessionId);
      return true;
    } catch (error) {
      if (!(error instanceof BackgroundRideCaptureError && error.kind === "not_found")) throw error;
    }
    const journaled = this.journal ? await this.journal.load(own.sessionId) : undefined;
    if (!journaled) return false;
    try {
      await this.captures.restore(journaled);
      return true;
    } catch (error) {
      if (error instanceof BackgroundRideCaptureError && error.kind === "conflict") return false;
      throw error;
    }
  }

  private submit(own: BetaCaptureOwnership): Promise<BetaCaptureOwnership> {
    const inFlight = this.submitting.get(own.sessionId);
    if (inFlight) return inFlight;
    const attempt = this.submitOnce(own).finally(() => this.submitting.delete(own.sessionId));
    this.submitting.set(own.sessionId, attempt);
    return attempt;
  }

  private async submitOnce(own: BetaCaptureOwnership): Promise<BetaCaptureOwnership> {
    const invite = await this.store.getInvite(own.inviteId);
    if (!invite || invite.revokedAt) {
      // Revoked before the ride was stored: keep it out of the campaign and
      // leave the raw with the collector (and its journal), where the operator can still look.
      await this.store.clearActive(own.testerId);
      await this.journal?.close(own.sessionId, { keepEvidence: true });
      return this.save(own, { state: "held_revoked" });
    }
    // Across collectors, one submission attempt at a time. The raw-hash claim
    // already makes a second attempt a duplicate; this keeps it from racing.
    if (!await this.store.acquireSubmitLock(own.sessionId, SUBMIT_LOCK_SECONDS)) {
      return (await this.store.getCapture(own.sessionId)) ?? own;
    }
    try {
      const raw = this.captures.completedCapture(own.sessionId);
      const rideTimeReport = this.captures.status(own.sessionId).report;
      const receipt = await submitCompletedCapture(raw, rideTimeReport, {
        store: this.fieldValidation,
        campaignId: BETA_MATCHER_CAMPAIGN_ID,
        betaMatcher: { testerId: own.testerId },
        now: this.now,
      });
      const saved = await this.save(own, {
        state: "submitted",
        submissionId: receipt.submissionId,
        submittedAt: this.now().toISOString(),
        ...(receipt.matcherCampaign ? { bucket: receipt.matcherCampaign.bucket } : {}),
      });
      if (await this.store.getActive(own.testerId) === own.sessionId) await this.store.clearActive(own.testerId);
      // Stored with its raw in the field-validation store; the journal copy is no longer needed.
      await this.journal?.close(own.sessionId).catch(() => undefined);
      return saved;
    } catch (error) {
      if (error instanceof BackgroundRideCaptureError && error.kind === "not_found") {
        await this.store.clearActive(own.testerId);
        await this.store.removeRide(own.testerId, own.sessionId);
        return this.save(own, { state: "lost" });
      }
      this.log(JSON.stringify({
        timestamp: this.now().toISOString(),
        level: "warn",
        event: "beta_submit_failed",
        kind: error instanceof FieldValidationError ? error.kind : "other",
      }));
      // The collector still holds the completed raw, so the next read retries.
      return this.save(own, { state: "submit_failed" }).catch(() => ({ ...own, state: "submit_failed" as const }));
    } finally {
      await this.store.releaseSubmitLock(own.sessionId).catch(() => undefined);
    }
  }

  private async save(own: BetaCaptureOwnership, patch: Partial<BetaCaptureOwnership>): Promise<BetaCaptureOwnership> {
    const next = { ...own, ...patch, updatedAt: this.now().toISOString() };
    await this.store.putCapture(next);
    return next;
  }

  private view(own: BetaCaptureOwnership): BetaRideView {
    const state: BetaRideView["state"] = own.state === "recording" || own.state === "starting" ? "recording"
      : own.state === "finishing" ? "finishing"
      : own.state === "submitted" ? "done"
      : own.state === "submit_failed" ? "retry"
      : own.state === "lost" || own.state === "start_failed" || own.state === "held_revoked" ? "lost"
      : "saving";
    return {
      sessionId: own.sessionId,
      state,
      routeNo: own.display.routeNo,
      boardingStopName: own.display.boardingStopName,
      ...(own.display.destinationStopName ? { destinationStopName: own.display.destinationStopName } : {}),
      startedAt: own.createdAt,
      ...(state === "done" && !own.finishRequestedAt ? { endedAutomatically: true } : {}),
    };
  }

  private async inviteView(invite: BetaInvite): Promise<BetaInviteView> {
    const testerId = invite.testerId ?? await this.store.getRedemption(invite.id);
    const expired = this.now().getTime() >= Date.parse(invite.expiresAt);
    return {
      inviteId: invite.id,
      label: invite.label,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      status: invite.revokedAt ? "revoked" : expired ? "expired" : testerId ? "active" : "pending",
      ...(invite.redeemedAt ? { redeemedAt: invite.redeemedAt } : {}),
      ...(invite.revokedAt ? { revokedAt: invite.revokedAt } : {}),
      ridesUsed: testerId ? await this.store.countRides(testerId) : 0,
      maxRides: invite.maxRides,
    };
  }
}

function notFound(): BetaTesterError {
  return new BetaTesterError(404, "NOT_FOUND", "no such ride");
}

function plateSuffix(vehicleId: string): string {
  return String(vehicleId ?? "").replace(/\D/g, "").slice(-4);
}

function parseStart(input: BetaStartInput) {
  const routeId = typeof input.routeId === "string" ? input.routeId.trim() : "";
  const cityCode = typeof input.cityCode === "string" ? input.cityCode.trim() : "";
  const routeNo = typeof input.routeNo === "string" ? input.routeNo.trim().replace(/\s+/g, " ") : "";
  const suffix = typeof input.plateSuffix === "string" ? input.plateSuffix.trim() : "";
  if (!ROUTE_ID.test(routeId)) throw new BetaTesterError(400, "INVALID_INPUT", "routeId is invalid");
  if (!CITY_CODE.test(cityCode)) throw new BetaTesterError(400, "INVALID_INPUT", "cityCode is invalid");
  if (!/^[0-9A-Za-z가-힣 -]{1,12}$/u.test(routeNo)) throw new BetaTesterError(400, "INVALID_INPUT", "routeNo is invalid");
  if (!/^[0-9]{4}$/.test(suffix)) throw new BetaTesterError(400, "INVALID_INPUT", "plateSuffix must be four digits");
  if (!Number.isInteger(input.boardingStopSequence)) {
    throw new BetaTesterError(400, "INVALID_INPUT", "boardingStopSequence must be an integer");
  }
  const destination = input.destinationStopSequence;
  if (destination !== undefined && destination !== null && !Number.isInteger(destination)) {
    throw new BetaTesterError(400, "INVALID_INPUT", "destinationStopSequence must be an integer when present");
  }
  return {
    routeId,
    cityCode,
    routeNo,
    plateSuffix: suffix,
    boardingStopSequence: input.boardingStopSequence as number,
    ...(Number.isInteger(destination) ? { destinationStopSequence: destination as number } : {}),
  } as { routeId: string; cityCode: string; routeNo: string; plateSuffix: string; boardingStopSequence: number; destinationStopSequence?: number };
}

function cleanLabel(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BetaTesterError(400, "INVALID_INPUT", "label must be a string");
  // Control characters out, length bounded: it is shown in the operator list only.
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new BetaTesterError(400, "INVALID_INPUT", `${name} must be an integer from ${min} to ${max}`);
  }
  return value as number;
}
