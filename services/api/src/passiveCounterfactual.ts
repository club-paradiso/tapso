/**
 * Passive counterfactuals — metamorphic transformations of pseudo-boarding
 * cases, each scored against a ground truth re-derived in the world the
 * transformation made.
 *
 * A counterfactual takes one case (meta + blind input) and changes the world
 * the rider was in: a departed bus injected past the stop, a phantom bus ahead
 * of the true one, the feed frozen, polls lost, the stop list closed into a
 * loop. Two things follow, and this module enforces both:
 *
 *   1. The answer may have changed, so it is never carried over. It is
 *      RE-DERIVED on the transformed snapshots with the generator's own
 *      first-arrival model and qualification rules (`extractTrajectories`,
 *      `findCrossing`, `firstArrivalAfter`, `qualify` from `passiveShadow.ts`).
 *      Where that model cannot name a vehicle beyond doubt the case is
 *      `GT_INDETERMINATE`, and it is never scored right or wrong.
 *   2. Something must hold whatever the answer is. Every counterfactual
 *      declares metamorphic expectations ("never selects an injected vehicle",
 *      "no commit at all", …) that are checked on every applicable case, and
 *      the directed invariant is checked on all of them.
 *
 * ## Honesty
 *
 * Every result is `SYNTHETIC_OR_PERTURBED`, whatever it was derived from. A
 * counterfactual of a live case is labelled `COUNTERFACTUAL_OF_LIVE_PASSIVE`:
 * it is a transformation of a real observation — never an observation, never
 * an independent ride, never a live count. Counterfactuals are built with the
 * base case's revealed answer (its identity, its timing, or both; each says
 * which), one more reason they can only ever be robustness evidence. Injected
 * vehicles are named `SYNTHETIC-CF-<family>-<n>` so no invented id can pass for
 * a real one, and the sanitized report replaces every real id with a pseudonym.
 *
 * ## Why the model sees a lead-in
 *
 * The generator derived each answer from the whole stream, not from the window
 * the matcher replays, and two of its rules look before the window. An
 * on-board case's crossing starts before its window: the bus's last sighting
 * short of the stop precedes the rider's declaration. And a vehicle already
 * past the stop when the window opens counts as "appeared past the stop" only
 * if nothing saw it earlier. Re-deriving on the window alone would therefore
 * never find an on-board crossing, and would refuse most real waiting cases
 * (their first snapshot comes after the start instant). So each case carries a
 * lead-in — the base stream's snapshots in the `leadInMs` before its session —
 * and the counterfactual transforms it with the window: an injected decoy has a
 * history, a dropped bus is dropped there too. The lead-in reaches the model
 * only. The matcher replays exactly the transformed window, with no history, as
 * a live session would. The identity counterfactuals check that this
 * reproduces the generator's answer on every case they cover.
 *
 * Pure: no provider, no file system, no clock, no unseeded randomness.
 * `scripts/passive-shadow/counterfactual.ts` is the offline CLI around it.
 */

import type { RiderState, StopOnRoute, VehicleObservation } from "./domain.ts";
import { MATCHER_POLICY_VERSION, MatcherInvariantError, type MatcherFunction } from "./matching.ts";
import { replayMatching, type MatchGateEvidence, type ReplayDecision } from "./matchReplay.ts";
import type { RideSnapshot } from "./rideCapture.ts";
import { TAGO_CADENCE_POLICY_V1 } from "./sourceFreshness.ts";
import {
  PASSIVE_CASE_POLICY_V1,
  PASSIVE_SHADOW_POLICY_VERSION,
  PASSIVE_SHADOW_SCHEMA_VERSION,
  assertBlindMatcherInput,
  extractTrajectories,
  findCrossing,
  firstArrivalAfter,
  generatePassiveCases,
  qualify,
  sortedSnapshots,
  toBlindCapture,
  validatePassiveStream,
  type Crossing,
  type GeneratorRejection,
  type PassiveCase,
  type PassiveCaseGeneratorPolicy,
  type PassiveCaseMeta,
  type PassiveGroundTruth,
  type PassiveMatcherInput,
  type PassiveObservationStream,
  type PassiveScenario,
  type PassiveSourceClass,
} from "./passiveShadow.ts";
import {
  blindLabels,
  classifyPassiveCase,
  riderStateFor,
  type PassiveBucket,
  type PassiveCaseResult,
  type ReplayFunction,
} from "./passiveShadowEvaluate.ts";
import { mulberry32, seedFor } from "./passiveShadowPerturb.ts";
import { assertNoRawVehicleIds, vehiclePseudonyms } from "./passiveShadowSummary.ts";

export const PASSIVE_COUNTERFACTUAL_POLICY_VERSION = "passive-counterfactual-v1";
export const PASSIVE_COUNTERFACTUAL_SCHEMA_VERSION = 1;
/** Every vehicle a counterfactual invents carries this prefix, and nothing real does. */
export const INJECTED_ID_PREFIX = "SYNTHETIC-CF-";
const ERROR_BURST_MESSAGE = "SYNTHETIC-CF provider error burst";

export interface CounterfactualPolicy {
  /**
   * History before the session handed to the ground-truth model, never to the
   * matcher. Must exceed `trajectoryBreakAbsenceMs + maxCrossingBracketMs`
   * (210 s under v1) so every bracket and first sighting the generator's rules
   * read is inside it.
   */
  leadInMs: number;
  /** Pace of an injected bus that moves on its own: one stop per this many ms. */
  phantomMsPerStop: number;
  /** An overtaking phantom reaches the stop at least this long before the true bus. */
  overtakeLeadMs: number;
  /**
   * An overtaking phantom is never faster than one stop per this many ms. A
   * plausibility bound, not a measurement: three stops a minute is already
   * highway pace at urban stop spacing.
   */
  minPhantomMsPerStop: number;
}

export const COUNTERFACTUAL_POLICY_V1: CounterfactualPolicy = {
  leadInMs: 5 * 60_000,
  phantomMsPerStop: 60_000,
  overtakeLeadMs: 60_000,
  minPhantomMsPerStop: 20_000,
};

/* ================================================================ types */

export type CounterfactualFamily =
  | "departed_decoy"
  | "true_bus_approaching"
  | "approaching_vs_departed"
  | "leader_follower"
  | "follower_overtaking"
  | "leader_ahead"
  | "boarding_stop_dwell"
  | "true_bus_absent"
  | "decoys_absent"
  | "late_appearance"
  | "candidate_disappearance"
  | "reappearance"
  | "stale_repeated_frames"
  | "coordinate_freeze"
  | "content_freeze"
  | "receipt_jitter"
  | "packet_loss"
  | "long_polling_gap"
  | "provider_error_burst"
  | "route_loop_seam"
  | "duplicated_stop_name"
  | "repeated_route_geometry"
  | "route_variant_twin"
  | "backwards_decoy"
  | "delayed_movement"
  | "early_movement"
  | "multiple_eligible"
  | "zero_eligible"
  | "identity_churn"
  | "session_start_waiting"
  | "session_start_on_board"
  | "delayed_on_board_start";

export type MetamorphicExpectation =
  | "NOT_WRONG"
  | "NO_COMMIT"
  | "NEVER_SELECTS_INJECTED"
  | "NEVER_SELECTS_OTHER_ROUTE"
  | "NO_INVARIANT_VIOLATION"
  | "GROUND_TRUTH_REPRODUCED"
  | "NO_SELECTION_ON_FROZEN_WINDOW";

export const EXPECTATION_DOCS: Readonly<Record<MetamorphicExpectation, string>> = {
  NOT_WRONG: "When the re-derived ground truth qualifies, the first commit (if any) is that vehicle. Not checkable, and never counted, when the ground truth is GT_INDETERMINATE.",
  NO_COMMIT: "No decision commits to any vehicle.",
  NEVER_SELECTS_INJECTED: "No decision, first or later, selects a SYNTHETIC-CF vehicle.",
  NEVER_SELECTS_OTHER_ROUTE: "No decision selects a vehicle reported under another routeId.",
  NO_INVARIANT_VIOLATION: "The first commit is strictly before the stop for a waiting rider and strictly past it on board, and the matcher never throws its invariant error. Checked on every case of every counterfactual.",
  GROUND_TRUTH_REPRODUCED: "The re-derived ground truth qualifies and is the base case's vehicle and crossing: the re-derivation is the generator's own model.",
  NO_SELECTION_ON_FROZEN_WINDOW: "No decision selects anything once frozen provider content fills the whole cadence history window.",
};

/** What the transformation is built to do to the answer. Checked on every qualified case. */
export type GroundTruthShift = "UNCHANGED" | "TO_INJECTED" | "ANY";

export type CounterfactualEvidenceLabel =
  | "COUNTERFACTUAL_OF_LIVE_PASSIVE"
  | "COUNTERFACTUAL_OF_HISTORICAL_REAL"
  | "COUNTERFACTUAL_OF_HISTORICAL_REPORT_ONLY"
  | "COUNTERFACTUAL_OF_SYNTHETIC";

export function evidenceLabelFor(base: PassiveSourceClass): CounterfactualEvidenceLabel {
  switch (base) {
    case "LIVE_PASSIVE": return "COUNTERFACTUAL_OF_LIVE_PASSIVE";
    case "HISTORICAL_REAL": return "COUNTERFACTUAL_OF_HISTORICAL_REAL";
    case "HISTORICAL_REPORT_ONLY": return "COUNTERFACTUAL_OF_HISTORICAL_REPORT_ONLY";
    case "SYNTHETIC_OR_PERTURBED": return "COUNTERFACTUAL_OF_SYNTHETIC";
  }
}

export interface CounterfactualContext {
  /** The base case's revealed ground truth. Counterfactuals are built with the answer; they are never evidence. */
  truth: PassiveGroundTruth;
  /** The base case's modelled boarding instant (ms). */
  boardingAt: number;
  /** Deterministic, from the case id. */
  seed: number;
  /** Base-stream snapshots in the `leadInMs` before the session, oldest first. History for the model only. */
  leadIn: RideSnapshot[];
  policy: CounterfactualPolicy;
}

export interface CounterfactualApplication {
  /** The transformed blind input: everything, and the only thing, the matcher sees. */
  input: PassiveMatcherInput;
  /** The transformed history before the session. Reaches the ground-truth model only. */
  leadIn: RideSnapshot[];
  /** When the rider's session starts: the model's start instant. */
  sessionStartAt: number;
  /** ON_BOARD_START: when the rider boarded — the crossing the model re-qualifies. */
  boardedAt?: number;
  /** Every vehicle id the transformation introduced. All start with `SYNTHETIC-CF-`. */
  injected: string[];
  /** Content-freeze families: provider content is frozen from this receipt on. */
  frozenFromAt?: number;
}

export interface Counterfactual {
  /** Stable. Reports and ledgers key on it. */
  id: string;
  family: CounterfactualFamily;
  /** One line: what the transformation does. */
  doc: string;
  scenarios: readonly PassiveScenario[];
  /** Checked on every applicable case, together with `NO_INVARIANT_VIOLATION`. */
  expectations: readonly MetamorphicExpectation[];
  groundTruthShift: GroundTruthShift;
  /** Built from the base answer's vehicle (its rows, its presence). */
  usesTruthIdentity: boolean;
  /** Built from the base answer's boarding instant. */
  usesTruthTiming: boolean;
  /** `undefined` when the transformation does not apply to this case. */
  apply(passiveCase: PassiveCase, context: CounterfactualContext): CounterfactualApplication | undefined;
}

/* ================================================================ world */

interface World {
  stops: StopOnRoute[];
  leadIn: RideSnapshot[];
  window: RideSnapshot[];
  sessionStartAt: number;
  boardedAt?: number;
}

