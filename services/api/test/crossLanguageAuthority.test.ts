/**
 * Which matcher decides for a real rider, and the contract any other one must
 * meet before it may.
 *
 * TAPSO has two matchers. The backend `directed-route-progress-v1` in
 * `src/matching.ts` serves journey sessions and `POST /v1/matches`. The Swift
 * `VehicleMatchingEngine` in `packages/transit-core` models a different input
 * (a boarding tap and provider stop events), scores a bus one stop *past* the
 * boarding stop as plausible, and has no rider state. It is not equivalent and
 * does not pretend to be: it only drives the deterministic demo.
 *
 * These tests keep it that way. The live client (`packages/transit-core/Sources/TapsoTransit/Live/`)
 * talks to this server, which stays the only matcher: it may hold network code,
 * no other Swift source may, and no live type ever reaches the Swift engine. If
 * the app calls the Swift engine with anything but demo fixtures, these fail —
 * at which point the Swift engine has to pass `fixtures/transit/directed-matcher-invariants.json`
 * (below, run against the backend today) before it decides anything.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { MatchRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { MATCHER_POLICY_VERSION, matchVehicleWithSourceFreshness } from "../src/matching.ts";
import type { SourceFreshnessEvidence } from "../src/sourceFreshness.ts";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function swiftFiles(directory: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) out.push(...swiftFiles(path));
    else if (name.endsWith(".swift")) out.push(path);
  }
  return out;
}

const appSources = [...swiftFiles(join(repo, "apps/ios")), ...swiftFiles(join(repo, "packages/transit-core/Sources"))];

/** The only Swift sources allowed to speak HTTP: the live client, which reads from and confirms to this server. */
const LIVE_CLIENT = "packages/transit-core/Sources/TapsoTransit/Live/";
const NETWORK_FILES = new Set([`${LIVE_CLIENT}URLSessionTransport.swift`, `${LIVE_CLIENT}LiveEnvironment.swift`]);

test("only the live client speaks HTTP, so no real vehicle can reach the Swift matcher another way", () => {
  assert.ok(appSources.length > 0, "Swift sources were found");
  for (const file of appSources) {
    const path = relative(repo, file);
    if (NETWORK_FILES.has(path)) continue;
    const source = readFileSync(file, "utf8");
    for (const pattern of [/URLSession/, /URLRequest/, /NWConnection/, /https?:\/\//]) {
      assert.doesNotMatch(source, pattern, `${path} contains ${pattern}; network code belongs in ${LIVE_CLIENT} and nowhere else`);
    }
  }
});

test("the live client never touches the Swift matcher or its inputs", () => {
  const live = appSources.filter((file) => relative(repo, file).startsWith(LIVE_CLIENT));
  assert.ok(live.length >= 2, "the live client was found");
  for (const file of live) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /VehicleMatchingEngine|VehicleCandidate|MatchDecision/, relative(repo, file));
  }
  // Nor does the app's live ride: it lists raw positions, and the rider picks.
  const liveApp = appSources.filter((file) => /apps\/ios\/TapsoApp\/LiveRide\w*\.swift$/.test(relative(repo, file)));
  assert.ok(liveApp.length >= 3, "the app's live ride was found");
  for (const file of liveApp) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /VehicleMatchingEngine|VehicleCandidate|MatchDecision|DemoCatalog|DemoFixtures/, relative(repo, file));
  }
  // What the client decodes from a session: no ranking, no would-be pick.
  const models = readFileSync(join(repo, LIVE_CLIENT, "LiveModels.swift"), "utf8");
  assert.doesNotMatch(models, /\blet (candidates|shadowSelection|wouldSelectVehicleId)\b/);
});

