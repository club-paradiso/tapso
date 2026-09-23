import {
  normalizeRouteNumber,
  reachableDestinations,
  searchStops,
  stopsBetween,
  verifyTopology,
} from "./capture-core.js";
import {
  boardingCandidates,
  collectVehicleCandidates,
  exactRouteVariants,
  fieldStopChoices,
  hasPassedStopMarker,
  hasValidPlateSuffix,
  matchingVehicles,
  normalizePlateSuffix,
} from "./quick-core.js";
import {
  DEFAULT_COLLECTOR_BASE,
  backgroundTopologySupported,
  backgroundAcceptanceVerdict,
  collectorHealthReady,
  exportChecklist,
  finishedReportFromStatus,
  rawCaptureFilename,
  rawExportDeadline,
  reportFilename,
  shouldWarnBeforeLeaving,
  stopNameForSequence,
} from "./background-client-core.js";

const TOKEN_KEY = "tapso.rideCapture.operatorToken";
const HISTORY_KEY = "tapso.rideCapture.backgroundHistory";
const CITY_CODE = "39";
const INTERVAL_MS = 5_000;
const MAX_VARIANTS_FOR_DIRECT_SCAN = 12;
const MARK_WINDOW = 12;
const MARK_FEEDBACK_MS = 1_800;
const COLLECTOR = DEFAULT_COLLECTOR_BASE;
const el = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let memoryToken = "";
let markerFeedbackTimer;
let statusLoopToken = 0;
let lastLifecycleKind;

const state = {
  route: undefined,
  vehicle: undefined,
  stops: [],
  topology: undefined,
  boarding: undefined,
  destination: undefined,
  wrapAround: false,
  sessionId: undefined,
  status: undefined,
  markers: [],
  report: undefined,
  alighting: false,
  finishing: false,
  // Whether this page asked the browser to download each file. A request is
  // all the page can know; iOS gives no signal that the file actually landed.
  rawRequested: false,
  reportRequested: false,
  // The raw capture, fetched as soon as the ride completes and held only in
  // page memory. Never rendered: it holds vehicle numbers and coordinates.
  raw: undefined,
};

class ApiError extends Error {
  constructor(message, status = 0, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

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

function announce(message) {
  el("live").textContent = message;
}

function plateToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || memoryToken; }
  catch { return memoryToken; }
}

function saveToken(value) {
  memoryToken = value || "";
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Some Safari privacy modes reject sessionStorage. Memory-only auth still works.
  }
}

async function parseResponse(response, fallbackMessage) {
  let payload = {};
  try { payload = await response.json(); } catch { /* status still decides */ }
  if (response.ok) return payload;
  const message = response.status === 401 ? "운영자 인증이 필요합니다."
    : response.status === 409 ? payload.message || "현재 수집 상태와 맞지 않습니다."
    : response.status === 429 ? "요청이 너무 잦습니다. 잠시 뒤 다시 시도하세요."
    : response.status === 503 ? payload.message || "실시간 수집 서버를 지금 사용할 수 없습니다."
    : payload.message || fallbackMessage;
  throw new ApiError(message, response.status, payload.error || "");
}

