/**
 * Compares TAPSO's displayed ride progress with a reference series and prints
 * the disagreement distribution (`BOARDING_ANCHOR_POSITION_V2.md` §8, §10).
 *
 *   node --experimental-strip-types scripts/validation/compare-jeju-bis-position.ts --pairs work/validation/pairs.jsonl
 *   node --experimental-strip-types scripts/validation/compare-jeju-bis-position.ts \
 *     --displayed work/validation/displayed.json --reference work/validation/announcements.json
 *
 * `--pairs`: JSON lines `{ "route": "...", "atMs": n, "tapsoSequence": n|null, "referenceSequence": n|null }`.
 * `--displayed` / `--reference`: arrays of `{ "sequence": n, "atMs": n }` stop transitions,
 * e.g. a RideTrace export against stop announcements written down on a real ride.
 *
 * Analysis only. It deliberately contains no reader for Jeju BIS: the
 * passenger-facing station view exposes per-route progress through requests
 * that are not a documented API (`DATA_SOURCES.md`). Collecting a reference
 * series from it is research use that needs the owner's approval, a reviewed
 * reader written against the probe's evidence, a request budget (no more than
 * one request per second, bounded per run) and a dated label. It is never a
 * runtime input. Inputs stay in ignored `work/`; nothing identifying is printed.
 */

import { readFileSync } from "node:fs";
import { compareSnapshots, compareTransitions, type PositionSample, type StopTransition } from "../../services/api/src/positionComparison.ts";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const pairsPath = option("--pairs");
const displayedPath = option("--displayed");
const referencePath = option("--reference");

if (pairsPath) {
  const byRoute = new Map<string, PositionSample[]>();
  for (const line of readFileSync(pairsPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { route: string; tapsoSequence: number | null; referenceSequence: number | null };
    const list = byRoute.get(row.route) ?? [];
    list.push({ displayedSequence: row.tapsoSequence, referenceSequence: row.referenceSequence });
    byRoute.set(row.route, list);
  }
  const all = [...byRoute.values()].flat();
  console.log(JSON.stringify({ overall: compareSnapshots(all), routes: byRoute.size }, null, 2));
} else if (displayedPath && referencePath) {
  const displayed = JSON.parse(readFileSync(displayedPath, "utf8")) as StopTransition[];
  const reference = JSON.parse(readFileSync(referencePath, "utf8")) as StopTransition[];
  const result = compareTransitions(displayed, reference);
  console.log(JSON.stringify(result, null, 2));
  if (result.early > 0) {
    console.error(`EARLY transitions: ${result.early}. A release gate fails on any early stop passage.`);
    process.exitCode = 2;
  }
} else {
  console.error("usage: --pairs <file.jsonl> | --displayed <file.json> --reference <file.json>");
  process.exitCode = 1;
}
