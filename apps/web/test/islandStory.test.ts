/**
 * The Island Story Engine must tell the ride the way the app runs it. Product
 * rules are checked against the model every demo reads, and where the rule
 * lives in Swift, against the Swift source.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RIDE_MOMENTS, presentMoment, type RideMoment } from "../src/demo/rideMoments.ts";
import {
  BEATS,
  CHAPTERS,
  HERO_LOOP,
  islandOnPhone,
  milestoneToSignal,
  resolveBeat,
  type Activity,
  type Beat,
} from "../src/story/beats.ts";
import { CHAPTER_COPY, STEP_COPY, TRUST_NOTES } from "../src/story/journeyCopy.ts";
import { storyStore } from "../src/story/storyStore.ts";
import { FAQ_ITEMS } from "../src/content/site.ts";

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

/** Every state a beat can show: its default and each variant. */
function shownStates(beat: Beat): ReturnType<typeof resolveBeat>[] {
  return beat.variants ? beat.variants.map((v) => resolveBeat(beat, v.id)) : [resolveBeat(beat)];
}

const confirmedAt = BEATS.findIndex((b) => b.id === "confirmed");

test("the story starts with where to get off, and chapters never go back", () => {
  const first = BEATS[0]!;
  assert.equal(first.stage.kind, "app");
  assert.equal(first.stage.kind === "app" && first.stage.screen.kind, "search");
  const order = CHAPTERS.map((c) => c.id);
  for (let i = 1; i < BEATS.length; i++) {
    assert.ok(order.indexOf(BEATS[i]!.chapter) >= order.indexOf(BEATS[i - 1]!.chapter), BEATS[i]!.id);
  }
});

test("no Live Activity exists before the rider confirms the bus", () => {
  const proposed = BEATS.findIndex((b) => b.id === "proposed");
  assert.ok(proposed >= 0 && confirmedAt > proposed, "a proposal comes before the confirmation");
  for (const beat of BEATS.slice(0, confirmedAt)) {
    for (const { activity } of shownStates(beat)) assert.equal(activity, null, `${beat.id} shows an activity before confirmation`);
  }
  for (const beat of BEATS.slice(confirmedAt)) {
    for (const { activity } of shownStates(beat)) assert.notEqual(activity, null, `${beat.id} lost its activity`);
  }
});

