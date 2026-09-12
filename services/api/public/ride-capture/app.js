/**
 * Ride Capture Controller — the browser layer.
 *
 * IndexedDB, the polling timer, the lifecycle listeners, the wake lock, the
 * screens and the sheets. Every rule about what a capture *means* lives in
 * `capture-core.js`; this file only carries it to and from the phone.
 *
 * The operator token is held in `sessionStorage` and sent as a bearer header.
 * It never reaches IndexedDB, never reaches a capture, never reaches a URL.
 */

import {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  assessRouteCompatibility,
  captureFileStem,
  createCaptureHeader,
  createCaptureSession,
  forwardStops,
  duplicateStopNames,
  historyEntry,
  maskVehicleIds,
  newCaptureId,
  normalizeTopology,
  reachableDestinations,
  resumeCaptureSession,
  searchStops,
  stopsBetween,
  verifyTopology,
} from "./capture-core.js";

const TOKEN_KEY = "tapso.rideCapture.operatorToken";
/** Vercel refuses a larger request body; above this the raw export is the path. */
const MAX_ANALYZE_BYTES = 3_500_000;
/** How many stops the "정차 기록" sheet offers around where the bus is now. */
const MARK_WINDOW = 5;

const el = (id) => document.getElementById(id);
const SCREENS = ["home", "directions", "boarding", "destination", "ready", "vehicle", "riding", "finish", "history"];

const state = {
  cityCode: "39",
  intervalMs: DEFAULT_INTERVAL_MS,
  routeNo: "",
  variants: [],
  route: undefined,
  stops: [],
  topology: undefined,
  boarding: undefined,
  destination: undefined,
  wrapAround: false,
  compatibility: undefined,
  session: undefined,
  polling: false,
  wakeLock: undefined,
  wakeLockState: "unknown",
  report: undefined,
  store: undefined,
};

/* ------------------------------------------------------------------ storage */

const DB_NAME = "tapso-ride-capture";
const DB_VERSION = 2;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("headers")) db.createObjectStore("headers", { keyPath: "captureId" });
      for (const name of ["snapshots", "markers", "events"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: ["captureId", "index"] });
      }
      if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", { keyPath: "captureId" });
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
    putHistory: (entry) => write("history", entry),
    readHistory: () => readAll("history"),

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

    /** Clears the working capture only. History is kept until asked otherwise. */
    clearCapture() {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["headers", "snapshots", "markers", "events"], "readwrite");
        for (const name of ["headers", "snapshots", "markers", "events"]) transaction.objectStore(name).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    },

    clearHistory() {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("history", "readwrite");
        transaction.objectStore("history").clear();
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
    if (!token) throw new ApiError("운영자 잠금 해제가 필요하다", 401, "UNAUTHORIZED");
    headers.authorization = `Bearer ${token}`;
  }
  let response;
  try {
    response = await fetch(path, { method, headers, body, cache: "no-store" });
  } catch {
    throw new ApiError("네트워크에 연결할 수 없다", 0, "NETWORK");
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
    throw new ApiError(humanError(payload, response.status), response.status, payload.error);
  }
  return payload;
}

function humanError(payload, status) {
  if (payload.error === "OPERATOR_DISABLED") return "이 배포에는 운영자 기능이 켜져 있지 않다";
  if (status === 401) return "운영자 인증이 필요하다";
  if (status === 429) return "요청이 너무 잦다. 잠시 뒤 다시";
  if (status === 503) return "실시간 데이터를 지금 쓸 수 없다";
  return payload.message ?? "요청이 실패했다";
}

const api = {
  routes: (cityCode, routeNo) =>
    request(`/v1/routes?cityCode=${encodeURIComponent(cityCode)}&routeNo=${encodeURIComponent(routeNo)}`),
  catalog: (cityCode) => request(`/v1/routes?cityCode=${encodeURIComponent(cityCode)}`),
  stops: (routeId, cityCode) =>
    request(`/v1/stops?routeId=${encodeURIComponent(routeId)}&cityCode=${encodeURIComponent(cityCode)}`),
  snapshot: (routeId, cityCode) =>
    request(`/operator/snapshot?routeId=${encodeURIComponent(routeId)}&cityCode=${encodeURIComponent(cityCode)}`, { auth: true }),
  analyze: (capture) =>
    request("/operator/analyze", { method: "POST", body: JSON.stringify(capture), auth: true }),
};

/* ------------------------------------------------------------------- sheets */

let closeSheet;

/**
 * One in-app dialog instead of the browser's. `window.prompt` and
 * `window.confirm` are unstyled, unreadable one-handed, and on iOS they can be
 * suppressed outright — not something a field instrument should depend on.
 */
