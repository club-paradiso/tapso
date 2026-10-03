import test from "node:test";
import assert from "node:assert/strict";
import { JourneySessionCoordinator } from "../src/journeySession.ts";
import { chordDistanceMeters, evaluateConfirmedProgression } from "../src/confirmedRideProgression.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import type { TransitProvider } from "../src/provider.ts";

/**
 * SYNTHETIC: an invented route of ten stops about 500 m apart, invented
 * vehicle ids, TAGO-shaped rows (no provider observation time). Nothing here
 * is a real ride. The scenario shapes are those of the 3001 / 3913 ride of
 * 2026-10-03 (`docs/validation/RIDE_3001_FALSE_DELAY_2026-10-04.md`): a
 * rider-confirmed bus on a healthy provider that the matcher's cadence gate
 * nevertheless refused to advance.
 */
const routeId = "SYN-3001";
const cityCode = "999";
const stops: StopOnRoute[] = Array.from({ length: 10 }, (_, index) => ({
  stopId: `S${index + 1}`,
  name: `합성 ${index + 1}`,
  sequence: index + 1,
  latitude: 33.5 + index * 0.0045, // ≈ 500 m per stop
  longitude: 126.5,
}));

class Provider implements TransitProvider {
  rows: VehicleObservation[] = [];
  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    return stops.map((stop) => ({ ...stop }));
  }
  async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> {
    return this.rows.map((row) => ({ ...row }));
  }
}

function row(vehicleId: string, at: Date, sequence: number | undefined, extra: Partial<VehicleObservation> = {}): VehicleObservation {
  const stop = sequence === undefined ? undefined : stops[sequence - 1];
  return {
    vehicleId,
    routeId,
    observedAt: new Date(0).toISOString(),
    receivedAt: at.toISOString(),
    timestampSource: "unavailable",
    directionCode: "1",
    ...(sequence === undefined ? {} : { stopSequence: sequence }),
    ...(stop ? { latitude: stop.latitude, longitude: stop.longitude } : {}),
    ...extra,
  };
}

async function confirmedRide(start = "2026-10-03T09:00:00Z") {
  const provider = new Provider();
  const clock = { now: new Date(start) };
  provider.rows = [row("BUS-3913", clock.now, 2)];
  const sessions = new JourneySessionCoordinator(provider, { now: () => clock.now, idFactory: () => "ride-3001" });
  const created = await sessions.create({ routeId, cityCode, boardingStopSequence: 2, destinationStopSequence: 8, directionCode: "1" });
  const confirmed = await sessions.confirm(created.id, { vehicleId: "BUS-3913" });
  const advance = (seconds: number) => { clock.now = new Date(clock.now.getTime() + seconds * 1_000); return clock.now; };
  return { provider, sessions, id: created.id, confirmed, clock, advance };
}

/* ------------------------------------------------------------- acceptance */

test("false-delay acceptance: a confirmed bus on a responding provider is live even while the matcher's cadence is unknown", async () => {
  const { confirmed } = await confirmedRide();
  // HTTP succeeded, the provider answered, the confirmed bus is in the snapshot,
  // the provider publishes no timestamp and the matcher has one receipt.
  assert.equal(confirmed.state, "tracking");
  assert.equal(confirmed.progress?.remainingStops, 6);
  assert.equal(confirmed.progress?.evidenceAtIs, "tapso_server_receipt");
  assert.deepEqual(confirmed.reliability, {
    provider: "responding",
    observation: "changing",
    position: "official",
    vehicle: "confirmed",
    matcherCadence: "unknown",
    trust: "live",
  });
});

