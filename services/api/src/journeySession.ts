import { randomUUID } from "node:crypto";
import type { RankedCandidate, RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";
import { distanceMeters } from "./geo.ts";
import { matchVehicle } from "./matching.ts";
import type { TransitProvider } from "./provider.ts";

const DEFAULT_SESSION_TTL_MS = 4 * 60 * 60 * 1_000;
const DEFAULT_MAX_OBSERVATION_AGE_MS = 90_000;
const DEFAULT_MISSING_GRACE_MS = 75_000;
const DEFAULT_NEAR_STOP_RADIUS_METERS = 120;

type MatchConfidence = "high" | "medium" | "low" | "unknown";

export type JourneySessionState =
  | "awaiting_match"
  | "confirmation_required"
  | "tracking"
  | "degraded"
  | "arrived"
  | "passed_destination"
  | "lost";

export type JourneyProgressPhase = "active" | "approaching" | "next_stop" | "arrived" | "passed_destination";
export type JourneyProgressSource = "provider_stop_sequence" | "near_stop_estimate" | "retained_last_known";

export interface JourneyProgressView {
  currentStopSequence: number;
  currentStopId?: string;
  remainingStops: number;
  phase: JourneyProgressPhase;
  source: JourneyProgressSource;
  observedAt: string;
}

export interface JourneySessionView {
  id: string;
  routeId: string;
  standardRegionCode: string;
  boardingStop: StopOnRoute;
  destinationStop: StopOnRoute;
  directionCode?: string;
  selectedVehicleId?: string;
  selectionMode?: "automatic" | "explicit";
  matchConfidence: MatchConfidence;
  state: JourneySessionState;
  progress?: JourneyProgressView;
  candidates?: RankedCandidate[];
  explanation: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface JourneySessionCoordinatorOptions {
  now?: () => Date;
  idFactory?: () => string;
  sessionTtlMs?: number;
  maxObservationAgeMs?: number;
  missingGraceMs?: number;
  nearStopRadiusMeters?: number;
}

type SessionInput = {
  routeId: string;
  standardRegionCode: string;
  boardingStopSequence: number;
  destinationStopSequence: number;
  directionCode?: string;
};

type SessionRecord = SessionInput & {
  id: string;
  stops: StopOnRoute[];
  boardingStop: StopOnRoute;
  destinationStop: StopOnRoute;
  selectedVehicleId?: string;
  selectionMode?: "automatic" | "explicit";
  matchConfidence: MatchConfidence;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  lastObservation?: VehicleObservation;
  lastProgress?: JourneyProgressView;
};

export class JourneySessionCoordinator {
  private readonly provider: TransitProvider;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly sessionTtlMs: number;
  private readonly maxObservationAgeMs: number;
  private readonly missingGraceMs: number;
  private readonly nearStopRadiusMeters: number;
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(provider: TransitProvider, options: JourneySessionCoordinatorOptions = {}) {
    this.provider = provider;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.sessionTtlMs = positiveDuration(options.sessionTtlMs, DEFAULT_SESSION_TTL_MS, "sessionTtlMs");
    this.maxObservationAgeMs = positiveDuration(
      options.maxObservationAgeMs,
      DEFAULT_MAX_OBSERVATION_AGE_MS,
      "maxObservationAgeMs",
    );
    this.missingGraceMs = positiveDuration(options.missingGraceMs, DEFAULT_MISSING_GRACE_MS, "missingGraceMs");
    this.nearStopRadiusMeters = positiveDuration(
      options.nearStopRadiusMeters,
      DEFAULT_NEAR_STOP_RADIUS_METERS,
      "nearStopRadiusMeters",
    );
  }

  async create(value: unknown): Promise<JourneySessionView> {
    const input = parseSessionInput(value);
    const request = routeRequest(input);
    const stops = (await this.provider.stops(request)).slice().sort((left, right) => left.sequence - right.sequence);
    const boardingStop = stops.find((stop) => stop.sequence === input.boardingStopSequence);
    const destinationStop = stops.find((stop) => stop.sequence === input.destinationStopSequence);
    if (!boardingStop) throw new SessionInputError("boardingStopSequence is not present on the route");
    if (!destinationStop) throw new SessionInputError("destinationStopSequence is not present on the route");
    if (boardingStop.sequence >= destinationStop.sequence) {
      throw new SessionInputError("destination must be after the boarding stop in route sequence order");
    }

    const now = this.now().getTime();
    const record: SessionRecord = {
      ...input,
      id: this.idFactory(),
      stops,
      boardingStop,
      destinationStop,
      matchConfidence: "unknown",
      createdAtMs: now,
      updatedAtMs: now,
      expiresAtMs: now + this.sessionTtlMs,
    };
    this.sessions.set(record.id, record);
    this.pruneExpired(now);
    return this.refreshRecord(record);
  }

  async refresh(id: string): Promise<JourneySessionView> {
    const record = this.requireSession(id);
    return this.refreshRecord(record);
  }

  async confirm(id: string, value: unknown): Promise<JourneySessionView> {
    const record = this.requireSession(id);
    const vehicleId = parseVehicleConfirmation(value);
    const now = this.now();
    const vehicles = await this.provider.vehicles(routeRequest(record));
    const observation = vehicles.find((candidate) => candidate.vehicleId === vehicleId);
    if (!observation) throw new SessionInputError("vehicleId is not present in the current route snapshot");

    record.selectedVehicleId = vehicleId;
    record.selectionMode = "explicit";
    record.matchConfidence = "low";
    return this.evaluateSelectedObservation(record, observation, now);
  }

  private async refreshRecord(record: SessionRecord): Promise<JourneySessionView> {
    const now = this.now();
    const vehicles = await this.provider.vehicles(routeRequest(record));

    if (!record.selectedVehicleId) {
      const result = matchVehicle({
        routeId: record.routeId,
        boardingStopSequence: record.boardingStop.sequence,
        boardingLatitude: record.boardingStop.latitude,
        boardingLongitude: record.boardingStop.longitude,
        directionCode: record.directionCode,
        now: now.toISOString(),
        candidates: vehicles,
      });
      record.matchConfidence = result.confidence;
      record.updatedAtMs = now.getTime();

      if (result.status === "ambiguous") {
        return this.view(record, {
          state: "confirmation_required",
          candidates: result.ranked.filter((candidate) => candidate.rejectedReasons.length === 0),
          explanation: result.explanation,
        });
      }
      if (result.status === "unavailable" || !result.selectedVehicleId) {
        return this.view(record, {
          state: "awaiting_match",
          candidates: result.ranked,
          explanation: result.explanation,
        });
      }
      record.selectedVehicleId = result.selectedVehicleId;
      record.selectionMode = "automatic";
    }

    const observation = vehicles.find((candidate) => candidate.vehicleId === record.selectedVehicleId);
    if (!observation) return this.handleMissingObservation(record, now);
    return this.evaluateSelectedObservation(record, observation, now);
  }

  private evaluateSelectedObservation(
    record: SessionRecord,
    observation: VehicleObservation,
    now: Date,
  ): JourneySessionView {
    record.updatedAtMs = now.getTime();

    if (observation.routeId !== record.routeId) {
      return this.view(record, { state: "degraded", explanation: "Selected vehicle reported the wrong route; no rematch was attempted." });
    }
    if (record.directionCode && observation.directionCode && observation.directionCode !== record.directionCode) {
      return this.view(record, { state: "degraded", explanation: "Selected vehicle direction conflicts with the ride plan; no rematch was attempted." });
    }

    const observedAtMs = new Date(observation.observedAt).getTime();
    const ageMs = now.getTime() - observedAtMs;
    if (!Number.isFinite(observedAtMs) || ageMs < -10_000 || ageMs > this.maxObservationAgeMs) {
      return this.view(record, { state: "degraded", explanation: "Selected vehicle observation is stale or invalid." });
    }

    const previousObservedAt = record.lastObservation ? new Date(record.lastObservation.observedAt).getTime() : undefined;
    if (previousObservedAt !== undefined && observedAtMs <= previousObservedAt) {
      return this.view(record, {
        state: record.lastProgress ? stateFromProgress(record.lastProgress) : "degraded",
        progress: retainedProgress(record.lastProgress),
        explanation: "Duplicate or out-of-order observation ignored; last accepted progress retained.",
      });
    }

    const resolved = resolveStop(observation, record.stops, this.nearStopRadiusMeters);
    record.lastObservation = { ...observation };
    if (!resolved) {
      return this.view(record, {
        state: "degraded",
        progress: retainedProgress(record.lastProgress),
        explanation: "Vehicle identity is fresh, but no conservative stop position can be resolved yet.",
      });
    }

    if (record.lastProgress && resolved.stop.sequence < record.lastProgress.currentStopSequence) {
      return this.view(record, {
        state: "degraded",
        progress: retainedProgress(record.lastProgress),
        explanation: "Backward stop movement was ignored; last accepted progress retained.",
      });
    }

    const delta = record.destinationStop.sequence - resolved.stop.sequence;
    const progress: JourneyProgressView = {
      currentStopSequence: resolved.stop.sequence,
      currentStopId: resolved.stop.stopId,
      remainingStops: Math.max(delta, 0),
      phase: progressPhase(delta),
      source: resolved.source,
      observedAt: observation.observedAt,
    };
    record.lastProgress = progress;
    return this.view(record, {
      state: stateFromProgress(progress),
      progress,
      explanation: resolved.source === "provider_stop_sequence"
        ? "Selected vehicle advanced with provider stop-sequence evidence."
        : "Selected vehicle is within the conservative near-stop radius; progress is an estimate until live semantics are validated.",
    });
  }

  private handleMissingObservation(record: SessionRecord, now: Date): JourneySessionView {
    record.updatedAtMs = now.getTime();
    if (!record.lastObservation) {
      return this.view(record, { state: "degraded", explanation: "Selected vehicle is absent from the current route snapshot." });
    }
    const lastSeen = new Date(record.lastObservation.observedAt).getTime();
    if (Number.isFinite(lastSeen) && now.getTime() - lastSeen <= this.missingGraceMs) {
      return this.view(record, {
        state: "degraded",
        progress: retainedProgress(record.lastProgress),
        explanation: "Selected vehicle is temporarily missing; last accepted progress retained within the grace window.",
      });
    }
    return this.view(record, {
      state: "lost",
      progress: retainedProgress(record.lastProgress),
      explanation: "Selected vehicle has been missing beyond the bounded grace window; automatic rematching is disabled.",
    });
  }

  private requireSession(id: string): SessionRecord {
    const record = this.sessions.get(id);
    if (!record) throw new SessionNotFoundError();
    if (record.expiresAtMs <= this.now().getTime()) {
      this.sessions.delete(id);
      throw new SessionExpiredError();
    }
    return record;
  }

  private view(
    record: SessionRecord,
    state: {
      state: JourneySessionState;
      explanation: string;
      progress?: JourneyProgressView;
      candidates?: RankedCandidate[];
    },
  ): JourneySessionView {
    return {
      id: record.id,
      routeId: record.routeId,
      standardRegionCode: record.standardRegionCode,
      boardingStop: { ...record.boardingStop },
      destinationStop: { ...record.destinationStop },
      directionCode: record.directionCode,
      selectedVehicleId: record.selectedVehicleId,
      selectionMode: record.selectionMode,
      matchConfidence: record.matchConfidence,
      state: state.state,
      progress: state.progress,
      candidates: state.candidates,
      explanation: state.explanation,
      createdAt: new Date(record.createdAtMs).toISOString(),
      updatedAt: new Date(record.updatedAtMs).toISOString(),
      expiresAt: new Date(record.expiresAtMs).toISOString(),
    };
  }

  private pruneExpired(nowMs: number): void {
    for (const [id, record] of this.sessions) {
      if (record.expiresAtMs <= nowMs) this.sessions.delete(id);
    }
  }
}

export class SessionInputError extends Error {
  readonly code = "INVALID_INPUT";
}

export class SessionNotFoundError extends Error {
  readonly code = "SESSION_NOT_FOUND";

  constructor() {
    super("journey session not found");
  }
}

export class SessionExpiredError extends Error {
  readonly code = "SESSION_EXPIRED";

  constructor() {
    super("journey session expired");
  }
}

function parseSessionInput(value: unknown): SessionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SessionInputError("JSON object required");
  const input = value as Record<string, unknown>;
  const routeId = requiredText(input.routeId, "routeId");
  const standardRegionCode = requiredText(input.standardRegionCode, "standardRegionCode");
  const boardingStopSequence = positiveInteger(input.boardingStopSequence, "boardingStopSequence");
  const destinationStopSequence = positiveInteger(input.destinationStopSequence, "destinationStopSequence");
  const directionCode = input.directionCode === undefined ? undefined : requiredText(input.directionCode, "directionCode");
  return { routeId, standardRegionCode, boardingStopSequence, destinationStopSequence, directionCode };
}

function parseVehicleConfirmation(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SessionInputError("JSON object required");
  return requiredText((value as Record<string, unknown>).vehicleId, "vehicleId");
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new SessionInputError(`${field} is required`);
  return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new SessionInputError(`${field} must be a positive integer`);
  }
  return value;
}