async function apiRequest(path, { auth = false, method = "GET", body } = {}) {
  const headers = {};
  if (auth) {
    const token = plateToken();
    if (!token) throw new ApiError("운영자 토큰을 먼저 입력하세요.", 401);
    headers.authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers["content-type"] = "application/json";
  let response;
  try {
    response = await fetch(path, { method, headers, body, cache: "no-store" });
  } catch {
    throw new ApiError("네트워크 연결에 실패했습니다.", 0);
  }
  return parseResponse(response, "실시간 조회에 실패했습니다.");
}

async function collectorRequest(path, { auth = true, method = "GET", body, keepalive = false } = {}) {
  const headers = {};
  if (auth) {
    const token = plateToken();
    if (!token) throw new ApiError("운영자 토큰을 먼저 입력하세요.", 401);
    headers.authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers["content-type"] = "application/json";
  let response;
  try {
    response = await fetch(`${COLLECTOR}${path}`, { method, headers, body, cache: "no-store", mode: "cors", keepalive });
  } catch {
    throw new ApiError("백그라운드 수집 서버에 연결하지 못했습니다.", 0);
  }
  return parseResponse(response, "백그라운드 수집 요청에 실패했습니다.");
}

const api = {
  routes: (routeNo) => apiRequest(`/v1/routes?cityCode=${CITY_CODE}&routeNo=${encodeURIComponent(routeNo)}`),
  stops: (routeId) => apiRequest(`/v1/stops?cityCode=${CITY_CODE}&routeId=${encodeURIComponent(routeId)}`),
  vehicles: (routeId) => apiRequest(`/v1/vehicles?cityCode=${CITY_CODE}&routeId=${encodeURIComponent(routeId)}`),
  snapshot: (routeId) => apiRequest(`/operator/snapshot?cityCode=${CITY_CODE}&routeId=${encodeURIComponent(routeId)}`, { auth: true }),
};

function card(stop, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card";
  const strong = document.createElement("strong");
  strong.textContent = stop.name;
  const span = document.createElement("span");
  span.textContent = stop.sequence === undefined ? "" : `정류장 ${stop.sequence}`;
  button.append(strong, span);
  button.addEventListener("click", () => onClick(stop));
  return button;
}

function modalFrame(title, message) {
  const scrim = document.createElement("div");
  Object.assign(scrim.style, {
    position: "fixed", inset: "0", background: "rgba(0,0,0,.55)", zIndex: "99",
    display: "flex", alignItems: "flex-end", justifyContent: "center",
  });
  const sheet = document.createElement("div");
  Object.assign(sheet.style, {
    width: "100%", maxWidth: "32rem", maxHeight: "88vh", overflow: "auto",
    background: "#161b21", borderRadius: "18px 18px 0 0",
    padding: "16px 16px calc(18px + env(safe-area-inset-bottom))",
  });
  const heading = document.createElement("h2");
  heading.textContent = title;
  sheet.append(heading);
  if (message) {
    const text = document.createElement("p");
    text.textContent = message;
    text.className = "muted small";
    sheet.append(text);
  }
  scrim.append(sheet);
  document.body.append(scrim);
  return { scrim, sheet };
}

async function choose(title, message, options) {
  return new Promise((resolve) => {
    const { scrim, sheet } = modalFrame(title, message);
    for (const option of options) sheet.append(card(option, (value) => {
      scrim.remove();
      resolve(value);
    }));
    const cancel = document.createElement("button");
    cancel.textContent = "닫기";
    cancel.className = "ghost";
    cancel.addEventListener("click", () => {
      scrim.remove();
      resolve(undefined);
    });
    sheet.append(cancel);
  });
}

async function promptText(title, message, { type = "text", placeholder = "", confirm = "저장" } = {}) {
  return new Promise((resolve) => {
    const { scrim, sheet } = modalFrame(title, message);
    const input = document.createElement("input");
    input.type = type;
    input.placeholder = placeholder;
    input.autocomplete = type === "password" ? "current-password" : "off";
    input.enterKeyHint = "done";
    const ok = document.createElement("button");
    ok.className = "primary";
    ok.textContent = confirm;
    const cancel = document.createElement("button");
    cancel.className = "ghost";
    cancel.textContent = "취소";
    const finish = (value) => {
      scrim.remove();
      resolve(value);
    };
    ok.addEventListener("click", () => finish(input.value.trim() || undefined));
    cancel.addEventListener("click", () => finish(undefined));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") finish(input.value.trim() || undefined);
    });
    sheet.append(input, ok, cancel);
    input.focus();
  });
}

async function confirmAction(title, message, confirm = "확인") {
  const picked = await choose(title, message, [
    { name: confirm, sequence: 1 },
    { name: "취소", sequence: 2 },
  ]);
  return picked?.sequence === 1;
}

async function askForToken(message = "운영자 토큰을 입력하세요.") {
  const token = await promptText("운영자 잠금 해제", message, {
    type: "password", placeholder: "운영자 토큰", confirm: "잠금 해제",
  });
  if (!token) return false;
  saveToken(token);
  el("token-block").hidden = true;
  return true;
}

async function collectorWithRetry(path, options) {
  try {
    return await collectorRequest(path, options);
  } catch (error) {
    if (error.status !== 401) throw error;
    saveToken("");
    const unlocked = await askForToken("인증이 만료됐습니다. 다시 입력하면 같은 서버 수집 세션을 이어갑니다.");
    if (!unlocked) throw error;
    return collectorRequest(path, options);
  }
}

function cleanQuery(value) {
  return normalizeRouteNumber(String(value ?? ""));
}

function normalizeVehicleId(value) {
  return String(value ?? "").replace(/[\s-]/g, "");
}

async function collectorHealth() {
  return collectorRequest("/health", { auth: false });
}

