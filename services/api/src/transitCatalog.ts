/**
 * The canonical Jeju transit catalog: every official route variant TAGO names
 * for Jeju (city 39), each with its ordered stops, in one versioned file.
 *
 * Why a file and not a live call: the phone needs every stop name to search by
 * destination, and asking TAGO for every route and every stop list on each
 * launch would be slow, would spend the shared provider quota, and would fail
 * the moment TAGO is slow. So the catalog is built by a controlled pipeline
 * (`scripts/catalog/build-jeju-catalog.ts`, run by
 * `.github/workflows/jeju-catalog.yml`), reviewed as a data pull request, and
 * served as-is by `GET /v1/catalog`. Live vehicles are never part of it.
 *
 * Identity rules, from the provider and never collapsed:
 * - one entry per provider route ID (`routeId`); TAGO route IDs are
 *   direction-specific, so a route number is several entries;
 * - `routeNo` is exactly what TAGO calls it. "202" and "202-1" are different
 *   routes; nothing here groups them, and nothing infers a direction;
 * - stops are keyed by provider stop ID. Two poles with the same name (either
 *   side of a road) stay two stops.
 *
 * The file is deterministic: the same provider answers produce the same bytes
 * apart from `generatedAt`, and `catalogVersion` is a hash of the content alone.
 */

import { createHash } from "node:crypto";

import type { StopOnRoute } from "./domain.ts";
import { classifyTopology } from "./rideCapture.ts";

export const CATALOG_SCHEMA_VERSION = "tapso-jeju-catalog-v1";

export interface CatalogStop {
  /** Provider stop ID (TAGO `nodeid`). */
  id: string;
  /** Provider stop name, verbatim. */
  name: string;
  /** WGS84, as the provider gave it; absent when the provider gave none. */
  lat?: number;
  lng?: number;
}

export interface CatalogRoute {
  /** Provider route ID (TAGO `routeid`), direction-specific. */
  routeId: string;
  /** Provider route number (TAGO `routeno`), verbatim. */
  routeNo: string;
  routeType?: string;
  /** Provider start and end stop names (`startnodenm`, `endnodenm`). */
  start?: string;
  end?: string;
  topology: "linear" | "loop" | "repeating";
  /** Indexes into `stops`, in provider order (`nodeord`). */
  stops: number[];
  /**
   * Provider stop sequences (`nodeord`), parallel to `stops`. Omitted when they
   * are exactly 1…n, which is the common case.
   */
  sequences?: number[];
}

export interface TransitCatalog {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  /** Official provider data, as TAPSO read it on `generatedAt`. Not live. */
  label: "OFFICIAL_DERIVED";
  /** First 16 hex digits of SHA-256 over `stops` and `routes`. */
  catalogVersion: string;
  generatedAt: string;
  source: {
    provider: "TAGO";
    cityCode: string;
    /** Where the rows were read: TAPSO's API, which reads TAGO. */
    via: string;
    /** How route IDs were discovered, and how many each way found. */
    discovery: { method: string; query: string; routeIds: number }[];
  };
  stops: CatalogStop[];
  routes: CatalogRoute[];
  /**
   * Variants the provider named but whose stop list could not be read. Kept so a
   * missing route is a visible gap, not a silent omission.
   */
  unavailable: { routeId: string; routeNo: string; reason: string }[];
}

export class CatalogError extends Error {
  readonly code = "CATALOG_INVALID";
}

export interface CatalogRouteRow {
  routeId: string;
  routeNumber: string;
  routeType?: string;
  startStopName?: string;
  endStopName?: string;
}

export interface CatalogBuildInput {
  generatedAt: string;
  cityCode: string;
  via: string;
  discovery: { method: string; query: string; routeIds: number }[];
  routes: CatalogRouteRow[];
  /** Ordered stops per route ID, or the reason they could not be read. */
  stopsByRoute: Map<string, StopOnRoute[] | { error: string }>;
}

