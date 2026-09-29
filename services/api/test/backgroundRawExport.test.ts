import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createBackgroundRequestHandler } from "../src/backgroundHttp.ts";
import { BackgroundRideCaptureCoordinator, COMPLETED_RETENTION_MS } from "../src/backgroundRideCapture.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { buildCampaign } from "../src/rideCampaign.ts";
import { analyzeRideCapture, type RideCapture, type RideCaptureReport } from "../src/rideCapture.ts";
import {
  captureFileStem,
  rawCaptureFilename,
  reportFilename,
} from "../public/ride-capture/background-client-core.js";

/**
 * Synthetic fixtures only: placeholder vehicle numbers, an invented route, and
 * a synthetic coordinate grid, not real stop positions. Nothing here is a real
 * ride.
 */
const TOKEN = "synthetic-operator-token-0123456789";
const CITY = "999";
const BOARDED = "제주79자9999";
const DECOY = "제주79자8888";
const EPOCH = new Date(0).toISOString();
const stops: StopOnRoute[] = Array.from({ length: 8 }, (_, index) => ({
  stopId: `SYN-${index + 1}`,
  name: `Synthetic ${index + 1}`,
  sequence: index + 1,
  latitude: 33.5 + index * 0.01,
  longitude: 126.5,
}));

/**
 * The boarded bus leaves the boarding stop and advances one stop per poll, so
 * the cadence surrogate turns fresh and the matcher commits to it. A decoy
 * idles far down the route and is never eligible.
 */
class SyntheticProvider {
  calls = 0;
  private readonly now: () => Date;
  private readonly boarding: number;
  constructor(now: () => Date, boarding: number) {
    this.now = now;
    this.boarding = boarding;
  }

  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    return stops;
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    const sequence = Math.min(this.boarding + this.calls, stops.length);
    this.calls += 1;
    const receivedAt = this.now().toISOString();
    const observation = (vehicleId: string, stopSequence: number): VehicleObservation => ({
      vehicleId,
      routeId: request.routeId,
      observedAt: EPOCH,
      receivedAt,
      timestampSource: "unavailable",
      stopId: `SYN-${stopSequence}`,
      stopSequence,
      latitude: stops[stopSequence - 1]!.latitude,
      longitude: stops[stopSequence - 1]!.longitude,
      directionCode: "1",
      receiveType: "TAGO_SNAPSHOT",
    });
    return [observation(BOARDED, sequence), observation(DECOY, stops.length)];
  }
}

function harness() {
  let nowMs = Date.parse("2026-09-23T09:00:00.000Z");
  const now = () => new Date(nowMs);
  const providers = new Map<string, SyntheticProvider>();
  const provider = {
    stops: (request: RouteRequest) => providerFor(request.routeId).stops(request),
    vehicles: (request: RouteRequest) => providerFor(request.routeId).vehicles(request),
  };
  function providerFor(routeId: string): SyntheticProvider {
    let found = providers.get(routeId);
    if (!found) providers.set(routeId, found = new SyntheticProvider(now, 2));
    return found;
  }
  const coordinator = new BackgroundRideCaptureCoordinator(provider, {
    now,
    schedule: () => ({}) as ReturnType<typeof setTimeout>,
    cancel: () => {},
  });
  return { coordinator, advance(ms: number) { nowMs += ms; } };
}

/** Start, poll to the destination, mark stops, go background once, alight. */
async function completedRide(h: ReturnType<typeof harness>, routeId = "SYN-ROUTE-A") {
  const started = await h.coordinator.start({
    routeId,
    cityCode: CITY,
    boardedVehicleId: BOARDED,
    boardingStopSequence: 2,
    destinationStopSequence: 6,
  });
  const id = started.sessionId;
  for (let poll = 0; poll < 4; poll += 1) {
    h.advance(5_000);
    await h.coordinator.pollNow(id);
    const reached = h.coordinator.status(id).trackedStopSequence!;
    if (reached > 2 && reached < 6) h.coordinator.recordPassedStop(id, reached);
    if (poll === 1) h.coordinator.recordEvent(id, "hidden");
    if (poll === 2) h.coordinator.recordEvent(id, "visible");
  }
  const done = h.coordinator.alight(id);
  assert.equal(done.phase, "completed", "the tracked bus reached the destination, so alight completes");
  return done;
}