function openSheet({ title, render, actions = [], dismissValue }) {
  return new Promise((resolve) => {
    el("sheet-title").textContent = title;
    const body = el("sheet-body");
    body.replaceChildren();

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      el("scrim").hidden = true;
      document.removeEventListener("keydown", onKey);
      closeSheet = undefined;
      resolve(value);
    };
    closeSheet = () => finish(dismissValue);
    // The body can settle the sheet itself, which is how a list of choices
    // resolves on a tap instead of needing a second confirm button.
    if (render) render(body, finish);

    const bar = el("sheet-actions");
    bar.replaceChildren();
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      if (action.variant === "primary") button.className = "primary";
      if (action.variant === "danger") button.className = "ghost danger";
      if (action.variant === "ghost") button.className = "ghost";
      button.addEventListener("click", () => finish(typeof action.value === "function" ? action.value() : action.value));
      bar.append(button);
    }

    const onKey = (event) => {
      if (event.key === "Escape") finish(dismissValue);
    };
    document.addEventListener("keydown", onKey);
    el("scrim").hidden = false;
    (body.querySelector("input, button") ?? bar.querySelector("button"))?.focus();
  });
}

function confirmSheet({ title, message, confirm = "확인", cancel = "취소", danger = false }) {
  return openSheet({
    title,
    dismissValue: false,
    render: (body) => {
      const text = document.createElement("p");
      text.textContent = message;
      body.append(text);
    },
    actions: [
      { label: confirm, value: true, variant: danger ? "danger" : "primary" },
      { label: cancel, value: false, variant: "ghost" },
    ],
  });
}

function promptSheet({ title, message, label, type = "text", placeholder = "", confirm = "확인" }) {
  let input;
  return openSheet({
    title,
    dismissValue: undefined,
    render: (body) => {
      if (message) {
        const text = document.createElement("p");
        text.className = "small muted";
        text.textContent = message;
        body.append(text);
      }
      const field = document.createElement("label");
      field.className = "sr";
      field.textContent = label;
      field.htmlFor = "sheet-input";
      input = document.createElement("input");
      input.id = "sheet-input";
      input.type = type;
      input.placeholder = placeholder;
      input.autocomplete = type === "password" ? "current-password" : "off";
      input.enterKeyHint = "done";
      body.append(field, input);
    },
    actions: [
      { label: confirm, value: () => input.value.trim() || undefined, variant: "primary" },
      { label: "취소", value: undefined, variant: "ghost" },
    ],
  });
}

/* --------------------------------------------------------------------- view */

function show(name) {
  for (const screen of SCREENS) el(`screen-${screen}`).hidden = screen !== name;
  window.scrollTo(0, 0);
}

function alertBox(id, message, tone = "warn") {
  const node = el(id);
  node.textContent = message ?? "";
  node.dataset.tone = tone;
}

function announce(message) {
  el("live").textContent = message;
}

