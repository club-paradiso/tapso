import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_SOURCE,
  MIN_INTERVAL_MS,
  RIDE_PRESETS,
  captureFileStem,
  compareRouteNumbers,
  compareVariants,
  createCaptureHeader,
  assessRouteCompatibility,
  createCaptureSession,
  duplicateStopNames,
  findVehicle,
  forwardStops,
  groupVariantsByEndpoints,
  groupVariantsByNumber,
  historyEntry,
  reachableDestinations,
  routeChoiceRows,
  routeNumberFamily,
  searchStops,
  labelStops,
  normalizeRouteNumber,
  normalizeTopology,
  maskVehicleIds,
  resumeCaptureSession,
  stopsBetween,
  tierRouteMatches,
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
  assert.equal(report.lifecycle.source, "web-controller");\n  assert.equal(report.captureEngine, "local-device");
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

/* ------------------------------------------------- route shapes, generically */

/** The 365 baseline, kept as a regression fixture and nothing more. */
const ROUTE_365_STOPS = Array.from({ length: 43 }, (_, index) => ({
  stopId: `JEB4051365${String(index + 1).padStart(2, "0")}`,
  name: `365 정류장 ${index + 1}`,
  sequence: index + 1,
}));

/** An ordinary Jeju route with two stops that share a name across directions. */
const ROUTE_331_STOPS = [
  { stopId: "JEB331001", name: "제주버스터미널", sequence: 1 },
  { stopId: "JEB331002", name: "한라병원", sequence: 2 },
  { stopId: "JEB331003", name: "노형오거리", sequence: 3 },
  { stopId: "JEB331004", name: "정존마을", sequence: 4 },
  { stopId: "JEB331005", name: "노형오거리", sequence: 5 },
  { stopId: "JEB331006", name: "제주공항", sequence: 6 },
];

/** A short-turn branch: fewer stops, same number, different routeId. */
const ROUTE_BRANCH_STOPS = [
  { stopId: "JEB460001", name: "동광환승", sequence: 1 },
  { stopId: "JEB460002", name: "화순", sequence: 2 },
  { stopId: "JEB460003", name: "안덕", sequence: 3 },
];

/** A closed circular route: the last entry is the first stop again. */
const ROUTE_LOOP_STOPS = [
  { stopId: "JEB465001", name: "순환 기점", sequence: 1 },
  { stopId: "JEB465002", name: "중앙로", sequence: 2 },
  { stopId: "JEB465003", name: "동문시장", sequence: 3 },
  { stopId: "JEB465004", name: "탑동", sequence: 4 },
  { stopId: "JEB465005", name: "용담", sequence: 5 },
  { stopId: "JEB465001", name: "순환 기점", sequence: 6 },
];

const LOOP_META = { kind: "loop", stopCount: 6, cycleLength: 5, duplicateStopIdCount: 1, duplicateStopNameCount: 1 };
const REPEATING_META = { kind: "repeating", stopCount: 6, cycleLength: 6, duplicateStopIdCount: 0, duplicateStopNameCount: 1 };

test("route shape comes from the server, and an absent classification is read as linear", () => {
  assert.equal(normalizeTopology(undefined, ROUTE_331_STOPS).kind, "linear");
  assert.equal(normalizeTopology({}, ROUTE_331_STOPS).kind, "linear");
  assert.equal(normalizeTopology(LOOP_META, ROUTE_LOOP_STOPS).cycleLength, 5);

  // Fail closed: without a classification, riding past the end is refused.
  const blind = verifyTopology({ stops: ROUTE_LOOP_STOPS, boardingSequence: 5, destinationSequence: 2 });
  assert.equal(blind.ok, false);
  assert.equal(blind.wrapAround, false);
  assert.ok(blind.problems.some((problem: string) => problem.includes("방향이 반대")));
});

test("wrap-around is allowed on a closed loop and refused on an ambiguous one", () => {
  const loop = verifyTopology({
    stops: ROUTE_LOOP_STOPS,
    topology: LOOP_META,
    boardingSequence: 5,
    destinationSequence: 2,
  });
  assert.equal(loop.ok, true);
  assert.equal(loop.wrapAround, true);

  const forward = verifyTopology({ stops: ROUTE_LOOP_STOPS, topology: LOOP_META, boardingSequence: 2, destinationSequence: 5 });
  assert.equal(forward.ok, true);
  assert.equal(forward.wrapAround, false, "a forward ride on a loop route is still a forward ride");

  const ambiguous = verifyTopology({
    stops: ROUTE_331_STOPS,
    topology: REPEATING_META,
    boardingSequence: 5,
    destinationSequence: 2,
  });
  assert.equal(ambiguous.ok, false);
  assert.ok(ambiguous.problems.some((problem: string) => problem.startsWith("AMBIGUOUS_TOPOLOGY")));

  const sameStop = verifyTopology({ stops: ROUTE_331_STOPS, boardingSequence: 3, destinationSequence: 3 });
  assert.equal(sameStop.ok, false);
  assert.ok(sameStop.problems.some((problem: string) => problem.includes("같은 정류장")));
});

