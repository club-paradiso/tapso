/**
 * The readiness the evidence has demonstrated, and what it permits.
 *
 * `DEMONSTRATED_MATCHING_READINESS` is not an opinion kept in an environment
 * variable. It is the level the release gate `matcher-passive-safety-v4`
 * awarded in `artifacts/matcher-passive-safety-v4/gate-result.json`, and
 * `test/matchingReadiness.test.ts` fails if the two ever differ. Raising it
 * therefore takes new evidence and a reviewed change, never a dashboard toggle.
 *
 * An operator can still set `TRANSIT_AUTOMATIC_MATCHING_ENABLED=true`, but the
 * configuration refuses it below `READY_FOR_BOUNDED_AUTOMATION` and says so in
 * `/health`: the flag reflects the demonstrated state instead of overriding it.
 */

import { GATE_POLICY_VERSION, readinessRank, type ReadinessLevel } from "./matcherSafetyGate.ts";

export const DEMONSTRATED_MATCHING_READINESS: ReadinessLevel = "READY_FOR_SHADOW";

/** Automatic selection needs at least this level. */
export const AUTOMATIC_MATCHING_MINIMUM_READINESS: ReadinessLevel = "READY_FOR_BOUNDED_AUTOMATION";

export const READINESS_GATE = GATE_POLICY_VERSION;

export const READINESS_EVIDENCE_PATH = "artifacts/matcher-passive-safety-v4/gate-result.json";

export function automaticMatchingPermitted(level: ReadinessLevel = DEMONSTRATED_MATCHING_READINESS): boolean {
  return readinessRank(level) >= readinessRank(AUTOMATIC_MATCHING_MINIMUM_READINESS);
}
