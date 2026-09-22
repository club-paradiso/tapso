import test from "node:test";
import assert from "node:assert/strict";
import { JourneySessionCoordinator } from "../src/journeySession.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import type { TransitProvider } from "../src/provider.ts";
import {
  MemoryJourneySessionStore,
  SessionStoreError,
  type JourneySessionStore,
} from "../src/sessionStore.ts";

const routeId = "route-365";
const cityCode = "999";
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
    cityCode,
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
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "session-1",
    automaticMatchingEnabled: true,
  });
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
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "session-2",
    // Automatic mode on purpose: this test is about the matcher refusing a
    // close call, not about the rollout gate refusing everything.
    automaticMatchingEnabled: true,
  });
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
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "session-3",
    automaticMatchingEnabled: true,
  });
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
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "session-4",
    automaticMatchingEnabled: true,
  });
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

test("unknown TAGO source time cannot become fresh through receipt time", async () => {
  const provider = new MutableProvider();
  const now = new Date("2026-09-10T05:00:00Z");
  provider.vehiclesValue = [{
    vehicleId: "SYNTHETIC_TAGO_BUS", routeId, observedAt: now.toISOString(),
    receivedAt: now.toISOString(), timestampSource: "unavailable", directionCode: "1", stopSequence: 1,
  }];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "synthetic-tago-session" });
  const view = await sessions.create(sessionInput());
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.progress, undefined);
});


test("TAGO cadence evidence unlocks automatic matching only after repeated changing snapshots", async () => {
  const provider = new MutableProvider();
  let now = new Date("2026-09-22T03:00:00Z");
  const tago = (receivedAt: Date, stopSequence: number, latitude: number): VehicleObservation => ({
    vehicleId: "TAGO-A",
    routeId,
    observedAt: new Date(0).toISOString(),
    receivedAt: receivedAt.toISOString(),
    timestampSource: "unavailable",
    directionCode: "1",
    stopSequence,
    latitude,
    longitude: 126.5000,
  });

  provider.vehiclesValue = [tago(now, 1, 33.5000)];
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "tago-cadence-session",
    automaticMatchingEnabled: true,
  });

  const initial = await sessions.create(sessionInput());
  assert.equal(initial.state, "awaiting_match");
  assert.equal(initial.selectedVehicleId, undefined);

  now = new Date("2026-09-22T03:00:05Z");
  provider.vehiclesValue = [tago(now, 1, 33.5000)];
  const second = await sessions.refresh(initial.id);
  assert.equal(second.state, "awaiting_match");
  assert.equal(second.selectedVehicleId, undefined);

  now = new Date("2026-09-22T03:00:10Z");
  provider.vehiclesValue = [tago(now, 1, 33.5004)];
  const third = await sessions.refresh(initial.id);
  assert.equal(third.selectedVehicleId, "TAGO-A");
  assert.equal(third.selectionMode, "automatic");
  assert.equal(third.state, "tracking");
  assert.equal(third.progress?.currentStopSequence, 1);
  // The ordering instant is TAPSO's own receipt, and the field says so in its
  // own name rather than leaving a reader to assume a provider time.
  assert.equal(third.progress?.evidenceAtIs, "tapso_server_receipt");
  assert.equal(third.progress?.evidenceAt, now.toISOString());
  assert.equal(third.progress?.observedAt, new Date(0).toISOString(), "provider time remains the epoch sentinel");
});

test("fresh receipt timestamps alone never unlock TAGO automatic matching", async () => {
  const provider = new MutableProvider();
  let now = new Date("2026-09-22T04:00:00Z");
  const unchanged = (): VehicleObservation => ({
    vehicleId: "TAGO-STATIONARY",
    routeId,
    observedAt: new Date(0).toISOString(),
    receivedAt: now.toISOString(),
    timestampSource: "unavailable",
    directionCode: "1",
    stopSequence: 1,
    latitude: 33.5000,
    longitude: 126.5000,
  });
  provider.vehiclesValue = [unchanged()];
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "tago-unchanged-session",
  });
  const initial = await sessions.create(sessionInput());

  for (const seconds of [5, 10, 15, 20]) {
    now = new Date(Date.parse("2026-09-22T04:00:00Z") + seconds * 1_000);
    provider.vehiclesValue = [unchanged()];
    const view = await sessions.refresh(initial.id);
    assert.equal(view.selectedVehicleId, undefined);
    assert.equal(view.state, "awaiting_match");
  }
});

