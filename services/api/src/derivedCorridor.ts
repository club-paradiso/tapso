/**
 * Foundation for deriving a route corridor from many official TAGO vehicle
 * traversals (`docs/exec-plans/BOARDING_ANCHOR_POSITION_V2.md` §6).
 *
 * No authoritative road shape exists for any Jeju variant
 * (`JEJU_PRODUCTION_V1.md`: geometry `NOT AVAILABLE`). Before reaching for a
 * derived one: a single trip's trail is not a route — TAGO positions are
 * sparse (median content change ≈ 27.5 s), noisy, and one bus can detour. A
 * corridor is only produced from many independent traversals of one
 * directional variant, after outlier rejection and with stop-sequence
 * monotonicity, and it is labelled `derivedVehicleTrace`: never
 * `authoritative`, so the phone caps it below fusion
 * (`RouteGeometryQuality.derivedVehicleTrace`).
 *
 * Privacy: the builder takes vehicle *pseudonyms* and only ever counts them.
 * Plates are hashed with a keyed hash whose key is never stored with the
 * output; the corridor carries no vehicle key, no timestamp finer than a day
 * and no session or rider data.
 *
 * This PR ships the schema, builder and tests only. No corridor has been built
 * from real traversals and none is served.
 */

import { createHmac } from "node:crypto";

export interface CorridorStop {
  sequence: number;
  latitude: number;
  longitude: number;
}

export interface TraversalPoint {
  /** TAPSO receipt time (ms). Ordering only: TAGO publishes no observation time. */
  receivedAtMs: number;
  latitude: number;
  longitude: number;
  stopSequence?: number;
}

export interface Traversal {
  /** A pseudonym (`pseudonymizeVehicle`), never a plate. Counted, never output. */
  vehicleKey: string;
  points: TraversalPoint[];
}

export interface DerivedCorridorPolicy {
  minTraversals: number;
  minDistinctVehicles: number;
  binMeters: number;
  minTraversalsPerBin: number;
  /** Fraction of the stop-chord length the bins must cover. */
  minCoverage: number;
  /** Points farther than this from the stop-chord corridor are gross outliers. */
  maxChordDistanceMeters: number;
  /** Points implying a faster move than this from the previous kept point are rejected. */
  maxSpeedMps: number;
}

/** PROVISIONAL: engineering defaults, to be revisited with real traversal evidence. */
export const DERIVED_CORRIDOR_POLICY_V1: DerivedCorridorPolicy = {
  minTraversals: 12,
  minDistinctVehicles: 3,
  binMeters: 25,
  minTraversalsPerBin: 5,
  minCoverage: 0.9,
  maxChordDistanceMeters: 300,
  maxSpeedMps: 35,
};

export interface DerivedCorridor {
  schemaVersion: "tapso-derived-corridor-v1";
  label: "DERIVED_VEHICLE_TRACE";
  /** Never "authoritative". */
  quality: "derivedVehicleTrace";
  routeId: string;
  points: { latitude: number; longitude: number }[];
  provenance: {
    builder: "derivedCorridor.ts";
    policy: DerivedCorridorPolicy;
    traversalsUsed: number;
    traversalsRejected: number;
    distinctVehicles: number;
    pointsRejected: number;
    coverage: number;
    /** Calendar days (UTC) of the first and last receipt; nothing finer. */
    firstDay: string;
    lastDay: string;
  };
}

export type CorridorBuild =
  | { status: "built"; corridor: DerivedCorridor }
  | { status: "insufficient_evidence"; reason: string; traversalsUsed: number; distinctVehicles: number; coverage: number };

/** Keyed hash of a plate. The key lives in the collector's secret store, never with the output. */
export function pseudonymizeVehicle(plate: string, key: string): string {
  if (key.length < 16) throw new RangeError("pseudonym key must be at least 16 characters");
  return createHmac("sha256", key).update(plate).digest("hex").slice(0, 16);
}

const EARTH = 6_371_000;
const toXY = (origin: { latitude: number; longitude: number }, point: { latitude: number; longitude: number }) => ({
  x: ((point.longitude - origin.longitude) * Math.PI / 180) * EARTH * Math.cos((origin.latitude * Math.PI) / 180),
  y: ((point.latitude - origin.latitude) * Math.PI / 180) * EARTH,
});

function distance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const { x, y } = toXY(a, b);
  return Math.hypot(x, y);
}

function validPoint(point: TraversalPoint): boolean {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Number.isFinite(point.receivedAtMs)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180 && !(point.latitude === 0 && point.longitude === 0);
}

