/**
 * Issue #80: what a rider is shown before they confirm a bus follows the
 * readiness the release gate demonstrated, in code rather than in wording.
 *
 * `READY_FOR_SHADOW` means riders see nothing from the matcher. The session's
 * `vehicleChoice` is therefore built from the latest provider read alone, and
 * only `READY_FOR_CONFIRMATION_ASSISTED` lets the matcher's list be presented
 * as a suggestion. Neither level selects a bus: only `confirm` does. The Swift
 * side of the same rule runs on the generated payloads
 * (`fixtures/journey/session-views-v1.json`, `LiveSessionInterpreterTests.swift`).
 *
 * Every route, stop and vehicle here is SYNTHETIC.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import {
  JourneySessionCoordinator,
  RIDER_VISIBLE_VEHICLE_LIMIT,
  riderVisibleVehicles,
  vehicleChoicePresentation,
} from "../src/journeySession.ts";
import { READINESS_LEVELS } from "../src/matcherSafetyGate.ts";
import { DEMONSTRATED_MATCHING_READINESS } from "../src/matchingReadiness.ts";
import type { TransitProvider } from "../src/provider.ts";

const routeId = "SYN-ROUTE-80";
const stops: StopOnRoute[] = Array.from({ length: 14 }, (_, index) => ({
  stopId: `SYN-STOP-${index + 1}`,
  name: `합성 정류장 ${index + 1}`,
  sequence: index + 1,
  latitude: 33.45 + index * 0.002,
  longitude: 126.3 + index * 0.002,
}));

class ScriptedProvider implements TransitProvider {
  rows: VehicleObservation[] = [];
  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    return stops.map((stop) => ({ ...stop }));
  }
  async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> {
    return this.rows.map((row) => ({ ...row }));
  }
}

function row(vehicleId: string, at: Date, sequence: number | undefined, route = routeId): VehicleObservation {
  return {
    vehicleId,
    routeId: route,
    observedAt: new Date(0).toISOString(),
    receivedAt: at.toISOString(),
    timestampSource: "unavailable",
    ...(sequence === undefined ? {} : { stopSequence: sequence }),
  };
}

const input = { routeId, cityCode: "999", boardingStopSequence: 10, destinationStopSequence: 13 };
const session = { routeId, stops, boardingStop: stops[9]!, riderState: "waiting_at_stop" as const };

test("a matcher suggestion needs confirmation-assisted readiness, and the demonstrated level has none", () => {
  assert.deepEqual(
    READINESS_LEVELS.map((level) => [level, vehicleChoicePresentation(level)]),
    [
      ["NOT_READY", "rider_identifies"],
      ["READY_FOR_SHADOW", "rider_identifies"],
      ["READY_FOR_CONFIRMATION_ASSISTED", "matcher_suggestion"],
      ["READY_FOR_BOUNDED_AUTOMATION", "matcher_suggestion"],
      ["READY_FOR_AUTOMATIC_MATCHING", "matcher_suggestion"],
    ],
  );
  // Raising this is a reviewed change with new evidence (matchingReadiness.test.ts).
  assert.equal(vehicleChoicePresentation(DEMONSTRATED_MATCHING_READINESS), "rider_identifies");
});

test("in production posture a session asks the rider to identify the bus and selects nothing", async () => {
  const provider = new ScriptedProvider();
  const now = new Date("2026-10-02T06:00:00.000Z");
  provider.rows = [row("SYN70가0001", now, 8), row("SYN70가0002", now, 3)];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "syn-80-a" });
  const view = await sessions.create(input);
  assert.equal(view.vehicleChoice?.presentation, "rider_identifies");
  assert.equal(view.vehicleChoice?.readiness, DEMONSTRATED_MATCHING_READINESS);
  assert.deepEqual(view.vehicleChoice?.vehicles, [
    { vehicleId: "SYN70가0001", stopsAway: 2 },
    // Seven stops out is beyond the matcher's approach window; the rider still sees it.
    { vehicleId: "SYN70가0002", stopsAway: 7 },
  ]);
  assert.equal(view.selectedVehicleId, undefined);
});

test("the rider's list is the snapshot's alone: the matcher's session memory cannot reorder or filter it", async () => {
  const now = new Date("2026-10-02T07:00:00.000Z");
  const last = [row("SYN70가0011", now, 9), row("SYN70가0012", now, 7), row("SYN70가0013", now, 2)];

  const fresh = new ScriptedProvider();
  fresh.rows = last;
  const first = await new JourneySessionCoordinator(fresh, { now: () => now, idFactory: () => "syn-80-fresh" }).create(input);

  // The same final snapshot after a history that gives the matcher passage
  // memory, cadence evidence and possibly a different would-be pick.
  const remembered = new ScriptedProvider();
  let clock = new Date(now.getTime() - 60_000);
  const sessions = new JourneySessionCoordinator(remembered, { now: () => clock, idFactory: () => "syn-80-history" });
  remembered.rows = [row("SYN70가0011", clock, 6), row("SYN70가0012", clock, 5), row("SYN70가0014", clock, 10)];
  await sessions.create(input);
  for (const [offset, a, b] of [[20_000, 7, 6], [40_000, 8, 6]] as const) {
    clock = new Date(now.getTime() - 60_000 + offset);
    remembered.rows = [row("SYN70가0011", clock, a), row("SYN70가0012", clock, b), row("SYN70가0013", clock, 1)];
    await sessions.refresh("syn-80-history");
  }
  clock = now;
  remembered.rows = last;
  const second = await sessions.refresh("syn-80-history");

  assert.deepEqual(second.vehicleChoice, first.vehicleChoice);
  assert.deepEqual(first.vehicleChoice?.vehicles.map((vehicle) => vehicle.vehicleId), ["SYN70가0011", "SYN70가0012", "SYN70가0013"]);
});

test("a waiting rider is never shown a bus that has left the stop; one at it comes first", () => {
  const now = new Date("2026-10-02T08:00:00.000Z");
  const vehicles = [
    row("SYN70가0021", now, 12), // two past: departed under every reading
    row("SYN70가0022", now, 10), // at the stop
    row("SYN70가0023", now, 11), // one past: the reading boundary, position unknown
    row("SYN70가0024", now, 6),
    row("SYN70가0025", now, 6, "SYN-OTHER-ROUTE"),
  ];
  assert.deepEqual(riderVisibleVehicles(vehicles, session), [
    { vehicleId: "SYN70가0022", stopsAway: 0 },
    { vehicleId: "SYN70가0024", stopsAway: 4 },
    { vehicleId: "SYN70가0023" },
  ]);
  // After a withdrawal the rider may be aboard the bus that reached the stop first.
  assert.deepEqual(riderVisibleVehicles(vehicles, session, { includeJustDeparted: true }).map((vehicle) => vehicle.vehicleId), [
    "SYN70가0022",
    "SYN70가0021",
    "SYN70가0024",
    "SYN70가0023",
  ]);
});

test("a bus with no stop, or listed twice, is shown last with no count", () => {
  const now = new Date("2026-10-02T09:00:00.000Z");
  const vehicles = [
    row("SYN70가0031", now, undefined),
    row("SYN70가0032", now, 8),
    row("SYN70가0032", now, 4),
    row("SYN70가0033", now, 9),
  ];
  assert.deepEqual(riderVisibleVehicles(vehicles, session), [
    { vehicleId: "SYN70가0033", stopsAway: 1 },
    { vehicleId: "SYN70가0031" },
    { vehicleId: "SYN70가0032" },
  ]);
});

test("the list is bounded, nearest first", () => {
  const now = new Date("2026-10-02T10:00:00.000Z");
  const vehicles = Array.from({ length: 12 }, (_, index) => row(`SYN70가01${String(index).padStart(2, "0")}`, now, 1 + (index % 9)));
  const visible = riderVisibleVehicles(vehicles, session);
  assert.equal(visible.length, RIDER_VISIBLE_VEHICLE_LIMIT);
  const distances = visible.map((vehicle) => vehicle.stopsAway!);
  assert.deepEqual(distances, [...distances].sort((left, right) => left - right));
  assert.equal(distances[0], 1);
});

test("confirmation-assisted readiness switches the presentation and still selects nothing", async () => {
  const provider = new ScriptedProvider();
  const now = new Date("2026-10-02T11:00:00.000Z");
  provider.rows = [row("SYN70가0041", now, 8)];
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "syn-80-ca",
    matchingReadiness: "READY_FOR_CONFIRMATION_ASSISTED",
  });
  const view = await sessions.create(input);
  assert.equal(view.vehicleChoice?.presentation, "matcher_suggestion");
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.matchingMode, "shadow");
  const confirmed = await sessions.confirm("syn-80-ca", { vehicleId: "SYN70가0041" });
  assert.equal(confirmed.selectionMode, "explicit");
  assert.equal(confirmed.vehicleChoice, undefined, "a selected bus needs no choice");
});

test("a rider may confirm any bus of the snapshot, including one only the raw list shows", async () => {
  const provider = new ScriptedProvider();
  const now = new Date("2026-10-02T12:00:00.000Z");
  provider.rows = [row("SYN70가0051", now, 3)];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "syn-80-far" });
  const view = await sessions.create(input);
  assert.deepEqual(view.candidates?.filter((candidate) => candidate.zone === "approaching"), []);
  assert.deepEqual(view.vehicleChoice?.vehicles, [{ vehicleId: "SYN70가0051", stopsAway: 7 }]);
  const confirmed = await sessions.confirm("syn-80-far", { vehicleId: "SYN70가0051" });
  assert.equal(confirmed.selectedVehicleId, "SYN70가0051");
});
