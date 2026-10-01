import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmationCandidates,
  JourneySessionCoordinator,
  SessionExpiredError,
  SessionInputError,
  SessionNotFoundError,
  SessionWriteConflictError,
} from "../src/journeySession.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import type { TransitProvider } from "../src/provider.ts";
import {
  JOURNEY_SESSION_SCHEMA_VERSION,
  MemoryJourneySessionStore,
  SessionStoreError,
  type JourneySessionStore,
  type StoredJourneySession,
} from "../src/sessionStore.ts";

/**
 * Synthetic fixtures only: invented vehicle ids, an invented route, and a
 * synthetic coordinate line, not real stop positions. Nothing here is a real
 * ride.
 */
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

/**
 * A rider waiting at stop 3, so a bus can come up to them from stops 1 and 2.
 *
 * `sessionInput()` boards at the first stop, where nothing can be approaching:
 * every bus on the route is at or past it, and those are exactly the buses a
 * waiting rider's session must never select (finding F1).
 */
function waitingInput() {
  return { ...sessionInput(), boardingStopSequence: 3 };
}

/**
 * A rider who says they have just boarded at stop 1. The bus they are on is
 * then one to four stops past it, which is where the on-board rule selects.
 */
function onBoardInput() {
  return { ...sessionInput(), riderState: "on_board" };
}

/**
 * A TAGO row, which is the only shape production ever sees. `observedAt` is
 * the epoch sentinel because TAGO publishes no observation time; `receivedAt`
 * is TAPSO's own receipt and nothing more.
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

test("never automatically selects a coordinate-only vehicle, however close to the boarding stop", async () => {
  const provider = new MutableProvider();
  const now = new Date("2026-09-10T05:00:00Z");
  // BUS-A is 11 m from the boarding stop and BUS-B 2 km out; neither reports a
  // stop sequence. Coordinates cannot say which side of the stop a bus is on —
  // BUS-A may just have pulled away from it — so route progress is unknown for
  // both, and the session fails closed rather than choosing by distance.
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

  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.selectionMode, undefined);
  // Not selected, but offered: the rider can see which bus they are boarding.
  assert.equal(view.state, "confirmation_required");
  assert.equal(view.progress, undefined);
  assert.deepEqual(
    view.candidates?.map((candidate) => [candidate.vehicleId, candidate.zone, candidate.rejectedReasons]),
    [
      ["BUS-A", "route_progress_unknown", ["route_progress_unknown"]],
      ["BUS-B", "route_progress_unknown", ["route_progress_unknown"]],
    ],
  );

  // The rider confirms the bus they can see. Its progress then comes from the
  // nearest stop by coordinates, and says so: an estimate, never a provider
  // stop sequence.
  const confirmed = await sessions.confirm(view.id, { vehicleId: "BUS-A" });
  assert.equal(confirmed.state, "tracking");
  assert.equal(confirmed.selectionMode, "explicit");
  assert.equal(confirmed.progress?.currentStopSequence, 1);
  assert.equal(confirmed.progress?.remainingStops, 4);
  assert.equal(confirmed.progress?.source, "near_stop_estimate");
});

test("automatically matches a fresh TAGO bus approaching the boarding stop", async () => {
  const provider = new MutableProvider();
  let now = new Date("2026-09-10T05:00:00Z");
  // The rider waits at stop 3 and the only bus on the route comes up from stop
  // 1 to stop 2: before the boarding stop under every reading of TAGO's nodeord.
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 1, 33.5000)];
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "session-1-approaching",
    automaticMatchingEnabled: true,
  });
  const created = await sessions.create(waitingInput());

  now = new Date("2026-09-10T05:00:05Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 1, 33.5005)];
  const early = await sessions.refresh(created.id);
  // Two receipts are not cadence evidence yet. Where the bus is already qualifies.
  assert.equal(early.selectedVehicleId, undefined);
  assert.equal(early.candidates?.[0]?.zone, "approaching");
  assert.deepEqual(early.candidates?.[0]?.rejectedReasons, ["source_cadence_not_fresh"]);

  now = new Date("2026-09-10T05:00:10Z");
  provider.vehiclesValue = [tagoRow("TAGO-A", now, 2, 33.5010)];
  const view = await sessions.refresh(created.id);
  assert.equal(view.selectedVehicleId, "TAGO-A");
  assert.equal(view.selectionMode, "automatic");
  assert.equal(view.state, "tracking");
  assert.equal(view.progress?.currentStopSequence, 2);
  assert.equal(view.progress?.source, "provider_stop_sequence");
  assert.equal(view.progress?.remainingStops, 3);
});

test("withholds automatic selection when candidates are too close and accepts explicit confirmation", async () => {
  const provider = new MutableProvider();
  const now = new Date("2026-09-10T05:00:00Z");
  // Both approach a rider waiting at stop 3, one stop apart. The leader needs a
  // lead of three stops to be chosen on its own.
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 2 },
    { vehicleId: "BUS-B", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 1 },
  ];
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "session-2",
    // Automatic mode on purpose: this test is about the matcher refusing a
    // close call, not about the rollout gate refusing everything.
    automaticMatchingEnabled: true,
  });
  const initial = await sessions.create(waitingInput());
  assert.equal(initial.state, "confirmation_required");
  assert.equal(initial.selectedVehicleId, undefined);
  assert.equal(initial.candidates?.length, 2);
  assert.match(initial.explanation, /candidates_too_close/);

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
  // On board: a bus two stops past the rider's stop is only ever theirs if they
  // are riding it, and a ride already under way is what this test tracks.
  const initial = await sessions.create(onBoardInput());
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
  // On board, for the same reason: a bus one stop past stop 1 is the rider's
  // only once they are on it, and losing a tracked bus is what is under test.
  const initial = await sessions.create(onBoardInput());
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
  // One stop before a waiting rider's stop, in automatic mode: neither the
  // bus's position nor the rollout gate refuses it, so the missing cadence is
  // the only thing that can.
  provider.vehiclesValue = [{
    vehicleId: "SYNTHETIC_TAGO_BUS", routeId, observedAt: now.toISOString(),
    receivedAt: now.toISOString(), timestampSource: "unavailable", directionCode: "1", stopSequence: 2,
  }];
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "synthetic-tago-session",
    automaticMatchingEnabled: true,
  });
  const view = await sessions.create(waitingInput());
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.progress, undefined);
  assert.equal(view.sourceFreshness?.["SYNTHETIC_TAGO_BUS"]?.state, "unknown");
  assert.deepEqual(view.candidates?.[0]?.rejectedReasons, ["source_cadence_not_fresh"]);
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

  // The rider is aboard from stop 1 and the bus reports stop 2, inside the
  // on-board window at every poll, so the one thing that changes is cadence.
  provider.vehiclesValue = [tago(now, 2, 33.5010)];
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "tago-cadence-session",
    automaticMatchingEnabled: true,
  });

  const initial = await sessions.create(onBoardInput());
  // Offered for confirmation while cadence is still being established, never selected.
  assert.equal(initial.state, "confirmation_required");
  assert.equal(initial.selectedVehicleId, undefined);

  now = new Date("2026-09-22T03:00:05Z");
  provider.vehiclesValue = [tago(now, 2, 33.5010)];
  const second = await sessions.refresh(initial.id);
  assert.equal(second.state, "confirmation_required");
  assert.equal(second.selectedVehicleId, undefined);

  now = new Date("2026-09-22T03:00:10Z");
  provider.vehiclesValue = [tago(now, 2, 33.5014)];
  const third = await sessions.refresh(initial.id);
  assert.equal(third.selectedVehicleId, "TAGO-A");
  assert.equal(third.selectionMode, "automatic");
  assert.equal(third.state, "tracking");
  assert.equal(third.progress?.currentStopSequence, 2);
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
    stopSequence: 2,
    latitude: 33.5010,
    longitude: 126.5000,
  });
  provider.vehiclesValue = [unchanged()];
  // Automatic mode, and the bus one stop before a waiting rider's stop: neither
  // the rollout gate nor the bus's position is what refuses it below.
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "tago-unchanged-session",
    automaticMatchingEnabled: true,
  });
  const initial = await sessions.create(waitingInput());

  let view = initial;
  for (const seconds of [5, 10, 15, 20]) {
    now = new Date(Date.parse("2026-09-22T04:00:00Z") + seconds * 1_000);
    provider.vehiclesValue = [unchanged()];
    view = await sessions.refresh(initial.id);
    assert.equal(view.selectedVehicleId, undefined);
    // The rider may confirm the stationary bus; the matcher never selects it.
    assert.equal(view.state, "confirmation_required");
  }
  // Continuous receipts of content that never changed: aging, never fresh.
  assert.equal(view.sourceFreshness?.["TAGO-STATIONARY"]?.state, "aging");
  assert.deepEqual(view.candidates?.[0]?.rejectedReasons, ["source_cadence_not_fresh"]);
});

/* ------------------------------------------------- automatic-matching gate */

test("automatic matching is off unless a caller opts in", async () => {
  const provider = new MutableProvider();
  const now = new Date("2026-09-22T05:00:00Z");
  // One unambiguous winner with a provider timestamp, one stop before a
  // waiting rider's stop: the easiest possible match. The default coordinator
  // still refuses to make it.
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 2 },
  ];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "gate-default" });

  assert.equal(sessions.matchingMode, "shadow");
  const view = await sessions.create(waitingInput());
  assert.equal(view.matchingMode, "shadow");
  // The matcher would have taken it, so the refusal below is the gate's alone.
  assert.equal(view.shadowSelection?.status, "matched");
  assert.equal(view.shadowSelection?.wouldSelectVehicleId, "BUS-A");
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

  // The rider waits at stop 3 and the bus is two stops out, so cadence is all
  // that stands between it and the matcher's choice.
  const first = await sessions.create(waitingInput());
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
  // A rider waiting at stop 3, so the bus coming up from stops 1 and 2 is the
  // one automatic mode goes on to track.
  const created = await sessions.create(waitingInput());
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

  // On board, so the bus one stop past stop 1 is the rider's own: what is
  // under test is the stored ride, not the choice.
  const created = await new JourneySessionCoordinator(provider, { ...options, idFactory: () => "durable-1" })
    .create(onBoardInput());
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
  // On board, so the bus two stops past stop 1 is selected and there is a
  // ride under way to race over.
  const created = await first.create(onBoardInput());
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

/* --------------------------------- rider state and directed route progress */

test("a riderState other than waiting_at_stop or on_board is invalid input", async () => {
  const provider = new MutableProvider();
  const sessions = new JourneySessionCoordinator(provider, { idFactory: () => "bad-rider-state" });
  for (const riderState of ["boarded", "ON_BOARD", "", null, 1, true]) {
    await assert.rejects(sessions.create({ ...sessionInput(), riderState }), (error: unknown) => {
      assert.ok(error instanceof SessionInputError, `riderState ${JSON.stringify(riderState)}`);
      assert.equal(error.code, "INVALID_INPUT");
      assert.match(error.message, /riderState must be waiting_at_stop or on_board/);
      return true;
    });
  }
});