/* ------------------------------------------------- automatic-matching gate */

/**
 * Helper for the gate tests: a TAGO row, which is the only shape production
 * ever sees. `observedAt` is the epoch sentinel because TAGO publishes no
 * observation time; `receivedAt` is TAPSO's own receipt and nothing more.
 */
function tagoRow(
  vehicleId: string,
  receivedAt: Date,
  stopSequence: number,
  latitude: number,
): VehicleObservation {
  return {
    vehicleId,
    routeId,
    observedAt: new Date(0).toISOString(),
    receivedAt: receivedAt.toISOString(),
    timestampSource: "unavailable",
    directionCode: "1",
    stopSequence,
    latitude,
    longitude: 126.5000,
  };
}

test("automatic matching is off unless a caller opts in", async () => {
  const provider = new MutableProvider();
  const now = new Date("2026-09-22T05:00:00Z");
  // One unambiguous winner with a provider timestamp: the easiest possible
  // match. The default coordinator still refuses to make it.
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", latitude: 33.5001, longitude: 126.5000 },
  ];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "gate-default" });

  assert.equal(sessions.matchingMode, "shadow");
  const view = await sessions.create(sessionInput());
  assert.equal(view.matchingMode, "shadow");
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.selectionMode, undefined);
  assert.equal(view.progress, undefined);
  assert.equal(view.state, "confirmation_required");
});