const ROUTE_ID = /^[A-Za-z0-9_-]{1,32}$/;
const ROUTE_NO = /^[A-Za-z0-9가-힣() .,_-]{1,32}$/;

export function buildCatalog(input: CatalogBuildInput): TransitCatalog {
  const byRouteId = new Map<string, CatalogRouteRow>();
  for (const row of input.routes) {
    const known = byRouteId.get(row.routeId);
    if (!known) {
      byRouteId.set(row.routeId, { ...row });
      continue;
    }
    // The same route found by several discovery queries: merge field by field,
    // so the result does not depend on which query answered first.
    for (const field of ["routeNumber", "routeType", "startStopName", "endStopName"] as const) {
      const value = row[field];
      if (value === undefined) continue;
      if (known[field] === undefined) known[field] = value;
      else if (known[field] !== value) {
        throw new CatalogError(`route ${row.routeId} has two values for ${field}: ${known[field]} and ${value}`);
      }
    }
  }

  const stopById = new Map<string, CatalogStop>();
  const ordered: { row: CatalogRouteRow; stops: StopOnRoute[] }[] = [];
  const unavailable: TransitCatalog["unavailable"] = [];
  for (const row of [...byRouteId.values()].sort(compareRows)) {
    const stops = input.stopsByRoute.get(row.routeId);
    if (!stops || !Array.isArray(stops)) {
      unavailable.push({ routeId: row.routeId, routeNo: row.routeNumber, reason: stops ? stops.error : "not_fetched" });
      continue;
    }
    if (stops.length < 2) {
      unavailable.push({ routeId: row.routeId, routeNo: row.routeNumber, reason: `provider_stop_list_has_${stops.length}_stops` });
      continue;
    }
    const sorted = [...stops].sort((left, right) => left.sequence - right.sequence);
    for (const stop of sorted) {
      const known = stopById.get(stop.stopId);
      const entry: CatalogStop = {
        id: stop.stopId,
        name: stop.name,
        ...(isCoordinate(stop.latitude, stop.longitude) ? { lat: round6(stop.latitude!), lng: round6(stop.longitude!) } : {}),
      };
      // One provider stop ID must be one place. A route that reports it under a
      // different name or position is recorded with the first reading, and the
      // disagreement is visible to `validateCatalog` callers through the audit.
      if (!known) stopById.set(stop.stopId, entry);
      else if (known.lat === undefined && entry.lat !== undefined) stopById.set(stop.stopId, { ...known, lat: entry.lat, lng: entry.lng });
    }
    ordered.push({ row, stops: sorted });
  }

  const stops = [...stopById.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const indexById = new Map(stops.map((stop, index) => [stop.id, index]));
  const routes: CatalogRoute[] = ordered.map(({ row, stops: list }) => {
    const sequences = list.map((stop) => stop.sequence);
    const plain = sequences.every((sequence, index) => sequence === index + 1);
    return {
      routeId: row.routeId,
      routeNo: row.routeNumber,
      ...(row.routeType ? { routeType: row.routeType } : {}),
      ...(row.startStopName ? { start: row.startStopName } : {}),
      ...(row.endStopName ? { end: row.endStopName } : {}),
      topology: classifyTopology(list).kind,
      stops: list.map((stop) => indexById.get(stop.stopId)!),
      ...(plain ? {} : { sequences }),
    };
  });

  const catalog: TransitCatalog = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    label: "OFFICIAL_DERIVED",
    catalogVersion: catalogVersionOf(stops, routes),
    generatedAt: input.generatedAt,
    source: { provider: "TAGO", cityCode: input.cityCode, via: input.via, discovery: input.discovery },
    stops,
    routes,
    unavailable: unavailable.sort((left, right) => compareText(left.routeId, right.routeId)),
  };
  validateCatalog(catalog);
  return catalog;
}

export function catalogVersionOf(stops: CatalogStop[], routes: CatalogRoute[]): string {
  return createHash("sha256").update(JSON.stringify({ stops, routes })).digest("hex").slice(0, 16);
}

