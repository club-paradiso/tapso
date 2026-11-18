/**
 * Live coverage: the route numbers TAGO has never been seen to report a bus
 * for, across enough probes of the current catalog to say so.
 *
 * Computed from the committed probe history (`artifacts/route-coverage/
 * probe-history/`, written by `scripts/catalog/build-jeju-catalog.ts`) by
 * `scripts/route-coverage/live-coverage.ts` into `data/jeju-live-coverage.json`,
 * and attached to every journey-session answer for a listed route. The app then
 * tells a rider that the bus may not show up here, rather than "not yet" forever.
 *
 * "Never observed" is an observation about the feed (`OBSERVED`), not a claim
 * that the route does not run: the buses may not send positions, the trips may
 * not have run, or the catalog's variants may differ from what is broadcast.
 *
 * Granularity is the route number: one bus on any variant of the number, in
 * any probe, keeps it off the list. A probe counts for a number when at least
 * one of its variants was read with HTTP 200; a failed read observed nothing.
 */

export const LIVE_COVERAGE_SCHEMA = "tapso-live-coverage-v1";

/**
 * `ASSUMED` product values: on 2026-11-10 most route numbers had been probed
 * only twice (one morning, one night), too few to tell "not reporting" from
 * "between trips"; route 900 had been probed 14 times on two Korean calendar
 * days (2026-11-09 and 2026-11-10), two scheduled trips included, and never reported.
 */
export const LIVE_COVERAGE_CRITERION = { minimumProbes: 10, minimumDays: 2 } as const;

/** One probe-history file, as far as coverage needs it. */
export interface LiveProbeRecord {
  probedAt: string;
  catalogVersion: string;
  probes: Record<string, { status: number; vehicles: number }>;
}

export interface NeverObservedEntry {
  /** Probes of this catalog in which a variant of the number was read with HTTP 200. */
  probes: number;
  /** Distinct Korean calendar days among those probes. */
  days: number;
  /** The first and last of those probes. */
  since: string;
  until: string;
}

export interface LiveCoverage {
  schemaVersion: typeof LIVE_COVERAGE_SCHEMA;
  catalogVersion: string;
  criterion: { minimumProbes: number; minimumDays: number };
  /** Probe files of this catalog version that were read. */
  probeFiles: number;
  /** Route number → evidence. Only numbers that meet the criterion. */
  neverObserved: Record<string, NeverObservedEntry>;
}

/** What a session answer carries for a listed route. */
export interface LiveCoverageView {
  status: "never_observed";
  probes: number;
  days: number;
  since: string;
}

interface CatalogRoutes {
  catalogVersion: string;
  routes: readonly { routeId: string; routeNo: string }[];
}

function koreanDay(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function computeLiveCoverage(catalog: CatalogRoutes, history: readonly LiveProbeRecord[]): LiveCoverage {
  const numberOf = new Map(catalog.routes.map((route) => [route.routeId, route.routeNo]));
  const seen = new Set<string>();
  const moments = new Map<string, string[]>();
  let probeFiles = 0;
  for (const record of history) {
    if (record.catalogVersion !== catalog.catalogVersion) continue;
    probeFiles += 1;
    const answered = new Set<string>();
    for (const [routeId, read] of Object.entries(record.probes)) {
      const routeNo = numberOf.get(routeId);
      if (routeNo === undefined || read.status !== 200) continue;
      answered.add(routeNo);
      if (read.vehicles > 0) seen.add(routeNo);
    }
    for (const routeNo of answered) moments.set(routeNo, [...(moments.get(routeNo) ?? []), record.probedAt]);
  }
  const neverObserved: Record<string, NeverObservedEntry> = {};
  for (const routeNo of [...moments.keys()].sort()) {
    if (seen.has(routeNo)) continue;
    const at = moments.get(routeNo)!.slice().sort();
    const days = new Set(at.map(koreanDay)).size;
    if (at.length < LIVE_COVERAGE_CRITERION.minimumProbes || days < LIVE_COVERAGE_CRITERION.minimumDays) continue;
    neverObserved[routeNo] = { probes: at.length, days, since: at[0]!, until: at.at(-1)! };
  }
  return {
    schemaVersion: LIVE_COVERAGE_SCHEMA,
    catalogVersion: catalog.catalogVersion,
    criterion: { ...LIVE_COVERAGE_CRITERION },
    probeFiles,
    neverObserved,
  };
}

/** The coverage of the session's route, when its number is listed for this catalog. */
export function liveCoverageForRoute(coverage: LiveCoverage, catalog: CatalogRoutes, routeId: string): LiveCoverageView | undefined {
  if (coverage.catalogVersion !== catalog.catalogVersion) return undefined;
  const routeNo = catalog.routes.find((route) => route.routeId === routeId)?.routeNo;
  const entry = routeNo === undefined ? undefined : coverage.neverObserved[routeNo];
  return entry ? { status: "never_observed", probes: entry.probes, days: entry.days, since: entry.since } : undefined;
}

export function validateLiveCoverage(raw: unknown): LiveCoverage {
  const value = raw as LiveCoverage;
  if (!value || value.schemaVersion !== LIVE_COVERAGE_SCHEMA) throw new Error(`live coverage: schemaVersion must be ${LIVE_COVERAGE_SCHEMA}`);
  if (typeof value.catalogVersion !== "string" || !value.catalogVersion) throw new Error("live coverage: catalogVersion missing");
  if (!value.neverObserved || typeof value.neverObserved !== "object") throw new Error("live coverage: neverObserved missing");
  for (const [routeNo, entry] of Object.entries(value.neverObserved)) {
    if (!Number.isInteger(entry.probes) || !Number.isInteger(entry.days) || typeof entry.since !== "string" || typeof entry.until !== "string") {
      throw new Error(`live coverage: malformed entry for ${routeNo}`);
    }
  }
  return value;
}
