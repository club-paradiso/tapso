import {
  collectVehicleCandidates,
  exactRouteVariants,
  hasValidPlateSuffix,
  matchingVehicles,
  normalizePlateSuffix,
} from "./quick-core.js";
import {
  DEFAULT_COLLECTOR_BASE,
  backgroundAcceptanceVerdict,
  collectorHealthReady,
} from "./background-client-core.js";
import { normalizeRouteNumber } from "./capture-core.js";

const CITY_CODE = "39";
const INTERVAL_MS = 5_000;
const MAX_VARIANTS_FOR_DIRECT_SCAN = 12;
const TOKEN_KEY = "tapso.acceptance.operatorToken";
const LEGACY_TOKEN_KEY = "tapso.rideCapture.operatorToken";
const SESSION_KEY = "tapso.acceptance.activeSession";
const LAST_ROUTE_KEY = "tapso.acceptance.routeNo";
const LAST_PLATE_KEY = "tapso.acceptance.plate";
const COLLECTOR = DEFAULT_COLLECTOR_BASE;
const el = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let statusLoop = 0;
let serviceWorkerRegistration;

class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

function token() {
  try {
    return localStorage.getItem(TOKEN_KEY)
      || sessionStorage.getItem(LEGACY_TOKEN_KEY)
      || "";
  } catch { return ""; }
}
function saveToken(value) {
  try { if (value) localStorage.setItem(TOKEN_KEY, value); } catch { /* memoryless is still safe */ }
}
function remember(id, value) {
  try {
    if (value) localStorage.setItem(id, value);
    else localStorage.removeItem(id);
  } catch { /* optional */ }
}
function recalled(id) {
  try { return localStorage.getItem(id) || ""; } catch { return ""; }
}
function say(id, message = "", tone = "warn") {
  const node = el(id);
  node.textContent = message;
  node.dataset.tone = tone;
}
function show(id) {
  for (const name of ["setup", "active", "finished"]) el(name).hidden = name !== id;
}
function cleanRoute(value) {
  return normalizeRouteNumber(String(value ?? ""));
}
function normalizeVehicleId(value) {
  return String(value ?? "").replace(/[\s-]/g, "");
}

async function parseResponse(response, fallback) {
  let payload = {};
  try { payload = await response.json(); } catch { /* status decides */ }
  if (response.ok) return payload;
  throw new ApiError(payload.message || fallback, response.status);
}

async function apiRequest(path, { auth = false, method = "GET", body } = {}) {
  const headers = {};
  if (auth) {
    const value = token();
    if (!value) throw new ApiError("운영자 토큰을 먼저 입력하세요.", 401);
    headers.authorization = `Bearer ${value}`;
  }
  if (body !== undefined) headers["content-type"] = "application/json";
  let response;
  try {
    response = await fetch(path, { method, headers, body, cache: "no-store" });
  } catch {
    throw new ApiError("네트워크 연결에 실패했습니다.");
  }
  return parseResponse(response, "실시간 조회에 실패했습니다.");
}

async function collectorRequest(path, { auth = true, method = "GET", body, keepalive = false } = {}) {
  const headers = {};
  if (auth) {
    const value = token();
    if (!value) throw new ApiError("운영자 토큰을 먼저 입력하세요.", 401);
    headers.authorization = `Bearer ${value}`;
  }
  if (body !== undefined) headers["content-type"] = "application/json";
  let response;
  try {
    response = await fetch(`${COLLECTOR}${path}`, {
      method, headers, body, cache: "no-store", mode: "cors", keepalive,
    });
  } catch {
    throw new ApiError("Railway collector에 연결하지 못했습니다.");
  }
  return parseResponse(response, "Railway collector 요청에 실패했습니다.");
}

