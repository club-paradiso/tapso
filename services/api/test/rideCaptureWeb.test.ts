import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_SOURCE,
  MIN_INTERVAL_MS,
  RIDE_PRESETS,
  captureFileStem,
  createCaptureHeader,
  createCaptureSession,
  findVehicle,
  maskVehicleIds,
  resumeCaptureSession,
  stopsBetween,
  verifyPreset,
  verifyTopology,
  // The mobile controller's own logic, exercised here exactly as the phone runs
  // it. Only the browser wrapper (IndexedDB, timers, DOM) lives outside this.
} from "../public/ride-capture/capture-core.js";
import { analyzeRideCapture } from "../src/rideCapture.ts";

const EPOCH = new Date(0).toISOString();
const BASE = Date.parse("2026-09-12T09:00:00+09:00");

/** The planned 447 pilot, as live TAGO reports it. */
const ROUTE_447_STOPS = [24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35].map((sequence) => ({
  stopId: sequence === 27 ? "JEB405002104" : sequence === 34 ? "JEB405000334" : `JEB4050000${sequence}`,
  name: sequence === 27 ? "농림축산검역본부[남]" : sequence === 34 ? "관덕정[남]" : `정류장 ${sequence}`,
  sequence,
}));

/** A different route entirely, to keep the controller honest about being generic. */
const OTHER_ROUTE_STOPS = [1, 2, 3, 4, 5].map((sequence) => ({
  stopId: `SYN-${sequence}`,
  name: `합성 ${sequence}`,
  sequence,
}));

function at(seconds: number): string {
  return new Date(BASE + seconds * 1_000).toISOString();
}

function observation(vehicleId: string, stopSequence: number, extra: Record<string, unknown> = {}) {
  return {
    vehicleId,
    routeId: "JEB405244701",
    observedAt: EPOCH,
    timestampSource: "unavailable",
    stopSequence,
    stopName: `정류장 ${stopSequence}`,
    latitude: 33.48,
    longitude: 126.48,
    receiveType: "TAGO_SNAPSHOT",
    ...extra,
  };
}

type StoreRow = { captureId: string; index: number; [key: string]: unknown };

function fakeStore() {
  const headers: Record<string, unknown>[] = [];
  const snapshots: StoreRow[] = [];
  const markers: StoreRow[] = [];
  const events: StoreRow[] = [];
  return {
    headers,
    snapshots,
    markers,
    events,
    async putHeader(header: Record<string, unknown>) {
      headers.push(structuredClone(header));
    },
    async putSnapshot(captureId: string, index: number, snapshot: unknown) {
      snapshots.push({ captureId, index, snapshot: structuredClone(snapshot) });
    },
    async putMarker(captureId: string, index: number, marker: unknown) {
      markers.push({ captureId, index, marker: structuredClone(marker) });
    },
    async putEvent(captureId: string, index: number, event: unknown) {
      events.push({ captureId, index, event: structuredClone(event) });
    },
  };
}

function startSession(stops = ROUTE_447_STOPS, overrides: Record<string, unknown> = {}) {
  const store = fakeStore();
  let clock = BASE;
  const header = createCaptureHeader({
    captureId: "capture-under-test",
    startedAt: at(0),
    routeId: "JEB405244701",
    cityCode: "39",
    routeNo: "447",
    direction: "도평동 → 제주대학교",
    boardingStopSequence: stops === ROUTE_447_STOPS ? 27 : 2,
    destinationStopSequence: stops === ROUTE_447_STOPS ? 34 : 5,
    stops,
    ...overrides,
  });
  const session = createCaptureSession({
    store,
    header,
    now: () => new Date(clock),
  });
  return { store, session, header, advance: (seconds: number) => { clock += seconds * 1_000; } };
}

test("the 447 preset carries the exact identifiers the pilot was planned around", () => {
  const preset = RIDE_PRESETS.find((item: { routeId: string }) => item.routeId === "JEB405244701");
  assert.ok(preset, "the planned pilot preset must exist");
  assert.equal(preset.cityCode, "39");
  assert.equal(preset.routeNo, "447");
  assert.equal(preset.direction, "도평동 → 제주대학교");
  assert.deepEqual(preset.boarding, { sequence: 27, stopId: "JEB405002104", name: "농림축산검역본부[남]" });
  assert.deepEqual(preset.destination, { sequence: 34, stopId: "JEB405000334", name: "관덕정[남]" });

  assert.deepEqual(verifyPreset(preset, ROUTE_447_STOPS), { ok: true, problems: [] });
});

