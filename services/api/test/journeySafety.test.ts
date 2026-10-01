/**
 * The Jeju safety layer against its language-neutral specifications. The Swift
 * core runs the same files in `JourneySafetyTests.swift`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RESCUE_POLICY,
  SAFE_RETURN_POLICY,
  TRANSFER_GUARDIAN_POLICY,
  assessTransfer,
  evaluateSafeReturn,
  planRescue,
  type RescueInput,
  type SafeReturnInput,
  type TransferInput,
} from "../src/journeySafety.ts";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const read = <T>(name: string) => JSON.parse(readFileSync(join(repo, "fixtures/journey", name), "utf8")) as T;

type Spec<I, E> = { policy: Record<string, number>; cases: Array<{ id: string; why: string; input: I; expect: E }> };

const safeReturn = read<Spec<SafeReturnInput, unknown>>("safe-return-v1.json");
const transfer = read<Spec<TransferInput, unknown>>("transfer-guardian-v1.json");
const rescue = read<Spec<RescueInput, unknown>>("rescue-v1.json");

test("each specification records the policy the implementation uses", () => {
  assert.deepEqual(safeReturn.policy, { ...SAFE_RETURN_POLICY });
  assert.deepEqual(transfer.policy, { ...TRANSFER_GUARDIAN_POLICY });
  assert.deepEqual(rescue.policy, { ...RESCUE_POLICY });
});

for (const specCase of safeReturn.cases) {
  test(`safe return ${specCase.id}: ${specCase.why}`, () => {
    assert.deepEqual(evaluateSafeReturn(specCase.input), specCase.expect);
  });
}

for (const specCase of transfer.cases) {
  test(`transfer guardian ${specCase.id}: ${specCase.why}`, () => {
    assert.deepEqual(assessTransfer(specCase.input), specCase.expect);
  });
}

for (const specCase of rescue.cases) {
  test(`rescue ${specCase.id}: ${specCase.why}`, () => {
    assert.deepEqual(planRescue(specCase.input), specCase.expect);
  });
}

/* Properties over generated inputs: the guarantees the cases only sample. */

function* lcg(seed: number): Generator<number> {
  let state = seed >>> 0;
  for (;;) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    yield state / 2 ** 32;
  }
}

test("safe return never calls a trip safe when no bus leaves after a useful visit", () => {
  const random = lcg(20261001);
  const next = () => random.next().value as number;
  for (let index = 0; index < 5_000; index += 1) {
    const arrival = Math.round(next() * 300);
    const minimumStay = 10 + Math.round(next() * 180);
    const walk = Math.round(next() * 20);
    const departures = Array.from({ length: Math.floor(next() * 8) }, () => Math.round(next() * 720));
    const status = evaluateSafeReturn({ arrival, minimumStay, walkToReturnStop: walk, departures, quality: "scheduled", disruption: next() < 0.2 });
    const catchableAfterVisit = departures.filter((departure) => departure - walk - SAFE_RETURN_POLICY.safetyMarginMinutes >= arrival + minimumStay);
    if (catchableAfterVisit.length === 0) {
      assert.equal(status.level, "notRecommended", JSON.stringify({ arrival, minimumStay, walk, departures, status }));
    } else {
      assert.notEqual(status.level, "notRecommended", JSON.stringify({ arrival, minimumStay, walk, departures, status }));
      assert.ok(status.leaveBy !== null && status.leaveBy >= arrival + minimumStay);
    }
    assert.notEqual(status.level, "unknown", "a complete scheduled list always gets an answer");
  }
});

test("transfer guardian is monotone: a later connection never raises the risk", () => {
  const rank = { missed: 0, atRisk: 1, tight: 2, safe: 3 } as const;
  const random = lcg(72);
  const next = () => random.next().value as number;
  for (let index = 0; index < 5_000; index += 1) {
    const feederMin = Math.round(next() * 30);
    const feeder = { min: feederMin, max: feederMin + Math.round(next() * 10) };
    const walk = Math.round(next() * 6);
    const connectionMin = Math.round(next() * 45);
    const connection = { min: connectionMin, max: connectionMin + Math.round(next() * 5) };
    const shift = 1 + Math.round(next() * 10);
    const before = assessTransfer({ feederArrival: feeder, walk, connection });
    const later = assessTransfer({ feederArrival: feeder, walk, connection: { min: connection.min + shift, max: connection.max + shift } });
    assert.ok(
      rank[later.risk as keyof typeof rank] >= rank[before.risk as keyof typeof rank],
      JSON.stringify({ feeder, walk, connection, shift, before: before.risk, later: later.risk }),
    );
    assert.ok(before.worstMargin! <= before.bestMargin!);
  }
});

test("rescue always ends with a map-app hand-off and never invents a walk it cannot measure", () => {
  for (const kind of ["passedDestination", "missedConnection", "wrongDirection"] as const) {
    for (const walkBackMeters of [null, 0, 500, 1_200, 1_201, 5_000]) {
      for (const oppositeDirection of [false, true]) {
        const plan = planRescue({ kind, nextStopName: "곽지", walkBackMeters, oppositeDirection, nextConnectionWaitMinutes: 20 });
        assert.equal(plan.options.at(-1)!.action, "openMapApp");
        const walk = plan.options.find((candidate) => candidate.action === "walkBack");
        if (kind !== "passedDestination" || walkBackMeters === null || walkBackMeters > RESCUE_POLICY.maxWalkBackMeters) {
          assert.equal(walk, undefined);
        }
      }
    }
  }
});
