/**
 * Live Activity push, milestone 4: what the server would push and when. The
 * payloads are the server's own generated session views (SYNTHETIC route and
 * buses); the Swift side of the same port runs on the same fixture.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { StopOnRoute } from "../src/domain.ts";
import type { JourneySessionView } from "../src/journeySession.ts";
import {
  LIVE_ACTIVITY_REFRESH_INTERVAL_MS,
  LIVE_ACTIVITY_STALE_INTERVAL_MS,
  MILESTONE_ALERTS,
  liveActivityContentState,
  planLiveActivityEnd,
  planLiveActivityPush,
} from "../src/liveActivityContent.ts";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const views = new Map((JSON.parse(readFileSync(`${repo}/fixtures/journey/session-views-v1.json`, "utf8")) as {
  scenarios: Array<{ id: string; view: JourneySessionView }>;
}).scenarios.map(({ id, view }) => [id, view]));
const view = (id: string) => structuredClone(views.get(id)!);
const stops: StopOnRoute[] = Array.from({ length: 12 }, (_, index) => ({ stopId: `SYN-STOP-${index + 1}`, name: `합성 정류장 ${index + 1}`, sequence: index + 1 }));

test("the committed Live Activity signals are what the server's port computes today", () => {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/journey/live-activity-signals.ts", "--check"], { cwd: repo, encoding: "utf8" });
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
});

test("milestone alerts use the app's own words", () => {
  const strings = new Map([...readFileSync(`${repo}/apps/ios/Resources/ko.lproj/Localizable.strings`, "utf8").matchAll(/^"([^"]+)" = "([^"]*)";$/gm)].map((match) => [match[1]!, match[2]!]));
  for (const [milestone, alert] of Object.entries(MILESTONE_ALERTS)) {
    assert.equal(alert.title, strings.get(`ride.${milestone}.headline`), milestone);
    assert.equal(alert.body, strings.get(`ride.${milestone}.detail`), milestone);
  }
});

test("a session without a rider-confirmed bus is never pushed", () => {
  for (const id of ["awaiting-departed-only", "confirmation-one", "rider-identifies-at-shadow"]) {
    assert.deepEqual(planLiveActivityPush(view(id), stops, undefined), { send: false, reason: "no_confirmed_bus" }, id);
  }
});

test("content names the stop the bus was placed at and the next one toward the destination", () => {
  const riding = view("tracking-riding");
  const at = Date.parse(riding.progress!.evidenceAt ?? riding.updatedAt);
  const state = liveActivityContentState(riding, stops, at);
  assert.equal(state.currentStopName, "합성 정류장 5");
  assert.equal(state.nextStopName, "합성 정류장 6");
  assert.equal(state.remainingStops, 5);
  assert.equal(state.freshness, "fresh");

  const passed = liveActivityContentState(view("passed-destination"), stops, at);
  assert.equal(passed.destinationPassed, true);
  assert.equal(passed.nextStopName, "합성 정류장 8", "past the destination, the stop to get off at");
});

test("each milestone alerts once per ride; quiet changes go at low priority; old content never goes", () => {
  const first = planLiveActivityPush(view("tracking-riding"), stops, undefined);
  assert.ok(first.send);
  assert.equal(first.push.alert, undefined);
  assert.equal(first.push.staleDateMs, first.push.timestampMs + LIVE_ACTIVITY_STALE_INTERVAL_MS);

  const prepare = planLiveActivityPush(view("tracking-prepare"), stops, first.next);
  assert.ok(prepare.send);
  assert.deepEqual(prepare.push.alert, MILESTONE_ALERTS.prepare);
  assert.deepEqual(prepare.next.alerted, ["prepare"]);

  // The same moment again, newer: no second alert.
  const again = view("tracking-prepare");
  again.progress!.evidenceAt = new Date(Date.parse(again.progress!.evidenceAt!) + LIVE_ACTIVITY_REFRESH_INTERVAL_MS).toISOString();
  const repeat = planLiveActivityPush(again, stops, prepare.next);
  assert.ok(repeat.send, "a minute on, unchanged content is pushed to move its stale date");
  assert.equal(repeat.push.alert, undefined);

  // Older or equal evidence is never pushed.
  assert.deepEqual(planLiveActivityPush(view("tracking-riding"), stops, prepare.next), { send: false, reason: "not_newer" });

  const arrived = planLiveActivityPush(view("arrived"), stops, prepare.next);
  assert.ok(arrived.send);
  assert.deepEqual(arrived.push.alert, MILESTONE_ALERTS.arrived);
  assert.equal(arrived.push.staleDateMs, undefined, "arrival does not go stale");
});

test("unchanged content within the refresh interval is not pushed again", () => {
  const first = planLiveActivityPush(view("tracking-riding"), stops, undefined);
  assert.ok(first.send);
  const soon = view("tracking-riding");
  soon.progress!.evidenceAt = new Date(Date.parse(soon.progress!.evidenceAt!) + 10_000).toISOString();
  assert.deepEqual(planLiveActivityPush(soon, stops, first.next), { send: false, reason: "unchanged" });
});

test("late or missing data is pushed as such, never as a milestone", () => {
  const tracked = planLiveActivityPush(view("tracking-next-stop"), stops, undefined);
  assert.ok(tracked.send);
  for (const id of ["degraded-provider-timeout", "degraded-missing", "lost", "confirmed-cadence-unknown"]) {
    const late = view(id);
    late.updatedAt = new Date(Date.parse(late.updatedAt) + 10 * 60_000).toISOString();
    if (late.progress?.evidenceAt) late.progress.evidenceAt = late.updatedAt;
    const plan = planLiveActivityPush(late, stops, tracked.next);
    assert.ok(plan.send, id);
    assert.equal(plan.push.alert, undefined, id);
    assert.notEqual(plan.push.contentState.freshness, "fresh", id);
  }
});

test("the end push reads as ended, comes after anything pushed, and leaves within a minute", () => {
  const first = planLiveActivityPush(view("arrived"), stops, undefined);
  assert.ok(first.send);
  const end = planLiveActivityEnd({ boardingStop: stops[3]!, lastProgressStopName: "합성 정류장 10" }, first.next, first.next.lastTimestampMs - 5_000);
  assert.equal(end.event, "end");
  assert.equal(end.contentState.phase, "completed");
  assert.ok(end.timestampMs > first.next.lastTimestampMs);
  assert.equal(end.dismissalDateMs! - end.timestampMs, 60_000);
});