test("shadow mode publishes the ranking and the cadence evidence it refused to act on", async () => {
  const provider = new MutableProvider();
  let now = new Date("2026-09-22T06:00:00Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 1, 33.5000)];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "shadow-evidence" });

  const first = await sessions.create(sessionInput());
  // Not enough samples yet, so the cadence surrogate is `unknown` and the
  // candidate is rejected — shadow or not.
  assert.equal(first.sourceFreshness?.["TAGO-A"]?.state, "unknown");
  assert.equal(first.shadowSelection?.status, "unavailable");

  now = new Date("2026-09-22T06:00:05Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 1, 33.5000)];
  await sessions.refresh(first.id);

  now = new Date("2026-09-22T06:00:10Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 1, 33.5004)];
  const third = await sessions.refresh(first.id);

  // The cadence surrogate is now satisfied and the matcher would have picked
  // this vehicle. Shadow mode says so out loud and still does not select.
  assert.equal(third.sourceFreshness?.["TAGO-A"]?.state, "fresh");
  assert.ok((third.sourceFreshness?.["TAGO-A"]?.contentChangeCount ?? 0) > 0);
  assert.equal(third.shadowSelection?.status, "matched");
  assert.equal(third.shadowSelection?.wouldSelectVehicleId, "TAGO-A");
  assert.equal(third.selectedVehicleId, undefined, "shadow mode never assigns a vehicle");
  assert.equal(third.selectionMode, undefined);
  assert.equal(third.state, "confirmation_required");
  assert.ok((third.candidates?.length ?? 0) > 0, "candidates are still published for the rider");
});

test("explicit confirmation in shadow mode tracks, but invents no source freshness", async () => {
  const provider = new MutableProvider();
  let now = new Date("2026-09-22T07:00:00Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 1, 33.5000)];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "shadow-confirm" });
  const created = await sessions.create(sessionInput());

  // Confirming with only one receipt on file must not manufacture cadence.
  const early = await sessions.confirm(created.id, { vehicleId: "TAGO-A" });
  assert.equal(early.selectedVehicleId, "TAGO-A");
  assert.equal(early.selectionMode, "explicit");
  assert.equal(early.state, "degraded");
  assert.equal(early.progress, undefined, "a confirmation is not evidence of freshness");
  assert.match(early.explanation, /cadence evidence/);

  // Once real changing receipts exist, the same confirmed vehicle tracks.
  now = new Date("2026-09-22T07:00:05Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 1, 33.5000)];
  await sessions.refresh(created.id);
  now = new Date("2026-09-22T07:00:10Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 2, 33.5010)];
  const tracking = await sessions.refresh(created.id);

  assert.equal(tracking.state, "tracking");
  assert.equal(tracking.selectionMode, "explicit", "confirmation never becomes an automatic selection");
  assert.equal(tracking.matchingMode, "shadow");
  assert.equal(tracking.progress?.observedAt, new Date(0).toISOString());
  assert.equal(tracking.progress?.evidenceAtIs, "tapso_server_receipt");
});

/* ------------------------------------------ transient provider degradation */

class FlakyProvider implements TransitProvider {
  vehiclesValue: VehicleObservation[] = [];
  failuresRemaining = 0;
  vehicleCalls = 0;

  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    return stops.map((stop) => ({ ...stop }));
  }

  async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> {
    this.vehicleCalls += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      // The exact shape production has been returning 502 on.
      throw new Error("TAGO payload has no body object");
    }
    return this.vehiclesValue.map((vehicle) => ({ ...vehicle }));
  }
}

test("a transient provider failure degrades without corrupting cadence or progress", async () => {
  const provider = new FlakyProvider();
  let now = new Date("2026-09-22T08:00:00Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 2, 33.5010)];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "flaky-session" });
  const created = await sessions.create(sessionInput());
  await sessions.confirm(created.id, { vehicleId: "TAGO-A" });

  now = new Date("2026-09-22T08:00:05Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 2, 33.5010)];
  await sessions.refresh(created.id);
  now = new Date("2026-09-22T08:00:10Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 3, 33.5020)];
  const tracking = await sessions.refresh(created.id);
  assert.equal(tracking.state, "tracking");
  assert.equal(tracking.progress?.currentStopSequence, 3);

  // One failed read.
  now = new Date("2026-09-22T08:00:15Z");
  provider.failuresRemaining = 1;
  const degraded = await sessions.refresh(created.id);
  assert.equal(degraded.state, "degraded");
  assert.equal(degraded.providerRead?.state, "failed");
  assert.equal(degraded.providerRead?.consecutiveFailures, 1);
  assert.equal(degraded.selectedVehicleId, "TAGO-A", "a failed read never rematches");
  assert.equal(degraded.progress?.currentStopSequence, 3, "progress never moves backward on a failure");
  assert.equal(degraded.progress?.source, "retained_last_known");
  assert.equal(degraded.sourceFreshness, undefined, "a failure produces no freshness evidence");
  assert.equal(degraded.progress?.observedAt, new Date(0).toISOString(), "no provider timestamp is manufactured");

  // The next successful read resumes from the retained state with its cadence
  // history intact: one failure did not erase the receipts before it.
  now = new Date("2026-09-22T08:00:20Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 4, 33.5030)];
  const resumed = await sessions.refresh(created.id);
  assert.equal(resumed.state, "tracking");
  assert.equal(resumed.progress?.currentStopSequence, 4);
  assert.ok((resumed.sourceFreshness?.["TAGO-A"]?.sampleCount ?? 0) >= 3, "pre-failure receipts survived");
  assert.equal(resumed.sourceFreshness?.["TAGO-A"]?.state, "fresh");
});

test("a persistent provider failure is reported, not absorbed forever", async () => {
  const provider = new FlakyProvider();
  const now = new Date("2026-09-22T09:00:00Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 2, 33.5010)];
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "dead-provider",
    maxConsecutiveProviderFailures: 2,
  });
  const created = await sessions.create(sessionInput());

  provider.failuresRemaining = 10;
  assert.equal((await sessions.refresh(created.id)).providerRead?.consecutiveFailures, 1);
  assert.equal((await sessions.refresh(created.id)).providerRead?.consecutiveFailures, 2);
  await assert.rejects(sessions.refresh(created.id), /TAGO payload has no body object/);
});

test("a provider failure during create is never answered as an empty healthy session", async () => {
  const provider = new FlakyProvider();
  provider.failuresRemaining = 1;
  const sessions = new JourneySessionCoordinator(provider, { idFactory: () => "create-failure" });
  await assert.rejects(sessions.create(sessionInput()), /TAGO payload has no body object/);
});

test("a confirmation is never answered against a snapshot that failed to arrive", async () => {
  const provider = new FlakyProvider();
  const now = new Date("2026-09-22T10:00:00Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 2, 33.5010)];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "confirm-failure" });
  const created = await sessions.create(sessionInput());

  provider.failuresRemaining = 1;
  await assert.rejects(
    sessions.confirm(created.id, { vehicleId: "TAGO-A" }),
    /TAGO payload has no body object/,
  );
});

test("nothing in a TAGO session view reads as a provider observation time", async () => {
  const provider = new MutableProvider();
  let now = new Date("2026-09-22T12:00:00Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 1, 33.5000)];
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "naming-contract",
    automaticMatchingEnabled: true,
  });
  const created = await sessions.create(sessionInput());
  now = new Date("2026-09-22T12:00:05Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 1, 33.5000)];
  await sessions.refresh(created.id);
  now = new Date("2026-09-22T12:00:10Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 2, 33.5010)];
  const tracking = await sessions.refresh(created.id);

  assert.equal(tracking.state, "tracking");
  const progress = tracking.progress!;
  // The exact published shape. A new field — especially a time-like one — has
  // to be named and reviewed here rather than appearing beside `observedAt`
  // and being read as a provider timestamp by whoever consumes it next.
  assert.deepEqual(Object.keys(progress).sort(), [
    "currentStopId",
    "currentStopSequence",
    "evidenceAt",
    "evidenceAtIs",
    "observedAt",
    "phase",
    "remainingStops",
    "source",
  ]);
  // The only provider-sourced instant is the sentinel, and the only real
  // instant is labelled a server receipt.
  assert.equal(progress.observedAt, new Date(0).toISOString());
  assert.equal(progress.evidenceAtIs, "tapso_server_receipt");
  assert.equal(progress.evidenceAt, now.toISOString());
  assert.notEqual(progress.evidenceAtIs, "provider_observation_timestamp");
});

/* ------------------------------------------------- durable session store */

/**
 * A provider that parks inside `vehicles()` until the test lets it go, so two
 * coordinators can be held in the overlap that a scaled-out deployment
 * produces by accident.
 */
class BarrierProvider implements TransitProvider {
  snapshots: VehicleObservation[][] = [];
  gated = false;
  private readonly waiting: Array<() => void> = [];

  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    return stops.map((stop) => ({ ...stop }));
  }

  async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> {
    const snapshot = this.snapshots.shift() ?? [];
    if (this.gated) await new Promise<void>((resolve) => this.waiting.push(resolve));
    return snapshot.map((vehicle) => ({ ...vehicle }));
  }

  releaseNext(): void {
    this.waiting.shift()?.();
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("a session outlives the coordinator that created it", async () => {
  const store = new MemoryJourneySessionStore();
  const provider = new MutableProvider();
  const now = new Date("2026-09-22T13:00:00Z");
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 2 },
  ];
  const options = { now: () => now, store, automaticMatchingEnabled: true };

  const created = await new JourneySessionCoordinator(provider, { ...options, idFactory: () => "durable-1" })
    .create(sessionInput());
  assert.equal(created.progress?.currentStopSequence, 2);

  // A different process entirely — which is what a second serverless instance
  // or a cold start after a deploy actually is.
  const elsewhere = new JourneySessionCoordinator(provider, options);
  const resumed = await elsewhere.refresh("durable-1");

  assert.equal(resumed.id, "durable-1");
  assert.equal(resumed.selectedVehicleId, "BUS-A");
  assert.equal(resumed.progress?.currentStopSequence, 2);
});

test("a concurrent writer cannot move a rider backward along the route", async () => {
  const store = new MemoryJourneySessionStore();
  const provider = new BarrierProvider();
  let now = new Date("2026-09-22T14:00:00Z");
  const bus = (at: Date, stopSequence: number): VehicleObservation => ({
    vehicleId: "BUS-A",
    routeId,
    observedAt: at.toISOString(),
    directionCode: "1",
    stopSequence,
  });
  const options = { now: () => now, store, automaticMatchingEnabled: true };

  provider.snapshots = [[bus(now, 3)]];
  const first = new JourneySessionCoordinator(provider, { ...options, idFactory: () => "race-1" });
  const created = await first.create(sessionInput());
  assert.equal(created.progress?.currentStopSequence, 3);

  // Two instances, each about to answer a refresh for the same ride.
  now = new Date("2026-09-22T14:00:20Z");
  provider.gated = true;
  provider.snapshots = [
    [bus(now, 4)], // the instance that wins: the bus has moved on
    [bus(now, 3)], // the instance that loses: a snapshot still showing stop 3
  ];
  const ahead = new JourneySessionCoordinator(provider, options);
  const behind = new JourneySessionCoordinator(provider, options);

  const aheadCall = ahead.refresh("race-1");
  await tick();
  const behindCall = behind.refresh("race-1");
  await tick();

  // Both have now loaded the same version. Let them finish in order.
  provider.releaseNext();
  const aheadView = await aheadCall;
  provider.releaseNext();
  const behindView = await behindCall;

  assert.equal(aheadView.progress?.currentStopSequence, 4, "the first writer advances the ride");

  // Without compare-and-set the second writer would persist stop 3 over stop
  // 4 and the rider would watch their bus reverse. Its own backward guard
  // cannot catch it: it is comparing against the copy it loaded, which still
  // said stop 3.
  assert.equal(behindView.progress?.currentStopSequence, 4, "the loser reports the winner's state, not its own");
  assert.match(behindView.explanation, /concurrent update/);

  const persisted = await store.load("race-1");
  assert.equal(persisted?.session.lastProgress?.currentStopSequence, 4);
  assert.equal(persisted?.version, 2, "exactly one write landed");
});

test("a store that cannot be read fails the request instead of losing the session", async () => {
  const provider = new MutableProvider();
  const now = new Date("2026-09-22T15:00:00Z");
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 2 },
  ];
  const store = new MemoryJourneySessionStore();
  const created = await new JourneySessionCoordinator(provider, {
    now: () => now,
    store,
    idFactory: () => "store-down",
    automaticMatchingEnabled: true,
  }).create(sessionInput());

  const brokenStore: JourneySessionStore = {
    async load() { throw new SessionStoreError("the session store could not be reached"); },
    async create() { throw new SessionStoreError("the session store could not be reached"); },
    async save() { throw new SessionStoreError("the session store could not be reached"); },
    async delete() { throw new SessionStoreError("the session store could not be reached"); },
  };
  const coordinator = new JourneySessionCoordinator(provider, { now: () => now, store: brokenStore });

  // A store outage must not read as "no such session": answering 404 would
  // tell a rider mid-journey that their ride never existed.
  await assert.rejects(coordinator.refresh(created.id), (error: unknown) => {
    assert.ok(error instanceof SessionStoreError);
    assert.equal(error.code, "SESSION_STORE_UNAVAILABLE");
    return true;
  });
});

test("an expired session still reports as expired rather than as a wrong id", async () => {
  const provider = new MutableProvider();
  let now = new Date("2026-09-22T16:00:00Z");
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 2 },
  ];
  const store = new MemoryJourneySessionStore({ now: () => now });
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    store,
    idFactory: () => "expiring",
    sessionTtlMs: 60_000,
    automaticMatchingEnabled: true,
  });
  await sessions.create(sessionInput());

  now = new Date("2026-09-22T16:02:00Z");
  await assert.rejects(sessions.refresh("expiring"), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "SESSION_EXPIRED");
    return true;
  });
  // And the row is cleared, so a replay of the same id is an honest 404.
  await assert.rejects(sessions.refresh("expiring"), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "SESSION_NOT_FOUND");
    return true;
  });
});

test("a generated id that already exists is refused, never overwritten", async () => {
  const provider = new MutableProvider();
  const now = new Date("2026-09-22T17:00:00Z");
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 2 },
  ];
  const store = new MemoryJourneySessionStore();
  const options = { now: () => now, store, idFactory: () => "collide", automaticMatchingEnabled: true };
  await new JourneySessionCoordinator(provider, options).create(sessionInput());

  await assert.rejects(
    new JourneySessionCoordinator(provider, options).create(sessionInput()),
    /generated session id already exists/,
  );
});