test("stops that share a name are labelled with the official id as well", () => {
  const labelled = labelStops(ROUTE_331_STOPS);
  assert.equal(labelled[0]!.label, "1. 제주버스터미널");
  assert.equal(labelled[2]!.label, "3. 노형오거리 · JEB331003");
  assert.equal(labelled[4]!.label, "5. 노형오거리 · JEB331005");
  assert.deepEqual(labelStops([]), []);
});

test("the stop list ahead follows the bus around a loop", () => {
  assert.deepEqual(stopsBetween(ROUTE_331_STOPS, 2, 4).map((stop) => stop.sequence), [2, 3, 4]);

  const around = stopsBetween(ROUTE_LOOP_STOPS, 5, 2, true);
  assert.deepEqual(around.map((stop) => stop.sequence), [5, 6, 2], "the seam stop appears once, in the order it is met");

  assert.equal(forwardStops(5, 2, { cycleLength: 5 }, true), 2);
  assert.equal(forwardStops(6, 2, { cycleLength: 5 }, true), 1);
  assert.equal(forwardStops(2, 2, { cycleLength: 5 }, true), 0);
  assert.equal(forwardStops(2, 5, { cycleLength: 6 }, false), 3);
  assert.equal(forwardStops(5, 2, { cycleLength: 6 }, false), 0, "a straight route never reports a negative remainder");
});

test("a loop capture analyses with the seam read as progress", async () => {
  const store = fakeStore();
  let clock = BASE;
  const header = createCaptureHeader({
    captureId: "loop-capture",
    startedAt: at(0),
    routeId: "JEB465000001",
    cityCode: "39",
    routeNo: "465",
    boardingStopSequence: 5,
    destinationStopSequence: 2,
    stops: ROUTE_LOOP_STOPS,
    topology: LOOP_META,
  });
  assert.equal(header.wrapAround, true);

  const session = createCaptureSession({ store, header, now: () => new Date(clock) });
  await session.board("제주79자5500", { at: at(1) });
  for (const [seconds, sequence] of [[5, 5], [10, 6], [15, 2]] as Array<[number, number]>) {
    clock = BASE + seconds * 1_000;
    await session.recordSnapshot({
      capturedAt: at(seconds),
      vehicles: [{ vehicleId: "제주79자5500", routeId: "JEB465000001", observedAt: EPOCH, stopSequence: sequence }],
    });
  }
  assert.equal(session.status().remainingStops, 0, "at the destination the count is zero, not minus three");

  const report = analyzeRideCapture((await session.finalize({ at: at(20) })) as never);
  assert.equal(report.topology.kind, "loop");
  assert.equal(report.topology.wrapAround, true);
  assert.equal(report.vehicles[0]!.sequenceDecreaseCount, 0);
  assert.equal(report.tracked.arrivalDetectedAt, at(15));
});

