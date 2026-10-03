/**
 * Route-by-route production readiness: for every variant in the canonical
 * catalog, can TAPSO run a live ride on it today, and what official timetable
 * stands behind its number? Offline and deterministic: it reads the committed
 * catalog, the per-variant live endpoint probe and the timetable bundle, and
 * never calls anything (`scripts/route-coverage/production-readiness.ts`).
 *
 * Classes, decided by explicit rules and reported with their reasons:
 * - SUPPORTED: ordered stops with positions, a linear or loop shape, and a live
 *   vehicle endpoint that answered; any bus it reported carried a stop
 *   sequence inside the route.
 * - SUPPORTED_WITH_WARNING: rideable, with something the rider or the audit
 *   must account for (a stop list that revisits stops, stops without
 *   positions, virtual stops, the same stop list under another route ID of the
 *   number, no bus reporting when probed so stop-sequence evidence could not
 *   be checked).
 * - UNSUPPORTED: the provider gave no usable stop list, the live endpoint
 *   failed, or a bus reported a stop sequence outside the route.
 * - UNKNOWN: the live endpoint was never probed for this variant.
 *
 * Geometry is reported separately and honestly: TAPSO has stop coordinates
 * only, no surveyed road shape, so the hybrid engine can at most predict
 * along stop chords (`HybridPositionEngine.swift`, `verifiedRoadShape: false`).
 */

import type { TimetableBundle } from "./officialTimetable.ts";
import { timetableIndex } from "./officialTimetable.ts";
import type { TransitCatalog } from "./transitCatalog.ts";

export type ReadinessClass = "SUPPORTED" | "SUPPORTED_WITH_WARNING" | "UNSUPPORTED" | "UNKNOWN";
export type TimetableStatus = "available" | "source_conflict" | "no_timetable" | "not_published";

export interface LiveProbe {
  status: number;
  vehicles: number;
  withStopSequence: number;
  sequenceInRange: number;
}

export interface VariantReadiness {
  routeNo: string;
  routeId: string;
  start?: string;
  end?: string;
  stopCount: number;
  topology: string;
  live: "answered_with_buses" | "answered_no_bus" | "failed" | "not_probed" | "no_stop_list";
  timetable: TimetableStatus;
  geometry: "STOP_COORDINATES_ONLY" | "INCOMPLETE_STOP_COORDINATES" | "NONE";
  tracking: ReadinessClass;
  reasons: string[];
  evidence: string;
}

export interface ReadinessReport {
  schemaVersion: "tapso-route-readiness-v1";
  catalogVersion: string;
  catalogGeneratedAt: string;
  probedAt?: string;
  timetableBundleVersion: string;
  timetableAsOf: string;
  totals: Record<ReadinessClass, number>;
  timetableTotals: Record<TimetableStatus, number>;
  routeNumbers: number;
  routeNumbersWithServedTimetable: number;
  variants: VariantReadiness[];
}