interface Built {
  world: World;
  injected?: string[];
  frozenFromAt?: number;
}

type Part = "leadIn" | "window";
type Transform = (world: World, route: RouteGeometry) => Built | undefined;

const timeOf = (snapshot: RideSnapshot): number => Date.parse(snapshot.capturedAt);
const iso = (ms: number): string => new Date(ms).toISOString();

function copySnapshot(snapshot: RideSnapshot): RideSnapshot {
  return {
    capturedAt: snapshot.capturedAt,
    vehicles: snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
    ...(snapshot.error ? { error: snapshot.error } : {}),
  };
}

function sortByTime(snapshots: RideSnapshot[]): RideSnapshot[] {
  return [...snapshots].sort((left, right) => timeOf(left) - timeOf(right));
}

function build(passiveCase: PassiveCase, context: CounterfactualContext, transform: Transform): CounterfactualApplication | undefined {
  const world: World = {
    stops: passiveCase.input.stops.map((stop) => ({ ...stop })),
    leadIn: context.leadIn.map(copySnapshot),
    window: passiveCase.input.snapshots.map(copySnapshot),
    sessionStartAt: Date.parse(passiveCase.meta.sessionStartAt),
    ...(passiveCase.meta.scenario === "ON_BOARD_START" ? { boardedAt: context.boardingAt } : {}),
  };
  const route = routeGeometry(world.stops);
  if (!route) return undefined;
  const built = transform(world, route);
  if (!built) return undefined;
  const window = sortByTime(built.world.window);
  if (!window.some((snapshot) => !snapshot.error)) return undefined;
  const injected = built.injected ?? [];
  for (const id of injected) {
    if (!id.startsWith(INJECTED_ID_PREFIX)) throw new Error(`injected vehicle id ${id} must start with ${INJECTED_ID_PREFIX}`);
  }
  return {
    input: {
      ...passiveCase.input,
      startedAt: window[0]!.capturedAt,
      endedAt: window.at(-1)!.capturedAt,
      stops: built.world.stops,
      snapshots: window,
      markers: [],
    },
    leadIn: sortByTime(built.world.leadIn),
    sessionStartAt: built.world.sessionStartAt,
    ...(built.world.boardedAt === undefined ? {} : { boardedAt: built.world.boardedAt }),
    injected,
    ...(built.frozenFromAt === undefined ? {} : { frozenFromAt: built.frozenFromAt }),
  };
}

/** Every snapshot of both parts; `undefined` drops one. Membership never changes. */
function mapSnapshots(world: World, fn: (snapshot: RideSnapshot, part: Part) => RideSnapshot | undefined): World {
  const map = (list: RideSnapshot[], part: Part) => list.flatMap((snapshot) => {
    const next = fn(snapshot, part);
    return next ? [next] : [];
  });
  return { ...world, leadIn: map(world.leadIn, "leadIn"), window: map(world.window, "window") };
}

/** Every row of every successful snapshot; `undefined` drops a row, an array replaces it with several. */
function mapRows(
  world: World,
  fn: (row: VehicleObservation, snapshot: RideSnapshot) => VehicleObservation | VehicleObservation[] | undefined,
  parts: readonly Part[] = ["leadIn", "window"],
): World {
  return mapSnapshots(world, (snapshot, part) => {
    if (snapshot.error || !parts.includes(part)) return snapshot;
    return {
      ...snapshot,
      vehicles: snapshot.vehicles.flatMap((row) => {
        const next = fn(row, snapshot);
        return next === undefined ? [] : Array.isArray(next) ? next : [next];
      }),
    };
  });
}

function addRows(world: World, fn: (snapshot: RideSnapshot) => VehicleObservation[]): World {
  return mapSnapshots(world, (snapshot) => (snapshot.error ? snapshot : { ...snapshot, vehicles: [...snapshot.vehicles, ...fn(snapshot)] }));
}

function allSnapshots(world: Pick<World, "leadIn" | "window">): RideSnapshot[] {
  return sortByTime([...world.leadIn, ...world.window]);
}

interface TrackPoint {
  at: number;
  row: VehicleObservation;
}

function rowsOf(snapshots: RideSnapshot[], vehicleId: string): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const snapshot of sortByTime(snapshots)) {
    if (snapshot.error) continue;
    const row = snapshot.vehicles.find((vehicle) => vehicle.vehicleId === vehicleId);
    if (row) points.push({ at: timeOf(snapshot), row });
  }
  return points;
}

function trackOf(world: World, vehicleId: string): TrackPoint[] {
  return rowsOf([...world.leadIn, ...world.window], vehicleId);
}

function latestAtOrBefore(track: TrackPoint[], at: number): TrackPoint | undefined {
  let found: TrackPoint | undefined;
  for (const point of track) {
    if (point.at > at) break;
    found = point;
  }
  return found;
}

function appearsIn(snapshots: RideSnapshot[], vehicleId: string, until = Number.POSITIVE_INFINITY): boolean {
  return snapshots.some((snapshot) => !snapshot.error && timeOf(snapshot) <= until
    && snapshot.vehicles.some((vehicle) => vehicle.vehicleId === vehicleId));
}

function receiptOf(snapshot: RideSnapshot): string {
  return snapshot.vehicles.find((vehicle) => typeof vehicle.receivedAt === "string")?.receivedAt ?? snapshot.capturedAt;
}

function receiptTimedOnly(snapshots: RideSnapshot[]): boolean {
  return snapshots.every((snapshot) => snapshot.vehicles.every((vehicle) => vehicle.timestampSource === "unavailable"));
}

function injectedId(family: CounterfactualFamily, n: number): string {
  return `${INJECTED_ID_PREFIX}${family}-${n}`;
}

/* ---------------------------------------------------------- route shape */

interface RouteGeometry {
  bySequence: Map<number, StopOnRoute>;
  first: number;
  last: number;
}

function routeGeometry(stops: StopOnRoute[]): RouteGeometry | undefined {
  if (stops.length === 0) return undefined;
  const bySequence = new Map<number, StopOnRoute>();
  for (const stop of stops) if (!bySequence.has(stop.sequence)) bySequence.set(stop.sequence, stop);
  const sequences = [...bySequence.keys()].sort((a, b) => a - b);
  return { bySequence, first: sequences[0]!, last: sequences.at(-1)! };
}

function stopCoordinates(stop: StopOnRoute | undefined): { latitude: number; longitude: number } | undefined {
  if (!stop || !Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) return undefined;
  return { latitude: stop.latitude!, longitude: stop.longitude! };
}

const round7 = (value: number) => Math.round(value * 1e7) / 1e7;

/** Coordinates of a continuous route position, interpolated between stops when both have coordinates. */
function coordinatesAt(route: RouteGeometry, position: number): { latitude?: number; longitude?: number } {
  const sequence = Math.floor(position);
  const here = stopCoordinates(route.bySequence.get(sequence));
  if (!here) return {};
  const next = stopCoordinates(route.bySequence.get(sequence + 1));
  const fraction = position - sequence;
  if (!next || fraction <= 0) return here;
  return {
    latitude: round7(here.latitude + (next.latitude - here.latitude) * fraction),
    longitude: round7(here.longitude + (next.longitude - here.longitude) * fraction),
  };
}

/** Another stop than the boarding stop, the route's first and its last: the one half a route away, deterministically. */
function otherStop(stops: StopOnRoute[], boardingSequence: number): StopOnRoute | undefined {
  const ordered = [...stops].sort((left, right) => left.sequence - right.sequence);
  const n = ordered.length;
  const index = ordered.findIndex((stop) => stop.sequence === boardingSequence);
  if (index < 0 || n < 4) return undefined;
  for (let step = 0; step < n; step += 1) {
    const candidate = ordered[(index + Math.floor(n / 2) + step) % n]!;
    if (candidate.sequence === boardingSequence || candidate === ordered[0] || candidate === ordered[n - 1]) continue;
    return candidate;
  }
  return undefined;
}

/* ------------------------------------------------------------ phantoms */

/** Continuous route position (stop sequence plus fraction) at an instant. */
type Motion = (at: number) => number;

function linearMotion(anchorAt: number, anchorPosition: number, msPerStop: number): Motion {
  return (at) => anchorPosition + (at - anchorAt) / msPerStop;
}

/** Linear between the points; one stop per `msPerStop` outside them. */
function piecewiseMotion(points: Array<{ at: number; position: number }>, msPerStop: number): Motion {
  const first = points[0]!;
  const last = points.at(-1)!;
  return (at) => {
    if (at <= first.at) return first.position + (at - first.at) / msPerStop;
    if (at >= last.at) return last.position + (at - last.at) / msPerStop;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]!;
      const to = points[index]!;
      if (at <= to.at) return from.position + ((at - from.at) / (to.at - from.at)) * (to.position - from.position);
    }
    return last.position;
  };
}

interface RowPattern {
  observedAt: string;
  timestampSource?: VehicleObservation["timestampSource"];
  receivedAt: string;
  directionCode?: string;
  receiveType?: string;
  hasStopName: boolean;
}

/**
 * Injected rows copy the receipt and timestamp pattern of the real rows in the
 * same snapshot. A snapshot with no real row borrows from the first real row
 * seen, but only a receipt-timed one: a provider observation time is never
 * invented.
 */
function rowPattern(snapshot: RideSnapshot, fallback: VehicleObservation): RowPattern | undefined {
  const template = snapshot.vehicles[0] ?? (fallback.timestampSource === "unavailable" ? fallback : undefined);
  if (!template) return undefined;
  return {
    observedAt: template.observedAt,
    ...(template.timestampSource ? { timestampSource: template.timestampSource } : {}),
    receivedAt: receiptOf(snapshot),
    ...(template.directionCode ? { directionCode: template.directionCode } : {}),
    ...(template.receiveType ? { receiveType: template.receiveType } : {}),
    hasStopName: template.stopName !== undefined,
  };
}

function phantomRow(id: string, routeId: string, position: number, route: RouteGeometry, pattern: RowPattern): VehicleObservation | undefined {
  if (!Number.isFinite(position) || position < route.first || position >= route.last + 1) return undefined;
  const sequence = Math.floor(position);
  const stop = route.bySequence.get(sequence);
  if (!stop) return undefined;
  return {
    vehicleId: id,
    routeId,
    observedAt: pattern.observedAt,
    receivedAt: pattern.receivedAt,
    ...(pattern.timestampSource ? { timestampSource: pattern.timestampSource } : {}),
    stopId: stop.stopId,
    ...(pattern.hasStopName ? { stopName: stop.name } : {}),
    stopSequence: sequence,
    ...(pattern.directionCode ? { directionCode: pattern.directionCode } : {}),
    // Coordinates move with the bus, so its content changes and its cadence
    // can become fresh. A decoy that can never be fresh proves nothing.
    ...coordinatesAt(route, position),
    ...(pattern.receiveType ? { receiveType: pattern.receiveType } : {}),
  };
}

function firstRow(world: World): VehicleObservation | undefined {
  for (const snapshot of allSnapshots(world)) {
    if (!snapshot.error && snapshot.vehicles[0]) return snapshot.vehicles[0];
  }
  return undefined;
}

/** Adds buses that move on their own, in every successful snapshot of both parts while they are on the route. */
function withPhantoms(world: World, phantoms: Array<{ id: string; motion: Motion }>, route: RouteGeometry, routeId: string): Built | undefined {
  const fallback = firstRow(world);
  if (!fallback) return undefined;
  const next = addRows(world, (snapshot) => {
    const pattern = rowPattern(snapshot, fallback);
    if (!pattern) return [];
    return phantoms.flatMap((phantom) => {
      const row = phantomRow(phantom.id, routeId, phantom.motion(timeOf(snapshot)), route, pattern);
      return row ? [row] : [];
    });
  });
  const ids = phantoms.map((phantom) => phantom.id);
  // A phantom the session never sees tests nothing.
  if (!ids.every((id) => appearsIn(next.window, id))) return undefined;
  return { world: next, injected: ids };
}

