import test from "node:test";
import assert from "node:assert/strict";

import type { VehicleObservation } from "../src/domain.ts";
import { classifyTagoCadenceFreshness } from "../src/sourceFreshness.ts";

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
