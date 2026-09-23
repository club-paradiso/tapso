import { randomUUID } from "node:crypto";

import type { CaptureJournal, JournalList, JournalRecord, JournalState } from "./captureJournal.ts";
import type { StopOnRoute, VehicleObservation } from "./domain.ts";
import type { TransitProvider } from "./provider.ts";
import {
  RIDE_CAPTURE_SCHEMA_VERSION,
  analyzeRideCapture,
  type RideCapture,
  type RideMarker,
  type RideCaptureReport,
  type RideEventKind,
  type RideSnapshot,
} from "./rideCapture.ts";

const DEFAULT_INTERVAL_MS = 5_000;
const POST_ALIGHT_OBSERVE_MS = 20_000;
const MAX_SESSION_MS = 90 * 60 * 1_000;
/**
 * How long a completed session, raw capture included, stays in process memory.
 * The operator must export the raw capture inside this window: after it the
 * session is pruned and the raw evidence is gone for good.
 */
export const COMPLETED_RETENTION_MS = 2 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const BACKGROUND_EVENT_KINDS = new Set<RideEventKind>(["hidden", "visible", "offline", "online", "resumed"]);
const ACCEPTANCE_MIN_HIDDEN_MS = 60_000;
const ACCEPTANCE_MIN_SNAPSHOTS = 20;
export const DESTINATION_UNKNOWN_NOTE =
  "destination not provided by the rider; destinationStopSequence is the route's last stop, used only as a collection bound";
export const ALIGHT_STOP_UNKNOWN_NOTE = "rider finished the ride; alighting stop not recorded";

export type BackgroundCapturePhase = "active" | "post_alight" | "completed";
export type BackgroundCaptureMode = "field" | "background_acceptance";

export interface WebPushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface BackgroundCaptureStartInput {
  routeId: string;
  cityCode: string;
  boardedVehicleId: string;
  boardingStopSequence: number;
  destinationStopSequence: number;
  intervalMs?: number;
  mode?: BackgroundCaptureMode;
  pushSubscription?: WebPushSubscriptionInput;
  /**
   * Server-side callers only; never parsed from an HTTP body. The beta flow
   * pre-allocates the id so ownership is recorded before polling starts.
   */
  sessionId?: string;
  /**
   * `false` when the rider did not name where they would get off, so
   * `destinationStopSequence` is only the route's last stop, used as a
   * collection bound. The capture then says so in a note, and finishing
   * records a note instead of an `alighted` marker that would claim a stop
   * nobody observed. Defaults to `true`.
   */
  destinationKnown?: boolean;
  /**
   * Server-side callers only. Journal every piece of evidence to the durable
   * `CaptureJournal`, so the ride survives a collector restart (`restore`).
   * Refused when the coordinator has no journal.
   */
  durable?: boolean;
}

export interface BackgroundCaptureStatus {
  sessionId: string;
  phase: BackgroundCapturePhase;
  startedAt: string;
  endedAt?: string;
  routeId: string;
  cityCode: string;
  boardingStopSequence: number;
  destinationStopSequence: number;
  snapshotCount: number;
  failedSnapshotCount: number;
  markerCount: number;
  trackedPresent: boolean;
  trackedStopSequence?: number;
  remainingStops?: number;
  destinationObserved: boolean;
  postAlightRemainingSeconds?: number;
  report?: RideCaptureReport;
  captureEngine: "railway-background";
  mode: BackgroundCaptureMode;
  acceptance?: {
    hiddenSeconds: number;
    requiredHiddenSeconds: number;
    snapshotCount: number;
    requiredSnapshots: number;
  };
}

type BackgroundErrorKind = "invalid_input" | "not_found" | "conflict" | "unavailable";

export class BackgroundRideCaptureError extends Error {
  readonly kind: BackgroundErrorKind;

  constructor(message: string, kind: BackgroundErrorKind = "invalid_input") {
    super(message);
    this.kind = kind;
  }
}

type TimerHandle = ReturnType<typeof setTimeout>;
type Schedule = (callback: () => void, delayMs: number) => TimerHandle;
type Cancel = (handle: TimerHandle) => void;

export interface BackgroundCaptureCompletion {
  sessionId: string;
  mode: BackgroundCaptureMode;
  report: RideCaptureReport;
  pushSubscription?: WebPushSubscriptionInput;
}

