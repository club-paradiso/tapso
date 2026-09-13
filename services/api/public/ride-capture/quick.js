import {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  captureFileStem,
  createCaptureHeader,
  createCaptureSession,
  forwardStops,
  historyEntry,
  normalizeRouteNumber,
  normalizeTopology,
  reachableDestinations,
  searchStops,
  stopsBetween,
} from "./capture-core.js";
import {
  boardingCandidates,
  collectVehicleCandidates,
  exactRouteVariants,
  hasValidPlateSuffix,
  matchingVehicles,
  normalizePlateSuffix,
} from "./quick-core.js";

const TOKEN_KEY = "tapso.rideCapture.operatorToken";
const DB_NAME = "tapso-ride-capture";
const DB_VERSION = 2;
const CITY_CODE = "39";
const INTERVAL_MS = DEFAULT_INTERVAL_MS;
const MAX_VARIANTS_FOR_DIRECT_SCAN = 12;
const MARK_WINDOW = 5;
const el = (id) => document.getElementById(id);
let memoryToken = "";

const state = {
  route: undefined,
  vehicle: undefined,
  initialVehicles: [],
  stops: [],
  topology: undefined,
  boarding: undefined,
  destination: undefined,
  session: undefined,
  store: undefined,
  polling: false,
  report: undefined,
};

function show(name) {
  for (const id of ["home", "boarding", "destination", "ready", "riding", "finish"]) {
    el(`screen-${id}`).hidden = id !== name;
  }
  window.scrollTo(0, 0);
}

function say(id, message = "", tone = "warn") {
  const node = el(id);
  node.textContent = message;
  node.dataset.tone = tone;
}

function announce(message) { el("live").textContent = message; }

function plateToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || memoryToken; }
  catch { return memoryToken; }
}

function saveToken(value) {
  memoryToken = value || "";
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* memory fallback */ }
}

class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

async function request(path, { auth = false, method = "GET", body } = {}) {
  const headers = {};
  if (auth) {
    const token = plateToken();
    if (!token) throw new ApiError("운영자 토큰을 먼저 입력하세요.", 401);
    headers.authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers["content-type"] = "application/json";
  let response;
  try { response = await fetch(path, { method, headers, body, cache: "no-store" }); }
  catch { throw new ApiError("네트워크 연결에 실패했습니다.", 0); }
  let payload = {};
  try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    if (response.status === 401) saveToken("");
    const message = response.status === 401 ? "운영자 인증이 필요합니다."
      : response.status === 429 ? "요청이 너무 잦습니다. 잠시 뒤 다시 시도하세요."
      : payload.message || "실시간 조회에 실패했습니다.";
    throw new ApiError(message, response.status);
  }
  return payload;
}

const api = {
  routes: (routeNo) => request(`/v1/routes?cityCode=${CITY_CODE}&routeNo=${encodeURIComponent(routeNo)}`),
  stops: (routeId) => request(`/v1/stops?cityCode=${CITY_CODE}&routeId=${encodeURIComponent(routeId)}`),
  vehicles: (routeId) => request(`/v1/vehicles?cityCode=${CITY_CODE}&routeId=${encodeURIComponent(routeId)}`),
  snapshot: (routeId) => request(`/operator/snapshot?cityCode=${CITY_CODE}&routeId=${encodeURIComponent(routeId)}`, { auth: true }),
  analyze: (capture) => request("/operator/analyze", { auth: true, method: "POST", body: JSON.stringify(capture) }),
};

