/**
 * Ride Capture Controller — the browser layer.
 *
 * IndexedDB, the polling timer, the lifecycle listeners, the wake lock and the
 * DOM. Every rule about what a capture means lives in `capture-core.js`; this
 * file only carries it to and from the phone.
 *
 * The operator token is held in `sessionStorage` and sent as a bearer header.
 * It never reaches IndexedDB, never reaches a capture, and never reaches a URL.
 */

import {
  CAPTURE_SOURCE,
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  RIDE_PRESETS,
  captureFileStem,
  createCaptureHeader,
  createCaptureSession,
  findVehicle,
  labelStops,
  maskVehicleIds,
  newCaptureId,
  resumeCaptureSession,
  stopsBetween,
  verifyPreset,
  verifyTopology,
} from "./capture-core.js";

const TOKEN_KEY = "tapso.rideCapture.operatorToken";
/** Vercel refuses a larger request body; above this the raw export is the path. */
const MAX_ANALYZE_BYTES = 3_500_000;

const el = (id) => document.getElementById(id);
const screens = ["setup", "ready", "active", "finished"];

const state = {
  cityCode: "39",
  routeNo: "",
  variants: [],
  route: undefined,
  stops: [],
  topology: undefined,
  wrapAround: false,
  boardingSequence: undefined,
  destinationSequence: undefined,
  intervalMs: DEFAULT_INTERVAL_MS,
  session: undefined,
  polling: false,
  wakeLock: undefined,
  wakeLockState: "unknown",
  report: undefined,
};

/* ------------------------------------------------------------------ storage */

const DB_NAME = "tapso-ride-capture";
const DB_VERSION = 1;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("headers")) db.createObjectStore("headers", { keyPath: "captureId" });
      for (const name of ["snapshots", "markers", "events"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: ["captureId", "index"] });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * One small append per poll rather than a rewrite of the growing capture: a
 * 90-minute ride is over a thousand snapshots, and rewriting all of them every
 * five seconds is how a phone runs out of battery and patience.
 */
function createIndexedDbStore(db) {
  const write = (storeName, value) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  const readAll = (storeName) => new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });

  return {
    putHeader: (header) => write("headers", header),
    putSnapshot: (captureId, index, snapshot) => write("snapshots", { captureId, index, snapshot }),
    putMarker: (captureId, index, marker) => write("markers", { captureId, index, marker }),
    putEvent: (captureId, index, event) => write("events", { captureId, index, event }),

    async loadLatest() {
      const headers = await readAll("headers");
      if (headers.length === 0) return undefined;
      const header = headers.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).at(-1);
      const pick = async (storeName, key) => (await readAll(storeName))
        .filter((row) => row.captureId === header.captureId)
        .sort((a, b) => a.index - b.index)
        .map((row) => row[key]);
      return {
        header,
        snapshots: await pick("snapshots", "snapshot"),
        markers: await pick("markers", "marker"),
        events: await pick("events", "event"),
      };
    },

    async clear() {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(["headers", "snapshots", "markers", "events"], "readwrite");
        for (const name of ["headers", "snapshots", "markers", "events"]) transaction.objectStore(name).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    },
  };
}

/* ---------------------------------------------------------------- api client */

function operatorToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function setOperatorToken(value) {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing can refuse storage. The token then lives for this page
    // load only, which is a degradation, not a failure.
  }
}

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = "GET", body, auth = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) {
    const token = operatorToken();
    if (!token) throw new ApiError("operator token required", 401, "UNAUTHORIZED");
    headers.authorization = `Bearer ${token}`;
  }
  let response;
  try {
    response = await fetch(path, { method, headers, body, cache: "no-store" });
  } catch (error) {
    throw new ApiError("네트워크 연결 실패", 0, "NETWORK");
  }
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError("서버 응답을 해석할 수 없다", response.status, "BAD_RESPONSE");
  }
  if (!response.ok) {
    if (response.status === 401) setOperatorToken("");
    throw new ApiError(payload.message ?? "요청 실패", response.status, payload.error);
  }
  return payload;
}

const api = {
  routes: (cityCode, routeNo) =>
    request(`/v1/routes?cityCode=${encodeURIComponent(cityCode)}&routeNo=${encodeURIComponent(routeNo)}`),
  stops: (routeId, cityCode) =>
    request(`/v1/stops?routeId=${encodeURIComponent(routeId)}&cityCode=${encodeURIComponent(cityCode)}`),
  snapshot: (routeId, cityCode) =>
    request(`/operator/snapshot?routeId=${encodeURIComponent(routeId)}&cityCode=${encodeURIComponent(cityCode)}`, { auth: true }),
  analyze: (capture) =>
    request("/operator/analyze", { method: "POST", body: JSON.stringify(capture), auth: true }),
};