async function scanRouteVehicles(variants, suffix) {
  const publicRows = await Promise.all(variants.map(async (route) => {
    try {
      return { route, vehicles: (await api.vehicles(route.routeId)).items || [] };
    } catch {
      return { route, vehicles: [] };
    }
  }));
  let candidates = collectVehicleCandidates(publicRows, suffix);

  if (candidates.length === 1) {
    const candidate = candidates[0];
    const live = await api.snapshot(candidate.route.routeId);
    const matches = matchingVehicles(live.items || [], suffix);
    if (matches.length === 1) return [{ route: candidate.route, vehicle: matches[0] }];
  }

  if (variants.length > MAX_VARIANTS_FOR_DIRECT_SCAN) return [];
  candidates = [];
  for (const route of variants) {
    const live = await api.snapshot(route.routeId);
    for (const vehicle of matchingVehicles(live.items || [], suffix)) {
      candidates.push({ route, vehicle });
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
    const health = await collectorHealth();
    if (!collectorHealthReady(health)) {
      throw new ApiError("백그라운드 수집 서버가 아직 준비되지 않았습니다. 기기 수집 모드를 사용하세요.", 503);
    }

    const routeResult = await api.routes(routeNo);
    const variants = exactRouteVariants(routeResult.items || [], routeNo);
    if (!variants.length) throw new Error(`${routeNo}번과 정확히 일치하는 공식 노선을 찾지 못했습니다.`);
    const matches = await scanRouteVehicles(variants, suffix);
    if (matches.length === 0) {
      const extra = variants.length > MAX_VARIANTS_FOR_DIRECT_SCAN
        ? " 같은 번호의 공식 노선이 많아 자동 확정을 중단했습니다. 기존 방식으로 확인하세요."
        : "";
      throw new Error(`현재 ${routeNo}번에서 …${suffix} 차량을 확인하지 못했습니다.${extra}`);
    }
    if (matches.length > 1) {
      throw new Error(`…${suffix}가 여러 운행 구간에서 동시에 보여 자동으로 고를 수 없습니다. 기존 방식으로 확인하세요.`);
    }

    const matched = matches[0];
    const stopResult = await api.stops(matched.route.routeId);
    state.route = matched.route;
    state.vehicle = matched.vehicle;
    state.stops = stopResult.items || [];
    state.topology = stopResult.meta?.topology;
    state.boarding = undefined;
    state.destination = undefined;
    state.wrapAround = false;
    state.sessionId = undefined;
    state.status = undefined;
    state.markers = [];
    state.report = undefined;

    el("matched-title").textContent = `${routeNo}번 · …${suffix}`;
    el("matched-plate").textContent = `…${suffix}`;
    el("matched-route").textContent = `${matched.route.startStopName || "기점"} → ${matched.route.endStopName || "종점"}`;
    el("matched-position").textContent = `제공 위치: ${matched.vehicle.stopName || "확인 중"}`;
    renderBoardingWindow();
    say("home-alert", "");
    show("boarding");
  } catch (error) {
    say("home-alert", error.message || "버스를 찾지 못했습니다.", "bad");
    if (error.status === 401) el("token-block").hidden = false;
    if (error.status === 503) el("local-fallback-home").hidden = false;
  } finally {
    button.disabled = false;
  }
}

function renderBoardingWindow() {
  const list = el("boarding-list");
  list.replaceChildren();
  const choices = boardingCandidates(state.stops, state.vehicle?.stopSequence, 2, 6);
  for (const stop of choices) list.append(card(stop, pickBoarding));
}

function renderBoardingSearch() {
  const matches = searchStops(state.stops, el("boarding-search").value).slice(0, 40);
  const list = el("boarding-search-list");
  list.replaceChildren();
  for (const stop of matches) list.append(card(stop, pickBoarding));
}

function pickBoarding(stop) {
  state.boarding = stop;
  state.destination = undefined;
  el("destination-search").value = "";
  say("destination-alert", "");
  renderDestinations();
  show("destination");
  el("destination-search").focus();
}

function renderDestinations() {
  const reachable = reachableDestinations(state.stops, state.boarding.sequence, state.topology);
  const matches = searchStops(reachable, el("destination-search").value).slice(0, 80);
  el("destination-count").textContent = `${state.boarding.name} 이후 ${reachable.length}개 정류장`;
  const list = el("destination-list");
  list.replaceChildren();
  for (const stop of matches) list.append(card(stop, pickDestination));
}

function pickDestination(stop) {
  const verdict = verifyTopology({
    stops: state.stops,
    topology: state.topology,
    boardingSequence: state.boarding.sequence,
    destinationSequence: stop.sequence,
  });
  if (!verdict.ok) {
    say("destination-alert", verdict.problems.join(" / "), "bad");
    return;
  }

  state.destination = stop;
  state.wrapAround = Boolean(verdict.wrapAround);
  el("ready-route").textContent = `${state.route.routeNumber}번 · …${normalizePlateSuffix(state.vehicle.vehicleId)}`;
  el("ready-journey").textContent = `${state.boarding.name} → ${state.destination.name}`;
  el("ready-vehicle").textContent = `${state.route.startStopName || "기점"} → ${state.route.endStopName || "종점"}`;
  const supported = backgroundTopologySupported(verdict);
  el("start").disabled = !supported;
  el("local-fallback-ready").hidden = supported;
  say(
    "ready-alert",
    supported
      ? "실시간 위치 수집은 서버가 담당합니다. Safari를 다른 앱으로 전환해도 provider polling은 계속됩니다."
      : "이 구간은 순환 seam을 넘습니다. 현재 서버 수집기는 이 경우를 추측하지 않고 기기 수집 모드로 넘깁니다.",
    supported ? "ok" : "bad",
  );
  show("ready");
}

async function reconfirmVehicle() {
  const live = await api.snapshot(state.route.routeId);
  const original = normalizeVehicleId(state.vehicle.vehicleId);
  let current = (live.items || []).find((vehicle) => normalizeVehicleId(vehicle.vehicleId) === original);
  if (!current) {
    const suffixMatches = matchingVehicles(live.items || [], normalizePlateSuffix(state.vehicle.vehicleId));
    if (suffixMatches.length === 1) current = suffixMatches[0];
  }
  if (!current) throw new Error("방금 확인한 차량이 실시간 목록에서 사라졌습니다. 다시 찾아주세요.");
  return current;
}

async function startCapture() {
  if (!state.route || !state.vehicle || !state.boarding || !state.destination || state.wrapAround) return;
  el("start").disabled = true;
  say("ready-alert", "차량과 백그라운드 수집 서버를 마지막으로 확인하는 중…");
  try {
    const health = await collectorHealth();
    if (!collectorHealthReady(health)) {
      throw new ApiError("백그라운드 수집 서버가 준비되지 않았습니다. 기기 수집 모드를 사용하세요.", 503);
    }
    const current = await reconfirmVehicle();
    const started = await collectorWithRetry("/capture/start", {
      method: "POST",
      body: JSON.stringify({
        routeId: state.route.routeId,
        cityCode: CITY_CODE,
        boardedVehicleId: current.vehicleId,
        boardingStopSequence: state.boarding.sequence,
        destinationStopSequence: state.destination.sequence,
        intervalMs: INTERVAL_MS,
      }),
    });

    if (started.captureEngine !== "railway-background") {
      throw new ApiError("서버가 Railway background engine을 증명하지 못해 수집을 시작하지 않습니다.", 503);
    }

    state.vehicle = current;
    state.sessionId = started.sessionId;
    state.status = started;
    state.markers = [];
    state.report = undefined;
    state.alighting = false;
    state.finishing = false;
    lastLifecycleKind = document.hidden ? "hidden" : "visible";
    show("riding");
    say("riding-alert", "RAILWAY BACKGROUND ACTIVE · Safari와 무관하게 서버가 5초 간격으로 수집합니다.", "ok");
    renderRide();
    startStatusLoop();
  } catch (error) {
    say("ready-alert", error.message || "기록을 시작하지 못했습니다.", "bad");
    if (error.status === 503) el("local-fallback-ready").hidden = false;
  } finally {
    if (!state.sessionId) el("start").disabled = false;
  }
}

async function refreshStatus({ quiet = false } = {}) {
  if (!state.sessionId) return undefined;
  try {
    const next = await collectorWithRetry(`/capture/${encodeURIComponent(state.sessionId)}`);
    state.status = next;
    renderRide();
    const report = finishedReportFromStatus(next);
    if (report) await finishWithReport(next, report);
    return next;
  } catch (error) {
    if (error.status === 404) {
      stopStatusLoop();
      say("riding-alert", "서버 프로세스가 재시작되어 이 수집 세션을 찾을 수 없습니다. 이번 기록을 정상 리포트로 가장하지 않습니다.", "bad");
      return undefined;
    }
    if (!quiet) say("riding-alert", `상태 확인 실패: ${error.message}`, "bad");
    return undefined;
  }
}

function startStatusLoop() {
  const token = ++statusLoopToken;
  void (async () => {
    while (token === statusLoopToken && state.sessionId && !state.report) {
      await sleep(INTERVAL_MS);
      if (token !== statusLoopToken || !state.sessionId || state.report) return;
      await refreshStatus({ quiet: true });
    }
  })();
}

function stopStatusLoop() {
  statusLoopToken += 1;
}

function currentFieldChoices(limit = 4) {
  if (!state.boarding || !state.destination) return [];
  return fieldStopChoices({
    stops: state.stops,
    markers: state.markers,
    boardingSequence: state.boarding.sequence,
    destinationSequence: state.destination.sequence,
    wrapAround: false,
    limit,
  });
}

function quickStopButton(stop) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quick-stop";
  const small = document.createElement("small");
  small.textContent = `정류장 ${stop.sequence}`;
  const label = document.createElement("strong");
  label.textContent = stop.name;
  button.append(small, label);
  button.addEventListener("click", () => void recordPhysicalStop(stop));
  return button;
}

