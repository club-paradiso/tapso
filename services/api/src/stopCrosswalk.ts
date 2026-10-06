/**
 * TAGO stop id ↔ 제주버스정보시스템 station id classification
 * (`docs/validation/JEJU_BIS_TAGO_STOP_CROSSWALK.md`).
 *
 * Pure: the catalog and whatever evidence was collected go in, a status per
 * stop comes out. Nothing here fetches anything, and nothing here assumes the
 * `JEB`-stripped candidate is right — that is exactly the hypothesis the
 * evidence has to confirm, pole by pole.
 *
 * The evidence is what the official passenger-facing station page says about
 * the candidate id. How that page is read is deliberately not in this module:
 * until the page's markup has been inspected by a person, no extractor exists,
 * and every stop stays `UNCHECKED`.
 */

/** The five audit outcomes, plus `UNCHECKED` for a stop no evidence was collected for. */
export type CrosswalkStatus =
  | "VERIFIED_EXACT"
  | "VERIFIED_BY_NAME_COORDINATE"
  | "AMBIGUOUS"
  | "MISSING"
  | "CONFLICT"
  | "UNCHECKED";

export type CrosswalkReason =
  | "exact_name_and_coordinates"
  | "same_place_coordinates_unique_pole"
  | "invalid_tago_id_form"
  | "no_official_station_page"
  | "evidence_not_collected"
  | "evidence_read_failed"
  | "name_mismatch"
  | "opposite_direction_marker"
  | "coordinate_mismatch"
  | "coordinate_near_miss"
  | "no_coordinates_to_compare"
  | "sibling_pole_nearby";

export interface CatalogStop {
  id: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
}

/** What the official page says about one candidate station id. */
export type StationEvidence =
  | { kind: "found"; name: string; latitude?: number; longitude?: number }
  | { kind: "not_found" }
  | { kind: "read_failed" };

export interface CrosswalkRow {
  tagoStopId: string;
  /** The `JEB`-stripped hypothesis, or `null` when the id does not have that form. */
  candidateBisStationId: string | null;
  name: string;
  placeName: string;
  directionMarker: string | null;
  hasCoordinates: boolean;
  routeCount: number;
  /** Other catalog poles with the same place name within `SIBLING_POLE_RADIUS_M`. */
  siblingPolesNearby: number;
  /** Other catalog stops with the identical full name (marker included), anywhere. */
  duplicateFullName: number;
  status: CrosswalkStatus;
  reason: CrosswalkReason;
  /** Metres between the catalog pole and the page's coordinates, rounded; never the coordinates themselves. */
  coordinateDeltaM?: number;
}

/** Same pole: within this the page's coordinates and the catalog's agree. Matches `JejuStopCrosswalk.coordinateTolerance`. */
export const EXACT_COORDINATE_TOLERANCE_M = 30;
/** Beyond this the page describes a different place. */
export const CONFLICT_COORDINATE_DISTANCE_M = 100;
/** Poles of one place closer than this can be confused by name and rough position alone. */
export const SIBLING_POLE_RADIUS_M = 150;

const TAGO_JEJU_STOP = /^JEB(40[56]\d{6})$/;
const MARKER = /\s*\[(동|서|남|북)\]$/;

export function candidateBisStationId(tagoStopId: string): string | null {
  return TAGO_JEJU_STOP.exec(tagoStopId)?.[1] ?? null;
}

/** Same rule as `DestinationSearchIndex.placeName` on the phone. */
export function placeName(name: string): string {
  const trimmed = name.trim();
  const stripped = trimmed.replace(MARKER, "");
  return stripped.length > 0 ? stripped : name;
}

export function directionMarker(name: string): string | null {
  return MARKER.exec(name.trim())?.[1] ?? null;
}