type BackgroundSession = {
  id: string;
  capture: RideCapture;
  phase: BackgroundCapturePhase;
  timer?: TimerHandle;
  polling: boolean;
  alightedAtMs?: number;
  completedAtMs?: number;
  report?: RideCaptureReport;
  mode: BackgroundCaptureMode;
  pushSubscription?: WebPushSubscriptionInput;
  completionEmitted: boolean;
  destinationKnown: boolean;
  durable: boolean;
  /** Journal writes run strictly in collection order. */
  journalChain: Promise<boolean>;
  journalFailures: number;
};

export interface BackgroundRideCaptureOptions {
  now?: () => Date;
  schedule?: Schedule;
  cancel?: Cancel;
  intervalMs?: number;
  onComplete?: (completion: BackgroundCaptureCompletion) => void | Promise<void>;
  /** Durable evidence for `durable` sessions. Operator sessions never use it. */
  journal?: CaptureJournal;
  /** This process's lease identity. Random per process by default. */
  instanceId?: string;
  log?: (line: string) => void;
}

/**
 * Process-owned controlled-ride recorder.
 *
 * Provider polling lives here rather than in Safari, so iOS may suspend the
 * page without suspending TAGO collection. The browser still owns physical
 * truth: this coordinator never invents a stop marker from provider position.
 *
 * State is deliberately process-memory only in this first field version. A
 * process restart invalidates an active session instead of fabricating the
 * missing interval as observed evidence.
 */
export class BackgroundRideCaptureCoordinator {
  private readonly sessions = new Map<string, BackgroundSession>();
  private readonly provider: Pick<TransitProvider, "stops" | "vehicles">;
  private readonly now: () => Date;
  private readonly scheduleFn: Schedule;
  private readonly cancelFn: Cancel;
  private readonly defaultIntervalMs: number;
  private readonly onComplete?: (completion: BackgroundCaptureCompletion) => void | Promise<void>;
  private readonly journal?: CaptureJournal;
  readonly instanceId: string;
  private readonly log: (line: string) => void;

