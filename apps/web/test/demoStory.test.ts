/**
 * The page's demos must teach the product as it is: destination first, the
 * rider confirms the bus, no silent guess, escalation at two / one / zero, and
 * degraded data never alerting.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BUS_SCENES, BUS_VIEWS } from "../src/demo/busScene.ts";
import { DEMO_ROUTE, DEMO_TRIP, RIDE_STORY, TRIP_TOTAL_STOPS, clampStep, positionFor, railProgress } from "../src/demo/rideStory.ts";
import { TRUST_STATES } from "../src/demo/trustStates.ts";

test("the ride story runs plan → confirm → ride, destination first", () => {
  const chapters = RIDE_STORY.map((s) => s.chapter);
  const order = ["plan", "confirm", "ride"];
  for (let i = 1; i < chapters.length; i++) {
    assert.ok(order.indexOf(chapters[i]!) >= order.indexOf(chapters[i - 1]!), "chapters never go back");
  }
  assert.equal(RIDE_STORY[0]!.screen.kind, "search", "the first question is where to get off");
});

test("no ride step comes before the rider confirms the bus", () => {
  const proposed = RIDE_STORY.findIndex((s) => s.screen.kind === "check" && s.screen.stage === "proposed");
  const confirmed = RIDE_STORY.findIndex((s) => s.screen.kind === "check" && s.screen.stage === "confirmed");
  const firstRide = RIDE_STORY.findIndex((s) => s.screen.kind === "ride");
  assert.ok(proposed >= 0 && confirmed > proposed, "a proposal is confirmed, never skipped");
  assert.ok(firstRide > confirmed, "the ride starts only after confirmation");
});

test("ride steps count down to the exact escalation points", () => {
  const ride = RIDE_STORY.flatMap((s) => (s.screen.kind === "ride" ? [s.screen] : []));
  for (let i = 1; i < ride.length; i++) assert.ok(ride[i]!.remaining < ride[i - 1]!.remaining);
  const at = Object.fromEntries(ride.map((r) => [r.moment, r.remaining]));
  assert.equal(at.prepare, 2);
  assert.equal(at.nextStop, 1);
  assert.equal(at.arrived, 0);
  assert.ok((at.riding ?? 0) >= 3, "riding is shown only with three or more stops left");
});

test("step navigation clamps at both ends", () => {
  assert.equal(clampStep(-1), 0);
  assert.equal(clampStep(RIDE_STORY.length + 3), RIDE_STORY.length - 1);
});

test("the synthetic trip uses the app's demo route", () => {
  assert.equal(DEMO_ROUTE.stops[DEMO_TRIP.boardingIndex], "제주버스터미널");
  assert.equal(DEMO_ROUTE.stops[DEMO_TRIP.destinationIndex], "제주시청(아라방면)");
  assert.equal(TRIP_TOTAL_STOPS, 8);
  assert.equal(positionFor(1).next, "제주시청(아라방면)");
  assert.equal(positionFor(0).next, undefined);
  assert.equal(railProgress(TRIP_TOTAL_STOPS), 0);
  assert.equal(railProgress(0), 1);
});

test("a bus already past the boarding stop is never offered", () => {
  for (const view of BUS_VIEWS) {
    for (const bus of BUS_SCENES[view].buses) {
      if (bus.stopsAway < 0) assert.notEqual(bus.role, "proposed", `${view}: passed bus proposed`);
    }
  }
});

test("two plausible buses become a question, never a pick", () => {
  const similar = BUS_SCENES.similar;
  assert.equal(similar.asksRider, true);
  assert.equal(similar.buses.filter((b) => b.role === "proposed").length, 0);
  assert.ok(similar.buses.filter((b) => b.role === "choice").length >= 2);
  assert.ok(BUS_SCENES.tapso.buses.filter((b) => b.role === "proposed").length <= 1);
  assert.ok(BUS_SCENES.routeOnly.buses.every((b) => b.role === "unknown"));
});

test("only a confirmed bus on live data may lead to get-off alerts", () => {
  for (const state of TRUST_STATES) {
    const healthy = state.vehicle === "confirmed" && state.data === "live";
    assert.equal(state.alertsAllowed, healthy, `${state.id}`);
  }
  assert.equal(TRUST_STATES.filter((s) => s.alertsAllowed).length, 1);
});

test("degraded states show the count as last known or not at all", () => {
  const byId = Object.fromEntries(TRUST_STATES.map((s) => [s.id, s]));
  assert.equal(byId.delayed?.count, "lastKnown");
  assert.equal(byId.vehicleLost?.count, "lastKnown");
  assert.equal(byId.offline?.count, "lastKnown");
  assert.equal(byId.checking?.count, "hidden");
});
