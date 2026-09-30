/**
 * SYNTHETIC passive streams for tests. Invented vehicle numbers, an invented
 * route, a coordinate grid that is not a place. Every stream built here has
 * `providerPath: "synthetic"` and therefore `sourceClass:
 * "SYNTHETIC_OR_PERTURBED"`; nothing from this file can reach a live count.
 *
 * Not a test file: the runner only picks up `*.test.ts`.
 */

import type { StopOnRoute, VehicleObservation } from "../src/domain.ts";
import {
  PASSIVE_SHADOW_POLICY_VERSION,
  PASSIVE_SHADOW_SCHEMA_VERSION,
  type PassiveObservationStream,
  type PassiveSourceClass,
  type PassiveProviderPath,
} from "../src/passiveShadow.ts";

export const SYN_ROUTE = "SYN-ROUTE-PASSIVE";
export const SYN_CITY = "999";
export const T0 = Date.parse("2026-09-25T01:00:00.000Z");
const EPOCH = new Date(0).toISOString();

export interface SyntheticBus {
  id: string;
  /** Stop sequence at `startAtMs`. */
  startSequence: number;
  /** Advances one stop every this many ms. */
  msPerStop: number;
  /** Offset from the stream start at which the bus is at `startSequence` (may be negative). */
  offsetMs?: number;
  /** Absent from the feed during [from, until) offsets. */
  hidden?: Array<[number, number]>;
  /** Rows carry the bus's coordinates but no stop sequence or stop id: its progress along the route cannot be read. */
  withoutStopSequence?: boolean;
}

export function syntheticStops(count = 20): StopOnRoute[] {
  return Array.from({ length: count }, (_, index) => ({
    stopId: `SYN-STOP-${index + 1}`,
    name: `Synthetic stop ${index + 1}`,
    sequence: index + 1,
    latitude: 10 + index * 0.01,
    longitude: 20,
  }));
}

export function syntheticStream(options: {
  buses: SyntheticBus[];
  stopCount?: number;
  pollMs?: number;
  durationMs?: number;
  failedPolls?: (index: number, offsetMs: number) => boolean;
  streamId?: string;
  providerPath?: PassiveProviderPath;
  sourceClass?: PassiveSourceClass;
}): PassiveObservationStream {
  const stops = syntheticStops(options.stopCount ?? 20);
  const pollMs = options.pollMs ?? 5_000;
  const durationMs = options.durationMs ?? 900_000;
  const providerPath = options.providerPath ?? "synthetic";
  const snapshots: PassiveObservationStream["snapshots"] = [];
  for (let index = 0, offset = 0; offset <= durationMs; index += 1, offset += pollMs) {
    const at = new Date(T0 + offset).toISOString();
    if (options.failedPolls?.(index, offset)) {
      snapshots.push({ capturedAt: at, vehicles: [], error: "SYNTHETIC provider failure" });
      continue;
    }
    const vehicles: VehicleObservation[] = [];
    for (const bus of options.buses) {
      if (bus.hidden?.some(([from, until]) => offset >= from && offset < until)) continue;
      const elapsed = offset - (bus.offsetMs ?? 0);
      const sequence = bus.startSequence + Math.floor(elapsed / bus.msPerStop);
      if (sequence < 1 || sequence > stops.length) continue;
      const stop = stops[sequence - 1]!;
      vehicles.push({
        vehicleId: bus.id,
        routeId: SYN_ROUTE,
        observedAt: EPOCH,
        receivedAt: at,
        timestampSource: "unavailable",
        ...(bus.withoutStopSequence ? {} : { stopId: stop.stopId, stopSequence: sequence }),
        latitude: stop.latitude,
        longitude: stop.longitude,
        receiveType: "TAGO_SNAPSHOT",
      });
    }
    snapshots.push({ capturedAt: at, vehicles });
  }
  return {
    schemaVersion: PASSIVE_SHADOW_SCHEMA_VERSION,
    policyVersion: PASSIVE_SHADOW_POLICY_VERSION,
    sourceClass: options.sourceClass ?? (providerPath === "synthetic" ? "SYNTHETIC_OR_PERTURBED" : "LIVE_PASSIVE"),
    streamId: options.streamId ?? "syn-collection-SYN-ROUTE-PASSIVE",
    collectionId: "syn-collection",
    providerPath,
    collectorEngine: "synthetic-test",
    routeId: SYN_ROUTE,
    cityCode: SYN_CITY,
    stops,
    intervalMs: pollMs,
    startedAt: new Date(T0).toISOString(),
    endedAt: new Date(T0 + durationMs).toISOString(),
    snapshots,
    duplicateReceiptsDropped: 0,
  };
}