test("riderState round-trips through the store and appears in the view", async () => {
  const store = new MemoryJourneySessionStore();
  const provider = new MutableProvider();
  const start = Date.parse("2026-09-23T05:00:00Z");
  let now = new Date(start);
  const options = { now: () => now, store, automaticMatchingEnabled: true };
  // A TAGO bus one stop past stop 1. It is in the feed when both riders start
  // (an on-board rider's bus has to be), but its cadence is not yet fresh, so
  // neither session can select anything at creation.
  const at = (seconds: number, latitude: number) => {
    now = new Date(start + seconds * 1_000);
    provider.vehiclesValue = [tagoRow("BUS-A", now, 2, latitude)];
  };
  at(0, 33.5010);
  const onBoard = await new JourneySessionCoordinator(provider, { ...options, idFactory: () => "rider-on-board" })
    .create(onBoardInput());
  const waiting = await new JourneySessionCoordinator(provider, { ...options, idFactory: () => "rider-default" })
    .create(sessionInput());
  assert.equal(onBoard.riderState, "on_board");
  assert.equal(onBoard.selectedVehicleId, undefined, "cadence is not fresh at creation");
  assert.equal(waiting.riderState, "waiting_at_stop", "a rider who did not say is waiting");
  assert.equal((await store.load("rider-on-board"))?.session.riderState, "on_board");

  // Another instance reads both rides back and makes the first selection
  // itself, applying each rider's own rule to the same, now fresh, bus.
  const elsewhere = new JourneySessionCoordinator(provider, options);
  at(10, 33.5012);
  await elsewhere.refresh("rider-on-board");
  await elsewhere.refresh("rider-default");
  at(20, 33.5015);
  const onBoardResumed = await elsewhere.refresh("rider-on-board");
  const waitingResumed = await elsewhere.refresh("rider-default");

  assert.equal(onBoardResumed.riderState, "on_board");
  assert.equal(onBoardResumed.selectedVehicleId, "BUS-A", "the on-board rule takes the bus that has just left the stop");
  assert.equal(onBoardResumed.selectionMode, "automatic");
  assert.equal(waitingResumed.riderState, "waiting_at_stop");
  assert.equal(waitingResumed.selectedVehicleId, undefined, "the waiting rule never does");
});

test("a stored row written before rider states existed reads as waiting_at_stop", async () => {
  const store = new MemoryJourneySessionStore();
  const provider = new MutableProvider();
  const now = new Date("2026-09-23T05:30:00Z");
  // Written by hand in the shape the store held before rider states: every
  // field it required then, and no `riderState` at all.
  const legacy: StoredJourneySession = {
    schemaVersion: JOURNEY_SESSION_SCHEMA_VERSION,
    id: "legacy-row",
    routeId,
    cityCode,
    boardingStopSequence: 1,
    destinationStopSequence: 5,
    directionCode: "1",
    stops: stops.map((stop) => ({ ...stop })),
    boardingStop: { ...stops[0]! },
    destinationStop: { ...stops[4]! },
    matchConfidence: "unknown",
    createdAtMs: now.getTime() - 60_000,
    updatedAtMs: now.getTime() - 60_000,
    expiresAtMs: now.getTime() + 60 * 60_000,
    cadenceHistory: [],
    consecutiveProviderFailures: 0,
  };
  assert.equal((await store.create(legacy)).outcome, "saved");
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 2 },
  ];

  const view = await new JourneySessionCoordinator(provider, { now: () => now, store, automaticMatchingEnabled: true })
    .refresh("legacy-row");
  assert.equal(view.riderState, "waiting_at_stop");
  // Matched as waiting, not merely labelled so: the bus one stop past the
  // boarding stop, which the on-board rule would take, is not selected.
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.state, "confirmation_required");
  assert.equal(view.candidates?.[0]?.zone, "boarding_stop_unresolved");
});

test("a polled row written before passage memory existed is withheld for good, never given an empty memory", async () => {
  const now = new Date("2026-09-23T05:30:00Z");
  // The shape the previous matcher stored: polled (it has cadence history) but
  // no `passage`. Whatever that session saw cross the stop is unknown now.
  const row = (passage?: StoredJourneySession["passage"]): StoredJourneySession => ({
    schemaVersion: JOURNEY_SESSION_SCHEMA_VERSION,
    id: passage ? "current-row" : "pre-passage-row",
    routeId,
    cityCode,
    boardingStopSequence: 3,
    destinationStopSequence: 5,
    directionCode: "1",
    stops: stops.map((stop) => ({ ...stop })),
    boardingStop: { ...stops[2]! },
    destinationStop: { ...stops[4]! },
    matchConfidence: "unknown",
    createdAtMs: now.getTime() - 5_000,
    updatedAtMs: now.getTime() - 5_000,
    expiresAtMs: now.getTime() + 60 * 60_000,
    // A bus seen two stops past the rider's stop, well clear of it.
    cadenceHistory: [["BUS-OLD", [tagoRow("BUS-OLD", new Date(now.getTime() - 5_000), 5, 33.5040)]]],
    consecutiveProviderFailures: 0,
    ...(passage ? { passage } : {}),
  });
  const provider = new MutableProvider();
  // One bus, one stop before the rider's stop, provider-timestamped and
  // current: the directed rule's clearest possible selection.
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 2 },
  ];

  const store = new MemoryJourneySessionStore();
  assert.equal((await store.create(row())).outcome, "saved");
  assert.equal((await store.create(row({ offsets: {} }))).outcome, "saved");
  const coordinator = new JourneySessionCoordinator(provider, { now: () => now, store, automaticMatchingEnabled: true });

  const control = await coordinator.refresh("current-row");
  assert.equal(control.selectedVehicleId, "BUS-A", "control: a row with its memory selects");

  const withheld = await coordinator.refresh("pre-passage-row");
  assert.equal(withheld.selectedVehicleId, undefined);
  assert.equal(withheld.state, "confirmation_required");
  assert.equal((await store.load("pre-passage-row"))?.session.passage?.withheld?.reason, "passage_memory_unavailable");
});

test("a session whose first look comes late withholds when a bus past the stop could have been at it", async () => {
  // The rider says they are waiting at stop 3; the first provider read takes
  // 40 s. By then one bus is two stops past the stop: it could have been at the
  // stop when the rider started (one stop plus one per 15 s), with the rider
  // stepping on. The bus behind it is only theirs if nobody boarded meanwhile.
  const run = async (readSeconds: number) => {
    let clock = new Date("2026-09-23T06:00:00Z");
    const provider = new MutableProvider();
    const slow: TransitProvider = {
      stops: (request) => provider.stops(request),
      async vehicles(request) {
        clock = new Date(clock.getTime() + readSeconds * 1_000);
        provider.vehiclesValue = [
          { vehicleId: "BUS-GONE", routeId, observedAt: clock.toISOString(), directionCode: "1", stopSequence: 5 },
          { vehicleId: "BUS-NEXT", routeId, observedAt: clock.toISOString(), directionCode: "1", stopSequence: 1 },
        ];
        return provider.vehicles(request);
      },
    };
    return new JourneySessionCoordinator(slow, { now: () => clock, automaticMatchingEnabled: true }).create(waitingInput());
  };
  assert.equal((await run(0)).selectedVehicleId, "BUS-NEXT", "control: a first look at declaration time");
  const late = await run(40);
  assert.equal(late.selectedVehicleId, undefined);
  assert.equal(late.state, "confirmation_required");
});

test("a waiting rider's session never automatically selects a bus at or past the boarding stop, even the only fresh one", async () => {
  // Finding F1. These are the positions tests in this file once selected from
  // for a rider waiting at stop 1: at the stop, one past it (where a dwelling
  // bus and a departed one can report alike), and two past it (departed under
  // every reading). The shadow ranking must not claim the bus either.
  const cases = [
    { stopSequence: 1, zone: "boarding_stop_unresolved", reason: "boarding_stop_position_unresolved" },
    { stopSequence: 2, zone: "boarding_stop_unresolved", reason: "boarding_stop_position_unresolved" },
    { stopSequence: 3, zone: "departed", reason: "departed_boarding_stop" },
  ];
  for (const automaticMatchingEnabled of [true, false]) {
    for (const { stopSequence, zone, reason } of cases) {
      const label = `${automaticMatchingEnabled ? "automatic" : "shadow"}, bus at stop ${stopSequence}`;
      const provider = new MutableProvider();
      const start = Date.parse("2026-09-23T06:00:00Z");
      let now = new Date(start);
      const sessions = new JourneySessionCoordinator(provider, {
        now: () => now,
        idFactory: () => `waiting-past-${stopSequence}`,
        automaticMatchingEnabled,
      });
      // The bus creeps without changing stop, so its cadence is fresh by the
      // third receipt and freshness cannot be what refuses it.
      const latitude = stops[stopSequence - 1]!.latitude!;
      provider.vehiclesValue = [tagoRow("TAGO-PAST", now, stopSequence, latitude)];
      let view = await sessions.create(sessionInput());
      for (const seconds of [5, 10]) {
        now = new Date(start + seconds * 1_000);
        provider.vehiclesValue = [tagoRow("TAGO-PAST", now, stopSequence, latitude + seconds * 0.000001)];
        view = await sessions.refresh(view.id);
      }

      assert.equal(view.sourceFreshness?.["TAGO-PAST"]?.state, "fresh", label);
      assert.equal(view.selectedVehicleId, undefined, label);
      assert.equal(view.shadowSelection?.wouldSelectVehicleId, undefined, label);
      assert.equal(view.progress, undefined, label);
      // A bus at the stop, or one past it, may be the one the rider is
      // stepping onto: it is never selected, but it is offered for the rider to
      // confirm. A departed bus is not offered; the rider sees the full
      // ranking only because nothing plausible is left.
      assert.equal(view.state, zone === "boarding_stop_unresolved" ? "confirmation_required" : "awaiting_match", label);
      assert.equal(view.candidates?.[0]?.stopOffset, stopSequence - 1, label);
      assert.equal(view.candidates?.[0]?.zone, zone, label);
      assert.deepEqual(view.candidates?.[0]?.rejectedReasons, [reason], `${label}: position is the only reason`);
    }
  }
});

test("an on-board session refuses to choose while two buses are one to four stops past the boarding stop", async () => {
  // The rider is on one of them and nothing says which. The second bus blocks
  // whether or not it is fresh: a bus whose reports went stale has not stopped
  // being a bus the rider might be riding.
  const variants = [
    { id: "on-board-both-fresh", otherObservedAt: "2026-09-23T07:00:00Z", offered: ["BUS-A", "BUS-B"] },
    { id: "on-board-other-stale", otherObservedAt: "2026-09-23T06:55:00Z", offered: ["BUS-A", "BUS-B"] },
  ];
  for (const { id, otherObservedAt, offered } of variants) {
    const provider = new MutableProvider();
    const now = new Date("2026-09-23T07:00:00Z");
    provider.vehiclesValue = [
      { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 2 },
      { vehicleId: "BUS-B", routeId, observedAt: otherObservedAt, directionCode: "1", stopSequence: 4 },
    ];
    const sessions = new JourneySessionCoordinator(provider, {
      now: () => now,
      idFactory: () => id,
      automaticMatchingEnabled: true,
    });
    const view = await sessions.create(onBoardInput());

    assert.equal(view.riderState, "on_board", id);
    assert.equal(view.selectedVehicleId, undefined, id);
    assert.equal(view.state, "confirmation_required", id);
    assert.match(view.explanation, /multiple_vehicles_in_on_board_window/, id);
    // Both are offered, nearest the stop first: the rider may be on either, and
    // a bus whose reports went stale is no less a bus they might be riding.
    assert.deepEqual(view.candidates?.map((candidate) => candidate.vehicleId), offered, id);
  }
});