function renderFieldControls() {
  const primary = el("mark-stop");
  const extras = el("quick-stops");
  const more = el("more-stops");
  extras.replaceChildren();

  if (!state.sessionId || state.alighting || state.report) {
    primary.disabled = true;
    more.disabled = true;
    if (state.alighting) primary.textContent = "하차 후 서버 관측 중";
    return;
  }

  const choices = currentFieldChoices(4);
  more.disabled = false;
  if (!choices.length) {
    primary.disabled = true;
    primary.removeAttribute("data-sequence");
    primary.textContent = "다음 정류장 기록 완료";
    return;
  }

  const [first, ...rest] = choices;
  primary.disabled = false;
  primary.dataset.sequence = String(first.sequence);
  primary.textContent = first.sequence === state.destination.sequence
    ? `목적지 · ${first.name} 기록`
    : `${first.name} 기록`;
  primary.setAttribute("aria-label", `정류장 ${first.sequence} ${first.name} 기록`);
  for (const stop of rest) extras.append(quickStopButton(stop));
}

function renderRide() {
  if (!state.sessionId) return;
  el("riding-title").textContent = `${state.route.routeNumber}번 주행 중`;
  el("riding-route").textContent = `${state.destination.name}까지 · 서버 수집`;
  const remaining = state.status?.remainingStops;
  el("remaining").textContent = state.alighting
    ? state.status?.phase === "completed" ? "수집 완료" : "하차 후 추가 관측 중"
    : Number.isInteger(remaining) ? `${remaining}정류장 남음` : "서버에서 위치 확인 중";
  el("riding-plate").textContent = `…${normalizePlateSuffix(state.vehicle.vehicleId)}`;
  const trackedName = stopNameForSequence(state.stops, state.status?.trackedStopSequence);
  el("riding-position").textContent = state.status?.trackedPresent
    ? trackedName || `정류장 ${state.status.trackedStopSequence ?? "?"}`
    : "이번 snapshot에 없음";
  el("engine-state").textContent = state.status?.phase === "completed"
    ? "완료"
    : state.status?.captureEngine === "railway-background"
      ? "RAILWAY BACKGROUND ACTIVE · 5초 수집"
      : "INVALID ENGINE · 수집 중단 필요";
  renderFieldControls();
}

