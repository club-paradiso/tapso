import { randomUUID } from "node:crypto";

import type { StopOnRoute, VehicleObservation } from "./domain.ts";
import type { TransitProvider } from "./provider.ts";
import {
  RIDE_CAPTURE_SCHEMA_VERSION,
  analyzeRideCapture,
  type RideCapture,
  type RideCaptureReport,
  type RideEventKind,
  type RideSnapshot,
} from "./rideCapture.ts";

const DEFAULT_INTERVAL_MS = 5_000;
const POST_ALIGHT_OBSERVE_MS = 20_000;
const MAX_SESSION_MS = 90 * 60 * 1_000;
const COMPLETED_RETENTION_MS = 2 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const BACKGROUND_EVENT_KINDS = new Set<RideEventKind>(["hidden", "visible", "offline", "online", "resumed"]);

export type BackgroundCapturePhase = "active" | "post_alight" | "completed";

export interface BackgroundCaptureStartInput {
  routeId: string;
  cityCode: string;
  boardedVehicleId: string;
  boardingStopSequence: number;
  destinationStopSequence: number;
  intervalMs?: number;
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

type BackgroundSession = {
  id: string;
  capture: RideCapture;
  phase: BackgroundCapturePhase;
  timer?: TimerHandle;
  polling: boolean;
  alightedAtMs?: number;
  completedAtMs?: number;
  report?: RideCaptureReport;
};

export interface BackgroundRideCaptureOptions {
  now?: () => Date;
  schedule?: Schedule;
  cancel?: Cancel;
  intervalMs?: number;
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

  constructor(
    provider: Pick<TransitProvider, "stops" | "vehicles">,
    options: BackgroundRideCaptureOptions = {},
  ) {
    this.provider = provider;
    this.now = options.now ?? (() => new Date());
    this.scheduleFn = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelFn = options.cancel ?? ((handle) => clearTimeout(handle));
    this.defaultIntervalMs = Math.max(3_000, options.intervalMs ?? DEFAULT_INTERVAL_MS);
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

    const startedAt = this.now().toISOString();
    const intervalMs = Math.max(3_000, Math.round(input.intervalMs ?? this.defaultIntervalMs));
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
      markers: [{ at: startedAt, kind: "boarded", stopSequence: input.boardingStopSequence }],
      events: [],
    };

    const session: BackgroundSession = {
      id: randomUUID(),
      capture,
      phase: "active",
      polling: false,
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
    this.sessions.set(session.id, session);
    this.arm(session);
    return this.statusFor(session);
  }

  status(sessionId: string): BackgroundCaptureStatus {
    this.prune();
    return this.statusFor(this.require(sessionId));
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
    session.capture.markers.push({ at: this.markerTime(session, at), kind: "passed_stop", stopSequence });
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
    session.capture.events ??= [];
    session.capture.events.push({
      at: this.markerTime(session, at),
      kind: kind as RideEventKind,
      ...(safeDetail ? { detail: safeDetail } : {}),
    });
    return this.statusFor(session);
  }

  recordNote(sessionId: string, note: string, at?: string): BackgroundCaptureStatus {
    const session = this.requireActive(sessionId);
    const text = String(note ?? "").trim();
    if (!text) throw new BackgroundRideCaptureError("note must not be empty");
    if (text.length > 300) throw new BackgroundRideCaptureError("note must be at most 300 characters");
    session.capture.markers.push({ at: this.markerTime(session, at), kind: "note", note: text });
    return this.statusFor(session);
  }

  alight(sessionId: string, at?: string): BackgroundCaptureStatus {
    const session = this.require(sessionId);
    if (session.phase === "completed" || session.phase === "post_alight") return this.statusFor(session);

    const timestamp = this.markerTime(session, at);
    session.capture.markers.push({
      at: timestamp,
      kind: "alighted",
      stopSequence: session.capture.destinationStopSequence,
    });
    session.phase = "post_alight";
    session.alightedAtMs = Date.parse(timestamp);

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
      session.capture.snapshots.push(await this.readSnapshot(session));
      if (session.phase === "post_alight") {
        const nowMs = this.now().getTime();
        if (this.destinationObserved(session) || this.postAlightExpired(session, nowMs)) {
          this.complete(session, this.now());
        }
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

  private complete(session: BackgroundSession, ended: Date): void {
    if (session.phase === "completed") return;
    if (session.timer) {
      this.cancelFn(session.timer);
      session.timer = undefined;
    }
    session.capture.endedAt = ended.toISOString();
    session.phase = "completed";
    session.completedAtMs = ended.getTime();
    session.report = analyzeRideCapture(session.capture);
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