test("a bus that drops out of a poll keeps blocking, and if it could have reached the stop unseen the session stays withheld", async () => {
  const provider = new MutableProvider();
  const start = Date.parse("2026-09-23T08:00:00Z");
  const at = (seconds: number) => new Date(start + seconds * 1_000);
  let now = at(0);
  // Two buses bunched on the approach to a rider waiting at stop 3: TAGO-LEAD
  // one stop out, TAGO-FOLLOW two. Both creep forward, so both are fresh from
  // the third receipt. They are TAGO rows, so the session's cadence history is
  // what remembers a bus that drops out.
  const lead = (seconds: number) => tagoRow("TAGO-LEAD", at(seconds), 2, 33.5010 + seconds * 0.000001);
  const follow = (seconds: number) => tagoRow("TAGO-FOLLOW", at(seconds), 1, 33.5000 + seconds * 0.000001);
  const sessions = new JourneySessionCoordinator(provider, {
    now: () => now,
    idFactory: () => "remembered-leader",
    automaticMatchingEnabled: true,
  });

  provider.vehiclesValue = [lead(0), follow(0)];
  const created = await sessions.create(waitingInput());
  let view = created;
  for (const seconds of [5, 10]) {
    now = at(seconds);
    provider.vehiclesValue = [lead(seconds), follow(seconds)];
    view = await sessions.refresh(created.id);
  }
  // Both in view, one stop apart: too close to call.
  assert.equal(view.selectedVehicleId, undefined);
  assert.match(view.explanation, /candidates_too_close/);

  // TAGO-LEAD drops out of the feed. Losing its row is not evidence that it
  // has gone, so it is remembered at stop 2, ahead of the follower, and the
  // follower is not promoted just because it is now alone in the snapshot.
  for (let seconds = 15; seconds <= 95; seconds += 5) {
    now = at(seconds);
    provider.vehiclesValue = [follow(seconds)];
    view = await sessions.refresh(created.id);
    const label = `${seconds - 10} s after the leader was last seen`;
    assert.equal(view.selectedVehicleId, undefined, label);
    assert.equal(view.state, "confirmation_required", label);
    assert.match(view.explanation, /leading_vehicle_not_selectable/, label);
  }

  // 95 s after its last sighting the leader is outside the 90 s evidence
  // window and no longer remembered. It was one stop from the rider's stop when
  // it vanished, so it may have reached the stop unseen and the rider may be on
  // it: the follower is not promoted, now or later in this session.
  now = at(105);
  provider.vehiclesValue = [follow(105)];
  view = await sessions.refresh(created.id);
  assert.equal(view.selectedVehicleId, undefined);
  assert.match(view.explanation, /vehicle_may_have_reached_boarding_stop_unobserved/);
  now = at(200);
  provider.vehiclesValue = [follow(200)];
  view = await sessions.refresh(created.id);
  assert.equal(view.selectedVehicleId, undefined, "withheld for good, not only while remembered");
});

test("once a bus has been seen at a waiting rider's stop, no bus is automatically selected for the rest of the session", async () => {
  const store = new MemoryJourneySessionStore();
  const provider = new MutableProvider();
  const start = Date.parse("2026-09-23T09:00:00Z");
  let now = new Date(start);
  const options = { now: () => now, store, automaticMatchingEnabled: true };
  const bus = (vehicleId: string, stopSequence: number): VehicleObservation => ({
    vehicleId, routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence,
  });

  // BUS-FIRST is at the rider's stop 3, where the rider may be stepping onto it.
  provider.vehiclesValue = [bus("BUS-FIRST", 3), bus("BUS-NEXT", 1)];
  const created = await new JourneySessionCoordinator(provider, { ...options, idFactory: () => "passage-memory" })
    .create(waitingInput());
  assert.equal(created.selectedVehicleId, undefined);
  assert.equal(created.state, "confirmation_required");

  // BUS-FIRST has left, perhaps with the rider aboard, and BUS-NEXT is now the
  // leading, fresh and only bus approaching. Another instance reading the
  // stored session still does not choose it — nor five minutes on, long after
  // any 90 s memory of a dropped bus has lapsed. What withholds is the
  // session's passage memory (finding F4), and nothing clears it.
  for (const seconds of [20, 300]) {
    now = new Date(start + seconds * 1_000);
    provider.vehiclesValue = [bus("BUS-NEXT", 2)];
    const view = await new JourneySessionCoordinator(provider, options).refresh("passage-memory");
    assert.equal(view.selectedVehicleId, undefined, `${seconds} s`);
    assert.equal(view.state, "confirmation_required", `${seconds} s`);
    assert.match(view.explanation, /boarding_stop_reached_during_session/, `${seconds} s`);
  }
});

test("the confirmation list offers every bus the rider could be boarding, nearest first, and nothing departed", () => {
  // Synthetic ranking for a waiting rider at stop 10: a bus at the stop, one
  // approaching, one just past (may be dwelling), one departed, one of unknown
  // position, and one on another route.
  const row = (vehicleId: string, zone: string, stopOffset?: number, rejectedReasons: string[] = []) => ({
    vehicleId, score: 0, evidence: [], rejectedReasons, zone, ...(stopOffset === undefined ? {} : { stopOffset }),
  });
  const ranked = [
    row("DEPARTED", "departed", 3, ["departed_boarding_stop"]),
    row("APPROACHING", "approaching", -2),
    row("AT-STOP", "boarding_stop_unresolved", 0, ["boarding_stop_position_unresolved"]),
    row("JUST-PAST", "boarding_stop_unresolved", 1, ["boarding_stop_position_unresolved"]),
    row("UNKNOWN", "route_progress_unknown", undefined, ["route_progress_unknown"]),
    row("OTHER-ROUTE", "approaching", -1, ["wrong_route"]),
  ];
  assert.deepEqual(
    confirmationCandidates(ranked, "waiting_at_stop").map((candidate) => candidate.vehicleId),
    ["AT-STOP", "JUST-PAST", "APPROACHING", "UNKNOWN"],
  );
  // On board, the mirror: the stop and the window past it, nothing still approaching.
  const onBoard = [
    row("BEFORE", "not_yet_at_boarding_stop", -3, ["not_yet_at_boarding_stop"]),
    row("AT-STOP", "boarding_stop_unresolved", 0, ["boarding_stop_position_unresolved"]),
    row("PAST", "departed_within_on_board_window", 2),
    row("FAR", "beyond_window", 7, ["implausible_boarding_position"]),
  ];
  assert.deepEqual(confirmationCandidates(onBoard, "on_board").map((candidate) => candidate.vehicleId), ["AT-STOP", "PAST"]);
});

/* ------------------------------------------------ after an automatic selection */

/**
 * A synthetic route of twelve stops, long enough for one bus to overtake
 * another before the rider's stop. On a loop the twelfth row is the first stop
 * again, a lap of eleven.
 */
function longRoute(options: { loop?: boolean } = {}): StopOnRoute[] {
  const rows = Array.from({ length: 12 }, (_, index) => ({ stopId: `L${index + 1}`, name: `Long ${index + 1}`, sequence: index + 1 }));
  if (options.loop) rows[11] = { ...rows[11]!, stopId: "L1", name: "Long 1" };
  return rows;
}

class LongRouteProvider implements TransitProvider {
  vehiclesValue: VehicleObservation[] = [];
  private readonly route: StopOnRoute[];

  constructor(route: StopOnRoute[]) {
    this.route = route;
  }

  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    return this.route.map((stop) => ({ ...stop }));
  }

  async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> {
    return this.vehiclesValue.map((vehicle) => ({ ...vehicle }));
  }
}

/**
 * A rider waiting at stop 8 of the long route, riding to stop 11, with every
 * poll answered by a fresh coordinator over one store: what the session knows
 * after a selection has to survive the store. `rows` lists a snapshot as the
 * provider would, a bus twice if need be, a row observed some seconds before
 * the poll if need be; with `tago`, rows carry TAPSO's receipt only, as TAGO's
 * do.
 */
function overtakingRide(options: { loop?: boolean; boardingStopSequence?: number; riderState?: string; tago?: boolean } = {}) {
  const route = longRoute(options);
  const provider = new LongRouteProvider(route);
  const store = new MemoryJourneySessionStore();
  const start = Date.parse("2026-09-29T09:00:00Z");
  let now = new Date(start);
  const rows = (seconds: number, listed: ReadonlyArray<readonly [string, number, string?, number?]>) => {
    now = new Date(start + seconds * 1_000);
    provider.vehiclesValue = listed.map(([vehicleId, stopSequence, onRoute = routeId, ageSeconds = 0]): VehicleObservation => (options.tago
      ? {
        vehicleId, routeId: onRoute, directionCode: "1", stopSequence,
        observedAt: new Date(0).toISOString(), receivedAt: new Date(now.getTime() + 3).toISOString(), timestampSource: "unavailable",
      }
      : { vehicleId, routeId: onRoute, observedAt: new Date(now.getTime() - ageSeconds * 1_000).toISOString(), directionCode: "1", stopSequence }));
    return new JourneySessionCoordinator(provider, { now: () => now, store, automaticMatchingEnabled: true, idFactory: () => "ride" });
  };
  const at = (seconds: number, positions: Record<string, number>) => rows(seconds, Object.entries(positions));
  const input = {
    routeId,
    cityCode,
    boardingStopSequence: options.boardingStopSequence ?? 8,
    destinationStopSequence: 11,
    directionCode: "1",
    ...(options.riderState ? { riderState: options.riderState } : {}),
  };
  return { at, rows, input, store };
}

