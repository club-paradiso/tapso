/**
 * Ride Capture Controller — the part with no browser in it.
 *
 * Everything here is pure or store-injected so it can be exercised under
 * `node --test` exactly as it runs on the phone. The DOM, IndexedDB, the
 * polling timer and the lifecycle listeners live in `app.js`; the rules about
 * what a capture *is* live here.
 *
 * Three rules this file exists to hold:
 *  - the capture it produces is the same `RideCapture` shape the CLI writes, so
 *    one analyzer reads both;
 *  - a physical marker is rider ground truth and is never derived from a
 *    provider observation;
 *  - the tracked vehicle changes only when the rider says so, never silently.
 */

/** Matches `RIDE_CAPTURE_SCHEMA_VERSION` in services/api/src/rideCapture.ts. */
export const RIDE_CAPTURE_SCHEMA_VERSION = 1;
export const CAPTURE_SOURCE = "web-controller";

/** Mirrors the validated CLI runner defaults. Changing these changes evidence. */
export const DEFAULT_INTERVAL_MS = 5_000;
export const MIN_INTERVAL_MS = 3_000;
export const DEFAULT_MAX_SNAPSHOTS = 720;
export const DEFAULT_MAX_DURATION_MS = 90 * 60 * 1_000;

/**
 * Convenience only. A preset still has to survive the same live preflight as a
 * hand-entered route: it names identifiers to check, never identifiers to trust.
 */
export const RIDE_PRESETS = [
  {
    id: "jeju-447-dopyeong-jejudae",
    label: "447 도평동 → 제주대학교",
    cityCode: "39",
    routeNo: "447",
    routeId: "JEB405244701",
    direction: "도평동 → 제주대학교",
    boarding: { sequence: 27, stopId: "JEB405002104", name: "농림축산검역본부[남]" },
    destination: { sequence: 34, stopId: "JEB405000334", name: "관덕정[남]" },
  },
];

export class RideCaptureError extends Error {}

export function normalizeVehicleId(value) {
  return String(value ?? "").replace(/[\s-]/g, "");
}

/**
 * Vehicle numbers shown to the operator are trimmed to the shortest suffix that
 * is still unique across the vehicles currently on the route. Four characters
 * is what a rider can read off a plate; the suffix only grows when two buses
 * would otherwise look identical, because that is the one case where a short
 * label could put the capture on the wrong bus.
 */
export function maskVehicleIds(vehicleIds) {
  const ids = [...new Set(vehicleIds.map(normalizeVehicleId).filter(Boolean))];
  const longest = ids.reduce((max, id) => Math.max(max, id.length), 0);
  for (const length of [4, 6, 8, longest]) {
    const masked = new Map(ids.map((id) => [id, maskTo(id, length)]));
    if (new Set(masked.values()).size === ids.length) return masked;
  }
  return new Map(ids.map((id) => [id, id]));
}

export function maskVehicleId(vehicleId, length = 4) {
  return maskTo(normalizeVehicleId(vehicleId), length);
}

function maskTo(id, length) {
  return id.length <= length ? id : `…${id.slice(-length)}`;
}

/**
 * Route shape as the server classified it. A client that did not get the field
 * assumes `linear`, which is the reading that refuses wrap-around — the safe
 * side of the only question this answers.
 */
export function normalizeTopology(topology, stops) {
  const list = Array.isArray(stops) ? stops : [];
  if (topology && typeof topology.kind === "string") {
    return {
      kind: topology.kind,
      stopCount: topology.stopCount ?? list.length,
      cycleLength: topology.cycleLength ?? list.length,
      duplicateStopIdCount: topology.duplicateStopIdCount ?? 0,
      duplicateStopNameCount: topology.duplicateStopNameCount ?? 0,
    };
  }
  return {
    kind: "linear",
    stopCount: list.length,
    cycleLength: list.length,
    duplicateStopIdCount: 0,
    duplicateStopNameCount: 0,
  };
}

/**
 * Stops still to go. Subtraction on a straight route; the forward arc on a loop,
 * because a bus at 38 of 40 heading for 3 has five stops left, not minus
 * thirty-five.
 */
export function forwardStops(from, to, topology, wrapAround) {
  if (!wrapAround) return Math.max(0, to - from);
  const modulus = Math.max(1, topology.cycleLength);
  return (((to - from) % modulus) + modulus) % modulus;
}

/**
 * The preflight gate, expressed once. It answers with every problem it found
 * rather than the first, because the operator is standing at a bus stop and a
 * second round trip costs a departure.
 */
