import test from "node:test";
import assert from "node:assert/strict";

import type { VehicleObservation } from "../src/domain.ts";
import { appendCadenceObservation, classifyTagoCadenceFreshness, recentlySeenVehicles } from "../src/sourceFreshness.ts";

/**
 * Synthetic test fixtures, not observations: every provider response below is
 * constructed by the test, and nothing here is evidence that a bus was seen.
 * Values that look real (public TAGO route and stop ids, stop names and
 * coordinates, and vehicle numbers carried over from earlier fixtures) are
 * used only as inputs.
 */

const routeId = "JEB405136521";
const vehicleId = "BUS-A";
const base = Date.parse("2026-09-22T03:00:00.000Z");

function obs(seconds: number, stopSequence = 10, latitude = 33.5): VehicleObservation {
  return {
    vehicleId,
    routeId,
    observedAt: new Date(0).toISOString(),
    receivedAt: new Date(base + seconds * 1_000).toISOString(),
    timestampSource: "unavailable",
    stopSequence,
    latitude,
    longitude: 126.5,
  };
}

test("cadence freshness requires repeated server-observed samples", () => {
  const now = new Date(base + 5_000);
  const result = classifyTagoCadenceFreshness([obs(0), obs(5)], now);
  assert.equal(result.state, "unknown");
  assert.equal(result.sampleCount, 2);
});

test("cadence freshness becomes fresh only after provider content changes", () => {
  const now = new Date(base + 15_000);
  const result = classifyTagoCadenceFreshness([
    obs(0, 10, 33.5000),
    obs(5, 10, 33.5000),
    obs(10, 10, 33.5004),
    obs(15, 11, 33.5010),
  ], now);
  assert.equal(result.state, "fresh");
  assert.equal(result.contentChangeCount, 2);
  assert.equal(result.sequenceDecreaseCount, 0);
});

test("unchanged candidate remains aging rather than being declared fresh from receipt time alone", () => {
  const now = new Date(base + 20_000);
  const result = classifyTagoCadenceFreshness([obs(0), obs(10), obs(20)], now);
  assert.equal(result.state, "aging");
  assert.equal(result.contentChangeCount, 0);
});

test("large collection gaps fail closed", () => {
  const now = new Date(base + 50_000);
  const result = classifyTagoCadenceFreshness([
    obs(0, 10),
    obs(5, 10, 33.5004),
    obs(50, 11, 33.5010),
  ], now);
  assert.equal(result.state, "stale");
  assert.match(result.reason, /gap/i);
});

test("backward provider stop sequence fails closed", () => {
  const now = new Date(base + 15_000);
  const result = classifyTagoCadenceFreshness([
    obs(0, 10),
    obs(5, 11, 33.501),
    obs(10, 9, 33.502),
    obs(15, 10, 33.503),
  ], now);
  assert.equal(result.state, "stale");
  assert.equal(result.sequenceDecreaseCount, 1);
});

test("old last receipt fails closed even with historical movement", () => {
  const now = new Date(base + 60_000);
  const result = classifyTagoCadenceFreshness([
    obs(0, 10),
    obs(5, 10, 33.5004),
    obs(10, 11, 33.5010),
  ], now);
  assert.equal(result.state, "stale");
  assert.ok((result.latestReceiptAgeSeconds ?? 0) > 30);
});

/* Receipt order. Every fixture here is synthetic. */

function accumulate(rows: VehicleObservation[], nowSeconds: number): VehicleObservation[] {
  let history: VehicleObservation[] = [];
  for (const row of rows) history = appendCadenceObservation(history, row, new Date(base + nowSeconds * 1_000));
  return history;
}

test("a late, older receipt is not recorded and cannot manufacture a content change", () => {
  // A frozen feed: the same row at 0, 10 and 20 s. Then an older receipt with
  // different content arrives late (another instance, a skewed clock).
  const frozen = [obs(0), obs(10), obs(20)];
  const late = obs(5, 10, 33.5009);
  const history = accumulate([...frozen, late], 20);
  assert.equal(history.length, 3, "the late receipt is dropped");
  const result = classifyTagoCadenceFreshness(history, new Date(base + 20_000));
  assert.equal(result.state, "aging");
  assert.equal(result.contentChangeCount, 0);
});

test("a second row for the same vehicle in one snapshot is neither a sample nor a content change", () => {
  // Two receipts, one of them duplicated at another position. Counting the
  // duplicate would reach three samples and one content change from two polls.
  const history = accumulate([obs(0), obs(0, 14, 33.6), obs(12)], 12);
  assert.equal(history.length, 2);
  const result = classifyTagoCadenceFreshness(history, new Date(base + 12_000));
  assert.equal(result.state, "unknown");
  assert.equal(result.sampleCount, 2);
});

test("remembered vehicles are the latest receipt of each, because history only moves forward", () => {
  const history = accumulate([obs(0, 9), obs(10, 10), obs(4, 3)], 10);
  const remembered = recentlySeenVehicles(new Map([[vehicleId, history]]), [], new Date(base + 20_000));
  assert.equal(remembered.length, 1);
  assert.equal(remembered[0]!.stopSequence, 10);
});
