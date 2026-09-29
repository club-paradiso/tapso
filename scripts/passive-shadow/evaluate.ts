/**
 * Passive Shadow Validation v3 — offline blind replay of a collection.
 *
 *   node --experimental-strip-types scripts/passive-shadow/evaluate.ts <collection-dir> \
 *     [--summary=artifacts/passive-shadow-validation-v3-summary.json] \
 *     [--wrong-ledger=<path>] [--sensitive-out=<dir>] [--max-perturbation-cases=300]
 *
 * Reads the streams a collector wrote, verifies each against the manifest's
 * sha256, and runs the v3 pipeline under the current code. Two guarantees are
 * enforced here rather than promised:
 *
 *   - No network. `fetch` and every outbound socket are replaced before the
 *     pipeline runs; any attempt aborts the evaluation. The attempt count is
 *     printed and written into the summary's provenance.
 *   - Raw evidence is read-only. The collection's raw files (`manifest.json`,
 *     `streams/*.json`) are hashed before and after; a difference aborts. All
 *     outputs go outside the raw collection directory.
 *
 * Outputs:
 *   - the sanitized summary (pseudonyms only) to --summary,
 *   - the sanitized wrong-commit ledger (every live wrong commit) to
 *     --wrong-ledger (default: next to the summary),
 *   - the sensitive bundle (ground-truth vault, per-case results with raw
 *     vehicle numbers) to --sensitive-out (default `<collection-dir>.evaluation/`),
 *     which must stay in ignored `work/` storage.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { streamSha256, validatePassiveStream, type PassiveObservationStream } from "../../services/api/src/passiveShadow.ts";
import { runPassiveShadowPipeline } from "../../services/api/src/passiveShadowPipeline.ts";
import { assertOutsideRaw, installNetworkGuard } from "./rawCollection.ts";

/* ------------------------------------------------------- offline guard */

const guard = installNetworkGuard("evaluate.ts");

/* -------------------------------------------------------------- inputs */

const [directoryArg, ...rest] = process.argv.slice(2);
const options = new Map(rest.map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key!, value.join("=")];
}));
if (!directoryArg) {
  console.error("Usage: evaluate.ts <collection-dir> [--summary=<path>] [--sensitive-out=<dir>] [--max-perturbation-cases=300]");
  process.exit(2);
}
const directory = path.resolve(directoryArg);
const sensitive = path.resolve(options.get("sensitive-out") || `${directory}.evaluation`);
const summaryPath = path.resolve(options.get("summary") || path.join(sensitive, "summary.json"));
const ledgerPath = path.resolve(options.get("wrong-ledger") || path.join(path.dirname(summaryPath), "passive-shadow-validation-v3-wrong-commits.json"));
// Every output, checked before anything runs: none may land in the raw evidence.
assertOutsideRaw(directory, sensitive, "--sensitive-out");
assertOutsideRaw(directory, summaryPath, "--summary");
assertOutsideRaw(directory, ledgerPath, "--wrong-ledger");
const maxPerturbationCases = Number(options.get("max-perturbation-cases") || 300);
if (!Number.isInteger(maxPerturbationCases) || maxPerturbationCases < 0) {
  console.error("--max-perturbation-cases must be a non-negative integer");
  process.exit(2);
}

const before = await rawTree(directory);
const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as {
  collectionId: string;
  providerPath: string;
  requestedProviderPath?: string;
  providerCalls: number;
  failedCalls: number;
  stopReason: string;
  streams: Array<{ streamId: string; sha256: string }>;
};
const expected = new Map(manifest.streams.map((entry) => [entry.streamId, entry.sha256]));

const streams: PassiveObservationStream[] = [];
const checks: Array<{ streamId: string; routeId: string; providerPath: string; manifestSha256: string; recomputedSha256: string }> = [];
for (const file of (await readdir(path.join(directory, "streams"))).filter((name) => name.endsWith(".json")).sort()) {
  const stream = JSON.parse(await readFile(path.join(directory, "streams", file), "utf8")) as PassiveObservationStream;
  validatePassiveStream(stream);
  const recomputed = streamSha256(stream);
  const recorded = expected.get(stream.streamId);
  checks.push({ streamId: stream.streamId, routeId: stream.routeId, providerPath: stream.providerPath, manifestSha256: recorded ?? "MISSING", recomputedSha256: recomputed });
  if (recorded !== recomputed) {
    throw new Error(`stream ${stream.streamId} does not match its manifest checksum; refusing to evaluate`);
  }
  if (stream.providerPath !== manifest.providerPath) {
    throw new Error(`stream ${stream.streamId} was collected via ${stream.providerPath} but the manifest says ${manifest.providerPath}`);
  }
  streams.push(stream);
}
if (streams.length !== manifest.streams.length) {
  throw new Error(`manifest lists ${manifest.streams.length} streams but ${streams.length} were found`);
}

/* ---------------------------------------------------------- evaluation */

const started = Date.now();
const output = runPassiveShadowPipeline(streams, { maxPerturbationCases });

const after = await rawTree(directory);
if (after.sha256 !== before.sha256) throw new Error("raw collection changed during evaluation; refusing to report");
const networkAttempts = guard.attempts;
if (networkAttempts !== 0) throw new Error(`${networkAttempts} network attempt(s) during evaluation; refusing to report`);

const summary = {
  ...output.summary,
  provenance: {
    collectionId: manifest.collectionId,
    /** Read from the manifest and every stream; never inferred. */
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
    networkAttemptsDuringEvaluation: networkAttempts,
    rawUnchangedAfterEvaluation: true,
  },
};

await mkdir(path.dirname(summaryPath), { recursive: true });
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
await mkdir(path.dirname(ledgerPath), { recursive: true });
await writeFile(ledgerPath, `${JSON.stringify({ ...output.wrongCommitLedger, provenance: { collectionId: manifest.collectionId, evaluatedAtCommit: summary.provenance.evaluatedAtCommit, rawTreeSha256: before.sha256 } }, null, 1)}\n`);
await mkdir(sensitive, { recursive: true, mode: 0o700 });
await writeFile(path.join(sensitive, "ground-truth-vault.json"), JSON.stringify(output.generated.vault.export()), { mode: 0o600 });
await writeFile(path.join(sensitive, "case-results.json"), JSON.stringify(output.results), { mode: 0o600 });

const live = output.summary.live;
console.error(`evaluated ${output.results.length} cases in ${Date.now() - started} ms; network attempts ${networkAttempts}; raw tree ${before.sha256} unchanged`);
console.log(JSON.stringify({
  summary: path.relative(process.cwd(), summaryPath),
  provenance: { ...summary.provenance, rawFiles: undefined },
  live: { captures: live.captures, trajectories: live.trajectories, boardingEvents: live.boardingEvents, cases: live.cases, routes: live.routes, buckets: live.buckets, metrics: live.metrics, grouped: live.grouped },
}, null, 2));

/** sha256 over the raw evidence files only: manifest.json and streams/*.json. */
async function rawTree(root: string): Promise<{ sha256: string; files: Array<{ file: string; sha256: string }> }> {
  const names = ["manifest.json", ...(await readdir(path.join(root, "streams"))).filter((name) => name.endsWith(".json")).sort().map((name) => `streams/${name}`)];
  const files: Array<{ file: string; sha256: string }> = [];
  for (const name of names) {
    files.push({ file: name, sha256: createHash("sha256").update(await readFile(path.join(root, name))).digest("hex") });
  }
  return { sha256: createHash("sha256").update(files.map((entry) => `${entry.file}:${entry.sha256}`).join("\n")).digest("hex"), files };
}