/**
 * A copy of `source` moved `shift` whole stops, with the same timing: it is in
 * exactly the snapshots the source is in, with the same receipts, and its
 * content changes exactly when the source's does.
 */
function shiftedRow(source: VehicleObservation, id: string, shift: number, route: RouteGeometry, routeId?: string): VehicleObservation | undefined {
  const base: VehicleObservation = { ...source, vehicleId: id, ...(routeId ? { routeId } : {}) };
  if (source.stopSequence === undefined || shift === 0) return base;
  const sequence = source.stopSequence + shift;
  const to = route.bySequence.get(sequence);
  if (!to) return undefined;
  const row: VehicleObservation = { ...base, stopSequence: sequence };
  if (source.stopId !== undefined) row.stopId = to.stopId;
  if (source.stopName !== undefined) row.stopName = to.name;
  const from = stopCoordinates(route.bySequence.get(source.stopSequence));
  const target = stopCoordinates(to);
  if (from && target && Number.isFinite(source.latitude) && Number.isFinite(source.longitude)) {
    row.latitude = round7(source.latitude! + (target.latitude - from.latitude));
    row.longitude = round7(source.longitude! + (target.longitude - from.longitude));
  }
  return row;
}

function withShiftedCopies(
  world: World,
  sourceId: string,
  copies: Array<{ id: string; shift: number; routeId?: string }>,
  route: RouteGeometry,
): World {
  return mapRows(world, (row) => {
    if (row.vehicleId !== sourceId) return row;
    return [row, ...copies.flatMap((copy) => {
      const clone = shiftedRow(row, copy.id, copy.shift, route, copy.routeId);
      return clone ? [clone] : [];
    })];
  });
}

function firstPositionedInSession(world: World, vehicleId: string): TrackPoint | undefined {
  return rowsOf(world.window, vehicleId).find((point) => point.at >= world.sessionStartAt && point.row.stopSequence !== undefined);
}

function reserved(template: RideSnapshot, snapshot: RideSnapshot): RideSnapshot {
  const receivedAt = receiptOf(snapshot);
  return { capturedAt: snapshot.capturedAt, vehicles: template.vehicles.map((row) => ({ ...row, receivedAt })) };
}

function shiftIso(value: string, deltaMs: number): string {
  const at = Date.parse(value);
  return Number.isFinite(at) ? iso(at + deltaMs) : value;
}

function randomFor(context: CounterfactualContext, id: string): () => number {
  return mulberry32((context.seed ^ seedFor(id)) >>> 0);
}

/* ======================================================= the families */

const WAIT: readonly PassiveScenario[] = ["WAIT_AT_STOP"];
const ON_BOARD: readonly PassiveScenario[] = ["ON_BOARD_START"];
const BOTH: readonly PassiveScenario[] = ["WAIT_AT_STOP", "ON_BOARD_START"];

const identity: Transform = (world) => ({ world });

function departedDecoy(stopsPast: number): Counterfactual {
  return {
    id: `departed_decoy_s${stopsPast}`,
    family: "departed_decoy",
    doc: `Adds a fresh, forward-moving same-route decoy that left the boarding stop before the session and is ${stopsPast} stop${stopsPast === 1 ? "" : "s"} past it when the session starts.`,
    scenarios: BOTH,
    expectations: ["NEVER_SELECTS_INJECTED"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: false,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world, route) => {
      const stop = passiveCase.meta.boardingSequence;
      if (!route.bySequence.has(stop + stopsPast)) return undefined;
      // Half a step into the segment at the start: it reached stop + k half a
      // step earlier, so the last sighting before the session is not at the stop.
      const motion = linearMotion(world.sessionStartAt, stop + stopsPast + 0.5, context.policy.phantomMsPerStop);
      return withPhantoms(world, [{ id: injectedId("departed_decoy", 1), motion }], route, passiveCase.meta.routeId);
    }),
  };
}

function trueBusApproaching(): Counterfactual {
  return {
    id: "true_bus_approaching",
    family: "true_bus_approaching",
    doc: "The base waiting case unchanged, restricted to cases in which the true bus is seen 1–4 stops before the boarding stop inside the session.",
    scenarios: WAIT,
    expectations: ["GROUND_TRUTH_REPRODUCED", "NOT_WRONG"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: true,
    usesTruthTiming: true,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const stop = passiveCase.meta.boardingSequence;
      const seen = rowsOf(world.window, context.truth.vehicleId).some(({ at, row }) => at <= context.boardingAt
        && row.stopSequence !== undefined && row.stopSequence >= stop - 4 && row.stopSequence <= stop - 1);
      return seen ? { world } : undefined;
    }),
  };
}

function approachingVsDeparted(): Counterfactual {
  return {
    id: "approaching_vs_departed_s2",
    family: "approaching_vs_departed",
    doc: "Adds a decoy that left the boarding stop before the session and crawls (coordinates moving, still fresh) two stops past it until the true bus arrives.",
    scenarios: WAIT,
    expectations: ["NEVER_SELECTS_INJECTED"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: true,
    usesTruthTiming: true,
    apply: (passiveCase, context) => build(passiveCase, context, (world, route) => {
      const stop = passiveCase.meta.boardingSequence;
      // The crawl only changes content if both ends of its segment have coordinates.
      if (!stopCoordinates(route.bySequence.get(stop + 2)) || !stopCoordinates(route.bySequence.get(stop + 3))) return undefined;
      const approaching = rowsOf(world.window, context.truth.vehicleId).some(({ at, row }) => at >= world.sessionStartAt
        && at <= context.boardingAt && row.stopSequence !== undefined && row.stopSequence >= stop - 4 && row.stopSequence <= stop - 1);
      if (!approaching) return undefined;
      const pace = context.policy.phantomMsPerStop;
      const motion = piecewiseMotion([
        { at: world.sessionStartAt - pace / 2, position: stop + 2 },
        { at: context.boardingAt, position: stop + 2.95 },
      ], pace);
      return withPhantoms(world, [{ id: injectedId("approaching_vs_departed", 1), motion }], route, passiveCase.meta.routeId);
    }),
  };
}

function followerBehind(stopsBehind: number): Counterfactual {
  return {
    id: `follower_behind_k${stopsBehind}`,
    family: "leader_follower",
    doc: `Adds a phantom follower ${stopsBehind} stop${stopsBehind === 1 ? "" : "s"} behind the true bus with exactly its timing.`,
    scenarios: WAIT,
    expectations: ["NEVER_SELECTS_INJECTED"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: true,
    usesTruthTiming: true,
    apply: (passiveCase, context) => build(passiveCase, context, (world, route) => {
      const id = injectedId("leader_follower", 1);
      const next = withShiftedCopies(world, context.truth.vehicleId, [{ id, shift: -stopsBehind }], route);
      return appearsIn(next.window, id, context.boardingAt) ? { world: next, injected: [id] } : undefined;
    }),
  };
}

function followerOvertaking(): Counterfactual {
  return {
    id: "follower_overtaking",
    family: "follower_overtaking",
    doc: "Adds a phantom that starts two stops behind the true bus and overtakes it, reaching the boarding stop first (the re-derived answer becomes the phantom).",
    scenarios: WAIT,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "TO_INJECTED",
    usesTruthIdentity: true,
    usesTruthTiming: true,
    apply: (passiveCase, context) => build(passiveCase, context, (world, route) => {
      const stop = passiveCase.meta.boardingSequence;
      const first = firstPositionedInSession(world, context.truth.vehicleId);
      if (!first) return undefined;
      const truthAt = first.row.stopSequence!;
      if (truthAt > stop - 3 || !route.bySequence.has(truthAt - 2)) return undefined;
      const startPosition = truthAt - 1.5;
      const reachesStopAt = context.boardingAt - context.policy.overtakeLeadMs;
      if (reachesStopAt <= first.at) return undefined;
      const msPerStop = (reachesStopAt - first.at) / (stop - startPosition);
      if (msPerStop < context.policy.minPhantomMsPerStop) return undefined;
      const motion = linearMotion(first.at, startPosition, msPerStop);
      return withPhantoms(world, [{ id: injectedId("follower_overtaking", 1), motion }], route, passiveCase.meta.routeId);
    }),
  };
}

function leaderAhead(stopsAhead: number): Counterfactual {
  return {
    id: `leader_ahead_k${stopsAhead}`,
    family: "leader_ahead",
    doc: `Adds a phantom ${stopsAhead} stop${stopsAhead === 1 ? "" : "s"} ahead of the true bus with exactly its timing, still short of the stop when the session starts (the re-derived answer becomes the phantom).`,
    scenarios: WAIT,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "TO_INJECTED",
    usesTruthIdentity: true,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world, route) => {
      const first = firstPositionedInSession(world, context.truth.vehicleId);
      if (!first || first.row.stopSequence! + stopsAhead >= passiveCase.meta.boardingSequence) return undefined;
      const id = injectedId("leader_ahead", 1);
      return { world: withShiftedCopies(world, context.truth.vehicleId, [{ id, shift: stopsAhead }], route), injected: [id] };
    }),
  };
}

function boardingStopDwell(dwellMs: number): Counterfactual {
  const seconds = dwellMs / 1_000;
  return {
    id: `boarding_stop_dwell_${seconds}s`,
    family: "boarding_stop_dwell",
    doc: `Holds the true bus's content at the boarding stop for ${seconds} s from its arrival; everything it reports afterwards arrives ${seconds} s late.`,
    scenarios: WAIT,
    expectations: ["NO_INVARIANT_VIOLATION", "NOT_WRONG"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: true,
    usesTruthTiming: true,
    apply: (passiveCase, context) => build(passiveCase, context, (world, route) => {
      const stopSequence = passiveCase.meta.boardingSequence;
      const stop = route.bySequence.get(stopSequence);
      const truthId = context.truth.vehicleId;
      const track = trackOf(world, truthId);
      const arrival = track.find((point) => point.at === context.boardingAt);
      if (!stop || !arrival) return undefined;
      const held: VehicleObservation = {
        ...arrival.row,
        stopSequence,
        ...(arrival.row.stopId === undefined ? {} : { stopId: stop.stopId }),
        ...(arrival.row.stopName === undefined ? {} : { stopName: stop.name }),
        ...(stopCoordinates(stop) ?? {}),
      };
      const next = mapRows(world, (row, snapshot) => {
        if (row.vehicleId !== truthId) return row;
        const at = timeOf(snapshot);
        if (at < context.boardingAt) return row;
        if (at < context.boardingAt + dwellMs) return { ...held, receivedAt: row.receivedAt };
        const source = latestAtOrBefore(track, at - dwellMs);
        return source ? { ...source.row, receivedAt: row.receivedAt } : undefined;
      });
      return { world: next };
    }),
  };
}

function trueBusAbsent(): Counterfactual {
  return {
    id: "true_bus_absent",
    family: "true_bus_absent",
    doc: "Removes every row of the true bus, before and during the session.",
    scenarios: WAIT,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "ANY",
    usesTruthIdentity: true,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => ({
      world: mapRows(world, (row) => (row.vehicleId === context.truth.vehicleId ? undefined : row)),
    })),
  };
}