function markerFeedback(stopName, alreadyRecorded = false) {
  const message = alreadyRecorded ? `${stopName}은 이미 기록되어 있습니다.` : `${stopName} 기록 완료`;
  if (markerFeedbackTimer) clearTimeout(markerFeedbackTimer);
  el("field-feedback").textContent = alreadyRecorded ? "이미 기록됨" : `✓ ${stopName}`;
  say("riding-alert", message, "ok");
  announce(message);
  try { navigator.vibrate?.(40); } catch { /* optional */ }
  markerFeedbackTimer = setTimeout(() => {
    el("field-feedback").textContent = "";
  }, MARK_FEEDBACK_MS);
}

async function recordPhysicalStop(picked) {
  if (!state.sessionId || !picked || state.alighting || state.report) return;
  const duplicate = hasPassedStopMarker(state.markers, picked.sequence);
  if (duplicate) {
    markerFeedback(picked.name, true);
    const again = await confirmAction(
      "이미 기록한 정류장입니다",
      `${picked.name}은 이미 기록했습니다. 실제로 문이 다시 열린 경우에만 다시 기록하세요.`,
      "다시 기록",
    );
    if (!again) return;
  }

  const at = new Date().toISOString();
  try {
    if (duplicate) {
      await collectorWithRetry(`/capture/${encodeURIComponent(state.sessionId)}/note`, {
        method: "POST",
        body: JSON.stringify({
          note: `${picked.name}: 동일 정류장 재기록을 운영자가 확인함`,
          at,
        }),
      });
    }
    state.status = await collectorWithRetry(`/capture/${encodeURIComponent(state.sessionId)}/marker`, {
      method: "POST",
      body: JSON.stringify({ stopSequence: picked.sequence, at, allowDuplicate: duplicate }),
    });
    state.markers.push({ at, kind: "passed_stop", stopSequence: picked.sequence });
    markerFeedback(picked.name);
    renderRide();
  } catch (error) {
    say("riding-alert", `정류장 기록 실패: ${error.message}. 성공 표시가 나오기 전에는 기록된 것으로 간주하지 않습니다.`, "bad");
  }
}

async function markSuggestedStop() {
  const sequence = Number(el("mark-stop").dataset.sequence);
  const picked = state.stops.find((stop) => stop.sequence === sequence);
  if (!picked) return choosePhysicalStop();
  await recordPhysicalStop(picked);
}

