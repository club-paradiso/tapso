/**
 * Builds the canonical Jeju transit catalog from TAPSO's production API (which
 * reads TAGO) and, with `--live`, records whether each variant's live vehicle
 * endpoint answers. Run by `.github/workflows/jeju-catalog.yml`, because the
 * agent environment cannot reach the API; it needs no secret.
 *
 *   node --experimental-strip-types scripts/catalog/build-jeju-catalog.ts \
 *     [--base https://tapso-api.vercel.app] [--live] [--pace-ms 700]
 *   … --probe-only [--first-type 순환버스]   probe the committed catalog without rebuilding it
 *
 * Writes:
 *   services/api/data/jeju-transit-catalog.json     the catalog (served by GET /v1/catalog)
 *   artifacts/route-coverage/jeju-catalog-discovery.json  how each route ID was found
 *   artifacts/route-coverage/jeju-live-probe.json   with --live: per variant, did
 *                                                   /v1/vehicles answer, how many buses,
 *                                                   how many carried a stop sequence.
 *                                                   No vehicle number is ever written.
 *
 * Discovery does not trust any single request to be complete:
 *   1. `GET /v1/routes?cityCode=39` with no number, which asks TAGO for every route;
 *   2. `GET /v1/routes?cityCode=39&routeNo=<d>` for each digit 1-9 (TAGO's number
 *      search is not exact: "810" lists 810-1 and 810-2, data-source probe
 *      run 37091997278);
 *   3. every route number named by the official timetable census
 *      (`fixtures/jeju/timetables/bis/manifest.json`).
 * Route IDs are unioned; a route ID the provider names with two numbers stops the
 * build. A variant whose stops cannot be read is listed under `unavailable`.
 *
 * Paced under the API's 120 requests per minute per caller.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { StopOnRoute } from "../../services/api/src/domain.ts";
import { buildCatalog, validateCatalog, type CatalogRouteRow, type TransitCatalog } from "../../services/api/src/transitCatalog.ts";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const BASE = option("--base") ?? process.env.TAPSO_API_BASE ?? "https://tapso-api.vercel.app";
const CITY = "39";
const PACE_MS = Number(option("--pace-ms") ?? 700);
const LIVE = args.includes("--live");
// Probe the catalog already written, without rebuilding it (the workflow commits
// the catalog first, so a slow probe can never cost the catalog).
const PROBE_ONLY = args.includes("--probe-only");
// Probe variants of this provider route type first, e.g. 순환버스 (Jeju's late-night school routes,
// 22:00-23:40 KST): a full probe takes about 40 minutes, longer than their service window.
const FIRST_TYPE = option("--first-type");
const ROOT = path.resolve(import.meta.dirname, "..", "..");

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let calls = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJson(pathAndQuery: string): Promise<{ status: number; body: any }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await pause(PACE_MS * (attempt === 0 ? 1 : 4 * attempt));
    calls += 1;
    try {
      const response = await fetch(new URL(pathAndQuery, BASE), {
        headers: { accept: "application/json", "user-agent": "TAPSO-catalog-build/1.0 (+https://github.com/club-paradiso/tapso)" },
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 3) continue;
      }
      return { status: response.status, body };
    } catch (error) {
      if (attempt === 3) return { status: 0, body: { error: String(error) } };
    }
  }
  return { status: 0, body: null };
}

function rowsOf(body: unknown): CatalogRouteRow[] {
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => typeof item?.routeId === "string" && typeof item?.routeNumber === "string")
    .map((item) => ({
      routeId: item.routeId,
      routeNumber: item.routeNumber,
      ...(typeof item.routeType === "string" ? { routeType: item.routeType } : {}),
      ...(typeof item.startStopName === "string" ? { startStopName: item.startStopName } : {}),
      ...(typeof item.endStopName === "string" ? { endStopName: item.endStopName } : {}),
    }));
}

/** Route numbers the timetable census names, e.g. "231, 232" → 231 and 232; "704-1,3번" is not expanded here. */
async function censusRouteNumbers(): Promise<string[]> {
  try {
    const manifest = JSON.parse(await readFile(path.join(ROOT, "fixtures/jeju/timetables/bis/manifest.json"), "utf8"));
    const numbers = new Set<string>();
    for (const entry of manifest.timetables ?? []) {
      for (const token of String(entry.name ?? "").split(/[,/;\s]+/)) {
        const match = token.match(/^(\d{1,4}(?:-\d{1,2})?)/);
        if (match) numbers.add(match[1]!);
      }
    }
    return [...numbers].sort();
  } catch {
    return [];
  }
}

if (PROBE_ONLY) {
  const catalog = JSON.parse(await readFile(path.join(ROOT, "services/api/data/jeju-transit-catalog.json"), "utf8"));
  await probe(validateCatalog(catalog));
  console.log(`CALLS ${calls}`);
  process.exit(0);
}

const rows: CatalogRouteRow[] = [];
const discovery: { method: string; query: string; routeIds: number; status: number }[] = [];
async function discover(method: string, query: string, pathAndQuery: string): Promise<void> {
  const { status, body } = await getJson(pathAndQuery);
  const found = status === 200 ? rowsOf(body) : [];
  rows.push(...found);
  discovery.push({ method, query, routeIds: new Set(found.map((row) => row.routeId)).size, status });
  console.log(`DISCOVER ${method} ${query || "*"} HTTP ${status} ${found.length}`);
}

