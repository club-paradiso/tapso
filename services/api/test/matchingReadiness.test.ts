import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { readTransitApiConfig } from "../src/apiConfig.ts";
import { READINESS_LEVELS, type GateResult } from "../src/matcherSafetyGate.ts";
import {
  AUTOMATIC_MATCHING_MINIMUM_READINESS,
  automaticMatchingPermitted,
  DEMONSTRATED_MATCHING_READINESS,
  READINESS_EVIDENCE_PATH,
  READINESS_GATE,
} from "../src/matchingReadiness.ts";

const REPOSITORY_ROOT = new URL("../../../", import.meta.url);

test("the readiness the code claims is the readiness the committed gate result awards", () => {
  const resultUrl = new URL(READINESS_EVIDENCE_PATH, REPOSITORY_ROOT);
  assert.ok(existsSync(resultUrl), `${READINESS_EVIDENCE_PATH} must be committed`);
  const result = JSON.parse(readFileSync(resultUrl, "utf8")) as GateResult;
  assert.equal(result.policyVersion, READINESS_GATE);
  assert.equal(
    DEMONSTRATED_MATCHING_READINESS,
    result.awarded,
    "raising DEMONSTRATED_MATCHING_READINESS takes new evidence and a regenerated gate result, never an edit alone",
  );
});

test("automatic selection is permitted from bounded automation upward and nowhere below", () => {
  assert.equal(AUTOMATIC_MATCHING_MINIMUM_READINESS, "READY_FOR_BOUNDED_AUTOMATION");
  assert.deepEqual(
    READINESS_LEVELS.map((level) => [level, automaticMatchingPermitted(level)]),
    [
      ["NOT_READY", false],
      ["READY_FOR_SHADOW", false],
      ["READY_FOR_CONFIRMATION_ASSISTED", false],
      ["READY_FOR_BOUNDED_AUTOMATION", true],
      ["READY_FOR_AUTOMATIC_MATCHING", true],
    ],
  );
});

test("the configuration applies the demonstrated readiness, whatever the environment says", () => {
  const config = readTransitApiConfig({ TRANSIT_AUTOMATIC_MATCHING_ENABLED: "true" }, { nodeVersion: "v22.0.0" });
  assert.equal(config.matching.readiness.demonstrated, DEMONSTRATED_MATCHING_READINESS);
  assert.equal(config.matching.automaticMatchingEnabled, automaticMatchingPermitted());
});

test("readiness is a reviewed constant, not configuration", () => {
  const source = readFileSync(new URL("../src/matchingReadiness.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|import\.meta\.env|Deno\.env/);
  const config = readFileSync(new URL("../src/apiConfig.ts", import.meta.url), "utf8");
  assert.doesNotMatch(config, /env,\s*"[A-Z_]*READINESS[A-Z_]*"/);
});
