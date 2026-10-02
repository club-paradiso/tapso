/**
 * Decision-by-decision traces of the counterfactual cases a matcher gets
 * wrong, over one raw passive collection, offline.
 *
 *   node --experimental-strip-types scripts/matcher-evidence/trace-counterfactual.ts <collection-dir> \
 *     --counterfactual=follower_overtaking [--limit=5] [--window-s=900]
 *
 * The release gate counts failures; this explains them. For every case where
 * the named counterfactual fails an expectation, it replays the transformed
 * window blind exactly as the suite does and prints each decision of the
 * session with the vehicles in it named by role only: TRUTH (the re-derived
 * first arrival), COMMITTED, INJECTED, BASE_TRUTH, or OTHER-n. Positions are
 * stop offsets from the boarding stop (negative = before it), times are
 * seconds from the first commit. No vehicle number, raw or pseudonymous, is
 * printed: the output is checked against every raw id before it is written.
 *
 * Guarantees shared with counterfactual.ts: no network, raw evidence hashed
 * before and after and left unchanged, every stream checked against its
 * manifest. Everything it prints is SYNTHETIC_OR_PERTURBED analysis of a
 * COUNTERFACTUAL_OF_LIVE_PASSIVE world, never a live observation.
 */

import path from "node:path";

import type { PassiveCase } from "../../services/api/src/passiveShadow.ts";
import { generatePassiveCases, toBlindCapture } from "../../services/api/src/passiveShadow.ts";
import { blindLabels } from "../../services/api/src/passiveShadowEvaluate.ts";
import { assertNoRawVehicleIds, vehiclePseudonyms } from "../../services/api/src/passiveShadowSummary.ts";
import {
  COUNTERFACTUALS,
  counterfactualContext,
  evaluateCounterfactual,
  rederiveGroundTruth,
} from "../../services/api/src/passiveCounterfactual.ts";
import { replayMatching, type ReplayDecision } from "../../services/api/src/matchReplay.ts";
import { installNetworkGuard, loadVerifiedCollection, rawTree } from "../passive-shadow/rawCollection.ts";

const guard = installNetworkGuard("trace-counterfactual.ts");

const [directoryArg, ...rest] = process.argv.slice(2);
const options = new Map(rest.map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key!, value.join("=")];
}));
const counterfactualId = options.get("counterfactual");
const limit = Number(options.get("limit") || "5");
const windowSeconds = Number(options.get("window-s") || "900");
if (!directoryArg || !counterfactualId || !Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowSeconds)) {
  console.error("Usage: trace-counterfactual.ts <collection-dir> --counterfactual=<id> [--limit=5] [--window-s=900]");
  process.exit(2);
}
const counterfactual = COUNTERFACTUALS.find((item) => item.id === counterfactualId);
if (!counterfactual) {
  console.error(`unknown counterfactual ${counterfactualId}; known: ${COUNTERFACTUALS.map((item) => item.id).join(", ")}`);
  process.exit(2);
}

const directory = path.resolve(directoryArg);
const before = await rawTree(directory);
const { streams } = await loadVerifiedCollection(directory);
const { allVehicleIds } = vehiclePseudonyms(streams);
const generated = generatePassiveCases(streams);
const snapshotsByStream = new Map(streams.map((stream) => [
  stream.streamId,
  [...stream.snapshots].sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt)),
]));

type Trace = Record<string, unknown>;
const traces: Trace[] = [];
let applicable = 0;
let failing = 0;

