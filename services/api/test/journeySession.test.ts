import test from "node:test";
import assert from "node:assert/strict";
import { JourneySessionCoordinator } from "../src/journeySession.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import type { TransitProvider } from "../src/provider.ts";

const routeId = "route-365";
const standardRegionCode = "50110";
const stops: StopOnRoute[] = [
  { stopId: "S1", name: "Boarding", sequence: 1, latitude: 33.5000, longitude: 126.5000 },
  { stopId: "S2", name: "Second", sequence: 2, latitude: 33.5010, longitude: 126.5000 },
  { stopId: "S3", name: "Third", sequence: 3, latitude: 33.5020, longitude: 126.5000 },
  { stopId: "S4", name: "Fourth", sequence: 4, latitude: 33.5030, longitude: 126.5000 },
  { stopId: "S5", name: "Destination", sequence: 5, latitude: 33.5040, longitude: 126.5000 },
];

class MutableProvider implements TransitProvider {
  vehiclesValue: VehicleObservation[] = [];

  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    return stops.map((stop) => ({ ...stop }));
  }

  async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> {
    return this.vehiclesValue.map((vehicle) => ({ ...vehicle }));
  }
}

function sessionInput() {
  return {
    routeId,
    standardRegionCode,
    boardingStopSequence: 1,
    destinationStopSequence: 5,
    directionCode: "1",
  };
}

test("automatically matches the fresh vehicle closest to the boarding stop", async () => {
  const provider = new MutableProvider();
  const now = new Date("2026-09-10T05:00:00Z");
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", latitude: 33.5001, longitude: 126.5000 },
    { vehicleId: "BUS-B", routeId, observedAt: now.toISOString(), directionCode: "1", latitude: 33.5200, longitude: 126.5000 },
  ];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "session-1" });
  const view = await sessions.create(sessionInput());

  assert.equal(view.selectedVehicleId, "BUS-A");
  assert.equal(view.selectionMode, "automatic");
  assert.equal(view.state, "tracking");
  assert.equal(view.progress?.currentStopSequence, 1);
  assert.equal(view.progress?.source, "near_stop_estimate");
  assert.equal(view.progress?.remainingStops, 4);
});

test("withholds automatic selection when candidates are too close and accepts explicit confirmation", async () => {
  const provider = new MutableProvider();
  const now = new Date("2026-09-10T05:00:00Z");
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", latitude: 33.5001, longitude: 126.5000 },
    { vehicleId: "BUS-B", routeId, observedAt: now.toISOString(), directionCode: "1", latitude: 33.5002, longitude: 126.5000 },
  ];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "session-2" });
  const initial = await sessions.create(sessionInput());
  assert.equal(initial.state, "confirmation_required");
  assert.equal(initial.selectedVehicleId, undefined);
  assert.equal(initial.candidates?.length, 2);

  const confirmed = await sessions.confirm(initial.id, { vehicleId: "BUS-B" });
  assert.equal(confirmed.selectedVehicleId, "BUS-B");
  assert.equal(confirmed.selectionMode, "explicit");
  assert.equal(confirmed.state, "tracking");
});

test("never silently switches vehicles and retains monotonic stop progress", async () => {
  const provider = new MutableProvider();
  let now = new Date("2026-09-10T05:00:00Z");
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 3 },
  ];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "session-3" });
  const initial = await sessions.create(sessionInput());
  assert.equal(initial.progress?.currentStopSequence, 3);
  assert.equal(initial.progress?.remainingStops, 2);

  now = new Date("2026-09-10T05:00:20Z");
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 2 },
    { vehicleId: "BUS-B", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 4 },
  ];
  const regressed = await sessions.refresh(initial.id);
  assert.equal(regressed.selectedVehicleId, "BUS-A");
  assert.equal(regressed.state, "degraded");
  assert.equal(regressed.progress?.currentStopSequence, 3);
  assert.equal(regressed.progress?.source, "retained_last_known");
});

test("retains a missing selected vehicle briefly, then marks the session lost", async () => {
  const provider = new MutableProvider();
  let now = new Date("2026-09-10T05:00:00Z");
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 2 },
  ];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "session-4" });
  const initial = await sessions.create(sessionInput());
  assert.equal(initial.state, "tracking");

  provider.vehiclesValue = [];
  now = new Date("2026-09-10T05:01:00Z");
  const degraded = await sessions.refresh(initial.id);
  assert.equal(degraded.state, "degraded");
  assert.equal(degraded.progress?.source, "retained_last_known");

  now = new Date("2026-09-10T05:03:00Z");
  const lost = await sessions.refresh(initial.id);
  assert.equal(lost.state, "lost");
  assert.equal(lost.selectedVehicleId, "BUS-A");
});

test("rejects a destination that precedes the boarding stop", async () => {
  const provider = new MutableProvider();
  const sessions = new JourneySessionCoordinator(provider);
  await assert.rejects(
    sessions.create({ ...sessionInput(), boardingStopSequence: 4, destinationStopSequence: 2 }),
    /destination must be after the boarding stop/,
  );
});
