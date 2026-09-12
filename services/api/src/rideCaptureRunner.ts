import type { StopOnRoute, VehicleObservation } from "./domain.ts";
import type { TransitProvider } from "./provider.ts";
import {
  RIDE_CAPTURE_SCHEMA_VERSION,
  RideCaptureInputError,
  validateRideCapture,
  type RideCapture,
  type RideMarker,
  type RideSnapshot,
} from "./rideCapture.ts";

export interface RideCaptureCommand {
  /** `b <vehicle>`, `p <stopSequence>`, `a [stopSequence]`, `n <note>`, `v`, `s`, `?`, `q`. */
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

export const RIDE_CAPTURE_COMMANDS =
  "b <vehicle|last4> board · p <seq> passed a stop · a [seq] alighted · n <note> · v vehicles · s status · ? help · q finish";

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
    // Printed once, before the first poll: on a moving bus the rider needs the
    // stop numbers and the endpoint names in front of them, not at exit.
    log(describeRideStart(capture, { maxSnapshots, maxDurationMs }));

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
            ? `tracked seq ${tracked.stopSequence ?? "?"} → ${tracked.stopSequence === undefined ? "?" : Math.max(0, capture.destinationStopSequence - tracked.stopSequence)} stops left`
            : "TRACKED VEHICLE NOT IN THIS SNAPSHOT"
          : "no boarded vehicle yet";
        log(`${elapsed(capture, capturedAt)} snapshot ${capture.snapshots.length} · ${vehicles.length} vehicles · ${trackedText}`);
        if (tracked?.stopSequence !== undefined && tracked.stopSequence >= capture.destinationStopSequence) {
          arrivalSnapshotsRemaining ??= snapshotsAfterArrival;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "provider failure";
        capture.snapshots.push({ capturedAt, vehicles: [], error: message });
        log(`${elapsed(capture, capturedAt)} snapshot ${capture.snapshots.length} · error ${message}`);
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
    case "b":
      return board(capture, argument, marker, log);
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
    case "v":
      log(describeCurrentVehicles(capture));
      return false;
    case "s":
      log(describeStatus(capture, now()));
      return false;
    case "?":
      log(RIDE_CAPTURE_COMMANDS);
      return false;
    case "q":
      return false;
    default:
      throw new RideCaptureInputError(`Unknown command: ${verb}. ${RIDE_CAPTURE_COMMANDS}`);
  }
}

export type VehicleSelection =
  | { status: "exact"; vehicleId: string; observation: VehicleObservation }
  | { status: "suffix"; vehicleId: string; observation: VehicleObservation }
  | { status: "ambiguous"; matches: string[] }
  | { status: "absent" };

/**
 * Cross-checks what the rider typed against the vehicles the route is currently
 * reporting. A partial number resolves only when exactly one vehicle matches, so
 * the tool can never quietly attach the capture to the wrong bus.
 */
export function resolveVehicleSelection(vehicles: VehicleObservation[], typed: string): VehicleSelection {
  const needle = normalizeVehicleId(typed);
  if (!needle) return { status: "absent" };
  const exact = vehicles.find((vehicle) => normalizeVehicleId(vehicle.vehicleId) === needle);
  if (exact) return { status: "exact", vehicleId: exact.vehicleId, observation: exact };
  if (needle.length < 2) return { status: "absent" };
  const suffixed = vehicles.filter((vehicle) => normalizeVehicleId(vehicle.vehicleId).endsWith(needle));
  if (suffixed.length === 1) return { status: "suffix", vehicleId: suffixed[0]!.vehicleId, observation: suffixed[0]! };
  if (suffixed.length > 1) return { status: "ambiguous", matches: suffixed.map((vehicle) => vehicle.vehicleId) };
  return { status: "absent" };
}

/**
 * Terminal-safe form of a vehicle number: enough to compare against the plate on
 * the bus, not enough to identify the vehicle from a screenshot of the session.
 */
export function maskVehicleId(vehicleId: string): string {
  const normalized = normalizeVehicleId(vehicleId);
  return normalized.length <= 4 ? normalized : `…${normalized.slice(-4)}`;
}

export function describeStops(stops: StopOnRoute[]): string {
  return stops.map((stop) => `${stop.sequence}\t${stop.name}`).join("\n");
}

/** The briefing the rider reads before the bus arrives. */
export function describeRideStart(
  capture: RideCapture,
  limits: { maxSnapshots: number; maxDurationMs: number },
): string {
  const first = capture.stops[0];
  const last = capture.stops.at(-1);
  const lines = [
    `route ${capture.routeId} · city ${capture.cityCode} · ${capture.stops.length} stops · interval ${Math.round(capture.intervalMs / 1_000)} s`,
    `direction: ${first?.name ?? "?"} → ${last?.name ?? "?"}`,
    `boarding    ${padSequence(capture.boardingStopSequence)}  ${stopName(capture, capture.boardingStopSequence)}`,
    `destination ${padSequence(capture.destinationStopSequence)}  ${stopName(capture, capture.destinationStopSequence)}`,
    `limits: ${limits.maxSnapshots} snapshots, ${Math.round(limits.maxDurationMs / 60_000)} minutes`,
    RIDE_CAPTURE_COMMANDS,
    "stops on this ride (use the number with p):",
    describeStopWindow(capture),
  ];
  return lines.join("\n");
}

