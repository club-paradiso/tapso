/**
 * Writes artifacts/route-coverage/jeju-production-readiness.{json,md} from the
 * committed catalog, the live probe and the timetable bundle. Offline and
 * deterministic (`services/api/src/routeReadiness.ts`); run by
 * `.github/workflows/jeju-catalog.yml` after each catalog build.
 *
 *   node --experimental-strip-types scripts/route-coverage/production-readiness.ts
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { validateTimetableBundle } from "../../services/api/src/officialTimetable.ts";
import { assessReadiness, renderReadinessMarkdown } from "../../services/api/src/routeReadiness.ts";
import { validateCatalog } from "../../services/api/src/transitCatalog.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string): unknown => JSON.parse(readFileSync(path.join(root, relative), "utf8"));
const catalog = validateCatalog(read("services/api/data/jeju-transit-catalog.json"));
const { bundle } = validateTimetableBundle(read("services/api/data/jeju-timetables.json"));
const probePath = "artifacts/route-coverage/jeju-live-probe.json";
const probe = existsSync(path.join(root, probePath)) ? read(probePath) as Parameters<typeof assessReadiness>[2] : undefined;

const report = assessReadiness(catalog, bundle, probe);
mkdirSync(path.join(root, "artifacts/route-coverage"), { recursive: true });
writeFileSync(path.join(root, "artifacts/route-coverage/jeju-production-readiness.json"), `${JSON.stringify(report, null, 1)}\n`);
writeFileSync(path.join(root, "artifacts/route-coverage/jeju-production-readiness.md"), renderReadinessMarkdown(report));
console.log(JSON.stringify({ variants: report.variants.length, totals: report.totals, timetableTotals: report.timetableTotals }));
