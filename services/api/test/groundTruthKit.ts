/**
 * SYNTHETIC ground-truth sessions, for properties that need to know which bus
 * the rider actually boarded. Nothing here is field evidence.
 *
 * Buses move continuously along the route at a steady 20–90 s per stop, never
 * faster than the matcher's own motion model (15 s per stop). The feed shows a
 * bus only while it is visible: some appear late, some vanish for a while, and
 * any poll may drop it. The feed reports the last stop passed, the whole stop
 * sequence and nothing else. A rider waits at stop `S` from the first poll and
 * boards the first bus to reach it. A session runs through the real
 * `JourneySessionCoordinator` in automatic mode, polling every 10 s.
 *
 * The truth (which bus the rider boarded, and when each bus reaches the stop)
 * is computed here and never reaches the coordinator.
 */

import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { JourneySessionCoordinator } from "../src/journeySession.ts";
import { EPOCH, NOW, ROUTE, chance, int, rng, syntheticStops } from "./propertyKit.ts";

export const POLL_SECONDS = 10;
const DURATION_SECONDS = 1_500;

export interface GroundTruthBus {
  id: string;
  /** Position at the first poll, in stops along the route (1 = the first stop). */
  p0: number;
  secondsPerStop: number;
  visibleFrom: number;
  holes: ReadonlyArray<readonly [number, number]>;
  dropout: number;
}

export interface GroundTruthPoll {
  t: number;
  failed: boolean;
  vehicles: VehicleObservation[];
}

export interface GroundTruthSession {
  seed: number;
  loop: boolean;
  /** Stop rows on the route; on a loop the last row is the first stop again. */
  count: number;
  /** Sequence steps in one lap of a loop; the stop count on a straight route. */
  lap: number;
  boarding: number;
  stops: StopOnRoute[];
  buses: GroundTruthBus[];
  polls: GroundTruthPoll[];
  /** Seconds from the first poll until the bus first reaches the boarding stop, if it does. */
  arrival(bus: GroundTruthBus): number | undefined;
  /** Unwrapped position at `t` seconds. */
  position(bus: GroundTruthBus, t: number): number;
  /** The bus the rider boards: the first to reach the stop within the session. */
  truth?: { bus: GroundTruthBus; at: number };
}

export function generateGroundTruthSession(seed: number): GroundTruthSession {
  const random = rng(seed ^ 0x7a17);
  const loop = chance(random, 0.35);
  const count = int(random, 10, 30);
  const stops = syntheticStops(count, { loop });
  const lap = loop ? count - 1 : count;
  const boarding = int(random, 3, lap - 1);
  const buses: GroundTruthBus[] = Array.from({ length: int(random, 1, 5) }, (_, index) => ({
    id: `SYN-G${seed}-${index}`,
    p0: 1 + random() * (lap - 1),
    secondsPerStop: int(random, 20, 90),
    visibleFrom: chance(random, 0.3) ? int(random, 0, 600) : 0,
    holes: Array.from({ length: chance(random, 0.5) ? int(random, 1, 2) : 0 }, () => {
      const from = int(random, 0, DURATION_SECONDS);
      return [from, from + int(random, 20, 400)] as const;
    }),
    dropout: random() * 0.1,
  }));
  const position = (bus: GroundTruthBus, t: number) => bus.p0 + t / bus.secondsPerStop;
  const arrival = (bus: GroundTruthBus): number | undefined => {
    if (loop) return ((((boarding - bus.p0) % lap) + lap) % lap || lap) * bus.secondsPerStop;
    return bus.p0 < boarding ? (boarding - bus.p0) * bus.secondsPerStop : undefined;
  };
  let truth: GroundTruthSession["truth"];
  for (const bus of buses) {
    const at = arrival(bus);
    if (at !== undefined && at <= DURATION_SECONDS && (!truth || at < truth.at)) truth = { bus, at };
  }
  const start = Date.parse(NOW);
  const polls: GroundTruthPoll[] = [];
  for (let t = 0; t <= DURATION_SECONDS; t += POLL_SECONDS) {
    // The first poll always arrives: a session is only created from one.
    const failed = t > 0 && chance(random, 0.02);
    const vehicles: VehicleObservation[] = [];
    for (const bus of buses) {
      const at = position(bus, t);
      if (!loop && at >= count) continue;
      const hidden = t < bus.visibleFrom || bus.holes.some(([from, to]) => t >= from && t < to) || chance(random, bus.dropout);
      if (hidden || failed) continue;
      let sequence = Math.floor(at);
      if (loop) sequence = 1 + ((((sequence - 1) % lap) + lap) % lap);
      vehicles.push({
        vehicleId: bus.id,
        routeId: ROUTE,
        observedAt: EPOCH,
        receivedAt: new Date(start + t * 1_000).toISOString(),
        timestampSource: "unavailable",
        directionCode: "1",
        stopSequence: sequence,
      });
    }
    polls.push({ t, failed, vehicles });
  }
  return { seed, loop, count, lap, boarding, stops, buses, polls, arrival, position, ...(truth ? { truth } : {}) };
}