async function choosePhysicalStop() {
  if (!state.sessionId || state.alighting || state.report) return;
  const future = currentFieldChoices(MARK_WINDOW);
  const lastPassed = [...state.markers].reverse().find((entry) => entry?.kind === "passed_stop");
  const reopened = lastPassed ? state.stops.find((stop) => stop.sequence === lastPassed.stopSequence) : undefined;
  let choices = reopened ? [reopened, ...future] : future;

  if (!choices.length && Number.isInteger(state.status?.trackedStopSequence)) {
    choices = stopsBetween(
      state.stops,
      state.status.trackedStopSequence,
      state.destination.sequence,
      false,
    ).slice(0, MARK_WINDOW);
  }
  if (!choices.length) return say("riding-alert", "추천할 정류장이 없습니다. 확실하지 않으면 기록하지 마세요.", "warn");
  const picked = await choose(
    "방금 문이 열린 정류장",
    "추천은 기록을 자동 생성하지 않습니다. 실제로 문이 열린 정류장만 고르세요.",
    choices,
  );
  if (picked) await recordPhysicalStop(picked);
}

async function addNote() {
  if (!state.sessionId || state.alighting || state.report) return;
  const text = await promptText("특이사항", "필요한 경우에만 짧게 남기세요.", {
    placeholder: "예: 문은 열렸지만 승하차 없음",
  });
  if (!text) return;
  try {
    state.status = await collectorWithRetry(`/capture/${encodeURIComponent(state.sessionId)}/note`, {
      method: "POST",
      body: JSON.stringify({ note: text, at: new Date().toISOString() }),
    });
    announce("특이사항을 기록했습니다");
  } catch (error) {
    say("riding-alert", `특이사항 기록 실패: ${error.message}`, "bad");
  }
}

async function alight() {
  if (!state.sessionId || state.alighting || state.report) return;
  const ok = await confirmAction("하차", `${state.destination.name}에서 내렸습니까?`, "내렸습니다");
  if (!ok) return;
  try {
    state.alighting = true;
    const at = new Date().toISOString();
    state.status = await collectorWithRetry(`/capture/${encodeURIComponent(state.sessionId)}/alight`, {
      method: "POST",
      body: JSON.stringify({ at }),
    });
    el("note").disabled = true;
    el("alight").disabled = true;
    say("riding-alert", "하차 기록 완료 · 서버가 목적지 관측 또는 20초까지 추가 수집합니다.", "ok");
    renderRide();
    await waitForCompletion();
  } catch (error) {
    state.alighting = false;
    el("note").disabled = false;
    el("alight").disabled = false;
    say("riding-alert", `하차 기록 실패: ${error.message}`, "bad");
  }
}

async function waitForCompletion() {
  const deadline = Date.now() + 35_000;
  while (state.sessionId && !state.report && Date.now() < deadline) {
    const status = await refreshStatus({ quiet: true });
    if (finishedReportFromStatus(status)) return;
    await sleep(1_000);
  }
  if (!state.report) {
    say("riding-alert", "서버 수집은 계속됩니다. 완료 리포트를 다시 확인하는 중입니다.", "warn");
    startStatusLoop();
  }
}

function saveHistory(report) {
  const entry = {
    routeId: report.routeId,
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    boardingStopSequence: report.boardingStopSequence,
    destinationStopSequence: report.destinationStopSequence,
    verdict: report.evidenceCompleteness?.verdict || "UNKNOWN",
  };
  try {
    const previous = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    const rows = [entry, ...(Array.isArray(previous) ? previous : [])]
      .filter((row, index, all) => all.findIndex((candidate) => candidate.routeId === row.routeId && candidate.startedAt === row.startedAt) === index)
      .slice(0, 8);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(rows));
  } catch { /* history is optional */ }
}

function renderRecents() {
  let rows = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    rows = Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch { /* no history */ }
  el("recent").hidden = rows.length === 0;
  const list = el("recent-list");
  list.replaceChildren();
  for (const row of rows) {
    const div = document.createElement("div");
    div.className = "history-row";
    div.textContent = `${row.routeId} · ${row.boardingStopSequence} → ${row.destinationStopSequence} · ${row.verdict}`;
    list.append(div);
  }
}