export function assessReadiness(
  catalog: TransitCatalog,
  timetables: TimetableBundle,
  probe?: { probedAt: string; catalogVersion: string; probes: Record<string, LiveProbe> },
): ReadinessReport {
  const timetableByRoute = new Map(timetableIndex(timetables).map((entry) => [entry.routeNo, entry.status]));
  // A probe of another catalog version says nothing about this one's variants.
  const probes = probe && probe.catalogVersion === catalog.catalogVersion ? probe.probes : {};
  const variants: VariantReadiness[] = [];
  // The provider lists some stop lists under two route IDs of one number; each reports its own buses.
  const twinsByKey = new Map<string, string[]>();
  for (const route of catalog.routes) {
    const key = `${route.routeNo}|${route.stops.join(",")}|${(route.sequences ?? []).join(",")}`;
    twinsByKey.set(key, [...(twinsByKey.get(key) ?? []), route.routeId]);
  }

  for (const route of catalog.routes) {
    const stops = route.stops.map((index) => catalog.stops[index]!);
    const withPosition = stops.filter((stop) => stop.lat !== undefined).length;
    const virtual = stops.filter((stop) => stop.name.includes("가상정류소")).length;
    const result = probes[route.routeId];
    const reasons: string[] = [];
    let tracking: ReadinessClass;
    let live: VariantReadiness["live"];

    if (!result) {
      live = "not_probed";
      tracking = "UNKNOWN";
      reasons.push("live vehicle endpoint not probed for this catalog version");
    } else if (result.status !== 200) {
      live = "failed";
      tracking = "UNSUPPORTED";
      reasons.push(`live vehicle endpoint answered HTTP ${result.status}`);
    } else if (result.vehicles > 0 && (result.withStopSequence !== result.vehicles || result.sequenceInRange !== result.vehicles)) {
      live = "answered_with_buses";
      tracking = "UNSUPPORTED";
      reasons.push(`${result.vehicles - result.sequenceInRange} of ${result.vehicles} reporting buses had no stop sequence inside the route`);
    } else {
      live = result.vehicles > 0 ? "answered_with_buses" : "answered_no_bus";
      tracking = "SUPPORTED";
      if (result.vehicles === 0) reasons.push("no bus reported when probed: stop-sequence evidence unchecked");
    }
    if (route.topology === "repeating") reasons.push("the stop list revisits stops: boarding and destination must be chosen by order");
    if (withPosition < stops.length) reasons.push(`${stops.length - withPosition} of ${stops.length} stops have no position`);
    if (virtual > 0) reasons.push(`${virtual} virtual stop(s) (가상정류소) in the list`);
    const twins = (twinsByKey.get(`${route.routeNo}|${route.stops.join(",")}|${(route.sequences ?? []).join(",")}`) ?? []).filter((id) => id !== route.routeId);
    if (twins.length > 0) reasons.push(`same stop list as ${twins.join(", ")} under ${route.routeNo}: the app numbers them as separate services, and a rider on the other one's bus must choose again`);
    if (tracking === "SUPPORTED" && reasons.length > 0) tracking = "SUPPORTED_WITH_WARNING";

    const timetable = timetableByRoute.get(route.routeNo) ?? "not_published";
    variants.push({
      routeNo: route.routeNo,
      routeId: route.routeId,
      ...(route.start ? { start: route.start } : {}),
      ...(route.end ? { end: route.end } : {}),
      stopCount: stops.length,
      topology: route.topology,
      live,
      timetable,
      geometry: withPosition === 0 ? "NONE" : withPosition < stops.length ? "INCOMPLETE_STOP_COORDINATES" : "STOP_COORDINATES_ONLY",
      tracking,
      reasons,
      evidence: result
        ? `probe HTTP ${result.status}, ${result.vehicles} bus(es), ${result.sequenceInRange} with an in-route stop sequence; ${stops.length} stops, ${withPosition} with position, topology ${route.topology}`
        : `${stops.length} stops, ${withPosition} with position, topology ${route.topology}`,
    });
  }
  for (const missing of catalog.unavailable) {
    variants.push({
      routeNo: missing.routeNo,
      routeId: missing.routeId,
      stopCount: 0,
      topology: "unknown",
      live: "no_stop_list",
      timetable: timetableByRoute.get(missing.routeNo) ?? "not_published",
      geometry: "NONE",
      tracking: "UNSUPPORTED",
      reasons: [`no usable stop list: ${missing.reason}`],
      evidence: "listed by the provider; stop list unavailable when the catalog was built",
    });
  }
  variants.sort((left, right) => compareRouteNumbers(left.routeNo, right.routeNo) || (left.routeId < right.routeId ? -1 : left.routeId > right.routeId ? 1 : 0));

  const totals: Record<ReadinessClass, number> = { SUPPORTED: 0, SUPPORTED_WITH_WARNING: 0, UNSUPPORTED: 0, UNKNOWN: 0 };
  for (const variant of variants) totals[variant.tracking] += 1;
  const numbers = new Map<string, TimetableStatus>();
  for (const variant of variants) numbers.set(variant.routeNo, variant.timetable);
  const timetableTotals: Record<TimetableStatus, number> = { available: 0, source_conflict: 0, no_timetable: 0, not_published: 0 };
  for (const status of numbers.values()) timetableTotals[status] += 1;
  return {
    schemaVersion: "tapso-route-readiness-v1",
    catalogVersion: catalog.catalogVersion,
    catalogGeneratedAt: catalog.generatedAt,
    ...(probe && probe.catalogVersion === catalog.catalogVersion ? { probedAt: probe.probedAt } : {}),
    timetableBundleVersion: timetables.bundleVersion,
    timetableAsOf: timetables.retrievedOn,
    totals,
    timetableTotals,
    routeNumbers: numbers.size,
    routeNumbersWithServedTimetable: timetableTotals.available,
    variants,
  };
}

export function renderReadinessMarkdown(report: ReadinessReport): string {
  const lines = [
    "# Jeju production readiness, route by route",
    "",
    `Catalog \`${report.catalogVersion}\` (built ${report.catalogGeneratedAt}), live probe ${report.probedAt ?? "not run for this catalog"}, timetables \`${report.timetableBundleVersion}\` (as of ${report.timetableAsOf}).`,
    "Generated by `scripts/route-coverage/production-readiness.ts`; do not edit by hand. A probe is one moment: a variant with no bus reporting is not thereby unsupported.",
    "",
    "| Tracking | Variants |",
    "|---|---|",
    ...Object.entries(report.totals).map(([key, value]) => `| ${key} | ${value} |`),
    `| **total** | **${report.variants.length}** |`,
    "",
    `Route numbers: ${report.routeNumbers}. Official timetable served for ${report.routeNumbersWithServedTimetable}.`,
    "",
    "| Timetable (per route number) | Route numbers |",
    "|---|---|",
    ...Object.entries(report.timetableTotals).map(([key, value]) => `| ${key} | ${value} |`),
    "",
    "Geometry: stop coordinates only for every variant; no surveyed road shape exists, so hybrid tracking cannot fuse (only predict) anywhere.",
    "",
    "| Route | Provider ID | Stops | Topology | Live endpoint | Timetable | Tracking | Reasons |",
    "|---|---|---|---|---|---|---|---|",
    ...report.variants.map((variant) =>
      `| ${variant.routeNo} | \`${variant.routeId}\` | ${variant.stopCount} | ${variant.topology} | ${variant.live} | ${variant.timetable} | ${variant.tracking} | ${variant.reasons.join("; ") || "—"} |`),
    "",
  ];
  return lines.join("\n");
}

function compareRouteNumbers(left: string, right: string): number {
  const parse = (text: string) => {
    const match = /^(\d+)(?:-(\d+))?/.exec(text);
    return match ? [Number(match[1]), match[2] === undefined ? -1 : Number(match[2])] : [Number.MAX_SAFE_INTEGER, 0];
  };
  const [leftBase, leftBranch] = parse(left);
  const [rightBase, rightBranch] = parse(right);
  return (leftBase! - rightBase!) || (leftBranch! - rightBranch!) || (left < right ? -1 : left > right ? 1 : 0);
}
