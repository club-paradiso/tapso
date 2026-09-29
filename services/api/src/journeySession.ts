import { randomUUID } from "node:crypto";
import type { MatchResult, PassageMemory, RankedCandidate, RiderState, RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";
import { distanceMeters } from "./geo.ts";
import { DIRECTED_MATCHER_POLICY_V1, matchVehicleWithSourceFreshness } from "./matching.ts";
import {
  appendCadenceObservation,
  classifyTagoCadenceFreshness,
  evidenceTimeMs,
  recentlySeenVehicles,
  type SourceFreshnessEvidence,
} from "./sourceFreshness.ts";
import type { TransitProvider } from "./provider.ts";
import {
  JOURNEY_SESSION_SCHEMA_VERSION,
  MemoryJourneySessionStore,
  type JourneySessionStore,
  type StoredJourneySession,
  type VersionedJourneySession,
} from "./sessionStore.ts";

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

/**
 * What shows that a bus other than the selected one reached the boarding stop:
 * it was seen at the stop, seen crossing it, or seen for the first time already
 * past it when it could have been at it since the rider began waiting. These
 * are the matcher's session-memory reasons that a sighting raises. What memory
 * merely allows (a bus out of sight that could by now have reached the stop)
 * withholds a selection but never withdraws one: every short dropout of the
 * bus behind would otherwise undo it (finding F20).
 */
const ANOTHER_BUS_REACHED_THE_STOP: ReadonlySet<string> = new Set([
  "boarding_stop_reached_during_session",
  "vehicle_first_seen_past_boarding_stop",
]);

/** The standing reason a withdrawn selection leaves in the session's memory. */
const SELECTION_WITHDRAWN = "another_vehicle_reached_boarding_stop_first";

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
 * explicit rider confirmation. Release gate `matcher-passive-safety-v4`
 * (`docs/validation/MATCHER_SAFETY_EVIDENCE_V4.md`) keeps it that way: the
 * configuration refuses automatic matching below `READY_FOR_BOUNDED_AUTOMATION`.
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
  /** What the rider declared at session start; `waiting_at_stop` when they did not say. */
  riderState: RiderState;
  selectedVehicleId?: string;
  selectionMode?: "automatic" | "explicit";
  matchConfidence: MatchConfidence;
  state: JourneySessionState;
  progress?: JourneyProgressView;
  candidates?: RankedCandidate[];
  explanation: string;
  /**
   * `shadow` until release gate `matcher-passive-safety-v4` demonstrates
   * `READY_FOR_BOUNDED_AUTOMATION` and an operator sets
   * `TRANSIT_AUTOMATIC_MATCHING_ENABLED=true`.
   */
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
  /** Defaults to an in-process store. See `sessionStore.ts`. */
  store?: JourneySessionStore;
}

type SessionInput = {
  routeId: string;
  cityCode: string;
  boardingStopSequence: number;
  destinationStopSequence: number;
  directionCode?: string;
  /** Absent means `waiting_at_stop`, the rule whose failure mode is abstaining. */
  riderState?: RiderState;
};

/**
 * A session loaded into memory for the length of one request, together with
 * the store version it was read at. The version travels with it so the save at
 * the end of the request can prove nothing else wrote in between.
 */
type LoadedSession = { record: SessionRecord; version: number };

/**
 * An automatic selection for a waiting rider predicts the bus they will board;
 * the margin it needs is counted in stops, and a faster bus behind can still
 * reach the stop first. Until the selected bus is seen at the stop, the session
 * keeps two passage memories from the moment of selection: one of every other
 * bus of the route, one of the selected bus alone. Kept apart, a sighting at
 * the stop is known to be the selected bus's arrival or another bus's
 * (finding F20).
 */
