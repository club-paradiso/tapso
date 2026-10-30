/**
 * The development-status section may not claim more than the repository can
 * show. Every item carries a level, every level has an evidence entry, and no
 * item may say it was seen on a real iPhone until an evidence file exists.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { STATUS_GROUPS, STATUS_ITEMS, STATUS_LEVEL_LABELS, type StatusLevel } from "../src/content/site.ts";
import { STATUS_EVIDENCE } from "./statusEvidence.ts";

const statusSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "sections", "Status.tsx"), "utf8");
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LEVELS = Object.keys(STATUS_LEVEL_LABELS) as StatusLevel[];

function deviceEvidenceFiles(): string[] {
  const dir = join(repo, "artifacts", "device-validation");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => !/^(README|TEMPLATE)\.md$/.test(name) && !name.startsWith("."));
}

test("every item has a known group, a known level and a unique id", () => {
  const groups = new Set(STATUS_GROUPS.map((g) => g.id));
  const ids = new Set<string>();
  for (const item of STATUS_ITEMS) {
    assert.ok(groups.has(item.group), item.id);
    assert.ok(LEVELS.includes(item.level), item.id);
    assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
    ids.add(item.id);
  }
  for (const group of STATUS_GROUPS) {
    assert.ok(STATUS_ITEMS.some((i) => i.group === group.id), `${group.id} is empty`);
  }
});

test("a blocked item sits under the remaining steps and a built item never under them", () => {
  for (const item of STATUS_ITEMS) {
    if (item.level === "blocked") assert.equal(item.group, "remaining", item.id);
    if (item.group === "remaining") assert.equal(item.level, "blocked", item.id);
    if (item.group === "built") assert.ok(["built", "realdata", "device"].includes(item.level), item.id);
  }
});

test("no item claims a real-iPhone check without device evidence", () => {
  const evidence = deviceEvidenceFiles();
  for (const item of STATUS_ITEMS) {
    if (item.level === "device") assert.ok(evidence.length > 0, `${item.id} claims 실기기 확인`);
  }
  if (evidence.length === 0) {
    for (const item of STATUS_ITEMS) {
      assert.doesNotMatch(item.body, /실제 iPhone에서 (확인했|동작을 확인했|검증했)|실기기에서 (확인했|검증했)/, item.id);
    }
  }
});

test("every unfinished item says what is still unchecked", () => {
  for (const item of STATUS_ITEMS) {
    if (item.level === "device") continue;
    assert.match(item.body, /남았어요|없어요|않아요|전이고|전이에요|먼저예요|꺼 둔|꺼져|전\b|아직/, item.id);
  }
});

test("status copy has no inflated, stale or internal wording", () => {
  const banned: [RegExp, string][] = [
    [/Product\s*V\d/i, "internal project name"],
    [/탑서/, "the app is TAPSO everywhere"],
    [/출시\s*완료|출시했|출시됐|바로\s*사용|지금\s*사용\s*가능|이용할\s*수\s*있어요/, "launch or availability claim"],
    [/합성\s*데이터/, "stale: live Jeju data is connected"],
    [/\d{4}\s*년|\d{1,2}\s*월\s*\d{0,2}\s*일?\s*(출시|오픈|공개)/, "no release date has been announced"],
    [/사전예약/, "waitlist delivery is not verified"],
    [/자동으로\s*(버스를\s*)?(찾|선택|인식)/, "automatic selection is off"],
    [/\b(matcher|READY_FOR_\w+|APNs|ActivityKit|Redis|TAGO)\b/i, "internal term"],
    [/\d+(\.\d+)?\s*%/, "no percentages"],
  ];
  const texts = [
    ...STATUS_ITEMS.flatMap((i) => [i.title, i.body]),
    ...STATUS_GROUPS.flatMap((g) => [g.title, g.lede]),
  ];
  for (const text of texts) {
    for (const [pattern, reason] of banned) assert.doesNotMatch(text, pattern, `${reason}: ${text}`);
  }
});

test("the claims the page must keep: automatic selection off, no real ride, no push, no date", () => {
  const byId = (id: string) => {
    const found = STATUS_ITEMS.find((i) => i.id === id);
    assert.ok(found, id);
    return found;
  };
  assert.match(byId("vehicle-progress").body, /자동 선택은 꺼/);
  assert.match(byId("vehicle-progress").body, /실제 탑승/);
  assert.equal(byId("vehicle-progress").level, "verifying");
  assert.equal(byId("background-push").level, "blocked");
  assert.match(byId("background-push").body, /꺼져 있어요/);
  assert.match(byId("last-bus-passed-stop").body, /막차 시각이 없어/);
  assert.match(byId("release").body, /일정은 정해지지 않았어요/);
  assert.equal(byId("release").level, "blocked");
});

test("every item has evidence whose files exist", () => {
  assert.deepEqual(Object.keys(STATUS_EVIDENCE).sort(), STATUS_ITEMS.map((i) => i.id).sort());
  for (const item of STATUS_ITEMS) {
    const evidence = STATUS_EVIDENCE[item.id]!;
    assert.ok(evidence.code.length + evidence.tests.length > 0 || evidence.ops, `${item.id} has no evidence`);
    assert.ok(evidence.notChecked.length > 10, `${item.id} must say what is not checked`);
    for (const path of [...evidence.code, ...evidence.tests]) {
      assert.ok(existsSync(join(repo, path)), `${item.id}: missing ${path}`);
    }
    // A level above "built" needs an observation of the running service, not only code.
    if (item.level === "realdata") assert.ok(evidence.ops, `${item.id} is realdata without an ops observation`);
    if (item.id === "release" || item.id === "real-iphone" || item.id === "background-push") {
      assert.ok(evidence.ops, item.id);
    }
  }
});

test("the evidence map stays out of the shipped source", () => {
  assert.doesNotMatch(statusSource, /statusEvidence|STATUS_EVIDENCE/);
  const siteSource = readFileSync(join(repo, "apps", "web", "src", "content", "site.ts"), "utf8");
  assert.doesNotMatch(siteSource, /apps\/ios|services\/api|artifacts\//);
});

test("the section shows the new title, the three groups and one pill per item", () => {
  assert.match(statusSource, /TAPSO는 지금 이렇게 만들어지고 있어요/);
  assert.match(statusSource, /STATUS_GROUPS\.map/);
  assert.match(statusSource, /STATUS_ITEMS\.filter\(\(item\) => item\.group === group\.id\)/);
  assert.match(statusSource, /STATUS_LEVEL_LABELS\[item\.level\]/);
  assert.match(statusSource, /출시일은 정해지지 않았어요/);
  assert.match(statusSource, /‘구현됨’은 실제 iPhone 확인 전이라는 뜻/);
  assert.doesNotMatch(statusSource, /지금은 여기까지 만들었어요|Product V2/);
});