console.log(`CATALOG_BUILD ${new Date().toISOString()} ${BASE}`);
await discover("all_routes", "", `/v1/routes?cityCode=${CITY}`);
for (const digit of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
  await discover("number_search", digit, `/v1/routes?cityCode=${CITY}&routeNo=${digit}`);
}
for (const number of await censusRouteNumbers()) {
  await discover("timetable_census_number", number, `/v1/routes?cityCode=${CITY}&routeNo=${encodeURIComponent(number)}`);
}

const routeIds = [...new Set(rows.map((row) => row.routeId))].sort();
console.log(`ROUTE_IDS ${routeIds.length}`);
if (routeIds.length === 0) {
  console.error("no route discovered; refusing to write an empty catalog");
  process.exit(1);
}

const stopsByRoute = new Map<string, StopOnRoute[] | { error: string }>();
for (const routeId of routeIds) {
  const { status, body } = await getJson(`/v1/stops?routeId=${encodeURIComponent(routeId)}&cityCode=${CITY}`);
  if (status !== 200 || !Array.isArray(body?.items)) {
    stopsByRoute.set(routeId, { error: `stops_http_${status}` });
    console.log(`STOPS ${routeId} HTTP ${status}`);
    continue;
  }
  if (body?.meta?.servedStale) {
    stopsByRoute.set(routeId, { error: "stops_served_stale" });
    continue;
  }
  stopsByRoute.set(routeId, body.items as StopOnRoute[]);
  console.log(`STOPS ${routeId} ${body.items.length}`);
}

const generatedAt = new Date().toISOString();
const catalog = buildCatalog({
  generatedAt,
  cityCode: CITY,
  via: BASE,
  discovery: discovery.map(({ method, query, routeIds: count }) => ({ method, query, routeIds: count })),
  routes: rows,
  stopsByRoute,
});

await mkdir(path.join(ROOT, "services/api/data"), { recursive: true });
await mkdir(path.join(ROOT, "artifacts/route-coverage"), { recursive: true });
await writeFile(path.join(ROOT, "services/api/data/jeju-transit-catalog.json"), `${JSON.stringify(catalog)}\n`);
await writeFile(
  path.join(ROOT, "artifacts/route-coverage/jeju-catalog-discovery.json"),
  `${JSON.stringify({ generatedAt, base: BASE, catalogVersion: catalog.catalogVersion, discovery, routeIds: routeIds.length, routes: catalog.routes.length, stops: catalog.stops.length, unavailable: catalog.unavailable }, null, 2)}\n`,
);
console.log(`CATALOG ${catalog.catalogVersion} routes ${catalog.routes.length} stops ${catalog.stops.length} unavailable ${catalog.unavailable.length}`);

if (LIVE) await probe(catalog);
console.log(`CALLS ${calls}`);

async function probe(catalog: TransitCatalog): Promise<void> {
  const probes: Record<string, { status: number; vehicles: number; withStopSequence: number; sequenceInRange: number }> = {};
  const ordered = FIRST_TYPE
    ? [...catalog.routes.filter((route) => route.routeType === FIRST_TYPE), ...catalog.routes.filter((route) => route.routeType !== FIRST_TYPE)]
    : catalog.routes;
  const startedAt = new Date().toISOString();
  for (const route of ordered) {
    const { status, body } = await getJson(`/v1/vehicles?routeId=${encodeURIComponent(route.routeId)}&cityCode=${CITY}`);
    const items: { stopSequence?: unknown }[] = status === 200 && Array.isArray(body?.items) ? body.items : [];
    const maxSequence = route.sequences?.at(-1) ?? route.stops.length;
    const withStopSequence = items.filter((item) => typeof item.stopSequence === "number").length;
    const sequenceInRange = items.filter((item) => typeof item.stopSequence === "number" && item.stopSequence >= 1 && item.stopSequence <= maxSequence).length;
    probes[route.routeId] = { status, vehicles: items.length, withStopSequence, sequenceInRange };
  }
  const probedAt = new Date().toISOString();
  const record = `${JSON.stringify({ probedAt, startedAt, ...(FIRST_TYPE ? { firstType: FIRST_TYPE } : {}), base: BASE, catalogVersion: catalog.catalogVersion, note: "Vehicle counts only; no vehicle number is recorded. A count of zero means no bus reported at that moment, not that the route is unsupported.", probes }, null, 2)}\n`;
  // The latest probe feeds the readiness report; every probe is kept, because a probe is one
  // moment and release gate 3 counts what any probe of this catalog version observed.
  await writeFile(path.join(ROOT, "artifacts/route-coverage/jeju-live-probe.json"), record);
  await mkdir(path.join(ROOT, "artifacts/route-coverage/probe-history"), { recursive: true });
  await writeFile(path.join(ROOT, `artifacts/route-coverage/probe-history/${probedAt.slice(0, 19).replaceAll(":", "-")}Z.json`), record);
  console.log(`LIVE_PROBE ${Object.keys(probes).length} variants`);
}