function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("headers")) db.createObjectStore("headers", { keyPath: "captureId" });
      for (const name of ["snapshots", "markers", "events"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: ["captureId", "index"] });
      }
      if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", { keyPath: "captureId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function makeStore(db) {
  const write = (name, value) => new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readwrite");
    tx.objectStore(name).put(value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  const readAll = (name) => new Promise((resolve, reject) => {
    const req = db.transaction(name, "readonly").objectStore(name).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  return {
    putHeader: (header) => write("headers", header),
    putSnapshot: (captureId, index, snapshot) => write("snapshots", { captureId, index, snapshot }),
    putMarker: (captureId, index, marker) => write("markers", { captureId, index, marker }),
    putEvent: (captureId, index, event) => write("events", { captureId, index, event }),
    putHistory: (entry) => write("history", entry),
    readHistory: () => readAll("history"),
    clearCapture: () => new Promise((resolve, reject) => {
      const tx = db.transaction(["headers", "snapshots", "markers", "events"], "readwrite");
      for (const name of ["headers", "snapshots", "markers", "events"]) tx.objectStore(name).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }),
  };
}

function card(stop, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card";
  const strong = document.createElement("strong");
  strong.textContent = stop.name;
  const span = document.createElement("span");
  span.textContent = `정류장 ${stop.sequence}`;
  button.append(strong, span);
  button.addEventListener("click", () => onClick(stop));
  return button;
}

async function choose(title, message, options) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    Object.assign(scrim.style, { position:"fixed", inset:"0", background:"rgba(0,0,0,.55)", zIndex:"99", display:"flex", alignItems:"flex-end", justifyContent:"center" });
    const sheet = document.createElement("div");
    Object.assign(sheet.style, { width:"100%", maxWidth:"32rem", maxHeight:"88vh", overflow:"auto", background:"#161b21", borderRadius:"18px 18px 0 0", padding:"16px 16px calc(18px + env(safe-area-inset-bottom))" });
    const h = document.createElement("h2"); h.textContent = title;
    const p = document.createElement("p"); p.textContent = message; p.className = "muted small";
    sheet.append(h, p);
    for (const option of options) sheet.append(card(option, (value) => { scrim.remove(); resolve(value); }));
    const cancel = document.createElement("button"); cancel.textContent = "닫기"; cancel.className = "ghost";
    cancel.addEventListener("click", () => { scrim.remove(); resolve(undefined); });
    sheet.append(cancel); scrim.append(sheet); document.body.append(scrim);
  });
}

async function confirmAction(title, message, confirm = "확인") {
  return new Promise((resolve) => {
    const pseudo = [{ name: confirm, sequence: 1 }, { name: "취소", sequence: 2 }];
    choose(title, message, pseudo).then((picked) => resolve(picked?.sequence === 1));
  });
}

function cleanQuery(value) { return normalizeRouteNumber(String(value ?? "")); }

async function scanRouteVehicles(variants, suffix) {
  // Public vehicle snapshots are cheap and can narrow a large route family.
  const publicRows = await Promise.all(variants.map(async (route) => {
    try { return { route, vehicles: (await api.vehicles(route.routeId)).items || [] }; }
    catch { return { route, vehicles: [] }; }
  }));
  let candidates = collectVehicleCandidates(publicRows, suffix);

  // A unique cached candidate is always confirmed against the uncached operator path.
  if (candidates.length === 1) {
    const candidate = candidates[0];
    const live = await api.snapshot(candidate.route.routeId);
    const matches = matchingVehicles(live.items || [], suffix);
    if (matches.length === 1) return [{ route: candidate.route, vehicle: matches[0], vehicles: live.items || [] }];
  }

  // If the family is small enough, check uncached data directly. Never guess through ambiguity.
  if (variants.length > MAX_VARIANTS_FOR_DIRECT_SCAN) return [];
  candidates = [];
  for (const route of variants) {
    const live = await api.snapshot(route.routeId);
    for (const vehicle of matchingVehicles(live.items || [], suffix)) {
      candidates.push({ route, vehicle, vehicles: live.items || [] });
    }
  }
  return candidates;
}

