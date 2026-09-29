/**
 * The digest that binds live gate evidence to the code that produced it.
 *
 * sha256 over every module reachable, by relative import, from the modules
 * that decide and evaluate matches: the matcher, the passive pipeline, the
 * migration, the counterfactual suite, the live-evidence assembly and the
 * script that runs them over raw collections. Change any of them and evidence
 * recorded under the old digest no longer counts (`matcherSafetyGate.ts` reads
 * it as stale), so a matcher or evaluation change always needs a fresh live
 * replay before a readiness claim can rest on one.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const EVALUATION_ENTRY_MODULES = [
  "services/api/src/matching.ts",
  "services/api/src/passiveShadowPipeline.ts",
  "services/api/src/passiveShadowMigration.ts",
  "services/api/src/passiveCounterfactual.ts",
  "services/api/src/liveReplayEvidence.ts",
  "scripts/matcher-evidence/live-evidence.ts",
] as const;

export function matcherSourceDigest(repositoryRoot: string): { sha256: string; modules: string[] } {
  const seen = new Set<string>();
  const stack = EVALUATION_ENTRY_MODULES.map((module) => path.resolve(repositoryRoot, module));
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    if (!existsSync(current)) throw new Error(`evaluation module missing: ${path.relative(repositoryRoot, current)}`);
    seen.add(current);
    const source = readFileSync(current, "utf8");
    for (const match of source.matchAll(/(?:import|export)\s[^;]*?from\s+"(\.[^"]+)"/g)) {
      stack.push(path.resolve(path.dirname(current), match[1]!));
    }
  }
  const modules = [...seen].map((file) => path.relative(repositoryRoot, file).split(path.sep).join("/")).sort();
  const lines = modules.map((module) => `${module}:${createHash("sha256").update(readFileSync(path.resolve(repositoryRoot, module))).digest("hex")}`);
  return { sha256: createHash("sha256").update(lines.join("\n")).digest("hex"), modules };
}