/** Throws `CatalogError` naming the first problem; returns the catalog typed. */
export function validateCatalog(raw: unknown): TransitCatalog {
  const fail = (message: string): never => {
    throw new CatalogError(message);
  };
  if (!raw || typeof raw !== "object") fail("catalog is not an object");
  const catalog = raw as TransitCatalog;
  if (catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) fail(`unsupported schema ${String(catalog.schemaVersion)}`);
  if (catalog.label !== "OFFICIAL_DERIVED") fail("label must be OFFICIAL_DERIVED");
  if (!/^[0-9a-f]{16}$/.test(catalog.catalogVersion ?? "")) fail("catalogVersion must be 16 hex digits");
  if (Number.isNaN(Date.parse(catalog.generatedAt ?? ""))) fail("generatedAt is not a date");
  if (!Array.isArray(catalog.stops) || !Array.isArray(catalog.routes) || !Array.isArray(catalog.unavailable)) fail("stops, routes and unavailable must be arrays");

  const stopIds = new Set<string>();
  catalog.stops.forEach((stop, index) => {
    if (typeof stop.id !== "string" || !stop.id) fail(`stop ${index} has no id`);
    if (stopIds.has(stop.id)) fail(`stop ${stop.id} appears twice`);
    stopIds.add(stop.id);
    if (typeof stop.name !== "string" || !stop.name.trim()) fail(`stop ${stop.id} has no name`);
    if ((stop.lat === undefined) !== (stop.lng === undefined)) fail(`stop ${stop.id} has half a coordinate`);
    if (stop.lat !== undefined && !isCoordinate(stop.lat, stop.lng)) fail(`stop ${stop.id} has an invalid coordinate`);
  });

  const routeIds = new Set<string>();
  for (const route of catalog.routes) {
    if (!ROUTE_ID.test(route.routeId ?? "")) fail(`route id ${String(route.routeId)} is malformed`);
    if (routeIds.has(route.routeId)) fail(`route ${route.routeId} appears twice`);
    routeIds.add(route.routeId);
    if (!ROUTE_NO.test(route.routeNo ?? "")) fail(`route ${route.routeId} has a malformed number ${String(route.routeNo)}`);
    if (!["linear", "loop", "repeating"].includes(route.topology)) fail(`route ${route.routeId} has an unknown topology`);
    if (!Array.isArray(route.stops) || route.stops.length < 2) fail(`route ${route.routeId} has fewer than two stops`);
    for (const index of route.stops) {
      if (!Number.isInteger(index) || index < 0 || index >= catalog.stops.length) fail(`route ${route.routeId} points at stop ${index}, outside the table`);
    }
    if (route.sequences !== undefined) {
      if (route.sequences.length !== route.stops.length) fail(`route ${route.routeId} has ${route.sequences.length} sequences for ${route.stops.length} stops`);
      if (route.sequences.some((sequence, index) => !Number.isInteger(sequence) || (index > 0 && sequence <= route.sequences![index - 1]!))) {
        fail(`route ${route.routeId} has sequences that are not strictly ascending`);
      }
    }
  }
  const expected = catalogVersionOf(catalog.stops, catalog.routes);
  if (catalog.catalogVersion !== expected) fail(`catalogVersion ${catalog.catalogVersion} does not match the content (${expected})`);
  return catalog;
}

/** The ordered stops of one variant, with their provider sequences. */
export function routeStops(catalog: TransitCatalog, route: CatalogRoute): StopOnRoute[] {
  return route.stops.map((index, position) => {
    const stop = catalog.stops[index]!;
    return {
      stopId: stop.id,
      name: stop.name,
      sequence: route.sequences?.[position] ?? position + 1,
      ...(stop.lat !== undefined ? { latitude: stop.lat, longitude: stop.lng } : {}),
    };
  });
}

function compareRows(left: CatalogRouteRow, right: CatalogRouteRow): number {
  return compareText(left.routeNumber, right.routeNumber) || compareText(left.routeId, right.routeId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isCoordinate(lat: number | undefined, lng: number | undefined): boolean {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
