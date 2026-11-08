/**
 * Live feed quality: checks a TAGO vehicle snapshot against the route's own
 * published stop list before any of it counts as evidence.
 *
 * The provider is the only source of a vehicle's position and its stop
 * sequence, and the provider can be wrong: a row can name a sequence the route
 * does not have, a stop that is not the one at that sequence, a position far
 * from the stop it names, or a vehicle listed on two variants at once. Each
 * check below is deterministic, names itself, and marks the row `suspect`
 * rather than repairing it. A suspect row is still reported (the data says
 * what it says) but it never counts as a reported vehicle.
 *
 * Checks over time (`assessFeedHistory`) use receipt order only: TAGO gives no
 * observation time, so "unchanged for n receipts" says the provider kept
 * answering the same thing, not that the bus stood still for that long.
 */

import type { StopOnRoute, VehicleObservation } from "./domain.ts";
import { distanceMeters } from "./geo.ts";
import { inJejuBox } from "./placeSearch.ts";

/**
 * `ASSUMED`: a reported position this far from the stop the row names is not
 * explained by the bus being between that stop and the next. Jeju's longest
 * stop spacing on rural express sections is a few kilometres
 * (`ASSUMED`; no official geometry exists, `KNOWN_ISSUES.md`), so the bound is
 * generous and only catches gross contradictions.
 */
export const FAR_FROM_REPORTED_STOP_METERS = 5_000;

/** `ASSUMED`: this many consecutive identical receipts is reported as `content_unchanged`. */
export const UNCHANGED_RECEIPTS_FLAG = 6;

export type FeedIssue =
  | "missing_position"
  | "outside_service_area"
  | "missing_stop_sequence"
  | "sequence_out_of_range"
  | "stop_id_mismatch"
  | "far_from_reported_stop"
  | "duplicate_vehicle_across_variants";

export interface VehicleQuality {
  vehicleId: string;
  routeId: string;
  issues: FeedIssue[];
  /** Any issue makes a row suspect; a suspect row is never counted as a reported vehicle. */
  suspect: boolean;
  distanceToReportedStopMeters?: number;
}

export interface SnapshotQuality {
  checked: number;
  suspect: number;
  clean: number;
  byIssue: Partial<Record<FeedIssue, number>>;
  vehicles: VehicleQuality[];
}

/**
 * One snapshot of one or more variants. `stopsByRoute` is the route's own
 * stop list (catalog or provider); a variant without one is checked only for
 * position and duplication.
 */
export function assessSnapshot(observations: VehicleObservation[], stopsByRoute: Map<string, StopOnRoute[]>): SnapshotQuality {
  const routesByVehicle = new Map<string, Set<string>>();
  for (const observation of observations) {
    routesByVehicle.set(observation.vehicleId, (routesByVehicle.get(observation.vehicleId) ?? new Set()).add(observation.routeId));
  }
  const vehicles = observations.map((observation): VehicleQuality => {
    const issues: FeedIssue[] = [];
    let distance: number | undefined;
    const hasPosition = Number.isFinite(observation.latitude) && Number.isFinite(observation.longitude);
    if (!hasPosition) issues.push("missing_position");
    else if (!inJejuBox(observation.latitude!, observation.longitude!)) issues.push("outside_service_area");

    const stops = stopsByRoute.get(observation.routeId);
    if (stops && stops.length > 0) {
      if (observation.stopSequence === undefined || !Number.isInteger(observation.stopSequence)) {
        issues.push("missing_stop_sequence");
      } else {
        const stop = stops.find((candidate) => candidate.sequence === observation.stopSequence);
        if (!stop) issues.push("sequence_out_of_range");
        else {
          if (observation.stopId !== undefined && observation.stopId !== stop.stopId) issues.push("stop_id_mismatch");
          if (hasPosition && stop.latitude !== undefined && stop.longitude !== undefined) {
            distance = Math.round(distanceMeters(
              { latitude: observation.latitude!, longitude: observation.longitude! },
              { latitude: stop.latitude, longitude: stop.longitude },
            ));
            if (distance > FAR_FROM_REPORTED_STOP_METERS) issues.push("far_from_reported_stop");
          }
        }
      }
    }
    if ((routesByVehicle.get(observation.vehicleId)?.size ?? 0) > 1) issues.push("duplicate_vehicle_across_variants");
    return {
      vehicleId: observation.vehicleId,
      routeId: observation.routeId,
      issues,
      suspect: issues.length > 0,
      ...(distance !== undefined ? { distanceToReportedStopMeters: distance } : {}),
    };
  });
  const byIssue: Partial<Record<FeedIssue, number>> = {};
  for (const vehicle of vehicles) for (const issue of vehicle.issues) byIssue[issue] = (byIssue[issue] ?? 0) + 1;
  const suspect = vehicles.filter((vehicle) => vehicle.suspect).length;
  return { checked: vehicles.length, suspect, clean: vehicles.length - suspect, byIssue, vehicles };
}

export type HistoryIssue = "sequence_regressed" | "content_unchanged";

export interface HistoryQuality {
  vehicleId: string;
  routeId: string;
  receipts: number;
  issues: HistoryIssue[];
  /** Longest run of identical consecutive receipts (position and stop). */
  longestUnchangedRun: number;
  regressions: number;
}

/**
 * One vehicle's receipts on one variant, in receipt order. A regression on a
 * loop route at the seam (last sequence back to the first) is a new lap, not a
 * regression; `loopLength` says where the seam is.
 */
export function assessFeedHistory(receipts: VehicleObservation[], loopLength?: number): HistoryQuality {
  const first = receipts[0];
  let longest = receipts.length > 0 ? 1 : 0;
  let run = longest;
  let regressions = 0;
  for (let index = 1; index < receipts.length; index += 1) {
    const previous = receipts[index - 1]!;
    const current = receipts[index]!;
    const same = previous.stopSequence === current.stopSequence && previous.latitude === current.latitude && previous.longitude === current.longitude;
    run = same ? run + 1 : 1;
    longest = Math.max(longest, run);
    if (previous.stopSequence !== undefined && current.stopSequence !== undefined && current.stopSequence < previous.stopSequence) {
      const seam = loopLength !== undefined && previous.stopSequence >= loopLength - 1 && current.stopSequence <= 2;
      if (!seam) regressions += 1;
    }
  }
  const issues: HistoryIssue[] = [];
  if (regressions > 0) issues.push("sequence_regressed");
  if (longest >= UNCHANGED_RECEIPTS_FLAG) issues.push("content_unchanged");
  return { vehicleId: first?.vehicleId ?? "", routeId: first?.routeId ?? "", receipts: receipts.length, issues, longestUnchangedRun: longest, regressions };
}