async function findBus() {
  const routeNo = cleanQuery(el("route-no").value);
  const suffix = normalizePlateSuffix(el("plate").value);
  if (!routeNo) return say("home-alert", "버스 번호를 입력하세요.", "bad");
  if (!hasValidPlateSuffix(suffix)) return say("home-alert", "번호판 뒤 4자리를 입력하세요.", "bad");
  if (!plateToken()) {
    el("token-block").hidden = false;
    el("token").focus();
    return say("home-alert", "처음 한 번만 운영자 잠금을 해제하세요.");
  }

  const button = el("find-bus");
  button.disabled = true;
  say("home-alert", `${routeNo}번 · …${suffix} 차량을 찾는 중…`);
  try {
    const routeResult = await api.routes(routeNo);
    const variants = exactRouteVariants(routeResult.items || [], routeNo);
    if (!variants.length) throw new Error(`${routeNo}번과 정확히 일치하는 공식 노선을 찾지 못했습니다.`);
    const matches = await scanRouteVehicles(variants, suffix);
    if (matches.length === 0) {
      const extra = variants.length > MAX_VARIANTS_FOR_DIRECT_SCAN ? " 후보 노선이 많아 자동 확정을 중단했습니다." : "";
      throw new Error(`현재 ${routeNo}번에서 …${suffix} 차량을 확인하지 못했습니다.${extra}`);
    }
    if (matches.length > 1) throw new Error(`…${suffix}가 여러 운행 구간에서 보여 자동으로 고를 수 없습니다. 기존 방식으로 확인하세요.`);

    const matched = matches[0];
    const stopResult = await api.stops(matched.route.routeId);
    state.route = matched.route;
    state.vehicle = matched.vehicle;
    state.initialVehicles = matched.vehicles;
    state.stops = stopResult.items || [];
    state.topology = stopResult.meta?.topology;
    state.boarding = undefined;
    state.destination = undefined;

    el("matched-title").textContent = `${routeNo}번 · …${suffix}`;
    el("matched-plate").textContent = `…${suffix}`;
    el("matched-route").textContent = `${matched.route.startStopName || "기점"} → ${matched.route.endStopName || "종점"}`;
    el("matched-position").textContent = `제공 위치: ${matched.vehicle.stopName || "확인 중"}`;
    renderBoardingWindow();
    show("boarding");
  } catch (error) {
    say("home-alert", error.message || "버스를 찾지 못했습니다.", "bad");
    if (error.status === 401) el("token-block").hidden = false;
  } finally { button.disabled = false; }
}

function renderBoardingWindow() {
  const list = el("boarding-list"); list.replaceChildren();
  const choices = boardingCandidates(state.stops, state.vehicle?.stopSequence);
  for (const stop of choices) list.append(card(stop, pickBoarding));
}

function renderBoardingSearch() {
  const matches = searchStops(state.stops, el("boarding-search").value).slice(0, 30);
  const list = el("boarding-search-list"); list.replaceChildren();
  for (const stop of matches) list.append(card(stop, pickBoarding));
}

function pickBoarding(stop) {
  state.boarding = stop;
  state.destination = undefined;
  el("destination-search").value = "";
  renderDestinations();
  show("destination");
}

function renderDestinations() {
  const reachable = reachableDestinations(state.stops, state.boarding.sequence, state.topology);
  const matches = searchStops(reachable, el("destination-search").value).slice(0, 60);
  el("destination-count").textContent = `${state.boarding.name} 이후 ${reachable.length}개 정류장`;
  const list = el("destination-list"); list.replaceChildren();
  for (const stop of matches) list.append(card(stop, pickDestination));
}

function pickDestination(stop) {
  state.destination = stop;
  el("ready-route").textContent = `${state.route.routeNumber}번 · …${normalizePlateSuffix(state.vehicle.vehicleId)}`;
  el("ready-journey").textContent = `${state.boarding.name} → ${state.destination.name}`;
  el("ready-vehicle").textContent = `${state.route.startStopName || "기점"} → ${state.route.endStopName || "종점"}`;
  say("ready-alert", "노선과 차량을 자동 확인했습니다. 실제 승차·하차 정류장만 사용합니다.", "ok");
  show("ready");
}

