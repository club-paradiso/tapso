/**
 * Passive Shadow Validation v3 — bounded, rider-free route observation.
 *
 * One collector run polls a small set of routes on one shared schedule and
 * writes one `PassiveObservationStream` per route. It creates no journey
 * session, touches no session store, never calls the matcher, and reads the
 * provider only through the `TransitProvider` interface — in a live run that is
 * the one existing `TagoTransitProvider`, or TAPSO's own public API.
 *
 * Bounds are explicit and all of them stop the run:
 *   - a wall-clock duration (≤ 90 min, the collector's own session cap),
 *   - a hard provider-call budget counted across every route and the preflight,
 *   - a failure spike (sustained provider errors are an incident, not a pause).
 *
 * A failed read is stored as a failed snapshot (`error`, no vehicles). It is
 * never stored as an empty route, so a dropout cannot pose as "no bus".
 */

import type { RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";
import type { TransitProvider } from "./provider.ts";
import type { RideSnapshot } from "./rideCapture.ts";
import {
  PASSIVE_SHADOW_POLICY_VERSION,
  PASSIVE_SHADOW_SCHEMA_VERSION,
  sourceClassFor,
  type PassiveObservationStream,
  type PassiveProviderPath,
} from "./passiveShadow.ts";

export const PASSIVE_MIN_INTERVAL_MS = 3_000;
export const PASSIVE_MAX_DURATION_MS = 90 * 60_000;
const FAILURE_WINDOW = 20;
const FAILURE_RATIO_STOP = 0.5;
const CONSECUTIVE_FAILURE_STOP = 10;

export interface PassiveCollectorOptions {
  provider: TransitProvider;
  providerPath: PassiveProviderPath;
  collectorEngine: string;
  collectionId: string;
  routes: RouteRequest[];
  intervalMs: number;
  durationMs: number;
  /** Hard ceiling on provider calls for the whole run, stops reads included. */
  maxProviderCalls: number;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  log?: (line: string) => void;
  /** Called after every tick with the streams so far, for crash-safe checkpoints. */
  checkpoint?: (streams: PassiveObservationStream[]) => Promise<void> | void;
  shouldStop?: () => boolean;
}

export interface PassiveCollectionIncident {
  at: string;
  kind: "PROVIDER_FAILURE_SPIKE" | "CONSECUTIVE_PROVIDER_FAILURES" | "CALL_BUDGET_EXHAUSTED" | "STOPS_UNAVAILABLE";
  detail: string;
}

export interface PassiveCollectionResult {
  collectionId: string;
  streams: PassiveObservationStream[];
  providerCalls: number;
  failedCalls: number;
  incidents: PassiveCollectionIncident[];
  stopReason: string;
}

export async function collectPassiveStreams(options: PassiveCollectorOptions): Promise<PassiveCollectionResult> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const log = options.log ?? (() => {});
  const intervalMs = Math.max(PASSIVE_MIN_INTERVAL_MS, Math.floor(options.intervalMs));
  const durationMs = Math.min(PASSIVE_MAX_DURATION_MS, Math.max(0, Math.floor(options.durationMs)));
  const budget = Math.max(0, Math.floor(options.maxProviderCalls));
  const sourceClass = sourceClassFor(options.providerPath);
  const incidents: PassiveCollectionIncident[] = [];
  const recent: boolean[] = [];
  let calls = 0;
  let failedCalls = 0;
  let consecutiveFailures = 0;

  const record = (ok: boolean) => {
    calls += 1;
    if (!ok) failedCalls += 1;
    consecutiveFailures = ok ? 0 : consecutiveFailures + 1;
    recent.push(ok);
    if (recent.length > FAILURE_WINDOW) recent.shift();
  };

  const streams: PassiveObservationStream[] = [];
  const startedAt = now();
  for (const route of options.routes) {
    if (calls >= budget) break;
    let stops: StopOnRoute[];
    try {
      stops = [...await options.provider.stops(route)].sort((left, right) => left.sequence - right.sequence);
      record(true);
    } catch (error) {
      record(false);
      incidents.push({ at: now().toISOString(), kind: "STOPS_UNAVAILABLE", detail: `${route.routeId}: ${safeError(error)}` });
      continue;
    }
    if (stops.length === 0) {
      incidents.push({ at: now().toISOString(), kind: "STOPS_UNAVAILABLE", detail: `${route.routeId}: no stops` });
      continue;
    }
    streams.push({
      schemaVersion: PASSIVE_SHADOW_SCHEMA_VERSION,
      policyVersion: PASSIVE_SHADOW_POLICY_VERSION,
      sourceClass,
      streamId: `${options.collectionId}-${route.routeId}`,
      collectionId: options.collectionId,
      providerPath: options.providerPath,
      collectorEngine: options.collectorEngine,
      routeId: route.routeId,
      cityCode: route.cityCode,
      stops,
      intervalMs,
      startedAt: startedAt.toISOString(),
      snapshots: [],
      duplicateReceiptsDropped: 0,
    });
  }

  const lastReceipt = new Map<string, string>();
  let stopReason = streams.length === 0 ? "NO_ROUTE_AVAILABLE" : "DURATION_REACHED";
  const deadline = startedAt.getTime() + durationMs;
  outer: while (streams.length > 0 && now().getTime() < deadline) {
    const tickStart = now().getTime();
    for (const stream of streams) {
      if (options.shouldStop?.()) {
        stopReason = "STOP_REQUESTED";
        break outer;
      }
      if (calls >= budget) {
        stopReason = "CALL_BUDGET_EXHAUSTED";
        incidents.push({ at: now().toISOString(), kind: "CALL_BUDGET_EXHAUSTED", detail: `${calls} calls` });
        break outer;
      }
      const requestedAt = now();
      try {
        const vehicles = await options.provider.vehicles({ routeId: stream.routeId, cityCode: stream.cityCode });
        record(true);
        appendSnapshot(stream, vehicles, requestedAt, lastReceipt);
      } catch (error) {
        record(false);
        stream.snapshots.push({ capturedAt: requestedAt.toISOString(), vehicles: [], error: safeError(error) });
      }
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_STOP) {
        stopReason = "CONSECUTIVE_PROVIDER_FAILURES";
        incidents.push({ at: now().toISOString(), kind: "CONSECUTIVE_PROVIDER_FAILURES", detail: `${consecutiveFailures} consecutive failed reads` });
        break outer;
      }
      if (recent.length >= FAILURE_WINDOW && recent.filter((ok) => !ok).length / recent.length >= FAILURE_RATIO_STOP) {
        stopReason = "PROVIDER_FAILURE_SPIKE";
        incidents.push({ at: now().toISOString(), kind: "PROVIDER_FAILURE_SPIKE", detail: `${recent.filter((ok) => !ok).length}/${recent.length} recent reads failed` });
        break outer;
      }
    }
    await options.checkpoint?.(streams);
    log(`tick calls=${calls} failed=${failedCalls}`);
    const wait = intervalMs - (now().getTime() - tickStart);
    if (wait > 0 && now().getTime() + wait < deadline) await sleep(wait);
    else if (now().getTime() + Math.max(wait, 0) >= deadline) break;
  }

  const endedAt = now().toISOString();
  for (const stream of streams) {
    stream.endedAt = endedAt;
    stream.stopReason = stopReason;
  }
  await options.checkpoint?.(streams);
  return { collectionId: options.collectionId, streams, providerCalls: calls, failedCalls, incidents, stopReason };
}