export function normalizeOfficialName(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const radius = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function located(stop: CatalogStop): { lat: number; lng: number } | undefined {
  return typeof stop.lat === "number" && typeof stop.lng === "number" && Number.isFinite(stop.lat) && Number.isFinite(stop.lng)
    ? { lat: stop.lat, lng: stop.lng }
    : undefined;
}

/**
 * One row per catalog stop. `routeCounts[i]` is how many variants serve stop
 * `i`; `evidence` is keyed by TAGO stop id and absent for unchecked stops.
 */
export function classifyCrosswalk(
  stops: readonly CatalogStop[],
  routeCounts: readonly number[],
  evidence: ReadonlyMap<string, StationEvidence> = new Map(),
): CrosswalkRow[] {
  const byPlace = new Map<string, number[]>();
  const byFullName = new Map<string, number>();
  stops.forEach((stop, index) => {
    const key = placeName(stop.name);
    byPlace.set(key, [...(byPlace.get(key) ?? []), index]);
    const full = normalizeOfficialName(stop.name);
    byFullName.set(full, (byFullName.get(full) ?? 0) + 1);
  });

  return stops.map((stop, index) => {
    const here = located(stop);
    const siblings = (byPlace.get(placeName(stop.name)) ?? []).filter((other) => {
      if (other === index) return false;
      const there = located(stops[other]!);
      return here !== undefined && there !== undefined && distanceMeters(here, there) <= SIBLING_POLE_RADIUS_M;
    }).length;
    const base = {
      tagoStopId: stop.id,
      candidateBisStationId: candidateBisStationId(stop.id),
      name: stop.name,
      placeName: placeName(stop.name),
      directionMarker: directionMarker(stop.name),
      hasCoordinates: here !== undefined,
      routeCount: routeCounts[index] ?? 0,
      siblingPolesNearby: siblings,
      duplicateFullName: (byFullName.get(normalizeOfficialName(stop.name)) ?? 1) - 1,
    };
    return { ...base, ...classifyOne(stop, base, evidence.get(stop.id)) };
  });
}

function classifyOne(
  stop: CatalogStop,
  row: Pick<CrosswalkRow, "candidateBisStationId" | "directionMarker" | "siblingPolesNearby" | "duplicateFullName">,
  evidence: StationEvidence | undefined,
): Pick<CrosswalkRow, "status" | "reason" | "coordinateDeltaM"> {
  if (row.candidateBisStationId === null) return { status: "MISSING", reason: "invalid_tago_id_form" };
  if (!evidence) return { status: "UNCHECKED", reason: "evidence_not_collected" };
  if (evidence.kind === "read_failed") return { status: "UNCHECKED", reason: "evidence_read_failed" };
  if (evidence.kind === "not_found") return { status: "MISSING", reason: "no_official_station_page" };

  const officialName = normalizeOfficialName(evidence.name);
  const catalogName = normalizeOfficialName(stop.name);
  const officialMarker = directionMarker(officialName);
  if (placeName(officialName) !== placeName(catalogName)) return { status: "CONFLICT", reason: "name_mismatch" };
  if (officialMarker !== null && row.directionMarker !== null && officialMarker !== row.directionMarker) {
    return { status: "CONFLICT", reason: "opposite_direction_marker" };
  }

  const here = located(stop);
  const there = typeof evidence.latitude === "number" && typeof evidence.longitude === "number"
    && Number.isFinite(evidence.latitude) && Number.isFinite(evidence.longitude)
    ? { lat: evidence.latitude, lng: evidence.longitude }
    : undefined;
  if (!here || !there) return { status: "AMBIGUOUS", reason: "no_coordinates_to_compare" };
  const delta = distanceMeters(here, there);
  const coordinateDeltaM = Math.round(delta);
  if (delta > CONFLICT_COORDINATE_DISTANCE_M) return { status: "CONFLICT", reason: "coordinate_mismatch", coordinateDeltaM };
  if (delta > EXACT_COORDINATE_TOLERANCE_M) return { status: "AMBIGUOUS", reason: "coordinate_near_miss", coordinateDeltaM };

  if (officialName === catalogName) {
    // The full name, marker included, and the position agree. A duplicate full
    // name elsewhere does not matter here: the candidate id and the position
    // single this pole out.
    return { status: "VERIFIED_EXACT", reason: "exact_name_and_coordinates", coordinateDeltaM };
  }
  // Same place, a name that differs in form (usually a missing marker). Only
  // safe when no sibling pole could be the one the page means.
  if (row.siblingPolesNearby > 0) return { status: "AMBIGUOUS", reason: "sibling_pole_nearby", coordinateDeltaM };
  return { status: "VERIFIED_BY_NAME_COORDINATE", reason: "same_place_coordinates_unique_pole", coordinateDeltaM };
}

export interface CrosswalkSummary {
  stops: number;
  byStatus: Record<CrosswalkStatus, number>;
  byReason: Partial<Record<CrosswalkReason, number>>;
  structure: {
    validTagoIdForm: number;
    uniqueCandidates: number;
    candidateCollisions: number;
    withDirectionMarker: number;
    withCoordinates: number;
    placesWithMultiplePoles: number;
    polesWithSiblingNearby: number;
    stopsSharingFullName: number;
    stopsServedByNoRoute: number;
  };
}

export function summarizeCrosswalk(rows: readonly CrosswalkRow[]): CrosswalkSummary {
  const byStatus: Record<CrosswalkStatus, number> = {
    VERIFIED_EXACT: 0, VERIFIED_BY_NAME_COORDINATE: 0, AMBIGUOUS: 0, MISSING: 0, CONFLICT: 0, UNCHECKED: 0,
  };
  const byReason: Partial<Record<CrosswalkReason, number>> = {};
  const candidates = new Map<string, number>();
  const places = new Map<string, number>();
  for (const row of rows) {
    byStatus[row.status] += 1;
    byReason[row.reason] = (byReason[row.reason] ?? 0) + 1;
    if (row.candidateBisStationId) candidates.set(row.candidateBisStationId, (candidates.get(row.candidateBisStationId) ?? 0) + 1);
    places.set(row.placeName, (places.get(row.placeName) ?? 0) + 1);
  }
  return {
    stops: rows.length,
    byStatus,
    byReason,
    structure: {
      validTagoIdForm: rows.filter((row) => row.candidateBisStationId !== null).length,
      uniqueCandidates: candidates.size,
      candidateCollisions: [...candidates.values()].filter((count) => count > 1).length,
      withDirectionMarker: rows.filter((row) => row.directionMarker !== null).length,
      withCoordinates: rows.filter((row) => row.hasCoordinates).length,
      placesWithMultiplePoles: [...places.values()].filter((count) => count > 1).length,
      polesWithSiblingNearby: rows.filter((row) => row.siblingPolesNearby > 0).length,
      stopsSharingFullName: rows.filter((row) => row.duplicateFullName > 0).length,
      stopsServedByNoRoute: rows.filter((row) => row.routeCount === 0).length,
    },
  };
}

/** Rows the phone may use: exactly `VERIFIED_EXACT`, with the coordinates it will re-check against. */
export function runtimeEntries(rows: readonly CrosswalkRow[], stops: readonly CatalogStop[], verifiedOn: string) {
  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  return rows
    .filter((row) => row.status === "VERIFIED_EXACT" && row.candidateBisStationId !== null)
    .map((row) => {
      const stop = byId.get(row.tagoStopId)!;
      return {
        tagoStopID: row.tagoStopId,
        bisStationID: row.candidateBisStationId!,
        status: row.status,
        name: stop.name,
        latitude: stop.lat ?? null,
        longitude: stop.lng ?? null,
        verifiedOn,
      };
    });
}
