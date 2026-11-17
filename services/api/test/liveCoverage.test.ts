/**
 * Live coverage: route numbers TAGO has never been seen to report a bus for,
 * across enough probes of the current catalog to say so (`liveCoverage.ts`).
 * The session answers carry it so the app can tell a rider on such a route that
 * the bus may not show up, instead of "not yet" forever.
 *
 * Catalogs, probes, stops and vehicles here are SYNTHETIC, except the test that
 * recomputes the committed file from the committed probe history.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { readTransitApiConfig } from "../src/apiConfig.ts";
import { createTransitApiHandler } from "../src/apiRouter.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { JourneySessionCoordinator } from "../src/journeySession.ts";
import {
  LIVE_COVERAGE_CRITERION,
  computeLiveCoverage,
  liveCoverageForRoute,
  validateLiveCoverage,
  type LiveProbeRecord,
} from "../src/liveCoverage.ts";
import type { TransitProvider } from "../src/provider.ts";
import { inMemoryStaticTransitData } from "../src/staticTransitData.ts";
import { validateCatalog, type TransitCatalog } from "../src/transitCatalog.ts";

const VERSION = "synthetic-catalog";

function catalog(): Pick<TransitCatalog, "catalogVersion" | "routes"> {
  return {
    catalogVersion: VERSION,
    routes: [
      { routeId: "SYN-900-A", routeNo: "900" },
      { routeId: "SYN-900-B", routeNo: "900" },
      { routeId: "SYN-910-A", routeNo: "910" },
    ] as TransitCatalog["routes"],
  };
}

/** `count` probes spread over `days` KST days, each reading every variant; `seen` variants report a bus. */
function probes(count: number, days: number, seen: string[] = [], options: { status?: number; catalogVersion?: string } = {}): LiveProbeRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const day = 10 + (index % days);
    const probedAt = `2026-11-${String(day).padStart(2, "0")}T0${index % 10}:00:00.000Z`;
    const read = (routeId: string) => ({ status: options.status ?? 200, vehicles: seen.includes(routeId) ? 1 : 0 });
    return {
      probedAt,
      catalogVersion: options.catalogVersion ?? VERSION,
      probes: { "SYN-900-A": read("SYN-900-A"), "SYN-900-B": read("SYN-900-B"), "SYN-910-A": read("SYN-910-A") },
    };
  });
}

test("a route number never seen with a bus across enough probes on enough days is listed", () => {
  const coverage = computeLiveCoverage(catalog(), probes(LIVE_COVERAGE_CRITERION.minimumProbes, LIVE_COVERAGE_CRITERION.minimumDays, ["SYN-910-A"]));
  assert.deepEqual(Object.keys(coverage.neverObserved), ["900"]);
  assert.equal(coverage.neverObserved["900"]!.probes, LIVE_COVERAGE_CRITERION.minimumProbes);
  assert.equal(coverage.neverObserved["900"]!.days, LIVE_COVERAGE_CRITERION.minimumDays);
  assert.equal(coverage.catalogVersion, VERSION);
});

test("one bus on any variant of the number, ever, keeps the number off the list", () => {
  const history = probes(12, 3, ["SYN-910-A"]);
  history[5]!.probes["SYN-900-B"] = { status: 200, vehicles: 1 };
  assert.deepEqual(computeLiveCoverage(catalog(), history).neverObserved, {});
});

test("too few probes, or all on one day, is not enough to list a number", () => {
  assert.deepEqual(computeLiveCoverage(catalog(), probes(LIVE_COVERAGE_CRITERION.minimumProbes - 1, 3)).neverObserved, {});
  assert.deepEqual(computeLiveCoverage(catalog(), probes(20, 1)).neverObserved, {});
});

test("failed reads and probes of another catalog are not observations", () => {
  assert.deepEqual(computeLiveCoverage(catalog(), probes(12, 3, [], { status: 502 })).neverObserved, {}, "a failed read saw nothing either way");
  assert.deepEqual(computeLiveCoverage(catalog(), probes(12, 3, [], { catalogVersion: "older" })).neverObserved, {});
});

test("the lookup goes from a session's route ID to its number", () => {
  const coverage = computeLiveCoverage(catalog(), probes(12, 3, ["SYN-910-A"]));
  assert.equal(liveCoverageForRoute(coverage, catalog(), "SYN-900-B")?.status, "never_observed");
  assert.equal(liveCoverageForRoute(coverage, catalog(), "SYN-910-A"), undefined);
  assert.equal(liveCoverageForRoute(coverage, catalog(), "SYN-UNKNOWN"), undefined);
  // A coverage file computed for another catalog says nothing about this one.
  assert.equal(liveCoverageForRoute({ ...coverage, catalogVersion: "older" }, catalog(), "SYN-900-B"), undefined);
});

test("the committed file is what the committed probe history gives", () => {
  const committedCatalog = validateCatalog(JSON.parse(readFileSync(new URL("../data/jeju-transit-catalog.json", import.meta.url), "utf8")));
  const historyDir = new URL("../../../artifacts/route-coverage/probe-history/", import.meta.url);
  const history = readdirSync(historyDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(new URL(name, historyDir), "utf8")) as LiveProbeRecord);
  const committed = validateLiveCoverage(JSON.parse(readFileSync(new URL("../data/jeju-live-coverage.json", import.meta.url), "utf8")));
  assert.deepEqual(committed, computeLiveCoverage(committedCatalog, history), "run: node --experimental-strip-types scripts/route-coverage/live-coverage.ts");
});

const STOPS: StopOnRoute[] = [
  { stopId: "S1", name: "합성1", sequence: 1, latitude: 33.4, longitude: 126.5 },
  { stopId: "S2", name: "합성2", sequence: 2, latitude: 33.41, longitude: 126.51 },
  { stopId: "S3", name: "합성3", sequence: 3, latitude: 33.42, longitude: 126.52 },
];

class NoBusProvider implements TransitProvider {
  async stops(_request: RouteRequest): Promise<StopOnRoute[]> { return STOPS.map((stop) => ({ ...stop })); }
  async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> { return []; }
}

test("a session on a never-observed route says so; any other session does not", async () => {
  const config = readTransitApiConfig({ TAGO_SERVICE_KEY: "synthetic-key" }, { nodeVersion: "v22.0.0" });
  const provider = new NoBusProvider();
  const coverage = computeLiveCoverage(catalog(), probes(12, 3, ["SYN-910-A"]));
  const handler = createTransitApiHandler({
    config,
    discovery: { async cities() { return []; }, async routes() { return []; } },
    provider,
    sessions: new JourneySessionCoordinator(provider, { automaticMatchingEnabled: false }),
    staticData: inMemoryStaticTransitData({ catalog: catalog() as TransitCatalog, liveCoverage: coverage }),
    log: () => {},
  });
  const create = (routeId: string) => handler(new Request("http://api.test/v1/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ routeId, cityCode: "39", boardingStopSequence: 1, destinationStopSequence: 3 }),
  }));

  const unobserved = await create("SYN-900-A");
  assert.equal(unobserved.status, 201);
  const body = await unobserved.json();
  assert.deepEqual(body.liveCoverage, { status: "never_observed", probes: 12, days: 3, since: coverage.neverObserved["900"]!.since });

  const read = await handler(new Request(`http://api.test/v1/sessions/${body.id}`));
  assert.equal((await read.json()).liveCoverage?.status, "never_observed", "every read carries it, not only the first answer");

  const observed = await (await create("SYN-910-A")).json();
  assert.equal(observed.liveCoverage, undefined);
});