function decoysAbsent(): Counterfactual {
  return {
    id: "decoys_absent",
    family: "decoys_absent",
    doc: "Removes every vehicle but the true bus, before and during the session.",
    scenarios: BOTH,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: true,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const truthId = context.truth.vehicleId;
      if (!allSnapshots(world).some((snapshot) => snapshot.vehicles.some((row) => row.vehicleId !== truthId))) return undefined;
      return { world: mapRows(world, (row) => (row.vehicleId === truthId ? row : undefined)) };
    }),
  };
}

function lateAppearance(): Counterfactual {
  return {
    id: "late_appearance_s_minus_2",
    family: "late_appearance",
    doc: "Drops the true bus's rows until it first reports two stops before the boarding stop, which happens inside the session.",
    scenarios: WAIT,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: true,
    usesTruthTiming: true,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const stop = passiveCase.meta.boardingSequence;
      const truthId = context.truth.vehicleId;
      const track = trackOf(world, truthId);
      const appears = track.find((point) => point.row.stopSequence !== undefined && point.row.stopSequence >= stop - 2);
      if (!appears || appears.at < world.sessionStartAt || appears.at > context.boardingAt) return undefined;
      if (!track.some((point) => point.at < appears.at)) return undefined;
      return { world: mapRows(world, (row, snapshot) => (row.vehicleId === truthId && timeOf(snapshot) < appears.at ? undefined : row)) };
    }),
  };
}

/** The true bus's rows removed in [from, until) — relative to the modelled boarding. */
function truthHole(
  id: string,
  family: CounterfactualFamily,
  doc: string,
  fromBeforeBoardingMs: number,
  untilBeforeBoardingMs: number,
  requireInsideSession: boolean,
): Counterfactual {
  return {
    id,
    family,
    doc,
    scenarios: WAIT,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: true,
    usesTruthTiming: true,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const from = context.boardingAt - fromBeforeBoardingMs;
      const until = context.boardingAt - untilBeforeBoardingMs;
      if (requireInsideSession && from < world.sessionStartAt) return undefined;
      const truthId = context.truth.vehicleId;
      const hidden = rowsOf(world.window, truthId).some(({ at }) => at >= Math.max(from, world.sessionStartAt) && at < until);
      if (!hidden) return undefined;
      return { world: mapRows(world, (row, snapshot) => {
        const at = timeOf(snapshot);
        return row.vehicleId === truthId && at >= from && at < until ? undefined : row;
      }) };
    }),
  };
}

function staleRepeatedFrames(): Counterfactual {
  return {
    id: "stale_repeated_frames_60s",
    family: "stale_repeated_frames",
    doc: "Re-serves one snapshot's whole content, with new receipts, for the 60 s before the modelled boarding.",
    scenarios: WAIT,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "ANY",
    usesTruthIdentity: false,
    usesTruthTiming: true,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const from = context.boardingAt - 60_000;
      const inRange = (at: number) => at >= from && at < context.boardingAt;
      const template = allSnapshots(world).find((snapshot) => !snapshot.error && inRange(timeOf(snapshot)));
      if (!template) return undefined;
      const templateAt = timeOf(template);
      if (!world.window.some((snapshot) => !snapshot.error && inRange(timeOf(snapshot)) && timeOf(snapshot) > templateAt)) return undefined;
      return { world: mapSnapshots(world, (snapshot) => {
        const at = timeOf(snapshot);
        return snapshot.error || !inRange(at) || at <= templateAt ? snapshot : reserved(template, snapshot);
      }) };
    }),
  };
}

function coordinateFreeze(): Counterfactual {
  return {
    id: "coordinate_freeze",
    family: "coordinate_freeze",
    doc: "Freezes every vehicle's latitude and longitude at its first fix in the session; stop sequence and stop id keep moving.",
    scenarios: BOTH,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: false,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const frozen = new Map<string, { latitude: number; longitude: number }>();
      let changed = false;
      const next = mapRows(world, (row) => {
        if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return row;
        const held = frozen.get(row.vehicleId);
        if (!held) {
          frozen.set(row.vehicleId, { latitude: row.latitude!, longitude: row.longitude! });
          return row;
        }
        if (held.latitude !== row.latitude || held.longitude !== row.longitude) changed = true;
        return { ...row, latitude: held.latitude, longitude: held.longitude };
      }, ["window"]);
      return changed ? { world: next } : undefined;
    }),
  };
}

function contentFreeze(): Counterfactual {
  return {
    id: "content_freeze_from_60s_before_boarding",
    family: "content_freeze",
    doc: "From 60 s before the modelled boarding to the end of the session the provider re-serves the same content with new receipts: a feed that stopped updating.",
    scenarios: WAIT,
    expectations: ["NO_SELECTION_ON_FROZEN_WINDOW", "NOT_WRONG"],
    groundTruthShift: "ANY",
    usesTruthIdentity: false,
    usesTruthTiming: true,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      // A provider-timestamped row ages by its own clock; the expectation is about receipt-timed (TAGO) cadence.
      if (!receiptTimedOnly(world.window)) return undefined;
      const from = context.boardingAt - 60_000;
      const successful = allSnapshots(world).filter((snapshot) => !snapshot.error);
      const template = [...successful].reverse().find((snapshot) => timeOf(snapshot) <= from)
        ?? successful.find((snapshot) => timeOf(snapshot) >= from);
      if (!template) return undefined;
      const templateAt = timeOf(template);
      if (!world.window.some((snapshot) => !snapshot.error && timeOf(snapshot) > templateAt)) return undefined;
      return {
        world: mapSnapshots(world, (snapshot) => (snapshot.error || timeOf(snapshot) <= templateAt ? snapshot : reserved(template, snapshot))),
        frozenFromAt: templateAt,
      };
    }),
  };
}

function receiptJitter(maxMs: number): Counterfactual {
  const id = `receipt_jitter_${maxMs / 1_000}s`;
  return {
    id,
    family: "receipt_jitter",
    doc: `Delays every receipt (capturedAt and receivedAt together) by a seeded 0–${maxMs / 1_000} s; polls may arrive out of order.`,
    scenarios: WAIT,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "ANY",
    usesTruthIdentity: false,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const random = randomFor(context, id);
      return { world: mapSnapshots(world, (snapshot) => {
        const delay = Math.floor(random() * maxMs);
        return {
          capturedAt: shiftIso(snapshot.capturedAt, delay),
          vehicles: snapshot.vehicles.map((row) => (row.receivedAt === undefined ? { ...row } : { ...row, receivedAt: shiftIso(row.receivedAt, delay) })),
          ...(snapshot.error ? { error: snapshot.error } : {}),
        };
      }) };
    }),
  };
}

function packetLoss(rate: number): Counterfactual {
  const id = `packet_loss_${Math.round(rate * 100)}pct`;
  return {
    id,
    family: "packet_loss",
    doc: `Loses each poll, response and all, with seeded probability ${Math.round(rate * 100)} %.`,
    scenarios: WAIT,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "ANY",
    usesTruthIdentity: false,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const random = randomFor(context, id);
      return { world: mapSnapshots(world, (snapshot) => (random() < rate ? undefined : snapshot)) };
    }),
  };
}

function longPollingGap(): Counterfactual {
  return {
    id: "long_polling_gap_120s",
    family: "long_polling_gap",
    doc: "Removes every poll in the 120 s before the modelled boarding.",
    scenarios: WAIT,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "ANY",
    usesTruthIdentity: false,
    usesTruthTiming: true,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const inRange = (at: number) => at >= context.boardingAt - 120_000 && at < context.boardingAt;
      if (!world.window.some((snapshot) => inRange(timeOf(snapshot)))) return undefined;
      return { world: mapSnapshots(world, (snapshot) => (inRange(timeOf(snapshot)) ? undefined : snapshot)) };
    }),
  };
}

function providerErrorBurst(): Counterfactual {
  return {
    id: "provider_error_burst_60s",
    family: "provider_error_burst",
    doc: "Replaces every poll in the 60 s before the modelled boarding with a failed snapshot.",
    scenarios: WAIT,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "ANY",
    usesTruthIdentity: false,
    usesTruthTiming: true,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const inRange = (at: number) => at >= context.boardingAt - 60_000 && at < context.boardingAt;
      if (!world.window.some((snapshot) => inRange(timeOf(snapshot)))) return undefined;
      return { world: mapSnapshots(world, (snapshot) => (inRange(timeOf(snapshot))
        ? { capturedAt: snapshot.capturedAt, vehicles: [], error: ERROR_BURST_MESSAGE }
        : snapshot)) };
    }),
  };
}

function routeLoopSeam(): Counterfactual {
  return {
    id: "route_loop_seam",
    family: "route_loop_seam",
    doc: "Closes the route into a loop: the last stop becomes the first stop again (id, name and coordinates).",
    scenarios: BOTH,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: false,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const ordered = [...world.stops].sort((left, right) => left.sequence - right.sequence);
      const first = ordered[0];
      const last = ordered.at(-1);
      if (ordered.length < 3 || !first || !last || first.stopId === last.stopId) return undefined;
      const stops = world.stops.map((stop) => (stop.sequence !== last.sequence ? stop : {
        ...stop,
        stopId: first.stopId,
        name: first.name,
        latitude: first.latitude,
        longitude: first.longitude,
      }));
      return { world: { ...world, stops } };
    }),
  };
}

function duplicatedStopName(): Counterfactual {
  return {
    id: "duplicated_stop_name",
    family: "duplicated_stop_name",
    doc: "Renames another stop of the route to the boarding stop's name.",
    scenarios: BOTH,
    expectations: ["NO_COMMIT"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: false,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const sequence = passiveCase.meta.boardingSequence;
      const boarding = world.stops.find((stop) => stop.sequence === sequence);
      const other = otherStop(world.stops, sequence);
      if (!boarding || !other) return undefined;
      return { world: { ...world, stops: world.stops.map((stop) => (stop.sequence === other.sequence ? { ...stop, name: boarding.name } : stop)) } };
    }),
  };
}

function repeatedRouteGeometry(): Counterfactual {
  return {
    id: "repeated_route_geometry",
    family: "repeated_route_geometry",
    doc: "Moves another stop of the route onto the boarding stop's coordinates.",
    scenarios: BOTH,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: false,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const sequence = passiveCase.meta.boardingSequence;
      const coordinates = stopCoordinates(world.stops.find((stop) => stop.sequence === sequence));
      const other = otherStop(world.stops, sequence);
      if (!coordinates || !other) return undefined;
      return { world: { ...world, stops: world.stops.map((stop) => (stop.sequence === other.sequence ? { ...stop, ...coordinates } : stop)) } };
    }),
  };
}

function routeVariantTwin(): Counterfactual {
  return {
    id: "route_variant_twin",
    family: "route_variant_twin",
    doc: "Adds a twin of the true bus at exactly its positions and timing, reported under another routeId.",
    scenarios: BOTH,
    expectations: ["NEVER_SELECTS_OTHER_ROUTE", "NEVER_SELECTS_INJECTED"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: true,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world, route) => {
      const id = injectedId("route_variant_twin", 1);
      const routeId = `${passiveCase.meta.routeId}::${INJECTED_ID_PREFIX}VARIANT`;
      const next = withShiftedCopies(world, context.truth.vehicleId, [{ id, shift: 0, routeId }], route);
      return appearsIn(next.window, id) ? { world: next, injected: [id] } : undefined;
    }),
  };
}