/* --------------------------------------------------------------------- view */

function show(name) {
  for (const screen of screens) el(`screen-${screen}`).hidden = screen !== name;
}

function setStatus(target, message, tone = "") {
  const node = el(target);
  node.textContent = message ?? "";
  node.dataset.tone = tone;
}

function clockText(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function timeText(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------- setup */

async function ensureToken(reason) {
  if (operatorToken()) return true;
  const entered = window.prompt(`${reason}\n운영자 토큰을 입력하라. 이 브라우저 세션에만 보관된다.`);
  if (!entered) return false;
  setOperatorToken(entered.trim());
  return Boolean(operatorToken());
}

async function searchRoutes() {
  const cityCode = el("city-code").value.trim();
  const routeNo = el("route-no").value.trim();
  if (!cityCode || !routeNo) return setStatus("setup-status", "도시 코드와 노선 번호가 필요하다", "warn");
  setStatus("setup-status", "노선 조회 중…");
  try {
    const result = await api.routes(cityCode, routeNo);
    state.cityCode = cityCode;
    state.routeNo = routeNo;
    state.variants = result.items ?? [];
    state.route = undefined;
    state.stops = [];
    renderVariants();
    setStatus("setup-status", state.variants.length
      ? `공식 변형 ${state.variants.length}개. 방향을 고르라.`
      : "이 번호로 등록된 노선이 없다", state.variants.length ? "" : "warn");
  } catch (error) {
    setStatus("setup-status", error.message, "error");
  }
}

function renderVariants() {
  const list = el("variant-list");
  list.replaceChildren();
  for (const variant of state.variants) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card";
    button.dataset.selected = String(state.route?.routeId === variant.routeId);
    button.innerHTML = `<strong>${escapeHtml(variant.startStopName ?? "?")} → ${escapeHtml(variant.endStopName ?? "?")}</strong>
      <span class="mono">${escapeHtml(variant.routeId)}</span>`;
    button.addEventListener("click", () => selectVariant(variant));
    list.append(button);
  }
  el("variant-block").hidden = state.variants.length === 0;
}

async function selectVariant(variant) {
  state.route = variant;
  renderVariants();
  setStatus("setup-status", "정류장 순서 확인 중…");
  try {
    const result = await api.stops(variant.routeId, state.cityCode);
    state.stops = result.items ?? [];
    state.topology = result.meta?.topology;
    renderStopPickers();
    setStatus("setup-status", `${describeTopology()} 승하차를 고르라.`,
      state.topology?.kind === "repeating" ? "warn" : "");
  } catch (error) {
    setStatus("setup-status", error.message, "error");
  }
}

function describeTopology() {
  const kind = state.topology?.kind ?? "linear";
  const shape = kind === "loop"
    ? "순환노선 — 종점에서 기점으로 이어진다."
    : kind === "repeating"
      ? "같은 정류장을 두 번 지나는 노선이다. 순번을 보고 정확한 쪽을 고르라."
      : "";
  return `정류장 ${state.stops.length}개 확인. ${shape}`.trim();
}

function renderStopPickers() {
  // Two stops on one route can share a name, so the label carries the official
  // stop id wherever that happens.
  const labelled = labelStops(state.stops);
  for (const [id, key] of [["boarding-stop", "boardingSequence"], ["destination-stop", "destinationSequence"]]) {
    const select = el(id);
    select.replaceChildren();
    for (const stop of labelled) {
      const option = document.createElement("option");
      option.value = String(stop.sequence);
      option.textContent = stop.label;
      select.append(option);
    }
    if (state[key] !== undefined) select.value = String(state[key]);
  }
  el("stop-block").hidden = state.stops.length === 0;
}

async function applyPreset(preset) {
  el("city-code").value = preset.cityCode;
  el("route-no").value = preset.routeNo;
  setStatus("setup-status", `${preset.label} 프리셋 확인 중…`);
  try {
    const routes = await api.routes(preset.cityCode, preset.routeNo);
    state.cityCode = preset.cityCode;
    state.routeNo = preset.routeNo;
    state.variants = routes.items ?? [];
    const variant = state.variants.find((item) => item.routeId === preset.routeId);
    if (!variant) {
      renderVariants();
      return setStatus("setup-status", `프리셋의 ${preset.routeId}이 현재 조회 결과에 없다. 직접 고르라.`, "warn");
    }
    state.route = variant;
    renderVariants();
    const stops = await api.stops(preset.routeId, preset.cityCode);
    state.stops = stops.items ?? [];
    state.topology = stops.meta?.topology;
    // The preset names stop ids as well as sequences; a mismatch means the
    // topology moved and the operator picks by hand rather than riding a guess.
    const check = verifyPreset(preset, state.stops, state.topology);
    state.boardingSequence = preset.boarding.sequence;
    state.destinationSequence = preset.destination.sequence;
    renderStopPickers();
    el("boarding-stop").value = String(preset.boarding.sequence);
    el("destination-stop").value = String(preset.destination.sequence);
    setStatus("setup-status", check.ok
      ? `프리셋 검증 통과: ${preset.direction}`
      : `프리셋과 실제 노선이 다르다 — ${check.problems.join(" / ")}`, check.ok ? "" : "warn");
  } catch (error) {
    setStatus("setup-status", error.message, "error");
  }
}

async function confirmSelection() {
  if (!state.route) return setStatus("setup-status", "노선 방향을 먼저 고르라", "warn");
  const boardingSequence = Number(el("boarding-stop").value);
  const destinationSequence = Number(el("destination-stop").value);
  const check = verifyTopology({
    stops: state.stops,
    topology: state.topology,
    boardingSequence,
    destinationSequence,
  });
  if (!check.ok) return setStatus("setup-status", check.problems.join(" / "), "error");

  if (!(await ensureToken("실시간 차량 확인에 운영자 인증이 필요하다."))) {
    return setStatus("setup-status", "운영자 토큰 없이는 진행할 수 없다", "warn");
  }
  setStatus("setup-status", "실시간 차량 확인 중…");
  try {
    const snapshot = await api.snapshot(state.route.routeId, state.cityCode);
    if (!snapshot.items?.length) {
      // The endpoint answered; the route simply has nothing running right now.
      // That is legitimate at a terminal before the first departure, so it is a
      // warning with an explicit override rather than a wall.
      const proceed = window.confirm(
        "지금 이 방향에 운행 중인 차량이 없다.\n\n기점에서 첫차를 기다리는 중이라면 그대로 시작해도 된다. 차량은 수집이 돌기 시작하면 나타난다.\n\n그래도 시작하겠나?",
      );
      if (!proceed) {
        return setStatus("setup-status", "차량 0대. 시간대를 바꾸거나 다른 방향을 보라.", "warn");
      }
    }
    state.boardingSequence = boardingSequence;
    state.destinationSequence = destinationSequence;
    state.wrapAround = check.wrapAround;
    state.intervalMs = Math.max(MIN_INTERVAL_MS, Number(el("interval").value) * 1_000);
    renderReady(snapshot.items?.length ?? 0);
    show("ready");
  } catch (error) {
    setStatus("setup-status", error.message, "error");
  }
}

function renderReady(vehicleCount) {
  const boarding = state.stops.find((stop) => stop.sequence === state.boardingSequence);
  const destination = state.stops.find((stop) => stop.sequence === state.destinationSequence);
  el("ready-route-no").textContent = state.routeNo;
  el("ready-direction").textContent = `${state.route.startStopName ?? "?"} → ${state.route.endStopName ?? "?"}`;
  el("ready-boarding").textContent = `${boarding.sequence}. ${boarding.name}`;
  el("ready-destination").textContent = `${destination.sequence}. ${destination.name}`;
  el("ready-route-id").textContent = state.route.routeId;
  const shape = state.wrapAround
    ? " · 순환 승차(종점 넘어감)"
    : state.topology?.kind === "loop" ? " · 순환노선" : "";
  el("ready-meta").textContent = `city ${state.cityCode} · ${state.intervalMs / 1_000}초 간격 · 현재 운행 ${vehicleCount}대${shape}`;
}

/* ------------------------------------------------------------------ capture */

async function startCapture() {
  const header = createCaptureHeader({
    captureId: newCaptureId(),
    startedAt: new Date().toISOString(),
    routeId: state.route.routeId,
    cityCode: state.cityCode,
    routeNo: state.routeNo,
    direction: `${state.route.startStopName ?? "?"} → ${state.route.endStopName ?? "?"}`,
    boardingStopSequence: state.boardingSequence,
    destinationStopSequence: state.destinationSequence,
    intervalMs: state.intervalMs,
    stops: state.stops,
    topology: state.topology,
  });
  await state.store.clear();
  await state.store.putHeader(header);
  state.session = createCaptureSession({ store: state.store, header });
  await state.session.recordEvent(navigator.onLine ? "online" : "offline");
  show("active");
  renderActive();
  await acquireWakeLock();
  startPolling();
}

function startPolling() {
  if (state.polling) return;
  state.polling = true;
  void pollLoop();
}

/**
 * Strictly sequential: one request in flight, persisted before the next is
 * scheduled. A suspended tab simply stalls here — nothing fills in the missing
 * polls afterwards, because a manufactured snapshot is not evidence.
 */
async function pollLoop() {
  while (state.polling && state.session) {
    const startedAt = Date.now();
    try {
      const result = await api.snapshot(state.session.capture().routeId, state.session.capture().cityCode);
      await state.session.recordSnapshot({ vehicles: result.items ?? [] });
      setStatus("active-status", "");
    } catch (error) {
      await state.session.recordSnapshot({ error: error.message });
      setStatus("active-status", `수집 실패: ${error.message}`, "warn");
      if (error.status === 401) {
        state.polling = false;
        setStatus("active-status", "운영자 인증이 만료됐다. 토큰을 다시 입력하고 재개하라.", "error");
        el("resume-poll").hidden = false;
        renderActive();
        return;
      }
    }
    renderActive();
    const limit = state.session.limitReached();
    if (limit) {
      setStatus("active-status", limit, "warn");
      await finishCapture();
      return;
    }
    const wait = Math.max(0, state.session.capture().intervalMs - (Date.now() - startedAt));
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

function renderActive() {
  const status = state.session.status();
  const capture = state.session.capture();
  el("clock").textContent = clockText(status.elapsedSeconds);
  el("snapshot-count").textContent = `${status.successfulCount}/${status.snapshotCount}`;
  el("marker-count").textContent = String(status.markerCount);
  el("last-poll").textContent = timeText(status.lastPollAt);
  el("connection").textContent = navigator.onLine ? "온라인" : "오프라인";
  el("connection").dataset.tone = navigator.onLine ? "" : "error";
  el("wake-state").textContent = state.wakeLockState === "active" ? "화면 켜짐 유지" : "화면 유지 불가";
  el("wake-state").dataset.tone = state.wakeLockState === "active" ? "" : "warn";

  const boarded = Boolean(status.boardedVehicleId);
  el("board-block").hidden = boarded;
  el("ride-block").hidden = !boarded;

  if (!boarded) {
    renderVehicleCards(status.vehicles);
    return;
  }

  const masked = maskVehicleIds([status.boardedVehicleId]);
  el("tracked-id").textContent = masked.get(status.boardedVehicleId) ?? "—";
  el("tracked-presence").textContent = status.trackedPresent ? "스냅샷에 있음" : "스냅샷에 없음";
  el("tracked-presence").dataset.tone = status.trackedPresent ? "" : "warn";
  el("tracked-stop").textContent = status.trackedStopSequence === undefined
    ? "—"
    : `${status.trackedStopSequence}. ${status.trackedStopName ?? ""}`;
  el("tracked-remaining").textContent = status.remainingStops === undefined ? "—" : `${status.remainingStops}개 남음`;
  el("last-marker").textContent = status.lastMarker
    ? `${status.lastMarker.kind}${status.lastMarker.stopSequence !== undefined ? ` @${status.lastMarker.stopSequence}` : ""} · ${timeText(status.lastMarker.at)}`
    : "아직 없음";
  renderStopButtons(capture, status);
}

function renderVehicleCards(vehicles) {
  const list = el("vehicle-list");
  list.replaceChildren();
  if (vehicles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "이 노선에 보고된 차량이 없다. 다음 수집을 기다려라.";
    list.append(empty);
    return;
  }
  const masked = maskVehicleIds(vehicles.map((vehicle) => vehicle.vehicleId));
  for (const vehicle of [...vehicles].sort((a, b) => (a.stopSequence ?? 0) - (b.stopSequence ?? 0))) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card vehicle";
    button.innerHTML = `<strong class="mono">${escapeHtml(masked.get(vehicle.vehicleId.replace(/[\s-]/g, "")) ?? "?")}</strong>
      <span>현재 ${escapeHtml(vehicle.stopName ?? "?")}</span>
      <span class="muted">seq ${vehicle.stopSequence ?? "?"}</span>`;
    button.addEventListener("click", () => board(vehicle));
    list.append(button);
  }
}

async function board(vehicle) {
  const masked = maskVehicleIds([vehicle.vehicleId]).get(vehicle.vehicleId.replace(/[\s-]/g, ""));
  const ok = window.confirm(`${masked} · 현재 ${vehicle.stopName ?? "?"} (seq ${vehicle.stopSequence ?? "?"})\n지금 타고 있는 버스가 맞나?`);
  if (!ok) return;
  await state.session.board(vehicle.vehicleId);
  renderActive();
}

function renderStopButtons(capture, status) {
  const from = status.trackedStopSequence ?? capture.boardingStopSequence;
  const list = el("stop-buttons");
  list.replaceChildren();
  // Ground truth only: the operator taps where the bus actually halted, so the
  // list is offered from wherever the ride is, never pre-selected from it.
  const wrapAround = Boolean(state.session?.wrapAround);
  const window_ = wrapAround ? from : Math.max(capture.boardingStopSequence, from - 2);
  for (const stop of stopsBetween(capture.stops, window_, capture.destinationStopSequence, wrapAround)) {
    const marked = capture.markers.some((marker) => marker.kind === "passed_stop" && marker.stopSequence === stop.sequence);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card stop";
    button.dataset.marked = String(marked);
    button.innerHTML = `<span class="seq">${stop.sequence}</span><span>${escapeHtml(stop.name)}</span>`;
    button.addEventListener("click", async () => {
      await state.session.passedStop(stop.sequence);
      renderActive();
    });
    list.append(button);
  }
}

async function finishCapture() {
  state.polling = false;
  releaseWakeLock();
  const capture = await state.session.finalize();
  show("finished");
  el("finished-summary").textContent =
    `스냅샷 ${capture.snapshots.length} · 마커 ${capture.markers.length} · 이벤트 ${capture.events.length}`;
  setStatus("finished-status", "분석 중…");
  const encoded = JSON.stringify(capture);
  if (encoded.length > MAX_ANALYZE_BYTES) {
    setStatus("finished-status", "캡처가 커서 서버 분석을 건너뛴다. RAW를 내보낸 뒤 CLI analyze.ts로 분석하라.", "warn");
    return;
  }
  try {
    state.report = await api.analyze(capture);
    renderReport(state.report);
    setStatus("finished-status", "");
  } catch (error) {
    setStatus("finished-status", `분석 실패: ${error.message}. RAW를 내보내고 CLI로 분석하라.`, "warn");
  }
}

function renderReport(report) {
  el("report-block").hidden = false;
  el("report-verdict").textContent = report.evidenceCompleteness.verdict;
  el("report-verdict").dataset.tone = report.evidenceCompleteness.verdict === "SUFFICIENT" ? "ok" : "warn";
  const rows = [
    ["추적 차량 관측", report.tracked.present ? `있음 (비율 ${report.tracked.presenceRatio})` : "없음"],
    ["내용 변경 간격 median", `${report.freshnessEvidence.contentChangeIntervalSeconds.median ?? "—"} s`],
    ["마커 지연 median", `${report.freshnessEvidence.markerLagSeconds.median ?? "—"} s`],
    ["미충족 항목", report.evidenceCompleteness.unmetRequired.join(", ") || "없음"],
    ["경고", String(report.warnings.length)],
  ];
  el("report-rows").replaceChildren();
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    el("report-rows").append(row);
  }
}

/* ------------------------------------------------------------------- export */

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 2_000);
}