function routeRequest(input: SessionInput): RouteRequest {
  return { routeId: input.routeId, standardRegionCode: input.standardRegionCode };
}

function resolveStop(
  observation: VehicleObservation,
  stops: StopOnRoute[],
  radiusMeters: number,
): { stop: StopOnRoute; source: "provider_stop_sequence" | "near_stop_estimate" } | undefined {
  if (observation.stopSequence !== undefined && Number.isInteger(observation.stopSequence)) {
    const stop = stops.find((candidate) => candidate.sequence === observation.stopSequence);
    if (stop) return { stop, source: "provider_stop_sequence" };
  }
  if (!Number.isFinite(observation.latitude) || !Number.isFinite(observation.longitude)) return undefined;

  let nearest: { stop: StopOnRoute; meters: number } | undefined;
  for (const stop of stops) {
    if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) continue;
    const meters = distanceMeters(
      { latitude: observation.latitude as number, longitude: observation.longitude as number },
      { latitude: stop.latitude as number, longitude: stop.longitude as number },
    );
    if (!nearest || meters < nearest.meters) nearest = { stop, meters };
  }
  if (!nearest || nearest.meters > radiusMeters) return undefined;
  return { stop: nearest.stop, source: "near_stop_estimate" };
}

function progressPhase(delta: number): JourneyProgressPhase {
  if (delta < 0) return "passed_destination";
  if (delta === 0) return "arrived";
  if (delta === 1) return "next_stop";
  if (delta === 2) return "approaching";
  return "active";
}

function stateFromProgress(progress: JourneyProgressView): JourneySessionState {
  if (progress.phase === "arrived") return "arrived";
  if (progress.phase === "passed_destination") return "passed_destination";
  return "tracking";
}

function retainedProgress(progress: JourneyProgressView | undefined): JourneyProgressView | undefined {
  if (!progress) return undefined;
  return { ...progress, source: "retained_last_known" };
}

function positiveDuration(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${field} must be a positive finite number`);
  return value;
}