async function startCapture() {
  const header = createCaptureHeader({
    startedAt: new Date().toISOString(), routeId: state.route.routeId, cityCode: CITY_CODE,
    routeNo: state.route.routeNumber,
    direction: `${state.route.startStopName || "기점"} → ${state.route.endStopName || "종점"}`,
    boardingStopSequence: state.boarding.sequence, destinationStopSequence: state.destination.sequence,
    intervalMs: Math.max(MIN_INTERVAL_MS, INTERVAL_MS), stops: state.stops, topology: state.topology,
  });
  await state.store.clearCapture();
  await state.store.putHeader(header);
  state.session = createCaptureSession({ store: state.store, header });
  state.report = undefined;
  // Seed with the same uncached snapshot that identified the physical vehicle,
  // then explicitly board that exact provider id. No silent rematch.
  await state.session.recordSnapshot({ vehicles: state.initialVehicles });
  await state.session.board(state.vehicle.vehicleId);
  await state.session.recordEvent(navigator.onLine ? "online" : "offline");
  await state.store.putHistory({ ...historyEntry({ captureId: state.session.captureId, routeNo: state.session.routeNo, capture: state.session.capture() }), status: "active" });
  state.polling = true;
  show("riding");
  renderRide();
  void pollLoop();
}

async function pollLoop() {
  while (state.polling && state.session) {
    const started = Date.now();
    try {
      const live = await api.snapshot(state.route.routeId);
      await state.session.recordSnapshot({ vehicles: live.items || [] });
      say("riding-alert", "");
    } catch (error) {
      await state.session.recordSnapshot({ error: error.message });
      say("riding-alert", `수집 실패: ${error.message}`, "bad");
      if (error.status === 401) { state.polling = false; return; }
    }
    renderRide();
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, INTERVAL_MS - (Date.now() - started))));
  }
}

function renderRide() {
  const status = state.session.status();
  const shape = normalizeTopology(state.topology, state.stops);
  const remaining = status.trackedStopSequence === undefined ? undefined
    : forwardStops(status.trackedStopSequence, state.destination.sequence, shape, false);
  el("riding-title").textContent = `${state.route.routeNumber}번 주행 중`;
  el("riding-route").textContent = `${state.destination.name}까지`;
  el("remaining").textContent = remaining === undefined ? "위치 확인 중" : `${remaining}정류장 남음`;
  el("riding-plate").textContent = `…${normalizePlateSuffix(state.vehicle.vehicleId)}`;
  el("riding-position").textContent = status.trackedPresent ? (status.trackedStopName || `정류장 ${status.trackedStopSequence}`) : "이번 수집에 없음";
}

async function markStop() {
  const capture = state.session.capture();
  const status = state.session.status();
  const from = status.trackedStopSequence ?? state.boarding.sequence;
  const choices = stopsBetween(capture.stops, from, state.destination.sequence, false).slice(0, MARK_WINDOW);
  const picked = await choose("방금 문이 열린 정류장", "정차만 했거나 그냥 통과한 곳은 기록하지 않습니다. 실제로 문이 열린 곳만 누르세요.", choices);
  if (!picked) return;
  await state.session.passedStop(picked.sequence);
  announce(`${picked.name} 기록`);
}

async function addNote() {
  const text = prompt("특이사항을 짧게 적어주세요.");
  if (text?.trim()) await state.session.note(text.trim());
}

async function alight() {
  const ok = await confirmAction("하차", `${state.destination.name}에서 내렸습니까?`, "내렸습니다");
  if (!ok) return;
  await state.session.alight();
  await finishCapture();
}

