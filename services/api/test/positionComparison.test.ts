import test from "node:test";
import assert from "node:assert/strict";
import { compareSnapshots, compareTransitions, falseEarlyArrival } from "../src/positionComparison.ts";

/** SYNTHETIC series. No ride, announcement or oracle reading is represented. */

test("an early transition is counted separately from a late one", () => {
  const reference = [{ sequence: 5, atMs: 100_000 }, { sequence: 6, atMs: 160_000 }, { sequence: 7, atMs: 220_000 }];
  const displayed = [{ sequence: 5, atMs: 90_000 }, { sequence: 6, atMs: 185_000 }, { sequence: 7, atMs: 221_000 }];
  const result = compareTransitions(displayed, reference);
  assert.equal(result.early, 1);
  assert.equal(result.late, 1);
  assert.equal(result.onTime, 1);
  assert.equal(result.latencyMs.min, -10_000);
  assert.equal(result.latencyMs.max, 25_000);
});

test("a reference transition TAPSO never showed is missed; a display beyond the reference is a phantom", () => {
  const reference = [{ sequence: 5, atMs: 0 }, { sequence: 6, atMs: 60_000 }];
  const displayed = [{ sequence: 5, atMs: 2_000 }, { sequence: 7, atMs: 70_000 }];
  const result = compareTransitions(displayed, reference);
  assert.equal(result.missed, 1);
  assert.equal(result.phantom, 1);
});

test("the first display of a sequence counts, not a later repeat", () => {
  const result = compareTransitions([{ sequence: 5, atMs: 50_000 }, { sequence: 5, atMs: 120_000 }], [{ sequence: 5, atMs: 100_000 }]);
  assert.equal(result.early, 1);
});

test("snapshot error histogram separates ahead (dangerous) from behind", () => {
  const result = compareSnapshots([
    { displayedSequence: 5, referenceSequence: 5 },
    { displayedSequence: 6, referenceSequence: 5 },
    { displayedSequence: 4, referenceSequence: 5 },
    { displayedSequence: 3, referenceSequence: 5 },
    { displayedSequence: null, referenceSequence: 5 },
  ]);
  assert.deepEqual(result.errorHistogram, { "0": 1, "1": 1, "-1": 1, "-2": 1 });
  assert.equal(result.ahead, 1);
  assert.equal(result.behind, 2);
  assert.equal(result.comparable, 4);
  assert.equal(result.meanAbsoluteError, 1);
});

test("false early arrival", () => {
  assert.equal(falseEarlyArrival(null, 100_000), false);
  assert.equal(falseEarlyArrival(100_000, 100_000), false);
  assert.equal(falseEarlyArrival(97_000, 100_000), false, "inside tolerance");
  assert.equal(falseEarlyArrival(80_000, 100_000), true);
  assert.equal(falseEarlyArrival(80_000, null), true, "shown arrived, never reached");
});