/**
 * A snapshot is timed by TAPSO's receipt, like the Railway collector's. When
 * the read came through a shared cache and carries exactly the receipt already
 * stored, it is the same observation served twice and is dropped: counting it
 * would manufacture cadence the provider never produced.
 */
function appendSnapshot(
  stream: PassiveObservationStream,
  vehicles: VehicleObservation[],
  requestedAt: Date,
  lastReceipt: Map<string, string>,
): void {
  const receipts = vehicles
    .map((vehicle) => vehicle.receivedAt)
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort();
  const receipt = receipts.at(-1);
  if (receipt !== undefined && lastReceipt.get(stream.streamId) === receipt) {
    stream.duplicateReceiptsDropped += 1;
    return;
  }
  if (receipt !== undefined) lastReceipt.set(stream.streamId, receipt);
  const snapshot: RideSnapshot = {
    capturedAt: receipt ?? requestedAt.toISOString(),
    vehicles: vehicles.map((vehicle) => ({ ...vehicle })),
  };
  stream.snapshots.push(snapshot);
}

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "provider failure";
  return message
    .replace(/serviceKey=[^&\s]*/gi, "serviceKey=<redacted>")
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 240);
}

export interface RouteDiscovery {
  routes(cityCode: string, routeNumber: string): Promise<Array<{ routeId: string }>>;
}

export interface RoutePreflight {
  routeId: string;
  vehicles: number | null;
  error?: string;
}

/**
 * Picks the routes worth observing: most concurrently active vehicles first,
 * because a route with one visible bus yields only easy cases. Every discovery
 * and preflight read counts against the same call budget as collection.
 */
export async function preflightRoutes(options: {
  provider: TransitProvider;
  discovery?: RouteDiscovery;
  cityCode: string;
  routeIds: string[];
  routeNumbers: string[];
  maxRoutes: number;
  maxCalls: number;
}): Promise<{ selected: RouteRequest[]; preflight: RoutePreflight[]; calls: number }> {
  let calls = 0;
  const candidates = new Set(options.routeIds);
  for (const routeNumber of options.routeNumbers) {
    if (!options.discovery || calls >= options.maxCalls) break;
    calls += 1;
    try {
      for (const route of await options.discovery.routes(options.cityCode, routeNumber)) candidates.add(route.routeId);
    } catch {
      // An unknown route number is an empty or failed lookup; it adds nothing.
    }
  }
  const preflight: RoutePreflight[] = [];
  for (const routeId of candidates) {
    if (calls >= options.maxCalls) break;
    calls += 1;
    try {
      const vehicles = await options.provider.vehicles({ routeId, cityCode: options.cityCode });
      preflight.push({ routeId, vehicles: vehicles.length });
    } catch (error) {
      preflight.push({ routeId, vehicles: null, error: safeError(error) });
    }
  }
  const selected = preflight
    .filter((row) => (row.vehicles ?? 0) >= 1)
    .sort((left, right) => (right.vehicles ?? 0) - (left.vehicles ?? 0) || left.routeId.localeCompare(right.routeId))
    .slice(0, options.maxRoutes)
    .map((row) => ({ routeId: row.routeId, cityCode: options.cityCode }));
  return { selected, preflight, calls };
}
