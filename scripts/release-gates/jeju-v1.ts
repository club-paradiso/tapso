/**
 * TAPSO v1.0 release gates (docs/exec-plans/JEJU_PRODUCTION_V1.md), computed
 * from what the repository holds, never from what a document claims.
 *
 *   node --experimental-strip-types scripts/release-gates/jeju-v1.ts [--check]
 *
 * Writes artifacts/release-gates/jeju-v1.{json,md}. With --check it exits 1 if
 * a gate the repository alone decides (data validity, Release search, data
 * quality) is FAIL. BLOCKED and PENDING gates name what is missing and who can
 * provide it; they never pass silently and never fail CI.
 *
 * Status per gate: PASS, FAIL, PENDING_EVIDENCE (the evidence is produced by a
 * workflow that has not run for this state), BLOCKED (needs something outside
 * the repository: an account, a device, a person).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { validateTimetableBundle } from "../../services/api/src/officialTimetable.ts";
import type { ReadinessReport } from "../../services/api/src/routeReadiness.ts";
import { validateCatalog, type TransitCatalog } from "../../services/api/src/transitCatalog.ts";

type Status = "PASS" | "FAIL" | "PENDING_EVIDENCE" | "BLOCKED";
interface Gate { id: string; requirement: string; status: Status; evidence: string[]; blocker?: string; next?: string }
/** Gates the repository alone decides; `--check` fails only on these. A live audit result is reported, not enforced. */
const ENFORCED = new Set(["GATE 1 — DATA", "GATE 2 — SEARCH", "GATE 6 — DATA QUALITY"]);

const root = path.resolve(import.meta.dirname, "..", "..");
const file = (relative: string) => path.join(root, relative);
const text = (relative: string) => readFileSync(file(relative), "utf8");
const json = (relative: string): unknown => JSON.parse(text(relative));
const gates: Gate[] = [];

// GATE 1 — DATA
{
  const evidence: string[] = [];
  let status: Status = "PASS";
  let catalog: TransitCatalog | undefined;
  if (!existsSync(file("services/api/data/jeju-transit-catalog.json"))) {
    status = "PENDING_EVIDENCE";
    evidence.push("no catalog committed yet: run .github/workflows/jeju-catalog.yml");
  } else {
    try {
      catalog = validateCatalog(json("services/api/data/jeju-transit-catalog.json"));
      evidence.push(`catalog ${catalog.catalogVersion}: ${catalog.routes.length} variants, ${catalog.stops.length} stops, ${catalog.unavailable.length} without a stop list, built ${catalog.generatedAt}`);
      evidence.push(`discovery: ${catalog.source.discovery.length} queries`);
      // The catalog keeps route-ID counts only; the build's report keeps each query's HTTP status.
      // A failed query is said as failed, never as "found 0".
      const reportPath = "artifacts/route-coverage/jeju-catalog-discovery.json";
      if (existsSync(file(reportPath))) {
        const report = json(reportPath) as { catalogVersion?: string; discovery?: { method: string; query: string; status: number }[] };
        if (report.catalogVersion === catalog.catalogVersion) {
          const failed = (report.discovery ?? []).filter((entry) => entry.status !== 200);
          evidence.push(failed.length === 0
            ? "every discovery query answered HTTP 200"
            : `${failed.length} discovery queries failed (${failed.map((entry) => `${entry.method}${entry.query ? ` ${entry.query}` : ""} HTTP ${entry.status}`).join(", ")}); the catalog's route IDs come from the queries that answered, so a route reachable only through a failed query would be missing`);
        }
      }
    } catch (error) {
      status = "FAIL";
      evidence.push(`catalog invalid: ${(error as Error).message}`);
    }
  }
  const manifest = json("fixtures/jeju/timetables/bis/manifest.json") as { timetables: { outcome: string; family?: string }[]; counts: Record<string, number> };
  const outcomes = new Set(["parsed", "source_conflict", "no_timetable", "parse_refused"]);
  const undecided = manifest.timetables.filter((entry) => !outcomes.has(entry.outcome));
  evidence.push(`timetable census: ${manifest.timetables.length} entries, ${JSON.stringify(manifest.counts)}`);
  if (undecided.length > 0) {
    status = "FAIL";
    evidence.push(`${undecided.length} census entries without a deterministic outcome`);
  }
  gates.push({ id: "GATE 1 — DATA", requirement: "Complete route catalog; timetable census complete with a deterministic status per entry", status, evidence, ...(status === "PENDING_EVIDENCE" ? { next: "Run the catalog workflow (ops/jeju-catalog/request.json) and merge its data commit" } : {}) });
}