test("valid monotonic progression advances the count on every changed row and holds it on an unchanged one", async () => {
  const { provider, sessions, id, advance } = await confirmedRide();
  for (const [sequence, remaining, observation] of [[3, 5, "changing"], [3, 5, "unchanged"], [4, 4, "changing"], [5, 3, "changing"], [6, 2, "changing"]] as const) {
    provider.rows = [row("BUS-3913", advance(15), sequence)];
    const view = await sessions.refresh(id);
    assert.equal(view.state, "tracking", `sequence ${sequence}`);
    assert.equal(view.progress?.remainingStops, remaining);
    assert.equal(view.progress?.source, "provider_stop_sequence");
    assert.equal(view.reliability?.observation, observation);
    assert.equal(view.reliability?.trust, "live");
  }
  provider.rows = [row("BUS-3913", advance(15), 7)];
  assert.equal((await sessions.refresh(id)).progress?.phase, "next_stop");
  provider.rows = [row("BUS-3913", advance(15), 8)];
  const arrived = await sessions.refresh(id);
  assert.equal(arrived.state, "arrived");
  assert.equal(arrived.progress?.remainingStops, 0);
});

test("a cached snapshot (same receipt) retains the count and stays tracking; it is never a new sample", async () => {
  const { provider, sessions, id, advance, clock } = await confirmedRide();
  const receipt = advance(15);
  provider.rows = [row("BUS-3913", receipt, 3)];
  const first = await sessions.refresh(id);
  assert.equal(first.progress?.currentStopSequence, 3);
  // The next poll is answered from the 20 s vehicle cache: identical row, identical receipt.
  clock.now = new Date(clock.now.getTime() + 15_000);
  const cached = await sessions.refresh(id);
  assert.equal(cached.state, "tracking");
  assert.equal(cached.progress?.currentStopSequence, 3);
  assert.equal(cached.progress?.source, "retained_last_known");
  assert.equal(cached.reliability?.observation, "unchanged");
  assert.equal(cached.reliability?.trust, "live");
  assert.equal(cached.sourceFreshness?.["BUS-3913"]?.sampleCount, 2, "a cached receipt adds no cadence sample");
});

test("the automatic matcher's gate is unchanged: an automatically selected bus still needs fresh cadence", async () => {
  const provider = new Provider();
  let now = new Date("2026-10-03T10:00:00Z");
  provider.rows = [row("BUS-A", now, 1)];
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "auto", automaticMatchingEnabled: true });
  const created = await sessions.create({ routeId, cityCode, boardingStopSequence: 3, destinationStopSequence: 8, directionCode: "1" });
  assert.equal(created.selectedVehicleId, undefined, "one receipt never selects");
  now = new Date(now.getTime() + 5_000);
  provider.rows = [row("BUS-A", now, 1)];
  await sessions.refresh(created.id);
  now = new Date(now.getTime() + 5_000);
  provider.rows = [row("BUS-A", now, 2)];
  const selected = await sessions.refresh(created.id);
  assert.equal(selected.selectionMode, "automatic");
  assert.equal(selected.state, "tracking");
  // A 40 s hole breaks the matcher's receipt chain: the automatic selection degrades, as before.
  now = new Date(now.getTime() + 40_000);
  provider.rows = [row("BUS-A", now, 2)];
  const aged = await sessions.refresh(created.id);
  assert.equal(aged.state, "degraded");
  assert.match(aged.explanation, /cadence evidence/);
});

/* -------------------------------------------------------------- rejections */

test("a route mismatch is rejected and the count retained", async () => {
  const { provider, sessions, id, advance } = await confirmedRide();
  provider.rows = [row("BUS-3913", advance(15), 3, { routeId: "SYN-OTHER" })];
  const view = await sessions.refresh(id);
  assert.equal(view.state, "degraded");
  assert.equal(view.trackingIntegrity, "route_conflict");
  assert.equal(view.progress?.currentStopSequence, 2);
  assert.equal(view.progress?.source, "retained_last_known");
  assert.equal(view.reliability?.vehicle, "rechecking");
});

test("a direction mismatch is rejected", async () => {
  const { provider, sessions, id, advance } = await confirmedRide();
  provider.rows = [row("BUS-3913", advance(15), 3, { directionCode: "2" })];
  const view = await sessions.refresh(id);
  assert.equal(view.state, "degraded");
  assert.equal(view.trackingIntegrity, "direction_conflict");
  assert.equal(view.reliability?.observation, "conflicted");
});

