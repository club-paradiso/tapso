/**
 * Pure helpers for the beta tester page. No DOM and no network, so every rule
 * here runs under `node --test` exactly as it runs in Safari.
 *
 * The beta page is deliberately not the operator page with buttons hidden: it
 * has no operator token, no raw or report export, no stop taps during the ride and
 * no campaign numbers, and none of those words appear in what it shows.
 */

import { boardingCandidates } from "./quick-core.js";

export const CREDENTIAL_KEY = "tapso.beta.credential";
const INVITE_PATTERN = /^tbi_[A-Za-z0-9_-]{43}$/;
const CREDENTIAL_PATTERN = /^tbt_[A-Za-z0-9_-]{43}$/;

/**
 * The invite secret from a `#invite=…` fragment, or undefined. A fragment is
 * never sent to any server, so the secret reaches only this page's script,
 * which removes it from the address bar before doing anything else.
 */
export function readInviteFragment(hash) {
  const text = String(hash ?? "").replace(/^#/, "");
  const value = new URLSearchParams(text).get("invite");
  return value && INVITE_PATTERN.test(value) ? value : undefined;
}

export function validCredential(value) {
  return typeof value === "string" && CREDENTIAL_PATTERN.test(value);
}

/** Which screen a `/beta/me` answer opens on. */
export function screenForMe(me) {
  const ride = me?.activeRide;
  if (ride && ride.state !== "done" && ride.state !== "lost") return screenForRide(ride);
  if (me?.status === "expired") return "expired";
  if (me && me.ridesUsed >= me.maxRides) return "limit";
  return "bus";
}

/** Which screen one ride's server state maps to. */
export function screenForRide(ride) {
  switch (ride?.state) {
    case "recording": return "resume";
    case "finishing":
    case "saving": return "saving";
    case "retry": return "retry";
    case "done": return "done";
    case "lost": return "lost";
    default: return "bus";
  }
}

/** Whether the saving screen should keep asking the server. */
export function stillSaving(ride) {
  return ride?.state === "finishing" || ride?.state === "saving";
}

/** One friendly sentence per failure. Never a code, a status number, or server text. */
export function messageForError(error) {
  const code = String(error?.code ?? "");
  const status = Number(error?.status ?? 0);
  switch (code) {
    case "INVITE_USED": return "이미 사용된 초대 링크예요. 처음 링크를 연 휴대폰에서 계속하거나, 새 링크를 요청해 주세요.";
    case "INVITE_EXPIRED": return "초대 링크의 기간이 끝났어요. 초대한 사람에게 새 링크를 요청해 주세요.";
    case "INVITE_REVOKED":
    case "BETA_REVOKED": return "이 테스트 링크는 더 이상 사용할 수 없어요.";
    case "INVITE_INVALID": return "초대 링크가 올바르지 않아요. 받은 링크를 그대로 다시 열어 주세요.";
    case "BETA_EXPIRED": return "테스트 기간이 끝났어요. 참여해 주셔서 감사합니다.";
    case "BETA_RIDE_LIMIT": return "이 링크로 기록할 수 있는 횟수를 모두 썼어요. 감사합니다!";
    case "BETA_RIDE_IN_PROGRESS": return "진행 중인 탑승 기록이 있어요. 먼저 그 기록을 마쳐 주세요.";
    case "BETA_BUSY": return "탑승 기록을 시작하는 중이에요. 잠시 뒤 다시 눌러 주세요.";
    case "BUS_NOT_FOUND": return "지금 이 버스를 확인하지 못했어요. 버스 번호와 차량번호 뒤 4자리를 다시 확인해 주세요.";
    case "BUS_AMBIGUOUS": return "같은 뒤 4자리 버스가 여러 대 보여요. 잠시 뒤 다시 시도해 주세요.";
    case "RATE_LIMITED": return "요청이 너무 잦아요. 잠시 뒤 다시 시도해 주세요.";
    case "BETA_DISABLED":
    case "BETA_UNCONFIGURED": return "지금은 베타 테스트를 진행하지 않아요. 초대한 사람에게 알려 주세요.";
    default: break;
  }
  if (status === 0) return "인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
  if (status === 401) return "테스트 초대 링크로 다시 접속해 주세요.";
  if (status === 404) return "기록을 찾지 못했어요. 처음 화면에서 다시 시작해 주세요.";
  if (status >= 500) return "서버가 잠시 응답하지 않아요. 잠시 뒤 다시 시도해 주세요.";
  return "잠시 문제가 생겼어요. 다시 시도해 주세요.";
}

/** Error codes after which this browser's credential is useless. */
export function credentialIsDead(error) {
  return Number(error?.status) === 401;
}

/**
 * Boarding choices: stops near where the provider places the bus first, then
 * the whole route. Nothing is preselected; the tester names the real stop.
 * The last stop is left out, because nobody boards to ride zero stops.
 */
export function boardingGroups(stops, providerSequence) {
  const list = (Array.isArray(stops) ? stops : []).filter((stop) => Number.isInteger(stop?.sequence));
  if (list.length < 2) return { near: [], all: [] };
  const last = Math.max(...list.map((stop) => stop.sequence));
  const boardable = list.filter((stop) => stop.sequence < last);
  const near = Number.isInteger(providerSequence)
    ? boardingCandidates(boardable, providerSequence, 3, 2)
    : [];
  return { near, all: boardable };
}

/** Optional destinations: strictly after the boarding stop on the same pass. */
export function destinationChoices(stops, boardingSequence) {
  if (!Number.isInteger(boardingSequence)) return [];
  return (Array.isArray(stops) ? stops : []).filter((stop) => Number.isInteger(stop?.sequence) && stop.sequence > boardingSequence);
}

export function stopLabel(stop) {
  return `${stop.name} · ${stop.sequence}번째`;
}

/** The start request carries the plate suffix only; the collector re-resolves the exact bus itself. */
export function startPayload({ route, routeNo, plateSuffix, boardingSequence, destinationSequence, cityCode }) {
  return {
    routeId: route.routeId,
    cityCode,
    routeNo,
    plateSuffix,
    boardingStopSequence: boardingSequence,
    ...(Number.isInteger(destinationSequence) ? { destinationStopSequence: destinationSequence } : {}),
  };
}

export function rideTitle(ride) {
  return `${ride?.routeNo ?? ""}번 버스`;
}

export function rideSubtitle(ride) {
  const from = `${ride?.boardingStopName ?? ""}에서 탑승`;
  return ride?.destinationStopName ? `${from} · ${ride.destinationStopName}까지` : from;
}

/** Bounded polling while the server closes and stores a ride. */
export const SAVING_POLL_MS = 3_000;
export const SAVING_MAX_WAIT_MS = 120_000;