// GATE 2 — SEARCH
{
  const evidence: string[] = [];
  const failures: string[] = [];
  const build = text("apps/ios/TapsoApp/TapsoBuild.swift");
  if (!/#if DEBUG\s+static let showsDemo = true\s+#else\s+static let showsDemo = false\s+#endif/.test(build)) failures.push("TapsoBuild.showsDemo is not false outside DEBUG");
  const home = text("apps/ios/TapsoApp/HomeView.swift");
  if (!/if showsDemo, library\.recents\.isEmpty \{\s+firstRideCard/.test(home)) failures.push("Home's sample ride is not behind showsDemo");
  if ((home.match(/if showsDemo \{ demoChip \}/g) ?? []).length !== 2) failures.push("Home's demo chip is not behind showsDemo");
  const setup = text("apps/ios/TapsoApp/SetupViews.swift");
  const search = setup.slice(setup.indexOf("struct DestinationSearchView"), setup.indexOf("struct DestinationSearchContent"));
  if (!/if let index = model\.catalogIndex \{\s+CatalogDestinationSearchContent/.test(search)) failures.push("destination search does not run on the catalog first");
  if (!/if TapsoBuild\.showsDemo \{[\s\S]*DestinationSearchContent\(/.test(search)) failures.push("the demo search is reachable outside a demo build");
  const model = text("apps/ios/TapsoApp/TapsoAppModel.swift");
  if (!/guard TapsoBuild\.showsDemo else \{\s+openSearch\(\)/.test(model)) failures.push("a saved demo journey can replay in Release");
  // Where the synthetic catalog may still be named in app code, and nowhere else.
  const allowed = new Set(["apps/ios/TapsoApp/SetupViews.swift", "apps/ios/TapsoApp/TapsoAppModel.swift", "apps/ios/TapsoApp/DemoControlsView.swift", "apps/ios/TapsoApp/HomeView.swift"]);
  for (const name of readdirSync(file("apps/ios/TapsoApp"))) {
    const relative = `apps/ios/TapsoApp/${name}`;
    if (!name.endsWith(".swift")) continue;
    if (/\bDemo(Catalog|Fixtures|RideScript)\b/.test(text(relative)) && !allowed.has(relative)) failures.push(`${relative} names the synthetic catalog`);
  }
  evidence.push(failures.length === 0 ? "source checks: catalog-first search; sample ride, demo chip, demo search and demo replay are Debug-only" : `source checks failed: ${failures.join("; ")}`);
  gates.push({ id: "GATE 2 — SEARCH", requirement: "Production search uses the real catalog; no DemoCatalog in the Release journey path", status: failures.length === 0 ? "PASS" : "FAIL", evidence });
}

// GATE 3 — LIVE
{
  const evidence: string[] = [];
  let status: Status;
  const reportPath = "artifacts/route-coverage/jeju-production-readiness.json";
  if (!existsSync(file(reportPath))) {
    status = "PENDING_EVIDENCE";
    evidence.push("no readiness report: run the catalog workflow with live: true");
  } else {
    const report = json(reportPath) as ReadinessReport;
    const catalog = existsSync(file("services/api/data/jeju-transit-catalog.json")) ? validateCatalog(json("services/api/data/jeju-transit-catalog.json")) : undefined;
    evidence.push(`readiness for catalog ${report.catalogVersion}: ${JSON.stringify(report.totals)}; probed ${report.probedAt ?? "never"}`);
    if (!catalog || catalog.catalogVersion !== report.catalogVersion || !report.probedAt) {
      status = "PENDING_EVIDENCE";
      evidence.push("the report does not cover the committed catalog with a live probe");
    } else {
      // Representative families: TAGO's own route type for each variant.
      const families = new Map<string, { rideable: number; total: number }>();
      for (const route of catalog.routes) {
        const variant = report.variants.find((entry) => entry.routeId === route.routeId);
        const family = route.routeType ?? "unstated";
        const entry = families.get(family) ?? { rideable: 0, total: 0 };
        entry.total += 1;
        if (variant && (variant.tracking === "SUPPORTED" || variant.tracking === "SUPPORTED_WITH_WARNING")) entry.rideable += 1;
        families.set(family, entry);
      }
      const missing = [...families].filter(([, entry]) => entry.rideable === 0).map(([family]) => family);
      evidence.push(`route families (TAGO routetp): ${[...families].map(([family, entry]) => `${family} ${entry.rideable}/${entry.total}`).join(", ")}`);
      status = missing.length === 0 ? "PASS" : "FAIL";
      if (missing.length > 0) evidence.push(`no rideable variant in: ${missing.join(", ")}`);
    }
  }
  gates.push({ id: "GATE 3 — LIVE", requirement: "Representative route families pass the live compatibility audit", status, evidence });
}

// GATE 4 — TRACKING
{
  const tests = text("packages/transit-core/Tests/TapsoTransitTests/HybridPositionEngineTests.swift");
  const count = (tests.match(/func test/g) ?? []).length;
  const deviceEvidence = existsSync(file("artifacts/device-validation")) && readdirSync(file("artifacts/device-validation")).some((name) => name.startsWith("hybrid-"));
  gates.push({
    id: "GATE 4 — TRACKING",
    requirement: "Hybrid tracking passes deterministic simulations; real-device validation threshold met",
    status: deviceEvidence ? "PASS" : "BLOCKED",
    evidence: [`${count} deterministic hybrid scenarios in HybridPositionEngineTests (CI job transit-core)`, deviceEvidence ? "device validation evidence present" : "no real-device ride evidence (artifacts/device-validation/hybrid-*)"],
    ...(deviceEvidence ? {} : { blocker: "BLOCKED_BY_PHYSICAL_DEVICE: a signed build on an iPhone and ridden routes", next: "Run the device protocol in JEJU_PRODUCTION_V1.md §11 with -tapsoHybridTracking on the representative route classes" }),
  });
}

// GATE 5 — BACKGROUND
{
  const pushEvidence = existsSync(file("artifacts/device-validation")) && readdirSync(file("artifacts/device-validation")).some((name) => name.startsWith("live-activity-push"));
  gates.push({
    id: "GATE 5 — BACKGROUND",
    requirement: "A suspended-app ride still receives progress (Live Activity push)",
    status: pushEvidence ? "PASS" : "BLOCKED",
    evidence: ["APNs sender, token registration, scheduler and app token flow implemented (LIVE_ACTIVITY_PUSH.md milestones 1-5)", pushEvidence ? "device push evidence present" : "production /health reports liveActivityPush disabled; no device push evidence"],
    ...(pushEvidence ? {} : { blocker: "BLOCKED_BY_APPLE_ACCOUNT and BLOCKED_BY_PHYSICAL_DEVICE: paid Apple team, Push Notifications capability, .p8 key in Vercel, a device", next: "Owner: APNS_* variables on tapso-api, aps-environment entitlement, then LIVE_ACTIVITY_PUSH.md milestone 6 on a device" }),
  });
}

// GATE 6 — DATA QUALITY
{
  const manifest = json("fixtures/jeju/timetables/bis/manifest.json") as { timetables: { name: string; outcome: string; family?: string; reason?: string; conflicts?: string[] }[] };
  const refusedWithoutFamily = manifest.timetables.filter((entry) => entry.outcome === "parse_refused" && !entry.family);
  const conflictsWithoutReason = manifest.timetables.filter((entry) => entry.outcome === "source_conflict" && !(entry.conflicts?.length));
  const { rejected } = validateTimetableBundle(json("services/api/data/jeju-timetables.json"));
  const failures = [...refusedWithoutFamily.map((entry) => `${entry.name} refused without a family`), ...conflictsWithoutReason.map((entry) => `${entry.name} conflict without reasons`), ...rejected.map((entry) => `bundle rejects ${entry.scheduleId}: ${entry.reason}`)];
  gates.push({
    id: "GATE 6 — DATA QUALITY",
    requirement: "Parser failures resolved or explicitly classified; no unknown layout silently accepted",
    status: failures.length === 0 ? "PASS" : "FAIL",
    evidence: [
      `${manifest.timetables.filter((entry) => entry.outcome === "parse_refused").length} refused (each with a family), ${manifest.timetables.filter((entry) => entry.outcome === "source_conflict").length} source conflicts (each with reasons)`,
      "fail-closed grammar tests in scripts/timetables/test_jeju_xlsx.py (unknown labels, near-time typos, values outside the table)",
      ...failures,
    ],
  });
}

// GATE 7 — RELEASE
gates.push({
  id: "GATE 7 — RELEASE",
  requirement: "iOS, API, parser, integration and snapshot tests, lint/type/build, CI green",
  status: "PENDING_EVIDENCE",
  evidence: ["decided by CI on the pull request head (.github/workflows/ci.yml), not by this script"],
  next: "Merge only on a green head",
});

mkdirSync(file("artifacts/release-gates"), { recursive: true });
writeFileSync(file("artifacts/release-gates/jeju-v1.json"), `${JSON.stringify({ schemaVersion: "tapso-release-gates-v1", gates }, null, 1)}\n`);
writeFileSync(file("artifacts/release-gates/jeju-v1.md"), [
  "# TAPSO v1.0 release gates (Jeju)",
  "",
  "Generated by `scripts/release-gates/jeju-v1.ts` from repository evidence; do not edit by hand.",
  "",
  "| Gate | Requirement | Status | Evidence | Blocker | Next action |",
  "|---|---|---|---|---|---|",
  ...gates.map((gate) => `| ${gate.id} | ${gate.requirement} | ${gate.status} | ${gate.evidence.join("<br>")} | ${gate.blocker ?? "—"} | ${gate.next ?? "—"} |`),
  "",
].join("\n"));
for (const gate of gates) console.log(`${gate.status.padEnd(16)} ${gate.id}`);
if (process.argv.includes("--check") && gates.some((gate) => ENFORCED.has(gate.id) && gate.status === "FAIL")) process.exit(1);
