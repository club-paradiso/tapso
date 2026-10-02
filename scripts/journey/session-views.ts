/**
 * Generates `fixtures/journey/session-views-v1.json`: real `JourneySessionView`
 * payloads produced by the server's own coordinator, in production posture
 * (shadow matching, explicit confirmation), on a SYNTHETIC route and
 * SYNTHETIC buses. The Swift core decodes every one of them and checks what
 * the app shows (`LiveSessionInterpreterTests.swift`), so the app's reading of
 * a session can never drift from what the server actually sends.
 *
 *   node --experimental-strip-types scripts/journey/session-views.ts [--check]
 *
 * `--check` regenerates in memory and exits 1 if the committed file differs.
 * No network, no credential, no real vehicle.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { RouteRequest, StopOnRoute, VehicleObservation } from "../../services/api/src/domain.ts";
import { JourneySessionCoordinator, type JourneySessionView } from "../../services/api/src/journeySession.ts";
import { ProviderTimeoutError, type TransitProvider } from "../../services/api/src/provider.ts";

const routeId = "SYN-ROUTE-202";
const cityCode = "999";
const stops: StopOnRoute[] = Array.from({ length: 12 }, (_, index) => ({
  stopId: `SYN-STOP-${index + 1}`,
  name: `합성 정류장 ${index + 1}`,
  sequence: index + 1,
  latitude: 33.45 + index * 0.002,
  longitude: 126.3 + index * 0.002,
}));

class ScriptedProvider implements TransitProvider {
  rows: VehicleObservation[] = [];
  failure: Error | undefined;
  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    return stops.map((stop) => ({ ...stop }));
  }
  async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> {
    if (this.failure) throw this.failure;
    return this.rows.map((row) => ({ ...row }));
  }
}

/** A TAGO-shaped row: no provider observation time, TAPSO's receipt only. */
function row(vehicleId: string, at: Date, sequence: number): VehicleObservation {
  const stop = stops[sequence - 1]!;
  return {
    vehicleId,
    routeId,
    observedAt: new Date(0).toISOString(),
    receivedAt: at.toISOString(),
    timestampSource: "unavailable",
    stopSequence: sequence,
    latitude: stop.latitude,
    longitude: stop.longitude,
  };
}

const scenarios: Array<{ id: string; why: string; view: JourneySessionView }> = [];
const record = (id: string, why: string, view: JourneySessionView) => scenarios.push({ id, why, view });

async function waitingRide(): Promise<void> {
  const provider = new ScriptedProvider();
  let now = new Date("2026-10-01T06:00:00.000Z");
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "syn-session-ride" });
  const input = { routeId, cityCode, boardingStopSequence: 4, destinationStopSequence: 10 };

  // Only a bus that has already left the boarding stop: the full ranking is
  // published, and it must never become a proposal.
  provider.rows = [row("SYN70가0905", now, 6)];
  record("awaiting-departed-only", "only a departed bus is on the route", await sessions.create(input));

  now = new Date(now.getTime() + 10_000);
  provider.rows = [row("SYN70가0905", now, 7), row("SYN70가0412", now, 2)];
  record("confirmation-one", "one bus approaching the boarding stop", await sessions.refresh("syn-session-ride"));

  now = new Date(now.getTime() + 10_000);
  provider.rows = [row("SYN70가0905", now, 8), row("SYN70가0412", now, 3), row("SYN70가0388", now, 2)];
  record("confirmation-two", "two buses approaching, one close behind the other", await sessions.refresh("syn-session-ride"));

  now = new Date(now.getTime() + 10_000);
  provider.rows = [row("SYN70가0412", now, 4), row("SYN70가0388", now, 3)];
  record("confirmed-tracking", "the rider confirmed a bus whose cadence evidence is already fresh", await sessions.confirm("syn-session-ride", { vehicleId: "SYN70가0412" }));

  for (const [sequence, id, why] of [
    [5, "tracking-riding", "fresh progress, five stops left"],
    [6, "tracking-riding-later", "fresh progress, four stops left"],
    [8, "tracking-prepare", "two stops left"],
    [9, "tracking-next-stop", "the next stop is the destination"],
    [10, "arrived", "at the destination"],
  ] as const) {
    now = new Date(now.getTime() + 10_000);
    provider.rows = [row("SYN70가0412", now, sequence)];
    record(id, why, await sessions.refresh("syn-session-ride"));
  }

  now = new Date(now.getTime() + 10_000);
  provider.failure = new ProviderTimeoutError("TAGO request timed out");
  record("degraded-provider-timeout", "the bus feed timed out once; last progress retained", await sessions.refresh("syn-session-ride"));
}