test("the same flow works on every route shape, with no route literal in the path", async () => {
  const fixtures = [
    { name: "447 pilot", stops: ROUTE_447_STOPS, boarding: 27, destination: 34, topology: undefined },
    { name: "365 baseline", stops: ROUTE_365_STOPS, boarding: 1, destination: 43, topology: undefined },
    { name: "331 ordinary", stops: ROUTE_331_STOPS, boarding: 1, destination: 6, topology: REPEATING_META },
    { name: "460 branch", stops: ROUTE_BRANCH_STOPS, boarding: 1, destination: 3, topology: undefined },
    { name: "465 loop", stops: ROUTE_LOOP_STOPS, boarding: 5, destination: 2, topology: LOOP_META },
  ];

  for (const fixture of fixtures) {
    const store = fakeStore();
    const header = createCaptureHeader({
      captureId: `generic-${fixture.name}`,
      startedAt: at(0),
      routeId: `ROUTE-${fixture.name}`,
      cityCode: "39",
      boardingStopSequence: fixture.boarding,
      destinationStopSequence: fixture.destination,
      stops: fixture.stops,
      topology: fixture.topology,
    });
    const session = createCaptureSession({ store, header, now: () => new Date(BASE) });
    await session.board("bus-under-test", { at: at(1) });
    await session.recordSnapshot({
      capturedAt: at(2),
      vehicles: [{ vehicleId: "bus-under-test", routeId: `ROUTE-${fixture.name}`, observedAt: EPOCH, stopSequence: fixture.boarding }],
    });
    await session.passedStop(fixture.destination, { at: at(3) });
    const capture = session.capture();
    assert.equal(capture.stops.length, fixture.stops.length, fixture.name);
    assert.equal(capture.markers.at(-1)!.stopSequence, fixture.destination, fixture.name);
    // The analyzer accepts every one of them without a route-specific branch.
    const report = analyzeRideCapture(capture as never);
    assert.equal(report.stopCount, fixture.stops.length, fixture.name);
    assert.equal(report.tracked.present, true, fixture.name);
  }
});

/* --------------------------------------------- compatibility and finding ---- */

test("every route gets an explicit verdict with a reason a person can act on", () => {
  const route = { routeId: "JEB405244701", routeNumber: "447" };

  const fine = assessRouteCompatibility({ route, stops: ROUTE_447_STOPS, vehicleCount: 3 });
  assert.equal(fine.level, "ok");
  assert.equal(fine.headline, "실승차 기록 가능");
  assert.ok(fine.reason.includes("3대"));

  const quiet = assessRouteCompatibility({ route, stops: ROUTE_447_STOPS, vehicleCount: 0 });
  assert.equal(quiet.level, "warning");
  assert.ok(quiet.headline.includes("운행 중인 차량이 없"));
  assert.ok(quiet.reason.includes("기록은 시작할 수 있"), "a quiet route is a warning, not a wall");

  const repeats = assessRouteCompatibility({ route, stops: ROUTE_331_STOPS, topology: REPEATING_META, vehicleCount: 2 });
  assert.equal(repeats.level, "warning");
  assert.ok(repeats.headline.includes("두 번 지나는"));

  const empty = assessRouteCompatibility({ route, stops: [], vehicleCount: 2 });
  assert.equal(empty.level, "unsupported");
  assert.ok(empty.reason.includes("정류장"));

  const scrambled = assessRouteCompatibility({
    route,
    stops: [{ stopId: "a", name: "a", sequence: 3 }, { stopId: "b", name: "b", sequence: 1 }],
    vehicleCount: 2,
  });
  assert.equal(scrambled.level, "unsupported");

  const unidentified = assessRouteCompatibility({
    route,
    stops: [{ stopId: "", name: "이름만", sequence: 1 }, { stopId: "b", name: "b", sequence: 2 }],
    vehicleCount: 2,
  });
  assert.equal(unidentified.level, "unsupported");

  const nameless = assessRouteCompatibility({ route: {}, stops: ROUTE_447_STOPS, vehicleCount: 2 });
  assert.equal(nameless.level, "unsupported", "without an exact routeId there is no identity to record");

  const broken = assessRouteCompatibility({ route, stops: ROUTE_447_STOPS, vehiclesFailed: true });
  assert.equal(broken.level, "unsupported");
});

test("route shape can be judged without asking whether a bus is running", () => {
  const route = { routeId: "JEB405146501", routeNumber: "465" };
  const staticOnly = assessRouteCompatibility({ route, stops: ROUTE_LOOP_STOPS, topology: LOOP_META });
  assert.equal(staticOnly.level, "ok", "a route's shape does not depend on the timetable");
  assert.equal(staticOnly.checks.find((check: { label: string }) => check.label === "실시간 차량").state, "skip");
  assert.ok(staticOnly.reason.includes("구조 적합"));
});

test("stop search finds by name and by official id", () => {
  assert.equal(searchStops(ROUTE_331_STOPS, "노형").length, 2);
  assert.equal(searchStops(ROUTE_331_STOPS, "공항")[0].name, "제주공항");
  assert.equal(searchStops(ROUTE_331_STOPS, "JEB331004")[0].sequence, 4);
  assert.equal(searchStops(ROUTE_331_STOPS, "  ").length, ROUTE_331_STOPS.length);
  assert.equal(searchStops(ROUTE_331_STOPS, "없는이름").length, 0);
  assert.equal(searchStops(undefined, "x").length, 0);
});

