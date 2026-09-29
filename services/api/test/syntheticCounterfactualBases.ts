/**
 * SYNTHETIC counterfactual bases: invented routes, invented vehicles, coordinate
 * grids that are not places. Shared by `passiveCounterfactual.test.ts` and
 * `scripts/matcher-evidence/counterfactual-synthetic.ts`, so the committed
 * SIMULATED summary is built from exactly the worlds the tests assert on.
 *
 * Their buses move continuously: coordinates change every poll like a GPS fix,
 * and the stop sequence changes once per stop.
 */

import type { StopOnRoute, VehicleObservation } from "../src/domain.ts";
import {
  PASSIVE_SHADOW_POLICY_VERSION,
  PASSIVE_SHADOW_SCHEMA_VERSION,
  type PassiveObservationStream,
  type PassiveProviderPath,
  type PassiveSourceClass,
} from "../src/passiveShadow.ts";
import { mulberry32 } from "../src/passiveShadowPerturb.ts";

export const T0 = Date.parse("2026-09-29T01:00:00.000Z");
export const EPOCH = new Date(0).toISOString();

export interface SyntheticBus {
  id: string;
  startSequence: number;
  msPerStop: number;
  appearsAtMs?: number;
}

export function syntheticStops(count: number, routeId: string): StopOnRoute[] {
  return Array.from({ length: count }, (_, index) => ({
    stopId: `${routeId}-STOP-${index + 1}`,
    name: `Synthetic ${routeId} stop ${index + 1}`,
    sequence: index + 1,
    latitude: 10 + index * 0.01,
    longitude: 20,
  }));
}

/** Receipts every `pollMs`, or (jittered) seeded 20–40 s apart and off the case-start grid, like the cached public path. */
export function syntheticStream(options: {
  streamId: string;
  routeId: string;
  buses: SyntheticBus[];
  stopCount: number;
  durationMs: number;
  pollMs?: number;
  jitteredPolls?: boolean;
  providerPath?: PassiveProviderPath;
  sourceClass?: PassiveSourceClass;
}): PassiveObservationStream {
  const stops = syntheticStops(options.stopCount, options.routeId);
  const random = mulberry32(20_260_929);
  const snapshots: PassiveObservationStream["snapshots"] = [];
  const step = () => (options.jitteredPolls ? 20_000 + Math.floor(random() * 20_000) : options.pollMs ?? 10_000);
  for (let offset = 0; offset <= options.durationMs; offset += step()) {
    const at = new Date(T0 + offset).toISOString();
    const vehicles: VehicleObservation[] = [];
    for (const bus of options.buses) {
      const appears = bus.appearsAtMs ?? 0;
      if (offset < appears) continue;
      const position = bus.startSequence + (offset - appears) / bus.msPerStop;
      const sequence = Math.floor(position);
      if (sequence > stops.length) continue;
      const here = stops[sequence - 1]!;
      const next = stops[sequence] ?? here;
      vehicles.push({
        vehicleId: bus.id,
        routeId: options.routeId,
        observedAt: EPOCH,
        receivedAt: at,
        timestampSource: "unavailable",
        stopId: here.stopId,
        stopSequence: sequence,
        latitude: Math.round((here.latitude! + (next.latitude! - here.latitude!) * (position - sequence)) * 1e7) / 1e7,
        longitude: 20,
        receiveType: "TAGO_SNAPSHOT",
      });
    }
    snapshots.push({ capturedAt: at, vehicles });
  }
  return {
    schemaVersion: PASSIVE_SHADOW_SCHEMA_VERSION,
    policyVersion: PASSIVE_SHADOW_POLICY_VERSION,
    sourceClass: options.sourceClass ?? "SYNTHETIC_OR_PERTURBED",
    streamId: options.streamId,
    collectionId: "cf-synthetic-collection",
    providerPath: options.providerPath ?? "synthetic",
    collectorEngine: "synthetic-test",
    routeId: options.routeId,
    cityCode: "999",
    stops,
    intervalMs: options.pollMs ?? 30_000,
    startedAt: snapshots[0]!.capturedAt,
    endedAt: snapshots.at(-1)!.capturedAt,
    snapshots,
    duplicateReceiptsDropped: 0,
  };
}

export const TRUE_BUS_A = "SYN-BUS-1001";

/**
 * SYNTHETIC base A: a bus from the route start (the answer of the early
 * cases), a follower two minutes behind it, and a bus finishing its trip near
 * the route end (the one a loop seam turns into an approaching bus).
 */
export function baseA(): PassiveObservationStream {
  return syntheticStream({
    streamId: "cf-synthetic-base-a",
    routeId: "SYN-CF-A",
    stopCount: 30,
    durationMs: 1_500_000,
    pollMs: 10_000,
    buses: [
      { id: TRUE_BUS_A, startSequence: 2, msPerStop: 40_000 },
      { id: "SYN-BUS-1002", startSequence: 1, msPerStop: 40_000, appearsAtMs: 120_000 },
      { id: "SYN-BUS-1003", startSequence: 25, msPerStop: 40_000 },
    ],
  });
}
export const BASE_A_STOPS = [3, 12, 18];
export const inBaseA = (meta: { boardingSequence: number }) => BASE_A_STOPS.includes(meta.boardingSequence);

/** SYNTHETIC base R: the receipt cadence of the cached public path, four buses at mixed paces. */
export function baseR(): PassiveObservationStream {
  return syntheticStream({
    streamId: "cf-synthetic-base-r",
    routeId: "SYN-CF-R",
    stopCount: 36,
    durationMs: 3_600_000,
    jitteredPolls: true,
    buses: [
      { id: "SYN-BUS-2001", startSequence: 1, msPerStop: 55_000 },
      { id: "SYN-BUS-2002", startSequence: 1, msPerStop: 48_000, appearsAtMs: 540_000 },
      { id: "SYN-BUS-2003", startSequence: 12, msPerStop: 62_000 },
      { id: "SYN-BUS-2004", startSequence: 1, msPerStop: 50_000, appearsAtMs: 1_260_000 },
    ],
  });
}
export const BASE_R_STOPS = [6, 14, 22];
export const inBaseR = (meta: { boardingSequence: number }) => BASE_R_STOPS.includes(meta.boardingSequence);

/** SYNTHETIC base S: one slow bus, a stop a minute, so an overtaking phantom needs no implausible speed. */
export function baseSlow(): PassiveObservationStream {
  return syntheticStream({
    streamId: "cf-synthetic-base-slow",
    routeId: "SYN-CF-S",
    stopCount: 30,
    durationMs: 1_500_000,
    pollMs: 10_000,
    buses: [{ id: "SYN-BUS-3001", startSequence: 2, msPerStop: 60_000 }],
  });
}
