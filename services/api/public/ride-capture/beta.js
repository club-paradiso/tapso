import {
  CREDENTIAL_KEY,
  SAVING_MAX_WAIT_MS,
  SAVING_POLL_MS,
  boardingGroups,
  credentialIsDead,
  destinationChoices,
  messageForError,
  readInviteFragment,
  rideSubtitle,
  rideTitle,
  screenForMe,
  screenForRide,
  startPayload,
  stillSaving,
  stopLabel,
  validCredential,
} from "./beta-client-core.js";
import { DEFAULT_COLLECTOR_BASE } from "./background-client-core.js";
import { exactRouteVariants, hasValidPlateSuffix, matchingVehicles, normalizePlateSuffix } from "./quick-core.js";

const CITY_CODE = "39";
const MAX_VARIANTS = 12;
const COLLECTOR = DEFAULT_COLLECTOR_BASE;
const SCREENS = [
  "loading", "need-invite", "bus", "pick-direction", "confirm", "resume", "riding",
  "saving", "done", "closed", "retry", "lost", "expired", "limit",
];
const el = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let memoryCredential = "";
const state = {
  me: undefined,
  ride: undefined,
  route: undefined,
  routeNo: "",
  plateSuffix: "",
  vehicle: undefined,
  stops: [],
  busy: false,
  savingLoop: 0,
};

