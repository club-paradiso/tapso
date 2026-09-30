/**
 * Evaluate release gate `matcher-passive-safety-v4` from machine-produced
 * evidence files, offline.
 *
 *   node --experimental-strip-types scripts/matcher-evidence/gate.ts \
 *     [--suite=artifacts/matcher-directed-v1/test-suite.json] \
 *     [--negative-controls=artifacts/matcher-directed-v1/negative-controls.json] \
 *     [--instants=artifacts/matcher-directed-v1/former-wrong-commit-instants.json] \
 *     [--live-replay=artifacts/matcher-directed-v1/live-replay-evidence.json] \
 *     [--counterfactual-live=artifacts/matcher-directed-v1/counterfactual-live-evidence.json] \
 *     [--mitigations=ops/matcher-evidence/human-only-mitigations.json] \
 *     [--out=artifacts/matcher-passive-safety-v4/gate-result.json] [--check] [--fail-below-claim]
 *
 * Every input is optional: an absent file makes the criteria that read it
 * `MISSING`, and `MISSING` is never a pass. Nothing here is inferred. The two
 * live inputs are written by `live-evidence.ts` from retained raw collections.
 *
 * `--check` recomputes the result and exits 1 if it differs from the committed
 * `--out` file (ignoring `generatedAt`), or if the level the code claims in
 * `DEMONSTRATED_MATCHING_READINESS` is not the level the gate awards. CI runs
 * it that way, so neither the evidence nor the claim can drift unnoticed.
 *
 * `--fail-below-claim` writes the result and then exits 1 if it awards less
 * than the code claims: the scheduled evidence job runs it that way, so fresh
 * live evidence that no longer supports the claim turns the run red.
 *
 * Live and counterfactual evidence count only when they carry the digest of
 * the current matcher and evaluation sources (`sourceDigest.ts`); CI cannot
 * recompute them, because the raw collections are private, so the digest and
 * the per-collection raw tree hashes are what tie them to their inputs.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { readTransitApiConfig, type ServerEnv } from "../../services/api/src/apiConfig.ts";
import { MATCHER_POLICY_VERSION } from "../../services/api/src/matching.ts";
import {
  evaluateGate,
  MITIGATION_CRITERIA,
  mitigationEvidenceHolds,
  readinessRank,
  type GateEvidence,
  type MitigationEntry,
  type MitigationKey,
} from "../../services/api/src/matcherSafetyGate.ts";
import { automaticMatchingPermitted, DEMONSTRATED_MATCHING_READINESS } from "../../services/api/src/matchingReadiness.ts";
import { matcherSourceDigest } from "./sourceDigest.ts";

const options = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key!, value.join("=") || "true"];
}));
const file = (key: string, fallback: string) => path.resolve(options.get(key) || fallback);
const readJson = <T>(target: string): T | undefined => (existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) as T : undefined);

const suite = readJson<{
  passed: boolean;
  propertySeedsPerInvariant: number;
  propertyRegressionSeeds: number;
  propertyInvariantsCovered: number;
  passingTests?: string[];
}>(file("suite", "artifacts/matcher-directed-v1/test-suite.json"));
const controls = readJson<{
  summary: { total: number; killed: number; survived: number; stale: number; invalid: number; timeout: number; complete: boolean; baselineGreen: boolean };
  source: { realTreeUnchanged: boolean };
  mutations?: Array<{ id: string; outcome: string }>;
}>(file("negative-controls", "artifacts/matcher-directed-v1/negative-controls.json"));
const instants = readJson<{ totals: { records: number; legacyReproducedRecordedSelection: number; currentPolicyStatus: Record<string, number> } }>(
  file("instants", "artifacts/matcher-directed-v1/former-wrong-commit-instants.json"));
const liveReplay = readJson<NonNullable<GateEvidence["liveReplay"]>>(file("live-replay", "artifacts/matcher-directed-v1/live-replay-evidence.json"));
const counterfactualLive = readJson<NonNullable<GateEvidence["counterfactualsOnLiveBases"]>>(
  file("counterfactual-live", "artifacts/matcher-directed-v1/counterfactual-live-evidence.json"));
const MITIGATION_KEYS = Object.keys(MITIGATION_CRITERIA) as MitigationKey[];
const mitigations = readJson<{ mitigations: Record<MitigationKey, MitigationEntry> }>(file("mitigations", "ops/matcher-evidence/human-only-mitigations.json"));
if (!mitigations || MITIGATION_KEYS.some((key) => mitigations.mitigations?.[key] === undefined)) {
  console.error("every human-only mitigation must be declared; refusing to guess them");
  process.exit(3);
}

const evidence: GateEvidence = {
  generatedAt: new Date().toISOString(),
  matcher: {
    policyVersion: MATCHER_POLICY_VERSION,
    legacyFreeServingPaths: legacyFreeServingPaths(),
    runtimeInvariantEnforced: /assertDirectedInvariant\(request, result, policy\);\s*return result;/.test(
      readFileSync(path.resolve("services/api/src/matching.ts"), "utf8")),
  },
  ...(suite ? {
    tests: {
      suitePassed: suite.passed,
      propertySeedsPerInvariant: suite.propertySeedsPerInvariant,
      propertyRegressionSeedsReplayed: suite.propertyRegressionSeeds,
      propertyInvariantsCovered: suite.propertyInvariantsCovered,
    },
  } : {}),
  ...(controls ? {
    negativeControls: {
      total: controls.summary.total,
      killed: controls.summary.killed,
      survived: controls.summary.survived,
      stale: controls.summary.stale,
      invalid: controls.summary.invalid ?? 0,
      timeout: controls.summary.timeout ?? 0,
      complete: controls.summary.complete === true,
      baselineGreen: controls.summary.baselineGreen === true,
      realTreeUnchanged: controls.source?.realTreeUnchanged === true,
      killedIds: (controls.mutations ?? []).filter((row) => row.outcome === "KILLED").map((row) => row.id),
    },
  } : {}),
  ...(instants ? {
    formerWrongCommitInstants: {
      records: instants.totals.records,
      legacyReproduced: instants.totals.legacyReproducedRecordedSelection,
      currentCommits: instants.totals.currentPolicyStatus.matched ?? 0,
    },
  } : {}),
  ...(liveReplay ? { liveReplay } : {}),
  ...(counterfactualLive ? { counterfactualsOnLiveBases: counterfactualLive } : {}),
  currentMatcherSourceSha256: matcherSourceDigest(process.cwd()).sha256,
  deploymentPosture: {
    // The configuration itself, evaluated: off by default on every platform,
    // and an operator's opt-in refused at the demonstrated readiness. A live
    // /health read would upgrade this to VERIFIED_LIVE_INFRASTRUCTURE; this
    // session could not make one (see the ExecPlan).
    automaticMatchingOffEverywhere: automaticMatchingCannotBeOn(),
    checkedBy: "config_default",
  },
  humanOnlyMitigations: Object.fromEntries(MITIGATION_KEYS.map((key) => [key, mitigationHolds(key, mitigations.mitigations[key])])) as GateEvidence["humanOnlyMitigations"],
};

const result = evaluateGate(evidence);
const outPath = file("out", "artifacts/matcher-passive-safety-v4/gate-result.json");

if (options.get("check") === "true") {
  const committed = readJson<typeof result>(outPath);
  const strip = (value: unknown) => JSON.stringify({ ...(value as Record<string, unknown>), generatedAt: undefined });
  const problems: string[] = [];
  if (!committed) problems.push(`${path.relative(process.cwd(), outPath)} is missing`);
  else if (strip(committed) !== strip(result)) problems.push("the committed gate result no longer matches the evidence");
  if (result.awarded !== DEMONSTRATED_MATCHING_READINESS) {
    problems.push(`code claims ${DEMONSTRATED_MATCHING_READINESS} but the gate awards ${result.awarded}`);
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(JSON.stringify({ awarded: result.awarded, nextLevel: result.nextLevel }, null, 2));
    process.exit(1);
  }
  console.log(`gate ${result.policyVersion}: ${result.awarded} (matches the committed result and the code's claim)`);
} else {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), awarded: result.awarded, nextLevel: result.nextLevel }, null, 2));
  if (options.get("fail-below-claim") === "true" && readinessRank(result.awarded) < readinessRank(DEMONSTRATED_MATCHING_READINESS)) {
    console.error(`the evidence now awards ${result.awarded}, below the ${DEMONSTRATED_MATCHING_READINESS} the code claims`);
    process.exit(1);
  }
}

/**
 * No module reachable from a serving entry point imports the legacy matcher.
 * Serving entry points: the Vercel functions under services/api/api and the two
 * Node servers. Evaluation-only modules (migration, counterfactuals) may import
 * it, because nothing that serves a rider reaches them.
 */
