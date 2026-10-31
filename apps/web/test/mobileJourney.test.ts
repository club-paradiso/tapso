import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOBILE_STAGES, MOBILE_RIDE_VIEWS, mobileBeat } from "../src/story/mobileJourney.ts";
import { BEATS, resolveBeat, islandOnPhone } from "../src/story/beats.ts";

test("four mobile stages reuse canonical product beats without early activity", () => {
  assert.deepEqual(MOBILE_STAGES.map((s) => s.beatId), ["destination", "boarding", "proposed", "pocket"]);
  for (let index = 0; index < MOBILE_STAGES.length; index++) {
    const selected = mobileBeat(index);
    assert.strictEqual(selected, BEATS.find((b) => b.id === MOBILE_STAGES[index]!.beatId));
    if (index < 3) assert.equal(resolveBeat(selected).activity, null);
  }
  assert.match(MOBILE_STAGES[2]!.body, /직접 확인.*자동 선택은 꺼져/);
});

test("ride view cannot leak into earlier steps or invent states", () => {
  for (const view of MOBILE_RIDE_VIEWS) {
    for (const index of [0, 1, 2]) assert.equal(mobileBeat(index, view.beatId).id, MOBILE_STAGES[index]!.beatId);
    assert.strictEqual(mobileBeat(3, view.beatId), BEATS.find((b) => b.id === view.beatId));
  }
  assert.equal(mobileBeat(3, "trust").id, "pocket");
  assert.equal(resolveBeat(mobileBeat(3, "arrived")).activity?.remaining, 0);
  assert.equal(resolveBeat(mobileBeat(3, "prepare")).activity?.remaining, 2);
  assert.equal(mobileBeat(-1).id, "destination");
  const { stage, activity } = resolveBeat(mobileBeat(3, "island"));
  assert.ok(islandOnPhone(stage, activity));
});

test("no-JS and anchor disclosure fallbacks remain in the shipped page", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const walkthrough = read("../src/components/MobileWalkthrough.tsx");
  const details = read("../src/components/ResponsiveDetails.tsx");
  assert.match(walkthrough, /<noscript>/);
  assert.match(walkthrough, /실제 iPhone·버스 테스트와 앱을 닫은 뒤의 안내 검증은 남아/);
  assert.match(walkthrough, /aria-pressed=\{current === index\}/);
  assert.match(details, /ancestor instanceof HTMLDetailsElement/);
  assert.match(details, /ancestor.open = true/);
  assert.match(details, /addEventListener\("hashchange"/);
  assert.doesNotMatch(details, /preventDefault|pushState|replaceState/);
  const status = read("../src/sections/Status.tsx");
  assert.match(status, /STATUS_ITEMS\.filter\(\(item\) => item.level === level\)\.length/);
});