function backwardsDecoy(): Counterfactual {
  return {
    id: "backwards_decoy",
    family: "backwards_decoy",
    doc: "Adds a decoy parked three stops past the boarding stop that then steps backwards one stop a minute to one stop before it, and parks there.",
    scenarios: BOTH,
    expectations: ["NEVER_SELECTS_INJECTED"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: false,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world, route) => {
      const stop = passiveCase.meta.boardingSequence;
      for (let sequence = stop - 1; sequence <= stop + 3; sequence += 1) if (!route.bySequence.has(sequence)) return undefined;
      const pace = context.policy.phantomMsPerStop;
      const stepsFrom = world.sessionStartAt + pace / 2;
      const motion: Motion = (at) => (at < stepsFrom ? stop + 3 : Math.max(stop - 1, stop + 2 - Math.floor((at - stepsFrom) / pace)));
      return withPhantoms(world, [{ id: injectedId("backwards_decoy", 1), motion }], route, passiveCase.meta.routeId);
    }),
  };
}

/** The true bus's provider content shifted in time; receipts untouched. Positive offset = content lags. */
function shiftedTruthContent(id: string, family: CounterfactualFamily, doc: string, offsetMs: number): Counterfactual {
  return {
    id,
    family,
    doc,
    scenarios: WAIT,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "ANY",
    usesTruthIdentity: true,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const truthId = context.truth.vehicleId;
      const track = trackOf(world, truthId);
      return { world: mapRows(world, (row, snapshot) => {
        if (row.vehicleId !== truthId) return row;
        const source = latestAtOrBefore(track, timeOf(snapshot) - offsetMs);
        return source ? { ...source.row, receivedAt: row.receivedAt } : undefined;
      }) };
    }),
  };
}

function multipleEligible(): Counterfactual {
  return {
    id: "multiple_eligible_candidates",
    family: "multiple_eligible",
    doc: "Adds two fresh phantom followers, three and four stops behind the true bus, with exactly its timing.",
    scenarios: WAIT,
    expectations: ["NEVER_SELECTS_INJECTED"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: true,
    usesTruthTiming: true,
    apply: (passiveCase, context) => build(passiveCase, context, (world, route) => {
      const ids = [injectedId("multiple_eligible", 1), injectedId("multiple_eligible", 2)];
      const next = withShiftedCopies(world, context.truth.vehicleId, [{ id: ids[0]!, shift: -3 }, { id: ids[1]!, shift: -4 }], route);
      return ids.every((id) => appearsIn(next.window, id, context.boardingAt)) ? { world: next, injected: ids } : undefined;
    }),
  };
}

function zeroEligible(): Counterfactual {
  return {
    id: "zero_eligible",
    family: "zero_eligible",
    doc: "Freezes every vehicle's content at its first row in the session for the whole session, receipts continuing: nothing can become fresh.",
    scenarios: BOTH,
    expectations: ["NO_COMMIT"],
    groundTruthShift: "ANY",
    usesTruthIdentity: false,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      if (!receiptTimedOnly(world.window) || !world.window.some((snapshot) => snapshot.vehicles.length > 0)) return undefined;
      const first = new Map<string, VehicleObservation>();
      return { world: mapRows(world, (row) => {
        const held = first.get(row.vehicleId);
        if (!held) {
          first.set(row.vehicleId, row);
          return row;
        }
        return { ...held, receivedAt: row.receivedAt };
      }, ["window"]) };
    }),
  };
}

function identityChurn(): Counterfactual {
  const id = "identity_churn";
  return {
    id,
    family: "identity_churn",
    doc: "From a seeded instant in the middle half of the session, the true bus reports under a new vehicle id.",
    scenarios: WAIT,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "ANY",
    usesTruthIdentity: true,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const successful = world.window.filter((snapshot) => !snapshot.error);
      const first = successful[0];
      const last = successful.at(-1);
      if (!first || !last) return undefined;
      const start = timeOf(first);
      const churnAt = start + (0.25 + 0.5 * randomFor(context, id)()) * (timeOf(last) - start);
      const truthId = context.truth.vehicleId;
      const rows = rowsOf(world.window, truthId);
      if (!rows.some(({ at }) => at < churnAt) || !rows.some(({ at }) => at >= churnAt)) return undefined;
      const churned = injectedId("identity_churn", 1);
      return {
        world: mapRows(world, (row, snapshot) => (row.vehicleId === truthId && timeOf(snapshot) >= churnAt ? { ...row, vehicleId: churned } : row)),
        injected: [churned],
      };
    }),
  };
}

function sessionStartWaiting(): Counterfactual {
  return {
    id: "session_start_waiting",
    family: "session_start_waiting",
    doc: "The base waiting case unchanged: the rider starts the session standing at the stop.",
    scenarios: WAIT,
    expectations: ["GROUND_TRUTH_REPRODUCED", "NOT_WRONG"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: false,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, identity),
  };
}

function sessionStartOnBoard(): Counterfactual {
  return {
    id: "session_start_on_board",
    family: "session_start_on_board",
    doc: "The base on-board case unchanged: the rider starts the session as the bus reaches the stop.",
    scenarios: ON_BOARD,
    expectations: ["GROUND_TRUTH_REPRODUCED", "NOT_WRONG"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: false,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, identity),
  };
}

function delayedOnBoardStart(delayMs: number): Counterfactual {
  const seconds = delayMs / 1_000;
  return {
    id: `delayed_on_board_start_${seconds}s`,
    family: "delayed_on_board_start",
    doc: `The same on-board case, declared ${seconds} s after boarding: the session window starts ${seconds} s later.`,
    scenarios: ON_BOARD,
    expectations: ["NOT_WRONG"],
    groundTruthShift: "UNCHANGED",
    usesTruthIdentity: false,
    usesTruthTiming: false,
    apply: (passiveCase, context) => build(passiveCase, context, (world) => {
      const start = world.sessionStartAt + delayMs;
      const moved = world.window.filter((snapshot) => timeOf(snapshot) < start);
      if (moved.length === 0) return undefined;
      return {
        world: {
          ...world,
          leadIn: [...world.leadIn, ...moved],
          window: world.window.filter((snapshot) => timeOf(snapshot) >= start),
          sessionStartAt: start,
        },
      };
    }),
  };
}

/** Every counterfactual, in report order. Ids are stable. */
export const COUNTERFACTUALS: readonly Counterfactual[] = [
  ...[1, 2, 4].map((stops) => departedDecoy(stops)),
  trueBusApproaching(),
  approachingVsDeparted(),
  ...[1, 2, 3, 4, 5, 10].map((stops) => followerBehind(stops)),
  followerOvertaking(),
  ...[1, 2, 3, 4, 5, 10].map((stops) => leaderAhead(stops)),
  ...[60_000, 120_000].map((ms) => boardingStopDwell(ms)),
  trueBusAbsent(),
  decoysAbsent(),
  lateAppearance(),
  truthHole("candidate_disappearance_60s", "candidate_disappearance",
    "Drops the true bus's rows for the 60 s before the modelled boarding; it is next seen at the stop.", 60_000, 0, false),
  truthHole("reappearance_60s", "reappearance",
    "Drops the true bus's rows from 120 s to 60 s before the modelled boarding; it comes back under the same id while still approaching.", 120_000, 60_000, true),
  staleRepeatedFrames(),
  coordinateFreeze(),
  contentFreeze(),
  ...[10_000, 20_000, 40_000].map((ms) => receiptJitter(ms)),
  ...[0.2, 0.5].map((rate) => packetLoss(rate)),
  longPollingGap(),
  providerErrorBurst(),
  routeLoopSeam(),
  duplicatedStopName(),
  repeatedRouteGeometry(),
  routeVariantTwin(),
  backwardsDecoy(),
  shiftedTruthContent("delayed_movement_20s", "delayed_movement",
    "The true bus's provider content lags 20 s behind its receipts, which are untouched.", 20_000),
  shiftedTruthContent("delayed_movement_40s", "delayed_movement",
    "The true bus's provider content lags 40 s behind its receipts, which are untouched.", 40_000),
  shiftedTruthContent("early_movement_20s", "early_movement",
    "The true bus's provider content runs 20 s ahead of its receipts, which are untouched.", -20_000),
  multipleEligible(),
  zeroEligible(),
  identityChurn(),
  sessionStartWaiting(),
  sessionStartOnBoard(),
  ...[30_000, 90_000].map((ms) => delayedOnBoardStart(ms)),
];

/* ============================================= ground truth, re-derived */

export type IndeterminateReason = GeneratorRejection | "GT_ON_BOARD_CROSSING_NOT_FOUND";

export type RederivedGroundTruth =
  | { status: "QUALIFIED"; truth: PassiveGroundTruth; crossing: Crossing }
  | { status: "GT_INDETERMINATE"; reason: IndeterminateReason };

/** The transformed world as the generator would read it: lead-in plus session window. */
export function counterfactualModelStream(meta: PassiveCaseMeta, application: CounterfactualApplication): PassiveObservationStream {
  const snapshots = [...application.leadIn, ...application.input.snapshots];
  return {
    schemaVersion: PASSIVE_SHADOW_SCHEMA_VERSION,
    policyVersion: PASSIVE_SHADOW_POLICY_VERSION,
    sourceClass: "SYNTHETIC_OR_PERTURBED",
    streamId: `${meta.streamId}~counterfactual`,
    collectionId: meta.collectionId,
    providerPath: "synthetic",
    collectorEngine: "passive-counterfactual",
    routeId: meta.routeId,
    cityCode: meta.cityCode,
    stops: application.input.stops,
    intervalMs: application.input.intervalMs,
    startedAt: snapshots[0]?.capturedAt ?? application.input.startedAt,
    endedAt: application.input.endedAt,
    snapshots,
    duplicateReceiptsDropped: 0,
  };
}

/**
 * The answer of the transformed world, by the generator's own rules and code:
 * a waiting rider boards the first vehicle to reach the stop after the session
 * starts (`firstArrivalAfter`); an on-board rider is on the vehicle whose
 * crossing reached the stop when they boarded, re-qualified exactly as the
 * generator qualifies an on-board case (`qualify` from the crossing's last
 * sighting before the stop).
 */
export function rederiveGroundTruth(
  meta: PassiveCaseMeta,
  application: CounterfactualApplication,
  policy: PassiveCaseGeneratorPolicy = PASSIVE_CASE_POLICY_V1,
): RederivedGroundTruth {
  const stream = counterfactualModelStream(meta, application);
  const trajectories = extractTrajectories(stream, policy);
  const stopSequence = meta.boardingSequence;
  const crossings = trajectories
    .map((trajectory) => findCrossing(trajectory, stopSequence))
    .filter((crossing): crossing is Crossing => crossing !== undefined);
  let decision: ReturnType<typeof qualify>;
  if (meta.scenario === "ON_BOARD_START") {
    const boardedAt = application.boardedAt;
    const chosen = boardedAt === undefined ? undefined : crossings.find((crossing) => crossing.nextAt === boardedAt);
    if (!chosen) return { status: "GT_INDETERMINATE", reason: "GT_ON_BOARD_CROSSING_NOT_FOUND" };
    decision = qualify(trajectories, crossings, chosen, stopSequence, chosen.prevAt, policy);
  } else {
    decision = firstArrivalAfter(trajectories, crossings, stopSequence, application.sessionStartAt, policy);
  }
  if (!decision.ok) return { status: "GT_INDETERMINATE", reason: decision.reason };
  const crossing = decision.crossing;
  return {
    status: "QUALIFIED",
    crossing,
    truth: {
      caseId: meta.caseId,
      vehicleId: crossing.vehicleId,
      source: "passive_first_arrival_model",
      confidence: "bracketed_crossing",
      provenance: {
        streamId: stream.streamId,
        collectionId: meta.collectionId,
        trajectoryId: crossing.trajectoryId,
        crossingPrevAt: iso(crossing.prevAt),
        crossingNextAt: iso(crossing.nextAt),
        crossingJump: crossing.jump,
        stopSequence,
      },
    },
  };
}

/* ========================================================== evaluation */

