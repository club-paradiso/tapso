/**
 * Writes services/api/data/jeju-live-coverage.json from the committed catalog
 * and probe history (`services/api/src/liveCoverage.ts` explains the rule).
 *
 *   node --experimental-strip-types scripts/route-coverage/live-coverage.ts          # write
 *   node --experimental-strip-types scripts/route-coverage/live-coverage.ts --check  # exit 1 if stale
 *
 * The API test `liveCoverage.test.ts` fails too when the file and the history disagree.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { computeLiveCoverage, type LiveProbeRecord } from "../../services/api/src/liveCoverage.ts";
import { validateCatalog } from "../../services/api/src/transitCatalog.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const catalog = validateCatalog(JSON.parse(readFileSync(path.join(ROOT, "services/api/data/jeju-transit-catalog.json"), "utf8")));
const historyDir = path.join(ROOT, "artifacts/route-coverage/probe-history");
const history = readdirSync(historyDir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(path.join(historyDir, name), "utf8")) as LiveProbeRecord);

const coverage = computeLiveCoverage(catalog, history);
const text = `${JSON.stringify(coverage, null, 2)}\n`;
const target = path.join(ROOT, "services/api/data/jeju-live-coverage.json");

if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(target, "utf8"); } catch { /* missing counts as stale */ }
  if (current !== text) {
    console.error("services/api/data/jeju-live-coverage.json is stale; run scripts/route-coverage/live-coverage.ts");
    process.exit(1);
  }
} else {
  writeFileSync(target, text);
}
const listed = Object.entries(coverage.neverObserved).map(([routeNo, entry]) => `${routeNo} (${entry.probes} probes, ${entry.days} days)`);
console.log(`LIVE_COVERAGE catalog ${coverage.catalogVersion}: ${coverage.probeFiles} probe files; never observed: ${listed.join(", ") || "none"}`);
