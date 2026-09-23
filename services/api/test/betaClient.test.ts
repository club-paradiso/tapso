import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DEFAULT_COLLECTOR_BASE } from "../public/ride-capture/background-client-core.js";
import { betaCampaignLines, inviteRowText } from "../public/ride-capture/beta-admin-core.js";
import {
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
  validCredential,
} from "../public/ride-capture/beta-client-core.js";

const page = (name: string) => readFile(new URL(`../public/ride-capture/${name}`, import.meta.url), "utf8");
const SECRET = `tbi_${"A".repeat(43)}`;
const stops = Array.from({ length: 10 }, (_, index) => ({ stopId: `S${index + 1}`, name: `Stop ${index + 1}`, sequence: index + 1 }));

test("the invite is read only from a well-formed fragment", () => {
  assert.equal(readInviteFragment(`#invite=${SECRET}`), SECRET);
  assert.equal(readInviteFragment(`invite=${SECRET}`), SECRET);
  assert.equal(readInviteFragment(`#x=1&invite=${SECRET}`), SECRET);
  for (const hash of ["", "#", "#invite=", "#invite=tbi_short", `#invite=${SECRET}x`, `#invite=tbt_${"A".repeat(43)}`, "#invite=<script>"]) {
    assert.equal(readInviteFragment(hash), undefined, hash);
  }
  assert.equal(validCredential(`tbt_${"b".repeat(43)}`), true);
  assert.equal(validCredential(SECRET), false);
});

test("server state decides every screen", () => {
  assert.equal(screenForMe({ status: "active", ridesUsed: 0, maxRides: 10 }), "bus");
  assert.equal(screenForMe({ status: "active", ridesUsed: 0, maxRides: 10, activeRide: { state: "recording" } }), "resume");
  assert.equal(screenForMe({ status: "expired", ridesUsed: 0, maxRides: 10, activeRide: { state: "retry" } }), "retry");
  assert.equal(screenForMe({ status: "expired", ridesUsed: 1, maxRides: 10 }), "expired");
  assert.equal(screenForMe({ status: "active", ridesUsed: 10, maxRides: 10 }), "limit");
  assert.equal(screenForMe({ status: "active", ridesUsed: 1, maxRides: 10, activeRide: { state: "done" } }), "bus");
  assert.deepEqual(
    ["recording", "finishing", "saving", "retry", "done", "lost"].map((state) => screenForRide({ state })),
    ["resume", "saving", "saving", "retry", "done", "lost"],
  );
  assert.equal(stillSaving({ state: "finishing" }), true);
  assert.equal(stillSaving({ state: "done" }), false);
});

test("error messages are friendly Korean with no codes, numbers or internals", () => {
  const codes = ["INVITE_USED", "INVITE_EXPIRED", "INVITE_REVOKED", "BETA_REVOKED", "INVITE_INVALID", "BETA_EXPIRED",
    "BETA_RIDE_LIMIT", "BETA_RIDE_IN_PROGRESS", "BETA_BUSY", "BUS_NOT_FOUND", "BUS_AMBIGUOUS", "RATE_LIMITED", "WHATEVER"];
  for (const code of codes) {
    for (const status of [0, 400, 401, 404, 409, 500, 503]) {
      const message = messageForError({ code, status });
      assert.ok(message.length > 0);
      assert.ok(!/[A-Z_]{4,}|\d{3}|RAW|JSON|Redis|matcher|token/i.test(message), `${code}/${status}: ${message}`);
    }
  }
  assert.equal(credentialIsDead({ status: 401 }), true);
  assert.equal(credentialIsDead({ status: 503 }), false);
});

test("boarding must be chosen by the tester; destinations follow it", () => {
  const { near, all } = boardingGroups(stops, 5);
  assert.deepEqual(near.map((stop: { sequence: number }) => stop.sequence), [2, 3, 4, 5, 6, 7]);
  assert.equal(all.length, 9, "the last stop is not boardable");
  assert.ok(!all.some((stop: { sequence: number }) => stop.sequence === 10));
  assert.deepEqual(boardingGroups(stops, undefined).near, []);
  assert.deepEqual(destinationChoices(stops, 7).map((stop: { sequence: number }) => stop.sequence), [8, 9, 10]);
  assert.deepEqual(destinationChoices(stops, undefined), []);
});

test("the start request carries the plate suffix, never a vehicle number", () => {
  const body = startPayload({
    route: { routeId: "R1", routeNumber: "365" },
    routeNo: "365",
    plateSuffix: "1234",
    boardingSequence: 3,
    destinationSequence: undefined,
    cityCode: "39",
  });
  assert.deepEqual(body, { routeId: "R1", cityCode: "39", routeNo: "365", plateSuffix: "1234", boardingStopSequence: 3 });
  assert.equal(startPayload({ route: { routeId: "R1" }, routeNo: "365", plateSuffix: "1234", boardingSequence: 3, destinationSequence: 8, cityCode: "39" }).destinationStopSequence, 8);
  assert.equal(rideTitle({ routeNo: "365" }), "365번 버스");
  assert.equal(rideSubtitle({ boardingStopName: "제주대학교" }), "제주대학교에서 탑승");
});