export type CounterfactualOutcome =
  | "correct"
  | "wrong"
  | "abstain"
  | "provider_failure"
  | "insufficient_evidence"
  | "stale_failure"
  | "direction_failure";

function outcomeOf(bucket: PassiveBucket): CounterfactualOutcome {
  switch (bucket) {
    case "PASSIVE_CORRECT": return "correct";
    case "PASSIVE_WRONG": return "wrong";
    case "PASSIVE_ABSTAINED":
    case "PASSIVE_AMBIGUOUS": return "abstain";
    case "PASSIVE_PROVIDER_FAILURE": return "provider_failure";
    case "PASSIVE_INSUFFICIENT_EVIDENCE": return "insufficient_evidence";
    case "PASSIVE_STALE_FAILURE": return "stale_failure";
    case "PASSIVE_DIRECTION_FAILURE": return "direction_failure";
  }
}

export interface CounterfactualEvaluateOptions {
  policy?: PassiveCaseGeneratorPolicy;
  replay?: ReplayFunction;
  /** Replay under another matcher (in practice the legacy one, to prove the expectations have teeth). Must name its policy. */
  matcher?: MatcherFunction;
  matcherPolicy?: string;
}

/** One counterfactual of one case. Raw vehicle ids: never serialise this; the report sanitizes it. */
export interface CounterfactualEvaluation {
  counterfactualId: string;
  family: CounterfactualFamily;
  caseId: string;
  scenario: PassiveScenario;
  sourceClass: "SYNTHETIC_OR_PERTURBED";
  evidenceLabel: CounterfactualEvidenceLabel;
  baseSourceClass: PassiveSourceClass;
  baseTruthVehicleId: string;
  injected: string[];
  sessionStartAt: string;
  groundTruth: RederivedGroundTruth;
  /** Scored against the re-derived ground truth; present only when it qualified. */
  result?: PassiveCaseResult;
  outcome?: CounterfactualOutcome;
  committedVehicleId?: string;
  commitAt?: string;
  committedStopOffset?: number;
  directedInvariantViolated: boolean;
  /** The matcher threw `MatcherInvariantError`: it tried to return a violating selection. */
  matcherInvariantError?: string;
  committedToInjected: boolean;
  selectedInjected: boolean;
  selectedOtherRoute: boolean;
  expectationFailures: MetamorphicExpectation[];
  /**
   * How many of the family's own expectations (not the invariant every family
   * carries) could be decided on this case. `NOT_WRONG` needs a qualified
   * ground truth; the others are decided on every applicable case.
   */
  familyExpectationsChecked: number;
  /** The re-derived answer is not what the transformation is built to produce. A construction check, not a matcher check. */
  groundTruthShiftMismatch: boolean;
}

export function evaluateCounterfactual(
  passiveCase: PassiveCase,
  context: CounterfactualContext,
  counterfactual: Counterfactual,
  application: CounterfactualApplication,
  options: CounterfactualEvaluateOptions = {},
): CounterfactualEvaluation {
  const { meta } = passiveCase;
  const input = application.input;
  assertBlindMatcherInput(input);
  if (options.matcher && !options.matcherPolicy) throw new Error("a replacement matcher must name its policy");
  const labels = blindLabels(input);
  const riderState: RiderState = riderStateFor(meta.scenario);
  const replay = options.replay ?? replayMatching;

  // Blind replay first. No boardedVehicleId, no lead-in: the session's window only.
  let evidence: MatchGateEvidence | undefined;
  let matcherInvariantError: string | undefined;
  try {
    evidence = replay(toBlindCapture(input), {
      labels,
      recordDecisions: true,
      riderState,
      ...(options.matcher ? { matcher: options.matcher, matcherPolicy: options.matcherPolicy } : {}),
    });
  } catch (error) {
    if (!(error instanceof MatcherInvariantError)) throw error;
    matcherInvariantError = error.message;
  }

  // Only now the answer of the transformed world.
  const groundTruth = rederiveGroundTruth(meta, application, options.policy);

  const byLabel = new Map([...labels].map(([vehicleId, label]) => [label, vehicleId]));
  const committedVehicleId = evidence?.firstCommit ? byLabel.get(evidence.firstCommit.selectedLabel) : undefined;
  const commitAt = evidence?.firstCommit?.at;
  const committedPosition = committedVehicleId !== undefined && commitAt !== undefined
    ? positionAt(input, committedVehicleId, Date.parse(commitAt))
    : undefined;
  const committedStopOffset = committedPosition === undefined ? undefined : committedPosition - meta.boardingSequence;
  const directedInvariantViolated = matcherInvariantError !== undefined || (committedStopOffset !== undefined
    && (riderState === "on_board" ? committedStopOffset < 1 : committedStopOffset >= 0));

  const injected = new Set(application.injected);
  const selections = selectionsOf(input, evidence?.decisions ?? [], byLabel);
  const selectedInjected = selections.some((selection) => injected.has(selection.vehicleId));
  const selectedOtherRoute = selections.some((selection) => selection.routeId !== input.routeId);
  const frozenCutoff = application.frozenFromAt === undefined
    ? undefined
    : application.frozenFromAt + TAGO_CADENCE_POLICY_V1.historyWindowMs;
  const selectedOnFrozenWindow = frozenCutoff !== undefined && selections.some((selection) => Date.parse(selection.at) > frozenCutoff);

  const cfMeta: PassiveCaseMeta = { ...meta, sourceClass: "SYNTHETIC_OR_PERTURBED", sessionStartAt: iso(application.sessionStartAt) };
  const result = groundTruth.status === "QUALIFIED" && evidence
    ? classifyPassiveCase(cfMeta, input, evidence, labels, groundTruth.truth, {
      perturbation: counterfactual.id,
      sourceClass: "SYNTHETIC_OR_PERTURBED",
      ...(options.matcherPolicy ? { matcherPolicy: options.matcherPolicy } : {}),
    })
    : undefined;

  const failures: MetamorphicExpectation[] = [];
  let familyExpectationsChecked = 0;
  const own = new Set<MetamorphicExpectation>(counterfactual.expectations);
  const expectations = new Set<MetamorphicExpectation>([...counterfactual.expectations, "NO_INVARIANT_VIOLATION"]);
  for (const expectation of expectations) {
    let holds: boolean | undefined;
    switch (expectation) {
      case "NOT_WRONG": holds = result ? result.bucket !== "PASSIVE_WRONG" : undefined; break;
      case "NO_COMMIT": holds = matcherInvariantError === undefined && evidence?.firstCommit === undefined; break;
      case "NEVER_SELECTS_INJECTED": holds = !selectedInjected; break;
      case "NEVER_SELECTS_OTHER_ROUTE": holds = !selectedOtherRoute; break;
      case "NO_INVARIANT_VIOLATION": holds = !directedInvariantViolated; break;
      case "GROUND_TRUTH_REPRODUCED":
        holds = groundTruth.status === "QUALIFIED"
          && groundTruth.truth.vehicleId === context.truth.vehicleId
          && groundTruth.truth.provenance.crossingNextAt === context.truth.provenance.crossingNextAt;
        break;
      case "NO_SELECTION_ON_FROZEN_WINDOW": holds = !selectedOnFrozenWindow; break;
    }
    if (holds !== undefined && own.has(expectation) && expectation !== "NO_INVARIANT_VIOLATION") familyExpectationsChecked += 1;
    if (holds === false) failures.push(expectation);
  }

  let groundTruthShiftMismatch = false;
  if (groundTruth.status === "QUALIFIED") {
    const vehicleId = groundTruth.truth.vehicleId;
    if (counterfactual.groundTruthShift === "UNCHANGED") groundTruthShiftMismatch = vehicleId !== context.truth.vehicleId;
    if (counterfactual.groundTruthShift === "TO_INJECTED") groundTruthShiftMismatch = !injected.has(vehicleId);
  }

  return {
    counterfactualId: counterfactual.id,
    family: counterfactual.family,
    caseId: meta.caseId,
    scenario: meta.scenario,
    sourceClass: "SYNTHETIC_OR_PERTURBED",
    evidenceLabel: evidenceLabelFor(meta.sourceClass),
    baseSourceClass: meta.sourceClass,
    baseTruthVehicleId: context.truth.vehicleId,
    injected: [...application.injected],
    sessionStartAt: iso(application.sessionStartAt),
    groundTruth,
    ...(result ? { result, outcome: outcomeOf(result.bucket) } : {}),
    ...(committedVehicleId !== undefined ? { committedVehicleId } : {}),
    ...(commitAt !== undefined ? { commitAt } : {}),
    ...(committedStopOffset !== undefined ? { committedStopOffset } : {}),
    directedInvariantViolated,
    ...(matcherInvariantError !== undefined ? { matcherInvariantError } : {}),
    committedToInjected: committedVehicleId !== undefined && injected.has(committedVehicleId),
    selectedInjected,
    selectedOtherRoute,
    expectationFailures: failures,
    familyExpectationsChecked,
    groundTruthShiftMismatch,
  };
}

/** The committed vehicle's last reported stop sequence at or before `at` — the evaluator's own reading. */
function positionAt(input: PassiveMatcherInput, vehicleId: string, at: number): number | undefined {
  let position: number | undefined;
  for (const snapshot of input.snapshots) {
    if (Date.parse(snapshot.capturedAt) > at) break;
    const row = snapshot.vehicles.find((vehicle) => vehicle.vehicleId === vehicleId);
    if (row?.stopSequence !== undefined) position = row.stopSequence;
  }
  return position;
}

/** Every matched decision, with the selected vehicle's route as reported in that decision's snapshot. */
function selectionsOf(
  input: PassiveMatcherInput,
  decisions: ReplayDecision[],
  byLabel: ReadonlyMap<string, string>,
): Array<{ at: string; vehicleId: string; routeId?: string }> {
  // The same snapshots, in the same order, as `replayBlind` decides on.
  const successful = input.snapshots
    .filter((snapshot) => !snapshot.error)
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
  const selections: Array<{ at: string; vehicleId: string; routeId?: string }> = [];
  decisions.forEach((decision, index) => {
    if (decision.status !== "matched" || !decision.selectedLabel) return;
    const vehicleId = byLabel.get(decision.selectedLabel);
    if (vehicleId === undefined) return;
    const aligned = successful[index];
    const snapshot = aligned?.capturedAt === decision.at ? aligned : successful.find((item) => item.capturedAt === decision.at);
    const row = snapshot?.vehicles.find((vehicle) => vehicle.vehicleId === vehicleId);
    selections.push({ at: decision.at, vehicleId, ...(row ? { routeId: row.routeId } : {}) });
  });
  return selections;
}

/** The context every counterfactual of one case is built from. `streamSnapshots` is the base stream, in time order. */
export function counterfactualContext(
  passiveCase: PassiveCase,
  truth: PassiveGroundTruth,
  streamSnapshots: RideSnapshot[],
  policy: CounterfactualPolicy = COUNTERFACTUAL_POLICY_V1,
): CounterfactualContext {
  const start = Date.parse(passiveCase.meta.sessionStartAt);
  return {
    truth,
    boardingAt: Date.parse(truth.provenance.crossingNextAt),
    seed: seedFor(passiveCase.meta.caseId),
    leadIn: streamSnapshots
      .filter((snapshot) => {
        const at = timeOf(snapshot);
        return at < start && at >= start - policy.leadInMs;
      })
      .map(copySnapshot),
    policy,
  };
}

/* ============================================================ pipeline */

