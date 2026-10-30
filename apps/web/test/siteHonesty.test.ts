/**
 * Honesty of the page itself: the waitlist and support states never claim more
 * than the server said, and no source file makes a claim the product cannot
 * back (the build repeats the claim check on the prerendered HTML).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WaitlistResponse } from "../api/_lib/contract.ts";
import { FORBIDDEN_CLAIMS } from "../src/content/forbiddenClaims.ts";
import { FAQ_ITEMS, NAV_ITEMS, STATUS_ITEMS } from "../src/content/site.ts";
import { CHAPTERS } from "../src/story/beats.ts";
import { supportStatus } from "../src/lib/supportStatus.ts";
import { UNAVAILABLE_MESSAGE, waitlistOutcome } from "../src/lib/waitlistMessages.ts";

const src = fileURLToPath(new URL("../src/", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "figma" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) && name !== "forbiddenClaims.ts" ? [path] : [];
  });
}

/** Source text a visitor can read: comments removed. */
function visibleSource(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

test("only `created` reads as a registration", () => {
  const responses: WaitlistResponse[] = [
    { status: "already_registered" },
    { status: "invalid_request", field: "email" },
    { status: "rate_limited", retryAfterSeconds: 30 },
    { status: "unavailable" },
    { status: "internal_error" },
  ];
  for (const response of responses) assert.notEqual(waitlistOutcome(response).kind, "success", response.status);
  assert.deepEqual(waitlistOutcome({ status: "created", emailDelivery: "sent" }), { kind: "success", emailSent: true });
  assert.deepEqual(waitlistOutcome({ status: "created", emailDelivery: "deferred" }), { kind: "success", emailSent: false });
});

test("an unprovisioned waitlist says plainly that nothing was stored", () => {
  const outcome = waitlistOutcome({ status: "unavailable" });
  assert.equal(outcome.kind, "error");
  assert.equal(outcome.kind === "error" && outcome.message, UNAVAILABLE_MESSAGE);
  assert.match(UNAVAILABLE_MESSAGE, /저장되지 않았어요/);
});

test("rate limiting names the wait", () => {
  const outcome = waitlistOutcome({ status: "rate_limited", retryAfterSeconds: 42 });
  assert.ok(outcome.kind === "error" && outcome.message.includes("42초"));
});

test("support reads as closed until the server says live", () => {
  const closed = supportStatus(undefined);
  assert.equal(closed.open, false);
  const unavailable = supportStatus({ mode: "unavailable", currency: "KRW", presetAmounts: [], minAmount: 1, maxAmount: 2 });
  assert.equal(unavailable.open, false);
  assert.match(unavailable.label, /준비 중/);
  assert.doesNotMatch(unavailable.action, /^후원하기$/);
  const live = supportStatus({ mode: "live", currency: "KRW", presetAmounts: [3000], minAmount: 1000, maxAmount: 100000, clientKey: "test_ck" });
  assert.equal(live.open, true);
});


test("marketing branding consistently says TAPSO, keeping 제주어 quotes intact", () => {
  const support = readFileSync(join(src, "sections/Support.tsx"), "utf8");
  const companion = readFileSync(join(src, "sections/MapCompanion.tsx"), "utf8");
  const story = readFileSync(join(src, "story/journeyCopy.ts"), "utf8");
  const waitlistLabels = readFileSync(join(src, "lib/waitlistClient.ts"), "utf8");
  const email = readFileSync(join(src, "../api/_lib/email.ts"), "utf8");
  const html = readFileSync(join(src, "../index.html"), "utf8");

  assert.match(support, /개발자한테 커피 한 잔 보태고 싶다면/);
  assert.match(waitlistLabels, /label: "제주도민"/);
  assert.match(email, /resident: "제주도민"/);
  assert.doesNotMatch(waitlistLabels, /제주 도민/);
  assert.doesNotMatch(email, /제주 도민/);
  assert.match(story, /title: "어느 버스를 어디서 탈까요\?"/);
  assert.doesNotMatch(story, /길찾기는 지도 앱이 잘해요/);
  assert.doesNotMatch(companion, /더 잘해요|더 잘 알아요/);
  assert.match(html, /<title>TAPSO —/);
  assert.doesNotMatch(html, /탑서 TAPSO/);
  assert.match(html, /혼저 탑서/);
});

test("no source file makes a claim TAPSO cannot back", () => {
  for (const path of files(src)) {
    const text = visibleSource(path);
    for (const { pattern, reason, renderedOnly } of FORBIDDEN_CLAIMS) {
      if (renderedOnly) continue;
      assert.doesNotMatch(text, pattern, `${path.replace(src, "src/")}: ${reason}`);
    }
  }
});

test("the claim guard itself catches what it is meant to catch", () => {
  const samples = [
    "지금 다운로드하세요",
    "App Store에서 만나보세요",
    "신뢰도 92",
    "정확도 99%",
    "TestFlight가 열렸어요",
    "브라우저에서 바로 체험하세요",
    "탑서가 자동으로 버스를 찾아드려요",
    "기부금 영수증을 발급해드려요",
    "1만 명이 사용 중",
    "사전예약을 받고 있어요",
    "실제 iPhone 검증을 완료",
    "앱을 닫아도 계속 안내",
    "위치 권한을 묻지 않아요",
  ];
  for (const sample of samples) {
    assert.ok(FORBIDDEN_CLAIMS.some(({ pattern }) => pattern.test(sample)), sample);
  }
});

test("status never claims TestFlight or the App Store is here", () => {
  for (const item of STATUS_ITEMS) {
    if (/TestFlight|App Store/.test(item.title)) assert.equal(item.level, "blocked", item.title);
  }
  assert.ok(STATUS_ITEMS.some((i) => i.level === "realdata" || i.level === "built"));
});

test("the landing page omits the map-app comparison section without leaving a blank block", () => {
  const app = readFileSync(join(src, "App.tsx"), "utf8");
  assert.doesNotMatch(app, /MapCompanion/);
  assert.match(app, /<Journey \/>\s*<Privacy \/>/);
  for (const section of ["Hero", "Journey", "Privacy", "Status", "Waitlist", "Faq"]) {
    assert.match(app, new RegExp(`<${section}\\s*/>`), `missing ${section} section`);
  }
});

test("every navigation target exists on the page", () => {
  const sources = files(join(src, "sections")).map((p) => readFileSync(p, "utf8")).join("\n");
  // The journey's chapters take their anchors from the story model.
  assert.match(sources, /<section[^>]*\n?\s*id=\{chapter\.id\}/, "journey chapters render their ids");
  const chapterIds = new Set<string>(CHAPTERS.map((c) => c.id));
  for (const item of NAV_ITEMS) {
    const id = item.href.slice(1);
    if (chapterIds.has(id)) continue;
    assert.match(sources, new RegExp(`id="${id}"`), item.href);
  }
});

test("no GitHub platform branding or repository links can leak into public website source", () => {
  // Check *all* of the shipped React code, including lazy components, to
  // prevent a hidden footer/link from resurfacing in another section.
  for (const path of files(src)) {
    assert.doesNotMatch(
      visibleSource(path),
      /github(?:\.com|\s*issues?)?|GitHubIcon|LINKS\.(github|issues)/i,
      path.replace(src, "src/"),
    );
  }
  const publicHtml = readFileSync(join(src, "../index.html"), "utf8");
  assert.doesNotMatch(publicHtml, /github(?:\.com|\s*issues?)?|github\.io/i);
  assert.match(visibleSource(join(src, "App.tsx")), /같은 금액을 곧바로 다시 결제하지 마세요/);
});

test("unavailable preorder is not offered on the landing page", () => {
  const header = readFileSync(join(src, "sections/Header.tsx"), "utf8");
  const footer = readFileSync(join(src, "sections/Footer.tsx"), "utf8");
  const waitlist = readFileSync(join(src, "sections/Waitlist.tsx"), "utf8");
  const config = JSON.parse(readFileSync(join(src, "design/marketing.json"), "utf8"));
  const page = readFileSync(join(src, "../index.html"), "utf8");
  assert.equal(config.copy.cta, "개발 현황 보기");
  assert.match(header, /href="#status"/);
  assert.match(footer, /href="#status"/);
  assert.match(waitlist, /사전예약을 받고 있지 않아요/);
  assert.doesNotMatch(readFileSync(join(src, "sections/Support.tsx"), "utf8"), /onClick=\{onOpen\}/);
  assert.doesNotMatch(waitlist, /<WaitlistForm|<form/);
  assert.doesNotMatch(page, /사전예약을 받고 있어요/);
});

test("public status separates implementation, field validation and availability", () => {
  const level = (id: string) => STATUS_ITEMS.find((item) => item.id === id);
  assert.equal(level("vehicle-progress")?.level, "verifying");
  assert.match(level("vehicle-progress")?.body ?? "", /자동 선택은 꺼/);
  assert.match(level("release")?.body ?? "", /공개되지 않았어요/);
  assert.match(FAQ_ITEMS.find((item) => item.q.includes("위치 권한"))!.a, /선택 기능/);
});

test("the FAQ answers the questions a visitor asks first", () => {
  const questions = FAQ_ITEMS.map((f) => f.q).join("\n");
  for (const topic of ["지도 앱", "위치 권한", "실제 버스", "TestFlight", "Android", "다이나믹 아일랜드가 없는", "데이터가 끊기면"]) {
    assert.ok(questions.includes(topic), topic);
  }
});