test("the beta page holds no operator path, token, export or internal vocabulary", async () => {
  const html = await page("beta.html");
  const js = await page("beta.js");
  const core = await page("beta-client-core.js");
  for (const source of [html, js, core]) {
    for (const forbidden of ["operatorToken", "RIDE_CAPTURE_OPERATOR_TOKEN", "tapso.rideCapture", "/raw", "/submit",
      "/capture/", "/field-validation", "/operator/", "/beta/invites", "/beta/campaign", "download", "geolocation",
      "sessionStorage", "marker"]) {
      assert.ok(!source.includes(forbidden), `beta page mentions ${forbidden}`);
    }
  }
  const visible = html.replace(/<[^>]+>/g, " ");
  for (const word of ["RAW", "JSON", "Redis", "Upstash", "matcher", "CLEAN_GATE", "campaign", "캠페인", "토큰", "리포트", "/ 30"]) {
    assert.ok(!visible.includes(word), `beta page shows ${word}`);
  }
  for (const phrase of ["버스 번호", "차량번호 뒤 4자리", "이 버스 찾기", "이 버스가 맞나요?", "실제 탑승 정류장", "목적지", "탑승 시작",
    "기록 중", "휴대폰은 넣어두셔도 됩니다.", "하차 완료", "기록 완료 ✓", "테스트 참여 감사합니다.", "기록이 안전하게 저장됐어요.",
    "기록 저장을 마무리하지 못했어요.", "데이터는 아직 안전하게 보관 중입니다.", "다시 시도", "탑승 기록이 진행 중입니다", "기록 계속하기"]) {
    assert.ok(html.includes(phrase), `missing: ${phrase}`);
  }
  // Exactly one ordinary action at the end of a ride: no second submit button.
  assert.equal((html.match(/제출/g) ?? []).length, 0);
});

test("the beta page is locked down: CSP, no inline code, fragment scrubbed before any request", async () => {
  const html = await page("beta.html");
  const js = await page("beta.js");
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.ok(!csp.includes("unsafe"), "no unsafe-inline or unsafe-eval");
  assert.ok(csp.includes(`connect-src 'self' ${DEFAULT_COLLECTOR_BASE}`), "talks only to itself and the collector");
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(html), "no inline script");
  assert.ok(!/\sstyle="/.test(html), "no inline style");
  assert.match(html, /<meta name="referrer" content="no-referrer"/);
  // The replaceState happens before the redeem request in boot().
  const boot = js.slice(js.indexOf("async function boot()"));
  assert.ok(boot.indexOf("history.replaceState") >= 0);
  assert.ok(boot.indexOf("history.replaceState") < boot.indexOf("collector.redeem"));
  assert.ok(js.includes('referrerPolicy: "no-referrer"'));
});

test("the beta page is built for a 390px iPhone: safe areas, big targets, no zoom on focus, no sideways scroll", async () => {
  const html = await page("beta.html");
  const css = await page("beta.css");
  assert.match(html, /viewport-fit=cover/);
  assert.ok(!/user-scalable=no|maximum-scale/.test(html), "zoom stays available");
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /--tap: 56px/);
  assert.match(css, /button\.primary \{[^}]*min-height: 64px/);
  assert.match(css, /input, select, button \{ font: inherit; font-size: 1\.05rem; \}/);
  assert.match(css, /overflow-x: hidden/);
  assert.match(css, /max-width: 30rem/);
  assert.match(css, /touch-action: manipulation/, "no double-tap zoom delay");
});

test("the operator panel shows sanitized beta progress and keeps the gate distinction explicit", () => {
  const lines = betaCampaignLines({
    matcherFieldRides: { clean: 12, target: 30, remaining: 18 },
    testers: 5,
    routes: 7,
    verdictCounts: { correct: 12, wrong: 0, never_committed: 3 },
    ridesWithContestedDecisions: 4,
    directionReversals: 0,
    staleSelections: 0,
    alerts: [],
  });
  assert.equal(lines[1], "12 / 30 clean rides");
  assert.ok(lines.some((line) => line.startsWith("Provider/cadence calibration: separate")));
  assert.ok(lines.some((line) => line.includes("automatic matching: OFF")));
  const row = inviteRowText({ inviteId: "inv_1", label: "친구 A", status: "active", expiresAt: "2026-09-30T00:00:00Z", ridesUsed: 2, maxRides: 10 }, new Date("2026-09-23T00:00:00Z"));
  assert.equal(row, "친구 A · 사용 중 · 7일 남음 · 2 / 10 rides");
});

test("the operator page keeps every existing control and only gains the invite panel", async () => {
  const html = await page("background.html");
  for (const id of ["token-block", "find-bus", "mark-stop", "quick-stops", "alight", "submit-ride", "save-raw", "save-report", "copy-report", "backup-exports"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.ok(html.includes('src="./background.js"'));
  assert.ok(html.includes('src="./beta-admin.js"'));
  const admin = await page("beta-admin.js");
  assert.ok(!admin.includes("localStorage"), "the operator token is never persisted by the panel");
});