export interface CounterfactualRunOptions extends CounterfactualEvaluateOptions {
  counterfactualPolicy?: CounterfactualPolicy;
  counterfactuals?: readonly Counterfactual[];
  /** Restrict the base cases (tests). Deterministic as long as the predicate is. */
  caseFilter?: (meta: PassiveCaseMeta) => boolean;
  /** Evaluate at most this many base cases per scenario, on an even stride by case id. Absent: all. */
  maxCasesPerScenario?: number;
  /** Return every evaluation, raw vehicle ids included. For tests; the CLI never asks for it. */
  keepEvaluations?: boolean;
  /** Case ids kept per list in the report (counts are never capped). */
  maxCaseIdsPerList?: number;
  /** Sanitized per-case records kept in the report (notable cases only). */
  maxRecords?: number;
}

export interface CaseIdList {
  count: number;
  caseIds: string[];
  /** Case ids beyond `maxCaseIdsPerList`, counted but not listed. */
  omitted: number;
}

export interface CounterfactualRow {
  id: string;
  family: CounterfactualFamily;
  doc: string;
  scenarios: PassiveScenario[];
  expectations: MetamorphicExpectation[];
  groundTruthShift: GroundTruthShift;
  usesTruthIdentity: boolean;
  usesTruthTiming: boolean;
  applicable: number;
  skipped: number;
  skippedByReason: Record<string, number>;
  gtQualified: number;
  gtIndeterminate: number;
  gtIndeterminateReasons: Record<string, number>;
  /** Qualified cases whose re-derived answer is not the base case's vehicle. */
  gtChanged: number;
  correct: number;
  wrong: number;
  abstain: number;
  providerFailure: number;
  insufficient: number;
  staleFailure: number;
  directionFailure: number;
  /** GT_INDETERMINATE cases in which the matcher committed anyway (never scored). */
  indeterminateCommitted: number;
  invariantViolations: number;
  matcherInvariantErrors: number;
  /** First commits to a SYNTHETIC-CF vehicle — correct when the phantom is the re-derived answer. */
  commitsToInjected: number;
  /** Cases in which any decision selected a SYNTHETIC-CF vehicle. */
  selectionsOfInjected: number;
  /** Cases on which at least one of the family's own expectations could be decided. */
  exercised: number;
  groundTruthShiftMismatches: CaseIdList;
  expectationFailures: CaseIdList & { byExpectation: Record<string, number> };
}

/** One notable (case, counterfactual), pseudonyms only. */
export interface CounterfactualRecord {
  caseId: string;
  counterfactualId: string;
  scenario: PassiveScenario;
  evidenceLabel: CounterfactualEvidenceLabel;
  sessionStartAt: string;
  baseGroundTruth: string;
  groundTruth:
    | { status: "QUALIFIED"; vehicle: string; changed: boolean; crossingNextAt: string }
    | { status: "GT_INDETERMINATE"; reason: IndeterminateReason };
  outcome?: CounterfactualOutcome;
  bucket?: PassiveBucket;
  committed: string | null;
  commitAt?: string;
  commitRelativeToBoardingSeconds?: number;
  committedStopOffset?: number;
  directedInvariantViolated: boolean;
  matcherInvariantError?: string;
  injected: string[];
  selectedInjected: boolean;
  selectedOtherRoute: boolean;
  expectationFailures: MetamorphicExpectation[];
  groundTruthShiftMismatch: boolean;
}

export interface CounterfactualReport {
  schemaVersion: typeof PASSIVE_COUNTERFACTUAL_SCHEMA_VERSION;
  policyVersion: typeof PASSIVE_COUNTERFACTUAL_POLICY_VERSION;
  sourceClass: "SYNTHETIC_OR_PERTURBED";
  countsAsLiveEvidence: false;
  independentRides: 0;
  note: string;
  /** Evaluations per evidence label. A counterfactual of a live case is `COUNTERFACTUAL_OF_LIVE_PASSIVE`, never `LIVE_PASSIVE`. */
  evidenceLabels: Partial<Record<CounterfactualEvidenceLabel, number>>;
  /** Base cases evaluated, by the source class of the stream they came from. */
  baseSourceClasses: Partial<Record<PassiveSourceClass, number>>;
  matcherPolicy: string;
  groundTruthModel: "passive_first_arrival_model";
  groundTruthRederivation: string;
  generatorPolicy: PassiveCaseGeneratorPolicy;
  counterfactualPolicy: CounterfactualPolicy;
  expectationDocs: Readonly<Record<MetamorphicExpectation, string>>;
  baseCases: { generated: number; evaluated: number; byScenario: Record<string, number>; capped: boolean };
  /** Families with at least one applicable case. */
  families: number;
  /**
   * Families whose own expectations were decided on at least one case. A
   * family that applied but could never be judged (every re-derived answer
   * indeterminate) is not evidence, and the release gate counts only these.
   */
  familiesExercised: number;
  byFamily: Record<string, { counterfactuals: string[]; applicable: number; exercised: number; wrong: number; invariantViolations: number; expectationFailures: number }>;
  /**
   * How the run was restricted. Release-gate evidence needs the whole
   * catalogue on every generated case under the production replay: any of
   * these makes it a partial run.
   */
  restrictions: { caseFilter: boolean; counterfactualSubset: boolean; customReplay: boolean; customMatcher: boolean };
  totals: {
    counterfactuals: number;
    applicable: number;
    gtQualified: number;
    gtIndeterminate: number;
    correct: number;
    wrong: number;
    abstain: number;
    invariantViolations: number;
    matcherInvariantErrors: number;
    commitsToInjected: number;
    /** (case, counterfactual) pairs with at least one failed expectation. */
    expectationFailures: number;
    groundTruthShiftMismatches: number;
  };
  counterfactuals: CounterfactualRow[];
  /** Notable cases only: a failed expectation, a wrong commit, a violation, an incorrect commit to an injected vehicle, a construction mismatch. */
  records: CounterfactualRecord[];
  recordsOmitted: number;
  limitations: string[];
}

export interface CounterfactualRun {
  report: CounterfactualReport;
  /** Only with `keepEvaluations`. Raw vehicle ids: never write these out. */
  evaluations?: CounterfactualEvaluation[];
}

/** Base cases on an even stride by case id, per scenario. Independent of every result. */
export function counterfactualBasis(
  cases: PassiveCase[],
  options: Pick<CounterfactualRunOptions, "caseFilter" | "maxCasesPerScenario"> = {},
): PassiveCase[] {
  const selected = options.caseFilter ? cases.filter((passiveCase) => options.caseFilter!(passiveCase.meta)) : cases;
  const byScenario = new Map<PassiveScenario, PassiveCase[]>();
  for (const passiveCase of selected) {
    const list = byScenario.get(passiveCase.meta.scenario) ?? [];
    list.push(passiveCase);
    byScenario.set(passiveCase.meta.scenario, list);
  }
  const cap = options.maxCasesPerScenario;
  const basis: PassiveCase[] = [];
  for (const scenario of ["WAIT_AT_STOP", "ON_BOARD_START"] as const) {
    // Code-unit order, not locale collation: the basis must not depend on the machine.
    const list = (byScenario.get(scenario) ?? []).sort((left, right) => (left.meta.caseId < right.meta.caseId ? -1 : left.meta.caseId > right.meta.caseId ? 1 : 0));
    if (cap === undefined || list.length <= cap) basis.push(...list);
    else basis.push(...Array.from({ length: cap }, (_, index) => list[Math.floor((index * list.length) / cap)]!));
  }
  return basis;
}

/**
 * streams → validate → generate cases (answers into the vault) → for each base
 * case and each counterfactual: transform, replay blind, re-derive the answer,
 * score, check expectations → sanitized report. Pure and deterministic.
 */
export function runCounterfactuals(streams: PassiveObservationStream[], options: CounterfactualRunOptions = {}): CounterfactualRun {
  for (const stream of streams) validatePassiveStream(stream);
  if (options.matcher && !options.matcherPolicy) throw new Error("a replacement matcher must name its policy");
  const policy = options.policy ?? PASSIVE_CASE_POLICY_V1;
  const counterfactualPolicy = options.counterfactualPolicy ?? COUNTERFACTUAL_POLICY_V1;
  const counterfactuals = options.counterfactuals ?? COUNTERFACTUALS;
  const ids = counterfactuals.map((counterfactual) => counterfactual.id);
  if (new Set(ids).size !== ids.length) throw new Error("counterfactual ids must be unique");
  const maxCaseIds = options.maxCaseIdsPerList ?? 1_000;
  const maxRecords = options.maxRecords ?? 2_000;

  const generated = generatePassiveCases(streams, { policy });
  const snapshotsByStream = new Map(streams.map((stream) => [stream.streamId, sortedSnapshots(stream)]));
  const basis = counterfactualBasis(generated.cases, options);
  const { pseudonym, allVehicleIds } = vehiclePseudonyms(streams);

  const rows = new Map(counterfactuals.map((counterfactual) => [counterfactual.id, emptyRow(counterfactual)]));
  const evaluations: CounterfactualEvaluation[] = [];
  const records: CounterfactualRecord[] = [];
  let recordsOmitted = 0;
  const evidenceLabels: Partial<Record<CounterfactualEvidenceLabel, number>> = {};
  const baseSourceClasses: Partial<Record<PassiveSourceClass, number>> = {};
  const byScenario: Record<string, number> = {};
  const evaluateOptions: CounterfactualEvaluateOptions = {
    policy,
    ...(options.replay ? { replay: options.replay } : {}),
    ...(options.matcher ? { matcher: options.matcher, matcherPolicy: options.matcherPolicy } : {}),
  };

  for (const passiveCase of basis) {
    const { meta } = passiveCase;
    baseSourceClasses[meta.sourceClass] = (baseSourceClasses[meta.sourceClass] ?? 0) + 1;
    byScenario[meta.scenario] = (byScenario[meta.scenario] ?? 0) + 1;
    // Revealed up front: the transformations need the answer to be built. That
    // is why nothing below is evidence.
    const truth = generated.vault.reveal(meta.caseId);
    const context = counterfactualContext(passiveCase, truth, snapshotsByStream.get(meta.streamId) ?? [], counterfactualPolicy);
    for (const counterfactual of counterfactuals) {
      const row = rows.get(counterfactual.id)!;
      if (!counterfactual.scenarios.includes(meta.scenario)) {
        skip(row, "SCENARIO");
        continue;
      }
      const application = counterfactual.apply(passiveCase, context);
      if (!application) {
        skip(row, "NOT_APPLICABLE");
        continue;
      }
      const evaluation = evaluateCounterfactual(passiveCase, context, counterfactual, application, evaluateOptions);
      accumulate(row, evaluation, maxCaseIds);
      evidenceLabels[evaluation.evidenceLabel] = (evidenceLabels[evaluation.evidenceLabel] ?? 0) + 1;
      if (isNotable(evaluation)) {
        if (records.length < maxRecords) records.push(sanitizedRecord(evaluation, pseudonym));
        else recordsOmitted += 1;
      }
      if (options.keepEvaluations) evaluations.push(evaluation);
    }
  }

  const counterfactualRows = [...rows.values()];
  const byFamily: CounterfactualReport["byFamily"] = {};
  for (const row of counterfactualRows) {
    const family = byFamily[row.family] ?? { counterfactuals: [], applicable: 0, exercised: 0, wrong: 0, invariantViolations: 0, expectationFailures: 0 };
    family.counterfactuals.push(row.id);
    family.applicable += row.applicable;
    family.exercised += row.exercised;
    family.wrong += row.wrong;
    family.invariantViolations += row.invariantViolations;
    family.expectationFailures += row.expectationFailures.count;
    byFamily[row.family] = family;
  }
  const sum = (pick: (row: CounterfactualRow) => number) => counterfactualRows.reduce((total, row) => total + pick(row), 0);

  const report: CounterfactualReport = {
    schemaVersion: PASSIVE_COUNTERFACTUAL_SCHEMA_VERSION,
    policyVersion: PASSIVE_COUNTERFACTUAL_POLICY_VERSION,
    sourceClass: "SYNTHETIC_OR_PERTURBED",
    countsAsLiveEvidence: false,
    independentRides: 0,
    note: "Counterfactual transformations of recorded pseudo-boarding cases. Robustness evidence only: never an observation, never an "
      + "independent ride, never a live count. Each was built with its base case's revealed answer, and each is scored against an "
      + "answer re-derived by the first-arrival model in the world the transformation invented.",
    evidenceLabels,
    baseSourceClasses,
    matcherPolicy: options.matcherPolicy ?? MATCHER_POLICY_VERSION,
    groundTruthModel: "passive_first_arrival_model",
    groundTruthRederivation: "extractTrajectories + findCrossing on the transformed lead-in and session window; firstArrivalAfter at the "
      + "session start (waiting) or qualify of the crossing at the boarding instant (on board). The lead-in reaches the model only.",
    generatorPolicy: policy,
    counterfactualPolicy,
    expectationDocs: EXPECTATION_DOCS,
    baseCases: {
      generated: generated.cases.length,
      evaluated: basis.length,
      byScenario,
      capped: options.maxCasesPerScenario !== undefined && basis.length < (options.caseFilter
        ? generated.cases.filter((passiveCase) => options.caseFilter!(passiveCase.meta)).length
        : generated.cases.length),
    },
    families: Object.values(byFamily).filter((family) => family.applicable > 0).length,
    familiesExercised: Object.values(byFamily).filter((family) => family.exercised > 0).length,
    byFamily,
    restrictions: {
      caseFilter: options.caseFilter !== undefined,
      counterfactualSubset: counterfactuals !== COUNTERFACTUALS,
      customReplay: options.replay !== undefined,
      customMatcher: options.matcher !== undefined,
    },
    totals: {
      counterfactuals: counterfactualRows.length,
      applicable: sum((row) => row.applicable),
      gtQualified: sum((row) => row.gtQualified),
      gtIndeterminate: sum((row) => row.gtIndeterminate),
      correct: sum((row) => row.correct),
      wrong: sum((row) => row.wrong),
      abstain: sum((row) => row.abstain),
      invariantViolations: sum((row) => row.invariantViolations),
      matcherInvariantErrors: sum((row) => row.matcherInvariantErrors),
      commitsToInjected: sum((row) => row.commitsToInjected),
      expectationFailures: sum((row) => row.expectationFailures.count),
      groundTruthShiftMismatches: sum((row) => row.groundTruthShiftMismatches.count),
    },
    counterfactuals: counterfactualRows,
    records,
    recordsOmitted,
    limitations: [
      "Counterfactuals transform recorded observations; they are not observations, not independent rides, and never enter a live count.",
      "Every counterfactual was built with its base case's revealed answer (see usesTruthIdentity / usesTruthTiming).",
      "Injected vehicles move by fixed rules (one stop per phantomMsPerStop, or a copy of the true bus shifted by whole stops); real buses do not.",
      "GT_INDETERMINATE cases are checked only against expectations that need no answer; they are never scored right or wrong.",
      "Cases from one trajectory or one boarding event are correlated, and so are the counterfactuals built on them.",
      "Only the backend matcher (services/api/src/matching.ts) is evaluated; the Swift engine is not.",
    ],
  };
  assertNoRawVehicleIds(report, allVehicleIds);
  return { report, ...(options.keepEvaluations ? { evaluations } : {}) };
}