/* ---------------------------------------------------------------- lifecycle */

async function acquireWakeLock() {
  if (!("wakeLock" in navigator)) {
    state.wakeLockState = "unavailable";
    await state.session?.recordEvent("wake_lock_unavailable", "navigator.wakeLock is not available");
    return;
  }
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLockState = "active";
    state.wakeLock.addEventListener("release", () => {
      state.wakeLockState = "released";
      renderIfActive();
    });
    await state.session?.recordEvent("wake_lock_active");
  } catch (error) {
    state.wakeLockState = "unavailable";
    await state.session?.recordEvent("wake_lock_unavailable", "request rejected");
  }
}

function releaseWakeLock() {
  try {
    void state.wakeLock?.release();
  } catch {
    // Already gone; nothing to do.
  }
  state.wakeLock = undefined;
  state.wakeLockState = "released";
}

function renderIfActive() {
  if (state.session && !el("screen-active").hidden) renderActive();
}

function registerLifecycle() {
  document.addEventListener("visibilitychange", async () => {
    if (!state.session || !state.polling) return;
    if (document.visibilityState === "hidden") {
      await state.session.recordEvent("hidden");
      return;
    }
    await state.session.recordEvent("visible");
    // Safari suspends timers in the background. The hole that leaves is the
    // instrument's, and it is recorded as such instead of being filled in.
    setStatus("active-status", "화면이 꺼져 있던 동안 수집이 멈췄다. 그 구간은 기록에 공백으로 남는다.", "warn");
    await acquireWakeLock();
    renderActive();
  });
  window.addEventListener("pagehide", () => {
    void state.session?.recordEvent("hidden", "pagehide");
  });
  window.addEventListener("pageshow", () => {
    void state.session?.recordEvent("visible", "pageshow");
    renderIfActive();
  });
  window.addEventListener("offline", () => {
    void state.session?.recordEvent("offline");
    renderIfActive();
  });
  window.addEventListener("online", () => {
    void state.session?.recordEvent("online");
    renderIfActive();
  });
}