test("the Swift VehicleMatchingEngine is called only by the demo, with demo fixtures", () => {
  const callSites = appSources
    .filter((file) => !file.endsWith("VehicleMatchingEngine.swift"))
    .flatMap((file) => readFileSync(file, "utf8").split("\n").map((line, index) => ({ file, line, index })))
    .filter(({ line }) => /VehicleMatchingEngine\(/.test(line));
  assert.deepEqual(callSites.map(({ file }) => relative(repo, file)), ["apps/ios/TapsoApp/TapsoAppModel.swift"]);
  const model = readFileSync(join(repo, "apps/ios/TapsoApp/TapsoAppModel.swift"), "utf8");
  const demo = model.slice(model.indexOf("func startDemo"), model.indexOf("func startDemo") + 1_200);
  assert.match(demo, /VehicleMatchingEngine\(\)\.match\(/);
  assert.match(demo, /DemoFixtures\.obviousCandidate\(\)/, "the only candidates the Swift engine ever sees are demo fixtures");
});

/* ------------------------------------------ shared specification cases */

interface SpecVehicle { id: string; seq: number | null; fresh?: boolean }
interface SpecCase {
  id: string;
  riderState: "waiting_at_stop" | "on_board";
  vehicles: SpecVehicle[];
  remembered?: Array<{ id: string; seq: number }>;
  passageWithheld?: boolean;
  omitStops?: boolean;
  expect: { status: "matched" | "ambiguous" | "unavailable"; selected?: string };
  why: string;
}

const spec = JSON.parse(readFileSync(join(repo, "fixtures/transit/directed-matcher-invariants.json"), "utf8")) as {
  policyVersion: string;
  route: { routeId: string; stopCount: number; boardingStopSequence: number };
  cases: SpecCase[];
};

test("the shared specification names the policy the backend serves", () => {
  assert.equal(spec.policyVersion, MATCHER_POLICY_VERSION);
  assert.ok(spec.cases.length >= 20);
});

const now = "2026-09-29T09:00:00.000Z";
const stops: StopOnRoute[] = Array.from({ length: spec.route.stopCount }, (_, index) => ({
  stopId: `SYN-SPEC-${index + 1}`,
  name: `Synthetic spec stop ${index + 1}`,
  sequence: index + 1,
}));

function evidence(fresh: boolean): SourceFreshnessEvidence {
  return {
    state: fresh ? "fresh" : "aging",
    sampleCount: 4,
    spanSeconds: 20,
    latestReceiptAgeSeconds: 0,
    maxReceiptGapSeconds: 5,
    contentChangeCount: fresh ? 2 : 0,
    sequenceDecreaseCount: 0,
    reason: "synthetic specification cadence",
  };
}

function observation(id: string, seq: number | null): VehicleObservation {
  return {
    vehicleId: id,
    routeId: spec.route.routeId,
    observedAt: new Date(0).toISOString(),
    receivedAt: now,
    timestampSource: "unavailable",
    ...(seq === null ? {} : { stopSequence: seq }),
  };
}

for (const specCase of spec.cases) {
  test(`specification ${specCase.id}: ${specCase.why}`, () => {
    const trusted = new Map(specCase.vehicles.map((vehicle) => [vehicle.id, evidence(vehicle.fresh !== false)]));
    const request: MatchRequest = {
      routeId: spec.route.routeId,
      boardingStopSequence: spec.route.boardingStopSequence,
      now,
      riderState: specCase.riderState,
      candidates: specCase.vehicles.map((vehicle) => observation(vehicle.id, vehicle.seq)),
      ...(specCase.omitStops ? {} : { stops }),
      ...(specCase.remembered ? { recentlySeen: specCase.remembered.map((row) => observation(row.id, row.seq)) } : {}),
      ...(specCase.passageWithheld
        ? { passage: { offsets: {}, withheld: { reason: "boarding_stop_reached_during_session", at: now } } }
        : {}),
    };
    const result = matchVehicleWithSourceFreshness(request, trusted);
    assert.equal(result.status, specCase.expect.status, `${specCase.id}: ${result.explanation}`);
    assert.equal(result.selectedVehicleId, specCase.expect.selected);
  });
}