test("an automatic selection is withdrawn when another bus is seen reaching the stop first, and nothing is selected again", async () => {
  const ride = overtakingRide();
  // LEAD is three stops out and FAST seven: a clear lead, so LEAD is selected.
  const created = await ride.at(0, { LEAD: 5, FAST: 1 }).create(ride.input);
  assert.equal(created.selectedVehicleId, "LEAD");
  assert.equal(created.selectionMode, "automatic");

  const closing = await ride.at(30, { LEAD: 6, FAST: 4 }).refresh("ride");
  assert.equal(closing.selectedVehicleId, "LEAD");
  assert.equal(closing.state, "tracking");

  // FAST is faster and is now at the rider's stop, while LEAD is still one
  // stop out. The rider boards the first bus of their route to arrive: FAST.
  const overtaken = await ride.at(60, { LEAD: 7, FAST: 8 }).refresh("ride");
  assert.equal(overtaken.selectedVehicleId, undefined);
  assert.equal(overtaken.selectionMode, undefined);
  assert.equal(overtaken.progress, undefined);
  assert.equal(overtaken.state, "confirmation_required");
  assert.match(overtaken.explanation, /reaching the boarding stop before the automatically selected one/);
  assert.deepEqual(overtaken.candidates?.map((candidate) => candidate.vehicleId), ["FAST", "LEAD"]);
  assert.equal((await ride.store.load("ride"))?.session.passage?.withheld?.reason, "another_vehicle_reached_boarding_stop_first");

  // LEAD arrives and FAST leaves with the rider perhaps aboard: nothing is
  // selected automatically again, now or much later.
  for (const [seconds, positions] of [[90, { LEAD: 8, FAST: 10 }], [600, { LEAD: 11 }]] as const) {
    const later = await ride.at(seconds, positions).refresh("ride");
    assert.equal(later.selectedVehicleId, undefined, `${seconds} s`);
    assert.equal(later.state, "confirmation_required", `${seconds} s`);
  }
});

test("after a withdrawal the rider may be on the bus that just left the stop, so it is offered", async () => {
  const ride = overtakingRide();
  await ride.at(0, { LEAD: 5, FAST: 1 }).create(ride.input);
  // FAST went past the stop between polls; LEAD is still two stops out.
  const view = await ride.at(40, { LEAD: 6, FAST: 10 }).refresh("ride");
  assert.equal(view.selectedVehicleId, undefined);
  assert.deepEqual(
    view.candidates?.map((candidate) => [candidate.vehicleId, candidate.zone]),
    [["FAST", "departed"], ["LEAD", "approaching"]],
  );
  // And the rider can say so.
  const confirmed = await ride.at(45, { LEAD: 6, FAST: 10 }).confirm("ride", { vehicleId: "FAST" });
  assert.equal(confirmed.selectedVehicleId, "FAST");
  assert.equal(confirmed.selectionMode, "explicit");
});

test("the selected bus seen at the stop first ends the watch: a bus behind reaching the stop later withdraws nothing", async () => {
  const ride = overtakingRide();
  assert.equal((await ride.at(0, { LEAD: 5, BEHIND: 1 }).create(ride.input)).selectedVehicleId, "LEAD");
  // LEAD is at the rider's stop before any other bus: the rider boards it.
  assert.equal((await ride.at(30, { LEAD: 8, BEHIND: 3 }).refresh("ride")).selectedVehicleId, "LEAD");
  assert.ok((await ride.store.load("ride"))?.session.boardingWatch?.endedAt);
  for (const [seconds, positions] of [[60, { LEAD: 9, BEHIND: 6 }], [90, { LEAD: 10, BEHIND: 8 }], [120, { LEAD: 10, BEHIND: 9 }]] as const) {
    const view = await ride.at(seconds, positions).refresh("ride");
    assert.equal(view.selectedVehicleId, "LEAD", `${seconds} s`);
    assert.equal(view.state, "tracking", `${seconds} s`);
  }
});

test("another bus at the stop in the same poll as the selected bus withdraws the selection", async () => {
  const ride = overtakingRide();
  await ride.at(0, { LEAD: 5, FAST: 1 }).create(ride.input);
  // Both reached the stop between two polls: either may be the rider's.
  const view = await ride.at(30, { LEAD: 8, FAST: 9 }).refresh("ride");
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.state, "confirmation_required");
});

test("a bus out of sight that could have reached the stop never withdraws a selection; seen past it, it does", async () => {
  const ride = overtakingRide();
  // FAST is six stops out: the smallest gap that still clears the margin.
  assert.equal((await ride.at(0, { LEAD: 5, FAST: 2 }).create(ride.input)).selectedVehicleId, "LEAD");
  // FAST drops out. By the matcher's motion model it may be anywhere up to the
  // stop after 80 s, and past it after 200 s. That withholds a selection not
  // yet made; it does not undo one: every short dropout of the bus behind
  // would.
  for (const [seconds, positions] of [[10, { LEAD: 5 }], [80, { LEAD: 6 }], [200, { LEAD: 7 }]] as const) {
    const view = await ride.at(seconds, positions).refresh("ride");
    assert.equal(view.selectedVehicleId, "LEAD", `${seconds} s`);
  }
  // FAST reappears one stop past the stop: seen before it, now past it.
  const view = await ride.at(210, { LEAD: 7, FAST: 9 }).refresh("ride");
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.state, "confirmation_required");
});

test("a bus first seen past the stop withdraws a selection only if it could have been at the stop since the rider began waiting", async () => {
  // After 30 s a bus can have travelled one stop plus two, so one first seen
  // two stops past the stop may have been at it while the rider waited.
  const near = overtakingRide();
  assert.equal((await near.at(0, { LEAD: 5 }).create(near.input)).selectedVehicleId, "LEAD");
  const withdrawn = await near.at(30, { LEAD: 6, NEW: 10 }).refresh("ride");
  assert.equal(withdrawn.selectedVehicleId, undefined);

  // Four stops past it could not have been.
  const far = overtakingRide();
  assert.equal((await far.at(0, { LEAD: 5 }).create(far.input)).selectedVehicleId, "LEAD");
  const kept = await far.at(30, { LEAD: 6, NEW: 12 }).refresh("ride");
  assert.equal(kept.selectedVehicleId, "LEAD");
});

test("a selection the rider confirmed, or one made on board, is never withdrawn by another bus reaching the stop", async () => {
  // LEAD and CLOSE are too close for an automatic choice; the rider confirms LEAD.
  const confirmed = overtakingRide();
  const created = await confirmed.at(0, { LEAD: 5, CLOSE: 3 }).create(confirmed.input);
  assert.equal(created.selectedVehicleId, undefined);
  assert.equal((await confirmed.at(5, { LEAD: 5, CLOSE: 3 }).confirm("ride", { vehicleId: "LEAD" })).selectionMode, "explicit");
  const explicit = await confirmed.at(30, { LEAD: 6, CLOSE: 8 }).refresh("ride");
  assert.equal(explicit.selectedVehicleId, "LEAD");

  // Selected automatically, then confirmed by the rider: their word stands.
  const reconfirmed = overtakingRide();
  assert.equal((await reconfirmed.at(0, { LEAD: 5, FAST: 1 }).create(reconfirmed.input)).selectedVehicleId, "LEAD");
  await reconfirmed.at(5, { LEAD: 5, FAST: 2 }).confirm("ride", { vehicleId: "LEAD" });
  assert.equal((await reconfirmed.at(30, { LEAD: 6, FAST: 8 }).refresh("ride")).selectedVehicleId, "LEAD");

  // On board at stop 4: RIDE is the only bus in the window; a bus reaching
  // stop 4 behind it later is not the rider's and changes nothing.
  const onBoard = overtakingRide({ boardingStopSequence: 4, riderState: "on_board" });
  assert.equal((await onBoard.at(0, { RIDE: 6, LATER: 1 }).create(onBoard.input)).selectedVehicleId, "RIDE");
  const riding = await onBoard.at(30, { RIDE: 7, LATER: 4 }).refresh("ride");
  assert.equal(riding.selectedVehicleId, "RIDE");
  assert.equal((await onBoard.store.load("ride"))?.session.boardingWatch, undefined);
});

test("round a loop, another bus crossing the stop next to the seam withdraws the selection", async () => {
  // A lap of eleven; the rider waits at stop 3. LEAD is two stops out on the
  // seam-free reading, FAST five stops out across the seam.
  const ride = overtakingRide({ loop: true, boardingStopSequence: 3 });
  assert.equal((await ride.at(0, { LEAD: 1, FAST: 9 }).create(ride.input)).selectedVehicleId, "LEAD");
  assert.equal((await ride.at(30, { LEAD: 1, FAST: 11 }).refresh("ride")).selectedVehicleId, "LEAD");
  // FAST crossed the seam and the stop in one poll; LEAD is still one stop out.
  const view = await ride.at(60, { LEAD: 2, FAST: 5 }).refresh("ride");
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.state, "confirmation_required");
});

/** Whether the stored session's boarding watch has ended. */
async function watchEnded(store: MemoryJourneySessionStore): Promise<boolean> {
  return (await store.load("ride"))?.session.boardingWatch?.endedAt !== undefined;
}

test("round a loop, the selected bus read one stop back does not end the watch: a bus reaching the stop first still withdraws (R31)", async () => {
  // A lap of eleven; the rider waits at stop 5. LEAD is two stops out, FAST six.
  const ride = overtakingRide({ loop: true, boardingStopSequence: 5 });
  assert.equal((await ride.at(0, { LEAD: 3, FAST: 10 }).create(ride.input)).selectedVehicleId, "LEAD");
  // LEAD reads one stop back. Round a loop the stop is then further ahead,
  // which is also how a crossing looks, but no bus goes nine stops round in
  // thirty seconds.
  await ride.at(30, { LEAD: 2, FAST: 1 }).refresh("ride");
  assert.equal(await watchEnded(ride.store), false);
  assert.equal((await ride.at(60, { LEAD: 3, FAST: 4 }).refresh("ride")).selectedVehicleId, "LEAD");
  const view = await ride.at(90, { LEAD: 4, FAST: 5 }).refresh("ride");
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.state, "confirmation_required");
});

test("round a loop, the selected bus seen again two stops back after a long gap does not end the watch (R31)", async () => {
  const ride = overtakingRide({ loop: true, boardingStopSequence: 5 });
  assert.equal((await ride.at(0, { LEAD: 3, FAST: 10 }).create(ride.input)).selectedVehicleId, "LEAD");
  // Five minutes on, LEAD reads two stops further back. It may have gone
  // round through the stop; it may have stood and read two stops back. Only
  // the first would be an arrival, and nothing shows which.
  await ride.at(300, { LEAD: 1, FAST: 3 }).refresh("ride");
  assert.equal(await watchEnded(ride.store), false);
  assert.equal((await ride.at(330, { LEAD: 2, FAST: 5 }).refresh("ride")).selectedVehicleId, undefined);
  // Four stops on, through the stop, in a minute: that is an arrival.
  const crossing = overtakingRide({ loop: true, boardingStopSequence: 5 });
  assert.equal((await crossing.at(0, { LEAD: 3, FAST: 10 }).create(crossing.input)).selectedVehicleId, "LEAD");
  await crossing.at(60, { LEAD: 7, FAST: 1 }).refresh("ride");
  assert.equal(await watchEnded(crossing.store), true);
  assert.equal((await crossing.at(90, { LEAD: 8, FAST: 5 }).refresh("ride")).selectedVehicleId, "LEAD");
});