test("a vehicle identity change is never followed: the confirmed bus missing is rechecking, then lost", async () => {
  const { provider, sessions, id, advance } = await confirmedRide();
  provider.rows = [row("BUS-OTHER", advance(15), 3)];
  const missing = await sessions.refresh(id);
  assert.equal(missing.state, "degraded");
  assert.equal(missing.selectedVehicleId, "BUS-3913");
  assert.equal(missing.reliability?.vehicle, "rechecking");
  assert.equal(missing.reliability?.trust, "rechecking");
  provider.rows = [row("BUS-OTHER", advance(90), 4)];
  const lost = await sessions.refresh(id);
  assert.equal(lost.state, "lost");
  assert.equal(lost.selectedVehicleId, "BUS-3913", "no rematch on a confirmed ride");
  assert.equal(lost.reliability?.vehicle, "lost");
  assert.equal(lost.reliability?.trust, "unavailable");
});

test("a backward sequence is rejected", async () => {
  const { provider, sessions, id, advance } = await confirmedRide();
  provider.rows = [row("BUS-3913", advance(45), 4)];
  assert.equal((await sessions.refresh(id)).progress?.currentStopSequence, 4);
  provider.rows = [row("BUS-3913", advance(15), 3)];
  const view = await sessions.refresh(id);
  assert.equal(view.state, "degraded");
  assert.equal(view.trackingIntegrity, "backward_conflict");
  assert.equal(view.progress?.currentStopSequence, 4);
});

test("an impossible forward jump is rejected: five stops (≈2 km) in 15 s", async () => {
  const { provider, sessions, id, advance } = await confirmedRide();
  provider.rows = [row("BUS-3913", advance(15), 7)];
  const view = await sessions.refresh(id);
  assert.equal(view.state, "degraded");
  assert.equal(view.trackingIntegrity, "implausible_jump");
  assert.equal(view.progress?.currentStopSequence, 2);
  // The same position two minutes later is plausible and is accepted.
  provider.rows = [row("BUS-3913", advance(120), 7)];
  const later = await sessions.refresh(id);
  assert.equal(later.state, "tracking");
  assert.equal(later.progress?.currentStopSequence, 7);
});

test("a corrupt sequence is rejected", async () => {
  const { provider, sessions, id, advance } = await confirmedRide();
  provider.rows = [row("BUS-3913", advance(15), 3, { stopSequence: 2.5 })];
  const view = await sessions.refresh(id);
  assert.equal(view.state, "degraded");
  assert.equal(view.trackingIntegrity, "corrupt_sequence");
});

test("a sequence the variant does not have is a topology conflict", async () => {
  const { provider, sessions, id, advance } = await confirmedRide();
  provider.rows = [row("BUS-3913", advance(15), 3, { stopSequence: 42 })];
  const view = await sessions.refresh(id);
  assert.equal(view.state, "degraded");
  assert.equal(view.trackingIntegrity, "topology_conflict");
});

test("a row received outside the evidence window is stale, not progress", async () => {
  const { provider, sessions, id, advance, clock } = await confirmedRide();
  const old = new Date(clock.now.getTime() - 100_000);
  advance(15);
  provider.rows = [row("BUS-3913", old, 3)];
  const view = await sessions.refresh(id);
  assert.equal(view.state, "degraded");
  assert.equal(view.trackingIntegrity, undefined);
  assert.equal(view.reliability?.observation, "stale");
  assert.equal(view.progress?.currentStopSequence, 2);
});