async function earlyConfirmation(): Promise<void> {
  const provider = new ScriptedProvider();
  const now = new Date("2026-10-01T06:30:00.000Z");
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "syn-session-early" });
  provider.rows = [row("SYN70가0611", now, 3)];
  await sessions.create({ routeId, cityCode, boardingStopSequence: 4, destinationStopSequence: 9 });
  record(
    "confirmed-cadence-unknown",
    "confirmed on the first poll: no cadence evidence yet, so no progress is shown",
    await sessions.confirm("syn-session-early", { vehicleId: "SYN70가0611" }),
  );
}

async function passedRide(): Promise<void> {
  const provider = new ScriptedProvider();
  let now = new Date("2026-10-01T07:00:00.000Z");
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "syn-session-passed" });
  provider.rows = [row("SYN70가0777", now, 2)];
  await sessions.create({ routeId, cityCode, boardingStopSequence: 3, destinationStopSequence: 6 });
  now = new Date(now.getTime() + 10_000);
  provider.rows = [row("SYN70가0777", now, 3)];
  await sessions.confirm("syn-session-passed", { vehicleId: "SYN70가0777" });
  for (const sequence of [4, 5]) {
    now = new Date(now.getTime() + 10_000);
    provider.rows = [row("SYN70가0777", now, sequence)];
    await sessions.refresh("syn-session-passed");
  }
  now = new Date(now.getTime() + 10_000);
  provider.rows = [row("SYN70가0777", now, 7)];
  record("passed-destination", "the bus was next seen one stop past the destination", await sessions.refresh("syn-session-passed"));
}

async function lostRide(): Promise<void> {
  const provider = new ScriptedProvider();
  let now = new Date("2026-10-01T08:00:00.000Z");
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "syn-session-lost" });
  provider.rows = [row("SYN70가0555", now, 2)];
  await sessions.create({ routeId, cityCode, boardingStopSequence: 3, destinationStopSequence: 11 });
  for (const sequence of [3, 4, 5]) {
    now = new Date(now.getTime() + 10_000);
    provider.rows = [row("SYN70가0555", now, sequence)];
    if (sequence === 3) await sessions.confirm("syn-session-lost", { vehicleId: "SYN70가0555" });
    else await sessions.refresh("syn-session-lost");
  }
  now = new Date(now.getTime() + 20_000);
  provider.rows = [];
  record("degraded-missing", "the bus dropped out of the feed inside the grace window", await sessions.refresh("syn-session-lost"));
  now = new Date(now.getTime() + 120_000);
  record("lost", "the bus has been missing beyond the grace window", await sessions.refresh("syn-session-lost"));
}

/**
 * Issue #80: at `READY_FOR_SHADOW` the rider is shown raw positions, not the
 * matcher's confirmation list. The bus at the stop and the one seven stops out
 * (beyond the matcher's approach window) are both listed, nearest first; the
 * same snapshot under a confirmation-assisted readiness is the matcher's list.
 */
async function riderIdentifies(): Promise<void> {
  const now = new Date("2026-10-01T09:00:00.000Z");
  const rows = () => [row("SYN70가0123", now, 3), row("SYN70가0456", now, 10), row("SYN70가0789", now, 9), row("SYN70가0999", now, 12)];
  const input = { routeId, cityCode, boardingStopSequence: 10, destinationStopSequence: 12 };
  const shadow = new ScriptedProvider();
  shadow.rows = rows();
  const atShadow = new JourneySessionCoordinator(shadow, { now: () => now, idFactory: () => "syn-session-identify" });
  record(
    "rider-identifies-at-shadow",
    "READY_FOR_SHADOW: raw positions nearest first, the bus at the stop and one beyond the matcher's window included, the departed one left out",
    await atShadow.create(input),
  );
  const assisted = new ScriptedProvider();
  assisted.rows = rows();
  const atAssisted = new JourneySessionCoordinator(assisted, {
    now: () => now,
    idFactory: () => "syn-session-suggest",
    matchingReadiness: "READY_FOR_CONFIRMATION_ASSISTED",
  });
  record(
    "matcher-suggestion-at-confirmation-assisted",
    "READY_FOR_CONFIRMATION_ASSISTED (not demonstrated; generated to pin the switch): the matcher's confirmation list may be suggested",
    await atAssisted.create(input),
  );
}

await waitingRide();
await earlyConfirmation();
await passedRide();
await lostRide();
await riderIdentifies();

const out = path.resolve("fixtures/journey/session-views-v1.json");
const text = `${JSON.stringify({
  "//": "SYNTHETIC. Generated by scripts/journey/session-views.ts from the server's own JourneySessionCoordinator in production posture (shadow matching, explicit confirmation). Synthetic route, stops and vehicle numbers; no real ride. Regenerate after any change to the session view; CI checks it is current.",
  scenarios,
}, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const committed = readFileSync(out, "utf8");
  if (committed !== text) {
    console.error("fixtures/journey/session-views-v1.json is out of date; run scripts/journey/session-views.ts");
    process.exit(1);
  }
  console.log(`session views current (${scenarios.length} scenarios)`);
} else {
  writeFileSync(out, text);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${scenarios.length} scenarios)`);
}
