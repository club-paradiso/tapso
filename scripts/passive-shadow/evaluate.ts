/**
 * Passive Shadow Validation v3 — offline blind replay of a collection.
 *
 *   node --experimental-strip-types scripts/passive-shadow/evaluate.ts <collection-dir> \
 *     [--summary=artifacts/passive-shadow-validation-v3-summary.json] [--max-perturbation-cases=300]
 *
 * Reads the streams a collector wrote, verifies each against the manifest's
 * sha256, and runs the v3 pipeline. It makes no network call. It writes:
 *   - the sanitized summary (pseudonyms only) to --summary,
 *   - the sensitive bundle (ground-truth vault, per-case results with raw
 *     vehicle numbers) to <collection-dir>/evaluation/, which stays in `work/`.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { streamSha256, validatePassiveStream, type PassiveObservationStream } from "../../services/api/src/passiveShadow.ts";
import { runPassiveShadowPipeline } from "../../services/api/src/passiveShadowPipeline.ts";

const [directoryArg, ...rest] = process.argv.slice(2);
const options = new Map(rest.map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key!, value.join("=")];
}));
if (!directoryArg) {
  console.error("Usage: evaluate.ts <collection-dir> [--summary=<path>] [--max-perturbation-cases=300]");
  process.exit(2);
}
const directory = path.resolve(directoryArg);
const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as {
  streams: Array<{ streamId: string; sha256: string }>;
};
const expected = new Map(manifest.streams.map((entry) => [entry.streamId, entry.sha256]));

const streams: PassiveObservationStream[] = [];
for (const file of (await readdir(path.join(directory, "streams"))).filter((name) => name.endsWith(".json")).sort()) {
  const stream = JSON.parse(await readFile(path.join(directory, "streams", file), "utf8")) as PassiveObservationStream;
  validatePassiveStream(stream);
  const hash = streamSha256(stream);
  if (expected.get(stream.streamId) !== hash) {
    throw new Error(`stream ${stream.streamId} does not match its manifest checksum; refusing to evaluate`);
  }
  streams.push(stream);
}

const started = Date.now();
const output = runPassiveShadowPipeline(streams, {
  maxPerturbationCases: Number(options.get("max-perturbation-cases") || 300),
});
const summaryPath = path.resolve(options.get("summary") || path.join(directory, "evaluation", "summary.json"));
await mkdir(path.dirname(summaryPath), { recursive: true });
await writeFile(summaryPath, `${JSON.stringify(output.summary, null, 2)}\n`);

const sensitive = path.join(directory, "evaluation");
await mkdir(sensitive, { recursive: true, mode: 0o700 });
await writeFile(path.join(sensitive, "ground-truth-vault.json"), JSON.stringify(output.generated.vault.export()), { mode: 0o600 });
await writeFile(path.join(sensitive, "case-results.json"), JSON.stringify(output.results), { mode: 0o600 });

const live = output.summary.live;
console.error(`evaluated ${output.results.length} cases in ${Date.now() - started} ms`);
console.log(JSON.stringify({
  summary: path.relative(process.cwd(), summaryPath),
  live: { captures: live.captures, trajectories: live.trajectories, boardingEvents: live.boardingEvents, cases: live.cases, routes: live.routes, buckets: live.buckets, metrics: live.metrics, grouped: live.grouped },
}, null, 2));