export function verifyTopology({ stops, boardingSequence, destinationSequence, topology }) {
  const problems = [];
  const list = Array.isArray(stops) ? stops : [];
  const shape = normalizeTopology(topology, list);
  if (list.length === 0) problems.push("이 노선의 정류장 목록이 비어 있다");

  const sequences = list.map((stop) => stop.sequence);
  const ordered = sequences.every((value, index) => index === 0 || value > sequences[index - 1]);
  if (list.length > 0 && !ordered) problems.push("정류장 순번이 오름차순이 아니다");

  const known = new Set(sequences);
  if (!known.has(boardingSequence)) problems.push(`승차 순번 ${boardingSequence}이 이 방향에 없다`);
  if (!known.has(destinationSequence)) problems.push(`하차 순번 ${destinationSequence}이 이 방향에 없다`);

  let wrapAround = false;
  if (known.has(boardingSequence) && known.has(destinationSequence)) {
    if (boardingSequence === destinationSequence) {
      problems.push("승차와 하차가 같은 정류장이다");
    } else if (boardingSequence > destinationSequence) {
      // Only a list that closes on itself can be ridden past its end. A route
      // that merely passes some stop twice cannot say which pass this is, so it
      // fails closed rather than producing markers nobody can interpret.
      if (shape.kind === "loop") {
        wrapAround = true;
      } else if (shape.kind === "repeating") {
        problems.push("AMBIGUOUS_TOPOLOGY: 같은 정류장을 두 번 지나는 노선이라 순환 승차를 판별할 수 없다");
      } else {
        problems.push("하차 순번이 승차 순번보다 뒤여야 한다 (방향이 반대일 수 있다)");
      }
    }
  }
  return { ok: problems.length === 0, problems, wrapAround, topology: shape };
}

/**
 * Two stops on one route can share a name. Where that happens the label carries
 * the official stop id as well, so the operator picks the stop and not the word.
 */
export function labelStops(stops) {
  const list = Array.isArray(stops) ? stops : [];
  const counts = new Map();
  for (const stop of list) counts.set(stop.name, (counts.get(stop.name) ?? 0) + 1);
  return list.map((stop) => ({
    ...stop,
    label: counts.get(stop.name) > 1 ? `${stop.sequence}. ${stop.name} · ${stop.stopId}` : `${stop.sequence}. ${stop.name}`,
  }));
}

/**
 * A preset names a stop by id as well as by sequence. If live topology has
 * moved underneath it, the mismatch is reported instead of silently riding the
 * wrong stop, and the operator picks the stops by hand.
 */
export function verifyPreset(preset, stops, topology) {
  const problems = [];
  const list = Array.isArray(stops) ? stops : [];
  for (const [role, target] of [["승차", preset.boarding], ["하차", preset.destination]]) {
    const found = list.find((stop) => stop.sequence === target.sequence);
    if (!found) {
      problems.push(`${role} 순번 ${target.sequence}이 현재 노선에 없다`);
      continue;
    }
    if (target.stopId && found.stopId !== target.stopId) {
      problems.push(`${role} 순번 ${target.sequence}의 정류장 ID가 프리셋과 다르다 (현재 ${found.stopId})`);
    }
  }
  const verdict = verifyTopology({
    stops: list,
    topology,
    boardingSequence: preset.boarding.sequence,
    destinationSequence: preset.destination.sequence,
  });
  return { ok: problems.length === 0 && verdict.ok, problems: [...problems, ...verdict.problems] };
}

/**
 * The stops the rider still has ahead of them, in the order they will meet them.
 * On a wrap-around journey that list runs off the end of the topology and
 * continues from its start, which is exactly what the bus does.
 */
export function stopsBetween(stops, fromSequence, toSequence, wrapAround = false) {
  const list = stops ?? [];
  if (!wrapAround) return list.filter((stop) => stop.sequence >= fromSequence && stop.sequence <= toSequence);
  const tail = list.filter((stop) => stop.sequence >= fromSequence);
  const head = list.filter((stop) => stop.sequence <= toSequence);
  // The seam stop appears at both ends of a closed list; show it once.
  const seen = new Set();
  return [...tail, ...head].filter((stop) => {
    if (seen.has(stop.stopId)) return false;
    seen.add(stop.stopId);
    return true;
  });
}