test("the destination list only offers stops the bus can still reach", () => {
  const forward = reachableDestinations(ROUTE_331_STOPS, 3, REPEATING_META);
  assert.deepEqual(forward.map((stop) => stop.sequence), [4, 5, 6], "a straight route only goes forward");

  // On a closed route everything else is reachable, in the order it is met.
  const around = reachableDestinations(ROUTE_LOOP_STOPS, 4, LOOP_META);
  assert.deepEqual(around.map((stop) => stop.sequence), [5, 6, 2, 3]);

  assert.deepEqual(reachableDestinations(ROUTE_331_STOPS, 6, undefined), [], "the last stop leads nowhere");
});

test("duplicate stop names are identified so a label never stands alone", () => {
  const duplicates = duplicateStopNames(ROUTE_331_STOPS);
  assert.deepEqual([...duplicates], ["노형오거리"]);
  assert.equal(duplicateStopNames(ROUTE_447_STOPS).size, 0);
  assert.equal(duplicateStopNames(undefined).size, 0);
});

test("local history remembers the route and forgets the bus", async () => {
  const { session } = startSession();
  await session.board("제주79자3696", { at: at(1) });
  await session.recordSnapshot({ capturedAt: at(2), vehicles: [observation("제주79자3696", 27)] });
  const capture = await session.finalize({ at: at(60) });

  const entry = historyEntry({
    captureId: session.captureId,
    routeNo: "447",
    capture,
    report: { evidenceCompleteness: { verdict: "INSUFFICIENT_EVIDENCE" } },
  });
  assert.equal(entry.captureId, "capture-under-test", "the key IndexedDB stores under must be present");
  assert.equal(entry.routeId, "JEB405244701");
  assert.equal(entry.routeNo, "447");
  assert.equal(entry.boardingName, "농림축산검역본부[남]");
  assert.equal(entry.destinationName, "관덕정[남]");
  assert.equal(entry.verdict, "INSUFFICIENT_EVIDENCE");
  assert.equal(JSON.stringify(entry).includes("제주79자3696"), false, "history never carries a vehicle number");
});

/* ------------------------------------------------ route number search ------ */

/**
 * What production actually answers for `routeNo=202` in Jeju: the number that
 * was asked for, its branch numbers, and a few routes that merely contain the
 * digits. Thirty-one rows, as observed.
 */
function variant(routeNumber: string, index: number, start: string, end: string, routeType?: string) {
  return {
    routeId: `JEB${routeNumber.replace("-", "X")}${String(index).padStart(2, "0")}`,
    routeNumber,
    startStopName: start,
    endStopName: end,
    ...(routeType === undefined ? {} : { routeType }),
  };
}

const TERMINAL = "제주버스터미널";
const SEOGWIPO = "서귀포";

const ROUTE_202_SEARCH = [
  // Eight official routes running between the same two ends, plus three that
  // do not. Same number, eleven distinct routeIds.
  ...Array.from({ length: 8 }, (_, index) => variant("202", index, TERMINAL, SEOGWIPO, "간선")),
  variant("202", 8, SEOGWIPO, TERMINAL, "간선"),
  variant("202", 9, "한림환승정류장", SEOGWIPO, "간선"),
  variant("202", 10, SEOGWIPO, "한림환승정류장", "간선"),
  ...Array.from({ length: 5 }, (_, index) => variant("202-1", index, TERMINAL, "성산", "지선")),
  ...Array.from({ length: 5 }, (_, index) => variant("202-2", index, "성산", TERMINAL, "지선")),
  ...Array.from({ length: 4 }, (_, index) => variant("202-3", index, TERMINAL, "표선", "지선")),
  ...Array.from({ length: 3 }, (_, index) => variant("202-4", index, "표선", TERMINAL, "지선")),
  // The provider matches on the digits, so numbers that merely contain "202"
  // come back too. They are other routes, not branches of 202.
  variant("2021", 0, "동광환승정류장", "대정", "지선"),
  variant("2021", 1, "대정", "동광환승정류장", "지선"),
  variant("1202", 0, "제주공항", "중문", "급행"),
];

/** The 447 pilot as the provider lists it: one number, two directions. */
const ROUTE_447_SEARCH = [
  variant("447", 0, "제주대학교", "관덕정", "지선"),
  variant("447", 1, "관덕정", "제주대학교", "지선"),
];