test("a preset whose stop identifiers have drifted is reported, not ridden", () => {
  const preset = RIDE_PRESETS[0];
  const moved = ROUTE_447_STOPS.map((stop) => (stop.sequence === 27 ? { ...stop, stopId: "JEB405009999" } : stop));
  const drifted = verifyPreset(preset, moved);
  assert.equal(drifted.ok, false);
  assert.match(drifted.problems[0], /정류장 ID가 프리셋과 다르다/);

  const truncated = verifyPreset(preset, ROUTE_447_STOPS.filter((stop) => stop.sequence !== 34));
  assert.equal(truncated.ok, false);
  assert.ok(truncated.problems.some((problem: string) => problem.includes("34")));
});

test("topology verification refuses a reversed or unordered direction", () => {
  assert.equal(verifyTopology({ stops: ROUTE_447_STOPS, boardingSequence: 27, destinationSequence: 34 }).ok, true);

  const reversed = verifyTopology({ stops: ROUTE_447_STOPS, boardingSequence: 34, destinationSequence: 27 });
  assert.equal(reversed.ok, false);
  assert.ok(reversed.problems.some((problem: string) => problem.includes("방향이 반대")));

  const absent = verifyTopology({ stops: ROUTE_447_STOPS, boardingSequence: 99, destinationSequence: 34 });
  assert.equal(absent.ok, false);

  const scrambled = verifyTopology({
    stops: [{ stopId: "a", name: "a", sequence: 3 }, { stopId: "b", name: "b", sequence: 1 }],
    boardingSequence: 1,
    destinationSequence: 3,
  });
  assert.equal(scrambled.ok, false);
  assert.ok(scrambled.problems.some((problem: string) => problem.includes("오름차순")));

  assert.equal(verifyTopology({ stops: [], boardingSequence: 1, destinationSequence: 2 }).ok, false);
});

test("vehicle labels stay short until two buses would look the same", () => {
  const distinct = maskVehicleIds(["제주79자3696", "제주79자1234", "제주80자7777"]);
  assert.equal(distinct.get("제주79자3696"), "…3696");
  assert.equal(distinct.get("제주80자7777"), "…7777");

  // Same last four: the label must grow rather than put the capture on either bus.
  const colliding = maskVehicleIds(["제주79자3696", "제주80자3696"]);
  assert.equal(new Set(colliding.values()).size, 2);
  assert.notEqual(colliding.get("제주79자3696"), colliding.get("제주80자3696"));
  for (const value of colliding.values()) assert.ok(value.length > 5);

  assert.equal(maskVehicleIds(["123"]).get("123"), "123");
  assert.equal(maskVehicleIds([]).size, 0);
});

test("the header refuses an impossible ride and clamps the poll interval to the CLI floor", () => {
  assert.throws(
    () => createCaptureHeader({
      startedAt: at(0),
      routeId: "JEB405244701",
      cityCode: "39",
      boardingStopSequence: 34,
      destinationStopSequence: 27,
      stops: ROUTE_447_STOPS,
    }),
    /하차 순번이 승차 순번보다 뒤여야 한다/,
  );
  assert.throws(
    () => createCaptureHeader({
      startedAt: at(0),
      routeId: "",
      cityCode: "39",
      boardingStopSequence: 27,
      destinationStopSequence: 34,
      stops: ROUTE_447_STOPS,
    }),
    /routeId and cityCode are required/,
  );

  const { header } = startSession(ROUTE_447_STOPS, { intervalMs: 500 });
  assert.equal(header.intervalMs, MIN_INTERVAL_MS);
  assert.equal(header.source, CAPTURE_SOURCE);
  assert.equal(header.schemaVersion, 1);
});

test("every snapshot, marker and event is written through before it is visible", async () => {
  const { store, session, advance } = startSession();
  await session.recordSnapshot({ capturedAt: at(0), vehicles: [observation("제주79자3696", 27)] });
  advance(5);
  await session.recordSnapshot({ capturedAt: at(5), error: "TAGO request failed or timed out" });
  await session.board("제주79자3696", { at: at(6) });
  await session.passedStop(28, { at: at(7) });
  await session.note("문이 늦게 열림", { at: at(8) });
  await session.recordEvent("hidden", undefined, { at: at(9) });

  assert.equal(store.snapshots.length, 2);
  assert.equal(store.markers.length, 3, "boarded, passed_stop and note each land as their own write");
  assert.equal(store.events.length, 1);
  assert.equal(store.headers.at(-1)?.boardedVehicleId, "제주79자3696");
  assert.equal((store.snapshots[1]!.snapshot as { error: string }).error, "TAGO request failed or timed out");

  const capture = session.capture();
  assert.equal(capture.snapshots.length, 2);
  assert.equal(capture.markers[0]!.kind, "boarded");
  assert.equal(capture.markers[0]!.stopSequence, 27, "boarding is marked at the boarding stop, not the provider's");
  assert.equal(capture.source, CAPTURE_SOURCE);
});

