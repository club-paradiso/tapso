/**
 * Synthetic Railway background rides for tests. Invented vehicle numbers, an
 * invented route, and a coordinate grid that is not a place.
 *
 * Not a test file: the runner only picks up `*.test.ts`.
 */

import assert from "node:assert/strict";

import { BackgroundRideCaptureCoordinator } from "../src/backgroundRideCapture.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";

export const TOKEN = "synthetic-operator-token-0123456789";
export const CITY = "999";
export const BOARDED = "제주79자9999";
export const DECOY = "제주79자8888";
const EPOCH = new Date(0).toISOString();

export const stops: StopOnRoute[] = Array.from({ length: 8 }, (_, index) => ({
  stopId: `SYN-${index + 1}`,
  name: `Synthetic ${index + 1}`,
  sequence: index + 1,
  latitude: 33.5 + index * 0.01,
  longitude: 126.5,
}));

/**
 * `correct`: the boarded bus leaves the boarding stop (2) and advances one stop
 * per poll, so the matcher commits to it. A decoy idles far away.
 *
 * `wrong`: a decoy leaves the boarding stop while the boarded bus sits past the
 * destination, so the matcher commits to the decoy.
 */
export type RideKind = "correct" | "wrong";

export function railwayHarness(kinds: Record<string, RideKind> = {}) {
  let nowMs = Date.parse("2026-09-23T09:00:00.000Z");
  const now = () => new Date(nowMs);
  const calls = new Map<string, number>();
  const observation = (routeId: string, vehicleId: string, stopSequence: number): VehicleObservation => ({
    vehicleId,
    routeId,
    observedAt: EPOCH,
    receivedAt: now().toISOString(),
    timestampSource: "unavailable",
    stopId: `SYN-${stopSequence}`,
    stopSequence,
    latitude: stops[stopSequence - 1]!.latitude,
    longitude: stops[stopSequence - 1]!.longitude,
    directionCode: "1",
    receiveType: "TAGO_SNAPSHOT",
  });
  const provider = {
    async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
      return stops;
    },
    async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
      const call = calls.get(request.routeId) ?? 0;
      calls.set(request.routeId, call + 1);
      const moving = Math.min(2 + call, stops.length);
      return kinds[request.routeId] === "wrong"
        ? [observation(request.routeId, DECOY, moving), observation(request.routeId, BOARDED, 7)]
        : [observation(request.routeId, BOARDED, moving), observation(request.routeId, DECOY, stops.length)];
    },
  };
  const coordinator = new BackgroundRideCaptureCoordinator(provider, {
    now,
    schedule: () => ({}) as ReturnType<typeof setTimeout>,
    cancel: () => {},
  });

  async function start(routeId: string) {
    return coordinator.start({
      routeId,
      cityCode: CITY,
      boardedVehicleId: BOARDED,
      boardingStopSequence: 2,
      destinationStopSequence: 6,
    });
  }

  /** Start, poll four times, mark passed stops, alight: a completed session. */
  async function completedRide(routeId = "SYN-ROUTE-A") {
    const started = await start(routeId);
    const id = started.sessionId;
    for (let poll = 0; poll < 4; poll += 1) {
      nowMs += 5_000;
      await coordinator.pollNow(id);
      const reached = coordinator.status(id).trackedStopSequence;
      if (reached !== undefined && reached > 2 && reached < 6) coordinator.recordPassedStop(id, reached);
    }
    const done = coordinator.alight(id);
    assert.equal(done.phase, "completed");
    return done;
  }

  return { coordinator, start, completedRide, advance(ms: number) { nowMs += ms; } };
}
