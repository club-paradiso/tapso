import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { StopOnRoute, VehicleObservation } from "../src/domain.ts";
import {
  analyzeRideCapture,
  RIDE_CAPTURE_SCHEMA_VERSION,
  type RideCapture,
  type RideSnapshot,
} from "../src/rideCapture.ts";
import { buildCampaign, renderCampaignMarkdown, type CampaignInputFile } from "../src/rideCampaign.ts";

/**
 * Synthetic fixtures only. Vehicle numbers are placeholders, routes are not
 * real, and the coordinates are a synthetic grid, not real stop positions.
 */
const base = Date.parse("2026-09-22T09:00:00+09:00");
const stops: StopOnRoute[] = Array.from({ length: 8 }, (_, index) => ({
  stopId: `SYN-${index + 1}`,
  name: `Synthetic ${index + 1}`,
  sequence: index + 1,
  latitude: 33.5 + index * 0.01,
  longitude: 126.5,
}));
const BOARDED = "제주79자9999";
const OTHER = "제주79자8888";

function at(seconds: number): string {
  return new Date(base + seconds * 1_000).toISOString();
}

function tago(vehicleId: string, seconds: number, stopSequence: number, routeId: string): VehicleObservation {
  const stop = stops[stopSequence - 1]!;
  return {
    vehicleId,
    routeId,
    observedAt: new Date(0).toISOString(),
    receivedAt: at(seconds),
    timestampSource: "unavailable",
    stopId: stop.stopId,
    stopSequence,
    latitude: stop.latitude,
    longitude: stop.longitude,
    directionCode: "1",
    receiveType: "TAGO_SNAPSHOT",
  };
}

/**
 * The boarded bus moves from the boarding stop, so the matcher commits to it.
 * `capture()` stamps the `boarded` marker at the first snapshot, so the replay
 * decides for a rider already on board, and the commit comes once the bus is
 * fresh and one to four stops past the stop, where a bus the rider has just
 * boarded would be.
 */
function correctRide(routeId: string): RideSnapshot[] {
  return [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [tago(BOARDED, seconds, 3 + index, routeId)],
  }));
}

/**
 * The rider waits at stop 6 and lets the first bus go: `wrong`. The decoy is
 * two stops short of the stop, then one, moving all the while. The bus the
 * rider actually boards is held at stop 1, three stops behind the decoy at the
 * first look and four after: a lead clear by the margin at every decision. The
 * directed matcher cannot know the rider will skip the leading bus, and it
 * commits to it — a bus still approaching the stop, never one that has already
 * left it. (A decoy that began inside the margin of the boarded bus would
 * contest the approach for the session and never be selected: finding F22.)
 */
function wrongRide(routeId: string): RideSnapshot[] {
  return [0, 5, 10].map((seconds, index) => ({
    capturedAt: at(seconds),
    vehicles: [
      { ...tago(OTHER, seconds, [4, 5, 5][index]!, routeId), latitude: 33.53 + index * 0.0005 },
      tago(BOARDED, seconds, 1, routeId),
    ],
  }));
}

function capture(overrides: Partial<RideCapture> = {}): RideCapture {
  const routeId = overrides.routeId ?? "SYN-ROUTE-A";
  return {
    schemaVersion: RIDE_CAPTURE_SCHEMA_VERSION,
    startedAt: at(0),
    endedAt: at(60),
    routeId,
    cityCode: "999",
    boardingStopSequence: 3,
    destinationStopSequence: 7,
    boardedVehicleId: BOARDED,
    intervalMs: 5_000,
    stops,
    snapshots: correctRide(routeId),
    markers: [{ at: at(0), kind: "boarded", stopSequence: 3 }],
    captureEngine: "railway-background",
    source: "web-controller",
    ...overrides,
  };
}

/**
 * `wrongRide` captured while the rider was still waiting: the `boarded` marker
 * is stamped when they step on, after the first snapshot, so the replay decides
 * for `waiting_at_stop`. The boarding stop is sequence 6 so that all four
 * approach stops exist behind it.
 */