test("the tracked vehicle never changes by itself", async () => {
  const { session } = startSession();
  await session.board("제주79자3696", { at: at(1) });

  // Later snapshots are full of other buses, including one that is closer to
  // the destination. None of them may become the tracked vehicle.
  for (let index = 0; index < 5; index += 1) {
    await session.recordSnapshot({
      capturedAt: at(10 + index),
      vehicles: [observation("제주80자1111", 33), observation("제주79자3696", 27 + index)],
    });
  }
  assert.equal(session.boardedVehicleId, "제주79자3696");

  await assert.rejects(() => session.board("제주80자1111"), /이미 차량이 기록되어 있다/);
  assert.equal(session.boardedVehicleId, "제주79자3696");

  await session.board("제주80자1111", { replace: true, at: at(20) });
  assert.equal(session.boardedVehicleId, "제주80자1111");
  assert.equal(session.events.at(-1)!.kind, "resumed", "a deliberate replacement is recorded, never silent");
  assert.equal(session.markers.filter((marker: { kind: string }) => marker.kind === "boarded").length, 2);
});

test("a physical marker is the rider's, not the provider's", async () => {
  const { session } = startSession();
  await session.board("제주79자3696", { at: at(1) });
  // The provider says the bus is at 30; the rider saw the doors open at 28.
  await session.recordSnapshot({ capturedAt: at(2), vehicles: [observation("제주79자3696", 30)] });
  await session.passedStop(28, { at: at(3) });
  assert.equal(session.markers.at(-1)!.stopSequence, 28);

  await assert.rejects(() => session.passedStop(99), /실제 정류장 순번/);
  await assert.rejects(() => session.passedStop(28.5), /실제 정류장 순번/);
  await assert.rejects(() => session.note("   "), /메모가 비어 있다/);
  await assert.rejects(() => session.board(""), /차량을 선택해야 한다/);
});

test("a capture interrupted by a reload comes back intact", async () => {
  const { store, session, header } = startSession();
  await session.board("제주79자3696", { at: at(1) });
  await session.recordSnapshot({ capturedAt: at(2), vehicles: [observation("제주79자3696", 27)] });
  await session.passedStop(28, { at: at(3) });
  await session.recordEvent("hidden", "pagehide", { at: at(4) });
  const before = session.capture();

  // What IndexedDB would hand back after the page was reopened.
  const record = {
    header: { ...header, boardedVehicleId: "제주79자3696" },
    snapshots: store.snapshots.map((row) => row.snapshot),
    markers: store.markers.map((row) => row.marker),
    events: store.events.map((row) => row.event),
  };
  const resumed = resumeCaptureSession({ store: fakeStore(), record, now: () => new Date(BASE + 60_000) });
  await resumed.recordEvent("resumed", "reopened after a reload");

  const after = resumed.capture();
  assert.deepEqual(after.snapshots, before.snapshots);
  assert.deepEqual(after.markers, before.markers);
  assert.equal(after.boardedVehicleId, "제주79자3696");
  assert.equal(after.events.length, before.events.length + 1);
  assert.equal(after.events.at(-1)!.kind, "resumed");
});

test("status reflects the ride without inventing any of it", async () => {
  const { session, advance } = startSession();
  await session.recordSnapshot({ capturedAt: at(0), vehicles: [observation("제주79자3696", 27)] });
  await session.board("제주79자3696", { at: at(1) });
  advance(65);
  await session.recordSnapshot({ capturedAt: at(65), vehicles: [observation("제주79자3696", 31)] });

  const status = session.status();
  assert.equal(status.elapsedSeconds, 65);
  assert.equal(status.snapshotCount, 2);
  assert.equal(status.successfulCount, 2);
  assert.equal(status.trackedPresent, true);
  assert.equal(status.trackedStopSequence, 31);
  assert.equal(status.remainingStops, 3);

  await session.recordSnapshot({ capturedAt: at(70), vehicles: [observation("제주80자1111", 30)] });
  const missing = session.status();
  assert.equal(missing.trackedPresent, false);
  assert.equal(missing.remainingStops, undefined, "absence is reported as absence, never as a last known value");
});