/** Along-chord distance and offset of a point, nearest segment. */
function project(chord: CorridorStop[], point: { latitude: number; longitude: number }): { along: number; offset: number } | undefined {
  let best: { along: number; offset: number } | undefined;
  let accumulated = 0;
  for (let index = 0; index < chord.length - 1; index += 1) {
    const a = chord[index]!;
    const b = toXY(a, chord[index + 1]!);
    const p = toXY(a, point);
    const length = Math.hypot(b.x, b.y);
    if (length > 1) {
      const t = Math.min(1, Math.max(0, (p.x * b.x + p.y * b.y) / (length * length)));
      const offset = Math.hypot(p.x - t * b.x, p.y - t * b.y);
      if (!best || offset < best.offset) best = { along: accumulated + t * length, offset };
    }
    accumulated += length;
  }
  return best;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Builds one directional variant's corridor, or says why the evidence is not
 * enough. Deterministic: the same traversals always give the same corridor.
 */
export function buildDerivedCorridor(
  routeId: string,
  stops: readonly CorridorStop[],
  traversals: readonly Traversal[],
  policy: DerivedCorridorPolicy = DERIVED_CORRIDOR_POLICY_V1,
): CorridorBuild {
  const chord = [...stops].sort((left, right) => left.sequence - right.sequence);
  let chordLength = 0;
  for (let index = 1; index < chord.length; index += 1) chordLength += distance(chord[index - 1]!, chord[index]!);
  const insufficient = (reason: string, used = 0, vehicles = 0, coverage = 0): CorridorBuild =>
    ({ status: "insufficient_evidence", reason, traversalsUsed: used, distinctVehicles: vehicles, coverage });
  if (chord.length < 2 || chordLength < policy.binMeters) return insufficient("route_too_short");

  const bins = new Map<number, { lat: number[]; lng: number[]; traversals: Set<number> }>();
  let used = 0;
  let rejectedTraversals = 0;
  let rejectedPoints = 0;
  const vehicles = new Set<string>();
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;

  traversals.forEach((traversal, traversalIndex) => {
    const points = [...traversal.points].filter(validPoint).sort((left, right) => left.receivedAtMs - right.receivedAtMs);
    rejectedPoints += traversal.points.length - points.length;
    // Sequence monotonicity: a traversal whose stop sequence ever decreases is
    // a different trip, a loop seam or a bad row; it is not split, it is dropped.
    const sequences = points.map((point) => point.stopSequence).filter((value): value is number => value !== undefined);
    if (sequences.some((value, index) => index > 0 && value < sequences[index - 1]!)) {
      rejectedTraversals += 1;
      return;
    }
    const kept: { point: TraversalPoint; along: number }[] = [];
    for (const point of points) {
      const projected = project(chord, point);
      if (!projected || projected.offset > policy.maxChordDistanceMeters) {
        rejectedPoints += 1;
        continue;
      }
      const previous = kept.at(-1);
      if (previous) {
        const seconds = (point.receivedAtMs - previous.point.receivedAtMs) / 1_000;
        const moved = distance(previous.point, point);
        // A jump faster than a bus can move, or a step backward along the chord beyond noise.
        if (seconds <= 0 || moved / seconds > policy.maxSpeedMps || projected.along < previous.along - 50) {
          rejectedPoints += 1;
          continue;
        }
      }
      kept.push({ point, along: projected.along });
    }
    if (kept.length < 2) {
      rejectedTraversals += 1;
      return;
    }
    used += 1;
    vehicles.add(traversal.vehicleKey);
    for (const { point, along } of kept) {
      const key = Math.floor(along / policy.binMeters);
      const bin = bins.get(key) ?? { lat: [], lng: [], traversals: new Set<number>() };
      bin.lat.push(point.latitude);
      bin.lng.push(point.longitude);
      bin.traversals.add(traversalIndex);
      bins.set(key, bin);
      first = Math.min(first, point.receivedAtMs);
      last = Math.max(last, point.receivedAtMs);
    }
  });

  const supported = [...bins.entries()]
    .filter(([, bin]) => bin.traversals.size >= policy.minTraversalsPerBin)
    .sort(([left], [right]) => left - right);
  const binCount = Math.ceil(chordLength / policy.binMeters);
  const coverage = Math.round((supported.length / binCount) * 1_000) / 1_000;
  if (used < policy.minTraversals) return insufficient("too_few_traversals", used, vehicles.size, coverage);
  if (vehicles.size < policy.minDistinctVehicles) return insufficient("too_few_distinct_vehicles", used, vehicles.size, coverage);
  if (coverage < policy.minCoverage) return insufficient("insufficient_coverage", used, vehicles.size, coverage);

  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    status: "built",
    corridor: {
      schemaVersion: "tapso-derived-corridor-v1",
      label: "DERIVED_VEHICLE_TRACE",
      quality: "derivedVehicleTrace",
      routeId,
      points: supported.map(([, bin]) => ({
        latitude: Math.round(median(bin.lat) * 1e6) / 1e6,
        longitude: Math.round(median(bin.lng) * 1e6) / 1e6,
      })),
      provenance: {
        builder: "derivedCorridor.ts",
        policy,
        traversalsUsed: used,
        traversalsRejected: rejectedTraversals,
        distinctVehicles: vehicles.size,
        pointsRejected: rejectedPoints,
        coverage,
        firstDay: day(first),
        lastDay: day(last),
      },
    },
  };
}