async function finishCapture() {
  state.polling = false;
  const capture = await state.session.finalize();
  show("finish");
  el("finish-head").textContent = `${state.destination.name}에서 하차했습니다`;
  el("finish-summary").textContent = `${state.route.routeNumber}번 · 수집 ${capture.snapshots.length}회 · 기록 ${capture.markers.length}건`;
  say("finish-alert", "분석 중…");
  try {
    state.report = await api.analyze(capture);
    const sufficient = state.report.evidenceCompleteness?.verdict === "SUFFICIENT";
    const verdict = el("verdict"); verdict.hidden = false;
    verdict.textContent = sufficient ? "이번 기록은 분석에 사용할 수 있습니다." : `데이터가 더 필요합니다: ${(state.report.evidenceCompleteness?.unmetRequired || []).join(", ")}`;
    say("finish-alert", "", sufficient ? "ok" : "warn");
  } catch (error) {
    state.report = undefined;
    say("finish-alert", `분석 실패: ${error.message}`, "bad");
  }
  await state.store.putHistory({ ...historyEntry({ captureId: state.session.captureId, routeNo: state.session.routeNo, capture, report: state.report }), status: "finished" });
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveReport() {
  if (!state.report) return say("finish-alert", "저장할 분석 리포트가 없습니다.", "bad");
  downloadJson(`${captureFileStem(state.session.capture())}.report.json`, state.report);
}

async function copyReport() {
  if (!state.report) return;
  await navigator.clipboard.writeText(JSON.stringify(state.report, null, 2));
  say("finish-alert", "리포트를 클립보드에 복사했습니다.", "ok");
}

async function renderRecents() {
  const rows = (await state.store.readHistory()).filter((row) => row.status === "finished").sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt)).slice(0, 5);
  el("recent").hidden = rows.length === 0;
  const list = el("recent-list"); list.replaceChildren();
  for (const row of rows) {
    const div = document.createElement("div"); div.className = "history-row";
    div.textContent = `${row.routeNo || "?"}번 · ${row.boardingName || "?"} → ${row.destinationName || "?"} · ${row.verdict || "리포트 없음"}`;
    list.append(div);
  }
}

function reset() {
  state.route = state.vehicle = state.boarding = state.destination = state.session = state.report = undefined;
  state.stops = []; state.initialVehicles = []; state.polling = false;
  el("plate").value = "";
  say("home-alert", "");
  void renderRecents();
  show("home");
}

el("find-bus").addEventListener("click", findBus);
el("route-no").addEventListener("keydown", (e) => { if (e.key === "Enter") el("plate").focus(); });
el("plate").addEventListener("keydown", (e) => { if (e.key === "Enter") void findBus(); });
el("save-token").addEventListener("click", () => {
  const token = el("token").value.trim();
  if (!token) return;
  saveToken(token); el("token").value = ""; el("token-block").hidden = true;
  say("home-alert", "잠금 해제됨. 다시 버스를 찾으세요.", "ok");
});
el("back-home").addEventListener("click", () => show("home"));
el("show-all-boarding").addEventListener("click", () => { el("boarding-search-wrap").hidden = false; renderBoardingSearch(); el("boarding-search").focus(); });
el("boarding-search").addEventListener("input", renderBoardingSearch);
el("back-boarding").addEventListener("click", () => show("boarding"));
el("destination-search").addEventListener("input", renderDestinations);
el("back-destination").addEventListener("click", () => show("destination"));
el("start").addEventListener("click", startCapture);
el("mark-stop").addEventListener("click", markStop);
el("note").addEventListener("click", addNote);
el("alight").addEventListener("click", alight);
el("status").addEventListener("click", async () => {
  const s = state.session.status();
  await choose("수집 상태", `수집 ${s.snapshotCount}회 · 성공 ${s.successfulCount}회 · 실패 ${s.failedCount}회`, [{ name:"확인", sequence:1 }]);
});
el("save-report").addEventListener("click", saveReport);
el("copy-report").addEventListener("click", copyReport);
el("new-ride").addEventListener("click", reset);

window.addEventListener("online", () => state.session?.recordEvent("online"));
window.addEventListener("offline", () => state.session?.recordEvent("offline"));
document.addEventListener("visibilitychange", () => state.session?.recordEvent(document.hidden ? "hidden" : "visible"));

(async () => {
  state.store = makeStore(await openDatabase());
  if (!plateToken()) el("token-block").hidden = false;
  await renderRecents();
  show("home");
})().catch((error) => say("home-alert", `초기화 실패: ${error.message}`, "bad"));