test("the runner stops itself at the same limits the CLI uses", async () => {
  const { session, advance } = startSession();
  assert.equal(session.limitReached(), undefined);
  advance(91 * 60);
  assert.match(session.limitReached() ?? "", /시간 상한/);

  const small = createCaptureSession({
    store: fakeStore(),
    header: createCaptureHeader({
      startedAt: at(0),
      routeId: "JEB405244701",
      cityCode: "39",
      boardingStopSequence: 27,
      destinationStopSequence: 34,
      stops: ROUTE_447_STOPS,
    }),
    now: () => new Date(BASE),
    maxSnapshots: 2,
  });
  await small.recordSnapshot({ capturedAt: at(0), vehicles: [] });
  assert.equal(small.limitReached(), undefined);
  await small.recordSnapshot({ capturedAt: at(5), vehicles: [] });
  assert.match(small.limitReached() ?? "", /스냅샷 상한 2/);
});

test("a web capture analyses through the same analyzer, with the vehicle number left behind", async () => {
  const { session, advance } = startSession();
  await session.board("제주79자3696", { at: at(1) });
  for (let index = 0; index < 24; index += 1) {
    advance(5);
    await session.recordSnapshot({
      capturedAt: at(5 * index),
      vehicles: [observation("제주79자3696", Math.min(34, 27 + Math.floor(index / 3)), { latitude: 33.48 + index * 0.001 })],
    });
  }
  await session.passedStop(28, { at: at(20) });
  await session.passedStop(29, { at: at(40) });
  await session.passedStop(30, { at: at(60) });
  await session.recordEvent("hidden", undefined, { at: at(70) });
  await session.recordEvent("visible", undefined, { at: at(100) });
  await session.recordEvent("wake_lock_unavailable", undefined, { at: at(101) });
  await session.alight(34, { at: at(110) });
  const capture = await session.finalize({ at: at(120) });

  const report = analyzeRideCapture(capture as never);
  assert.equal(report.routeId, "JEB405244701");
  assert.equal(report.tracked.present, true);
  assert.equal(report.lifecycle.source, "web-controller");
  assert.equal(report.lifecycle.hiddenPeriods, 1);
  assert.equal(report.lifecycle.hiddenSeconds, 30);
  assert.equal(report.lifecycle.wakeLockUnavailable, true);
  assert.ok(report.warnings.some((warning) => warning.includes("backgrounded")));
  assert.equal(report.freshnessEvidence.markerLagSeconds.count >= 3, true);
  assert.equal(JSON.stringify(report).includes("제주79자3696"), false);
});

test("the controller is route-generic: a capture on another route behaves identically", async () => {
  const { session } = startSession(OTHER_ROUTE_STOPS);
  await session.board("synthetic-bus-1", { at: at(1) });
  await session.recordSnapshot({
    capturedAt: at(2),
    vehicles: [{ vehicleId: "synthetic-bus-1", routeId: "SYN", observedAt: EPOCH, stopSequence: 3 }],
  });
  await session.passedStop(3, { at: at(3) });
  const capture = session.capture();
  assert.equal(capture.boardingStopSequence, 2);
  assert.equal(capture.destinationStopSequence, 5);
  assert.equal(capture.stops.length, 5);
  assert.equal(capture.markers.at(-1)!.stopSequence, 3);
  await assert.rejects(() => session.passedStop(27), /실제 정류장 순번/);
});

test("helpers used by the screens do what the screens assume", () => {
  assert.deepEqual(stopsBetween(ROUTE_447_STOPS, 27, 29).map((stop) => stop.sequence), [27, 28, 29]);
  assert.equal(stopsBetween(ROUTE_447_STOPS, 40, 50).length, 0);

  const vehicles = [observation("제주79자3696", 27), observation("제주80자1111", 30)];
  assert.equal(findVehicle(vehicles, "제주79자3696")?.stopSequence, 27);
  assert.equal(findVehicle(vehicles, "제주 79자 3696")?.stopSequence, 27, "spacing differences must not lose the bus");
  assert.equal(findVehicle(vehicles, "제주79자9999"), undefined);
  assert.equal(findVehicle(vehicles, undefined), undefined);

  assert.equal(
    captureFileStem({ routeId: "JEB405244701", startedAt: "2026-09-12T09:00:00.000Z" }),
    "JEB405244701-2026-09-12T09-00-00-000Z",
  );
});
