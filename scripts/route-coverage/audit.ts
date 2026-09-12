/**
 * How much of Jeju can the ride capture controller actually record?
 *
 * For every route variant it is given, this fetches the ordered topology once,
 * classifies its shape, and runs the *same* compatibility engine the phone runs
 * — imported, not reimplemented, so the answer here and the answer in the
 * operator's hand cannot drift apart.
 *
 * It is deliberately unhurried and cacheable. TAGO's quota is shared with the
 * live product, so every response is written to disk and re-used, calls are
 * paced, and a hard ceiling stops the run before it can become a hammer.
 *
 * Live vehicle availability is time-dependent and is therefore NOT part of the
 * static verdict. Ask for it with `--live` when the answer is wanted.
 *
 *   env -u TAGO_SERVICE_KEY node --env-file=.env.local \
 *     --experimental-strip-types scripts/route-coverage/audit.ts 447 365 331
 *
 *   # or, when the provider will list the city itself:
 *   … scripts/route-coverage/audit.ts --all
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TagoTransitProvider, type TagoRoute } from "../../services/api/src/tagoProvider.ts";
import { classifyTopology } from "../../services/api/src/rideCapture.ts";
import { resolveTagoServiceKey, serviceKeyWarning } from "../../services/api/src/serviceKey.ts";
import type { StopOnRoute } from "../../services/api/src/domain.ts";
// The operator's own verdict function. Importing it is the point: a coverage
// report that disagreed with the instrument would be worse than none.
import { assessRouteCompatibility } from "../../services/api/public/ride-capture/capture-core.js";

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const cityCode = option("--city") ?? "39";
const paceMs = positiveInteger(option("--pace-ms"), 250);
const maxCalls = positiveInteger(option("--max-calls"), 400);
const wantLive = flag("--live");
const useCatalog = flag("--all");
const routeNumbers = args.filter((value) => !value.startsWith("--") && value !== option("--city") && value !== option("--pace-ms") && value !== option("--max-calls"));

const outputDirectory = path.resolve(process.cwd(), "work", "route-coverage");
const cacheDirectory = path.join(outputDirectory, "cache");

interface VariantReport {
  routeNo: string;
  routeId: string;
  cityCode: string;
  origin?: string;
  destination?: string;
  routeType?: string;
  stopCount: number;
  topologyKind: string;
  duplicateStopIdCount: number;
  duplicateStopNameCount: number;
  sequenceAscending: boolean;
  compatibility: "SUPPORTED" | "SUPPORTED_WITH_WARNING" | "UNSUPPORTED" | "UNKNOWN";
  reason: string;
  liveVehicleCount?: number;
  liveVehicleError?: string;
}

if (routeNumbers.length === 0 && !useCatalog) {
  console.error([
    "Usage: node --experimental-strip-types scripts/route-coverage/audit.ts <route-no> [...]",
    "       node --experimental-strip-types scripts/route-coverage/audit.ts --all",
    "Options: --city 39 --pace-ms 250 --max-calls 400 --live",
    "Run with: env -u TAGO_SERVICE_KEY node --env-file=.env.local --experimental-strip-types …",
    "Output: work/route-coverage/jeju-route-compatibility.{json,md} (work/ is Git-ignored)",
  ].join("\n"));
  process.exit(2);
}

const resolved = resolveTagoServiceKey(process.env);
const warning = serviceKeyWarning(resolved);
if (warning) console.error(warning);

let upstreamCalls = 0;
const provider = new TagoTransitProvider({ serviceKey: resolved.key });

try {
  await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });

  const variants = useCatalog
    ? await catalogVariants()
    : (await Promise.all(routeNumbers.map((number) => numberVariants(number)))).flat();

  if (variants.length === 0) {
    console.error("No route variants to audit.");
    process.exit(3);
  }

  const reports: VariantReport[] = [];
  for (const variant of variants) {
    reports.push(await auditVariant(variant));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    cityCode,
    source: useCatalog ? "provider catalog" : `route numbers: ${routeNumbers.join(", ")}`,
    upstreamCalls,
    liveChecked: wantLive,
    totals: {
      variants: reports.length,
      supported: reports.filter((report) => report.compatibility === "SUPPORTED").length,
      supportedWithWarning: reports.filter((report) => report.compatibility === "SUPPORTED_WITH_WARNING").length,
      unsupported: reports.filter((report) => report.compatibility === "UNSUPPORTED").length,
      unknown: reports.filter((report) => report.compatibility === "UNKNOWN").length,
    },
    variants: reports.sort((a, b) => a.routeNo.localeCompare(b.routeNo, "ko") || a.routeId.localeCompare(b.routeId)),
  };

  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const jsonPath = path.join(outputDirectory, "jeju-route-compatibility.json");
  const markdownPath = path.join(outputDirectory, "jeju-route-compatibility.md");
  await writeFile(jsonPath, JSON.stringify(summary, null, 2), { mode: 0o600 });
  await writeFile(markdownPath, renderMarkdown(summary), { mode: 0o600 });

  console.error(`upstream calls: ${upstreamCalls}`);
  console.error(`wrote ${path.relative(process.cwd(), jsonPath)}`);
  console.error(`wrote ${path.relative(process.cwd(), markdownPath)}`);
  console.log(JSON.stringify(summary.totals, null, 2));
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  console.error(JSON.stringify({
    ok: false,
    code: code ?? "ROUTE_AUDIT_FAILED",
    message: error instanceof Error ? error.message : String(error),
    hint: code === "BLOCKED_BY_CREDENTIALS" ? "Load TAGO_SERVICE_KEY from ignored .env.local." : undefined,
  }));
  process.exit(1);
}

async function catalogVariants(): Promise<TagoRoute[]> {
  try {
    return await call(() => provider.allRoutes(cityCode));
  } catch (error) {
    // Whether the provider will list a whole city is its answer to give.
    console.error(`the provider did not return a city-wide catalog: ${error instanceof Error ? error.message : "unknown"}`);
    console.error("pass route numbers explicitly instead.");
    return [];
  }
}

async function numberVariants(routeNumber: string): Promise<TagoRoute[]> {
  try {
    return await call(() => provider.routes(cityCode, routeNumber));
  } catch (error) {
    console.error(`route ${routeNumber}: lookup failed — ${error instanceof Error ? error.message : "unknown"}`);
    return [];
  }
}

async function auditVariant(variant: TagoRoute): Promise<VariantReport> {
  const base: VariantReport = {
    routeNo: variant.routeNumber,
    routeId: variant.routeId,
    cityCode,
    origin: variant.startStopName,
    destination: variant.endStopName,
    routeType: variant.routeType,
    stopCount: 0,
    topologyKind: "unknown",
    duplicateStopIdCount: 0,
    duplicateStopNameCount: 0,
    sequenceAscending: false,
    compatibility: "UNKNOWN",
    reason: "정류장 목록을 가져오지 못했다",
  };

  let stops: StopOnRoute[];
  try {
    stops = await cachedStops(variant.routeId);
  } catch (error) {
    base.reason = error instanceof Error ? error.message : "unknown";
    return base;
  }

  const topology = classifyTopology(stops);
  const verdict = assessRouteCompatibility({
    route: variant,
    stops,
    topology,
    // Deliberately unchecked: a route's shape does not depend on whether a bus
    // happens to be running at the moment the audit ran.
    vehicleCount: undefined,
    vehiclesFailed: false,
  });

  const report: VariantReport = {
    ...base,
    stopCount: stops.length,
    topologyKind: topology.kind,
    duplicateStopIdCount: topology.duplicateStopIdCount,
    duplicateStopNameCount: topology.duplicateStopNameCount,
    sequenceAscending: topology.sequenceAscending,
    compatibility: verdict.level === "ok" ? "SUPPORTED" : verdict.level === "warning" ? "SUPPORTED_WITH_WARNING" : "UNSUPPORTED",
    reason: verdict.level === "ok" ? verdict.reason : `${verdict.headline} — ${verdict.reason}`,
  };

  if (wantLive) {
    try {
      const vehicles = await call(() => provider.vehicles({ routeId: variant.routeId, cityCode }));
      report.liveVehicleCount = vehicles.length;
    } catch (error) {
      report.liveVehicleError = error instanceof Error ? error.message : "unknown";
    }
  }
  return report;
}

/** Stops change rarely; the cache is what keeps a re-run off the provider. */
async function cachedStops(routeId: string): Promise<StopOnRoute[]> {
  const file = path.join(cacheDirectory, `${cityCode}-${routeId}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as StopOnRoute[];
  } catch {
    const stops = await call(() => provider.stops({ routeId, cityCode }));
    await writeFile(file, JSON.stringify(stops), { mode: 0o600 });
    return stops;
  }
}

async function call<T>(operation: () => Promise<T>): Promise<T> {
  if (upstreamCalls >= maxCalls) throw new Error(`upstream call ceiling ${maxCalls} reached; raise --max-calls deliberately`);
  if (upstreamCalls > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
  upstreamCalls += 1;
  return operation();
}

function renderMarkdown(summary: { generatedAt: string; cityCode: string; source: string; upstreamCalls: number; liveChecked: boolean; totals: Record<string, number>; variants: VariantReport[] }): string {
  const lines = [
    "# Jeju route compatibility",
    "",
    `Generated ${summary.generatedAt} · cityCode ${summary.cityCode} · ${summary.source}`,
    `${summary.upstreamCalls} upstream calls${summary.liveChecked ? " · live vehicles checked" : " · static classification only"}`,
    "",
    "Static classification does not depend on whether a bus was running when the",
    "audit ran. `SUPPORTED_WITH_WARNING` means the controller will record the ride",
    "but something needs the operator's attention; `UNSUPPORTED` means it refuses.",
    "",
    "| | count |",
    "|---|---|",
    `| TOTAL VARIANTS | ${summary.totals.variants} |`,
    `| SUPPORTED | ${summary.totals.supported} |`,
    `| SUPPORTED_WITH_WARNING | ${summary.totals.supportedWithWarning} |`,
    `| UNSUPPORTED | ${summary.totals.unsupported} |`,
    `| UNKNOWN | ${summary.totals.unknown} |`,
    "",
    "| Route | routeId | Direction | Stops | Shape | Verdict | Note |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const variant of summary.variants) {
    lines.push([
      variant.routeNo,
      `\`${variant.routeId}\``,
      `${variant.origin ?? "?"} → ${variant.destination ?? "?"}`,
      String(variant.stopCount),
      variant.topologyKind,
      variant.compatibility,
      variant.reason.replaceAll("|", "/"),
    ].join(" | ").replace(/^/, "| ").concat(" |"));
  }
  lines.push("", "This covers only the variants the audit was given. It is not a claim about every route in Jeju.", "");
  return lines.join("\n");
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