function clock(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function timeText(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function card(className, build) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card ${className}`;
  build(button);
  return button;
}

function kv(parent, label, value) {
  const row = document.createElement("div");
  row.className = "kv";
  const name = document.createElement("span");
  name.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value ?? "—";
  row.append(name, strong);
  parent.append(row);
}

/* --------------------------------------------------------------------- auth */

async function ensureUnlocked(reason) {
  if (operatorToken()) return true;
  const entered = await promptSheet({
    title: "운영자 잠금 해제",
    message: reason,
    label: "운영자 토큰",
    type: "password",
    placeholder: "붙여넣기 가능",
    confirm: "잠금 해제",
  });
  if (!entered) return false;
  setOperatorToken(entered);
  return true;
}

/* --------------------------------------------------------------- route search */

async function searchRoutes() {
  const routeNo = el("route-no").value.trim();
  state.cityCode = el("city-code").value.trim() || "39";
  if (!routeNo) {
    alertBox("home-alert", "버스 번호를 입력하라");
    return;
  }
  alertBox("home-alert", "");
  el("search-routes").disabled = true;
  try {
    const result = await api.routes(state.cityCode, routeNo);
    state.routeNo = routeNo;
    state.variants = result.items ?? [];
    if (state.variants.length === 0) {
      alertBox("home-alert", `${routeNo}번으로 등록된 노선이 없다. 번호를 다시 확인하라.`);
      return;
    }
    renderDirections(`${routeNo}번`);
    show("directions");
  } catch (error) {
    alertBox("home-alert", error.message, "bad");
  } finally {
    el("search-routes").disabled = false;
  }
}

async function browseCatalog() {
  el("browse-all").disabled = true;
  alertBox("home-alert", "전체 노선을 불러오는 중…");
  try {
    const result = await api.catalog(state.cityCode);
    const items = result.items ?? [];
    if (items.length === 0) {
      alertBox("home-alert", "제공자가 전체 노선 목록을 주지 않는다. 번호로 찾아라.");
      return;
    }
    alertBox("home-alert", "");
    state.variants = items;
    state.routeNo = "";
    renderDirections(`전체 ${items.length}개 노선`);
    show("directions");
  } catch {
    // Whether the provider will list a whole city is its answer to give. When it
    // will not, that is said plainly rather than dressed up as a failure.
    alertBox("home-alert", "이 제공자는 전체 노선 목록을 지원하지 않는다. 번호로 찾아라.");
  } finally {
    el("browse-all").disabled = false;
  }
}

function renderDirections(title) {
  el("dir-title").textContent = title;
  alertBox("dir-alert", "");
  const list = el("direction-list");
  list.replaceChildren();

  // Several official routes can share a number. They are never collapsed: the
  // operator picks the exact one, because that is what identity means here.
  for (const variant of state.variants) {
    list.append(card("", (button) => {
      const number = document.createElement("div");
      number.className = "num";
      number.textContent = variant.routeNumber;
      const endpoints = document.createElement("div");
      endpoints.className = "endpoints";
      endpoints.append(
        document.createTextNode(variant.startStopName ?? "기점"),
        Object.assign(document.createElement("div"), { className: "arrow", textContent: "↓" }),
        document.createTextNode(variant.endStopName ?? "종점"),
      );
      button.append(number, endpoints);
      if (variant.routeType) {
        const aside = document.createElement("div");
        aside.className = "aside";
        aside.textContent = variant.routeType;
        button.append(aside);
      }
      button.addEventListener("click", () => chooseVariant(variant));
    }));
  }
}

async function chooseVariant(variant) {
  state.route = variant;
  alertBox("dir-alert", "정류장 순서를 불러오는 중…");
  try {
    const result = await api.stops(variant.routeId, state.cityCode);
    state.stops = result.items ?? [];
    state.topology = result.meta?.topology;
    state.boarding = undefined;
    state.destination = undefined;
    if (state.stops.length === 0) {
      alertBox("dir-alert", "이 노선의 정류장 목록이 비어 있다. 다른 방향을 보라.", "bad");
      return;
    }
    alertBox("dir-alert", "");
    el("boarding-title").textContent = `${variant.routeNumber}번 · 타는 곳`;
    el("boarding-search").value = "";
    renderBoardingList();
    show("boarding");
  } catch (error) {
    alertBox("dir-alert", error.message, "bad");
  }
}

/* ---------------------------------------------------------------- stop picks */

function stopRow(stop, showDuplicateHint, onPick) {
  return card("stop", (button) => {
    const ord = document.createElement("span");
    ord.className = "ord";
    ord.textContent = String(stop.sequence);
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = stop.name;
    button.append(ord, name);
    if (showDuplicateHint) {
      const dup = document.createElement("span");
      dup.className = "dup";
      dup.textContent = stop.stopId;
      button.append(dup);
    }
    button.addEventListener("click", () => onPick(stop));
  });
}

function renderBoardingList() {
  const matches = searchStops(state.stops, el("boarding-search").value);
  const duplicates = duplicateStopNames(state.stops);
  el("boarding-count").textContent = `${matches.length}개 / 전체 ${state.stops.length}개`;
  const list = el("boarding-list");
  list.replaceChildren();
  for (const stop of matches.slice(0, 200)) {
    list.append(stopRow(stop, duplicates.has(stop.name), pickBoarding));
  }
}

function pickBoarding(stop) {
  state.boarding = stop;
  state.destination = undefined;
  el("destination-title").textContent = `${state.route.routeNumber}번 · 내리는 곳`;
  el("destination-search").value = "";
  renderDestinationList();
  show("destination");
}

function renderDestinationList() {
  // Only stops this bus can still reach from the boarding stop. On a closed
  // route that continues past the end of the list and round to the front.
  const reachable = reachableDestinations(state.stops, state.boarding.sequence, state.topology);
  const matches = searchStops(reachable, el("destination-search").value);
  const duplicates = duplicateStopNames(state.stops);
  el("destination-count").textContent = reachable.length === 0
    ? "이 정류장 다음에 갈 수 있는 정류장이 없다. 타는 곳을 다시 고르라."
    : `${state.boarding.name} 이후 ${reachable.length}개`;
  const list = el("destination-list");
  list.replaceChildren();
  for (const stop of matches.slice(0, 200)) {
    list.append(stopRow(stop, duplicates.has(stop.name), pickDestination));
  }
}

async function pickDestination(stop) {
  state.destination = stop;
  const verdict = verifyTopology({
    stops: state.stops,
    topology: state.topology,
    boardingSequence: state.boarding.sequence,
    destinationSequence: stop.sequence,
  });
  if (!verdict.ok) {
    alertBox("dir-alert", verdict.problems.join(" / "), "bad");
    show("directions");
    return;
  }
  state.wrapAround = verdict.wrapAround;
  await renderReady();
}

/* -------------------------------------------------------------------- ready */

async function renderReady() {
  show("ready");
  el("ready-no").textContent = state.route.routeNumber;
  el("ready-direction").textContent = `${state.route.startStopName ?? "기점"} → ${state.route.endStopName ?? "종점"} 방면`;
  el("ready-boarding").textContent = state.boarding.name;
  el("ready-destination").textContent = state.destination.name;

  const shape = normalizeTopology(state.topology, state.stops);
  const distance = forwardStops(state.boarding.sequence, state.destination.sequence, shape, state.wrapAround);
  el("ready-distance").textContent = `${distance}정류장${state.wrapAround ? " · 종점을 지나 순환" : ""}`;

  el("ready-headline").textContent = "실시간 차량을 확인하는 중…";
  el("ready-reason").textContent = "";
  el("ready-badge").dataset.level = "warning";
  el("start-capture").disabled = true;

  if (!(await ensureUnlocked("실시간 차량을 보려면 운영자 인증이 필요합니다."))) {
    el("ready-headline").textContent = "운영자 잠금이 걸려 있습니다";
    el("ready-reason").textContent = "잠금을 해제해야 기록을 시작할 수 있습니다.";
    el("ready-badge").dataset.level = "unsupported";
    return;
  }

  let vehicleCount = 0;
  let vehiclesFailed = false;
  try {
    const snapshot = await api.snapshot(state.route.routeId, state.cityCode);
    vehicleCount = snapshot.items?.length ?? 0;
  } catch (error) {
    vehiclesFailed = true;
    el("ready-reason").textContent = error.message;
  }

  const compatibility = assessRouteCompatibility({
    route: state.route,
    stops: state.stops,
    topology: state.topology,
    vehicleCount,
    vehiclesFailed,
  });
  state.compatibility = compatibility;

  el("ready-badge").dataset.level = compatibility.level;
  el("ready-headline").textContent = compatibility.headline;
  el("ready-reason").textContent = compatibility.reason;
  el("start-capture").disabled = compatibility.level === "unsupported";

  const details = el("ready-details");
  details.replaceChildren();
  kv(details, "노선 ID", state.route.routeId);
  kv(details, "지역 코드", state.cityCode);
  kv(details, "노선 구조", shape.kind);
  kv(details, "정류장", `${state.stops.length}개`);
  kv(details, "승차 순번", String(state.boarding.sequence));
  kv(details, "하차 순번", String(state.destination.sequence));
  kv(details, "수집 간격", `${state.intervalMs / 1_000}초`);
  for (const check of compatibility.checks) kv(details, check.label, `${check.state} · ${check.detail}`);
}

/* ------------------------------------------------------------------ capture */

async function startCapture() {
  state.intervalMs = Math.max(MIN_INTERVAL_MS, Number(el("interval").value || 5) * 1_000);
  const header = createCaptureHeader({
    captureId: newCaptureId(),
    startedAt: new Date().toISOString(),
    routeId: state.route.routeId,
    cityCode: state.cityCode,
    routeNo: state.route.routeNumber,
    direction: `${state.route.startStopName ?? "기점"} → ${state.route.endStopName ?? "종점"}`,
    boardingStopSequence: state.boarding.sequence,
    destinationStopSequence: state.destination.sequence,
    intervalMs: state.intervalMs,
    stops: state.stops,
    topology: state.topology,
  });
  await state.store.clearCapture();
  await state.store.putHeader(header);
  state.session = createCaptureSession({ store: state.store, header });
  state.report = undefined;
  await state.session.recordEvent(navigator.onLine ? "online" : "offline");
  await state.store.putHistory({ ...describeForHistory(undefined), status: "active" });

  el("vehicle-title").textContent = `${header.routeNo}번 · 차량 선택`;
  alertBox("vehicle-alert", "");
  el("vehicle-list").replaceChildren();
  show("vehicle");
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
    const capture = state.session.capture();
    try {
      const result = await api.snapshot(capture.routeId, capture.cityCode);
      await state.session.recordSnapshot({ vehicles: result.items ?? [] });
      clearPollAlert();
    } catch (error) {
      await state.session.recordSnapshot({ error: error.message });
      if (error.status === 401) {
        state.polling = false;
        await showReauth();
        return;
      }
      setPollAlert(`수집 실패: ${error.message}`);
    }
    render();
    const limit = state.session.limitReached();
    if (limit) {
      setPollAlert(limit);
      await finishCapture();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, capture.intervalMs - (Date.now() - startedAt))));
  }
}

function setPollAlert(message) {
  alertBox(el("screen-vehicle").hidden ? "riding-alert" : "vehicle-alert", message);
}

function clearPollAlert() {
  alertBox("riding-alert", "");
  alertBox("vehicle-alert", "");
}

async function showReauth() {
  setPollAlert("운영자 인증이 만료됐다. 수집이 멈췄다.");
  const ok = await ensureUnlocked("인증이 만료됐습니다. 다시 잠금을 해제하면 수집을 이어갑니다.");
  if (ok) {
    clearPollAlert();
    startPolling();
  }
}

function render() {
  if (!state.session) return;
  const status = state.session.status();
  if (!el("screen-vehicle").hidden) return renderVehiclePick(status);
  if (!el("screen-riding").hidden) return renderRiding(status);
}

function renderVehiclePick(status) {
  const list = el("vehicle-list");
  list.replaceChildren();
  if (status.vehicles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "아직 보고된 차량이 없다. 수집은 계속 돌고 있으니 나타나면 여기에 보인다.";
    list.append(empty);
    return;
  }
  const masked = maskVehicleIds(status.vehicles.map((vehicle) => vehicle.vehicleId));
  for (const vehicle of [...status.vehicles].sort((a, b) => (a.stopSequence ?? 0) - (b.stopSequence ?? 0))) {
    list.append(card("veh", (button) => {
      const id = document.createElement("span");
      id.className = "id";
      id.textContent = masked.get(vehicle.vehicleId.replace(/[\s-]/g, "")) ?? "?";
      const where = document.createElement("span");
      where.className = "where";
      where.textContent = `현재 보고 위치\n${vehicle.stopName ?? "확인 중"}`;
      where.style.whiteSpace = "pre-line";
      button.append(id, where);
      button.addEventListener("click", () => pickVehicle(vehicle, masked));
    }));
  }
}

async function pickVehicle(vehicle, masked) {
  const label = masked.get(vehicle.vehicleId.replace(/[\s-]/g, "")) ?? "?";
  const ok = await confirmSheet({
    title: "이 버스가 맞나요?",
    message: `${label} · 현재 보고 위치 ${vehicle.stopName ?? "확인 중"}\n지금 타고 있는 버스와 같은지 확인하세요.`,
    confirm: "이 버스",
  });
  if (!ok) return;
  await state.session.board(vehicle.vehicleId);
  const capture = state.session.capture();
  el("riding-title").textContent = `${state.session.routeNo ?? ""}번 주행 중`;
  show("riding");
  render();
  announce("차량을 기록했습니다");
}

function renderRiding(status) {
  // The route number lives on the capture header, not in the `RideCapture` the
  // analyzer reads, so it comes from the session rather than from `capture()`.
  const routeNo = state.session.routeNo ?? "";
  el("riding-route").textContent = `${routeNo}번 · ${state.destination?.name ?? "목적지"}까지`;
  // The count is the thing the eye needs from two metres away, so it stands
  // alone: a long Korean stop name in the same line wraps and buries it.
  el("riding-remaining").textContent = status.remainingStops === undefined
    ? "위치 확인 중"
    : `${status.remainingStops}정류장 남음`;

  const masked = maskVehicleIds([status.boardedVehicleId ?? ""]);
  el("riding-vehicle").textContent = masked.get((status.boardedVehicleId ?? "").replace(/[\s-]/g, "")) ?? "—";
  el("riding-where").textContent = status.trackedPresent
    ? status.trackedStopName ?? `순번 ${status.trackedStopSequence ?? "?"}`
    : "이번 수집에 없음";

  if (!status.trackedPresent && status.snapshotCount > 1) {
    alertBox("riding-alert", "선택한 차량이 이번 수집에 없다. 차량은 그대로 유지된다.");
  }
  if (!navigator.onLine) alertBox("riding-alert", "오프라인이다. 연결이 돌아오면 수집이 이어진다.", "bad");
}

/* ------------------------------------------------------------------ markers */

async function markStop() {
  const capture = state.session.capture();
  const status = state.session.status();
  // Provider position only decides which stops are *offered*. It never creates
  // the marker: that is the rider saying the bus stopped and the doors opened.
  const from = status.trackedStopSequence ?? capture.boardingStopSequence;
  const ahead = stopsBetween(capture.stops, from, capture.destinationStopSequence, Boolean(state.session.wrapAround));
  const window_ = ahead.slice(0, MARK_WINDOW);
  const choices = window_.length > 0 ? window_ : capture.stops.slice(0, MARK_WINDOW);

  const chosen = await openSheet({
    title: "방금 정차한 정류장",
    dismissValue: undefined,
    render: (body, finish) => {
      const hint = document.createElement("p");
      hint.className = "small muted";
      hint.textContent = "버스가 실제로 서고 문이 열린 곳만 누르세요. 확실하지 않으면 그냥 닫으세요.";
      body.append(hint);
      for (const stop of choices) {
        const already = capture.markers.some((marker) => marker.kind === "passed_stop" && marker.stopSequence === stop.sequence);
        body.append(card("stop", (button) => {
          const name = document.createElement("span");
          name.className = "name";
          name.textContent = stop.name;
          button.append(name);
          if (already) {
            const done = document.createElement("span");
            done.className = "dup";
            done.textContent = "기록됨";
            button.append(done);
          }
          button.addEventListener("click", () => finish(stop));
        }));
      }
    },
    actions: [{ label: "닫기", value: undefined, variant: "ghost" }],
  });
  if (!chosen) return;
  await state.session.passedStop(chosen.sequence);
  announce(`${chosen.name} 기록`);
  render();
}

async function addNote() {
  const note = await promptSheet({ title: "특이사항", label: "메모", placeholder: "예: 문이 늦게 열림" });
  if (!note) return;
  await state.session.note(note);
  announce("특이사항을 기록했습니다");
}

async function alight() {
  const ok = await confirmSheet({
    title: "하차",
    message: `${state.destination?.name ?? "목적지"}에서 내렸습니까?`,
    confirm: "내렸습니다",
  });
  if (!ok) return;
  await state.session.alight();
  el("finish-headline").textContent = `${state.destination?.name ?? "목적지"}에서 하차했습니다`;
  await finishCapture();
}

/* ------------------------------------------------------------------- finish */

async function finishCapture() {
  state.polling = false;
  releaseWakeLock();
  const routeNo = state.session.routeNo ?? "";
  const capture = await state.session.finalize();
  show("finish");
  el("finish-summary").textContent =
    `${routeNo}번 · ${clock(state.session.status().elapsedSeconds)} · 수집 ${capture.snapshots.length}회 · 기록 ${capture.markers.length}건`;
  alertBox("finish-alert", "분석 중…", "warn");
  el("finish-verdict").hidden = true;

  const details = el("finish-details");
  details.replaceChildren();
  kv(details, "노선 ID", capture.routeId);
  kv(details, "지역 코드", capture.cityCode);
  kv(details, "수집 간격", `${capture.intervalMs / 1_000}초`);
  kv(details, "이벤트", String(capture.events.length));

  if (JSON.stringify(capture).length > MAX_ANALYZE_BYTES) {
    alertBox("finish-alert", "기록이 커서 서버 분석을 건너뛴다. 원본을 저장해 CLI로 분석하라.");
    await rememberFinished(undefined);
    return;
  }
  try {
    state.report = await api.analyze(capture);
    alertBox("finish-alert", "");
    renderVerdict(state.report, details);
  } catch (error) {
    alertBox("finish-alert", `분석 실패: ${error.message}. 원본을 저장해 CLI로 분석하라.`);
  }
  await rememberFinished(state.report);
}

/** The analyzer names its criteria in code; the operator reads Korean. */
const CRITERION_NAMES = {
  trackedVehiclePresent: "선택한 차량 관측",
  successfulSnapshots: "수집 횟수",
  trackedSequenceProgression: "차량 위치 변화",
  contentChangeSamples: "데이터 변경 횟수",
  markerLagSamples: "정차 기록 수",
  arrivalObserved: "도착 관측",
};

function criterionName(name) {
  return CRITERION_NAMES[name] ?? name;
}

function renderVerdict(report, details) {
  const sufficient = report.evidenceCompleteness.verdict === "SUFFICIENT";
  const badge = el("finish-verdict");
  badge.hidden = false;
  badge.dataset.level = sufficient ? "ok" : "warning";
  el("verdict-head").textContent = sufficient ? "이번 기록은 분석에 사용할 수 있습니다" : "데이터가 더 필요합니다";
  el("verdict-why").textContent = sufficient
    ? `수집 ${report.snapshotCount}회 · 정차 기록 ${report.freshnessEvidence.markerLagSeconds.count}건`
    : `부족한 것: ${report.evidenceCompleteness.unmetRequired.map(criterionName).join(", ")}`;

  kv(details, "판정", report.evidenceCompleteness.verdict);
  kv(details, "추적 차량 관측 비율", String(report.tracked.presenceRatio));
  kv(details, "내용 변경 간격 median", `${report.freshnessEvidence.contentChangeIntervalSeconds.median ?? "—"} s`);
  kv(details, "마커 지연 median", `${report.freshnessEvidence.markerLagSeconds.median ?? "—"} s`);
  kv(details, "경고", String(report.warnings.length));
}

async function rememberFinished(report) {
  await state.store.putHistory({ ...describeForHistory(report), status: "finished" });
}

/** The thin, vehicle-free record the history list is built from. */
function describeForHistory(report) {
  return historyEntry({
    captureId: state.session.captureId,
    routeNo: state.session.routeNo,
    capture: state.session.capture(),
    report,
  });
}

/* ------------------------------------------------------------------ history */

async function renderHistory() {
  const rows = (await state.store.readHistory())
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
  const list = el("history-list");
  list.replaceChildren();
  el("history-empty").hidden = rows.length > 0;
  el("clear-history").hidden = rows.length === 0;
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "panel";
    const head = document.createElement("div");
    head.style.fontWeight = "700";
    head.textContent = `${row.routeNo ?? "?"}번`;
    const journey = document.createElement("div");
    journey.className = "small";
    journey.textContent = `${row.boardingName ?? "?"} → ${row.destinationName ?? "?"}`;
    const meta = document.createElement("div");
    meta.className = "small muted";
    meta.textContent = `${timeText(row.finishedAt)} · 수집 ${row.snapshotCount ?? 0}회 · ${
      row.status === "active" ? "미완료" : row.verdict ?? "리포트 없음"
    }`;
    item.append(head, journey, meta);
    list.append(item);
  }
}

async function renderRecents() {
  const rows = (await state.store.readHistory())
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
  const seen = new Set();
  const recents = rows.filter((row) => {
    if (!row.routeNo || seen.has(row.routeId)) return false;
    seen.add(row.routeId);
    return true;
  }).slice(0, 4);

  el("recent-block").hidden = recents.length === 0;
  const list = el("recent-list");
  list.replaceChildren();
  for (const row of recents) {
    list.append(card("", (button) => {
      const head = document.createElement("div");
      head.style.fontWeight = "700";
      head.style.fontSize = "1.15rem";
      head.textContent = `${row.routeNo}번`;
      const journey = document.createElement("div");
      journey.className = "small muted";
      journey.textContent = `${row.boardingName ?? "?"} → ${row.destinationName ?? "?"}`;
      button.append(head, journey);
      button.addEventListener("click", () => {
        el("route-no").value = row.routeNo;
        void searchRoutes();
      });
    }));
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
    state.wakeLock.addEventListener("release", () => { state.wakeLockState = "released"; });
    await state.session?.recordEvent("wake_lock_active");
  } catch {
    state.wakeLockState = "unavailable";
    await state.session?.recordEvent("wake_lock_unavailable", "request rejected");
  }
}

function releaseWakeLock() {
  try {
    void state.wakeLock?.release();
  } catch {
    // Already gone.
  }
  state.wakeLock = undefined;
  state.wakeLockState = "released";
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
    setPollAlert("화면이 꺼져 있던 동안 수집이 멈췄다. 그 구간은 공백으로 남는다.");
    await acquireWakeLock();
    render();
  });
  window.addEventListener("pagehide", () => { void state.session?.recordEvent("hidden", "pagehide"); });
  window.addEventListener("pageshow", () => { void state.session?.recordEvent("visible", "pageshow"); render(); });
  window.addEventListener("offline", () => { void state.session?.recordEvent("offline"); render(); });
  window.addEventListener("online", () => { void state.session?.recordEvent("online"); clearPollAlert(); render(); });
}

/* ------------------------------------------------------------------- status */

async function openStatus() {
  const status = state.session?.status();
  await openSheet({
    title: "수집 상태",
    dismissValue: undefined,
    render: (body) => {
      if (!status) return;
      kv(body, "경과", clock(status.elapsedSeconds));
      kv(body, "수집 성공", `${status.successfulCount} / ${status.snapshotCount}`);
      kv(body, "실패", String(status.failedCount));
      kv(body, "기록", String(status.markerCount));
      kv(body, "마지막 수집", timeText(status.lastPollAt));
      kv(body, "수집 간격", `${(state.session.capture().intervalMs) / 1_000}초`);
      kv(body, "연결", navigator.onLine ? "온라인" : "오프라인");
      kv(body, "화면 유지", state.wakeLockState === "active" ? "켜짐" : "불가");
      kv(body, "추적 차량", status.trackedPresent ? "이번 수집에 있음" : "이번 수집에 없음");
      kv(body, "제공 순번", String(status.trackedStopSequence ?? "—"));
      kv(body, "노선 ID", state.session.capture().routeId);
    },
    actions: [{ label: "닫기", value: undefined, variant: "ghost" }],
  });
}

/* --------------------------------------------------------------------- boot */

async function recoverIfPossible() {
  const record = await state.store.loadLatest();
  if (!record || record.header.endedAt) return false;
  const started = new Date(record.header.startedAt);
  const resume = await confirmSheet({
    title: "이어서 진행할까요?",
    message: `끝나지 않은 기록이 있습니다.\n${record.header.routeNo ?? record.header.routeId} · ${started.toLocaleTimeString()}\n수집 ${record.snapshots.length}회`,
    confirm: "이어서 진행",
    cancel: "새로 시작",
  });
  if (!resume) return false;

  state.session = resumeCaptureSession({ store: state.store, record });
  state.cityCode = record.header.cityCode;
  state.stops = record.header.stops;
  state.topology = record.header.topology;
  state.route = { routeId: record.header.routeId, routeNumber: record.header.routeNo ?? "" };
  state.boarding = record.header.stops.find((stop) => stop.sequence === record.header.boardingStopSequence);
  state.destination = record.header.stops.find((stop) => stop.sequence === record.header.destinationStopSequence);
  await state.session.recordEvent("resumed", "reopened after a reload");
  if (!(await ensureUnlocked("이어서 수집하려면 운영자 인증이 필요합니다."))) return false;

  if (state.session.boardedVehicleId) {
    el("riding-title").textContent = `${record.header.routeNo ?? ""}번 주행 중`;
    show("riding");
  } else {
    el("vehicle-title").textContent = `${record.header.routeNo ?? ""}번 · 차량 선택`;
    show("vehicle");
  }
  render();
  await acquireWakeLock();
  startPolling();
  return true;
}

function wire() {
  el("search-routes").addEventListener("click", searchRoutes);
  el("route-no").addEventListener("keydown", (event) => {
    if (event.key === "Enter") void searchRoutes();
  });
  el("browse-all").addEventListener("click", browseCatalog);
  el("open-history").addEventListener("click", async () => {
    await renderHistory();
    show("history");
  });
  el("clear-history").addEventListener("click", async () => {
    if (await confirmSheet({ title: "기록 목록 지우기", message: "이 기기의 기록 목록만 지웁니다.", confirm: "지우기", danger: true })) {
      await state.store.clearHistory();
      await renderHistory();
      await renderRecents();
    }
  });
  el("relock").addEventListener("click", async () => {
    setOperatorToken("");
    await ensureUnlocked("운영자 토큰을 다시 입력합니다.");
  });

  for (const button of document.querySelectorAll("[data-back]")) {
    button.addEventListener("click", () => show(button.dataset.back));
  }
  el("boarding-search").addEventListener("input", renderBoardingList);
  el("destination-search").addEventListener("input", renderDestinationList);
  el("start-capture").addEventListener("click", startCapture);
  el("abort-capture").addEventListener("click", async () => {
    if (!(await confirmSheet({ title: "기록 취소", message: "지금까지 수집한 내용을 버립니다.", confirm: "취소하기", danger: true }))) return;
    state.polling = false;
    releaseWakeLock();
    state.session = undefined;
    await state.store.clearCapture();
    show("home");
  });
  el("mark-stop").addEventListener("click", markStop);
  el("mark-note").addEventListener("click", addNote);
  el("mark-alight").addEventListener("click", alight);
  el("open-status").addEventListener("click", openStatus);
  el("save-report").addEventListener("click", () => {
    if (!state.report) return alertBox("finish-alert", "저장할 리포트가 없다. 원본을 저장하라.");
    downloadJson(`${captureFileStem(state.session.capture())}.report.json`, state.report);
  });
  el("copy-report").addEventListener("click", async () => {
    if (!state.report) return;
    await navigator.clipboard.writeText(JSON.stringify(state.report, null, 2));
    alertBox("finish-alert", "리포트를 클립보드에 복사했다", "ok");
  });
  el("save-raw").addEventListener("click", () => {
    downloadJson(`${captureFileStem(state.session.capture())}.json`, state.session.capture());
  });
  el("new-ride").addEventListener("click", async () => {
    state.session = undefined;
    state.report = undefined;
    el("route-no").value = "";
    await renderRecents();
    show("home");
  });
  el("scrim").addEventListener("click", (event) => {
    if (event.target === el("scrim")) closeSheet?.();
  });
}

async function boot() {
  wire();
  registerLifecycle();
  try {
    state.store = createIndexedDbStore(await openDatabase());
  } catch {
    show("home");
    alertBox("home-alert", "이 브라우저에서 저장소를 열 수 없다. 개인정보 보호 모드를 끄고 다시 열어라.", "bad");
    return;
  }
  await renderRecents();
  if (await recoverIfPossible()) return;
  show("home");
}

void boot();