test("the app starts the Live Activity only from the rider's confirmation (Swift)", () => {
  const model = readFileSync(repo("apps/ios/TapsoApp/TapsoAppModel.swift"), "utf8");
  const callers = new Set<string>();
  for (const call of model.matchAll(/await startLiveActivity\(\)/g)) {
    const before = model.slice(0, call.index);
    const fn = [...before.matchAll(/func (\w+)\(/g)].pop()?.[1];
    if (fn) callers.add(fn);
  }
  // The rider's tap on the sample ride or, on a live ride, the rider's tap
  // once the server has accepted it; a restored ride resumes the activity it
  // already had. Nothing else starts one.
  assert.deepEqual([...callers].sort(), ["confirmLiveVehicle", "confirmVehicle", "resumeIfNeeded"]);
  const live = model.slice(model.indexOf("func confirmLiveVehicle("));
  const body = live.slice(0, live.indexOf("\n    }\n"));
  assert.ok(body.indexOf("api.confirm(") >= 0 && body.indexOf("api.confirm(") < body.indexOf("await startLiveActivity()"),
    "a live ride's activity starts only after the server accepted the rider's confirmation");
});

test("the app in front never shows its own activity in the island", () => {
  for (const beat of BEATS) {
    for (const { stage, activity } of shownStates(beat)) {
      if (stage.kind === "app") assert.equal(islandOnPhone(stage, activity), null, beat.id);
      if (stage.kind === "home") assert.ok(islandOnPhone(stage, activity), `${beat.id}: home screen without island`);
    }
  }
});

test("stops only count down, to the exact escalation points", () => {
  let previous = Number.POSITIVE_INFINITY;
  const at = new Map<RideMoment, number[]>();
  for (const beat of BEATS) {
    for (const { activity } of shownStates(beat)) {
      if (!activity) continue;
      assert.ok(activity.remaining <= previous, `${beat.id}: ${activity.remaining} after ${previous}`);
      at.set(activity.moment, [...(at.get(activity.moment) ?? []), activity.remaining]);
    }
    for (const { activity } of shownStates(beat)) if (activity) previous = Math.min(previous, activity.remaining);
  }
  assert.deepEqual(at.get("prepare"), [2]);
  assert.deepEqual(at.get("nextStop"), [1]);
  assert.deepEqual(at.get("arrived"), [0]);
  for (const remaining of at.get("riding") ?? []) assert.ok(remaining >= 3, "riding is shown with three or more stops left");
});

test("each milestone is told once, and only milestones alert", () => {
  const milestones = new Map<RideMoment, number>();
  for (const beat of BEATS) {
    for (const { activity } of shownStates(beat)) {
      if (activity && presentMoment(activity.moment).milestone) {
        milestones.set(activity.moment, (milestones.get(activity.moment) ?? 0) + 1);
      }
    }
  }
  assert.deepEqual([...milestones.entries()].sort(), [["arrived", 1], ["nextStop", 1], ["prepare", 1]]);
});

test("shaky data never alerts, and the count is dimmed or hidden, never fresh", () => {
  const trust = BEATS.find((b) => b.id === "trust")!;
  const moments = shownStates(trust).map((s) => s.activity!.moment);
  assert.deepEqual(moments, ["delayed", "vehicleLost", "offline", "checking"]);
  for (const moment of moments) {
    const p = presentMoment(moment);
    assert.equal(p.milestone, false, moment);
    assert.notEqual(p.count, "live", moment);
    assert.ok(!(p.vehicle === "confirmed" && p.data === "live"), `${moment} must show what is uncertain`);
    assert.ok(TRUST_NOTES[moment], `${moment} needs its explanation`);
  }
});

test("the persistent island signals each milestone once, however the visitor scrolls", () => {
  const signalled = new Set<RideMoment>();
  const raised: RideMoment[] = [];
  const order = BEATS.map((b) => resolveBeat(b).activity);
  const scroll = [...order, ...[...order].reverse(), ...order];
  for (const activity of scroll) {
    const moment = milestoneToSignal(activity, signalled);
    if (moment) {
      signalled.add(moment);
      raised.push(moment);
    }
  }
  assert.deepEqual(raised, ["prepare", "nextStop", "arrived"]);
  assert.equal(milestoneToSignal(null, new Set()), null);
  for (const moment of RIDE_MOMENTS) {
    const activity: Activity = { moment, remaining: 3 };
    assert.equal(milestoneToSignal(activity, new Set()) !== null, presentMoment(moment).milestone, moment);
  }
});

test("the hero plays the escalation and nothing else", () => {
  assert.deepEqual(
    HERO_LOOP.map((a) => a.moment),
    ["riding", "prepare", "nextStop", "arrived"],
  );
  for (let i = 1; i < HERO_LOOP.length; i++) assert.ok(HERO_LOOP[i]!.remaining < HERO_LOOP[i - 1]!.remaining);
  assert.equal(HERO_LOOP.at(-1)!.remaining, 0);
});

test("a missing or unknown pick falls back to the beat's default", () => {
  const island = BEATS.find((b) => b.id === "island")!;
  assert.deepEqual(resolveBeat(island, "nope").stage, { kind: "home", form: "compact" });
  assert.deepEqual(resolveBeat(island, "expanded").stage, { kind: "home", form: "expanded" });
  const pocket = BEATS.find((b) => b.id === "pocket")!;
  assert.deepEqual(resolveBeat(pocket, "anything"), { stage: pocket.stage, activity: pocket.activity });
});

test("every beat and chapter has words", () => {
  assert.deepEqual(Object.keys(STEP_COPY).sort(), BEATS.map((b) => b.id).sort());
  for (const chapter of CHAPTERS) assert.ok(CHAPTER_COPY[chapter.id].title, chapter.id);
});

test("while the app has no push path, the page says the Lock Screen updates only with the app open", () => {
  const client = readFileSync(repo("apps/ios/TapsoApp/LiveActivityClient.swift"), "utf8");
  const pushPath = !/pushType:\s*nil/.test(client);
  if (pushPath) return; // The claim below must then be revisited with the push path's real status.
  assert.match(STEP_COPY.pocket.note ?? "", /앱이 켜져 있는 동안만/);
  const faq = FAQ_ITEMS.find((f) => f.q.includes("앱을 닫아도"));
  assert.ok(faq && /켜져 있을 때만/.test(faq.a), "the FAQ keeps the same honesty");
});

test("the story store follows position and picks without duplicating state", () => {
  storyStore.reset();
  let calls = 0;
  const unsubscribe = storyStore.subscribe(() => calls++);
  storyStore.setPosition("pocket");
  storyStore.setPosition("pocket");
  storyStore.setVariant("trust", "offline");
  storyStore.setVariant("trust", "offline");
  storyStore.setHeroInView(false);
  assert.equal(calls, 3, "repeated values do not notify");
  assert.equal(storyStore.get().position, "pocket");
  assert.equal(storyStore.get().variants.trust, "offline");
  unsubscribe();
  storyStore.reset();
});
