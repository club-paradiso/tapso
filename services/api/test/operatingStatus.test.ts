/**
 * GET /v1/operating-status: the committed real catalog, timetable bundle and
 * holiday calendar, with SYNTHETIC vehicles from a stubbed provider (invented
 * vehicle IDs; positions taken from the catalog's own stop coordinates).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readTransitApiConfig } from "../src/apiConfig.ts";
import { createTransitApiHandler } from "../src/apiRouter.ts";
import { CachedTransitProvider } from "../src/cachedTransitProvider.ts";
import type { RouteRequest, VehicleObservation } from "../src/domain.ts";
import { validateTimetableBundle } from "../src/officialTimetable.ts";
import { validateHolidayCalendar } from "../src/serviceDay.ts";
import { inMemoryStaticTransitData } from "../src/staticTransitData.ts";
import { routeStops, validateCatalog } from "../src/transitCatalog.ts";

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const catalog = validateCatalog(read("../data/jeju-transit-catalog.json"));
const timetables = validateTimetableBundle(read("../data/jeju-timetables.json")).bundle;
const holidays = validateHolidayCalendar(read("../data/kr-public-holidays.json"));

function handler(vehicles: (request: RouteRequest) => VehicleObservation[] | Promise<VehicleObservation[]>, now: Date | (() => Date)) {
  const clock = typeof now === "function" ? now : () => now;
  const calls: string[] = [];
  const h = createTransitApiHandler({
    config: readTransitApiConfig({}, { nodeVersion: "v22.0.0" }),
    provider: new CachedTransitProvider({
      async stops() { return []; },
      async vehicles(request) { calls.push(request.routeId); return vehicles(request); },
    }, { stopTtlMs: 1_000, vehicleTtlMs: 20_000 }),
    discovery: { async cities() { return []; }, async routes() { return []; } },
    log: () => {},
    now: clock,
    staticData: inMemoryStaticTransitData({ catalog, timetables, holidays }),
  });
  return { h, calls };
}

const get = async (h: ReturnType<typeof handler>["h"], path: string) => h(new Request(`http://transit.invalid${path}`));

/** A SYNTHETIC vehicle placed exactly at the variant's stop with that sequence. */
function vehicleAt(routeId: string, sequence: number, id: string, now: Date): VehicleObservation {
  const variant = catalog.routes.find((route) => route.routeId === routeId)!;
  const stop = routeStops(catalog, variant).find((candidate) => candidate.sequence === sequence)!;
  return { vehicleId: id, routeId, observedAt: "1970-01-01T00:00:00.000Z", receivedAt: now.toISOString(), timestampSource: "unavailable", stopId: stop.stopId, stopSequence: sequence, latitude: stop.latitude, longitude: stop.longitude };
}

const variants365 = catalog.routes.filter((route) => route.routeNo === "365").map((route) => route.routeId);

test("a clean reported vehicle on any variant: vehicle_reported, scoped to the route number, never 'operating'", async () => {
  const now = new Date("2026-11-09T12:00:00Z"); // Monday 21:00 KST
  const { h, calls } = handler((request) => (request.routeId === variants365[0] ? [vehicleAt(request.routeId, 3, "SYN-V1", now)] : []), now);
  const response = await get(h, "/v1/operating-status?routeNo=365");
  assert.equal(response.status, 200);
  const { item } = await response.json();
  assert.equal(item.scope, "route_number");
  assert.equal(item.assessment.claim, "vehicle_reported");
  assert.equal(item.assessment.claimsOperating, false);
  assert.equal(item.live.variants, variants365.length);
  assert.equal(item.live.read, variants365.length);
  assert.equal(item.live.feedQuality.suspect, 0);
  assert.deepEqual(calls.sort(), [...variants365].sort(), "one read per variant");
  const liveRecord = item.assessment.evidence.find((record: { kind: string }) => record.kind === "live_vehicle_position");
  assert.equal(liveRecord.observedAt, null, "receipt is never observation time");
});

test("a second request inside the cache window makes no provider call", async () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const { h, calls } = handler(() => [], now);
  await get(h, "/v1/operating-status?routeNo=365");
  const first = calls.length;
  await get(h, "/v1/operating-status?routeNo=365");
  assert.equal(calls.length, first);
});

test("a vehicle whose row contradicts the stop list is suspect, and only suspects means unknown", async () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const { h } = handler((request) => (request.routeId === variants365[0] ? [{ ...vehicleAt(request.routeId, 3, "SYN-V1", now), stopSequence: 999 }] : []), now);
  const { item } = await (await get(h, "/v1/operating-status?routeNo=365")).json();
  assert.equal(item.live.feedQuality.suspect, 1);
  assert.equal(item.live.feedQuality.byIssue.sequence_out_of_range, 1);
  assert.equal(item.assessment.claim, "unknown");
  assert.ok(item.assessment.reasons.includes("all_reported_vehicles_suspect"));
});

test("no vehicle and a provider failure on one variant: live unavailable, never 'no bus'", async () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const { h } = handler((request) => {
    if (request.routeId === variants365[1]) throw new Error("SYNTHETIC upstream failure");
    return [];
  }, now);
  const { item } = await (await get(h, "/v1/operating-status?routeNo=365")).json();
  assert.equal(item.live.failed, 1);
  assert.notEqual(item.assessment.claim, "no_scheduled_service_remaining");
  assert.equal(item.assessment.evidence.find((record: { kind: string }) => record.kind === "live_vehicle_position").label, "UNAVAILABLE");
});

test("a route number with more variants than the cost bound is not read live", async () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const { h, calls } = handler(() => [], now);
  const { item } = await (await get(h, "/v1/operating-status?routeNo=202")).json();
  assert.equal(calls.length, 0);
  assert.equal(item.live.read, 0);
  assert.match(item.assessment.evidence.find((record: { kind: string }) => record.kind === "live_vehicle_position").provenance, /more than 12 variants/);
});

test("validation and missing data", async () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const { h } = handler(() => [], now);
  assert.equal((await get(h, "/v1/operating-status")).status, 400);
  assert.equal((await get(h, "/v1/operating-status?routeNo=abc")).status, 400);
  const unknown = await (await get(h, "/v1/operating-status?routeNo=9999")).json();
  assert.equal(unknown.item.assessment.claim, "unknown");
});

test("a vehicle fetched during the request is current: evaluation happens after the live reads complete", async () => {
  // The provider stamps receivedAt when its network read finishes, after the request started.
  let t = Date.parse("2026-11-09T12:00:00Z");
  const { h } = handler((request) => {
    t += 100;
    return request.routeId === variants365[0] ? [vehicleAt(request.routeId, 3, "SYN-V1", new Date(t))] : [];
  }, () => new Date(t));
  const { item } = await (await get(h, "/v1/operating-status?routeNo=365")).json();
  assert.equal(item.assessment.claim, "vehicle_reported");
  assert.ok(Date.parse(item.evaluatedAt) >= Date.parse(item.assessment.evidence.find((record: { kind: string }) => record.kind === "live_vehicle_position").receivedAt));
});