test("the selected bus listed at two places, or also under another route, at the stop does not end the watch (R31)", async () => {
  // LEAD is listed two stops out and, garbled, one past the stop, in either
  // order; or at the stop under another route, with or without its row on
  // this route. The matcher trusts no place of a bus listed so; nor does the
  // watch.
  const listings: ReadonlyArray<ReadonlyArray<readonly [string, number, string?]>> = [
    [["LEAD", 6], ["LEAD", 9]],
    [["LEAD", 9], ["LEAD", 6]],
    [["LEAD", 8, "route-other"], ["LEAD", 6]],
    [["LEAD", 8, "route-other"]],
  ];
  for (const listing of listings) {
    const ride = overtakingRide();
    assert.equal((await ride.at(0, { LEAD: 5, FAST: 1 }).create(ride.input)).selectedVehicleId, "LEAD");
    await ride.rows(30, [...listing, ["FAST", 4]]).refresh("ride");
    assert.equal(await watchEnded(ride.store), false, JSON.stringify(listing));
    const view = await ride.at(60, { LEAD: 7, FAST: 8 }).refresh("ride");
    assert.equal(view.selectedVehicleId, undefined, JSON.stringify(listing));
    assert.equal(view.state, "confirmation_required", JSON.stringify(listing));
  }
});

test("the selected bus's remembered row never ends the watch, whichever order its two rows came in (R31)", async () => {
  // TAGO rows, a lap of eleven, the rider at stop 5. LEAD is listed at two
  // places a stop apart, then drops out for a poll. The evidence window keeps
  // one of the two rows by the provider's order; read against memory, one
  // order looks like a bus that went through the stop.
  for (const order of [[["LEAD", 3], ["LEAD", 2]], [["LEAD", 2], ["LEAD", 3]]] as const) {
    const ride = overtakingRide({ loop: true, boardingStopSequence: 5, tago: true });
    await ride.rows(0, [["LEAD", 1], ["FAST", 8]]).create(ride.input);
    await ride.rows(10, [["LEAD", 1], ["FAST", 8]]).refresh("ride");
    assert.equal((await ride.rows(20, [["LEAD", 2], ["FAST", 9]]).refresh("ride")).selectedVehicleId, "LEAD", `${order}`);
    await ride.rows(30, [...order, ["FAST", 9]]).refresh("ride");
    await ride.rows(40, [["FAST", 10]]).refresh("ride");
    assert.equal(await watchEnded(ride.store), false, `${order}`);
    for (const [seconds, listed] of [[60, [["LEAD", 3], ["FAST", 11]]], [90, [["LEAD", 3], ["FAST", 1]]], [120, [["LEAD", 3], ["FAST", 2]]], [150, [["LEAD", 4], ["FAST", 3]]]] as const) {
      await ride.rows(seconds, listed).refresh("ride");
    }
    const view = await ride.rows(180, [["LEAD", 4], ["FAST", 5]]).refresh("ride");
    assert.equal(view.selectedVehicleId, undefined, `${order}`);
    assert.equal(view.state, "confirmation_required", `${order}`);
  }
});

test("the selected bus out of sight never ends the watch: a bus seen at the stop afterwards withdraws (R31)", async () => {
  const ride = overtakingRide();
  assert.equal((await ride.at(0, { LEAD: 5, FAST: 1 }).create(ride.input)).selectedVehicleId, "LEAD");
  // LEAD drops out; past the memory window it may, by now, have reached the
  // stop. That withholds a selection; it is not LEAD seen there.
  for (const [seconds, positions] of [[30, { FAST: 3 }], [150, { FAST: 7 }]] as const) {
    await ride.at(seconds, positions).refresh("ride");
    assert.equal(await watchEnded(ride.store), false, `${seconds} s`);
  }
  const view = await ride.at(170, { FAST: 8 }).refresh("ride");
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.state, "confirmation_required");
});

test("the selected bus seen past the stop ends the watch only if it could have got there since it was seen before it (R31)", async () => {
  // One stop out, then two past thirty seconds later: three stops, as far as
  // a bus can go in that time. It went through the stop first.
  const ride = overtakingRide();
  assert.equal((await ride.at(0, { LEAD: 5, BEHIND: 1 }).create(ride.input)).selectedVehicleId, "LEAD");
  await ride.at(10, { LEAD: 7, BEHIND: 2 }).refresh("ride");
  await ride.at(40, { LEAD: 10, BEHIND: 4 }).refresh("ride");
  assert.equal(await watchEnded(ride.store), true);
  assert.equal((await ride.at(90, { LEAD: 10, BEHIND: 8 }).refresh("ride")).selectedVehicleId, "LEAD");

  // Three out, then two past ten seconds later: five stops in ten seconds is
  // no bus moving, so it shows no arrival, and the bus behind reaching the
  // stop withdraws the selection.
  const jump = overtakingRide();
  assert.equal((await jump.at(0, { LEAD: 5, BEHIND: 1 }).create(jump.input)).selectedVehicleId, "LEAD");
  await jump.at(10, { LEAD: 10, BEHIND: 2 }).refresh("ride");
  assert.equal(await watchEnded(jump.store), false);
  assert.equal((await jump.at(60, { LEAD: 10, BEHIND: 8 }).refresh("ride")).selectedVehicleId, undefined);
});

test("after a withdrawal round a loop, the bus that just left the stop is offered across the seam too (R34)", async () => {
  // A lap of eleven; the rider waits at stop 10. FAST overtakes LEAD and is
  // two stops past the stop, where the closing stop is also the first: TAGO
  // may report it as 12 or as 1.
  for (const [label, closing] of [["as the closing stop", 12], ["as the first stop", 1]] as const) {
    const ride = overtakingRide({ loop: true, boardingStopSequence: 10 });
    assert.equal((await ride.at(0, { LEAD: 8, FAST: 3 }).create(ride.input)).selectedVehicleId, "LEAD", label);
    await ride.at(30, { LEAD: 8, FAST: 7 }).refresh("ride");
    const view = await ride.at(60, { LEAD: 9, FAST: closing }).refresh("ride");
    assert.equal(view.selectedVehicleId, undefined, label);
    assert.deepEqual(view.candidates?.map((candidate) => candidate.vehicleId), ["LEAD", "FAST"], label);
  }
});

test("after a withdrawal, a bus four stops past the stop is offered, and round a loop the one nearer the stop comes first (R41)", async () => {
  // FAST crossed the stop between polls and is four past it: the furthest a
  // bus the rider may be on is ever offered.
  const straight = overtakingRide();
  assert.equal((await straight.at(0, { LEAD: 5, FAST: 1 }).create(straight.input)).selectedVehicleId, "LEAD");
  await straight.at(30, { LEAD: 6, FAST: 4 }).refresh("ride");
  const four = await straight.at(60, { LEAD: 6, FAST: 12 }).refresh("ride");
  assert.equal(four.selectedVehicleId, undefined);
  assert.deepEqual(four.candidates?.map((candidate) => [candidate.vehicleId, candidate.stopOffset]), [["LEAD", -2], ["FAST", 4]]);
  // A lap of eleven, the rider at stop 10. FAST reports the first stop: two
  // past across the seam, nine before by its plain offset. LEAD is three out.
  // FAST, which the rider may be on, is the nearer round the loop.
  const loop = overtakingRide({ loop: true, boardingStopSequence: 10 });
  assert.equal((await loop.at(0, { LEAD: 7, FAST: 3 }).create(loop.input)).selectedVehicleId, "LEAD");
  await loop.at(30, { LEAD: 7, FAST: 8 }).refresh("ride");
  const seam = await loop.at(60, { LEAD: 7, FAST: 1 }).refresh("ride");
  assert.equal(seam.selectedVehicleId, undefined);
  assert.deepEqual(seam.candidates?.map((candidate) => [candidate.vehicleId, candidate.stopOffset]), [["FAST", -9], ["LEAD", -3]]);
});

test("the selected bus's crossing is measured from its latest sighting before the stop, and from where the selection read it (R38)", async () => {
  // LEAD is selected three stops out, then stands a stop short for minutes
  // while FAST closes. Ten seconds after its last sighting a stop short it
  // reads three past: four stops in ten seconds is no crossing, however long
  // ago the selection was. FAST then reaches the stop first.
  const ride = overtakingRide();
  assert.equal((await ride.at(0, { LEAD: 5, FAST: 1 }).create(ride.input)).selectedVehicleId, "LEAD");
  const polls = [
    [30, { LEAD: 6, FAST: 2 }], [60, { LEAD: 7, FAST: 3 }], [90, { LEAD: 7, FAST: 4 }],
    [120, { LEAD: 7, FAST: 5 }], [150, { LEAD: 7, FAST: 6 }], [160, { LEAD: 11, FAST: 6 }],
  ] as const;
  for (const [seconds, positions] of polls) await ride.at(seconds, positions).refresh("ride");
  assert.equal(await watchEnded(ride.store), false);
  await ride.at(170, { LEAD: 7, FAST: 7 }).refresh("ride");
  const view = await ride.at(180, { LEAD: 7, FAST: 8 }).refresh("ride");
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.state, "confirmation_required");

  // LEAD is first read two stops out from a row 200 s old, then three out,
  // fresh, and selected there. Two past 45 s later is five stops from where
  // the selection read it, more than the motion model allows; from the stale
  // row it would be four.
  const stale = overtakingRide();
  assert.equal((await stale.rows(0, [["LEAD", 6, routeId, 200], ["FAST", 2]]).create(stale.input)).selectedVehicleId, undefined);
  assert.equal((await stale.at(15, { LEAD: 5, FAST: 2 }).refresh("ride")).selectedVehicleId, "LEAD");
  await stale.at(60, { LEAD: 10, FAST: 6 }).refresh("ride");
  assert.equal(await watchEnded(stale.store), false);
  const withdrawn = await stale.at(75, { LEAD: 10, FAST: 8 }).refresh("ride");
  assert.equal(withdrawn.selectedVehicleId, undefined);
  assert.equal(withdrawn.state, "confirmation_required");
});

test("the selected bus seen past the stop too soon ends the watch once the time since its last sighting before the stop allows it (R42)", async () => {
  // LEAD is a stop short at 40 s and two past at 50 s: three stops in ten
  // seconds is no crossing, nor at 60 s. At 120 s it is three past: four
  // stops in eighty seconds from its last sighting before the stop. It went
  // through the stop first, and BEHIND reaching it later withdraws nothing.
  const ride = overtakingRide();
  assert.equal((await ride.at(0, { LEAD: 5, BEHIND: 1 }).create(ride.input)).selectedVehicleId, "LEAD");
  for (const [seconds, positions] of [[30, { LEAD: 6, BEHIND: 2 }], [40, { LEAD: 7, BEHIND: 2 }], [50, { LEAD: 10, BEHIND: 3 }], [60, { LEAD: 10, BEHIND: 3 }]] as const) {
    await ride.at(seconds, positions).refresh("ride");
  }
  assert.equal(await watchEnded(ride.store), false);
  await ride.at(120, { LEAD: 11, BEHIND: 5 }).refresh("ride");
  assert.equal(await watchEnded(ride.store), true);
  assert.equal((await ride.at(240, { LEAD: 12, BEHIND: 8 }).refresh("ride")).selectedVehicleId, "LEAD");
});

