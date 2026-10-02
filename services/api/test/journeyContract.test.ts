/**
 * The Journey Contract's TypeScript implementation against the language-neutral
 * specification. The Swift core runs the same file in
 * `packages/transit-core/Tests/TapsoTransitTests/JourneyContractTests.swift`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  JOURNEY_CONTRACT_VERSION,
  NEXT_ACTIONS,
  PRE_RIDE_STAGES,
  RIDE_MOMENTS,
  SAFE_RETURN_LEVELS,
  SEGMENT_KINDS,
  SURFACE_STATES,
  TRANSFER_RISKS,
  resolveSurface,
  validateJourneySegments,
  type JourneySegmentSpec,
  type SurfaceInput,
} from "../src/journeyContract.ts";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const spec = JSON.parse(readFileSync(join(repo, "fixtures/journey/journey-contract-v1.json"), "utf8")) as {
  schemaVersion: string;
  vocabulary: Record<string, string[]>;
  contractCases: Array<{ id: string; why: string; segments: JourneySegmentSpec[]; expect: Record<string, unknown> }>;
  surfaceCases: Array<{ id: string; why: string; input: SurfaceInput; expect: { state: string; action: string } }>;
};

test("the specification names the contract version the server implements", () => {
  assert.equal(spec.schemaVersion, JOURNEY_CONTRACT_VERSION);
});

test("the vocabulary is the same list, in the same order, on both sides", () => {
  assert.deepEqual(spec.vocabulary.segmentKinds, [...SEGMENT_KINDS]);
  assert.deepEqual(spec.vocabulary.preRideStages, [...PRE_RIDE_STAGES]);
  assert.deepEqual(spec.vocabulary.rideMoments, [...RIDE_MOMENTS]);
  assert.deepEqual(spec.vocabulary.transferRisks, [...TRANSFER_RISKS]);
  assert.deepEqual(spec.vocabulary.safeReturnLevels, [...SAFE_RETURN_LEVELS]);
  assert.deepEqual(spec.vocabulary.surfaceStates, [...SURFACE_STATES]);
  assert.deepEqual(spec.vocabulary.nextActions, [...NEXT_ACTIONS]);
});

for (const contractCase of spec.contractCases) {
  test(`contract ${contractCase.id}: ${contractCase.why}`, () => {
    assert.deepEqual(validateJourneySegments(contractCase.segments), contractCase.expect);
  });
}

for (const surfaceCase of spec.surfaceCases) {
  test(`surface ${surfaceCase.id}: ${surfaceCase.why}`, () => {
    assert.deepEqual(resolveSurface(surfaceCase.input), surfaceCase.expect);
  });
}

test("every surface state and next action the specification lists is reachable by some case", () => {
  const states = new Set(spec.surfaceCases.map((surfaceCase) => surfaceCase.expect.state));
  const actions = new Set(spec.surfaceCases.map((surfaceCase) => surfaceCase.expect.action));
  assert.deepEqual([...SURFACE_STATES].filter((state) => !states.has(state)), []);
  assert.deepEqual([...NEXT_ACTIONS].filter((action) => !actions.has(action)), []);
});

test("resolution is total and fails closed: no input combination escapes the vocabulary or alerts on late data", () => {
  const optional = <T>(values: readonly T[]): Array<T | undefined> => [undefined, ...values];
  const milestones = new Set(["prepare", "nextStop", "arrival"]);
  let combinations = 0;
  for (const segment of SEGMENT_KINDS) {
    for (const finalLeg of [false, true]) {
      for (const preRide of optional(PRE_RIDE_STAGES)) {
        for (const rideMoment of optional(RIDE_MOMENTS)) {
          for (const transferRisk of optional(TRANSFER_RISKS)) {
            for (const recoveryActive of [false, true]) {
              for (const discoveryHint of [false, true]) {
                const input: SurfaceInput = { segment, finalLeg, preRide, rideMoment, transferRisk, recoveryActive, discoveryHint };
                const resolved = resolveSurface(input);
                combinations += 1;
                assert.ok((SURFACE_STATES as readonly string[]).includes(resolved.state), JSON.stringify(input));
                assert.ok((NEXT_ACTIONS as readonly string[]).includes(resolved.action), JSON.stringify(input));
                if (segment === "ride" && rideMoment && ["delayed", "offline", "vehicleLost", "checking"].includes(rideMoment) && !recoveryActive) {
                  assert.ok(!milestones.has(resolved.state), `late or uncertain data produced ${resolved.state}: ${JSON.stringify(input)}`);
                }
                if (resolved.state === "discovery") {
                  assert.equal(finalLeg, true, "discovery is never offered while a connection is planned");
                  assert.equal(rideMoment, "riding");
                }
              }
            }
          }
        }
      }
    }
  }
  assert.equal(combinations, 3 * 2 * 7 * 11 * 7 * 2 * 2);
});