for (const passiveCase of generated.cases as PassiveCase[]) {
  if (!counterfactual.scenarios.includes(passiveCase.meta.scenario)) continue;
  const truth = generated.vault.reveal(passiveCase.meta.caseId);
  const context = counterfactualContext(passiveCase, truth, snapshotsByStream.get(passiveCase.meta.streamId) ?? []);
  const application = counterfactual.apply(passiveCase, context);
  if (!application) continue;
  applicable += 1;
  const evaluation = evaluateCounterfactual(passiveCase, context, counterfactual, application);
  if (evaluation.expectationFailures.length === 0) continue;
  failing += 1;
  if (traces.length >= limit) continue;

  const input = application.input;
  const labels = blindLabels(input);
  const riderState = passiveCase.meta.scenario === "ON_BOARD_START" ? "on_board" as const : "waiting_at_stop" as const;
  const evidence = replayMatching(toBlindCapture(input), { labels, recordDecisions: true, riderState });
  const rederived = rederiveGroundTruth(passiveCase.meta, application);
  const byLabel = new Map([...labels].map(([vehicleId, label]) => [label, vehicleId]));
  const injected = new Set(application.injected);
  const others = new Map<string, string>();
  const role = (vehicleId: string | undefined): string => {
    if (vehicleId === undefined) return "UNKNOWN";
    const roles: string[] = [];
    if (rederived.status === "QUALIFIED" && rederived.truth.vehicleId === vehicleId) roles.push("TRUTH");
    if (evaluation.committedVehicleId === vehicleId) roles.push("COMMITTED");
    if (injected.has(vehicleId)) roles.push("INJECTED");
    if (context.truth.vehicleId === vehicleId) roles.push("BASE_TRUTH");
    if (roles.length > 0) return roles.join("+");
    if (!others.has(vehicleId)) others.set(vehicleId, `OTHER-${others.size + 1}`);
    return others.get(vehicleId)!;
  };
  const commitMs = evaluation.commitAt ? Date.parse(evaluation.commitAt) : undefined;
  const boarding = passiveCase.meta.boardingSequence;
  const decisions = (evidence.decisions ?? []) as ReplayDecision[];
  const timeline = decisions
    .filter((decision) => commitMs === undefined || Math.abs(Date.parse(decision.at) - commitMs) <= windowSeconds * 1_000)
    .map((decision) => ({
      t: commitMs === undefined ? null : Math.round((Date.parse(decision.at) - commitMs) / 100) / 10,
      status: decision.status,
      selected: decision.selectedLabel ? role(byLabel.get(decision.selectedLabel)) : undefined,
      abstain: decision.abstentionReasons,
      remembered: decision.rememberedVehicles,
      buses: decision.candidates.map((candidate) => ({
        role: role(byLabel.get(candidate.label)),
        offset: candidate.stopSequence === undefined ? null : candidate.stopSequence - boarding,
        zone: candidate.zone,
        cadence: candidate.cadence,
        rejected: candidate.rejectedReasons,
      })),
    }));
  traces.push({
    caseId: passiveCase.meta.caseId.replace(/^pv3-[^-]+-[^-]+-/, ""),
    scenario: passiveCase.meta.scenario,
    expectationFailures: evaluation.expectationFailures,
    outcome: evaluation.outcome,
    committed: role(evaluation.committedVehicleId),
    committedStopOffset: evaluation.committedStopOffset,
    truthArrivesSecondsAfterCommit: rederived.status === "QUALIFIED" && commitMs !== undefined
      ? Math.round((Date.parse(rederived.truth.provenance.crossingNextAt) - commitMs) / 1_000)
      : null,
    sessionStartSecondsBeforeCommit: commitMs === undefined ? null : Math.round((commitMs - application.sessionStartAt) / 1_000),
    timeline,
  });
}

const after = await rawTree(directory);
if (after.sha256 !== before.sha256) {
  console.error("raw collection changed during the trace; refusing to report");
  process.exit(3);
}
if (guard.attempts !== 0) {
  console.error(`${guard.attempts} network attempt(s) during the trace; refusing to report`);
  process.exit(4);
}
const output = { counterfactual: counterfactual.id, applicable, failing, traced: traces.length, traces };
assertNoRawVehicleIds(output, allVehicleIds);
console.log(JSON.stringify(output));