test("round a loop, another bus read a stop back withdraws nothing: it may have gone round, and is not seen to (R43)", async () => {
  // A lap of eleven; the rider waits at stop 5. LEAD is two stops out; FAR is
  // three past and driving away. FAR reads a stop back once: its distance to
  // the stop grew by one, as it would had FAR gone nine stops round in thirty
  // seconds, which no bus does.
  const ride = overtakingRide({ loop: true, boardingStopSequence: 5 });
  assert.equal((await ride.at(0, { LEAD: 3, FAR: 8 }).create(ride.input)).selectedVehicleId, "LEAD");
  await ride.at(30, { LEAD: 3, FAR: 8 }).refresh("ride");
  assert.equal((await ride.at(60, { LEAD: 4, FAR: 7 }).refresh("ride")).selectedVehicleId, "LEAD");
  assert.equal((await ride.at(90, { LEAD: 5, FAR: 8 }).refresh("ride")).selectedVehicleId, "LEAD");
  assert.equal(await watchEnded(ride.store), true);
});

/** The long route's provider, each call answered with the next snapshot once released, or failing with it. */
class GatedLongRouteProvider extends LongRouteProvider {
  snapshots: Array<VehicleObservation[] | Error> = [];
  gated = false;
  private readonly waiting: Array<() => void> = [];

  override async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> {
    const snapshot = this.snapshots.shift() ?? [];
    if (this.gated) await new Promise<void>((resolve) => this.waiting.push(resolve));
    if (snapshot instanceof Error) throw snapshot;
    return snapshot.map((vehicle) => ({ ...vehicle }));
  }

  releaseNext(): void {
    this.waiting.shift()?.();
  }
}

test("a withdrawal survives a concurrent refresh that saved first, unless that one saw the selected bus at the stop earlier (R33)", async () => {
  const start = Date.parse("2026-09-29T09:00:00Z");
  const positions = (seconds: number, buses: Record<string, number>) => Object.entries(buses).map(([vehicleId, stopSequence]) => ({
    vehicleId, routeId, observedAt: new Date(start + seconds * 1_000).toISOString(), directionCode: "1", stopSequence,
  }));
  const input = { routeId, cityCode, boardingStopSequence: 8, destinationStopSequence: 11, directionCode: "1" };
  // Two requests load the same stored session. `early` reads its snapshot at
  // `earlySeconds`, `late` at `lateSeconds`; `late` saves first.
  const race = async (earlySeconds: number, early: Record<string, number>, lateSeconds: number, late: Record<string, number>) => {
    const store = new MemoryJourneySessionStore();
    const provider = new GatedLongRouteProvider(longRoute());
    const coordinator = (seconds: number) => new JourneySessionCoordinator(provider, {
      now: () => new Date(start + seconds * 1_000), store, automaticMatchingEnabled: true, idFactory: () => "ride",
    });
    provider.snapshots = [positions(0, { LEAD: 5, FAST: 1 })];
    assert.equal((await coordinator(0).create(input)).selectedVehicleId, "LEAD");
    provider.gated = true;
    provider.snapshots = [positions(lateSeconds, late), positions(earlySeconds, early)];
    // Both load the same stored version before either saves.
    const lateCall = coordinator(lateSeconds).refresh("ride");
    await tick();
    const earlyCall = coordinator(earlySeconds).refresh("ride");
    await tick();
    // The later reader saves first.
    provider.releaseNext();
    const lateView = await lateCall;
    provider.releaseNext();
    const earlyView = await earlyCall;
    return { store, earlyView, lateView };
  };

  // At 60 s FAST is at the stop and LEAD a stop short; at 61 s LEAD is at the
  // stop and FAST's row missing. The later reader ends the watch and saves
  // first; FAST still reached the stop first.
  const first = await race(60, { LEAD: 7, FAST: 8 }, 61, { LEAD: 8 });
  assert.equal(first.lateView.selectedVehicleId, "LEAD");
  assert.equal(first.earlyView.selectedVehicleId, undefined);
  assert.equal(first.earlyView.state, "confirmation_required");
  const stored = (await first.store.load("ride"))?.session;
  assert.equal(stored?.selectedVehicleId, undefined);
  assert.equal(stored?.passage?.withheld?.reason, "another_vehicle_reached_boarding_stop_first");

  // Seen at the stop at 59 s, LEAD was there before FAST was seen at 60 s:
  // the watch had ended, and the selection stands.
  const second = await race(60, { LEAD: 7, FAST: 8 }, 59, { LEAD: 8 });
  const kept = (await second.store.load("ride"))?.session;
  assert.equal(kept?.selectedVehicleId, "LEAD");
  assert.equal(second.earlyView.selectedVehicleId, "LEAD");
  assert.match(second.earlyView.explanation, /concurrent update/);
});

/**
 * Concurrent requests on one stored session: LEAD is selected at 0 s for a
 * rider waiting at stop 8 of the long route (or, with `loop`, at
 * `boardingStopSequence` of its lap of eleven), from the first snapshot
 * `first` (by default LEAD three out and FAST seven out), then the provider is
 * gated, so each request waits at its read until released, in the order they
 * read.
 */
async function concurrentRide(options: { first?: Record<string, number>; loop?: boolean; boardingStopSequence?: number } = {}) {
  const start = Date.parse("2026-09-29T09:00:00Z");
  const store = new MemoryJourneySessionStore();
  const provider = new GatedLongRouteProvider(longRoute({ ...(options.loop ? { loop: true } : {}) }));
  const snapshot = (seconds: number, buses: Record<string, number>): VehicleObservation[] => Object.entries(buses).map(([vehicleId, stopSequence]) => ({
    vehicleId, routeId, observedAt: new Date(start + seconds * 1_000).toISOString(), directionCode: "1", stopSequence,
  }));
  const coordinator = (seconds: number, onStore: JourneySessionStore = store) => new JourneySessionCoordinator(provider, {
    now: () => new Date(start + seconds * 1_000), store: onStore, automaticMatchingEnabled: true, idFactory: () => "ride",
  });
  provider.snapshots = [snapshot(0, options.first ?? { LEAD: 5, FAST: 1 })];
  const input = { routeId, cityCode, boardingStopSequence: options.boardingStopSequence ?? 8, destinationStopSequence: 11, directionCode: "1" };
  assert.equal((await coordinator(0).create(input)).selectedVehicleId, "LEAD");
  provider.gated = true;
  // Makes a call and lets it reach its read, where it waits to be released.
  const begin = async <T>(call: () => Promise<T>): Promise<{ result: Promise<T> }> => {
    const result = call();
    await tick();
    return { result };
  };
  return { store, provider, snapshot, coordinator, begin, at: (seconds: number) => new Date(start + seconds * 1_000).toISOString() };
}

test("a withdrawal and an end read at the same instant withdraw; a withdrawal is retried past a third write, and never undoes the rider's confirmation (R39)", async () => {
  // Both at 60 s: the request that saves first sees LEAD at the stop, the
  // other FAST there and LEAD a stop short. Either bus may be the rider's.
  const tie = await concurrentRide();
  tie.provider.snapshots = [tie.snapshot(60, { LEAD: 8 }), tie.snapshot(60, { LEAD: 7, FAST: 8 })];
  const ending = await tie.begin(() => tie.coordinator(60).refresh("ride"));
  const withdrawing = await tie.begin(() => tie.coordinator(60).refresh("ride"));
  tie.provider.releaseNext();
  await ending.result;
  tie.provider.releaseNext();
  assert.equal((await withdrawing.result).state, "confirmation_required");
  assert.equal((await tie.store.load("ride"))?.session.passage?.withheld?.reason, "another_vehicle_reached_boarding_stop_first");

  // A third request saves between the withdrawing request's lost save and its
  // first write onto the winner's row: the second write carries it.
  const third = await concurrentRide();
  let saves = 0;
  const crowded: JourneySessionStore = {
    load: (id) => third.store.load(id),
    create: (session) => third.store.create(session),
    delete: (id) => third.store.delete(id),
    save: async (session, version) => {
      saves += 1;
      if (saves === 2) {
        const row = (await third.store.load("ride"))!;
        await third.store.save({ ...row.session, updatedAtMs: row.session.updatedAtMs + 1 }, row.version);
      }
      return third.store.save(session, version);
    },
  };
  third.provider.snapshots = [third.snapshot(61, { LEAD: 7, FAST: 6 }), third.snapshot(60, { LEAD: 7, FAST: 8 })];
  const winner = await third.begin(() => third.coordinator(61).refresh("ride"));
  const withdrawal = await third.begin(() => third.coordinator(60, crowded).refresh("ride"));
  third.provider.releaseNext();
  await winner.result;
  third.provider.releaseNext();
  assert.equal((await withdrawal.result).state, "confirmation_required");
  assert.equal(saves, 3);
  assert.equal((await third.store.load("ride"))?.session.selectedVehicleId, undefined);

  // The rider confirms LEAD, and that saves first: their word stands.
  const confirmed = await concurrentRide();
  confirmed.provider.snapshots = [confirmed.snapshot(61, { LEAD: 8, FAST: 9 }), confirmed.snapshot(60, { LEAD: 7, FAST: 8 })];
  const confirmation = await confirmed.begin(() => confirmed.coordinator(61).confirm("ride", { vehicleId: "LEAD" }));
  const late = await confirmed.begin(() => confirmed.coordinator(60).refresh("ride"));
  confirmed.provider.releaseNext();
  await confirmation.result;
  confirmed.provider.releaseNext();
  await late.result;
  const stored = (await confirmed.store.load("ride"))?.session;
  assert.equal(stored?.selectedVehicleId, "LEAD");
  assert.equal(stored?.selectionMode, "explicit");
});

test("an end seen by a request that lost the race is written onto the winner's row, the earliest kept, so a withdrawal from a later snapshot is not (R44)", async () => {
  // Three requests load one stored row. The first to save read at 61 s and
  // failed, or at 62 s and saw LEAD at the stop. The one reading at 59 s saw
  // LEAD at the stop and FAST a stop short: the watch ended then. The one
  // reading at 60 s saw FAST at the stop and LEAD's row missing. LEAD was at
  // the stop first; the selection stands.
  const winners: Array<[string, number, VehicleObservation[] | Error]> = [
    ["a failed read", 61, new Error("synthetic provider failure")],
    ["an end seen later", 62, []],
  ];
  for (const [label, seconds, winnerSnapshot] of winners) {
    const ride = await concurrentRide();
    ride.provider.snapshots = [
      Array.isArray(winnerSnapshot) ? ride.snapshot(seconds, { LEAD: 8 }) : winnerSnapshot,
      ride.snapshot(59, { LEAD: 8, FAST: 7 }),
      ride.snapshot(60, { FAST: 8 }),
    ];
    const first = await ride.begin(() => ride.coordinator(seconds).refresh("ride"));
    const ended = await ride.begin(() => ride.coordinator(59).refresh("ride"));
    const withdrawing = await ride.begin(() => ride.coordinator(60).refresh("ride"));
    ride.provider.releaseNext();
    await first.result;
    ride.provider.releaseNext();
    await ended.result;
    ride.provider.releaseNext();
    assert.equal((await withdrawing.result).selectedVehicleId, "LEAD", label);
    const stored = (await ride.store.load("ride"))?.session;
    assert.equal(stored?.selectedVehicleId, "LEAD", label);
    assert.equal(stored?.boardingWatch?.endedAt, ride.at(59), label);
  }
});