test("a number search shows the number that was asked for, and only it, first", () => {
  const tiers = tierRouteMatches(ROUTE_202_SEARCH, "202");

  assert.equal(tiers.query, "202");
  assert.equal(tiers.exact.length, 11, "every official 202 is exact");
  assert.deepEqual([...new Set(tiers.exact.map((row) => row.routeNumber))], ["202"],
    "nothing but 202 itself is treated as the answer to 202");

  assert.deepEqual([...new Set(tiers.related.map((row) => row.routeNumber))],
    ["202-1", "202-2", "202-3", "202-4"], "the branch numbers are kept together, in order");
  assert.equal(tiers.related.length, 17);

  // A number that merely starts with the query is a different route. Reading a
  // family off a string prefix is exactly the mistake this rule exists to stop.
  assert.deepEqual([...new Set(tiers.other.map((row) => row.routeNumber))], ["1202", "2021"]);

  assert.equal(tiers.exact.length + tiers.related.length + tiers.other.length, ROUTE_202_SEARCH.length,
    "every row the provider sent is still on the screen somewhere");
});

test("searching a branch number makes that branch the exact match", () => {
  const tiers = tierRouteMatches(ROUTE_202_SEARCH, "202-1");

  assert.equal(tiers.query, "202-1");
  assert.equal(tiers.exact.length, 5);
  assert.deepEqual([...new Set(tiers.exact.map((row) => row.routeNumber))], ["202-1"],
    "202-1 is the exact answer to 202-1, never a relative of 202");

  assert.deepEqual([...new Set(tiers.related.map((row) => row.routeNumber))],
    ["202", "202-2", "202-3", "202-4"], "the rest of the family, 202 included");
  assert.deepEqual([...new Set(tiers.other.map((row) => row.routeNumber))], ["1202", "2021"]);
});

test("how a number is written never changes which route it is", () => {
  for (const typed of ["202", " 202 ", "202번", "２０２"]) {
    assert.equal(tierRouteMatches(ROUTE_202_SEARCH, typed).exact.length, 11, `typed as ${typed}`);
  }
  // A dash from another keyboard is the same dash.
  assert.equal(tierRouteMatches(ROUTE_202_SEARCH, "202‑1").exact.length, 5);
  assert.equal(normalizeRouteNumber("202－2"), "202-2");
});

test("a branch letter is a branch; more digits are a different route", () => {
  assert.deepEqual(routeNumberFamily("202-1"), { family: "202", variantSuffix: "-1" });
  assert.deepEqual(routeNumberFamily("202A"), { family: "202", variantSuffix: "A" });
  assert.deepEqual(routeNumberFamily("2021"), { family: "2021", variantSuffix: "" });
  assert.deepEqual(routeNumberFamily("202"), { family: "202", variantSuffix: "" });
  assert.deepEqual(routeNumberFamily("급행"), { family: "급행", variantSuffix: "" });
  assert.deepEqual(routeNumberFamily("-5"), { family: "-5", variantSuffix: "" });
});

test("an ordinary two-way route is still two plain choices", () => {
  const tiers = tierRouteMatches(ROUTE_447_SEARCH, "447");
  assert.equal(tiers.exact.length, 2);
  assert.deepEqual(tiers.related, [], "447 has no branches, so no second section appears");
  assert.deepEqual(tiers.other, []);

  // Each direction is its own endpoint pair, so each is offered directly: one
  // tap to the route, exactly as before this screen learned about grouping.
  const rows = routeChoiceRows(tiers.exact);
  assert.deepEqual(rows.map((row) => row.kind), ["route", "route"]);
  assert.deepEqual(rows.map((row) => row.variant.routeId), ["JEB44700", "JEB44701"]);
});

test("a route with a single official variant needs no extra step", () => {
  const rows = routeChoiceRows([variant("365", 0, "제주버스터미널", "제주버스터미널", "순환")]);
  assert.deepEqual(rows.map((row) => row.kind), ["route"]);
  assert.equal(rows[0].variant.routeId, "JEB36500");
});