export interface GroundTruthRun {
  /** The first automatic selection, if any. */
  selected?: { vehicleId: string; at: number };
  /** The first poll whose view no longer names the selected bus. */
  withdrawnAt?: number;
}

/** Drive one generated session through the coordinator, in automatic mode. */
export async function runGroundTruthSession(session: GroundTruthSession): Promise<GroundTruthRun> {
  const start = Date.parse(NOW);
  let index = 0;
  const provider = {
    async stops(_request: RouteRequest): Promise<StopOnRoute[]> { return session.stops.map((stop) => ({ ...stop })); },
    async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> {
      const poll = session.polls[index]!;
      if (poll.failed) throw new Error("synthetic provider failure");
      return poll.vehicles.map((vehicle) => ({ ...vehicle }));
    },
  };
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => new Date(start + session.polls[index]!.t * 1_000),
    idFactory: () => `ground-truth-${session.seed}`,
    automaticMatchingEnabled: true,
    maxConsecutiveProviderFailures: 1_000,
  });
  const run: GroundTruthRun = {};
  let id: string | undefined;
  for (index = 0; index < session.polls.length; index += 1) {
    let view;
    try {
      view = id === undefined
        ? await sessions.create({
          routeId: ROUTE,
          cityCode: "999",
          boardingStopSequence: session.boarding,
          destinationStopSequence: Math.min(session.count, session.boarding + 2),
        })
        : await sessions.refresh(id);
    } catch {
      continue;
    }
    id = view.id;
    const t = session.polls[index]!.t;
    if (!run.selected && view.selectedVehicleId !== undefined && view.selectionMode === "automatic") {
      run.selected = { vehicleId: view.selectedVehicleId, at: t };
    }
    if (run.selected && run.withdrawnAt === undefined && view.selectedVehicleId === undefined) run.withdrawnAt = t;
  }
  return run;
}

/**
 * When the feed first shows that `bus` reached the boarding stop after `after`
 * seconds, in a way a sighting can show it: at the stop (or one past it, where
 * dwell and departure cannot be told apart); past it, having last been seen
 * before it less than a lap of travel earlier; or past it for the first time,
 * near enough that it could have been at the stop since the rider began
 * waiting. Undefined when no poll shows it so.
 */
export function firstShownReaching(session: GroundTruthSession, bus: GroundTruthBus, after: number): number | undefined {
  const arrival = session.arrival(bus);
  if (arrival === undefined) return undefined;
  const sightings = session.polls
    .map((poll) => ({ t: poll.t, row: poll.vehicles.find((vehicle) => vehicle.vehicleId === bus.id) }))
    .filter((sighting): sighting is { t: number; row: VehicleObservation } => sighting.row !== undefined);
  const shown = sightings.find((sighting) => sighting.t > after && sighting.t >= arrival);
  if (!shown) return undefined;
  const past = session.loop
    ? ((((shown.row.stopSequence! - session.boarding) % session.lap) + session.lap) % session.lap)
    : shown.row.stopSequence! - session.boarding;
  if (past <= 1) return shown.t;
  const before = sightings.filter((sighting) => sighting.t < shown.t).at(-1);
  if (before === undefined) return past <= 1 + Math.floor(shown.t / 15) ? shown.t : undefined;
  if (before.t >= arrival) return undefined;
  const travelled = Math.floor(session.position(bus, shown.t)) - Math.floor(session.position(bus, before.t));
  return !session.loop || travelled < session.lap ? shown.t : undefined;
}