  constructor(
    provider: Pick<TransitProvider, "stops" | "vehicles">,
    options: BackgroundRideCaptureOptions = {},
  ) {
    this.provider = provider;
    this.now = options.now ?? (() => new Date());
    this.scheduleFn = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelFn = options.cancel ?? ((handle) => clearTimeout(handle));
    this.defaultIntervalMs = Math.max(3_000, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.onComplete = options.onComplete;
    this.journal = options.journal;
    this.instanceId = options.instanceId ?? `collector-${randomUUID()}`;
    this.log = options.log ?? ((line) => console.warn(line));
  }

  async start(input: BackgroundCaptureStartInput): Promise<BackgroundCaptureStatus> {
    this.prune();
    const routeId = String(input.routeId ?? "").trim();
    const cityCode = String(input.cityCode ?? "").trim();
    const boardedVehicleId = String(input.boardedVehicleId ?? "").trim();
    if (!routeId || !cityCode || !boardedVehicleId) {
      throw new BackgroundRideCaptureError("routeId, cityCode, and boardedVehicleId are required");
    }
    if (!Number.isInteger(input.boardingStopSequence) || !Number.isInteger(input.destinationStopSequence)) {
      throw new BackgroundRideCaptureError("boardingStopSequence and destinationStopSequence must be integers");
    }
    if (input.destinationStopSequence <= input.boardingStopSequence) {
      throw new BackgroundRideCaptureError("destinationStopSequence must be after boardingStopSequence");
    }

    const stops = await this.provider.stops({ routeId, cityCode });
    validateStops(stops, input.boardingStopSequence, input.destinationStopSequence);

    const requestedId = input.sessionId === undefined ? undefined : String(input.sessionId).trim();
    if (requestedId !== undefined && (!/^[A-Za-z0-9_-]{1,64}$/.test(requestedId) || this.sessions.has(requestedId))) {
      throw new BackgroundRideCaptureError("sessionId is invalid or already in use", "conflict");
    }
    const destinationKnown = input.destinationKnown !== false;
    const durable = input.durable === true;
    if (durable && !this.journal) {
      throw new BackgroundRideCaptureError("durable capture requires a journal", "unavailable");
    }

    const startedAt = this.now().toISOString();
    const intervalMs = Math.max(3_000, Math.round(input.intervalMs ?? this.defaultIntervalMs));
    const mode: BackgroundCaptureMode = input.mode === "background_acceptance" ? "background_acceptance" : "field";
    const capture: RideCapture = {
      schemaVersion: RIDE_CAPTURE_SCHEMA_VERSION,
      // The web controller starts the capture and supplies all physical markers;
      // only provider polling moves to this process, so schema v1 stays intact.
      source: "web-controller",
      captureEngine: "railway-background",
      startedAt,
      routeId,
      cityCode,
      boardingStopSequence: input.boardingStopSequence,
      destinationStopSequence: input.destinationStopSequence,
      boardedVehicleId,
      intervalMs,
      stops,
      snapshots: [],
      markers: mode === "field"
        ? [
          { at: startedAt, kind: "boarded", stopSequence: input.boardingStopSequence },
          ...(destinationKnown ? [] : [{ at: startedAt, kind: "note" as const, note: DESTINATION_UNKNOWN_NOTE }]),
        ]
        : [],
      events: [],
    };

    const session: BackgroundSession = {
      id: requestedId ?? randomUUID(),
      capture,
      phase: "active",
      polling: false,
      mode,
      ...(input.pushSubscription ? { pushSubscription: input.pushSubscription } : {}),
      completionEmitted: false,
      destinationKnown,
      durable,
      journalChain: Promise.resolve(true),
      journalFailures: 0,
    };

    // Exact identity is re-confirmed on an uncached provider read. A matching
    // plate suffix is not enough to admit a background session.
    const first = await this.readSnapshot(session);
    if (first.error || !first.vehicles.some((vehicle) => vehicle.vehicleId === boardedVehicleId)) {
      throw new BackgroundRideCaptureError(
        "the selected vehicle is not present in the live route snapshot",
        "conflict",
      );
    }
    capture.snapshots.push(first);
    if (durable) {
      // The ride exists durably before polling starts, or it does not start.
      const { snapshots, markers, events, ...header } = capture;
      try {
        await this.journal!.begin(session.id, this.instanceId, { capture: header, mode, destinationKnown }, {
          state: { phase: "active" },
          snapshots,
          markers,
          events: events ?? [],
        });
      } catch {
        throw new BackgroundRideCaptureError("the capture journal is unavailable", "unavailable");
      }
    }
    this.sessions.set(session.id, session);
    this.arm(session);
    return this.statusFor(session);
  }

  /**
   * Take over a journaled ride after a restart. Rebuilds the exact capture
   * from the journal and resumes polling. Nothing is invented for the time
   * the collector was down; a `resumed` event records the restart.
   *
   * Refused (`conflict`) while another live collector holds the ride's lease.
   */
  async restore(record: JournalRecord): Promise<BackgroundCaptureStatus> {
    this.prune();
    const existing = this.sessions.get(record.sessionId);
    if (existing) return this.statusFor(existing);
    if (!this.journal) throw new BackgroundRideCaptureError("no journal to restore from", "unavailable");
    if (!await this.journal.acquire(record.sessionId, this.instanceId)) {
      throw new BackgroundRideCaptureError("another collector still owns this capture", "conflict");
    }
    const capture: RideCapture = {
      ...record.header.capture,
      snapshots: record.snapshots,
      markers: record.markers,
      events: record.events,
      ...(record.state.endedAt ? { endedAt: record.state.endedAt } : {}),
    };
    const session: BackgroundSession = {
      id: record.sessionId,
      capture,
      phase: record.state.phase,
      polling: false,
      mode: record.header.mode,
      completionEmitted: record.state.phase === "completed",
      destinationKnown: record.header.destinationKnown,
      durable: true,
      journalChain: Promise.resolve(true),
      journalFailures: 0,
      ...(record.state.alightedAtMs !== undefined ? { alightedAtMs: record.state.alightedAtMs } : {}),
    };
    this.sessions.set(session.id, session);
    if (session.phase === "completed") {
      // Byte-for-byte the capture the previous collector finished, so a
      // resubmission deduplicates on the same raw hash.
      session.completedAtMs = this.now().getTime();
      session.report = analyzeRideCapture(capture);
      return this.statusFor(session);
    }
    this.pushEvent(session, { at: this.now().toISOString(), kind: "resumed", detail: "collector restarted; polling resumed from the durable journal" });
    const nowMs = this.now().getTime();
    if (nowMs - Date.parse(capture.startedAt) >= MAX_SESSION_MS
      || (session.phase === "post_alight" && this.postAlightExpired(session, nowMs))) {
      this.complete(session, this.now());
    } else {
      this.arm(session);
    }
    return this.statusFor(session);
  }

  /** Resolves once every journal write queued for this session has settled. */
  async flush(sessionId: string): Promise<void> {
    const session = this.sessions.get(String(sessionId ?? "").trim());
    if (session) await session.journalChain;
  }

  /** Whether this process currently runs the session. */
  owns(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  status(sessionId: string): BackgroundCaptureStatus {
    this.prune();
    return this.statusFor(this.require(sessionId));
  }

  /**
   * The complete raw `RideCapture` of one finished session, for replay later.
   *
   * Only a completed session qualifies: before completion there is no
   * `endedAt`, and a partial capture exported as if final would be evidence of
   * a ride that did not happen that way. The capture is cloned so a caller
   * cannot reach back into the session, and it is never part of
   * `BackgroundCaptureStatus`, which stays sanitized.
   *
   * It holds raw vehicle identifiers and coordinates. The only caller is the
   * operator-authenticated `GET /capture/:id/raw`.
   */
  completedCapture(sessionId: string): RideCapture {
    const session = this.require(sessionId);
    if (session.phase !== "completed" || !session.capture.endedAt) {
      throw new BackgroundRideCaptureError("the raw capture is exported only after the capture completes", "conflict");
    }
    return structuredClone(session.capture);
  }

  recordPassedStop(sessionId: string, stopSequence: number, at?: string, allowDuplicate = false): BackgroundCaptureStatus {
    const session = this.requireActive(sessionId);
    if (!Number.isInteger(stopSequence) || !session.capture.stops.some((stop) => stop.sequence === stopSequence)) {
      throw new BackgroundRideCaptureError("stopSequence must name an official stop on this route");
    }
    if (stopSequence < session.capture.boardingStopSequence || stopSequence > session.capture.destinationStopSequence) {
      throw new BackgroundRideCaptureError("stopSequence must fall inside the selected ride segment");
    }
    const duplicate = session.capture.markers.some(
      (marker) => marker.kind === "passed_stop" && marker.stopSequence === stopSequence,
    );
    if (duplicate && !allowDuplicate) {
      throw new BackgroundRideCaptureError("this stop already has a physical marker", "conflict");
    }
    this.pushMarker(session, { at: this.markerTime(session, at), kind: "passed_stop", stopSequence });
    return this.statusFor(session);
  }

  recordEvent(sessionId: string, kind: string, at?: string, detail?: string): BackgroundCaptureStatus {
    const session = this.require(sessionId);
    if (session.phase === "completed") {
      throw new BackgroundRideCaptureError("lifecycle events are closed after completion", "conflict");
    }
    if (!BACKGROUND_EVENT_KINDS.has(kind as RideEventKind)) {
      throw new BackgroundRideCaptureError("unsupported lifecycle event");
    }
    const safeDetail = String(detail ?? "").trim();
    if (safeDetail.length > 120) throw new BackgroundRideCaptureError("event detail must be at most 120 characters");
    this.pushEvent(session, {
      at: this.markerTime(session, at),
      kind: kind as RideEventKind,
      ...(safeDetail ? { detail: safeDetail } : {}),
    });
    this.maybeCompleteAcceptance(session, this.now());
    return this.statusFor(session);
  }

  recordNote(sessionId: string, note: string, at?: string): BackgroundCaptureStatus {
    const session = this.requireActive(sessionId);
    const text = String(note ?? "").trim();
    if (!text) throw new BackgroundRideCaptureError("note must not be empty");
    if (text.length > 300) throw new BackgroundRideCaptureError("note must be at most 300 characters");
    this.pushMarker(session, { at: this.markerTime(session, at), kind: "note", note: text });
    return this.statusFor(session);
  }

  alight(sessionId: string, at?: string): BackgroundCaptureStatus {
    const session = this.require(sessionId);
    if (session.phase === "completed" || session.phase === "post_alight") return this.statusFor(session);

    const timestamp = this.markerTime(session, at);
    this.pushMarker(session, session.destinationKnown
      ? { at: timestamp, kind: "alighted", stopSequence: session.capture.destinationStopSequence }
      // The analyzer reads every `alighted` marker as the destination stop, so
      // without a named stop the finish is a note, not a physical claim.
      : { at: timestamp, kind: "note", note: ALIGHT_STOP_UNKNOWN_NOTE });
    session.phase = "post_alight";
    session.alightedAtMs = Date.parse(timestamp);
    this.journalState(session, { phase: "post_alight", alightedAtMs: session.alightedAtMs });

    if (this.destinationObserved(session)) this.complete(session, this.now());
    else this.rearmForPostAlight(session);
    return this.statusFor(session);
  }

  /** Exposed for deterministic tests; production uses the scheduled loop. */
  async pollNow(sessionId: string): Promise<BackgroundCaptureStatus> {
    const session = this.require(sessionId);
    await this.poll(session);
    return this.statusFor(session);
  }

  private async runScheduled(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.phase === "completed") return;
    session.timer = undefined;

    const nowMs = this.now().getTime();
    if (nowMs - Date.parse(session.capture.startedAt) >= MAX_SESSION_MS) {
      this.complete(session, this.now());
      return;
    }
    if (session.phase === "post_alight" && this.postAlightExpired(session, nowMs)) {
      this.complete(session, this.now());
      return;
    }

    await this.poll(session);
    this.arm(session);
  }

  private async poll(session: BackgroundSession): Promise<void> {
    if (session.polling || session.phase === "completed") return;
    session.polling = true;
    try {
      const snapshot = await this.readSnapshot(session);
      if (session.durable) {
        // Fenced: a collector that lost the ride's lease writes nothing and
        // stops, so two processes never append to one ride.
        if (!await this.journalWrite(session, "snapshots", snapshot)) return;
      }
      session.capture.snapshots.push(snapshot);
      if (session.phase === "post_alight") {
        const nowMs = this.now().getTime();
        if (this.destinationObserved(session) || this.postAlightExpired(session, nowMs)) {
          this.complete(session, this.now());
        }
      } else {
        this.maybeCompleteAcceptance(session, this.now());
      }
    } finally {
      session.polling = false;
    }
  }

  private async readSnapshot(session: BackgroundSession): Promise<RideSnapshot> {
    try {
      const vehicles = await this.provider.vehicles({
        routeId: session.capture.routeId,
        cityCode: session.capture.cityCode,
      });
      return { capturedAt: receiptTime(vehicles, this.now()), vehicles };
    } catch (error) {
      return {
        capturedAt: this.now().toISOString(),
        vehicles: [],
        error: safeProviderError(error),
      };
    }
  }

  private arm(session: BackgroundSession): void {
    if (session.phase === "completed" || session.timer) return;
    if (this.sessions.get(session.id) !== session) return; // detached
    let delay = session.capture.intervalMs;
    if (session.phase === "post_alight" && session.alightedAtMs !== undefined) {
      const remaining = POST_ALIGHT_OBSERVE_MS - (this.now().getTime() - session.alightedAtMs);
      delay = Math.max(0, Math.min(delay, remaining));
    }
    session.timer = this.scheduleFn(() => void this.runScheduled(session.id), delay);
  }

  private rearmForPostAlight(session: BackgroundSession): void {
    if (session.timer) {
      this.cancelFn(session.timer);
      session.timer = undefined;
    }
    this.arm(session);
  }

  private maybeCompleteAcceptance(session: BackgroundSession, now: Date): boolean {
    if (session.mode !== "background_acceptance" || session.phase !== "active") return false;
    const hiddenSeconds = lifecycleSeconds(session.capture.events ?? [], "hidden", "visible", now.getTime());
    if (hiddenSeconds * 1_000 < ACCEPTANCE_MIN_HIDDEN_MS) return false;
    if (session.capture.snapshots.length < ACCEPTANCE_MIN_SNAPSHOTS) return false;
    this.complete(session, now);
    return true;
  }

  private complete(session: BackgroundSession, ended: Date): void {
    if (session.phase === "completed") return;
    if (session.timer) {
      this.cancelFn(session.timer);
      session.timer = undefined;
    }
    session.capture.endedAt = ended.toISOString();
    session.phase = "completed";
    session.completedAtMs = ended.getTime();
    this.journalState(session, { phase: "completed", endedAt: session.capture.endedAt });
    session.report = analyzeRideCapture(session.capture);
    if (!session.completionEmitted && this.onComplete) {
      session.completionEmitted = true;
      const completion: BackgroundCaptureCompletion = {
        sessionId: session.id,
        mode: session.mode,
        report: session.report,
        ...(session.pushSubscription ? { pushSubscription: session.pushSubscription } : {}),
      };
      void Promise.resolve(this.onComplete(completion)).catch((error) => {
        console.warn(JSON.stringify({
          level: "warn",
          event: "ride_capture_completion_callback_failed",
          sessionId: session.id,
          message: safeProviderError(error),
        }));
      });
    }
  }

  private pushMarker(session: BackgroundSession, marker: RideMarker): void {
    session.capture.markers.push(marker);
    if (session.durable) void this.journalWrite(session, "markers", marker);
  }

  private pushEvent(session: BackgroundSession, event: NonNullable<RideCapture["events"]>[number]): void {
    session.capture.events ??= [];
    session.capture.events.push(event);
    if (session.durable) void this.journalWrite(session, "events", event);
  }

  private journalState(session: BackgroundSession, state: JournalState): void {
    if (!session.durable) return;
    const write = () => this.journal!.setState(session.id, this.instanceId, state);
    void this.enqueue(session, write);
  }

  /** False only when the lease is gone; a transport error keeps the evidence in memory and is counted. */
  private journalWrite(session: BackgroundSession, list: JournalList, value: unknown): Promise<boolean> {
    return this.enqueue(session, () => this.journal!.append(session.id, this.instanceId, list, value));
  }

  private enqueue(session: BackgroundSession, write: () => Promise<boolean>): Promise<boolean> {
    const next = session.journalChain.then(write).then(
      (written) => {
        if (!written) this.detach(session);
        return written;
      },
      () => {
        session.journalFailures += 1;
        this.log(JSON.stringify({ level: "warn", event: "capture_journal_write_failed", failures: session.journalFailures }));
        return true;
      },
    );
    session.journalChain = next.then(() => true, () => true);
    return next;
  }

  /** Another collector owns this ride now. Stop polling it here and forget it. */
  private detach(session: BackgroundSession): void {
    if (session.timer) {
      this.cancelFn(session.timer);
      session.timer = undefined;
    }
    if (this.sessions.get(session.id) === session) this.sessions.delete(session.id);
    this.log(JSON.stringify({ level: "warn", event: "capture_journal_lease_lost" }));
  }

  private destinationObserved(session: BackgroundSession): boolean {
    const tracked = latestTracked(session.capture);
    return tracked?.stopSequence !== undefined && tracked.stopSequence >= session.capture.destinationStopSequence;
  }

  private postAlightExpired(session: BackgroundSession, nowMs: number): boolean {
    return session.alightedAtMs !== undefined && nowMs - session.alightedAtMs >= POST_ALIGHT_OBSERVE_MS;
  }

  private statusFor(session: BackgroundSession): BackgroundCaptureStatus {
    const tracked = latestTracked(session.capture);
    const destinationObserved = tracked?.stopSequence !== undefined
      && tracked.stopSequence >= session.capture.destinationStopSequence;
    const failedSnapshotCount = session.capture.snapshots.filter((snapshot) => Boolean(snapshot.error)).length;
    const remainingStops = tracked?.stopSequence === undefined
      ? undefined
      : Math.max(0, session.capture.destinationStopSequence - tracked.stopSequence);
    const postAlightRemainingSeconds = session.phase === "post_alight" && session.alightedAtMs !== undefined
      ? Math.max(0, Math.ceil((POST_ALIGHT_OBSERVE_MS - (this.now().getTime() - session.alightedAtMs)) / 1_000))
      : undefined;

    const acceptanceClockMs = session.capture.endedAt
      ? Date.parse(session.capture.endedAt)
      : this.now().getTime();

    return {
      sessionId: session.id,
      phase: session.phase,
      startedAt: session.capture.startedAt,
      ...(session.capture.endedAt ? { endedAt: session.capture.endedAt } : {}),
      routeId: session.capture.routeId,
      cityCode: session.capture.cityCode,
      boardingStopSequence: session.capture.boardingStopSequence,
      destinationStopSequence: session.capture.destinationStopSequence,
      snapshotCount: session.capture.snapshots.length,
      failedSnapshotCount,
      markerCount: session.capture.markers.length,
      trackedPresent: Boolean(tracked),
      ...(tracked?.stopSequence === undefined ? {} : { trackedStopSequence: tracked.stopSequence }),
      ...(remainingStops === undefined ? {} : { remainingStops }),
      destinationObserved,
      ...(postAlightRemainingSeconds === undefined ? {} : { postAlightRemainingSeconds }),
      ...(session.report ? { report: session.report } : {}),
      captureEngine: "railway-background",
      mode: session.mode,
      ...(session.mode === "background_acceptance"
        ? {
            acceptance: {
              hiddenSeconds: lifecycleSeconds(session.capture.events ?? [], "hidden", "visible", acceptanceClockMs),
              requiredHiddenSeconds: ACCEPTANCE_MIN_HIDDEN_MS / 1_000,
              snapshotCount: session.capture.snapshots.length,
              requiredSnapshots: ACCEPTANCE_MIN_SNAPSHOTS,
            },
          }
        : {}),
    };
  }

  private markerTime(session: BackgroundSession, requested?: string): string {
    const nowMs = this.now().getTime();
    const candidate = requested === undefined ? nowMs : Date.parse(requested);
    if (!Number.isFinite(candidate)) throw new BackgroundRideCaptureError("marker timestamp must be ISO-8601");
    const startMs = Date.parse(session.capture.startedAt);
    if (candidate < startMs - MAX_CLOCK_SKEW_MS || candidate > nowMs + MAX_CLOCK_SKEW_MS) {
      throw new BackgroundRideCaptureError("marker timestamp is outside the active capture window");
    }
    return new Date(candidate).toISOString();
  }

  private require(sessionId: string): BackgroundSession {
    this.prune();
    const session = this.sessions.get(String(sessionId ?? "").trim());
    if (!session) throw new BackgroundRideCaptureError("background capture session not found", "not_found");
    return session;
  }

  private requireActive(sessionId: string): BackgroundSession {
    const session = this.require(sessionId);
    if (session.phase !== "active") {
      throw new BackgroundRideCaptureError("physical markers are closed after alight", "conflict");
    }
    return session;
  }

  private prune(): void {
    const nowMs = this.now().getTime();
    for (const [id, session] of this.sessions) {
      if (session.phase !== "completed" || session.completedAtMs === undefined) continue;
      if (nowMs - session.completedAtMs < COMPLETED_RETENTION_MS) continue;
      if (session.timer) this.cancelFn(session.timer);
      this.sessions.delete(id);
    }
  }
}

function validateStops(stops: StopOnRoute[], boarding: number, destination: number): void {
  if (!Array.isArray(stops) || stops.length === 0) {
    throw new BackgroundRideCaptureError("the route has no stop topology", "unavailable");
  }
  const sequences = new Set(stops.map((stop) => stop.sequence));
  if (!sequences.has(boarding) || !sequences.has(destination)) {
    throw new BackgroundRideCaptureError("boarding and destination must exist on the official route topology");
  }
  const ordered = stops.every((stop, index) => index === 0 || stop.sequence > stops[index - 1]!.sequence);
  if (!ordered) throw new BackgroundRideCaptureError("route stop topology is not strictly ascending", "unavailable");
}

function latestTracked(capture: RideCapture): VehicleObservation | undefined {
  if (!capture.boardedVehicleId) return undefined;
  for (let index = capture.snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = capture.snapshots[index]!;
    if (snapshot.error) continue;
    const tracked = snapshot.vehicles.find((vehicle) => vehicle.vehicleId === capture.boardedVehicleId);
    if (tracked) return tracked;
  }
  return undefined;
}

function receiptTime(vehicles: VehicleObservation[], fallback: Date): string {
  let latest: string | undefined;
  for (const vehicle of vehicles) {
    if (!vehicle.receivedAt || Number.isNaN(Date.parse(vehicle.receivedAt))) continue;
    if (latest === undefined || vehicle.receivedAt > latest) latest = vehicle.receivedAt;
  }
  return latest ?? fallback.toISOString();
}

function safeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : "provider request failed";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 240);
}


function lifecycleSeconds(
  events: Array<{ at: string; kind: RideEventKind }>,
  open: RideEventKind,
  close: RideEventKind,
  endedAtMs: number,
): number {
  let openedAt: number | undefined;
  let totalMs = 0;
  for (const event of [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) continue;
    if (event.kind === open && openedAt === undefined) openedAt = at;
    else if (event.kind === close && openedAt !== undefined) {
      totalMs += Math.max(0, at - openedAt);
      openedAt = undefined;
    }
  }
  if (openedAt !== undefined) totalMs += Math.max(0, endedAtMs - openedAt);
  return Math.round(totalMs / 10) / 100;
}