test("an unseen destination passage needs a second sighting; seen from two stops out it is believed at once", async () => {
  const { provider, sessions, id, advance } = await confirmedRide();
  // Two polls of silence (the bus dropped out), then it reappears past the destination
  // from six stops out: plausible in 150 s, but never seen approaching.
  provider.rows = [];
  await sessions.refresh(id);
  provider.rows = [];
  await sessions.refresh(id);
  provider.rows = [row("BUS-3913", advance(150), 9)];
  const first = await sessions.refresh(id);
  assert.equal(first.state, "degraded");
  assert.equal(first.trackingIntegrity, "destination_passage_unconfirmed");
  assert.equal(first.progress?.currentStopSequence, 2, "no arrival or passage alert from one surprising row");
  provider.rows = [row("BUS-3913", advance(15), 9)];
  const second = await sessions.refresh(id);
  assert.equal(second.state, "passed_destination");
  assert.equal(second.progress?.phase, "passed_destination");

  // Seen two stops out and then past: believed on the first sighting.
  const near = await confirmedRide("2026-10-03T11:00:00Z");
  near.provider.rows = [row("BUS-3913", near.advance(60), 6)];
  assert.equal((await near.sessions.refresh(near.id)).progress?.remainingStops, 2);
  near.provider.rows = [row("BUS-3913", near.advance(60), 9)];
  const passed = await near.sessions.refresh(near.id);
  assert.equal(passed.state, "passed_destination");
});

test("a transient provider failure keeps the confirmed ride's count and says the provider, not the bus, is the problem", async () => {
  const { sessions, id, advance } = await confirmedRide();
  const provider = (sessions as unknown as { provider: Provider }).provider;
  provider.vehicles = async () => { throw new Error("TAGO payload has no body object"); };
  advance(15);
  const view = await sessions.refresh(id);
  assert.equal(view.state, "degraded");
  assert.equal(view.progress?.currentStopSequence, 2);
  assert.deepEqual(view.reliability, {
    provider: "temporarily_unavailable",
    observation: "unknown_timestamp",
    position: "last_known",
    vehicle: "confirmed",
    trust: "rechecking",
  });
});

test("recovery after a failure and a cache-held gap resumes live progression without rebuilding cadence first", async () => {
  const { sessions, id, advance, provider } = await confirmedRide();
  const vehicles = provider.vehicles.bind(provider);
  provider.vehicles = async () => { throw new Error("TAGO payload has no body object"); };
  advance(15);
  await sessions.refresh(id);
  provider.vehicles = vehicles;
  // 50 s later (a gap the matcher's 30 s rule would call stale) the bus is one stop on.
  provider.rows = [row("BUS-3913", advance(50), 3)];
  const resumed = await sessions.refresh(id);
  assert.equal(resumed.state, "tracking");
  assert.equal(resumed.progress?.currentStopSequence, 3);
  assert.equal(resumed.reliability?.trust, "live");
  assert.equal(resumed.reliability?.matcherCadence, "stale", "the matcher's verdict is still published truthfully");
});

/* ------------------------------------------------------------ pure policy */

test("chord distance sums consecutive stop chords and is undefined across an unsurveyed stop", () => {
  const metres = chordDistanceMeters(stops, 2, 4);
  assert.ok(metres !== undefined && metres > 900 && metres < 1_100, String(metres));
  assert.equal(chordDistanceMeters(stops, 3, 3), 0);
  const holed = stops.map((stop) => (stop.sequence === 3 ? { ...stop, latitude: undefined } : stop));
  assert.equal(chordDistanceMeters(holed, 2, 4), undefined);
});

test("the pure verdict accepts a near-stop estimate when the provider sends no sequence", () => {
  const at = new Date("2026-10-03T09:00:15Z");
  const verdict = evaluateConfirmedProgression({
    observation: row("BUS-3913", at, undefined, { latitude: stops[2]!.latitude! + 0.0003, longitude: stops[2]!.longitude }),
    evidenceAtMs: at.getTime(),
    now: at,
    routeId,
    directionCode: "1",
    stops,
    destinationSequence: 8,
    lastStep: { stopSequence: 2, evidenceAtMs: at.getTime() - 15_000 },
    nearStopRadiusMeters: 120,
  });
  assert.equal(verdict.kind, "accept");
  if (verdict.kind === "accept") {
    assert.equal(verdict.source, "near_stop_estimate");
    assert.equal(verdict.stop.sequence, 3);
  }
});
