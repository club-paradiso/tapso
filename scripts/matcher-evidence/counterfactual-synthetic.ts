/**
 * The counterfactual suite over its SYNTHETIC bases, summarised per family, as
 * committed evidence of what the matcher does in constructed worlds.
 *
 *   node --experimental-strip-types scripts/matcher-evidence/counterfactual-synthetic.ts \
 *     [--out=artifacts/matcher-directed-v1/counterfactual-synthetic-summary.json]
 *
 * Label: SIMULATED. The bases are the invented routes and vehicles of
 * `services/api/test/syntheticCounterfactualBases.ts` (the worlds the tests
 * assert on); nothing here is an observation, and nothing here can be release
 * gate evidence (`counterfactualGateEvidence` refuses synthetic bases). The
 * same code always writes the same file, so CI regenerates and compares it.
 * The run on real bases is `scripts/passive-shadow/counterfactual.ts`, which
 * needs the raw live streams.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { MATCHER_POLICY_VERSION } from "../../services/api/src/matching.ts";
import { counterfactualGateEvidence, runCounterfactuals, type CounterfactualReport } from "../../services/api/src/passiveCounterfactual.ts";
import { baseA, baseR } from "../../services/api/test/syntheticCounterfactualBases.ts";

const options = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key!, value.join("=")];
}));
const outPath = path.resolve(options.get("out") || "artifacts/matcher-directed-v1/counterfactual-synthetic-summary.json");

const bases = { A: baseA(), R: baseR() } as const;
const perBase = Object.fromEntries(Object.entries(bases).map(([name, stream]) => {
  const { report } = runCounterfactuals([stream]);
  return [name, summarise(report)];
}));

const summary = {
  schemaVersion: 1,
  evidenceClass: "SIMULATED",
  countsAsLiveEvidence: false,
  matcherPolicy: MATCHER_POLICY_VERSION,
  bases: {
    A: "SYNTHETIC: 30 stops, 10 s polls, three buses (services/api/test/syntheticCounterfactualBases.ts baseA)",
    R: "SYNTHETIC: 36 stops, seeded 20-40 s receipts like the cached public path, four buses at mixed paces (baseR)",
  },
  note: "Constructed worlds only. Per family: cases where the transformation applied, where its own expectations could be decided "
    + "(exercised), the outcome against the re-derived answer, and every expectation failure or invariant violation.",
  perBase,
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({
  out: path.relative(process.cwd(), outPath),
  ...Object.fromEntries(Object.entries(perBase).map(([name, base]) => [name, base.totals])),
}, null, 2));

function summarise(report: CounterfactualReport) {
  if (counterfactualGateEvidence(report) !== undefined) throw new Error("a synthetic base produced gate evidence");
  return {
    baseCases: report.baseCases.evaluated,
    families: report.families,
    familiesExercised: report.familiesExercised,
    totals: {
      applicable: report.totals.applicable,
      correct: report.totals.correct,
      wrong: report.totals.wrong,
      abstain: report.totals.abstain,
      groundTruthIndeterminate: report.totals.gtIndeterminate,
      invariantViolations: report.totals.invariantViolations,
      matcherInvariantErrors: report.totals.matcherInvariantErrors,
      expectationFailures: report.totals.expectationFailures,
      groundTruthShiftMismatches: report.totals.groundTruthShiftMismatches,
    },
    byCounterfactual: report.counterfactuals.map((row) => ({
      id: row.id,
      family: row.family,
      expectations: row.expectations,
      applicable: row.applicable,
      exercised: row.exercised,
      correct: row.correct,
      wrong: row.wrong,
      abstain: row.abstain,
      groundTruthIndeterminate: row.gtIndeterminate,
      invariantViolations: row.invariantViolations,
      expectationFailures: row.expectationFailures.count,
    })),
  };
}
