import { randomUUID } from "node:crypto";
import type { RankedCandidate, RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";
import { distanceMeters } from "./geo.ts";
import { matchVehicleWithSourceFreshness } from "./matching.ts";
import {
  appendCadenceObservation,
  classifyTagoCadenceFreshness,
  evidenceTimeMs,
  type SourceFreshnessEvidence,
} from "./sourceFreshness.ts";
import type { TransitProvider } from "./provider.ts";

const DEFAULT_SESSION_TTL_MS = 4 * 60 * 60 * 1_000;
const DEFAULT_MAX_OBSERVATION_AGE_MS = 90_000;
const DEFAULT_MISSING_GRACE_MS = 75_000;
const DEFAULT_NEAR_STOP_RADIUS_METERS = 120;
/**
 * A single failed TAGO read is an ordinary event — the provider intermittently
 * answers without a `body` object, and `/operator/snapshot` has returned 502 in
 * production because of it. A session absorbs a bounded run of them as
 * `degraded` while keeping its last accepted progress, and then stops
 * absorbing: past this count the failure is reported to the caller rather than
 * dressed up as a healthy session. Persistent failure is never success.
 */
const DEFAULT_MAX_CONSECUTIVE_PROVIDER_FAILURES = 3;

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

/**
 * What the `evidenceAt` instant actually is.
 *
 * `tapso_server_receipt` means the value is `receivedAt`: the moment TAPSO's
 * own server finished reading the provider snapshot. It is not, and must never
 * be presented as, the moment the provider observed the vehicle. TAGO publishes
 * no provider observation time at all, so every TAGO session reports this
 * value.
 */
export type EvidenceTimeKind = "provider_observation_timestamp" | "tapso_server_receipt";

export interface JourneyProgressView {
  currentStopSequence: number;
  currentStopId?: string;
  remainingStops: number;
  phase: JourneyProgressPhase;
  source: JourneyProgressSource;
  /**
   * Echoed straight from the provider record. For TAGO this is the epoch
   * sentinel `1970-01-01T00:00:00.000Z`, because TAGO exposes no observation
   * time. Read `evidenceAtIs` before attributing any meaning to a time here.
   */
  observedAt: string;
  /** The instant TAPSO ordered this evidence by. See `evidenceAtIs`. */
  evidenceAt?: string;
  evidenceAtIs?: EvidenceTimeKind;
}

/**
 * The ranking the matcher would have acted on, published without acting on it.
 *
 * `shadow` is the default and the production posture: candidates are ranked and
 * cadence evidence is published, but `selectedVehicleId` is only ever set by an
 * explicit rider confirmation. See `docs/DATA_VALIDATION.md` for the
 * field-validation gate that keeps it that way.
 */
export interface ShadowSelectionView {
  /** What the matcher concluded, had it been allowed to select. */
  status: "matched" | "ambiguous" | "unavailable";
  /** The vehicle automatic mode would have chosen. Never acted on in shadow. */
  wouldSelectVehicleId?: string;
  confidence: MatchConfidence;
  explanation: string;
}

export interface JourneySessionView {
  id: string;
  routeId: string;
  cityCode: string;
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
  /** `shadow` until the field-validation gate closes and an operator opts in. */
  matchingMode: "shadow" | "automatic";
  /** Present in shadow mode whenever a ranking was computed but not acted on. */
  shadowSelection?: ShadowSelectionView;
  /**
   * Per-candidate server-observed cadence evidence, keyed by vehicle id. This
   * is a liveness surrogate built from repeated TAPSO receipts of changing
   * provider content. It carries no claim about provider observation time.
   */
  sourceFreshness?: Record<string, SourceFreshnessEvidence>;
  /**
   * Set when the most recent provider read failed. The session keeps its last
   * accepted progress and its cadence history; nothing is inferred from the
   * failure itself.
   */
  providerRead?: { state: "failed"; consecutiveFailures: number };
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
  /**
   * Defaults to false. Omitting it is a request for shadow mode, so a caller
   * that forgets the flag gets the safe behaviour rather than the fast one.
   */
  automaticMatchingEnabled?: boolean;
  /** How many consecutive failed provider reads a session tolerates. */
  maxConsecutiveProviderFailures?: number;
}

type SessionInput = {
  routeId: string;
  cityCode: string;
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
  cadenceHistory: Map<string, VehicleObservation[]>;
  /** Reset to zero by every successful provider read. */
  consecutiveProviderFailures: number;
};

export class JourneySessionCoordinator {
  private readonly provider: TransitProvider;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly sessionTtlMs: number;
  private readonly maxObservationAgeMs: number;
  private readonly missingGraceMs: number;
  private readonly nearStopRadiusMeters: number;
  private readonly automaticMatchingEnabled: boolean;
  private readonly maxConsecutiveProviderFailures: number;
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
    // Fail closed: only an explicit `true` turns automatic selection on.
    this.automaticMatchingEnabled = options.automaticMatchingEnabled === true;
    this.maxConsecutiveProviderFailures = positiveDuration(
      options.maxConsecutiveProviderFailures,
      DEFAULT_MAX_CONSECUTIVE_PROVIDER_FAILURES,
      "maxConsecutiveProviderFailures",
    );
  }

  /** Shadow mode ranks and publishes; it never assigns `selectedVehicleId`. */
  get matchingMode(): "shadow" | "automatic" {
    return this.automaticMatchingEnabled ? "automatic" : "shadow";
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
      cadenceHistory: new Map(),
      consecutiveProviderFailures: 0,
    };
    this.sessions.set(record.id, record);
    this.pruneExpired(now);
    // A create with no snapshot has nothing to degrade to, so a provider
    // failure here propagates rather than inventing an empty healthy session.
    const vehicles = await this.readVehicles(record);
    return this.evaluateSnapshot(record, vehicles, this.now());
  }

  async refresh(id: string): Promise<JourneySessionView> {
    const record = this.requireSession(id);
    const now = this.now();
    let vehicles: VehicleObservation[];
    try {
      vehicles = await this.readVehicles(record);
    } catch (error) {
      return this.absorbProviderFailure(record, now, error);
    }
    return this.evaluateSnapshot(record, vehicles, now);
  }

  async confirm(id: string, value: unknown): Promise<JourneySessionView> {
    const record = this.requireSession(id);
    const vehicleId = parseVehicleConfirmation(value);
    const now = this.now();
    // A confirmation is a rider acting on what they can see out of the window.
    // It must be answered against a snapshot that actually arrived, so a
    // provider failure here propagates instead of degrading quietly.
    const vehicles = await this.readVehicles(record);
    this.recordCadenceSnapshot(record, vehicles, now);
    const observation = vehicles.find((candidate) => candidate.vehicleId === vehicleId);
    if (!observation) throw new SessionInputError("vehicleId is not present in the current route snapshot");

    record.selectedVehicleId = vehicleId;
    record.selectionMode = "explicit";
    // Confirming a vehicle says who to follow. It says nothing about whether
    // the provider is still reporting that vehicle usefully, so the cadence
    // gate below runs unchanged and an unconfirmed-by-evidence ride degrades.
    record.matchConfidence = "low";
    return this.evaluateSelectedObservation(record, observation, now, this.sourceFreshness(record, vehicles, now));
  }

  /** The one place a provider read happens; success is what clears the counter. */
  private async readVehicles(record: SessionRecord): Promise<VehicleObservation[]> {
    const vehicles = await this.provider.vehicles(routeRequest(record));
    record.consecutiveProviderFailures = 0;
    return vehicles;
  }

  /**
   * A failed read is not evidence of anything. Cadence history, the selected
   * vehicle and the last accepted progress are all left untouched, so a
   * transient failure can neither age the cadence surrogate forward nor move
   * the rider backward. Past the bounded run the error is handed to the caller:
   * a provider that is genuinely down must not read as a healthy session.
   */
  private absorbProviderFailure(record: SessionRecord, now: Date, error: unknown): JourneySessionView {
    record.consecutiveProviderFailures += 1;
    record.updatedAtMs = now.getTime();
    if (record.consecutiveProviderFailures > this.maxConsecutiveProviderFailures) throw error;
    return this.view(record, {
      state: "degraded",
      progress: retainedProgress(record.lastProgress),
      explanation:
        "The provider read failed. The last accepted progress is retained, no freshness was inferred, "
        + "and no vehicle was rematched.",
      providerRead: { state: "failed", consecutiveFailures: record.consecutiveProviderFailures },
    });
  }

  private evaluateSnapshot(
    record: SessionRecord,
    vehicles: VehicleObservation[],
    now: Date,
  ): JourneySessionView {
    this.recordCadenceSnapshot(record, vehicles, now);
    const sourceFreshness = this.sourceFreshness(record, vehicles, now);

    if (!record.selectedVehicleId) {
      const result = matchVehicleWithSourceFreshness({
        routeId: record.routeId,
        boardingStopSequence: record.boardingStop.sequence,
        boardingLatitude: record.boardingStop.latitude,
        boardingLongitude: record.boardingStop.longitude,
        directionCode: record.directionCode,
        now: now.toISOString(),
        candidates: vehicles,
      }, sourceFreshness);
      record.matchConfidence = result.confidence;
      record.updatedAtMs = now.getTime();
      const eligible = result.ranked.filter((candidate) => candidate.rejectedReasons.length === 0);

      // Shadow mode: the ranking is computed and published, and then not acted
      // on. `selectedVehicleId` stays unset until a rider confirms, whatever
      // the matcher concluded, because the field-validation gate in
      // `docs/DATA_VALIDATION.md` has not been closed.
      if (!this.automaticMatchingEnabled) {
        return this.view(record, {
          state: eligible.length > 0 ? "confirmation_required" : "awaiting_match",
          candidates: eligible.length > 0 ? eligible : result.ranked,
          explanation: eligible.length > 0
            ? "Automatic selection is withheld pending field validation. Ranked candidates and "
              + "server-observed cadence evidence are published for explicit confirmation only."
            : result.explanation,
          shadowSelection: {
            status: result.status,
            ...(result.selectedVehicleId ? { wouldSelectVehicleId: result.selectedVehicleId } : {}),
            confidence: result.confidence,
            explanation: result.explanation,
          },
          sourceFreshness,
        });
      }

      if (result.status === "ambiguous") {
        return this.view(record, {
          state: "confirmation_required",
          candidates: eligible,
          explanation: result.explanation,
          sourceFreshness,
        });
      }
      if (result.status === "unavailable" || !result.selectedVehicleId) {
        return this.view(record, {
          state: "awaiting_match",
          candidates: result.ranked,
          explanation: result.explanation,
          sourceFreshness,
        });
      }
      record.selectedVehicleId = result.selectedVehicleId;
      record.selectionMode = "automatic";
    }

    const observation = vehicles.find((candidate) => candidate.vehicleId === record.selectedVehicleId);
    if (!observation) return this.handleMissingObservation(record, now);
    return this.evaluateSelectedObservation(record, observation, now, sourceFreshness);
  }

  private evaluateSelectedObservation(
    record: SessionRecord,
    observation: VehicleObservation,
    now: Date,
    sourceFreshness?: ReadonlyMap<string, SourceFreshnessEvidence>,
  ): JourneySessionView {
    record.updatedAtMs = now.getTime();
    const evidence = sourceFreshness ? { sourceFreshness } : {};

    if (observation.routeId !== record.routeId) {
      return this.view(record, { ...evidence, state: "degraded", explanation: "Selected vehicle reported the wrong route; no rematch was attempted." });
    }
    if (record.directionCode && observation.directionCode && observation.directionCode !== record.directionCode) {
      return this.view(record, { ...evidence, state: "degraded", explanation: "Selected vehicle direction conflicts with the ride plan; no rematch was attempted." });
    }

    let evidenceAtIs: EvidenceTimeKind;
    let evidenceAtMs: number | undefined;
    if (observation.timestampSource === "unavailable") {
      // No provider observation time exists for this record, so the only thing
      // available is the server-observed cadence surrogate. It has to be fresh
      // on its own terms before the receipt time may order anything.
      const cadence = classifyTagoCadenceFreshness(
        record.cadenceHistory.get(observation.vehicleId) ?? [],
        now,
      );
      if (cadence.state !== "fresh") {
        return this.view(record, {
          ...evidence,
          state: "degraded",
          progress: retainedProgress(record.lastProgress),
          explanation: `Selected TAGO vehicle lacks fresh server-observed cadence evidence: ${cadence.reason}`,
        });
      }
      evidenceAtIs = "tapso_server_receipt";
      evidenceAtMs = evidenceTimeMs(observation);
    } else {
      evidenceAtIs = "provider_observation_timestamp";
      const observedAtMs = new Date(observation.observedAt).getTime();
      const ageMs = now.getTime() - observedAtMs;
      if (!Number.isFinite(observedAtMs) || ageMs < -10_000 || ageMs > this.maxObservationAgeMs) {
        return this.view(record, { ...evidence, state: "degraded", explanation: "Selected vehicle observation is stale or invalid." });
      }
      evidenceAtMs = observedAtMs;
    }

    if (evidenceAtMs === undefined) {
      return this.view(record, { ...evidence, state: "degraded", explanation: "Selected vehicle has no usable evidence timestamp." });
    }
    const previousEvidenceAt = record.lastObservation ? evidenceTimeMs(record.lastObservation) : undefined;
    if (previousEvidenceAt !== undefined && evidenceAtMs <= previousEvidenceAt) {
      return this.view(record, {
        ...evidence,
        state: record.lastProgress ? stateFromProgress(record.lastProgress) : "degraded",
        progress: retainedProgress(record.lastProgress),
        explanation: "Duplicate or out-of-order observation ignored; last accepted progress retained.",
      });
    }

    const resolved = resolveStop(observation, record.stops, this.nearStopRadiusMeters);
    record.lastObservation = { ...observation };
    if (!resolved) {
      return this.view(record, {
        ...evidence,
        state: "degraded",
        progress: retainedProgress(record.lastProgress),
        explanation: "Vehicle identity is fresh, but no conservative stop position can be resolved yet.",
      });
    }

    if (record.lastProgress && resolved.stop.sequence < record.lastProgress.currentStopSequence) {
      return this.view(record, {
        ...evidence,
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
      evidenceAt: new Date(evidenceAtMs).toISOString(),
      evidenceAtIs,
    };
    record.lastProgress = progress;
    return this.view(record, {
      ...evidence,
      state: stateFromProgress(progress),
      progress,
      explanation: resolved.source === "provider_stop_sequence"
        ? "Selected vehicle advanced with provider stop-sequence evidence."
        : "Selected vehicle is within the conservative near-stop radius; progress is an estimate until live semantics are validated.",
    });
  }

  private recordCadenceSnapshot(
    record: SessionRecord,
    vehicles: VehicleObservation[],
    now: Date,
  ): void {
    for (const observation of vehicles) {
      if (observation.timestampSource !== "unavailable") continue;
      const current = record.cadenceHistory.get(observation.vehicleId) ?? [];
      record.cadenceHistory.set(
        observation.vehicleId,
        appendCadenceObservation(current, observation, now),
      );
    }
  }

  private sourceFreshness(
    record: SessionRecord,
    vehicles: VehicleObservation[],
    now: Date,
  ): ReadonlyMap<string, SourceFreshnessEvidence> {
    const result = new Map<string, SourceFreshnessEvidence>();
    for (const observation of vehicles) {
      if (observation.timestampSource !== "unavailable") continue;
      result.set(
        observation.vehicleId,
        classifyTagoCadenceFreshness(record.cadenceHistory.get(observation.vehicleId) ?? [], now),
      );
    }
    return result;
  }

  private handleMissingObservation(record: SessionRecord, now: Date): JourneySessionView {
    record.updatedAtMs = now.getTime();
    if (!record.lastObservation) {
      return this.view(record, { state: "degraded", explanation: "Selected vehicle is absent from the current route snapshot." });
    }
    const lastSeen = evidenceTimeMs(record.lastObservation);
    if (lastSeen !== undefined && Number.isFinite(lastSeen) && now.getTime() - lastSeen <= this.missingGraceMs) {
      return this.view(record, {
        state: "degraded",
        progress: retainedProgress(record.lastProgress),
        explanation: "Selected vehicle is temporarily missing; last accepted progress retained within the grace window.",
      });
    }
    // Terminal by design: a lost session never picks a replacement vehicle,
    // in either matching mode. Choosing the wrong bus is the one mistake a
    // ride cannot repair afterwards.
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
      shadowSelection?: ShadowSelectionView;
      sourceFreshness?: ReadonlyMap<string, SourceFreshnessEvidence>;
      providerRead?: { state: "failed"; consecutiveFailures: number };
    },
  ): JourneySessionView {
    return {
      id: record.id,
      routeId: record.routeId,
      cityCode: record.cityCode,
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
      matchingMode: this.matchingMode,
      ...(state.shadowSelection ? { shadowSelection: state.shadowSelection } : {}),
      ...(state.sourceFreshness && state.sourceFreshness.size > 0
        ? { sourceFreshness: Object.fromEntries(state.sourceFreshness) }
        : {}),
      ...(state.providerRead ? { providerRead: state.providerRead } : {}),
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
  const cityCode = requiredText(input.cityCode, "cityCode");
  const boardingStopSequence = positiveInteger(input.boardingStopSequence, "boardingStopSequence");
  const destinationStopSequence = positiveInteger(input.destinationStopSequence, "destinationStopSequence");
  const directionCode = input.directionCode === undefined ? undefined : requiredText(input.directionCode, "directionCode");
  return { routeId, cityCode, boardingStopSequence, destinationStopSequence, directionCode };
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
  return { routeId: input.routeId, cityCode: input.cityCode };
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