async function finishWithReport(status, report) {
  if (state.finishing || state.report) return;
  state.finishing = true;
  stopStatusLoop();
  state.status = status;
  state.report = report;
  saveHistory(report);
  show("finish");
  el("finish-head").textContent = `${state.destination?.name || "목적지"}에서 기록을 마쳤습니다`;
  el("finish-summary").textContent = `${state.route?.routeNumber || report.routeId}번 · 서버 수집 ${report.snapshotCount}회 · 물리 기록 ${report.tracked?.markerComparisons?.length ?? 0}건`;
  const sufficient = report.evidenceCompleteness?.verdict === "SUFFICIENT";
  const acceptance = backgroundAcceptanceVerdict(report);
  const verdict = el("verdict");
  verdict.hidden = false;
  verdict.textContent = acceptance.verdict === "PASS"
    ? "BACKGROUND ACCEPTANCE PASS · Railway 수집이 Safari background 구간에서도 연속성을 유지했습니다."
    : `BACKGROUND ACCEPTANCE FAIL · ${acceptance.reasons.join(" / ")}`;
  say(
    "finish-alert",
    `captureEngine=${report.captureEngine || "unknown"} · evidence=${sufficient ? "SUFFICIENT" : "INSUFFICIENT"}`,
    acceptance.verdict === "PASS" && sufficient ? "ok" : "bad",
  );
  el("note").disabled = false;
  el("alight").disabled = false;
  state.rawRequested = false;
  state.reportRequested = false;
  state.raw = undefined;
  renderExportState();
  state.finishing = false;
  void prefetchRaw();
}

/**
 * Fetch the raw capture the moment the ride completes. Two reasons: the save
 * button can then download inside the tap itself, which iOS Safari requires for
 * a reliable download, and the capture survives in this page even if the
 * collector later prunes or restarts.
 */
async function prefetchRaw() {
  if (!state.sessionId || state.raw) return;
  const sessionId = state.sessionId;
  try {
    const capture = await collectorWithRetry(`/capture/${encodeURIComponent(sessionId)}/raw`);
    if (state.sessionId === sessionId) state.raw = capture;
  } catch {
    // The save button fetches again and reports the failure where it can be acted on.
  }
}

function renderExportState() {
  const checklist = exportChecklist(state);
  const raw = el("export-raw-state");
  raw.textContent = checklist.raw;
  raw.dataset.tone = checklist.rawMissing ? "bad" : "ok";
  const report = el("export-report-state");
  report.textContent = checklist.report;
  report.dataset.tone = state.reportRequested ? "ok" : "warn";
  const deadline = rawExportDeadline(state.status);
  el("export-deadline").textContent = deadline
    ? `서버는 원본을 ${deadline.toLocaleTimeString()}까지만 보관합니다. 그 뒤에는 복구할 수 없습니다.`
    : "서버는 원본을 완료 후 2시간만 보관합니다.";
}

/**
 * Fetch this session's raw capture from the authenticated collector and save
 * it under the same stem as the report. The capture is never rendered on the
 * page: it holds vehicle numbers and coordinates.
 */
async function saveRaw() {
  if (!state.sessionId || !state.report) return say("finish-alert", "저장할 원본이 없습니다.", "bad");
  const button = el("save-raw");
  button.disabled = true;
  try {
    const capture = state.raw
      ?? await collectorWithRetry(`/capture/${encodeURIComponent(state.sessionId)}/raw`);
    state.raw = capture;
    downloadJson(rawCaptureFilename(capture), capture);
    state.rawRequested = true;
    renderExportState();
    say("finish-alert", "원본 저장을 요청했습니다. 파일 앱에서 .json 파일이 생겼는지 확인한 뒤 리포트도 저장하세요.", "ok");
  } catch (error) {
    const message = error.status === 404
      ? "서버 보관 기간이 지났거나 서버가 재시작되어 원본이 없습니다. 이 기록은 검증에 쓸 수 없습니다."
      : `원본 저장 실패: ${error.message}`;
    say("finish-alert", message, "bad");
  } finally {
    button.disabled = false;
  }
}

async function startNewRide() {
  if (state.report && shouldWarnBeforeLeaving(state)) {
    const leave = await confirmAction(
      "원본을 저장하지 않았습니다",
      "원본(RAW) 없이 넘어가면 이 탑승은 30회 검증에 절대 포함되지 않습니다. 서버 보관 시간이 지나면 되살릴 수 없습니다.",
      "저장하지 않고 넘어가기",
    );
    if (!leave) return;
  }
  reset();
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function saveReport() {
  if (!state.report) return say("finish-alert", "저장할 분석 리포트가 없습니다.", "bad");
  downloadJson(reportFilename(state.report), state.report);
  state.reportRequested = true;
  renderExportState();
}

async function copyReport() {
  if (!state.report) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.report, null, 2));
    say("finish-alert", "리포트를 클립보드에 복사했습니다.", "ok");
  } catch {
    say("finish-alert", "클립보드 복사에 실패했습니다. 리포트 저장을 사용하세요.", "bad");
  }
}