test("grouping many variants is presentation only and loses no routeId", () => {
  const exact = tierRouteMatches(ROUTE_202_SEARCH, "202").exact;
  const groups = groupVariantsByEndpoints(exact);

  assert.equal(groups.length, 4, "four endpoint pairs among the eleven official 202s");
  const big = groups.find((group) => group.variantCount > 1);
  assert.equal(big?.label, `${TERMINAL} → ${SEOGWIPO}`);
  assert.equal(big?.variantCount, 8, "the group says how many official routes are behind it");

  // Nothing merged, nothing dropped, nothing renamed.
  const grouped = groups.flatMap((group) => group.variants.map((row) => row.routeId));
  assert.deepEqual([...grouped].sort(), exact.map((row) => row.routeId).sort());
  assert.equal(new Set(grouped).size, exact.length, "each routeId appears exactly once");

  // The screen shows the group as a heading and the other three as themselves.
  const rows = routeChoiceRows(exact);
  assert.deepEqual(rows.map((row) => row.kind), ["group", "route", "route", "route"]);
  const behind = rows.flatMap((row) => row.kind === "group" ? row.group.variants : [row.variant]);
  assert.deepEqual(behind.map((row) => row.routeId).sort(), exact.map((row) => row.routeId).sort(),
    "a choice list still reaches every official route");
});

test("variants that share both endpoints are shown, never merged or chosen for you", () => {
  const shared = [
    variant("202", 0, TERMINAL, SEOGWIPO),
    variant("202", 1, TERMINAL, SEOGWIPO),
    variant("202", 2, TERMINAL, SEOGWIPO),
  ];
  const [group] = groupVariantsByEndpoints(shared);
  assert.equal(group.variantCount, 3, "identical endpoints do not make one route");
  assert.deepEqual(group.variants.map((row) => row.routeId), ["JEB20200", "JEB20201", "JEB20202"]);

  // With nothing looked up there is nothing to tell them apart, and the screen
  // says so rather than picking the first one.
  const blind = compareVariants(shared, new Map());
  assert.equal(blind.distinguishable, false);
  assert.deepEqual(blind.rows.map((row) => row.detail), ["", "", ""]);

  // Once stop counts are known the difference is real and is shown as it is.
  const measured = compareVariants(shared, new Map([
    ["JEB20200", { stopCount: 42, topologyKind: "linear" }],
    ["JEB20201", { stopCount: 38, topologyKind: "linear" }],
    ["JEB20202", { stopCount: 51, topologyKind: "loop" }],
  ]));
  assert.equal(measured.distinguishable, true);
  assert.deepEqual(measured.rows.map((row) => row.detail),
    ["정류장 42개 · 직선", "정류장 38개 · 직선", "정류장 51개 · 순환"]);

  // Same endpoints, same stop count, different shape: still three routes.
  const alike = compareVariants(shared, new Map([
    ["JEB20200", { stopCount: 42, topologyKind: "linear" }],
    ["JEB20201", { stopCount: 42, topologyKind: "linear" }],
    ["JEB20202", { stopCount: 42, topologyKind: "linear" }],
  ]));
  assert.equal(alike.distinguishable, false, "look-alikes are admitted, not resolved");
  assert.equal(groupVariantsByEndpoints(shared)[0].variants.length, 3);
});

test("variants with no endpoint names are listed rather than lumped together", () => {
  const nameless = [
    { routeId: "JEB-A", routeNumber: "202" },
    { routeId: "JEB-B", routeNumber: "202" },
  ];
  const rows = routeChoiceRows(nameless);
  assert.deepEqual(rows.map((row) => row.kind), ["route", "route"],
    "a group needs two endpoint names to be worth showing as one");
  assert.deepEqual(rows.map((row) => row.variant.routeId), ["JEB-A", "JEB-B"]);
});

test("an empty query leaves the whole catalog as the provider gave it", () => {
  const tiers = tierRouteMatches(ROUTE_202_SEARCH, "");
  assert.deepEqual(tiers.exact, []);
  assert.deepEqual(tiers.related, []);
  assert.equal(tiers.other.length, ROUTE_202_SEARCH.length);
  assert.deepEqual(tiers.other.map((row) => row.routeId), ROUTE_202_SEARCH.map((row) => row.routeId));
});

test("route numbers read in the order a person expects", () => {
  const numbers = ["202-10", "202", "202-2", "1202", "202-1", "202A"];
  assert.deepEqual([...numbers].sort(compareRouteNumbers),
    ["202", "202-1", "202-2", "202-10", "202A", "1202"]);
});

test("the related section groups branches under their own numbers", () => {
  const related = tierRouteMatches(ROUTE_202_SEARCH, "202").related;
  const groups = groupVariantsByNumber(related);
  assert.deepEqual(groups.map((group) => group.routeNumber), ["202-1", "202-2", "202-3", "202-4"]);
  assert.deepEqual(groups.map((group) => group.variants.length), [5, 5, 4, 3]);
  assert.equal(groups.reduce((total, group) => total + group.variants.length, 0), related.length);
});
