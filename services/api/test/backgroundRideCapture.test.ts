import test from "node:test";
import assert from "node:assert/strict";

import {
  BackgroundRideCaptureCoordinator,
  BackgroundRideCaptureError,
} from "../src/backgroundRideCapture.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import type { TransitProvider } from "../src/provider.ts";

const ROUTE = "JEB405244003";
const CITY = "39";
const VEHICLE = "제주79자1234";
const EPOCH = new Date(0).toISOString();

class FakeProvider implements TransitProvider {
  stopSequence = 27;
  vehiclePresent = true;
  vehicleCalls = 0;
  readonly stopsList: StopOnRoute[] = Array.from({ length: 13 }, (_, index) => ({
    stopId: `S${27 + index}`,
    name: `정류장 ${27 + index}`,
    sequence: 27 + index,
  }));

  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    return this.stopsList;
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    this.vehicleCalls += 1;
    if (!this.vehiclePresent) return [];
    return [{
      vehicleId: VEHICLE,
      routeId: request.routeId,
      observedAt: EPOCH,
      receivedAt: new Date(Date.UTC(2026, 8, 15, 10, 0, this.vehicleCalls)).toISOString(),
      timestampSource: "unavailable",
      stopId: `S${this.stopSequence}`,
      stopName: `정류장 ${this.stopSequence}`,
      stopSequence: this.stopSequence,
      latitude: 33.48 + this.vehicleCalls / 10000,
      longitude: 126.48,
      receiveType: "TAGO_SNAPSHOT",
    }];
  }
}

function harness() {
  const provider = new FakeProvider();
  let nowMs = Date.parse("2026-09-15T10:00:00.000Z");
  let scheduled: (() => void) | undefined;
  const coordinator = new BackgroundRideCaptureCoordinator(provider, {
    now: () => new Date(nowMs),
    schedule: (callback) => {
      scheduled = callback;
      return {} as ReturnType<typeof setTimeout>;
    },
    cancel: () => { scheduled = undefined; },
  });
  return {
    provider,
    coordinator,
    advance(ms: number) { nowMs += ms; },
    async runScheduled() {
      const callback = scheduled;
      scheduled = undefined;
      callback?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}

async function start(h: ReturnType<typeof harness>) {
  return h.coordinator.start({
    routeId: ROUTE,
    cityCode: CITY,
    boardedVehicleId: VEHICLE,
    boardingStopSequence: 27,
    destinationStopSequence: 39,
  });
}

test("background polling continues from the process-owned scheduler", async () => {
  const h = harness();
  const started = await start(h);
  assert.equal(started.phase, "active");
  assert.equal(started.snapshotCount, 1);
  assert.equal(started.trackedStopSequence, 27);

  h.provider.stopSequence = 28;
  h.advance(5_000);
  await h.runScheduled();

  const status = h.coordinator.status(started.sessionId);
  assert.equal(status.snapshotCount, 2);
  assert.equal(status.trackedStopSequence, 28);
  assert.equal(status.remainingStops, 11);
  assert.equal(h.provider.vehicleCalls, 2);
});

test("physical markers remain rider supplied and duplicate stops fail closed", async () => {
  const h = harness();
  const started = await start(h);
  h.advance(1_000);
  const at = "2026-09-15T10:00:01.000Z";
  const marked = h.coordinator.recordPassedStop(started.sessionId, 27, at);
  assert.equal(marked.markerCount, 2, "boarded + one physical passed_stop marker");

  assert.throws(
    () => h.coordinator.recordPassedStop(started.sessionId, 27, at),
    (error: unknown) => error instanceof BackgroundRideCaptureError && error.kind === "conflict",
  );

  const reopened = h.coordinator.recordPassedStop(started.sessionId, 27, at, true);
  assert.equal(reopened.markerCount, 3, "an explicit re-open can preserve a second physical event");
});

test("alight waits for provider arrival and returns only a sanitized report", async () => {
  const h = harness();
  const started = await start(h);

  for (const sequence of [28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38]) {
    h.provider.stopSequence = sequence;
    h.advance(5_000);
    await h.coordinator.pollNow(started.sessionId);
    if (sequence % 2 === 0) {
      h.coordinator.recordPassedStop(started.sessionId, sequence, new Date(Date.parse("2026-09-15T10:00:00.000Z") + (sequence - 27) * 5_000).toISOString());
    }
  }

  h.advance(1_000);
  const afterAlight = h.coordinator.alight(started.sessionId);
  assert.equal(afterAlight.phase, "post_alight");
  assert.ok((afterAlight.postAlightRemainingSeconds ?? 0) > 0);

  h.provider.stopSequence = 39;
  h.advance(5_000);
  const completed = await h.coordinator.pollNow(started.sessionId);
  assert.equal(completed.phase, "completed");
  assert.equal(completed.destinationObserved, true);
  assert.ok(completed.report);

  const encoded = JSON.stringify(completed);
  assert.equal(encoded.includes(VEHICLE), false, "status/report must never echo the raw vehicle identifier");
  assert.equal(completed.report?.tracked.present, true);
  assert.equal(completed.report?.tracked.arrivalDetectedAt !== undefined, true);
  assert.equal(completed.captureEngine, "railway-background");
  assert.equal(completed.report?.captureEngine, "railway-background");
});

test("post-alight capture closes after twenty seconds even if TAGO stays behind", async () => {
  const h = harness();
  const started = await start(h);
  h.provider.stopSequence = 30;
  h.advance(5_000);
  await h.coordinator.pollNow(started.sessionId);

  h.advance(1_000);
  assert.equal(h.coordinator.alight(started.sessionId).phase, "post_alight");

  h.advance(20_000);
  const completed = await h.coordinator.pollNow(started.sessionId);
  assert.equal(completed.phase, "completed");
  assert.equal(completed.destinationObserved, false);
  assert.ok(completed.report);
});

test("start refuses a vehicle that is not in the uncached live snapshot", async () => {
  const h = harness();
  h.provider.vehiclePresent = false;
  await assert.rejects(
    start(h),
    (error: unknown) => error instanceof BackgroundRideCaptureError && error.kind === "conflict",
  );
});


test("server-owned capture records browser hidden time without moving polling ownership", async () => {
  const h = harness();
  const started = await start(h);

  h.advance(1_000);
  h.coordinator.recordEvent(started.sessionId, "hidden", "2026-09-15T10:00:01.000Z");
  h.advance(65_000);
  await h.coordinator.pollNow(started.sessionId);
  h.coordinator.recordEvent(started.sessionId, "visible", "2026-09-15T10:01:06.000Z");

  h.advance(1_000);
  h.coordinator.alight(started.sessionId);
  h.advance(20_000);
  const completed = await h.coordinator.pollNow(started.sessionId);

  assert.equal(completed.phase, "completed");
  assert.equal(completed.report?.captureEngine, "railway-background");
  assert.equal(completed.report?.lifecycle.hiddenPeriods, 1);
  assert.equal(completed.report?.lifecycle.hiddenSeconds, 65);
});