async function serve(h: ReturnType<typeof harness>, operator = { configured: true, token: TOKEN }) {
  const logs: string[] = [];
  const server: Server = createServer(createBackgroundRequestHandler({
    captures: h.coordinator,
    operator,
    allowedOrigins: [],
    health: () => ({ ok: true }),
    log: (line) => logs.push(line),
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const get = (route: string, token: string | undefined = TOKEN) =>
    fetch(base + route, token ? { headers: { authorization: `Bearer ${token}` } } : {});
  return { server, logs, get, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

function gateFields(report: RideCaptureReport) {
  const gate = report.matchGate;
  return {
    routeId: report.routeId,
    captureEngine: report.captureEngine,
    snapshotCount: report.snapshotCount,
    usableForGate: gate.usableForGate,
    selectionVerdict: gate.selectionVerdict,
    contestedDecisions: gate.contestedDecisions,
    candidateMargin: gate.candidateMargin,
    boardedDirectionChanges: gate.directionReversal.boardedDirectionChanges,
    selectionsWhileNotFresh: gate.staleData.selectionsWhileNotFresh,
  };
}

/* ------------------------------------------------------------- coordinator */

test("a completed session exports its full raw capture, final and replayable", async () => {
  const h = harness();
  const done = await completedRide(h);
  const raw = h.coordinator.completedCapture(done.sessionId);

  assert.equal(raw.captureEngine, "railway-background");
  assert.equal(raw.source, "web-controller");
  assert.equal(raw.boardedVehicleId, BOARDED, "the raw capture keeps what replay needs");
  assert.ok(raw.endedAt, "a final capture carries endedAt");
  assert.equal(raw.snapshots.length, done.snapshotCount);
  assert.ok(raw.snapshots.every((snapshot) => snapshot.vehicles.every((vehicle) =>
    Number.isFinite(vehicle.latitude) && vehicle.directionCode && vehicle.stopSequence !== undefined)),
  "every snapshot carries the coordinates, direction and sequence the matcher scores");
});

test("an active session has no final raw capture yet", async () => {
  const h = harness();
  const started = await h.coordinator.start({
    routeId: "SYN-ROUTE-A", cityCode: CITY, boardedVehicleId: BOARDED, boardingStopSequence: 2, destinationStopSequence: 6,
  });
  assert.throws(() => h.coordinator.completedCapture(started.sessionId), /only after the capture completes/);
});

test("the exported capture is a copy: changing it cannot reach the session", async () => {
  const h = harness();
  const done = await completedRide(h);
  const first = h.coordinator.completedCapture(done.sessionId);
  first.snapshots.length = 0;
  first.markers.push({ at: first.startedAt, kind: "note", note: "tampered" });
  first.boardedVehicleId = "tampered";

  const second = h.coordinator.completedCapture(done.sessionId);
  assert.equal(second.snapshots.length, done.snapshotCount);
  assert.equal(second.boardedVehicleId, BOARDED);
  assert.ok(!second.markers.some((marker) => marker.note === "tampered"));
  assert.deepEqual(h.coordinator.status(done.sessionId).report, done.report);
});

test("the raw capture replays to the same gate evidence the server reported", async () => {
  const h = harness();
  const done = await completedRide(h);
  const raw = h.coordinator.completedCapture(done.sessionId);
  // Through JSON, exactly as a downloaded file would come back.
  const replayed = analyzeRideCapture(JSON.parse(JSON.stringify(raw)) as RideCapture);

  assert.deepEqual(gateFields(replayed), gateFields(done.report!));
  assert.equal(replayed.matchGate.selectionVerdict, "correct");
  assert.equal(replayed.matchGate.usableForGate, true);
});

test("pruning after the retention window makes the raw capture unavailable", async () => {
  const h = harness();
  const done = await completedRide(h);
  h.advance(COMPLETED_RETENTION_MS - 1_000);
  assert.ok(h.coordinator.completedCapture(done.sessionId), "still inside the window");
  h.advance(2_000);
  assert.throws(() => h.coordinator.completedCapture(done.sessionId), /not found/);
});

/* -------------------------------------------------------------------- HTTP */

test("the raw endpoint requires the operator token", async () => {
  const h = harness();
  const done = await completedRide(h);
  const api = await serve(h);
  try {
    const route = `/capture/${done.sessionId}/raw`;
    assert.equal((await api.get(route, "")).status, 401);
    assert.equal((await api.get(route, "wrong-token-wrong-token-wrong")).status, 401);
    const denied = await (await api.get(route, "")).text();
    assert.ok(!denied.includes(BOARDED), "a refusal carries nothing of the capture");
  } finally {
    await api.close();
  }
  const disabled = await serve(h, { configured: false, token: "" });
  try {
    assert.equal((await disabled.get(`/capture/${done.sessionId}/raw`)).status, 503);
  } finally {
    await disabled.close();
  }
});

test("the raw endpoint answers one exact session and nothing else", async () => {
  const h = harness();
  const a = await completedRide(h, "SYN-ROUTE-A");
  const b = await completedRide(h, "SYN-ROUTE-B");
  const api = await serve(h);
  try {
    const rawA = await (await api.get(`/capture/${a.sessionId}/raw`)).json() as RideCapture;
    const rawB = await (await api.get(`/capture/${b.sessionId}/raw`)).json() as RideCapture;
    assert.equal(rawA.routeId, "SYN-ROUTE-A");
    assert.equal(rawB.routeId, "SYN-ROUTE-B");
    assert.notEqual(rawA.startedAt, rawB.startedAt);

    assert.equal((await api.get("/capture/00000000-0000-0000-0000-000000000000/raw")).status, 404);
    assert.equal((await api.get("/capture/not*an*id/raw")).status, 400);
    // No listing, no wildcard, no lookup by route.
    assert.equal((await api.get("/capture/raw")).status, 404);
    assert.equal((await api.get("/capture")).status, 404);
    assert.equal((await api.get(`/capture/${a.sessionId}/raw/extra`)).status, 404);
  } finally {
    await api.close();
  }
});

test("an active session's raw endpoint refuses rather than pretend to be final", async () => {
  const h = harness();
  const started = await h.coordinator.start({
    routeId: "SYN-ROUTE-A", cityCode: CITY, boardedVehicleId: BOARDED, boardingStopSequence: 2, destinationStopSequence: 6,
  });
  const api = await serve(h);
  try {
    const response = await api.get(`/capture/${started.sessionId}/raw`);
    assert.equal(response.status, 409);
    assert.ok(!(await response.text()).includes(BOARDED));
  } finally {
    await api.close();
  }
});

test("the raw response is JSON, uncacheable, and never logged", async () => {
  const h = harness();
  const done = await completedRide(h);
  const api = await serve(h);
  try {
    const response = await api.get(`/capture/${done.sessionId}/raw`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    const cache = response.headers.get("cache-control") ?? "";
    assert.match(cache, /no-store/);
    assert.match(cache, /private/);
    assert.equal(response.headers.get("pragma"), "no-cache");
    const raw = await response.json() as RideCapture;
    assert.ok(raw.endedAt);

    const log = api.logs.join("\n");
    assert.match(log, /"route":"capture_raw"/);
    assert.ok(!log.includes(BOARDED) && !log.includes(DECOY), "no vehicle number reaches the log");
    assert.ok(!/latitude|snapshots/.test(log), "no capture content reaches the log");
  } finally {
    await api.close();
  }
});

test("the status endpoint stays sanitized after the raw endpoint exists", async () => {
  const h = harness();
  const done = await completedRide(h);
  const api = await serve(h);
  try {
    await api.get(`/capture/${done.sessionId}/raw`);
    const status = await (await api.get(`/capture/${done.sessionId}`)).json() as Record<string, unknown>;
    const text = JSON.stringify(status);
    assert.ok(!("snapshots" in status) && !("capture" in status), "status carries no capture");
    assert.ok(!text.includes(BOARDED) && !text.includes(DECOY), "status and its report carry no vehicle number");
    assert.equal((status.report as RideCaptureReport).captureEngine, "railway-background");
  } finally {
    await api.close();
  }
});

/* --------------------------------------------------- export pair, end to end */

test("raw and report save under one stem, and the campaign counts the pair", async () => {
  const h = harness();
  const done = await completedRide(h);
  const api = await serve(h);
  let raw: RideCapture;
  try {
    raw = await (await api.get(`/capture/${done.sessionId}/raw`)).json() as RideCapture;
  } finally {
    await api.close();
  }
  const report = done.report!;

  const rawName = rawCaptureFilename(raw);
  const reportName = reportFilename(report);
  assert.equal(captureFileStem(raw), captureFileStem(report));
  assert.equal(rawName, `${captureFileStem(raw)}.json`);
  assert.equal(reportName, `${captureFileStem(raw)}.report.json`);

  const campaign = buildCampaign([
    { name: rawName, content: JSON.stringify(raw) },
    { name: reportName, content: JSON.stringify(report) },
  ]);
  assert.equal(campaign.files.exactRawMatches, 1);
  assert.equal(campaign.rides.length, 1);
  assert.equal(campaign.rides[0]!.bucket, "CLEAN_GATE_CANDIDATE",
    "a backgrounded Railway ride is not confounded: the server did the polling");
  assert.equal(campaign.counter.cleanObservedBoardings, 1);
  assert.equal(campaign.counter.remainingToThirty, 29);
});

test("batch-analyze pairs a downloaded Railway export from disk", async () => {
  const h = harness();
  const done = await completedRide(h);
  const raw = h.coordinator.completedCapture(done.sessionId);
  const root = await mkdtemp(path.join(tmpdir(), "tapso-railway-export-"));
  try {
    const input = path.join(root, "phone");
    const out = path.join(root, "out");
    await mkdir(input);
    await writeFile(path.join(input, rawCaptureFilename(raw)), JSON.stringify(raw));
    await writeFile(path.join(input, reportFilename(done.report)), JSON.stringify(done.report));

    const cli = path.resolve(import.meta.dirname, "../../../scripts/ride-capture/batch-analyze.ts");
    const { stdout } = await promisify(execFile)(process.execPath, ["--experimental-strip-types", cli, input, `--out=${out}`]);
    assert.match(stdout, /reports 1, raw captures 1, reports without raw 0/);
    assert.match(stdout, /clean observed boardings 1, remaining to thirty 29/);
    const written = await readFile(path.join(out, "campaign-report.json"), "utf8");
    assert.ok(!written.includes(BOARDED) && !written.includes(DECOY));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
