import type { StopOnRoute } from "./domain.ts";
import type { TransitProvider } from "./provider.ts";
import {
  RIDE_CAPTURE_SCHEMA_VERSION,
  RideCaptureInputError,
  validateRideCapture,
  type RideCapture,
  type RideMarker,
} from "./rideCapture.ts";

export interface RideCaptureCommand {
  /** `b <vehicleno>`, `p <stopSequence>`, `a [stopSequence]`, `n <note>`, `q`. */
  line: string;
}

export interface RideCaptureRunnerOptions {
  provider: TransitProvider;
  routeId: string;
  cityCode: string;
  boardingStopSequence: number;
  destinationStopSequence: number;
  intervalMs?: number;
  maxSnapshots?: number;
  maxDurationMs?: number;
  /** Extra successful snapshots to keep after arrival is detected, then stop. */
  snapshotsAfterArrival?: number;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Called after every snapshot and marker with the full capture; persist it under `work/`. */
  persist: (capture: RideCapture) => Promise<void> | void;
  log?: (line: string) => void;
}

export interface RideCaptureController {
  command(line: string): void;
  readonly done: Promise<RideCapture>;
}

const DEFAULT_INTERVAL_MS = 5_000;
const MIN_INTERVAL_MS = 3_000;
const DEFAULT_MAX_SNAPSHOTS = 720;
const DEFAULT_MAX_DURATION_MS = 90 * 60 * 1_000;
const DEFAULT_SNAPSHOTS_AFTER_ARRIVAL = 6;

/**
 * Polls the provider for one route during a real ride and records bounded snapshots.
 * Provider failures are recorded and polling continues; the loop never prints URLs,
 * credentials, or raw responses.
 */
export function startRideCapture(options: RideCaptureRunnerOptions): RideCaptureController {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const log = options.log ?? (() => {});
  const intervalMs = Math.max(MIN_INTERVAL_MS, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const maxSnapshots = options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const snapshotsAfterArrival = options.snapshotsAfterArrival ?? DEFAULT_SNAPSHOTS_AFTER_ARRIVAL;

  let stopRequested = false;
  let capture: RideCapture | undefined;
  const pendingCommands: string[] = [];

  const done = (async () => {
    const stops = await options.provider.stops({ routeId: options.routeId, cityCode: options.cityCode });
    capture = {
      schemaVersion: RIDE_CAPTURE_SCHEMA_VERSION,
      startedAt: now().toISOString(),
      routeId: options.routeId,
      cityCode: options.cityCode,
      boardingStopSequence: options.boardingStopSequence,
      destinationStopSequence: options.destinationStopSequence,
      intervalMs,
      stops,
      snapshots: [],
      markers: [],
    };
    validateRideCapture(capture);
    for (const line of pendingCommands.splice(0)) applyCommand(capture, line, now, log);
    await options.persist(capture);
    log(`capture started: ${stops.length} stops, boarding ${options.boardingStopSequence} → destination ${options.destinationStopSequence}, interval ${intervalMs} ms`);

    const startedAt = Date.parse(capture.startedAt);
    let arrivalSnapshotsRemaining: number | undefined;

    while (!stopRequested) {
      const capturedAt = now().toISOString();
      try {
        const vehicles = await options.provider.vehicles({ routeId: options.routeId, cityCode: options.cityCode });
        capture.snapshots.push({ capturedAt, vehicles });
        const tracked = capture.boardedVehicleId
          ? vehicles.find((vehicle) => vehicle.vehicleId === capture!.boardedVehicleId)
          : undefined;
        const trackedText = capture.boardedVehicleId
          ? tracked
            ? `tracked at seq ${tracked.stopSequence ?? "?"}, remaining ${tracked.stopSequence === undefined ? "?" : Math.max(0, capture.destinationStopSequence - tracked.stopSequence)}`
            : "tracked vehicle missing"
          : "no boarded vehicle yet";
        log(`snapshot ${capture.snapshots.length}: ${vehicles.length} vehicles; ${trackedText}`);
        if (tracked?.stopSequence !== undefined && tracked.stopSequence >= capture.destinationStopSequence) {
          arrivalSnapshotsRemaining ??= snapshotsAfterArrival;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "provider failure";
        capture.snapshots.push({ capturedAt, vehicles: [], error: message });
        log(`snapshot ${capture.snapshots.length}: error ${message}`);
      }
      await options.persist(capture);

      if (arrivalSnapshotsRemaining !== undefined) {
        if (arrivalSnapshotsRemaining <= 0) {
          log("arrival detected; stopping after post-arrival snapshots");
          break;
        }
        arrivalSnapshotsRemaining -= 1;
      }
      if (capture.snapshots.length >= maxSnapshots) {
        log(`snapshot limit ${maxSnapshots} reached`);
        break;
      }
      if (now().getTime() - startedAt >= maxDurationMs) {
        log("duration limit reached");
        break;
      }
      await sleep(intervalMs);
    }

    capture.endedAt = now().toISOString();
    await options.persist(capture);
    return capture;
  })();

  return {
    command(line: string) {
      if (line.trim() === "q") {
        stopRequested = true;
        return;
      }
      if (!capture) {
        pendingCommands.push(line);
        return;
      }
      if (applyCommand(capture, line, now, log)) void options.persist(capture);
    },
    done,
  };
}

/** Applies one rider command; returns true when a marker or vehicle was recorded. */
export function applyCommand(capture: RideCapture, line: string, now: () => Date, log: (line: string) => void): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const [verb, ...rest] = trimmed.split(/\s+/);
  const argument = rest.join(" ");
  const at = now().toISOString();
  const marker = (partial: Omit<RideMarker, "at">): boolean => {
    capture.markers.push({ at, ...partial });
    log(`marker ${partial.kind}${partial.stopSequence !== undefined ? ` @${partial.stopSequence}` : ""}`);
    return true;
  };
  switch (verb) {
    case "b": {
      if (!argument) throw new RideCaptureInputError("Usage: b <vehicle number>");
      capture.boardedVehicleId = argument;
      log("boarded vehicle recorded locally");
      return marker({ kind: "boarded", stopSequence: capture.boardingStopSequence });
    }
    case "p": {
      const sequence = Number(argument);
      if (!Number.isInteger(sequence) || !capture.stops.some((stop) => stop.sequence === sequence)) {
        throw new RideCaptureInputError("Usage: p <official stop sequence>");
      }
      return marker({ kind: "passed_stop", stopSequence: sequence });
    }
    case "a": {
      const sequence = argument ? Number(argument) : capture.destinationStopSequence;
      if (!Number.isInteger(sequence)) throw new RideCaptureInputError("Usage: a [stop sequence]");
      return marker({ kind: "alighted", stopSequence: sequence });
    }
    case "n":
      if (!argument) throw new RideCaptureInputError("Usage: n <note>");
      return marker({ kind: "note", note: argument });
    case "q":
      return false;
    default:
      throw new RideCaptureInputError(`Unknown command: ${verb}`);
  }
}

export function describeStops(stops: StopOnRoute[]): string {
  return stops.map((stop) => `${stop.sequence}\t${stop.name}`).join("\n");
}