export interface BoardingWatch {
  others: PassageMemory;
  selected: PassageMemory;
  /** When the selected bus was seen at or past the stop. Nothing is watched from then on. */
  endedAt?: string;
}

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
  /** What the matcher has seen pass the boarding stop during this session. */
  passage?: PassageMemory;
  /** Present from an automatic selection for a waiting rider on. */
  boardingWatch?: BoardingWatch;
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
  private readonly store: JourneySessionStore;

  constructor(provider: TransitProvider, options: JourneySessionCoordinatorOptions = {}) {
    this.provider = provider;
    // Memory by default, which is what the local Node server wants and what
    // every test gets for free. A deployment that needs sessions to outlive
    // one process passes a durable store instead; the coordinator cannot tell
    // the difference, because both honour the same compare-and-set contract.
    this.store = options.store ?? new MemoryJourneySessionStore({ now: options.now });
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
    // A create with no snapshot has nothing to degrade to, so a provider
    // failure here propagates rather than inventing an empty healthy session.
    // Reading before persisting also means a failed create leaves no row
    // behind for a TTL to clean up later.
    const vehicles = await this.readVehicles(record);
    const view = this.evaluateSnapshot(record, vehicles, this.now());
    const outcome = await this.store.create(toStored(record));
    // Only reachable if `idFactory` collides. Refusing is the point: the
    // alternative is overwriting a stranger's ride in progress.
    if (outcome.outcome === "conflict") throw new SessionIdCollisionError();
    return view;
  }

  async refresh(id: string): Promise<JourneySessionView> {
    const { record, version } = await this.requireSession(id);
    const now = this.now();
    let vehicles: VehicleObservation[];
    try {
      vehicles = await this.readVehicles(record);
    } catch (error) {
      // `absorbProviderFailure` throws past the bounded run. Nothing is saved
      // on that path, so the stored failure count stays at its ceiling and
      // every later read throws too — persistent failure keeps surfacing.
      const view = this.absorbProviderFailure(record, now, error);
      return this.commit(record, version, view);
    }
    const view = this.evaluateSnapshot(record, vehicles, now);
    return this.commit(record, version, view);
  }

  async confirm(id: string, value: unknown): Promise<JourneySessionView> {
    const { record, version } = await this.requireSession(id);
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
    // The rider says which bus they are on: nothing is left to watch for.
    delete record.boardingWatch;
    // Confirming a vehicle says who to follow. It says nothing about whether
    // the provider is still reporting that vehicle usefully, so the cadence
    // gate below runs unchanged and an unconfirmed-by-evidence ride degrades.
    record.matchConfidence = "low";
    const view = this.evaluateSelectedObservation(record, observation, now, this.sourceFreshness(record, vehicles, now));
    return this.commit(record, version, view);
  }

  /**
   * Persist the work of one request, or yield to whoever beat us to it.
   *
   * A lost compare-and-set is not retried. A retry would re-read TAGO and
   * re-derive progress from a snapshot the winner has already consumed, which
   * is how a duplicate poll turns into a contradictory answer. The winner's
   * stored state is by construction at least as advanced as ours, so it is
   * what the rider gets.
   */
  private async commit(
    record: SessionRecord,
    version: number,
    view: JourneySessionView,
  ): Promise<JourneySessionView> {
    const outcome = await this.store.save(toStored(record), version);
    if (outcome.outcome === "saved") return view;
    // The row vanished between the load and the save: it expired, or an
    // operator deleted it. Either way this session no longer exists.
    if (!outcome.stored) throw new SessionExpiredError();
    return this.concurrentWriteView(outcome.stored);
  }

  /** Renders the winner's persisted state without touching the provider. */
  private concurrentWriteView(stored: VersionedJourneySession): JourneySessionView {
    const record = toRecord(stored.session);
    const state: JourneySessionState = record.lastProgress
      ? stateFromProgress(record.lastProgress)
      : record.selectedVehicleId ? "degraded" : "awaiting_match";
    return this.view(record, {
      state,
      progress: retainedProgress(record.lastProgress),
      explanation:
        "A concurrent update to this session was accepted first. Its stored state is returned "
        + "unchanged rather than overwritten.",
    });
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

    // Until the automatically selected bus is seen at the stop, another bus
    // seen reaching it first may be the one the rider boarded: the selection
    // is withdrawn, and no bus is selected automatically again (finding F20).
    // The watch starts from the matcher's memory as the selection left it,
    // which is also all a session stored before the watch existed has.
    if (record.selectedVehicleId !== undefined && record.selectionMode === "automatic"
      && (record.riderState ?? "waiting_at_stop") === "waiting_at_stop") {
      const watch = record.boardingWatch ??= startBoardingWatch(record.passage, record.selectedVehicleId);
      if (watch.endedAt === undefined && this.anotherBusReachedTheStopFirst(record, vehicles, now, sourceFreshness)) {
        this.withdrawSelection(record, now);
      }
    }

    if (!record.selectedVehicleId) {
      const result = matchVehicleWithSourceFreshness({
        routeId: record.routeId,
        boardingStopSequence: record.boardingStop.sequence,
        boardingLatitude: record.boardingStop.latitude,
        boardingLongitude: record.boardingStop.longitude,
        directionCode: record.directionCode,
        now: now.toISOString(),
        candidates: vehicles,
        riderState: record.riderState ?? "waiting_at_stop",
        stops: record.stops,
        // A bus that drops out of one poll has not been shown to be gone. It
        // keeps competing from the cadence history until the window expires.
        recentlySeen: recentlySeenVehicles(record.cadenceHistory, vehicles, now),
        ...(record.passage ? { passage: record.passage } : {}),
        declaredAt: new Date(record.createdAtMs).toISOString(),
      }, sourceFreshness);
      if (result.passage) record.passage = result.passage;
      record.matchConfidence = result.confidence;
      record.updatedAtMs = now.getTime();
      // What the rider is asked to confirm from: every bus of the route they
      // could be boarding or riding, closest to the stop first — including a
      // bus at the stop, which the matcher never selects on its own but which
      // is exactly the one a rider at the stop is most likely stepping onto.
      const plausible = confirmationCandidates(result.ranked, record.riderState ?? "waiting_at_stop");

      // Withdrawn now or earlier: until the rider says which bus they are on,
      // that is the question, whatever else the snapshot shows.
      if (record.passage?.withheld?.reason === SELECTION_WITHDRAWN) {
        return this.view(record, {
          state: "confirmation_required",
          candidates: withdrawalCandidates(result.ranked),
          explanation: "Another bus of this route was seen reaching the boarding stop before the automatically "
            + "selected one, so the rider may be aboard it. The selection is withdrawn and no bus will be selected "
            + "automatically again in this session; confirm the bus you are on.",
          sourceFreshness,
        });
      }

      // Shadow mode: the ranking is computed and published, and then not acted
      // on. `selectedVehicleId` stays unset until a rider confirms, whatever
      // the matcher concluded, because the demonstrated matching readiness is
      // below what automatic selection needs (`matchingReadiness.ts`).
      if (!this.automaticMatchingEnabled) {
        return this.view(record, {
          state: plausible.length > 0 ? "confirmation_required" : "awaiting_match",
          candidates: plausible.length > 0 ? plausible : result.ranked,
          explanation: plausible.length > 0
            ? "Automatic selection is withheld until the matcher's demonstrated readiness permits it. "
              + "Ranked candidates and server-observed cadence evidence are published for explicit confirmation only."
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
          candidates: plausible.length > 0 ? plausible : result.ranked,
          explanation: result.explanation,
          sourceFreshness,
        });
      }
      if (result.status === "unavailable" || !result.selectedVehicleId) {
        return this.view(record, {
          state: plausible.length > 0 ? "confirmation_required" : "awaiting_match",
          candidates: plausible.length > 0 ? plausible : result.ranked,
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

  /**
   * Fold this snapshot into the boarding watch. True when a bus other than the
   * selected one was seen reaching the boarding stop before the selected bus
   * was, or in the same poll: either may then be the bus the rider boarded.
   * The selected bus seen at or past the stop first ends the watch.
   */
  private anotherBusReachedTheStopFirst(
    record: SessionRecord,
    vehicles: VehicleObservation[],
    now: Date,
    sourceFreshness: ReadonlyMap<string, SourceFreshnessEvidence>,
  ): boolean {
    const watch = record.boardingWatch!;
    const selectedId = record.selectedVehicleId!;
    const recentlySeen = recentlySeenVehicles(record.cadenceHistory, vehicles, now);
    // The matcher's own session memory rules, run on each half of the route's
    // buses apart: which half raised a reason says whose sighting it was.
    const look = (selected: boolean, passage: PassageMemory): MatchResult => matchVehicleWithSourceFreshness({
      routeId: record.routeId,
      boardingStopSequence: record.boardingStop.sequence,
      directionCode: record.directionCode,
      now: now.toISOString(),
      candidates: vehicles.filter((vehicle) => (vehicle.vehicleId === selectedId) === selected),
      riderState: "waiting_at_stop",
      stops: record.stops,
      recentlySeen: recentlySeen.filter((vehicle) => (vehicle.vehicleId === selectedId) === selected),
      passage,
      declaredAt: new Date(record.createdAtMs).toISOString(),
    }, sourceFreshness);
    const others = look(false, watch.others);
    const selected = look(true, watch.selected);
    if (ANOTHER_BUS_REACHED_THE_STOP.has(others.passage?.withheld?.reason ?? "")) return true;
    record.boardingWatch = {
      // Each look reports only what this poll showed: the sightings carry
      // over, a reason does not.
      others: withoutWithheld(others.passage ?? watch.others),
      selected: withoutWithheld(selected.passage ?? watch.selected),
      ...(selected.passage?.withheld?.reason === "boarding_stop_reached_during_session" ? { endedAt: now.toISOString() } : {}),
    };
    return false;
  }

  /**
   * The rider may be aboard another bus. The selection and the progress it
   * produced are dropped, and the session's memory now holds both halves of
   * the watch with a standing reason to withhold, so the matcher never selects
   * automatically again in this session. The rider can still confirm a bus.
   */
  private withdrawSelection(record: SessionRecord, now: Date): void {
    const watch = record.boardingWatch!;
    const unknownProgress = { ...watch.others.unknownProgress, ...watch.selected.unknownProgress };
    record.passage = {
      offsets: { ...watch.others.offsets, ...watch.selected.offsets },
      initial: record.passage?.initial ?? [],
      ...(Object.keys(unknownProgress).length > 0 ? { unknownProgress } : {}),
      withheld: { reason: SELECTION_WITHDRAWN, at: now.toISOString() },
    };
    delete record.selectedVehicleId;
    delete record.selectionMode;
    delete record.lastObservation;
    delete record.lastProgress;
    delete record.boardingWatch;
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

  /**
   * Expiry is decided here, not in the store, so a rider who comes back after
   * the window gets `410 SESSION_EXPIRED` rather than a `404` they cannot tell
   * apart from a mistyped id.
   */
  private async requireSession(id: string): Promise<LoadedSession> {
    const stored = await this.store.load(id);
    if (!stored) throw new SessionNotFoundError();
    if (stored.session.expiresAtMs <= this.now().getTime()) {
      await this.store.delete(id);
      throw new SessionExpiredError();
    }
    return { record: toRecord(stored.session), version: stored.version };
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
      riderState: record.riderState ?? "waiting_at_stop",
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

}

/**
 * The persisted shape and the working shape differ in exactly one place:
 * `cadenceHistory` is a `Map` in memory and an entry array on disk.
 * `JSON.stringify` silently turns a `Map` into `{}`, so both directions are
 * written out by hand rather than trusted to a serializer.
 */
function toStored(record: SessionRecord): StoredJourneySession {
  return {
    schemaVersion: JOURNEY_SESSION_SCHEMA_VERSION,
    id: record.id,
    routeId: record.routeId,
    cityCode: record.cityCode,
    boardingStopSequence: record.boardingStopSequence,
    destinationStopSequence: record.destinationStopSequence,
    ...(record.directionCode === undefined ? {} : { directionCode: record.directionCode }),
    ...(record.riderState === undefined ? {} : { riderState: record.riderState }),
    stops: record.stops,
    boardingStop: record.boardingStop,
    destinationStop: record.destinationStop,
    ...(record.selectedVehicleId === undefined ? {} : { selectedVehicleId: record.selectedVehicleId }),
    ...(record.selectionMode === undefined ? {} : { selectionMode: record.selectionMode }),
    matchConfidence: record.matchConfidence,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    expiresAtMs: record.expiresAtMs,
    ...(record.lastObservation === undefined ? {} : { lastObservation: record.lastObservation }),
    ...(record.lastProgress === undefined ? {} : { lastProgress: record.lastProgress }),
    cadenceHistory: [...record.cadenceHistory],
    consecutiveProviderFailures: record.consecutiveProviderFailures,
    ...(record.passage === undefined ? {} : { passage: record.passage }),
    ...(record.boardingWatch === undefined ? {} : { boardingWatch: record.boardingWatch }),
  };
}

function toRecord(session: StoredJourneySession): SessionRecord {
  return {
    id: session.id,
    routeId: session.routeId,
    cityCode: session.cityCode,
    boardingStopSequence: session.boardingStopSequence,
    destinationStopSequence: session.destinationStopSequence,
    ...(session.directionCode === undefined ? {} : { directionCode: session.directionCode }),
    ...(session.riderState === undefined ? {} : { riderState: session.riderState }),
    stops: session.stops,
    boardingStop: session.boardingStop,
    destinationStop: session.destinationStop,
    ...(session.selectedVehicleId === undefined ? {} : { selectedVehicleId: session.selectedVehicleId }),
    ...(session.selectionMode === undefined ? {} : { selectionMode: session.selectionMode }),
    matchConfidence: session.matchConfidence,
    createdAtMs: session.createdAtMs,
    updatedAtMs: session.updatedAtMs,
    expiresAtMs: session.expiresAtMs,
    ...(session.lastObservation === undefined ? {} : { lastObservation: session.lastObservation }),
    ...(session.lastProgress === undefined ? {} : { lastProgress: session.lastProgress }),
    cadenceHistory: new Map(session.cadenceHistory),
    consecutiveProviderFailures: session.consecutiveProviderFailures,
    ...(session.passage !== undefined
      ? { passage: session.passage }
      // Every decision since the directed matcher stores its memory, so a row
      // that has been polled (it has cadence history) but carries none was
      // written before it existed. Starting an empty memory would forget any
      // bus that reached the stop earlier in the session, so the session is
      // withheld for good instead.
      : session.cadenceHistory.length > 0
        ? { passage: { offsets: {}, withheld: { reason: "passage_memory_unavailable", at: new Date(session.updatedAtMs).toISOString() } } }
        : {}),
    ...(session.boardingWatch === undefined ? {} : { boardingWatch: session.boardingWatch }),
  };
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

/** A generated session id already existed. Never expected; never overwritten. */
export class SessionIdCollisionError extends Error {
  readonly code = "SESSION_ID_COLLISION";

  constructor() {
    super("generated session id already exists");
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
  const riderState = parseRiderState(input.riderState);
  return {
    routeId,
    cityCode,
    boardingStopSequence,
    destinationStopSequence,
    directionCode,
    ...(riderState === undefined ? {} : { riderState }),
  };
}

function parseRiderState(value: unknown): RiderState | undefined {
  if (value === undefined) return undefined;
  if (value === "waiting_at_stop" || value === "on_board") return value;
  throw new SessionInputError("riderState must be waiting_at_stop or on_board");
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

const CONFIRMATION_ZONES: Record<RiderState, ReadonlySet<string>> = {
  waiting_at_stop: new Set(["boarding_stop_unresolved", "approaching", "approaching_across_loop_seam", "route_progress_unknown"]),
  on_board: new Set(["boarding_stop_unresolved", "departed_within_on_board_window", "route_progress_unknown"]),
};

/**
 * The buses a rider could be boarding (waiting) or riding (on board), nearest
 * to the boarding stop first; a bus whose stop is unknown goes last. Whether
 * the matcher would have selected one is irrelevant here: the rider decides.
 */
export function confirmationCandidates(ranked: RankedCandidate[], riderState: RiderState): RankedCandidate[] {
  const zones = CONFIRMATION_ZONES[riderState];
  return ranked
    .filter((candidate) => !candidate.rejectedReasons.includes("wrong_route") && candidate.zone !== undefined && zones.has(candidate.zone))
    .sort(nearestTheStopFirst);
}

/** A bus whose stop is unknown goes last; ties go to the vehicle id. */
function nearestTheStopFirst(left: RankedCandidate, right: RankedCandidate): number {
  const a = left.stopOffset === undefined ? Number.POSITIVE_INFINITY : Math.abs(left.stopOffset);
  const b = right.stopOffset === undefined ? Number.POSITIVE_INFINITY : Math.abs(right.stopOffset);
  return a - b || left.vehicleId.localeCompare(right.vehicleId);
}

/**
 * After a withdrawal the rider may still be waiting, or may be riding the bus
 * that reached the stop first: a bus that has just left the stop is offered
 * too, which a waiting rider's confirmation list otherwise never does.
 */
function withdrawalCandidates(ranked: RankedCandidate[]): RankedCandidate[] {
  const zones = CONFIRMATION_ZONES.waiting_at_stop;
  return ranked
    .filter((candidate) => !candidate.rejectedReasons.includes("wrong_route") && candidate.zone !== undefined
      && (zones.has(candidate.zone) || (candidate.zone === "departed" && candidate.stopOffset !== undefined
        && candidate.stopOffset <= DIRECTED_MATCHER_POLICY_V1.onBoardWindowStops)))
    .sort(nearestTheStopFirst);
}

/**
 * The watch starts from the matcher's memory at the moment of selection, split
 * into the selected bus and every other bus. A standing reason is never carried
 * into it: the matcher selected, so there was none.
 */
function startBoardingWatch(passage: PassageMemory | undefined, selectedVehicleId: string): BoardingWatch {
  const half = (selected: boolean): PassageMemory => {
    const keep = ([vehicleId]: [string, unknown]) => (vehicleId === selectedVehicleId) === selected;
    const unknownProgress = Object.fromEntries(Object.entries(passage?.unknownProgress ?? {}).filter(keep));
    return {
      offsets: Object.fromEntries(Object.entries(passage?.offsets ?? {}).filter(keep)),
      initial: passage?.initial ?? [],
      ...(Object.keys(unknownProgress).length > 0 ? { unknownProgress } : {}),
    };
  };
  return { others: half(false), selected: half(true) };
}

function withoutWithheld(passage: PassageMemory): PassageMemory {
  const { withheld: _withheld, ...rest } = passage;
  return rest;
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
