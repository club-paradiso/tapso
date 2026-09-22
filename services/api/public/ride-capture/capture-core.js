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
export const CAPTURE_ENGINE = "local-device";

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
  const duplicates = duplicateStopNames(list);
  return list.map((stop) => ({
    ...stop,
    label: duplicates.has(stop.name) ? `${stop.sequence}. ${stop.name} · ${stop.stopId}` : `${stop.sequence}. ${stop.name}`,
  }));
}

/** The names that occur more than once, and therefore cannot stand alone. */
export function duplicateStopNames(stops) {
  const counts = new Map();
  for (const stop of stops ?? []) counts.set(stop.name, (counts.get(stop.name) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
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
    captureEngine: CAPTURE_ENGINE,
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
    get routeNo() {
      return header.routeNo;
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

/* ------------------------------------------------- route compatibility ---- */

/**
 * Can this route be ridden for evidence, and if not, why — in words the person
 * holding the phone can act on. Nothing here guesses through ambiguity: a route
 * that cannot be pinned down is refused, and the reason is shown rather than
 * swallowed.
 */
export function assessRouteCompatibility({ route, stops, topology, vehicleCount, vehiclesFailed }) {
  const list = Array.isArray(stops) ? stops : [];
  const shape = normalizeTopology(topology, list);
  const checks = [];
  const add = (label, state, detail) => checks.push({ label, state, detail });

  const hasRouteId = Boolean(route?.routeId);
  add("노선 식별", hasRouteId ? "ok" : "fail", hasRouteId ? route.routeId : "정확한 노선 ID를 확인할 수 없다");

  const hasStops = list.length > 0;
  add("정류장 목록", hasStops ? "ok" : "fail", hasStops ? `${list.length}개` : "제공자가 정류장을 주지 않는다");

  const ordered = list.every((stop, index) => index === 0 || stop.sequence > list[index - 1].sequence);
  add("정류장 순서", ordered && hasStops ? "ok" : "fail", ordered ? "순서대로 제공됨" : "순서가 뒤섞여 있다");

  const identified = hasStops && list.every((stop) => Boolean(stop.stopId));
  add("정류장 식별자", identified ? "ok" : "fail", identified ? "모두 있음" : "식별자가 없는 정류장이 있다");

  add("노선 구조", shape.kind === "repeating" ? "warn" : "ok", topologyWord(shape.kind));

  // Live vehicles are time-dependent, so a caller that has not looked says so
  // rather than being scored down for it. Static shape is judged on its own.
  const liveChecked = vehiclesFailed || typeof vehicleCount === "number";
  if (vehiclesFailed) add("실시간 차량", "fail", "실시간 조회에 실패했다");
  else if (!liveChecked) add("실시간 차량", "skip", "확인하지 않음");
  else add("실시간 차량", vehicleCount > 0 ? "ok" : "warn", vehicleCount > 0 ? `${vehicleCount}대 운행 중` : "지금은 운행 중인 차량이 없다");

  if (checks.some((check) => check.state === "fail")) {
    return {
      level: "unsupported",
      headline: "이 노선은 지금 안전하게 기록할 수 없습니다",
      reason: checks.find((check) => check.state === "fail").detail,
      checks,
      shape,
    };
  }
  if (liveChecked && vehicleCount === 0) {
    return {
      level: "warning",
      headline: "지금 운행 중인 차량이 없습니다",
      reason: "기록은 시작할 수 있습니다. 차량이 나타나면 그때 고르면 됩니다.",
      checks,
      shape,
    };
  }
  if (shape.kind === "repeating") {
    return {
      level: "warning",
      headline: "같은 정류장을 두 번 지나는 노선입니다",
      reason: "타는 곳과 내리는 곳을 순서까지 보고 골라야 합니다.",
      checks,
      shape,
    };
  }
  return {
    level: "ok",
    headline: "실승차 기록 가능",
    reason: liveChecked ? `${list.length}개 정류장 · ${vehicleCount}대 운행 중` : `${list.length}개 정류장 · 구조 적합`,
    checks,
    shape,
  };
}

/* ------------------------------------------------ route number matching ---- */

/** Every dash a keyboard or a data feed might produce, folded to a plain one. */
const DASHES = /[‐‑‒–—―−－]/g;

/**
 * A route number in the one shape every comparison here uses. Only the writing
 * is normalised — spacing, dash characters, letter case, and the spoken "번" a
 * person types out of habit. The number itself is never altered, so what comes
 * out still names the same route the provider named.
 */
export function normalizeRouteNumber(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(DASHES, "-")
    .replace(/\s+/g, "")
    .replace(/번$/, "")
    .toUpperCase();
}

/** The token that marks a branch of another number, and nothing else. */
const VARIANT_SUFFIX = /^-\d{1,3}$/;

/**
 * A route number's family, and the token that marks it as a branch of that
 * family. Only an explicit variant token counts: a dash and a number ("202-1"),
 * or a single branch letter after a digit ("202A").
 *
 * A number that merely *begins with* another one is never a relative — "2021"
 * is its own route, not a branch of "202". That is the whole reason this is a
 * split rather than a prefix test: a prefix test folds unrelated routes into
 * the family, and the family is what the screen calls "관련 노선".
 */
export function routeNumberFamily(value) {
  const normalized = normalizeRouteNumber(value);
  const dash = normalized.lastIndexOf("-");
  if (dash > 0 && VARIANT_SUFFIX.test(normalized.slice(dash))) {
    return { family: normalized.slice(0, dash), variantSuffix: normalized.slice(dash) };
  }
  const head = normalized.slice(0, -1);
  if (head.length > 0 && /[A-Z]$/.test(normalized) && /\d$/.test(head)) {
    return { family: head, variantSuffix: normalized.slice(-1) };
  }
  return { family: normalized, variantSuffix: "" };
}

/** A number and whatever is written after it, which is how a route number reads. */
function segmentParts(segment) {
  const [, digits, rest] = /^(\d*)(.*)$/.exec(segment);
  return { number: digits === "" ? Number.NaN : Number(digits), rest };
}

/** Route numbers in the order a person expects: 202, 202-1, 202-2, 202-10, 202A. */
export function compareRouteNumbers(left, right) {
  const a = normalizeRouteNumber(left).split("-");
  const b = normalizeRouteNumber(right).split("-");
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    const one = segmentParts(a[index]);
    const two = segmentParts(b[index]);
    const oneNumbered = Number.isFinite(one.number);
    const twoNumbered = Number.isFinite(two.number);
    if (oneNumbered !== twoNumbered) return oneNumbered ? -1 : 1;
    if (oneNumbered && one.number !== two.number) return one.number - two.number;
    if (one.rest !== two.rest) return one.rest < two.rest ? -1 : 1;
  }
  return 0;
}

/**
 * What the provider returned, sorted into what the operator asked for and what
 * merely came back with it.
 *
 *   exact   — the number they typed, normalised. "202" finds 202; "202-1"
 *             finds 202-1, and 202-1 is exact there, not a relative.
 *   related — other members of the same family, reached only through an
 *             explicit variant token (see `routeNumberFamily`).
 *   other   — everything else the provider chose to send back.
 *
 * Nothing is dropped: every variant handed in comes back in exactly one tier,
 * carrying its own `routeId` untouched.
 */
export function tierRouteMatches(variants, query) {
  const list = Array.isArray(variants) ? variants : [];
  const wanted = normalizeRouteNumber(query);
  if (!wanted) return { query: "", family: "", exact: [], related: [], other: [...list] };

  const { family } = routeNumberFamily(wanted);
  const exact = [];
  const related = [];
  const other = [];
  for (const variant of list) {
    const number = normalizeRouteNumber(variant?.routeNumber);
    if (number && number === wanted) exact.push(variant);
    else if (number && routeNumberFamily(number).family === family) related.push(variant);
    else other.push(variant);
  }
  const byNumber = (one, two) => compareRouteNumbers(one?.routeNumber, two?.routeNumber);
  return { query: wanted, family, exact, related: related.sort(byNumber), other: other.sort(byNumber) };
}

/** Variants gathered under the route number they carry, in reading order. */
export function groupVariantsByNumber(variants) {
  const groups = new Map();
  for (const variant of Array.isArray(variants) ? variants : []) {
    const key = normalizeRouteNumber(variant?.routeNumber);
    const group = groups.get(key) ?? { routeNumber: variant?.routeNumber ?? key, variants: [] };
    group.variants.push(variant);
    groups.set(key, group);
  }
  return [...groups.values()].sort((one, two) => compareRouteNumbers(one.routeNumber, two.routeNumber));
}

/** Endpoint names differ only in how they are written, so compare them that way. */
function endpointKey(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Variants of one number, arranged so a person can read them: the ones running
 * between the same two places sit together.
 *
 * PRESENTATION ONLY. No `routeId` is merged, renamed or dropped — every variant
 * handed in comes back inside exactly one group, and a group is a heading over
 * its variants, never a replacement for them. A group of one is not a group at
 * all: it is that single official route, and the screen shows it directly so
 * the simple case costs no extra tap.
 */
export function groupVariantsByEndpoints(variants) {
  const groups = new Map();
  for (const variant of Array.isArray(variants) ? variants : []) {
    // A JSON pair, so no stop name can ever be written to look like a separator.
    const key = JSON.stringify([endpointKey(variant?.startStopName), endpointKey(variant?.endStopName)]);
    const group = groups.get(key) ?? {
      key,
      startStopName: variant?.startStopName,
      endStopName: variant?.endStopName,
      named: Boolean(endpointKey(variant?.startStopName) && endpointKey(variant?.endStopName)),
      variants: [],
    };
    group.variants.push(variant);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    label: `${group.startStopName ?? "기점"} → ${group.endStopName ?? "종점"}`,
    variantCount: group.variants.length,
  }));
}

/**
 * How the choice list should read, row by row. A group of one is that one
 * route, offered directly — the ordinary two-way route therefore costs exactly
 * the taps it always did. Only a group genuinely holding several official
 * routes becomes a heading, and then its routes are one tap behind it.
 *
 * Presentation only: every variant handed in appears exactly once, as itself or
 * inside exactly one group, and its `routeId` is never touched.
 */
export function routeChoiceRows(variants) {
  return groupVariantsByEndpoints(variants).flatMap((group) =>
    group.variantCount === 1 || !group.named
      ? group.variants.map((variant) => ({ kind: "route", variant }))
      : [{ kind: "group", group }]);
}

/** Plain words for a route shape, used wherever one is shown. */
export function topologyWord(kind) {
  if (kind === "loop") return "순환";
  if (kind === "repeating") return "같은 정류장 반복";
  return "직선";
}

/**
 * What still separates variants that share both endpoints. `details` is
 * whatever has actually been *looked up* for each `routeId` — stop count, route
 * shape — and may be empty. Only measured facts count: the route type the
 * provider labels every one of them with separates nothing.
 *
 * Nothing is invented. A variant with nothing measured says nothing, and when
 * every variant reads alike the answer is that they cannot be told apart. That
 * is a reason to show all of them, never a licence to choose one.
 */
export function compareVariants(variants, details) {
  const read = (routeId) => (details instanceof Map ? details.get(routeId) : details?.[routeId]);
  const rows = (Array.isArray(variants) ? variants : []).map((variant) => {
    const detail = read(variant?.routeId);
    const parts = [];
    if (Number.isFinite(detail?.stopCount)) parts.push(`정류장 ${detail.stopCount}개`);
    if (detail?.topologyKind) parts.push(topologyWord(detail.topologyKind));
    return { routeId: variant?.routeId, parts, detail: parts.join(" · "), measured: parts.length > 0 };
  });
  const distinct = new Set(rows.map((row) => row.detail));
  return {
    rows,
    distinguishable: rows.length > 1 && rows.every((row) => row.measured) && distinct.size === rows.length,
  };
}

/* --------------------------------------------------------- stop finding ---- */

/** Substring match over the stop name, with the official id as a fallback key. */
export function searchStops(stops, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return stops ?? [];
  return (stops ?? []).filter((stop) =>
    stop.name.toLowerCase().includes(needle) || String(stop.stopId).toLowerCase().includes(needle));
}

/**
 * Where this bus can still take you from here. A straight route only goes
 * forward; a closed one comes back round, so every other stop is reachable and
 * they are offered in the order the bus will meet them.
 */
export function reachableDestinations(stops, boardingSequence, topology) {
  const list = Array.isArray(stops) ? stops : [];
  const shape = normalizeTopology(topology, list);
  if (shape.kind !== "loop") return list.filter((stop) => stop.sequence > boardingSequence);

  const ordered = list
    .filter((stop) => stop.sequence !== boardingSequence)
    .map((stop) => ({ stop, distance: forwardStops(boardingSequence, stop.sequence, shape, true) }))
    .filter((entry) => entry.distance > 0)
    // The seam stop appears at both ends of a closed list, so both entries sit
    // at the same distance. The forward continuation is the one the bus reaches
    // without wrapping first, which is the entry still ahead in raw order.
    .sort((a, b) => a.distance - b.distance
      || Number(a.stop.sequence < boardingSequence) - Number(b.stop.sequence < boardingSequence));

  const seen = new Set();
  return ordered.filter((entry) => {
    if (seen.has(entry.stop.stopId)) return false;
    seen.add(entry.stop.stopId);
    return true;
  }).map((entry) => entry.stop);
}

/* -------------------------------------------------------- local history ---- */

/**
 * What a finished ride leaves behind so the operator can see which routes they
 * have already covered. Deliberately thin: no vehicle identifier, no
 * coordinates, no snapshots — the raw capture stays where it is.
 */
export function historyEntry({ captureId, routeNo, capture, report }) {
  const boarding = capture.stops.find((stop) => stop.sequence === capture.boardingStopSequence);
  const destination = capture.stops.find((stop) => stop.sequence === capture.destinationStopSequence);
  return {
    // `captureId` and `routeNo` live on the capture header, not in the
    // `RideCapture` the analyzer reads, so they are passed in rather than dug
    // out of a shape that does not carry them.
    captureId,
    finishedAt: capture.endedAt ?? capture.startedAt,
    routeId: capture.routeId,
    cityCode: capture.cityCode,
    routeNo,
    boardingName: boarding?.name,
    destinationName: destination?.name,
    snapshotCount: capture.snapshots.length,
    markerCount: capture.markers.length,
    verdict: report?.evidenceCompleteness?.verdict,
  };
}