test("an end is read against the winner's memory before it is written: another bus crossing the stop in the same poll withdraws instead (R50)", async () => {
  // LEAD is selected at 5 s alone in the feed. Two requests load that row.
  // W reads at 5 s: LEAD at 6, FAST first seen one short at 7. E reads at
  // 14 s: LEAD at the stop, FAST two past. E's own memory has no FAST, and two
  // past is more than a bus first seen may have come since the declaration, so
  // E sees only LEAD's arrival and ends the watch. With W's memory FAST went
  // from one short to two past in E's poll: it crossed the stop, and the rider
  // may be on it. W saves first; E loses, and its end is not written over that.
  const straight = await concurrentRide({ first: { LEAD: 5 } });
  straight.provider.snapshots = [straight.snapshot(5, { LEAD: 6, FAST: 7 }), straight.snapshot(14, { LEAD: 8, FAST: 10 })];
  const w = await straight.begin(() => straight.coordinator(5).refresh("ride"));
  const e = await straight.begin(() => straight.coordinator(14).refresh("ride"));
  straight.provider.releaseNext();
  await w.result;
  straight.provider.releaseNext();
  const view = await e.result;
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.state, "confirmation_required");
  const stored = (await straight.store.load("ride"))?.session;
  assert.equal(stored?.selectedVehicleId, undefined);
  assert.equal(stored?.passage?.withheld?.reason, "another_vehicle_reached_boarding_stop_first");
  straight.provider.gated = false;
  straight.provider.snapshots = [straight.snapshot(30, { LEAD: 9, FAST: 11 })];
  assert.equal((await straight.coordinator(30).refresh("ride")).selectedVehicleId, undefined);

  // A lap of eleven, the rider at stop 5, FAR in every snapshot. W reads at
  // 149 s (LEAD at 4, FAR one short at 4), E at 150 s (LEAD at the stop, FAR at
  // 7). In E's memory FAR's distance to the stop grew by one, which is only what
  // the time allows; in W's it grew by eight, which is a crossing.
  const loop = await concurrentRide({ first: { LEAD: 3, FAR: 8 }, loop: true, boardingStopSequence: 5 });
  loop.provider.snapshots = [loop.snapshot(149, { LEAD: 4, FAR: 4 }), loop.snapshot(150, { LEAD: 5, FAR: 7 })];
  const lw = await loop.begin(() => loop.coordinator(149).refresh("ride"));
  const le = await loop.begin(() => loop.coordinator(150).refresh("ride"));
  loop.provider.releaseNext();
  await lw.result;
  loop.provider.releaseNext();
  assert.equal((await le.result).selectedVehicleId, undefined);
  assert.equal((await loop.store.load("ride"))?.session.selectedVehicleId, undefined);

  // The end still stands where the winner's memory shows nothing: LEAD at the
  // stop at 59 s, FAST one short, and a winner that read nothing of note.
  const quiet = await concurrentRide();
  quiet.provider.snapshots = [quiet.snapshot(58, { LEAD: 7, FAST: 6 }), quiet.snapshot(59, { LEAD: 8, FAST: 7 })];
  const qw = await quiet.begin(() => quiet.coordinator(58).refresh("ride"));
  const qe = await quiet.begin(() => quiet.coordinator(59).refresh("ride"));
  quiet.provider.releaseNext();
  await qw.result;
  quiet.provider.releaseNext();
  assert.match((await qe.result).explanation, /added to it/);
  assert.equal((await quiet.store.load("ride"))?.session.boardingWatch?.endedAt, quiet.at(59));
});

test("a merge that gives up on a newer, withdrawn row, or after three conflicts, answers from the last row it read (R54)", async () => {
  // W (61 s, its read failed) saves first. E (59 s: LEAD at the stop, FAST one
  // short) loses and merges its end. While that merge is in flight, D (60 s:
  // FAST at the stop) loses to W too and withdraws first: E's merge finds the
  // withdrawn row and gives up. E answers from that row.
  const ride = await concurrentRide();
  ride.provider.snapshots = [new Error("synthetic provider failure"), ride.snapshot(59, { LEAD: 8, FAST: 7 }), ride.snapshot(60, { FAST: 8 })];
  let saves = 0;
  let d: { result: Promise<{ state: string }> } | undefined;
  const interleaved: JourneySessionStore = {
    load: (id) => ride.store.load(id),
    create: (session) => ride.store.create(session),
    delete: (id) => ride.store.delete(id),
    save: async (session, version) => {
      saves += 1;
      // E's second save is its merge: D runs to completion first.
      if (saves === 2) {
        ride.provider.releaseNext();
        await d?.result;
      }
      return ride.store.save(session, version);
    },
  };
  const w = await ride.begin(() => ride.coordinator(61).refresh("ride"));
  const e = await ride.begin(() => ride.coordinator(59, interleaved).refresh("ride"));
  d = await ride.begin(() => ride.coordinator(60).refresh("ride"));
  ride.provider.releaseNext();
  await w.result;
  ride.provider.releaseNext();
  const view = await e.result;
  assert.equal((await d.result).state, "confirmation_required");
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.state, "confirmation_required");
  assert.equal((await ride.store.load("ride"))?.session.passage?.withheld?.reason, "another_vehicle_reached_boarding_stop_first");

  // A merge that gives up after three conflicts answers from the last row it
  // read as well: two benign writes land between E's merge attempts, and the
  // third conflict is D's withdrawal.
  const giving = await concurrentRide();
  giving.provider.snapshots = [new Error("synthetic provider failure"), giving.snapshot(59, { LEAD: 8, FAST: 7 }), giving.snapshot(60, { FAST: 8 })];
  let givingSaves = 0;
  let gd: { result: Promise<{ state: string }> } | undefined;
  const conflicted: JourneySessionStore = {
    load: (id) => giving.store.load(id),
    create: (session) => giving.store.create(session),
    delete: (id) => giving.store.delete(id),
    save: async (session, version) => {
      givingSaves += 1;
      if (givingSaves === 2 || givingSaves === 3) {
        const row = (await giving.store.load("ride"))!;
        await giving.store.save({ ...row.session, consecutiveProviderFailures: row.session.consecutiveProviderFailures + 1 }, row.version);
      }
      if (givingSaves === 4) {
        giving.provider.releaseNext();
        await gd?.result;
      }
      return giving.store.save(session, version);
    },
  };
  const gw = await giving.begin(() => giving.coordinator(61).refresh("ride"));
  const ge = await giving.begin(() => giving.coordinator(59, conflicted).refresh("ride"));
  gd = await giving.begin(() => giving.coordinator(60).refresh("ride"));
  giving.provider.releaseNext();
  await gw.result;
  giving.provider.releaseNext();
  const gaveUp = await ge.result;
  assert.equal(givingSaves, 4);
  assert.equal(gaveUp.selectedVehicleId, undefined);
  assert.equal(gaveUp.state, "confirmation_required");
});

test("an end is retried past a third write, never overwrites an earlier end, and a row deleted meanwhile is gone (R52)", async () => {
  // (a) W (61 s, its read failed) saves first; E (59 s: LEAD at the stop, FAST
  // one short) loses, and a third request's write lands before E's merge. D
  // (60 s: FAST at the stop) then finds the end at 59 s: LEAD was there first.
  const retry = await concurrentRide();
  retry.provider.snapshots = [new Error("synthetic provider failure"), retry.snapshot(59, { LEAD: 8, FAST: 7 }), retry.snapshot(60, { FAST: 8 })];
  let saves = 0;
  const crowded: JourneySessionStore = {
    load: (id) => retry.store.load(id),
    create: (session) => retry.store.create(session),
    delete: (id) => retry.store.delete(id),
    save: async (session, version) => {
      saves += 1;
      if (saves === 2) {
        const row = (await retry.store.load("ride"))!;
        await retry.store.save({ ...row.session, consecutiveProviderFailures: row.session.consecutiveProviderFailures + 1 }, row.version);
      }
      return retry.store.save(session, version);
    },
  };
  const rw = await retry.begin(() => retry.coordinator(61).refresh("ride"));
  const re = await retry.begin(() => retry.coordinator(59, crowded).refresh("ride"));
  const rd = await retry.begin(() => retry.coordinator(60).refresh("ride"));
  retry.provider.releaseNext();
  await rw.result;
  retry.provider.releaseNext();
  await re.result;
  retry.provider.releaseNext();
  await rd.result;
  const kept = (await retry.store.load("ride"))?.session;
  assert.equal(kept?.selectedVehicleId, "LEAD");
  assert.equal(kept?.boardingWatch?.endedAt, retry.at(59));
  assert.equal(saves, 3);

  // (b) W ends the watch at 59 s and saves first; E ends it at 62 s and loses:
  // it does not overwrite the earlier end, so D (60 s, FAST at the stop) still
  // finds LEAD there first.
  const overwrite = await concurrentRide();
  overwrite.provider.snapshots = [
    overwrite.snapshot(59, { LEAD: 8, FAST: 6 }),
    overwrite.snapshot(62, { LEAD: 9, FAST: 7 }),
    overwrite.snapshot(60, { FAST: 8 }),
  ];
  const ow = await overwrite.begin(() => overwrite.coordinator(59).refresh("ride"));
  const oe = await overwrite.begin(() => overwrite.coordinator(62).refresh("ride"));
  const od = await overwrite.begin(() => overwrite.coordinator(60).refresh("ride"));
  overwrite.provider.releaseNext();
  await ow.result;
  overwrite.provider.releaseNext();
  await oe.result;
  overwrite.provider.releaseNext();
  await od.result;
  const stood = (await overwrite.store.load("ride"))?.session;
  assert.equal(stood?.selectedVehicleId, "LEAD");
  assert.equal(stood?.boardingWatch?.endedAt, overwrite.at(59));

  // (c) W saves first, and the row is deleted before E's merge: the session no
  // longer exists, and E says so.
  const vanish = await concurrentRide();
  vanish.provider.snapshots = [vanish.snapshot(62, { LEAD: 7 }), vanish.snapshot(59, { LEAD: 8, FAST: 7 })];
  let vanishSaves = 0;
  const vanishing: JourneySessionStore = {
    load: (id) => vanish.store.load(id),
    create: (session) => vanish.store.create(session),
    delete: (id) => vanish.store.delete(id),
    save: async (session, version) => {
      vanishSaves += 1;
      if (vanishSaves === 2) await vanish.store.delete("ride");
      return vanish.store.save(session, version);
    },
  };
  const vw = await vanish.begin(() => vanish.coordinator(62).refresh("ride"));
  const ve = await vanish.begin(() => vanish.coordinator(59, vanishing).refresh("ride"));
  vanish.provider.releaseNext();
  await vw.result;
  vanish.provider.releaseNext();
  await assert.rejects(ve.result, SessionExpiredError);
});

