/**
 * Seeded generators for property-based matcher tests. SYNTHETIC throughout:
 * invented routes, invented vehicles, a coordinate grid that is not a place.
 *
 * Not a test file: the runner only picks up `*.test.ts`.
 *
 * Every generated case is a pure function of its seed, so a failure is
 * reproduced by its seed alone. Failing seeds are kept for ever in
 * `fixtures/matcher-property-regressions.json` and run before any new seed.
 */

import { readFileSync } from "node:fs";

import type { MatchRequest, PassageMemory, RiderState, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import type { SourceFreshnessEvidence, SourceFreshnessState } from "../src/sourceFreshness.ts";

/** Mulberry32: small, fast, and identical on every platform. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function int(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

export function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

export function chance(random: () => number, probability: number): boolean {
  return random() < probability;
}

/** How many new seeds each property explores. `TAPSO_PROPERTY_CASES` raises it for a deep run. */
export function caseCount(fallback: number): number {
  const raw = Number(process.env.TAPSO_PROPERTY_CASES);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

export interface RegressionSeed {
  property: string;
  seed: number;
  foundAt: string;
  note: string;
}

export function regressionSeeds(property: string): number[] {
  const url = new URL("./fixtures/matcher-property-regressions.json", import.meta.url);
  const rows = JSON.parse(readFileSync(url, "utf8")) as { seeds: RegressionSeed[] };
  return rows.seeds.filter((row) => row.property === property).map((row) => row.seed);
}

/** Recorded seeds first, then fresh ones. A property that fails names its seed. */
export function forAllSeeds(property: string, count: number, check: (seed: number) => void): number {
  const seeds = [...regressionSeeds(property), ...Array.from({ length: caseCount(count) }, (_, index) => 10_000 + index)];
  for (const seed of seeds) {
    try {
      check(seed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`property "${property}" failed for seed ${seed} (add it to test/fixtures/matcher-property-regressions.json): ${message}`);
    }
  }
  return seeds.length;
}

/** `forAllSeeds` for properties that must await (session-level ones). */
export async function forAllSeedsAsync(property: string, count: number, check: (seed: number) => Promise<void>): Promise<number> {
  const seeds = [...regressionSeeds(property), ...Array.from({ length: caseCount(count) }, (_, index) => 10_000 + index)];
  for (const seed of seeds) {
    try {
      await check(seed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`property "${property}" failed for seed ${seed} (add it to test/fixtures/matcher-property-regressions.json): ${message}`);
    }
  }
  return seeds.length;
}

export const ROUTE = "SYN-PROP-ROUTE";
export const EPOCH = new Date(0).toISOString();
export const NOW = "2026-09-29T09:00:00.000Z";

export function syntheticStops(count: number, options: { loop?: boolean; repeatName?: number } = {}): StopOnRoute[] {
  const stops = Array.from({ length: count }, (_, index) => ({
    stopId: `SYN-P-${index + 1}`,
    name: `Synthetic stop ${index + 1}`,
    sequence: index + 1,
    latitude: 33.3 + index * 0.003,
    longitude: 126.4,
  }));
  if (options.loop && count >= 3) {
    const first = stops[0]!;
    stops[count - 1] = { ...stops[count - 1]!, stopId: first.stopId, name: first.name, latitude: first.latitude, longitude: first.longitude };
  }
  if (options.repeatName !== undefined && options.repeatName >= 1 && options.repeatName <= count) {
    const target = stops[options.repeatName - 1]!;
    const other = stops[(options.repeatName + Math.floor(count / 2)) % count]!;
    other.name = target.name;
  }
  return stops;
}

export function freshness(state: SourceFreshnessState): SourceFreshnessEvidence {
  return {
    state,
    sampleCount: state === "unknown" ? 1 : 4,
    spanSeconds: state === "unknown" ? 0 : 20,
    latestReceiptAgeSeconds: 0,
    maxReceiptGapSeconds: 5,
    contentChangeCount: state === "fresh" ? 2 : 0,
    sequenceDecreaseCount: state === "stale" ? 1 : 0,
    reason: "synthetic property-test cadence",
  };
}

export interface GeneratedMatch {
  request: MatchRequest;
  trusted: Map<string, SourceFreshnessEvidence>;
  description: string;
}

/**
 * A random decision instant: route shape, boarding stop, rider state, a set of
 * candidates at random offsets and freshness, sometimes remembered vehicles,
 * sometimes a prior passage memory.
 */
export function generateMatch(seed: number, overrides: { riderState?: RiderState } = {}): GeneratedMatch {
  const random = rng(seed);
  const count = int(random, 8, 40);
  const loop = chance(random, 0.2);
  const boarding = int(random, 2, count - 2);
  const repeatName = chance(random, 0.08) ? boarding : undefined;
  const stops = syntheticStops(count, { loop, ...(repeatName === undefined ? {} : { repeatName }) });
  const riderState = overrides.riderState ?? pick(random, ["waiting_at_stop", "on_board"] as const);
  const candidates: VehicleObservation[] = [];
  const trusted = new Map<string, SourceFreshnessEvidence>();
  const vehicles = int(random, 0, 6);
  for (let index = 0; index < vehicles; index += 1) {
    const vehicleId = `SYNTHETIC-${seed}-${index}`;
    const offset = int(random, -8, 8);
    const sequence = Math.min(count, Math.max(1, boarding + offset));
    const unknownPosition = chance(random, 0.05);
    const providerTimed = chance(random, 0.1);
    const observation: VehicleObservation = {
      vehicleId,
      routeId: chance(random, 0.1) ? "SYN-PROP-OTHER" : ROUTE,
      observedAt: providerTimed ? new Date(Date.parse(NOW) - int(random, 0, 150) * 1_000).toISOString() : EPOCH,
      receivedAt: NOW,
      timestampSource: providerTimed ? "provider" : "unavailable",
      ...(unknownPosition ? {} : { stopSequence: sequence }),
      latitude: 33.3 + (sequence - 1) * 0.003,
      longitude: 126.4,
    };
    candidates.push(observation);
    if (!providerTimed && !chance(random, 0.08)) {
      trusted.set(vehicleId, freshness(pick(random, ["fresh", "fresh", "fresh", "aging", "stale", "unknown"] as const)));
    }
    if (chance(random, 0.04)) {
      // The same vehicle reported twice in one snapshot, sometimes at another stop.
      candidates.push({ ...observation, stopSequence: Math.min(count, Math.max(1, sequence + int(random, 0, 2))) });
    }
  }
  const recentlySeen: VehicleObservation[] = [];
  const ghosts = chance(random, 0.3) ? int(random, 1, 2) : 0;
  for (let index = 0; index < ghosts; index += 1) {
    const sequence = Math.min(count, Math.max(1, boarding + int(random, -6, 6)));
    recentlySeen.push({
      vehicleId: `SYNTHETIC-${seed}-ghost-${index}`,
      routeId: ROUTE,
      observedAt: EPOCH,
      receivedAt: new Date(Date.parse(NOW) - int(random, 5, 85) * 1_000).toISOString(),
      timestampSource: "unavailable",
      stopSequence: sequence,
    });
  }
  let passage: PassageMemory | undefined;
  if (chance(random, 0.25)) {
    passage = {
      offsets: Object.fromEntries(candidates.slice(0, 2).filter((row) => row.stopSequence !== undefined).map((row) => {
        const offset = row.stopSequence! - boarding;
        return [row.vehicleId, { min: offset - int(random, 0, 4), max: offset }];
      })),
      ...(chance(random, 0.2) ? { withheld: { reason: "boarding_stop_reached_during_session", at: NOW } } : {}),
    };
  }
  const request: MatchRequest = {
    routeId: ROUTE,
    boardingStopSequence: boarding,
    now: NOW,
    candidates,
    riderState,
    ...(chance(random, 0.07) ? {} : { stops }),
    ...(recentlySeen.length ? { recentlySeen } : {}),
    ...(passage ? { passage } : {}),
  };
  return {
    request,
    trusted,
    description: `route ${count} stops${loop ? " (loop)" : ""}, boarding ${boarding}, ${riderState}, ${candidates.length} candidates`,
  };
}

/** Offset of a candidate from the boarding stop, or undefined. */
export function offsetOf(request: MatchRequest, vehicleId: string): number | undefined {
  const row = request.candidates.find((candidate) => candidate.vehicleId === vehicleId);
  return row?.stopSequence === undefined ? undefined : row.stopSequence - request.boardingStopSequence;
}

/* ------------------------------------------------ trajectory generation */

export interface GeneratedTrajectory {
  stops: StopOnRoute[];
  boarding: number;
  vehicles: string[];
  snapshots: Array<{ capturedAt: string; vehicles: VehicleObservation[]; error?: string }>;
}

/**
 * A synthetic stretch of route over time: buses enter at random times, move
 * forward at random speeds with random dwells, sometimes drop out of a poll,
 * sometimes freeze; polls every 10 s, some polls fail outright.
 */
export function generateTrajectory(seed: number): GeneratedTrajectory {
  const random = rng(seed);
  const count = int(random, 12, 30);
  const boarding = int(random, 6, count - 4);
  const stops = syntheticStops(count);
  const start = Date.parse(NOW);
  const buses = Array.from({ length: int(random, 1, 4) }, (_, index) => ({
    vehicleId: `SYNTHETIC-T${seed}-${index}`,
    enterAt: int(random, 0, 900),
    secondsPerStop: int(random, 35, 90),
    freezeFrom: chance(random, 0.2) ? int(random, 0, 1500) : undefined,
    freezeFor: int(random, 30, 200),
    dropout: random() * 0.15,
  }));
  const snapshots: GeneratedTrajectory["snapshots"] = [];
  for (let t = 0; t <= 1_800; t += 10) {
    const capturedAt = new Date(start + t * 1_000).toISOString();
    if (chance(random, 0.03)) {
      snapshots.push({ capturedAt, vehicles: [], error: "synthetic provider failure" });
      continue;
    }
    const vehicles: VehicleObservation[] = [];
    for (const bus of buses) {
      if (t < bus.enterAt || chance(random, bus.dropout)) continue;
      let moving = t - bus.enterAt;
      if (bus.freezeFrom !== undefined && t > bus.freezeFrom) moving -= Math.min(t - bus.freezeFrom, bus.freezeFor);
      const travelled = moving / bus.secondsPerStop;
      const sequence = 1 + Math.floor(travelled);
      if (sequence < 1 || sequence > count) continue;
      const fraction = travelled - Math.floor(travelled);
      vehicles.push({
        vehicleId: bus.vehicleId,
        routeId: ROUTE,
        observedAt: EPOCH,
        receivedAt: capturedAt,
        timestampSource: "unavailable",
        stopId: stops[sequence - 1]!.stopId,
        stopSequence: sequence,
        latitude: 33.3 + (sequence - 1 + fraction) * 0.003,
        longitude: 126.4,
        receiveType: "TAGO_SNAPSHOT",
      });
    }
    snapshots.push({ capturedAt, vehicles });
  }
  return { stops, boarding, vehicles: buses.map((bus) => bus.vehicleId), snapshots };
}
