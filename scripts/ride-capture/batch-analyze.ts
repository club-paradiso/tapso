/**
 * Count the field-validation campaign from a directory of phone exports.
 *
 *   node --experimental-strip-types scripts/ride-capture/batch-analyze.ts <input-dir> [--out=work/field-validation]
 *
 * The input directory is read and never written: no file in it is created,
 * renamed, modified or deleted. Only `*.json` files directly inside it are
 * read, so a folder of `*.json` raw captures and `*.report.json` reports is
 * enough. Every per-ride number comes from `analyzeRideCapture`; see
 * `services/api/src/rideCampaign.ts` for the pairing and bucket rules.
 *
 * Output goes to `--out` (default `work/field-validation/`, which Git ignores):
 *   campaign-report.json   the full sanitized campaign
 *   campaign-report.md     the same numbers for a human
 * Neither contains a vehicle number or a coordinate; `buildCampaign` throws
 * rather than emit either.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCampaign, renderCampaignMarkdown } from "../../services/api/src/rideCampaign.ts";

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const outFlag = process.argv.find((arg) => arg.startsWith("--out="));
const inputDir = positional[0];
if (!inputDir) {
  console.error("Usage: node --experimental-strip-types scripts/ride-capture/batch-analyze.ts <input-dir> [--out=work/field-validation]");
  process.exit(2);
}

const input = path.resolve(inputDir);
const out = path.resolve(outFlag ? outFlag.slice("--out=".length) : "work/field-validation");
const relative = path.relative(input, out);
// Writing inside the input would make the next run read its own output, and it
// would be a write into a directory this tool promises only to read.
if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
  console.error("FAIL  --out must not be the input directory or inside it");
  process.exit(1);
}

try {
  if (!(await stat(input)).isDirectory()) throw new Error("input is not a directory");
  const names = (await readdir(input)).sort();
  const files = [];
  for (const name of names) {
    const full = path.join(input, name);
    if (!(await stat(full)).isFile()) continue;
    files.push({ name, content: await readFile(full) });
  }

  const campaign = buildCampaign(files);
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "campaign-report.json"), `${JSON.stringify(campaign, null, 2)}\n`);
  await writeFile(path.join(out, "campaign-report.md"), renderCampaignMarkdown(campaign));

  const { counter, buckets, files: summary } = campaign;
  console.log([
    `reports ${summary.reportsDiscovered}, raw captures ${summary.rawCapturesDiscovered}, reports without raw ${summary.reportsWithoutRaw}, invalid ${summary.invalidFiles.length}`,
    `buckets ${Object.entries(buckets).map(([bucket, count]) => `${bucket}=${count}`).join(" ")}`,
    `clean observed boardings ${counter.cleanObservedBoardings}, remaining to thirty ${counter.remainingToThirty}`,
    counter.note,
    `wrote ${path.relative(process.cwd(), out) || "."}/campaign-report.{json,md}`,
  ].join("\n"));
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