test("the watch's anchor moves to every sighting before the stop, however far, round a loop too, and survives the selected bus going out of sight (R51, R53)", async () => {
  // (a) LEAD is selected four out, then read a stop further back (five out,
  // beyond the approach window) at 30 s and 60 s, so the last sighting before
  // the stop is at 60 s. At 90 s a garbled row puts it two past: seven stops in
  // thirty seconds, no crossing. FAST then reaches the stop, and LEAD never did.
  const zone = overtakingRide();
  assert.equal((await zone.at(0, { LEAD: 4, FAST: 1 }).create(zone.input)).selectedVehicleId, "LEAD");
  for (const [seconds, positions] of [[30, { LEAD: 3, FAST: 2 }], [60, { LEAD: 3, FAST: 4 }], [90, { LEAD: 10, FAST: 6 }]] as const) {
    await zone.at(seconds, positions).refresh("ride");
  }
  assert.equal(await watchEnded(zone.store), false);
  const zoneView = await zone.at(120, { LEAD: 5, FAST: 8 }).refresh("ride");
  assert.equal(zoneView.selectedVehicleId, undefined);
  assert.equal(zoneView.state, "confirmation_required");

  // (b) A lap of eleven, the rider at 5: LEAD one short at 30 s, three past at
  // 35 s (too soon, and not where the next is measured from), four past at 90 s
  // (four stops in sixty seconds from one short: a crossing).
  const loop = overtakingRide({ loop: true, boardingStopSequence: 5 });
  assert.equal((await loop.at(0, { LEAD: 3, FAST: 10 }).create(loop.input)).selectedVehicleId, "LEAD");
  await loop.at(30, { LEAD: 4, FAST: 1 }).refresh("ride");
  await loop.at(35, { LEAD: 8, FAST: 1 }).refresh("ride");
  assert.equal(await watchEnded(loop.store), false);
  await loop.at(90, { LEAD: 9, FAST: 3 }).refresh("ride");
  assert.equal(await watchEnded(loop.store), true);
  assert.equal((await loop.at(120, { LEAD: 10, FAST: 5 }).refresh("ride")).selectedVehicleId, "LEAD");

  // (c) LEAD one short at 30 s, out of sight at 60 s, two past at 90 s: three
  // stops in sixty seconds from the last sighting before the stop.
  const away = overtakingRide();
  assert.equal((await away.at(0, { LEAD: 5, FAST: 1 }).create(away.input)).selectedVehicleId, "LEAD");
  await away.at(30, { LEAD: 7, FAST: 3 }).refresh("ride");
  await away.at(60, { FAST: 5 }).refresh("ride");
  assert.equal(await watchEnded(away.store), false);
  await away.at(90, { LEAD: 10, FAST: 6 }).refresh("ride");
  assert.equal(await watchEnded(away.store), true);
  assert.equal((await away.at(120, { LEAD: 11, FAST: 8 }).refresh("ride")).selectedVehicleId, "LEAD");
});

test("round a loop, another bus read a stop back never hides a bus first seen past the stop: the selection is withdrawn (R48)", async () => {
  // A lap of eleven, the rider waiting at 5, LEAD selected two out, FAR three
  // past. At 60 s FAR reads a stop back (8 to 7), which only the time allows,
  // and NEW is seen for the first time two past, where it could have been at
  // the stop since the rider began waiting: a sighting, which is kept first.
  const ride = overtakingRide({ loop: true, boardingStopSequence: 5 });
  assert.equal((await ride.at(0, { LEAD: 3, FAR: 8 }).create(ride.input)).selectedVehicleId, "LEAD");
  await ride.at(30, { LEAD: 3, FAR: 8 }).refresh("ride");
  const view = await ride.at(60, { LEAD: 4, FAR: 7, NEW: 7 }).refresh("ride");
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.state, "confirmation_required");
});

test("a stored automatic selection written before the watch existed starts one from its memory", async () => {
  const route = longRoute();
  const now = new Date("2026-09-29T09:05:00Z");
  const seenAt = new Date(now.getTime() - 30_000).toISOString();
  const store = new MemoryJourneySessionStore();
  const legacy: StoredJourneySession = {
    schemaVersion: JOURNEY_SESSION_SCHEMA_VERSION,
    id: "pre-watch",
    routeId,
    cityCode,
    boardingStopSequence: 8,
    destinationStopSequence: 11,
    directionCode: "1",
    stops: route,
    boardingStop: { ...route[7]! },
    destinationStop: { ...route[10]! },
    selectedVehicleId: "LEAD",
    selectionMode: "automatic",
    matchConfidence: "high",
    createdAtMs: now.getTime() - 60_000,
    updatedAtMs: now.getTime() - 30_000,
    expiresAtMs: now.getTime() + 60 * 60_000,
    cadenceHistory: [],
    consecutiveProviderFailures: 0,
    passage: {
      offsets: {
        LEAD: { min: -3, max: -3, last: -3, lastSeenAt: seenAt },
        FAST: { min: -7, max: -7, last: -7, lastSeenAt: seenAt },
      },
      initial: ["FAST", "LEAD"],
    },
  };
  assert.equal((await store.create(legacy)).outcome, "saved");
  const provider = new LongRouteProvider(route);
  provider.vehiclesValue = [
    { vehicleId: "LEAD", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 7 },
    { vehicleId: "FAST", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 9 },
  ];
  const view = await new JourneySessionCoordinator(provider, { now: () => now, store, automaticMatchingEnabled: true })
    .refresh("pre-watch");
  assert.equal(view.selectedVehicleId, undefined);
  assert.equal(view.state, "confirmation_required");
});

/* ------------------------------------------ Live Activity push token (milestone 2) */

// SYNTHETIC: an invented token; no device produced it.
const PUSH_TOKEN = "0a1b".repeat(16);

test("a Live Activity push token is stored on the session, survives a refresh, and goes with the ride", async () => {
  const store = new MemoryJourneySessionStore();
  const provider = new MutableProvider();
  const now = new Date("2026-10-01T09:00:00Z");
  provider.vehiclesValue = [
    { vehicleId: "BUS-A", routeId, observedAt: now.toISOString(), directionCode: "1", stopSequence: 2 },
  ];
  const coordinator = new JourneySessionCoordinator(provider, { now: () => now, store, idFactory: () => "push-1" });
  await coordinator.create(onBoardInput());

  const registered = await coordinator.registerLiveActivityToken("push-1", { pushToken: PUSH_TOKEN.toUpperCase() });
  assert.equal(registered.sessionId, "push-1");
  assert.equal(registered.liveActivityPush.registered, true);
  assert.match(registered.liveActivityPush.fingerprint, /^[0-9a-f]{12}$/);
  assert.equal(registered.liveActivityPush.registeredAt, now.toISOString());
  assert.ok(!JSON.stringify(registered).includes(PUSH_TOKEN), "the answer carries the fingerprint, never the token");
  assert.equal((await store.load("push-1"))?.session.liveActivityPush?.token, PUSH_TOKEN, "stored normalised to lower case");

  const view = await coordinator.refresh("push-1");
  assert.ok(!JSON.stringify(view).includes(PUSH_TOKEN), "a session view never carries the token");
  assert.equal((await store.load("push-1"))?.session.liveActivityPush?.token, PUSH_TOKEN, "a refresh keeps it");

  // Rotation is a re-registration: the new token replaces the old one.
  const rotated = "ff".repeat(32);
  await coordinator.registerLiveActivityToken("push-1", { pushToken: rotated });
  assert.equal((await store.load("push-1"))?.session.liveActivityPush?.token, rotated);

  await coordinator.clearLiveActivityToken("push-1");
  assert.equal((await store.load("push-1"))?.session.liveActivityPush, undefined);
  await coordinator.clearLiveActivityToken("push-1"); // clearing nothing is not an error

  await coordinator.registerLiveActivityToken("push-1", { pushToken: PUSH_TOKEN });
  await coordinator.end("push-1");
  assert.equal(await store.load("push-1"), undefined, "ending the ride removes the row and the token in it");
  await assert.rejects(coordinator.registerLiveActivityToken("push-1", { pushToken: PUSH_TOKEN }), SessionNotFoundError);
});

test("a push token that is not a hexadecimal token is refused without echoing it", async () => {
  const provider = new MutableProvider();
  const coordinator = new JourneySessionCoordinator(provider, { idFactory: () => "push-2" });
  await coordinator.create(onBoardInput());
  for (const body of [undefined, [], {}, { pushToken: 42 }, { pushToken: "abc" }, { pushToken: "zz".repeat(32) }, { pushToken: "a".repeat(513) }]) {
    await assert.rejects(coordinator.registerLiveActivityToken("push-2", body), (error: unknown) => {
      assert.ok(error instanceof SessionInputError);
      assert.ok(!error.message.includes("zz".repeat(32)));
      return true;
    });
  }
});

test("a token registration and a refresh racing for one session both land", async () => {
  const store = new MemoryJourneySessionStore();
  const provider = new BarrierProvider();
  const now = new Date("2026-10-01T09:10:00Z");
  const bus = (stopSequence: number): VehicleObservation => ({
    vehicleId: "BUS-A",
    routeId,
    observedAt: now.toISOString(),
    directionCode: "1",
    stopSequence,
  });
  const options = { now: () => now, store, automaticMatchingEnabled: true };
  provider.snapshots = [[bus(2)]];
  await new JourneySessionCoordinator(provider, { ...options, idFactory: () => "push-race" }).create(onBoardInput());

  // A refresh reads the row, then waits on the provider while the app
  // registers its token on another instance.
  provider.gated = true;
  provider.snapshots = [[bus(3)]];
  const refreshing = new JourneySessionCoordinator(provider, options).refresh("push-race");
  await tick();
  await new JourneySessionCoordinator(provider, options).registerLiveActivityToken("push-race", { pushToken: PUSH_TOKEN });
  provider.releaseNext();
  await refreshing;
  // The refresh lost its compare-and-set and wrote nothing over the token.
  assert.equal((await store.load("push-race"))?.session.liveActivityPush?.token, PUSH_TOKEN);

  // The other order: a write lands between the registration's read and its
  // save. The registration re-reads and applies itself to the newer row.
  let interleave = true;
  const racing: JourneySessionStore = {
    load: (id) => store.load(id),
    create: (session) => store.create(session),
    delete: (id) => store.delete(id),
    async save(session, expectedVersion) {
      if (interleave) {
        interleave = false;
        const current = (await store.load(session.id))!;
        await store.save({ ...current.session, riderState: "on_board", matchConfidence: "low" }, current.version);
      }
      return store.save(session, expectedVersion);
    },
  };
  const rotated = "ff".repeat(32);
  await new JourneySessionCoordinator(provider, { ...options, store: racing }).registerLiveActivityToken("push-race", { pushToken: rotated });
  const after = (await store.load("push-race"))!.session;
  assert.equal(after.liveActivityPush?.token, rotated);
  assert.equal(after.matchConfidence, "low", "the write that won first is kept");

  // A session other requests keep winning is answered as busy, after a bounded number of tries.
  const alwaysLosing: JourneySessionStore = { ...racing, save: async () => ({ outcome: "conflict", stored: await store.load("push-race") }) };
  await assert.rejects(
    new JourneySessionCoordinator(provider, { ...options, store: alwaysLosing }).registerLiveActivityToken("push-race", { pushToken: PUSH_TOKEN }),
    SessionWriteConflictError,
  );
});
