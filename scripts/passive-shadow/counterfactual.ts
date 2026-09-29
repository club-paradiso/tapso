/**
 * Counterfactual suite over one raw passive collection, offline.
 *
 *   node --experimental-strip-types scripts/passive-shadow/counterfactual.ts <collection-dir> \
 *     [--out=work/evidence/counterfactual-summary.json] \
 *     [--gate-evidence=<path>] [--max-cases-per-scenario=<n>] [--fail-on-findings]
 *
 * Generates every pseudo-boarding case of the collection, applies every
 * counterfactual in `services/api/src/passiveCounterfactual.ts` to each, replays
 * the production directed matcher blind on the transformed window, re-derives
 * the answer of the transformed world with the first-arrival model, and writes
 * one sanitized JSON report (pseudonyms and SYNTHETIC-CF ids only) to --out.
 *
 * What the report is and is not: every result in it is SYNTHETIC_OR_PERTURBED.
 * A counterfactual of a live case is labelled COUNTERFACTUAL_OF_LIVE_PASSIVE;
 * it is never a live observation, never an independent ride, and never a live
 * count.
 *
 * Guarantees, enforced rather than promised (shared with migrate.ts):
 *   - no network: `fetch` and sockets throw; any attempt refuses the report;
 *   - raw evidence read-only: manifest + streams hashed before and after;
 *   - every stream matches its manifest checksum;
 *   - outputs are written outside the raw collection;
 *   - the written report is checked for every raw vehicle id before it is written.
 *
 * --gate-evidence writes the `counterfactualsOnLiveBases` input of release gate
 * `matcher-passive-safety-v4` (criterion CA-5). It is refused (exit 3) unless
 * every base case came from a LIVE_PASSIVE stream, the production matcher was
 * replayed, and no case cap was applied. The summary always carries the same
 * object under `gateEvidence`, or `null` with the reason.
 *
 * Runtime is dominated by the canonical replay: roughly 1 ms per evaluation at
 * the 30 s cadence of the public path, 8 ms at 5 s direct polling.
 *
 * Exit codes: 0 report written; 2 usage; 3 input refusal (checksum, provider
 * path, gate-evidence refusal, raw tree changed); 4 network attempt; 5 findings
 * present (expectation failure, wrong commit against the re-derived answer, or
 * invariant violation), only with --fail-on-findings. The report is written
 * before exit 5, so findings can always be read.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { counterfactualGateEvidence, runCounterfactuals } from "../../services/api/src/passiveCounterfactual.ts";
import { assertNoRawVehicleIds, vehiclePseudonyms } from "../../services/api/src/passiveShadowSummary.ts";
import { assertOutsideRaw, installNetworkGuard, loadVerifiedCollection, rawTree } from "./rawCollection.ts";

const guard = installNetworkGuard("counterfactual.ts");

const [directoryArg, ...rest] = process.argv.slice(2);
const options = new Map(rest.map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key!, value.join("=")];
}));
const usage = "Usage: counterfactual.ts <collection-dir> [--out=<file>] [--gate-evidence=<file>] [--max-cases-per-scenario=<n>] [--fail-on-findings]";
if (!directoryArg) {
  console.error(usage);
  process.exit(2);
}
const capArg = options.get("max-cases-per-scenario");
const cap = capArg === undefined || capArg === "" ? undefined : Number(capArg);
if (cap !== undefined && (!Number.isInteger(cap) || cap < 1)) {
  console.error(`--max-cases-per-scenario must be a positive integer\n${usage}`);
  process.exit(2);
}

const directory = path.resolve(directoryArg);
const outPath = path.resolve(options.get("out") || "work/evidence/counterfactual-summary.json");
const gatePath = options.get("gate-evidence") ? path.resolve(options.get("gate-evidence")!) : undefined;
try {
  assertOutsideRaw(directory, outPath, "--out");
  if (gatePath) assertOutsideRaw(directory, gatePath, "--gate-evidence");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(3);
}

let before: Awaited<ReturnType<typeof rawTree>>;
let loaded: Awaited<ReturnType<typeof loadVerifiedCollection>>;
try {
  before = await rawTree(directory);
  loaded = await loadVerifiedCollection(directory);
} catch (error) {
  console.error(`refusing the collection: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}
const { manifest, streams, checks } = loaded;

const started = Date.now();
const { report } = runCounterfactuals(streams, { ...(cap === undefined ? {} : { maxCasesPerScenario: cap }) });
const elapsedMs = Date.now() - started;

const after = await rawTree(directory);
if (after.sha256 !== before.sha256) {
  console.error("raw collection changed during the counterfactual run; refusing to report");
  process.exit(3);
}
if (guard.attempts !== 0) {
  console.error(`${guard.attempts} network attempt(s) during the counterfactual run; refusing to report`);
  process.exit(4);
}

const gateEvidence = counterfactualGateEvidence(report);
const gateEvidenceRefusal = gateEvidence ? null : gateRefusal();
// Gate evidence first: CI prints only the head of this file.
const output = {
  gateEvidence: gateEvidence ?? null,
  gateEvidenceRefusal,
  ...report,
  provenance: {
    collectionId: manifest.collectionId,
    providerPath: manifest.providerPath,
    requestedProviderPath: manifest.requestedProviderPath ?? manifest.providerPath,
    collectionProviderCalls: manifest.providerCalls,
    collectionFailedCalls: manifest.failedCalls,
    collectionStopReason: manifest.stopReason,
    collectionRunId: process.env.COLLECTION_RUN_ID || null,
    evaluatedAtCommit: process.env.GITHUB_SHA || null,
    evaluationRunId: process.env.GITHUB_RUN_ID || null,
    rawTreeSha256: before.sha256,
    rawFiles: before.files,
    streamChecksums: checks.map(({ streamId, routeId, manifestSha256, recomputedSha256 }) => ({ streamId, routeId, manifestSha256, recomputedSha256 })),
    networkAttemptsDuringEvaluation: guard.attempts,
    rawUnchangedAfterEvaluation: true,
    maxCasesPerScenario: cap ?? null,
  },
};
// The report is already checked inside runCounterfactuals; the provenance is
// checked here, with the rest, before anything touches the disk.
assertNoRawVehicleIds(output, vehiclePseudonyms(streams).allVehicleIds);

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);

const findings = {
  expectationFailures: report.totals.expectationFailures,
  wrongAgainstRederivedTruth: report.totals.wrong,
  invariantViolations: report.totals.invariantViolations,
  groundTruthShiftMismatches: report.totals.groundTruthShiftMismatches,
};
console.error(`counterfactuals: ${report.baseCases.evaluated} base cases, ${report.totals.applicable} evaluations in ${elapsedMs} ms; `
  + `network attempts ${guard.attempts}; raw tree ${before.sha256} unchanged`);
console.log(JSON.stringify({
  out: path.relative(process.cwd(), outPath),
  sourceClass: report.sourceClass,
  evidenceLabels: report.evidenceLabels,
  matcherPolicy: report.matcherPolicy,
  baseCases: report.baseCases,
  families: report.families,
  totals: report.totals,
  failing: report.counterfactuals
    .filter((row) => row.expectationFailures.count > 0 || row.wrong > 0 || row.invariantViolations > 0)
    .map((row) => ({ id: row.id, expectationFailures: row.expectationFailures.byExpectation, wrong: row.wrong, invariantViolations: row.invariantViolations })),
  gateEvidence: gateEvidence ?? null,
  gateEvidenceRefusal,
}, null, 2));

if (gatePath) {
  if (!gateEvidence) {
    console.error(`--gate-evidence refused: ${gateEvidenceRefusal}`);
    process.exit(3);
  }
  await mkdir(path.dirname(gatePath), { recursive: true });
  await writeFile(gatePath, `${JSON.stringify({ ...gateEvidence, rawTreeSha256: before.sha256, collectionId: manifest.collectionId }, null, 2)}\n`);
}
if (options.has("fail-on-findings") && Object.values(findings).some((value) => value > 0)) process.exit(5);

function gateRefusal(): string {
  const classes = Object.keys(report.baseSourceClasses);
  if (classes.length === 0) return "no base case was evaluated";
  if (classes.some((sourceClass) => sourceClass !== "LIVE_PASSIVE")) {
    return `base cases are ${classes.join(", ")}; gate evidence needs every base to be LIVE_PASSIVE`;
  }
  if (report.baseCases.capped) return "a case cap was applied; gate evidence needs every base case";
  return `matcher policy ${report.matcherPolicy} is not the production policy`;
}