function reset() {
  stopStatusLoop();
  if (markerFeedbackTimer) clearTimeout(markerFeedbackTimer);
  markerFeedbackTimer = undefined;
  state.route = state.vehicle = state.boarding = state.destination = undefined;
  state.stops = [];
  state.topology = undefined;
  state.wrapAround = false;
  state.sessionId = undefined;
  state.status = undefined;
  state.markers = [];
  state.report = undefined;
  state.alighting = false;
  state.finishing = false;
  state.rawRequested = false;
  state.reportRequested = false;
  state.raw = undefined;
  lastLifecycleKind = undefined;
  el("plate").value = "";
  el("mark-stop").textContent = "다음 정류장 불러오는 중…";
  el("mark-stop").removeAttribute("data-sequence");
  el("quick-stops").replaceChildren();
  el("field-feedback").textContent = "";
  el("local-fallback-ready").hidden = true;
  el("local-fallback-home").hidden = true;
  say("home-alert", "");
  renderRecents();
  show("home");
}

el("find-bus").addEventListener("click", findBus);
el("route-no").addEventListener("keydown", (event) => {
  if (event.key === "Enter") el("plate").focus();
});
el("plate").addEventListener("keydown", (event) => {
  if (event.key === "Enter") void findBus();
});
el("save-token").addEventListener("click", () => {
  const token = el("token").value.trim();
  if (!token) return;
  saveToken(token);
  el("token").value = "";
  el("token-block").hidden = true;
  say("home-alert", "잠금 해제됨. 버스를 확인합니다…", "ok");
  if (cleanQuery(el("route-no").value) && hasValidPlateSuffix(el("plate").value)) void findBus();
});
el("back-home").addEventListener("click", () => show("home"));
el("show-all-boarding").addEventListener("click", () => {
  el("boarding-search-wrap").hidden = false;
  renderBoardingSearch();
  el("boarding-search").focus();
});
el("boarding-search").addEventListener("input", renderBoardingSearch);
el("back-boarding").addEventListener("click", () => show("boarding"));
el("destination-search").addEventListener("input", renderDestinations);
el("back-destination").addEventListener("click", () => show("destination"));
el("start").addEventListener("click", startCapture);
el("mark-stop").addEventListener("click", markSuggestedStop);
el("more-stops").addEventListener("click", choosePhysicalStop);
el("note").addEventListener("click", addNote);
el("alight").addEventListener("click", alight);
el("status").addEventListener("click", async () => {
  const status = await refreshStatus({ quiet: true }) || state.status || {};
  await choose(
    "서버 수집 상태",
    `snapshot ${status.snapshotCount ?? 0}회 · 실패 ${status.failedSnapshotCount ?? 0}회 · ${status.phase || "확인 중"}. 이 수치는 Safari가 아니라 서버 수집기 상태입니다.`,
    [{ name: "확인", sequence: 1 }],
  );
});
el("save-raw").addEventListener("click", () => void saveRaw());
el("save-report").addEventListener("click", saveReport);
el("copy-report").addEventListener("click", copyReport);
el("new-ride").addEventListener("click", () => void startNewRide());

async function recordLifecycle(kind) {
  if (!state.sessionId || state.report || lastLifecycleKind === kind) return;
  lastLifecycleKind = kind;
  try {
    await collectorWithRetry(`/capture/${encodeURIComponent(state.sessionId)}/event`, {
      method: "POST",
      body: JSON.stringify({ kind, at: new Date().toISOString() }),
      keepalive: true,
    });
  } catch {
    // Missing lifecycle evidence makes the final background acceptance fail closed.
  }
}

document.addEventListener("visibilitychange", () => {
  const kind = document.hidden ? "hidden" : "visible";
  void recordLifecycle(kind);
  if (!document.hidden && state.sessionId && !state.report) void refreshStatus({ quiet: true });
});
window.addEventListener("pagehide", () => { void recordLifecycle("hidden"); });
window.addEventListener("pageshow", () => { void recordLifecycle("visible"); });
window.addEventListener("online", () => {
  if (state.sessionId && !state.report) {
    void recordLifecycle("online");
    void refreshStatus({ quiet: true });
  }
});
window.addEventListener("offline", () => {
  if (state.sessionId && !state.report) void recordLifecycle("offline");
});

(async () => {
  if (!plateToken()) el("token-block").hidden = false;
  renderRecents();
  show("home");
  try {
    const health = await collectorHealth();
    if (!collectorHealthReady(health)) {
      say("home-alert", "백그라운드 수집 서버의 비밀키 설정이 아직 완료되지 않아 기기 수집 모드로 돌아가야 합니다.", "warn");
      el("local-fallback-home").hidden = false;
    }
  } catch {
    say("home-alert", "백그라운드 수집 서버 상태를 확인하지 못했습니다. 기기 수집 모드는 계속 사용할 수 있습니다.", "warn");
    el("local-fallback-home").hidden = false;
  }
})().catch((error) => say("home-alert", `초기화 실패: ${error.message}`, "bad"));