class ApiError extends Error {
  constructor(status, code) {
    super(code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------ credential */

function loadCredential() {
  try {
    const stored = localStorage.getItem(CREDENTIAL_KEY) || "";
    return validCredential(stored) ? stored : memoryCredential;
  } catch {
    return memoryCredential;
  }
}

function saveCredential(value) {
  memoryCredential = value || "";
  try {
    if (value) localStorage.setItem(CREDENTIAL_KEY, value);
    else localStorage.removeItem(CREDENTIAL_KEY);
  } catch {
    // Private browsing can refuse storage; this tab still works from memory.
  }
}

/* ------------------------------------------------------------ network */

async function request(url, { method = "GET", body, auth = false } = {}) {
  const headers = {};
  if (auth) {
    const credential = loadCredential();
    if (!credential) throw new ApiError(401, "BETA_UNAUTHORIZED");
    headers.authorization = `Bearer ${credential}`;
  }
  if (body !== undefined) headers["content-type"] = "application/json";
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      cache: "no-store",
      referrerPolicy: "no-referrer",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "NETWORK");
  }
  let payload = {};
  try { payload = await response.json(); } catch { /* the status decides */ }
  if (!response.ok) throw new ApiError(response.status, payload?.error || "");
  return payload;
}

const collector = {
  redeem: (invite) => request(`${COLLECTOR}/beta/session`, { method: "POST", body: { invite } }),
  me: () => request(`${COLLECTOR}/beta/me`, { auth: true }),
  start: (body) => request(`${COLLECTOR}/beta/rides`, { method: "POST", body, auth: true }),
  ride: (id) => request(`${COLLECTOR}/beta/rides/${encodeURIComponent(id)}`, { auth: true }),
  finish: (id) => request(`${COLLECTOR}/beta/rides/${encodeURIComponent(id)}/finish`, { method: "POST", body: {}, auth: true }),
};

// Public, cached transit reads on this page's own origin. No credential.
const transit = {
  routes: (routeNo) => request(`/v1/routes?cityCode=${CITY_CODE}&routeNo=${encodeURIComponent(routeNo)}`),
  vehicles: (routeId) => request(`/v1/vehicles?cityCode=${CITY_CODE}&routeId=${encodeURIComponent(routeId)}`),
  stops: (routeId) => request(`/v1/stops?cityCode=${CITY_CODE}&routeId=${encodeURIComponent(routeId)}`),
};

/* ------------------------------------------------------------ screens */

function show(name) {
  for (const id of SCREENS) el(`screen-${id}`).hidden = id !== name;
  window.scrollTo(0, 0);
  const heading = el(`screen-${name}`).querySelector("h1");
  el("live").textContent = heading ? heading.textContent : "";
}

function say(id, message = "") {
  el(id).textContent = message;
}

function handleAuthFailure(error) {
  if (!credentialIsDead(error)) return false;
  saveCredential("");
  say("need-invite-message", messageForError(error));
  show("need-invite");
  return true;
}

function renderRide(ride) {
  state.ride = ride;
  for (const prefix of ["riding", "resume"]) {
    el(`${prefix}-title`).textContent = rideTitle(ride);
    el(`${prefix}-subtitle`).textContent = rideSubtitle(ride);
  }
  el("done-note").hidden = !ride?.endedAutomatically;
}

function showRide(ride) {
  renderRide(ride);
  const screen = screenForRide(ride);
  if (screen === "saving") {
    show("saving");
    void waitForSaved();
    return;
  }
  show(screen);
}

function showHome(me) {
  state.me = me;
  state.ride = undefined;
  const screen = screenForMe(me);
  if (me?.activeRide && screen !== "bus" && screen !== "expired" && screen !== "limit") {
    showRide(me.activeRide);
    return;
  }
  const left = Math.max(0, (me?.maxRides ?? 0) - (me?.ridesUsed ?? 0));
  el("rides-left").textContent = me ? `남은 기록 가능 횟수 ${left}회` : "";
  show(screen);
}

async function refreshHome() {
  show("loading");
  try {
    showHome(await collector.me());
  } catch (error) {
    if (handleAuthFailure(error)) return;
    say("need-invite-message", messageForError(error));
    show("need-invite");
  }
}

/* ------------------------------------------------------------ invite */

async function boot() {
  const invite = readInviteFragment(location.hash);
  if (location.hash) {
    // First thing, before any request: the secret leaves the address bar and
    // this history entry, so a screenshot, a share or the back button cannot carry it.
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (invite) {
    show("loading");
    try {
      const session = await collector.redeem(invite);
      saveCredential(session.credential);
    } catch (error) {
      // An existing credential on this phone still works if the link was reopened.
      if (!loadCredential()) {
        say("need-invite-message", messageForError(error));
        show("need-invite");
        return;
      }
    }
  }
  if (!loadCredential()) {
    show("need-invite");
    return;
  }
  await refreshHome();
}

/* ------------------------------------------------------------ find the bus */

async function findBus(event) {
  event?.preventDefault();
  if (state.busy) return;
  const routeNo = String(el("route-no").value || "").trim().replace(/\s+/g, "").replace(/번$/u, "");
  const suffix = normalizePlateSuffix(el("plate").value);
  if (!routeNo) return say("bus-alert", "버스 번호를 입력해 주세요.");
  if (!hasValidPlateSuffix(el("plate").value)) return say("bus-alert", "차량번호 뒤 4자리 숫자를 입력해 주세요.");
  el("route-no").blur();
  el("plate").blur();
  state.busy = true;
  el("find-bus").disabled = true;
  say("bus-alert", "");
  el("find-bus").textContent = "찾는 중…";
  try {
    const variants = exactRouteVariants((await transit.routes(routeNo)).items || [], routeNo);
    if (!variants.length) throw new Error(`${routeNo}번 버스를 찾지 못했어요. 번호를 다시 확인해 주세요.`);
    if (variants.length > MAX_VARIANTS) throw new Error("이 번호는 운행 구간이 너무 많아 지금은 기록할 수 없어요.");
    const rows = await Promise.all(variants.map(async (route) => {
      try {
        return { route, vehicles: matchingVehicles((await transit.vehicles(route.routeId)).items || [], suffix) };
      } catch {
        return { route, vehicles: [] };
      }
    }));
    const candidates = rows.flatMap((row) => row.vehicles.map((vehicle) => ({ route: row.route, vehicle })));
    if (!candidates.length) {
      throw new Error(`지금 운행 중인 ${routeNo}번에서 …${suffix} 버스를 찾지 못했어요. 번호를 다시 확인해 주세요.`);
    }
    state.routeNo = routeNo;
    state.plateSuffix = suffix;
    if (candidates.length === 1) {
      await confirmBus(candidates[0]);
      return;
    }
    renderDirections(candidates);
    show("pick-direction");
  } catch (error) {
    say("bus-alert", error instanceof ApiError ? messageForError(error) : error.message);
  } finally {
    state.busy = false;
    el("find-bus").disabled = false;
    el("find-bus").textContent = "이 버스 찾기";
  }
}

function renderDirections(candidates) {
  const list = el("direction-list");
  list.replaceChildren();
  for (const candidate of candidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${candidate.route.startStopName || "기점"} → ${candidate.route.endStopName || "종점"}`;
    button.addEventListener("click", () => void confirmBus(candidate));
    list.append(button);
  }
}

async function confirmBus({ route, vehicle }) {
  const stops = (await transit.stops(route.routeId)).items || [];
  state.route = route;
  state.vehicle = vehicle;
  state.stops = stops;
  el("confirm-route").textContent = `${state.routeNo}번`;
  el("confirm-plate").textContent = `차량번호 …${state.plateSuffix}`;
  el("confirm-direction").textContent = `${route.startStopName || "기점"} → ${route.endStopName || "종점"} 방향`;
  renderBoarding();
  say("confirm-alert", "");
  show("confirm");
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = String(value);
  node.textContent = label;
  return node;
}

function renderBoarding() {
  const select = el("boarding");
  select.replaceChildren(option("", "정류장을 선택하세요"));
  const { near, all } = boardingGroups(state.stops, state.vehicle?.stopSequence);
  if (near.length) {
    const group = document.createElement("optgroup");
    group.label = "버스 근처 정류장";
    for (const stop of near) group.append(option(stop.sequence, stopLabel(stop)));
    select.append(group);
  }
  const group = document.createElement("optgroup");
  group.label = "전체 정류장";
  for (const stop of all) group.append(option(stop.sequence, stopLabel(stop)));
  select.append(group);
  select.value = "";
  renderDestination();
}

function selectedSequence(id) {
  const value = Number.parseInt(el(id).value, 10);
  return Number.isInteger(value) ? value : undefined;
}

function renderDestination() {
  const boarding = selectedSequence("boarding");
  const select = el("destination");
  select.replaceChildren(option("", "선택 안 함"));
  for (const stop of destinationChoices(state.stops, boarding)) select.append(option(stop.sequence, stopLabel(stop)));
  select.value = "";
  select.disabled = boarding === undefined;
  el("start").disabled = boarding === undefined;
}

/* ------------------------------------------------------------ ride */

async function startRide() {
  const boarding = selectedSequence("boarding");
  if (state.busy || !state.route || boarding === undefined) return;
  state.busy = true;
  el("start").disabled = true;
  el("start").textContent = "시작하는 중…";
  say("confirm-alert", "");
  try {
    const ride = await collector.start(startPayload({
      route: state.route,
      routeNo: state.routeNo,
      plateSuffix: state.plateSuffix,
      boardingSequence: boarding,
      destinationSequence: selectedSequence("destination"),
      cityCode: CITY_CODE,
    }));
    renderRide(ride);
    closeAlightConfirm();
    show("riding");
  } catch (error) {
    if (handleAuthFailure(error)) return;
    if (error.code === "BETA_RIDE_IN_PROGRESS") {
      await refreshHome();
      return;
    }
    say("confirm-alert", messageForError(error));
  } finally {
    state.busy = false;
    el("start").disabled = selectedSequence("boarding") === undefined;
    el("start").textContent = "탑승 시작";
  }
}

function openAlightConfirm() {
  el("alight").hidden = true;
  el("alight-confirm").hidden = false;
}

function closeAlightConfirm() {
  el("alight").hidden = false;
  el("alight-confirm").hidden = true;
}

async function finishRide() {
  if (state.busy || !state.ride) return;
  state.busy = true;
  el("alight-yes").disabled = true;
  el("retry").disabled = true;
  say("riding-alert", "");
  say("retry-alert", "");
  try {
    const ride = await collector.finish(state.ride.sessionId);
    showRide(ride);
  } catch (error) {
    if (handleAuthFailure(error)) return;
    const target = el("screen-retry").hidden ? "riding-alert" : "retry-alert";
    say(target, messageForError(error));
  } finally {
    state.busy = false;
    el("alight-yes").disabled = false;
    el("retry").disabled = false;
    closeAlightConfirm();
  }
}

/** Ask the server until it has stored the ride, bounded; then say so plainly. */
async function waitForSaved() {
  const loop = ++state.savingLoop;
  const deadline = Date.now() + SAVING_MAX_WAIT_MS;
  while (loop === state.savingLoop && Date.now() < deadline) {
    await sleep(SAVING_POLL_MS);
    if (loop !== state.savingLoop || document.hidden) continue;
    try {
      const ride = await collector.ride(state.ride.sessionId);
      renderRide(ride);
      if (!stillSaving(ride)) {
        showRide(ride);
        return;
      }
    } catch (error) {
      if (handleAuthFailure(error)) return;
    }
  }
  if (loop === state.savingLoop) show("retry");
}

/** Coming back to the tab re-reads the ride from the server, which owns it. */
async function onVisible() {
  if (document.hidden || !state.ride || state.busy) return;
  const screen = [...SCREENS].find((id) => !el(`screen-${id}`).hidden);
  if (screen !== "riding" && screen !== "resume") return;
  try {
    const ride = await collector.ride(state.ride.sessionId);
    if (ride.state !== "recording") showRide(ride);
  } catch (error) {
    handleAuthFailure(error);
  }
}

/* ------------------------------------------------------------ wiring */

el("bus-form").addEventListener("submit", (event) => void findBus(event));
el("plate").addEventListener("input", () => {
  // Typing keeps the first four digits; a pasted full plate keeps its last four.
  const typed = el("plate").value;
  const digits = typed.replace(/\D/g, "");
  el("plate").value = /\D/.test(typed) ? digits.slice(-4) : digits.slice(0, 4);
});
el("route-no").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    el("plate").focus();
  }
});
el("direction-back").addEventListener("click", () => show("bus"));
el("boarding").addEventListener("change", renderDestination);
el("start").addEventListener("click", () => void startRide());
el("confirm-back").addEventListener("click", () => show("bus"));
el("resume").addEventListener("click", () => show("riding"));
el("alight").addEventListener("click", openAlightConfirm);
el("alight-no").addEventListener("click", closeAlightConfirm);
el("alight-yes").addEventListener("click", () => void finishRide());
el("retry").addEventListener("click", () => void finishRide());
el("done-close").addEventListener("click", () => show("closed"));
el("next-ride").addEventListener("click", () => void refreshHome());
el("lost-restart").addEventListener("click", () => void refreshHome());
document.addEventListener("visibilitychange", () => void onVisible());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void onVisible();
});

void boot();
