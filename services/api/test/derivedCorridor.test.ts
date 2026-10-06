import test from "node:test";
import assert from "node:assert/strict";
import { buildDerivedCorridor, pseudonymizeVehicle, type CorridorStop, type Traversal } from "../src/derivedCorridor.ts";

/**
 * SYNTHETIC traversals along a SYNTHETIC route. Nothing here is a recorded bus
 * or a real road; the corridor any test builds is not geometry for any route.
 */
const stops: CorridorStop[] = [1, 2, 3, 4].map((sequence) => ({ sequence, latitude: 33.5 + (sequence - 1) * 0.003, longitude: 126.5 }));
// A road that bows 40 m east of the stop chords between stops 2 and 3.
const road = (fraction: number) => ({
  latitude: 33.5 + fraction * 0.009,
  longitude: 126.5 + (fraction > 1 / 3 && fraction < 2 / 3 ? 0.00043 * Math.sin((fraction - 1 / 3) * 3 * Math.PI) : 0),
});

function traversal(index: number, options: { vehicle?: string; jitter?: number; reverse?: boolean; spike?: boolean } = {}): Traversal {
  const points = [];
  for (let step = 0; step <= 60; step += 1) {
    const fraction = (step + (index % 3) / 3) / 60.5;
    const at = road(Math.min(1, fraction));
    // Deterministic pseudo-noise, ±~5 m.
    const noise = ((index * 7 + step * 13) % 11 - 5) * (options.jitter ?? 0.00001);
    points.push({
      receivedAtMs: Date.UTC(2026, 9, 1 + (index % 5), 3) + step * 10_000,
      latitude: at.latitude + noise,
      longitude: at.longitude - noise,
      stopSequence: 1 + Math.min(3, Math.floor(fraction * 3)),
    });
  }
  if (options.spike) points[30] = { ...points[30]!, latitude: points[30]!.latitude + 0.02 };
  if (options.reverse) points.forEach((point, step) => { point.stopSequence = 4 - Math.min(3, Math.floor(step / 20)); });
  return { vehicleKey: options.vehicle ?? `veh-${index % 4}`, points };
}

test("one trip's trail is never a corridor", () => {
  const result = buildDerivedCorridor("SYN-1", stops, [traversal(0)]);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.status === "insufficient_evidence" && result.reason, "too_few_traversals");
});

test("many traversals by one vehicle are not independent enough", () => {
  const result = buildDerivedCorridor("SYN-1", stops, Array.from({ length: 20 }, (_, index) => traversal(index, { vehicle: "only-one" })));
  assert.equal(result.status === "insufficient_evidence" && result.reason, "too_few_distinct_vehicles");
});

test("enough independent traversals build a corridor that follows the road, not the chords, labelled derived", () => {
  const result = buildDerivedCorridor("SYN-1", stops, Array.from({ length: 16 }, (_, index) => traversal(index, { jitter: 0.00003 })));
  assert.equal(result.status, "built");
  if (result.status !== "built") return;
  const corridor = result.corridor;
  assert.equal(corridor.quality, "derivedVehicleTrace");
  assert.equal(corridor.label, "DERIVED_VEHICLE_TRACE");
  assert.notEqual(corridor.quality as string, "authoritative");
  assert.ok(corridor.provenance.coverage >= 0.9);
  assert.equal(corridor.provenance.distinctVehicles, 4);
  // Mid-route the corridor sits on the bowed road (~40 m east), not on the straight chord.
  const middle = corridor.points[Math.floor(corridor.points.length / 2)]!;
  assert.ok(middle.longitude - 126.5 > 0.0003, `corridor follows the road: ${middle.longitude}`);
});

test("a spike faster than a bus is rejected and does not move the corridor", () => {
  const clean = buildDerivedCorridor("SYN-1", stops, Array.from({ length: 16 }, (_, index) => traversal(index)));
  const spiked = buildDerivedCorridor("SYN-1", stops, Array.from({ length: 16 }, (_, index) => traversal(index, { spike: index === 3 })));
  assert.equal(clean.status, "built");
  assert.equal(spiked.status, "built");
  if (clean.status !== "built" || spiked.status !== "built") return;
  assert.ok(spiked.corridor.provenance.pointsRejected > clean.corridor.provenance.pointsRejected);
  // One fewer sample in a bin may shift its median by centimetres; the spike itself moves nothing.
  assert.equal(spiked.corridor.points.length, clean.corridor.points.length);
  spiked.corridor.points.forEach((point, index) => {
    const reference = clean.corridor.points[index]!;
    const metres = Math.hypot((point.latitude - reference.latitude) * 111_195, (point.longitude - reference.longitude) * 92_800);
    assert.ok(metres < 2, `bin ${index} moved ${metres.toFixed(2)} m`);
  });
});

test("a traversal whose stop sequence goes backward is dropped, not split", () => {
  const result = buildDerivedCorridor("SYN-1", stops, [
    ...Array.from({ length: 16 }, (_, index) => traversal(index)),
    traversal(99, { reverse: true }),
  ]);
  assert.equal(result.status, "built");
  if (result.status === "built") assert.equal(result.corridor.provenance.traversalsRejected, 1);
});

test("the corridor carries no vehicle key, plate or fine timestamp", () => {
  const result = buildDerivedCorridor("SYN-1", stops, Array.from({ length: 16 }, (_, index) => traversal(index, { vehicle: `secret-plate-${index % 4}` })));
  assert.equal(result.status, "built");
  const text = JSON.stringify(result);
  assert.ok(!text.includes("secret-plate"));
  assert.ok(!/T\d\d:\d\d/.test(text), "days only");
});

test("pseudonyms are keyed, stable and do not contain the plate", () => {
  const key = "synthetic-key-0123456789";
  assert.equal(pseudonymizeVehicle("제주70자1234", key), pseudonymizeVehicle("제주70자1234", key));
  assert.notEqual(pseudonymizeVehicle("제주70자1234", key), pseudonymizeVehicle("제주70자1234", `${key}x`));
  assert.ok(!pseudonymizeVehicle("제주70자1234", key).includes("1234"));
  assert.throws(() => pseudonymizeVehicle("x", "short"), RangeError);
});
