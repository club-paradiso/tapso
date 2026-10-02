/**
 * The page's demos must teach the product as it is: the synthetic trip is the
 * app's own, a bus past the boarding stop is never offered, and two plausible
 * buses become a question. The ride itself is pinned in islandStory.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BUS_SCENES, BUS_VIEWS } from "../src/demo/busScene.ts";
import { DEMO_ROUTE, DEMO_TRIP, TRIP_TOTAL_STOPS, positionFor, railProgress } from "../src/demo/rideStory.ts";

test("the marketing trip uses the verified full-length Route 365 direction", () => {
  assert.equal(DEMO_ROUTE.sourceRouteId, "JEB405136522");
  assert.equal(DEMO_ROUTE.stops.length, 41);
  assert.equal(DEMO_ROUTE.stops[DEMO_TRIP.boardingIndex], "제주국제공항3(용담,시청)[북]");
  assert.equal(DEMO_ROUTE.stops[DEMO_TRIP.destinationIndex], "제주시청(아라방면)");
  assert.deepEqual(
    DEMO_ROUTE.stops.slice(DEMO_TRIP.boardingIndex, DEMO_TRIP.destinationIndex + 1),
    [
      "제주국제공항3(용담,시청)[북]",
      "월성마을/선사유적지",
      "용문마을회관[동]",
      "용문마을[동]",
      "용문사거리[동]",
      "용담1동주민센터[남]",
      "제주중학교/제주향교",
      "서문시장[남]",
      "관덕정[남]",
      "중앙로 제민신협본점[서]",
      "시민회관[서]",
      "삼성초등학교",
      "광양[서]",
      "제주시청(아라방면)",
    ],
  );
  assert.equal(TRIP_TOTAL_STOPS, 13);
  assert.equal(positionFor(6).current, "서문시장[남]");
  assert.equal(positionFor(2).next, "광양[서]");
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
