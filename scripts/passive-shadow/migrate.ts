/**
 * Old-versus-new matcher migration over one raw passive collection, offline.
 *
 *   node --experimental-strip-types scripts/passive-shadow/migrate.ts <collection-dir> \
 *     [--out-dir=artifacts/matcher-directed-v1] \
 *     [--expect-summary=artifacts/passive-shadow-validation-v3-summary.json] \
 *     [--expect-ledger=artifacts/passive-shadow-validation-v3-wrong-commits.json] \
 *     [--expect-raw-tree=<sha256 recorded in the evidence of record>]
 *
 * Replays every pseudo-boarding case of the collection under the legacy
 * symmetric policy and under the production directed policy, and writes:
 *
 *   <out-dir>/migration-summary.json   aggregates, every former wrong commit, blockers
 *   <out-dir>/migration-cases.json     one row per case, both policies (pseudonyms only)
 *
 * Guarantees, enforced rather than promised (shared with evaluate.ts):
 *   - no network: `fetch` and sockets throw; any attempt refuses the report;
 *   - raw evidence read-only: manifest + streams hashed before and after;
 *   - every stream matches its manifest checksum;
 *   - outputs are written outside the raw collection.
 *
 * Reproduction check: with --expect-summary / --expect-ledger (the evidence of
 * record), the legacy side must reproduce the recorded live bucket counts and
 * exactly the recorded wrong-commit case ids before any comparison is written.
 * A migration measured against a legacy replay that no longer matches the record
 * would compare against nothing.
 *
 * Exit codes: 0 clean; 3 input or reproduction refusal; 4 network attempt;
 * 5 blockers present (new wrong commit, correct→wrong regression, or an
 * invariant violation under the current policy). Outputs are still written on
 * 5 so the blockers can be read.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runMatcherMigration } from "../../services/api/src/passiveShadowMigration.ts";
import { assertOutsideRaw, installNetworkGuard, loadVerifiedCollection, rawTree } from "./rawCollection.ts";
import { reproductionCheck } from "./reproduction.ts";

const guard = installNetworkGuard("migrate.ts");

const [directoryArg, ...rest] = process.argv.slice(2);
const options = new Map(rest.map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key!, value.join("=")];
}));
if (!directoryArg) {
  console.error("Usage: migrate.ts <collection-dir> [--out-dir=<dir>] [--expect-summary=<path>] [--expect-ledger=<path>]");
  process.exit(2);
}
const directory = path.resolve(directoryArg);
const outDir = path.resolve(options.get("out-dir") || "artifacts/matcher-directed-v1");
try {
  assertOutsideRaw(directory, outDir, "--out-dir");
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
const expectedTree = options.get("expect-raw-tree");
if (expectedTree && expectedTree !== before.sha256) {
  // The tree hash covers manifest.json and every stream file, so a match here
  // is a match of every raw file recorded in the evidence of record.
  console.error(`raw tree ${before.sha256} is not the recorded ${expectedTree}; refusing`);
  process.exit(3);
}
const { manifest, streams, checks } = loaded;
const started = Date.now();
const migration = runMatcherMigration(streams);
const after = await rawTree(directory);
if (after.sha256 !== before.sha256) {
  console.error("raw collection changed during the migration; refusing to report");
  process.exit(3);
}
if (guard.attempts !== 0) {
  console.error(`${guard.attempts} network attempt(s) during the migration; refusing to report`);
  process.exit(4);
}

const reproduction = await reproductionCheck(migration, { summary: options.get("expect-summary"), ledger: options.get("expect-ledger") });
if (!reproduction.ok) {
  console.error(`legacy replay does not reproduce the evidence of record: ${reproduction.detail}`);
  process.exit(3);
}

const blockers = {
  newWrongCommits: migration.newWrongCommits.length,
  correctToWrongRegressions: migration.correctToWrongRegressions.length,
  currentInvariantViolations: migration.invariant.currentViolations,
  currentWrongCommits: migration.rows.filter((row) => row.current.outcome === "wrong").length,
};
const provenance = {
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
  rawTreeMatchesRecord: expectedTree ? expectedTree === before.sha256 : null,
  rawFiles: before.files,
  streamChecksums: checks.map(({ streamId, routeId, manifestSha256, recomputedSha256 }) => ({ streamId, routeId, manifestSha256, recomputedSha256 })),
  networkAttemptsDuringEvaluation: guard.attempts,
  rawUnchangedAfterEvaluation: true,
  reproduction,
};

const { rows, ...aggregate } = migration;
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "migration-summary.json"), `${JSON.stringify({ ...aggregate, blockers, provenance }, null, 2)}\n`);
await writeFile(path.join(outDir, "migration-cases.json"), `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`);

console.error(`migrated ${migration.cases} cases in ${Date.now() - started} ms; network attempts ${guard.attempts}; raw tree ${before.sha256} unchanged`);
console.log(JSON.stringify({ outDir: path.relative(process.cwd(), outDir), cases: migration.cases, named: migration.named, invariant: migration.invariant, blockers, reproduction }, null, 2));
if (Object.values(blockers).some((value) => value > 0)) process.exit(5);