const WAITING_STOP = 6;
function wrongCapture(overrides: Partial<RideCapture> = {}): RideCapture {
  const routeId = overrides.routeId ?? "SYN-ROUTE-A";
  return capture({
    boardingStopSequence: WAITING_STOP,
    destinationStopSequence: 8,
    markers: [{ at: at(40), kind: "boarded", stopSequence: WAITING_STOP }],
    snapshots: wrongRide(routeId),
    ...overrides,
  });
}

function file(name: string, value: unknown): CampaignInputFile {
  return { name, content: JSON.stringify(value) };
}

test("a clean server-collected ride with a correct commit counts toward the thirty", () => {
  const campaign = buildCampaign([file("SYN-ROUTE-A-1.json", capture())]);
  const [ride] = campaign.rides;

  assert.equal(ride!.bucket, "CLEAN_GATE_CANDIDATE");
  assert.equal(ride!.policy, "DECIDED");
  assert.equal(ride!.matchGate?.selectionVerdict, "correct");
  assert.equal(campaign.counter.cleanObservedBoardings, 1);
  assert.equal(campaign.counter.remainingToThirty, 29);
  assert.match(campaign.counter.note, /does NOT close the gate/);
  assert.equal(campaign.assessment.correctCommitRate, 1);
  assert.equal(campaign.assessment.multipleRoutes, false, "one route is not multiple routes");
  assert.deepEqual(campaign.routes.cleanGateCandidatesPerRoute, { "SYN-ROUTE-A": 1 });
});

test("the per-ride numbers are exactly the analyzer's, not a second implementation", () => {
  const raw = wrongCapture();
  const campaign = buildCampaign([file("SYN-ROUTE-A-1.json", raw)]);
  const expected = analyzeRideCapture(raw).matchGate;
  const got = campaign.rides[0]!.matchGate!;

  assert.equal(got.selectionVerdict, expected.selectionVerdict);
  assert.equal(got.contestedDecisions, expected.contestedDecisions);
  assert.deepEqual(got.candidateMargin, expected.candidateMargin);
  assert.equal(got.selectionsWhileNotFresh, expected.staleData.selectionsWhileNotFresh);
  assert.equal(got.boardedDirectionChanges, expected.directionReversal.boardedDirectionChanges);
});

test("a wrong first commit is a gate failure: excluded from the count and surfaced", () => {
  const campaign = buildCampaign([file("SYN-ROUTE-A-1.json", wrongCapture())]);
  const [ride] = campaign.rides;

  assert.equal(ride!.bucket, "EXCLUDED");
  assert.ok(ride!.reasons.some((reason) => reason.startsWith("GATE_FAILURE")));
  assert.equal(campaign.counter.cleanObservedBoardings, 0);
  assert.equal(campaign.assessment.wrongFirstCommit, true);
  assert.equal(campaign.modernMatchGate.selectionVerdicts.wrong, 1);
  assert.match(renderCampaignMarkdown(campaign), /Wrong first commit: \*\*YES/);
});

test("a ride with no boarded vehicle is not usable for the gate", () => {
  const raw = capture();
  delete raw.boardedVehicleId;
  const campaign = buildCampaign([file("SYN-ROUTE-A-1.json", raw)]);

  assert.equal(campaign.rides[0]!.bucket, "EXCLUDED");
  assert.deepEqual(campaign.rides[0]!.reasons, ["matchGate.usableForGate is false"]);
  assert.equal(campaign.counter.cleanObservedBoardings, 0);
});

test("a browser capture that was backgrounded is confounded, never clean", () => {
  const raw = capture({
    captureEngine: "local-device",
    events: [{ at: at(2), kind: "hidden" }, { at: at(8), kind: "visible" }],
  });
  const campaign = buildCampaign([file("SYN-ROUTE-A-1.json", raw)]);

  assert.equal(campaign.rides[0]!.bucket, "HISTORICAL_CONFOUNDED");
  assert.equal(campaign.counter.cleanObservedBoardings, 0);
});