function emptyList(): CaseIdList {
  return { count: 0, caseIds: [], omitted: 0 };
}

function pushCase(list: CaseIdList, caseId: string, max: number): void {
  list.count += 1;
  if (list.caseIds.length < max) list.caseIds.push(caseId);
  else list.omitted += 1;
}

function emptyRow(counterfactual: Counterfactual): CounterfactualRow {
  return {
    id: counterfactual.id,
    family: counterfactual.family,
    doc: counterfactual.doc,
    scenarios: [...counterfactual.scenarios],
    expectations: [...new Set<MetamorphicExpectation>([...counterfactual.expectations, "NO_INVARIANT_VIOLATION"])],
    groundTruthShift: counterfactual.groundTruthShift,
    usesTruthIdentity: counterfactual.usesTruthIdentity,
    usesTruthTiming: counterfactual.usesTruthTiming,
    applicable: 0,
    skipped: 0,
    skippedByReason: {},
    gtQualified: 0,
    gtIndeterminate: 0,
    gtIndeterminateReasons: {},
    gtChanged: 0,
    correct: 0,
    wrong: 0,
    abstain: 0,
    providerFailure: 0,
    insufficient: 0,
    staleFailure: 0,
    directionFailure: 0,
    indeterminateCommitted: 0,
    invariantViolations: 0,
    matcherInvariantErrors: 0,
    commitsToInjected: 0,
    selectionsOfInjected: 0,
    exercised: 0,
    groundTruthShiftMismatches: emptyList(),
    expectationFailures: { ...emptyList(), byExpectation: {} },
  };
}

function skip(row: CounterfactualRow, reason: string): void {
  row.skipped += 1;
  row.skippedByReason[reason] = (row.skippedByReason[reason] ?? 0) + 1;
}

function accumulate(row: CounterfactualRow, evaluation: CounterfactualEvaluation, maxCaseIds: number): void {
  row.applicable += 1;
  if (evaluation.groundTruth.status === "QUALIFIED") {
    row.gtQualified += 1;
    if (evaluation.groundTruth.truth.vehicleId !== evaluation.baseTruthVehicleId) row.gtChanged += 1;
    switch (evaluation.outcome) {
      case "correct": row.correct += 1; break;
      case "wrong": row.wrong += 1; break;
      case "abstain": row.abstain += 1; break;
      case "provider_failure": row.providerFailure += 1; break;
      case "insufficient_evidence": row.insufficient += 1; break;
      case "stale_failure": row.staleFailure += 1; break;
      case "direction_failure": row.directionFailure += 1; break;
      case undefined: break;
    }
  } else {
    row.gtIndeterminate += 1;
    const reason = evaluation.groundTruth.reason;
    row.gtIndeterminateReasons[reason] = (row.gtIndeterminateReasons[reason] ?? 0) + 1;
    if (evaluation.committedVehicleId !== undefined) row.indeterminateCommitted += 1;
  }
  if (evaluation.directedInvariantViolated) row.invariantViolations += 1;
  if (evaluation.matcherInvariantError !== undefined) row.matcherInvariantErrors += 1;
  if (evaluation.committedToInjected) row.commitsToInjected += 1;
  if (evaluation.selectedInjected) row.selectionsOfInjected += 1;
  if (evaluation.familyExpectationsChecked > 0) row.exercised += 1;
  if (evaluation.groundTruthShiftMismatch) pushCase(row.groundTruthShiftMismatches, evaluation.caseId, maxCaseIds);
  if (evaluation.expectationFailures.length > 0) {
    pushCase(row.expectationFailures, evaluation.caseId, maxCaseIds);
    for (const expectation of evaluation.expectationFailures) {
      row.expectationFailures.byExpectation[expectation] = (row.expectationFailures.byExpectation[expectation] ?? 0) + 1;
    }
  }
}

/**
 * Kept as a record: anything that failed, and any commit to an injected vehicle
 * that was not the re-derived answer. A correct commit to a leading phantom is
 * the expected outcome and would only crowd the failures out of the cap.
 */
function isNotable(evaluation: CounterfactualEvaluation): boolean {
  return evaluation.expectationFailures.length > 0
    || evaluation.outcome === "wrong"
    || evaluation.directedInvariantViolated
    || evaluation.groundTruthShiftMismatch
    || (evaluation.committedToInjected && evaluation.outcome !== "correct");
}

function sanitizedRecord(evaluation: CounterfactualEvaluation, pseudonym: (vehicleId: string) => string): CounterfactualRecord {
  const truth = evaluation.groundTruth;
  const result = evaluation.result;
  return {
    caseId: evaluation.caseId,
    counterfactualId: evaluation.counterfactualId,
    scenario: evaluation.scenario,
    evidenceLabel: evaluation.evidenceLabel,
    sessionStartAt: evaluation.sessionStartAt,
    baseGroundTruth: pseudonym(evaluation.baseTruthVehicleId),
    groundTruth: truth.status === "QUALIFIED"
      ? {
        status: "QUALIFIED",
        vehicle: pseudonym(truth.truth.vehicleId),
        changed: truth.truth.vehicleId !== evaluation.baseTruthVehicleId,
        crossingNextAt: truth.truth.provenance.crossingNextAt,
      }
      : { status: "GT_INDETERMINATE", reason: truth.reason },
    ...(evaluation.outcome ? { outcome: evaluation.outcome } : {}),
    ...(result ? { bucket: result.bucket } : {}),
    committed: evaluation.committedVehicleId === undefined ? null : pseudonym(evaluation.committedVehicleId),
    ...(evaluation.commitAt ? { commitAt: evaluation.commitAt } : {}),
    ...(result?.commitRelativeToBoardingSeconds === undefined ? {} : { commitRelativeToBoardingSeconds: result.commitRelativeToBoardingSeconds }),
    ...(evaluation.committedStopOffset === undefined ? {} : { committedStopOffset: evaluation.committedStopOffset }),
    directedInvariantViolated: evaluation.directedInvariantViolated,
    ...(evaluation.matcherInvariantError === undefined ? {} : { matcherInvariantError: evaluation.matcherInvariantError }),
    injected: [...evaluation.injected],
    selectedInjected: evaluation.selectedInjected,
    selectedOtherRoute: evaluation.selectedOtherRoute,
    expectationFailures: [...evaluation.expectationFailures],
    groundTruthShiftMismatch: evaluation.groundTruthShiftMismatch,
  };
}

/**
 * What release gate `matcher-passive-safety-v4` reads as
 * `counterfactualsOnLiveBases` (criterion CA-5). Only for a run whose every
 * base case came from a `LIVE_PASSIVE` stream, under the production matcher
 * and replay, over the whole catalogue and every generated case (no cap, no
 * filter); anything else is `undefined`, never a partial pass. `families`
 * counts only families whose own expectations were decided on some case. The
 * evidence stays `SYNTHETIC_OR_PERTURBED`: the gate reads it as SIMULATED.
 */
export function counterfactualGateEvidence(report: CounterfactualReport): {
  families: number;
  expectationFailures: number;
  wrongAgainstRederivedTruth: number;
  invariantViolations: number;
  sourceClass: "SYNTHETIC_OR_PERTURBED";
  evidenceLabel: "COUNTERFACTUAL_OF_LIVE_PASSIVE";
  matcherPolicy: string;
  baseCasesEvaluated: number;
  applicable: number;
} | undefined {
  const classes = Object.keys(report.baseSourceClasses);
  if (classes.length === 0 || classes.some((sourceClass) => sourceClass !== "LIVE_PASSIVE")) return undefined;
  if (report.matcherPolicy !== MATCHER_POLICY_VERSION || report.baseCases.capped) return undefined;
  if (Object.values(report.restrictions).some(Boolean)) return undefined;
  return {
    families: report.familiesExercised,
    expectationFailures: report.totals.expectationFailures,
    wrongAgainstRederivedTruth: report.totals.wrong,
    invariantViolations: report.totals.invariantViolations,
    sourceClass: "SYNTHETIC_OR_PERTURBED",
    evidenceLabel: "COUNTERFACTUAL_OF_LIVE_PASSIVE",
    matcherPolicy: report.matcherPolicy,
    baseCasesEvaluated: report.baseCases.evaluated,
    applicable: report.totals.applicable,
  };
}