/** Boarding through destination, the only sequences the rider needs mid-ride. */
export function describeStopWindow(capture: RideCapture): string {
  return capture.stops
    .filter((stop) => stop.sequence >= capture.boardingStopSequence && stop.sequence <= capture.destinationStopSequence)
    .map((stop) => {
      const mark = stop.sequence === capture.boardingStopSequence
        ? "  ← board here"
        : stop.sequence === capture.destinationStopSequence
          ? "  ← get off here"
          : "";
      return `  ${padSequence(stop.sequence)}  ${stop.name}${mark}`;
    })
    .join("\n");
}

export function describeCurrentVehicles(capture: RideCapture): string {
  const snapshot = latestSuccessfulSnapshot(capture);
  if (!snapshot || snapshot.vehicles.length === 0) return "no vehicles reported on this route in the last snapshot";
  const rows = [...snapshot.vehicles]
    .sort((a, b) => (a.stopSequence ?? 0) - (b.stopSequence ?? 0))
    .map((vehicle) => {
      const tracked = vehicle.vehicleId === capture.boardedVehicleId ? "  ← tracked" : "";
      return `  ${maskVehicleId(vehicle.vehicleId)}  seq ${vehicle.stopSequence ?? "?"}  ${vehicle.stopName ?? ""}${tracked}`;
    });
  return [`vehicles on this route (${snapshot.capturedAt}):`, ...rows].join("\n");
}

export function describeStatus(capture: RideCapture, at: Date): string {
  const failed = capture.snapshots.filter((snapshot) => snapshot.error).length;
  const lastMarker = capture.markers.at(-1);
  const snapshot = latestSuccessfulSnapshot(capture);
  const tracked = capture.boardedVehicleId
    ? snapshot?.vehicles.find((vehicle) => vehicle.vehicleId === capture.boardedVehicleId)
    : undefined;
  const trackedText = !capture.boardedVehicleId
    ? "no boarded vehicle yet"
    : tracked
      ? `tracked ${maskVehicleId(capture.boardedVehicleId)} seq ${tracked.stopSequence ?? "?"}/${capture.destinationStopSequence}`
      : `tracked ${maskVehicleId(capture.boardedVehicleId)} NOT in the last snapshot`;
  return [
    `${elapsed(capture, at.toISOString())} snapshots ${capture.snapshots.length} (${failed} failed)`,
    `markers ${capture.markers.length}`,
    trackedText,
    lastMarker ? `last marker ${lastMarker.kind}${lastMarker.stopSequence !== undefined ? ` @${lastMarker.stopSequence}` : ""} at ${lastMarker.at}` : "no markers yet",
  ].join(" · ");
}

function board(
  capture: RideCapture,
  argument: string,
  marker: (partial: Omit<RideMarker, "at">) => boolean,
  log: (line: string) => void,
): boolean {
  if (!argument) throw new RideCaptureInputError("Usage: b <vehicle number, or its last 4 characters>");
  const snapshot = latestSuccessfulSnapshot(capture);
  const selection = resolveVehicleSelection(snapshot?.vehicles ?? [], argument);
  if (selection.status === "ambiguous") {
    // Refuse rather than guess: attaching the capture to the wrong bus is the
    // one mistake that cannot be repaired after the ride.
    throw new RideCaptureInputError(
      `"${argument}" matches ${selection.matches.length} vehicles (${selection.matches.map(maskVehicleId).join(", ")}); type more characters`,
    );
  }
  if (capture.boardedVehicleId) log("replacing the previously recorded vehicle");
  if (selection.status === "absent") {
    capture.boardedVehicleId = argument;
    log(`WARNING: no vehicle on this route currently reports that number. Recorded as typed and tracked verbatim — check the plate and run b again if it was wrong.`);
  } else {
    capture.boardedVehicleId = selection.vehicleId;
    log(`boarded ${maskVehicleId(selection.vehicleId)} · seq ${selection.observation.stopSequence ?? "?"} ${selection.observation.stopName ?? ""} · confirm this is the bus you are on`);
  }
  return marker({ kind: "boarded", stopSequence: capture.boardingStopSequence });
}

function latestSuccessfulSnapshot(capture: RideCapture): RideSnapshot | undefined {
  for (let index = capture.snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = capture.snapshots[index]!;
    if (!snapshot.error) return snapshot;
  }
  return undefined;
}

function normalizeVehicleId(value: string): string {
  return value.replace(/[\s-]/g, "");
}

function stopName(capture: RideCapture, sequence: number): string {
  return capture.stops.find((stop) => stop.sequence === sequence)?.name ?? "(unknown stop)";
}

function padSequence(sequence: number): string {
  return String(sequence).padStart(3, " ");
}

function elapsed(capture: RideCapture, at: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(at) - Date.parse(capture.startedAt)) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `[${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}]`;
}