test("an unsuspended local-device or engine-less capture is UNRESOLVED, not promoted", () => {
  const local = capture({ captureEngine: "local-device" });
  const legacy = capture({ startedAt: at(1) });
  delete legacy.captureEngine;
  const campaign = buildCampaign([file("A.json", local), file("B.json", legacy)]);

  for (const ride of campaign.rides) {
    assert.equal(ride.bucket, "HISTORICAL_MATCHER_EVIDENCE");
    assert.equal(ride.policy, "UNRESOLVED");
  }
  assert.match(campaign.rides[1]!.reasons[0]!, /provenance is not inferred/);
  assert.equal(campaign.unresolvedPolicyRides, 2);
  assert.equal(campaign.counter.cleanObservedBoardings, 0);
});

test("a report with no raw partner cannot be replayed and never counts", () => {
  const report = analyzeRideCapture(capture());
  const old: Record<string, unknown> = { ...report };
  delete old.matchGate;
  delete old.captureEngine;
  const campaign = buildCampaign([file("SYN-ROUTE-A-1.report.json", old)]);

  assert.equal(campaign.rides[0]!.bucket, "REPORT_ONLY_NO_RAW");
  assert.equal(campaign.rides[0]!.rawRecovery, "RAW_NOT_FOUND");
  assert.ok(campaign.rides[0]!.reasons.includes("report predates matchGate"));
  assert.equal(campaign.files.reportsWithoutRaw, 1);
  assert.equal(campaign.counter.remainingToThirty, 30);
});

test("a modern report without its raw shows its ride-time gate and never counts", () => {
  // A Railway report saved without its raw: the ride-time matchGate is shown,
  // but a report alone cannot be replayed, so it is decided, not open.
  const report = analyzeRideCapture(capture());
  const campaign = buildCampaign([file("SYN-ROUTE-A-1.report.json", report)]);
  const [ride] = campaign.rides;

  assert.equal(ride!.bucket, "REPORT_ONLY_NO_RAW");
  assert.equal(ride!.policy, "DECIDED");
  assert.equal(ride!.captureEngine, "railway-background");
  assert.equal(ride!.reportOnly?.rideTimeMatchGate?.selectionVerdict, "correct");
  assert.equal(campaign.counter.cleanObservedBoardings, 0, "a report without its raw never counts");
  assert.equal(campaign.unresolvedPolicyRides, 0);
});

test("reports pair with raws by exact stem, then by route and start time", () => {
  const exact = capture();
  const renamed = capture({ startedAt: at(100) });
  const reportOf = (raw: RideCapture) => analyzeRideCapture(raw);
  const campaign = buildCampaign([
    file("ride-1.json", exact),
    file("ride-1.report.json", reportOf(exact)),
    file("phone-export (2).json", renamed),
    file("ride-2.report.json", reportOf(renamed)),
  ]);

  assert.equal(campaign.rides.length, 2, "each ride is counted once, from its raw");
  assert.equal(campaign.files.exactRawMatches, 1);
  assert.equal(campaign.files.compatibleRawMatches, 1);
  assert.equal(campaign.rides.find((ride) => ride.stem === "phone-export (2)")!.rawRecovery, "COMPATIBLE_RAW_FOUND");
  assert.equal(campaign.counter.cleanObservedBoardings, 2);
});

test("two raws that both fit a report leave it ambiguous instead of guessing", () => {
  const first = capture();
  const second = capture({ endedAt: at(61) });
  const campaign = buildCampaign([
    file("x.json", first),
    file("y.json", second),
    file("z.report.json", analyzeRideCapture(first)),
  ]);

  assert.equal(campaign.files.ambiguousRawMatches, 1);
  assert.equal(campaign.rides.find((ride) => ride.stem === "z")!.rawRecovery, "AMBIGUOUS_RAW_MATCH");
});