export function findVehicle(vehicles, vehicleId) {
  if (!vehicleId) return undefined;
  const needle = normalizeVehicleId(vehicleId);
  return (vehicles ?? []).find((vehicle) => normalizeVehicleId(vehicle.vehicleId) === needle);
}

export function newCaptureId() {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `capture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * The capture header: everything that is fixed for the whole ride. Snapshots,
 * markers and events are appended separately so a poll costs one small write
 * instead of rewriting the growing capture.
 */
export function createCaptureHeader({
  captureId = newCaptureId(),
  startedAt,
  routeId,
  cityCode,
  routeNo,
  direction,
  boardingStopSequence,
  destinationStopSequence,
  intervalMs = DEFAULT_INTERVAL_MS,
  stops,
  topology,
}) {
  if (!routeId || !cityCode) throw new RideCaptureError("routeId and cityCode are required");
  const verdict = verifyTopology({
    stops,
    topology,
    boardingSequence: boardingStopSequence,
    destinationSequence: destinationStopSequence,
  });
  if (!verdict.ok) throw new RideCaptureError(verdict.problems.join(" / "));
  return {
    captureId,
    schemaVersion: RIDE_CAPTURE_SCHEMA_VERSION,
    source: CAPTURE_SOURCE,
    startedAt,
    routeId,
    cityCode,
    routeNo: routeNo ?? undefined,
    direction: direction ?? undefined,
    boardingStopSequence,
    destinationStopSequence,
    intervalMs: Math.max(MIN_INTERVAL_MS, intervalMs),
    stops,
    topology: verdict.topology,
    wrapAround: verdict.wrapAround,
  };
}

/**
 * The live capture. Every mutation writes through to the injected store before
 * it resolves, so an unexpected reload loses at most the poll in flight.
 */
export function createCaptureSession({
  store,
  header,
  now = () => new Date(),
  snapshots = [],
  markers = [],
  events = [],
  maxSnapshots = DEFAULT_MAX_SNAPSHOTS,
  maxDurationMs = DEFAULT_MAX_DURATION_MS,
}) {
  if (!store) throw new RideCaptureError("a store is required");
  let boardedVehicleId = header.boardedVehicleId;
  let endedAt = header.endedAt;

  const stopSequences = new Set(header.stops.map((stop) => stop.sequence));

  async function append(kind, value) {
    const collection = kind === "snapshot" ? snapshots : kind === "marker" ? markers : events;
    const index = collection.length;
    collection.push(value);
    if (kind === "snapshot") await store.putSnapshot(header.captureId, index, value);
    else if (kind === "marker") await store.putMarker(header.captureId, index, value);
    else await store.putEvent(header.captureId, index, value);
    return value;
  }

  async function persistHeader() {
    await store.putHeader({ ...header, boardedVehicleId, endedAt });
  }

  return {
    get captureId() {
      return header.captureId;
    },
    get boardedVehicleId() {
      return boardedVehicleId;
    },
    get wrapAround() {
      return Boolean(header.wrapAround);
    },
    get topology() {
      return header.topology;
    },
    snapshots,
    markers,
    events,

    /** One completed poll. `vehicles` on success, `error` on a provider failure. */
    async recordSnapshot({ capturedAt = now().toISOString(), vehicles, error }) {
      const snapshot = error
        ? { capturedAt, vehicles: [], error: String(error) }
        : { capturedAt, vehicles: vehicles ?? [] };
      return append("snapshot", snapshot);
    },

    /**
     * The rider names the bus they are physically on. A second call is refused
     * unless it is explicitly a replacement, and the polling loop never calls
     * this at all — the tracked vehicle cannot change by itself.
     */
    async board(vehicleId, { replace = false, at = now().toISOString() } = {}) {
      const typed = String(vehicleId ?? "").trim();
      if (!normalizeVehicleId(typed)) throw new RideCaptureError("차량을 선택해야 한다");
      if (boardedVehicleId && !replace) {
        throw new RideCaptureError("이미 차량이 기록되어 있다. 교체하려면 명시적으로 확인해야 한다");
      }
      // Store the identifier exactly as the provider publishes it, resolving
      // through the latest snapshot when it is there. Normalisation is only ever
      // a comparison aid: storing the normalised form would silently stop
      // matching the moment a provider used a space or a hyphen.
      const latest = [...snapshots].reverse().find((snapshot) => !snapshot.error);
      const resolved = findVehicle(latest?.vehicles, typed)?.vehicleId ?? typed;
      const replaced = boardedVehicleId && boardedVehicleId !== resolved ? boardedVehicleId : undefined;
      boardedVehicleId = resolved;
      await persistHeader();
      await append("marker", { at, kind: "boarded", stopSequence: header.boardingStopSequence });
      if (replaced) {
        await append("event", { at, kind: "resumed", detail: "tracked vehicle replaced by the rider" });
      }
      return resolved;
    },

    /**
     * Rider ground truth: the bus physically halted here and the doors opened.
     * Never inferred from a snapshot — that inference is what the ride exists
     * to measure against.
     */
    async passedStop(sequence, { at = now().toISOString() } = {}) {
      if (!Number.isInteger(sequence) || !stopSequences.has(sequence)) {
        throw new RideCaptureError("이 노선의 실제 정류장 순번이어야 한다");
      }
      return append("marker", { at, kind: "passed_stop", stopSequence: sequence });
    },

    async alight(sequence = header.destinationStopSequence, { at = now().toISOString() } = {}) {
      if (!Number.isInteger(sequence)) throw new RideCaptureError("하차 순번이 정수여야 한다");
      return append("marker", { at, kind: "alighted", stopSequence: sequence });
    },

    async note(text, { at = now().toISOString() } = {}) {
      const value = String(text ?? "").trim();
      if (!value) throw new RideCaptureError("메모가 비어 있다");
      return append("marker", { at, kind: "note", note: value });
    },

    async recordEvent(kind, detail, { at = now().toISOString() } = {}) {
      return append("event", detail === undefined ? { at, kind } : { at, kind, detail });
    },

    async finalize({ at = now().toISOString() } = {}) {
      endedAt = at;
      await persistHeader();
      return this.capture();
    },

    /** Why the runner would stop on its own, or undefined while it should continue. */
    limitReached() {
      if (snapshots.length >= maxSnapshots) return `스냅샷 상한 ${maxSnapshots}에 도달했다`;
      const elapsed = now().getTime() - Date.parse(header.startedAt);
      if (elapsed >= maxDurationMs) return `시간 상한 ${Math.round(maxDurationMs / 60_000)}분에 도달했다`;
      return undefined;
    },

    status() {
      const successful = snapshots.filter((snapshot) => !snapshot.error);
      const last = successful.at(-1);
      const tracked = findVehicle(last?.vehicles, boardedVehicleId);
      return {
        captureId: header.captureId,
        elapsedSeconds: Math.max(0, Math.round((now().getTime() - Date.parse(header.startedAt)) / 1_000)),
        snapshotCount: snapshots.length,
        successfulCount: successful.length,
        failedCount: snapshots.length - successful.length,
        markerCount: markers.length,
        eventCount: events.length,
        boardedVehicleId,
        lastPollAt: snapshots.at(-1)?.capturedAt,
        lastSuccessAt: last?.capturedAt,
        trackedPresent: Boolean(tracked),
        trackedStopSequence: tracked?.stopSequence,
        trackedStopName: tracked?.stopName,
        remainingStops: tracked?.stopSequence === undefined
          ? undefined
          : forwardStops(tracked.stopSequence, header.destinationStopSequence, header.topology ?? { cycleLength: header.stops.length }, Boolean(header.wrapAround)),
        lastMarker: markers.at(-1),
        vehicles: last?.vehicles ?? [],
      };
    },

    /** Exactly the `RideCapture` the CLI writes, plus the two optional fields. */
    capture() {
      return {
        schemaVersion: header.schemaVersion,
        source: header.source,
        startedAt: header.startedAt,
        ...(endedAt ? { endedAt } : {}),
        routeId: header.routeId,
        cityCode: header.cityCode,
        boardingStopSequence: header.boardingStopSequence,
        destinationStopSequence: header.destinationStopSequence,
        ...(boardedVehicleId ? { boardedVehicleId } : {}),
        intervalMs: header.intervalMs,
        stops: header.stops,
        snapshots,
        markers,
        events,
      };
    },
  };
}

/** Restores a session from whatever survived in the store after a reload. */
export function resumeCaptureSession({ store, record, now }) {
  const session = createCaptureSession({
    store,
    header: record.header,
    snapshots: record.snapshots ?? [],
    markers: record.markers ?? [],
    events: record.events ?? [],
    ...(now ? { now } : {}),
  });
  return session;
}

/** Filename stem shared by the raw capture and its report, as the CLI names them. */
export function captureFileStem(capture) {
  const stamp = capture.startedAt.replace(/[:.]/g, "-");
  return `${capture.routeId}-${stamp}`;
}
