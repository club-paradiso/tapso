/**
 * Release-gate evidence from retained raw live collections, offline: the
 * `liveReplay` input (criteria CA-1..CA-4, CA-6, CA-7, BA-1, BA-2) and the
 * `counterfactualsOnLiveBases` input (CA-5) of `matcher-passive-safety-v4`.
 *
 *   node --experimental-strip-types scripts/matcher-evidence/live-evidence.ts <collection-dir>... \
 *     [--record=<collectionId>,<recorded-summary.json>,<recorded-ledger.json>] \
 *     [--out-live=artifacts/matcher-directed-v1/live-replay-evidence.json] \
 *     [--out-counterfactual=artifacts/matcher-directed-v1/counterfactual-live-evidence.json] \
 *     [--counterfactual-on=<collectionId> | --no-counterfactuals] [--skip-incomplete] \
 *     [--previous=<the committed live-replay-evidence.json>] [--omitted=<artifact id>,...]
 *
 * The counterfactual catalogue is the expensive part (about 50 transformations
 * of every case), so `--counterfactual-on` restricts it to one collection,
 * still complete over every case of it, and `--no-counterfactuals` skips it
 * (CA-5 then reads as `MISSING`); with neither it runs over all.
 *
 * `--previous` carries forward the failures of every window recorded there
 * whose raw is no longer among the collections: expiry never erases a wrong
 * commit. `--omitted` names retained artifacts that could not be fetched or
 * verified; the gate does not count a replay with any of them as complete.
 *
 * The output records the digest of the matcher and evaluation sources
 * (`sourceDigest.ts`), each collection's raw tree hash and a case-level digest
 * of its decisions, so the counts are bound to what produced them.
 *
 * For every collection: its manifest checksums must hold, every stream must be
 * `LIVE_PASSIVE`, and its raw tree must be unchanged afterwards. Each is replayed
 * blind under the current matcher and migrated against the legacy one; a
 * collection with a `--record` must have its legacy side reproduce that record.
 * The whole computation runs twice in this process, and the two results must
 * be identical. No network is reachable while it runs, and nothing written
 * carries a vehicle id, raw or pseudonymous.
 *
 * The same raw collection passed twice (a replayed copy) is read once.
 *
 * A collection with nothing to count is left out and named in the output
 * (`skipped`), never refused: a window whose manifest lists no stream (no route
 * had a vehicle), one with no snapshot, and one that stopped before writing its
 * first stream or its manifest. A collection whose manifest is missing while
 * stream files exist (an interrupted window) cannot be verified: it is refused
 * unless `--skip-incomplete` leaves it out. Leaving evidence out can only lower
 * a count; it never raises one.
 *
 * A record the legacy side does not reproduce is reported, not refused:
 * `reproductionOk` is false, which fails every criterion that reads it, and the
 * mismatch is printed, so the gate result carries it instead of a red job
 * hiding it.
 *
 * Exit codes: 0 written; 2 usage; 3 refusal (unreadable collection or checksum,
 * not live, raw changed, output inside a raw collection, two runs differ);
 * 4 network attempt.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assembleLiveReplayEvidence, type CollectionEvaluation, type DetailRow } from "../../services/api/src/liveReplayEvidence.ts";
import { counterfactualGateEvidence, runCounterfactuals } from "../../services/api/src/passiveCounterfactual.ts";
import type { PassiveObservationStream } from "../../services/api/src/passiveShadow.ts";
import { runMatcherMigration } from "../../services/api/src/passiveShadowMigration.ts";
import { runPassiveShadowPipeline } from "../../services/api/src/passiveShadowPipeline.ts";
import { assertOutsideRaw, installNetworkGuard, loadVerifiedCollection, rawTree } from "../passive-shadow/rawCollection.ts";
import { reproductionCheck } from "../passive-shadow/reproduction.ts";
import { matcherSourceDigest } from "./sourceDigest.ts";

const guard = installNetworkGuard("live-evidence.ts");
const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sources = matcherSourceDigest(REPOSITORY_ROOT);

const args = process.argv.slice(2);
const directories = args.filter((arg) => !arg.startsWith("--")).map((arg) => path.resolve(arg));
const options = new Map(args.filter((arg) => arg.startsWith("--")).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key!, value.join("=")];
}));
if (directories.length === 0) {
  console.error("Usage: live-evidence.ts <collection-dir>... [--record=<collectionId>,<summary>,<ledger>] [--out-live=<file>] [--out-counterfactual=<file>] [--counterfactual-on=<collectionId> | --no-counterfactuals] [--skip-incomplete] [--previous=<file>] [--omitted=<id>,...]");
  process.exit(2);
}
const outLive = path.resolve(options.get("out-live") || "artifacts/matcher-directed-v1/live-replay-evidence.json");
const outCounterfactual = path.resolve(options.get("out-counterfactual") || "artifacts/matcher-directed-v1/counterfactual-live-evidence.json");
const records = new Map(args.filter((arg) => arg.startsWith("--record=")).map((arg) => {
  const [collectionId, summary, ledger] = arg.slice("--record=".length).split(",");
  if (!collectionId || !summary || !ledger) {
    console.error("--record needs <collectionId>,<recorded-summary>,<recorded-ledger>");
    process.exit(2);
  }
  return [collectionId, { summary, ledger }] as const;
}));

function refuse(message: string): never {
  console.error(message);
  process.exit(3);
}

const omittedArtifacts = (options.get("omitted") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
let previous: DetailRow[] = [];
if (options.get("previous")) {
  try {
    const committed = JSON.parse(readFileSync(path.resolve(options.get("previous")!), "utf8")) as { detail?: DetailRow[] };
    previous = committed.detail ?? [];
  } catch (error) {
    refuse(`--previous: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface Loaded {
  directory: string;
  collectionId: string;
  providerPath: string;
  rawTreeSha256: string;
  streams: PassiveObservationStream[];
}

const loaded: Loaded[] = [];
const skipped: Array<{ collection: string; reason: string }> = [];
for (const directory of directories) {
  let tree: Awaited<ReturnType<typeof rawTree>>;
  let verified: Awaited<ReturnType<typeof loadVerifiedCollection>>;
  try {
    for (const output of [outLive, outCounterfactual]) assertOutsideRaw(directory, output, "an output");
    if (!existsSync(path.join(directory, "manifest.json"))) {
      const streamFiles = existsSync(path.join(directory, "streams"))
        ? (await readdir(path.join(directory, "streams"))).filter((name) => name.endsWith(".json"))
        : [];
      if (streamFiles.length === 0) {
        skipped.push({ collection: path.basename(directory), reason: "no manifest and no stream: stopped before collecting" });
        continue;
      }
      if (!options.has("skip-incomplete")) {
        refuse(`refusing ${directory}: ${streamFiles.length} stream file(s) but no manifest (an interrupted window); --skip-incomplete leaves it out`);
      }
      skipped.push({ collection: path.basename(directory), reason: `no manifest: ${streamFiles.length} unverifiable stream file(s) from an interrupted window` });
      continue;
    }
    tree = await rawTree(directory);
    verified = await loadVerifiedCollection(directory);
  } catch (error) {
    refuse(`refusing ${directory}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { manifest, streams } = verified;
  if (!streams.some((stream) => stream.snapshots.length > 0)) {
    skipped.push({ collection: manifest.collectionId, reason: `no snapshot (stop reason ${manifest.stopReason})` });
    continue;
  }
  const already = loaded.find((item) => item.collectionId === manifest.collectionId);
  if (already) {
    if (already.rawTreeSha256 !== tree.sha256) refuse(`two copies of ${manifest.collectionId} differ; refusing`);
    continue;
  }
  const notLive = streams.filter((stream) => stream.sourceClass !== "LIVE_PASSIVE");
  if (notLive.length > 0) refuse(`${manifest.collectionId}: ${notLive.length} stream(s) are not LIVE_PASSIVE; only live collections are gate evidence`);
  loaded.push({ directory, collectionId: manifest.collectionId, providerPath: manifest.providerPath, rawTreeSha256: tree.sha256, streams });
}
for (const collectionId of records.keys()) {
  if (!loaded.some((item) => item.collectionId === collectionId)) refuse(`--record names ${collectionId}, which is not among the collections`);
}
const counterfactualOn = options.get("counterfactual-on");
if (counterfactualOn && !loaded.some((item) => item.collectionId === counterfactualOn)) {
  refuse(`--counterfactual-on names ${counterfactualOn}, which is not among the collections`);
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

type CounterfactualEvidence = NonNullable<ReturnType<typeof counterfactualGateEvidence>> & { matcherSourceSha256: string };

async function evaluate(): Promise<{ live: ReturnType<typeof assembleLiveReplayEvidence>; counterfactual: CounterfactualEvidence | null }> {
  const collections: CollectionEvaluation[] = [];
  for (const item of loaded) {
    const pipeline = runPassiveShadowPipeline(item.streams, { maxPerturbationCases: 0, createdAt: "1970-01-01T00:00:00.000Z" });
    const migration = runMatcherMigration(item.streams);
    const record = records.get(item.collectionId);
    const firstReceiptAt = item.streams
      .flatMap((stream) => stream.snapshots.map((snapshot) => snapshot.capturedAt))
      .sort()[0];
    if (!firstReceiptAt) refuse(`${item.collectionId} has no snapshot`);
    // Every decision of the collection, case by case, under both policies. The
    // digest compares two runs at case level without writing any vehicle id.
    const caseDigest = sha256([
      ...pipeline.results.map((result) =>
        `current|${result.caseId}|${result.perturbation ?? "-"}|${result.bucket}|${result.committedVehicleId ?? "-"}|${result.directedInvariantViolated}`),
      ...migration.rows.map((row) => `migration|${row.caseId}|${row.legacy.bucket}|${row.current.bucket}`),
    ].sort().join("\n"));
    collections.push({
      collectionId: item.collectionId,
      providerPath: item.providerPath,
      firstReceiptAt,
      rawTreeSha256: item.rawTreeSha256,
      live: {
        cases: pipeline.summary.live.cases,
        buckets: pipeline.summary.live.buckets,
        staleSelections: pipeline.summary.live.staleSelections,
      },
      results: pipeline.results.map((result) => ({
        sourceClass: result.sourceClass,
        ...(result.perturbation ? { perturbation: result.perturbation } : {}),
        routeId: result.meta.routeId,
        scenario: result.meta.scenario,
        groundTruthVehicleId: result.groundTruthVehicleId,
        committed: result.committedVehicleId !== undefined,
        contested: result.contestedDecisions > 0,
        directedInvariantViolated: result.directedInvariantViolated,
      })),
      migration: { correctToWrong: migration.correctToWrongRegressions.length, newWrong: migration.newWrongCommits.length },
      ...(record ? { reproduction: await reproductionCheck(migration, record) } : {}),
      caseDigest,
    });
  }
  // Determinism is filled in by the caller, from two independent runs.
  const live = assembleLiveReplayEvidence(collections, {
    deterministicAcrossRuns: false,
    matcherSourceSha256: sources.sha256,
    previous,
    omittedArtifacts,
  });
  if (options.has("no-counterfactuals")) return { live, counterfactual: null };
  const bases = counterfactualOn ? loaded.filter((item) => item.collectionId === counterfactualOn) : loaded;
  if (bases.length === 0) return { live, counterfactual: null };
  const { report } = runCounterfactuals(bases.flatMap((item) => item.streams));
  const gateEvidence = counterfactualGateEvidence(report);
  return { live, counterfactual: gateEvidence ? { ...gateEvidence, matcherSourceSha256: sources.sha256 } : null };
}

const first = await evaluate();
const second = await evaluate();
if (JSON.stringify(first) !== JSON.stringify(second)) refuse("two runs over the same raw evidence differ; refusing to report");
for (const item of loaded) {
  if ((await rawTree(item.directory)).sha256 !== item.rawTreeSha256) refuse(`raw collection ${item.collectionId} changed during evaluation`);
}
if (guard.attempts !== 0) {
  console.error(`${guard.attempts} network attempt(s); refusing to report`);
  process.exit(4);
}
if (matcherSourceDigest(REPOSITORY_ROOT).sha256 !== sources.sha256) refuse("the matcher sources changed during evaluation; refusing to report");

const live = { ...first.live, deterministicAcrossRuns: true, skipped };
for (const row of live.detail) {
  if (row.reproduction?.startsWith("NOT reproduced")) console.error(`${row.collectionId}: evidence of record ${row.reproduction}`);
}
await mkdir(path.dirname(outLive), { recursive: true });
await writeFile(outLive, `${JSON.stringify({ evidenceClass: "VERIFIED_BY_REPLAY", sampleClass: "VERIFIED_LIVE_PASSIVE", ...live }, null, 2)}\n`);
if (first.counterfactual) {
  await mkdir(path.dirname(outCounterfactual), { recursive: true });
  await writeFile(outCounterfactual, `${JSON.stringify(first.counterfactual, null, 2)}\n`);
}
console.log(JSON.stringify({
  collections: live.collections,
  reproductionOk: live.reproductionOk,
  trajectories: live.trajectories,
  vehicles: live.vehicles,
  routes: live.routes,
  windows: live.collectionWindows,
  timeBands: live.timeBands,
  contestedTrajectories: live.contestedTrajectories,
  sessionCadence: live.sessionCadence,
  omittedArtifacts: live.omittedArtifacts,
  carriedForward: live.carriedForward,
  matcherSourceSha256: live.matcherSourceSha256,
  currentWrong: live.currentWrong,
  newWrong: live.newWrong,
  correctToWrong: live.correctToWrong,
  skipped,
  counterfactual: first.counterfactual ?? "refused: see counterfactualGateEvidence (partial run or non-live base)",
}, null, 2));