test("byte-identical raw captures are counted once", () => {
  const raw = capture();
  const campaign = buildCampaign([file("a.json", raw), file("b.json", raw)]);

  assert.equal(campaign.rides.length, 1);
  assert.equal(campaign.files.duplicateRawCaptures.length, 1);
  assert.equal(campaign.counter.cleanObservedBoardings, 1);
});

test("invalid files are listed, and macOS metadata is ignored", () => {
  const broken = capture();
  broken.boardingStopSequence = 99;
  const campaign = buildCampaign([
    { name: "junk.json", content: "{not json" },
    file("other.json", { hello: "world" }),
    file("broken.json", broken),
    { name: "._ride.json", content: "\u0000\u0005" },
    { name: "notes.txt", content: "hi" },
  ]);

  assert.deepEqual(campaign.files.invalidFiles.map((entry) => entry.name), ["broken.json", "junk.json", "other.json"]);
  assert.deepEqual(campaign.files.ignoredFiles.sort(), ["._ride.json", "notes.txt"]);
  assert.equal(campaign.rides.length, 0);
});

test("route diversity and verdict totals aggregate across rides", () => {
  const campaign = buildCampaign([
    file("a.json", capture()),
    file("b.json", capture({ routeId: "SYN-ROUTE-B", snapshots: correctRide("SYN-ROUTE-B") })),
    file("c.json", wrongCapture({ routeId: "SYN-ROUTE-B", startedAt: at(1) })),
  ]);

  assert.equal(campaign.routes.distinctRouteIds, 2);
  assert.deepEqual(campaign.routes.capturesPerRoute, { "SYN-ROUTE-A": 1, "SYN-ROUTE-B": 2 });
  assert.equal(campaign.assessment.multipleRoutes, true);
  assert.equal(campaign.modernMatchGate.selectionVerdicts.correct, 2);
  assert.equal(campaign.modernMatchGate.selectionVerdicts.wrong, 1);
  assert.equal(campaign.counter.cleanObservedBoardings, 2);
});

test("aggregate output never carries a vehicle number or a coordinate", () => {
  const campaign = buildCampaign([
    file("a.json", capture()),
    file("b.json", wrongCapture({ startedAt: at(1) })),
  ]);
  const text = JSON.stringify(campaign) + renderCampaignMarkdown(campaign);

  assert.ok(!text.includes(BOARDED));
  assert.ok(!text.includes(OTHER));
  assert.ok(!/latitude|longitude/.test(text));
});

const run = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const cli = path.join(repoRoot, "scripts/ride-capture/batch-analyze.ts");

async function snapshotDir(dir: string): Promise<string[]> {
  const names = (await readdir(dir)).sort();
  return Promise.all(names.map(async (name) =>
    `${name}:${createHash("sha256").update(await readFile(path.join(dir, name))).digest("hex")}`));
}

test("the CLI reads its input directory without changing it and writes only to --out", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tapso-campaign-"));
  try {
    const input = path.join(root, "in");
    const out = path.join(root, "out");
    await mkdir(input);
    await writeFile(path.join(input, "a.json"), JSON.stringify(capture()));
    await writeFile(path.join(input, "a.report.json"), JSON.stringify(analyzeRideCapture(capture())));
    const before = await snapshotDir(input);

    const { stdout } = await run(process.execPath, ["--experimental-strip-types", cli, input, `--out=${out}`]);

    assert.deepEqual(await snapshotDir(input), before, "input bytes and file list are unchanged");
    assert.match(stdout, /clean observed boardings 1, remaining to thirty 29/);
    assert.deepEqual((await readdir(out)).sort(), ["campaign-report.json", "campaign-report.md"]);
    assert.ok(!(await readFile(path.join(out, "campaign-report.json"), "utf8")).includes(BOARDED));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI refuses to write into the directory it reads", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tapso-campaign-"));
  try {
    await assert.rejects(
      run(process.execPath, ["--experimental-strip-types", cli, root, `--out=${path.join(root, "reports")}`]),
      (error: { code?: number; stderr?: string }) => error.code === 1 && /must not be the input directory/.test(error.stderr ?? ""),
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