/* --------------------------------------------------------------------- boot */

async function recoverIfPossible() {
  const record = await state.store.loadLatest();
  if (!record || record.header.endedAt) return false;
  const started = new Date(record.header.startedAt);
  const ok = window.confirm(
    `종료되지 않은 캡처가 있다.\n${record.header.routeId} · ${started.toLocaleString()}\n스냅샷 ${record.snapshots.length}개\n\n이어서 진행하겠나? 취소하면 그대로 보존된 채 새 캡처를 시작할 수 있다.`,
  );
  if (!ok) return false;
  state.session = resumeCaptureSession({ store: state.store, record });
  state.route = { routeId: record.header.routeId, startStopName: "", endStopName: "" };
  state.cityCode = record.header.cityCode;
  state.stops = record.header.stops;
  await state.session.recordEvent("resumed", "reopened after a reload");
  show("active");
  renderActive();
  await acquireWakeLock();
  startPolling();
  return true;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function boot() {
  const presets = el("preset-list");
  for (const preset of RIDE_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card preset";
    button.textContent = preset.label;
    button.addEventListener("click", () => applyPreset(preset));
    presets.append(button);
  }

  el("search-routes").addEventListener("click", searchRoutes);
  el("confirm-selection").addEventListener("click", confirmSelection);
  el("start-capture").addEventListener("click", startCapture);
  el("back-to-setup").addEventListener("click", () => show("setup"));
  el("mark-note").addEventListener("click", async () => {
    const note = window.prompt("특이사항");
    if (note?.trim()) {
      await state.session.note(note);
      renderActive();
    }
  });
  el("mark-alight").addEventListener("click", async () => {
    await state.session.alight();
    renderActive();
  });
  el("finish-capture").addEventListener("click", async () => {
    if (window.confirm("캡처를 종료하겠나?")) await finishCapture();
  });
  el("resume-poll").addEventListener("click", async () => {
    if (!(await ensureToken("인증이 만료됐다."))) return;
    el("resume-poll").hidden = true;
    startPolling();
  });
  el("export-report").addEventListener("click", () => {
    if (!state.report) return;
    downloadJson(`${captureFileStem(state.session.capture())}.report.json`, state.report);
  });
  el("export-raw").addEventListener("click", () => {
    downloadJson(`${captureFileStem(state.session.capture())}.json`, state.session.capture());
  });
  el("copy-report").addEventListener("click", async () => {
    if (!state.report) return;
    await navigator.clipboard.writeText(JSON.stringify(state.report, null, 2));
    setStatus("finished-status", "리포트를 클립보드에 복사했다", "ok");
  });
  el("set-token").addEventListener("click", async () => {
    setOperatorToken("");
    await ensureToken("운영자 토큰을 다시 입력한다.");
    setStatus("setup-status", operatorToken() ? "토큰 저장됨 (이 세션 한정)" : "토큰 없음", operatorToken() ? "ok" : "warn");
  });

  registerLifecycle();

  try {
    state.store = createIndexedDbStore(await openDatabase());
  } catch (error) {
    setStatus("setup-status", "이 브라우저에서 저장소를 열 수 없다. 개인정보 보호 모드를 끄고 다시 열어라.", "error");
    return;
  }
  if (await recoverIfPossible()) return;
  show("setup");
  setStatus("setup-status", `소스 ${CAPTURE_SOURCE} · 프리셋을 누르거나 노선 번호로 조회하라`);
}

void boot();