const api = {
  routes: (routeNo) => apiRequest(`/v1/routes?cityCode=${CITY_CODE}&routeNo=${encodeURIComponent(routeNo)}`),
  stops: (routeId) => apiRequest(`/v1/stops?cityCode=${CITY_CODE}&routeId=${encodeURIComponent(routeId)}`),
  vehicles: (routeId) => apiRequest(`/v1/vehicles?cityCode=${CITY_CODE}&routeId=${encodeURIComponent(routeId)}`),
  snapshot: (routeId) => apiRequest(`/operator/snapshot?cityCode=${CITY_CODE}&routeId=${encodeURIComponent(routeId)}`, { auth: true }),
};

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return undefined;
  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register("./acceptance-sw.js", { scope: "./" });
    return serviceWorkerRegistration;
  } catch {
    return undefined;
  }
}

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches === true
    || window.navigator.standalone === true;
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function pushSubscription(health, permissionPromise) {
  if (!health.webPushConfigured || !health.webPushPublicKey) return { subscription: undefined, state: "서버 Push 미설정" };
  if (!isStandalone()) return { subscription: undefined, state: "홈 화면 추가 필요" };
  if (!("Notification" in window) || !("PushManager" in window)) return { subscription: undefined, state: "이 기기에서 Push 불가" };
  const permission = await permissionPromise;
  if (permission !== "granted") return { subscription: undefined, state: "알림 허용 안 됨" };
  const registration = serviceWorkerRegistration || await registerServiceWorker();
  if (!registration) return { subscription: undefined, state: "Service Worker 실패" };
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(health.webPushPublicKey),
    });
  }
  return { subscription: subscription.toJSON(), state: "완료 알림 켜짐" };
}