function legacyFreeServingPaths(): boolean {
  const root = path.resolve("services/api");
  const entries = [
    ...listTs(path.join(root, "api")),
    path.join(root, "src/server.ts"),
    path.join(root, "src/backgroundServer.ts"),
  ];
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current) || !existsSync(current)) continue;
    seen.add(current);
    const source = readFileSync(current, "utf8");
    for (const match of source.matchAll(/(?:import|export)\s[^;]*?from\s+"(\.[^"]+)"/g)) {
      stack.push(path.resolve(path.dirname(current), match[1]!));
    }
  }
  return ![...seen].some((module) => module.endsWith(`${path.sep}matchingLegacy.ts`));
}

function listTs(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? listTs(full) : name.endsWith(".ts") ? [full] : [];
  });
}

/**
 * Runs the real configuration reader: with no flag on every platform, and with
 * the flag set on every platform. Below the readiness automatic selection
 * needs, neither may turn it on.
 */
function automaticMatchingCannotBeOn(): boolean {
  const platforms: ServerEnv[] = [{}, { VERCEL: "1", VERCEL_ENV: "preview" }, { VERCEL: "1", VERCEL_ENV: "production" }];
  const nodeVersion = "v22.0.0";
  const offByDefault = platforms.every((env) => !readTransitApiConfig(env, { nodeVersion }).matching.automaticMatchingEnabled);
  const optInRefused = automaticMatchingPermitted() || platforms.every((env) =>
    !readTransitApiConfig({ ...env, TRANSIT_AUTOMATIC_MATCHING_ENABLED: "true" }, { nodeVersion }).matching.automaticMatchingEnabled);
  return offByDefault && optInRefused;
}

/**
 * A declared mitigation counts only when its evidence checks out
 * (`mitigationEvidenceHolds`): tests named for its criterion that passed in
 * this suite run, or a committed human record for it under
 * `artifacts/human-evidence/`. A bare `met: true` is a claim, and a claim is
 * not evidence.
 */
function mitigationHolds(key: MitigationKey, entry: MitigationEntry): boolean {
  const humanEvidence = path.resolve("artifacts/human-evidence") + path.sep;
  const verdict = mitigationEvidenceHolds(key, entry, {
    passingTests: suite?.passingTests ?? [],
    readRecord: (record) => {
      const target = path.resolve(record);
      return target.startsWith(humanEvidence) ? readJson<unknown>(target) : undefined;
    },
  });
  if (entry.met === true && !verdict.holds) console.error(`mitigation ${key} is declared met but not counted: ${verdict.reason}`);
  return verdict.holds;
}
