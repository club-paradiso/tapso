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
 * These tests keep it that way. The app has exactly one network path,
 * `apps/ios/TapsoApp/TapsoAPIClient.swift`, which talks only to TAPSO's own API
 * (where the directed matcher and the rider's confirmation decide) and never
 * touches a Swift matcher type. If any other Swift file gains a network path,
 * if the client reaches any other host, or if the Swift engine is called with
 * anything but demo fixtures, they fail — at which point the Swift engine has
 * to pass `fixtures/transit/directed-matcher-invariants.json` (below, run
 * against the backend today) before it decides anything.
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

/** The app's one network client, and the test that stubs it. Nothing else may reach the network. */
const NETWORK_CLIENT = "apps/ios/TapsoApp/TapsoAPIClient.swift";
const NETWORK_CLIENT_TESTS = "apps/ios/Tests/TapsoAPIClientTests.swift";
const TAPSO_API = "https://tapso-api.vercel.app";

test("the Swift core makes no network request, and the app reaches the network only through TapsoAPIClient", () => {
  assert.ok(appSources.length > 0, "Swift sources were found");
  assert.ok(appSources.some((file) => relative(repo, file) === NETWORK_CLIENT), "the network client exists");
  for (const file of appSources) {
    const path = relative(repo, file);
    const source = readFileSync(file, "utf8");
    const networkAllowed = path === NETWORK_CLIENT || path === NETWORK_CLIENT_TESTS;
    for (const pattern of [/URLSession/, /URLRequest/, /https?:\/\//]) {
      if (networkAllowed) continue;
      assert.doesNotMatch(source, pattern, `${path} contains ${pattern}; a network path outside TapsoAPIClient could let real data reach a non-authoritative matcher`);
    }
    assert.doesNotMatch(source, /NWConnection|URLSessionWebSocketTask|CFStream/, `${path} opens a raw connection`);
    // The government feed's credential stays on the server; no Swift file may address it.
    assert.doesNotMatch(source, /data\.go\.kr/, `${path} addresses the government feed directly`);
  }
});

test("the network client talks only to TAPSO's own API, through documented endpoints, and carries no Swift matcher type", () => {
  const client = readFileSync(join(repo, NETWORK_CLIENT), "utf8");
  assert.deepEqual([...new Set(client.match(/https?:\/\/[^"\s)`]+/g) ?? [])], [TAPSO_API]);
  // Code only: the client's documentation may name the matcher it must never feed.
  const code = client.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of [/VehicleMatchingEngine/, /VehicleMatchingInput/, /VehicleCandidate\b/, /VehicleObservation\b/, /BoardingContext/]) {
    assert.doesNotMatch(code, forbidden, `the network path must never feed the demo-only Swift matcher (${forbidden})`);
  }
  const paths = [...client.matchAll(/path: "([^"]+)"/g)].map((match) => match[1]!.replace(/\\\([^)]*\)\)?/g, ":id"));
  assert.ok(paths.length > 0);
  const documented = new Set(["/v1/routes", "/v1/stops", "/v1/route-info", "/v1/sessions", "/v1/sessions/:id", "/v1/sessions/:id/confirm"]);
  for (const path of paths) assert.ok(documented.has(path), `${path} is not a documented TAPSO endpoint`);
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