async function scanRouteVehicles(variants, suffix) {
  const publicRows = await Promise.all(variants.map(async (route) => {
    try { return { route, vehicles: (await api.vehicles(route.routeId)).items || [] }; }
    catch { return { route, vehicles: [] }; }
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
    for (const vehicle of matchingVehicles(live.items || [], suffix)) candidates.push({ route, vehicle });
  }
  return candidates;
}

async function startAcceptance() {
  const routeNo = cleanRoute(el("route-no").value);
  const suffix = normalizePlateSuffix(el("plate").value);
  if (!routeNo) return say("setup-alert", "버스 번호를 입력하세요.", "bad");
  if (!hasValidPlateSuffix(suffix)) return say("setup-alert", "번호판 뒤 4자리를 입력하세요.", "bad");
  if (!token()) {
    el("token-wrap").hidden = false;
    const entered = el("token").value.trim();
    if (!entered) return say("setup-alert", "처음 한 번만 운영자 토큰을 입력하세요.", "warn");
    saveToken(entered);
  }

  const button = el("start");
  button.disabled = true;
  say("setup-alert", "Railway와 현재 버스를 확인하는 중…");

  const permissionPromise = isStandalone() && "Notification" in window
    ? Notification.requestPermission()
    : Promise.resolve("default");

  try {
    const health = await collectorRequest("/health", { auth: false });
    if (!collectorHealthReady(health)) throw new ApiError("Railway collector가 준비되지 않았습니다.", 503);

    const routeResult = await api.routes(routeNo);
    const variants = exactRouteVariants(routeResult.items || [], routeNo);
    if (!variants.length) throw new Error(`${routeNo}번 공식 노선을 찾지 못했습니다.`);
    const matches = await scanRouteVehicles(variants, suffix);
    if (matches.length !== 1) {
      throw new Error(matches.length === 0
        ? `현재 ${routeNo}번에서 …${suffix} 차량을 정확히 확인하지 못했습니다.`
        : `…${suffix} 차량 후보가 여러 개라 자동 시작을 중단했습니다.`);
    }

    const { route, vehicle } = matches[0];
    const stops = (await api.stops(route.routeId)).items || [];
    const boarding = Number(vehicle.stopSequence);
    const destination = stops.at(-1)?.sequence;
    if (!Number.isInteger(boarding) || !Number.isInteger(destination) || destination <= boarding) {
      throw new Error("현재 차량 위치에서 자동 acceptance 구간을 만들 수 없습니다. 종점 직전/종점에서는 다른 구간에서 시도하세요.");
    }

    const push = await pushSubscription(health, permissionPromise);
    const started = await collectorRequest("/capture/start", {
      method: "POST",
      body: JSON.stringify({
        routeId: route.routeId,
        cityCode: CITY_CODE,
        boardedVehicleId: vehicle.vehicleId,
        boardingStopSequence: boarding,
        destinationStopSequence: destination,
        intervalMs: INTERVAL_MS,
        mode: "background_acceptance",
        ...(push.subscription ? { pushSubscription: push.subscription } : {}),
      }),
    });
    if (started.captureEngine !== "railway-background" || started.mode !== "background_acceptance") {
      throw new Error("Railway acceptance engine을 증명하지 못해 시작을 차단했습니다.");
    }

    remember(LAST_ROUTE_KEY, routeNo);
    remember(LAST_PLATE_KEY, suffix);
    remember(SESSION_KEY, started.sessionId);
    el("active-bus").textContent = `${routeNo} · …${suffix}`;
    el("push-state").textContent = push.state;
    renderActive(started);
    show("active");
    startStatusLoop(started.sessionId);
  } catch (error) {
    say("setup-alert", error.message || "테스트를 시작하지 못했습니다.", "bad");
  } finally {
    button.disabled = false;
  }
}

function renderActive(status) {
  el("snapshots").textContent = `${status.snapshotCount || 0} / 20+`;
  const hidden = Number(status.acceptance?.hiddenSeconds || 0);
  el("hidden-time").textContent = `${Math.floor(hidden)}초 / 60초+`;
}

async function refreshStatus(sessionId, quiet = true) {
  try {
    const status = await collectorRequest(`/capture/${encodeURIComponent(sessionId)}`);
    renderActive(status);
    if (status.phase === "completed" && status.report) finish(status.report);
    return status;
  } catch (error) {
    if (!quiet) say("active-alert", error.message || "상태 확인에 실패했습니다.", "bad");
    return undefined;
  }
}

function startStatusLoop(sessionId) {
  const tokenId = ++statusLoop;
  void (async () => {
    while (tokenId === statusLoop) {
      await sleep(INTERVAL_MS);
      if (tokenId !== statusLoop || document.hidden) continue;
      const status = await refreshStatus(sessionId);
      if (status?.phase === "completed") return;
    }
  })();
}

function finish(report) {
  statusLoop += 1;
  remember(SESSION_KEY, "");
  const acceptance = backgroundAcceptanceVerdict(report);
  show("finished");
  el("finish-hero").textContent = acceptance.verdict === "PASS" ? "백그라운드 검증 완료 ✓" : "백그라운드 검증 확인 필요";
  say(
    "finish-alert",
    acceptance.verdict === "PASS"
      ? "필요한 백그라운드 수집 증거를 확보했습니다. 아직 버스에 타고 있어도 정상이며, 이 검증 세션만 자동 종료된 것입니다."
      : `BACKGROUND ACCEPTANCE FAIL · ${acceptance.reasons.join(" / ")}`,
    acceptance.verdict === "PASS" ? "ok" : "bad",
  );
  el("finish-engine").textContent = report.captureEngine || "unknown";
  el("finish-snapshots").textContent = String(report.snapshotCount ?? 0);
  el("finish-hidden").textContent = `${report.lifecycle?.hiddenSeconds ?? 0}초`;
  el("finish-gap").textContent = `${report.collectionIntervalSeconds?.max ?? "?"}초`;
}

async function recordLifecycle(kind, refresh = true) {
  const sessionId = recalled(SESSION_KEY);
  if (!sessionId) return;
  try {
    await collectorRequest(`/capture/${encodeURIComponent(sessionId)}/event`, {
      method: "POST",
      body: JSON.stringify({ kind, at: new Date().toISOString() }),
      keepalive: true,
    });
    if (refresh && !document.hidden) await refreshStatus(sessionId);
  } catch { /* final report fails closed if lifecycle evidence was lost */ }
}

document.addEventListener("visibilitychange", () => {
  void recordLifecycle(document.hidden ? "hidden" : "visible");
});
window.addEventListener("pagehide", () => { void recordLifecycle("hidden", false); });
window.addEventListener("pageshow", () => { void recordLifecycle("visible"); });

el("start").addEventListener("click", () => void startAcceptance());
el("again").addEventListener("click", () => {
  statusLoop += 1;
  show("setup");
  say("setup-alert", "");
});
el("route-no").value = recalled(LAST_ROUTE_KEY);
el("plate").value = recalled(LAST_PLATE_KEY);
const migratedToken = token();
if (migratedToken) saveToken(migratedToken);
el("token-wrap").hidden = Boolean(migratedToken);
if (!isStandalone()) {
  say("setup-alert", "잠금화면 완료 알림을 받으려면 Safari 공유 메뉴 → 홈 화면에 추가 후 TAPSO 아이콘에서 실행하세요. 테스트 자체는 Safari에서도 가능합니다.", "warn");
}
void registerServiceWorker();

const existing = recalled(SESSION_KEY);
if (existing && token()) {
  show("active");
  el("active-bus").textContent = "진행 중 세션 복구";
  el("push-state").textContent = "기존 설정 유지";
  void refreshStatus(existing, false).then((status) => {
    if (status?.phase !== "completed") startStatusLoop(existing);
  });
}
