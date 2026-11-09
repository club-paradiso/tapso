/**
 * Bounded, read-only live observation through TAPSO's own public API.
 *
 *   node --experimental-strip-types scripts/live-evidence/observe.ts \
 *     --routes 365,281,3002,5001,800-1 --minutes 10 --interval 30
 *
 * For each route number it reads every catalog variant from `/v1/vehicles`
 * (which reads TAGO through a 20 s cache), checks each snapshot with
 * `liveFeedQuality`, folds each vehicle's receipts with `assessFeedHistory`,
 * and cross-checks the presence of clean vehicles against NightGuard read
 * from the committed timetable bundle at the same instant.
 *
 * Reads are sequential (one request in flight): parallel bursts draw TAGO HTTP
 * 429, which would make the observer a cause of the failures it reports.
 *
 * Privacy: vehicle numbers are replaced by a salted SHA-256 prefix whose salt
 * is random per run and never written, so pseudonyms cannot be joined across
 * runs. The raw per-poll record (with pseudonyms only) goes to ignored
 * `work/live-evidence/`; the committed artifact is the summary.
 *
 * Label: OBSERVED (through TAPSO's public API; receipt times only, TAGO
 * publishes no observation time). Not ground truth about where buses were.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { VehicleObservation } from "../../services/api/src/domain.ts";
import { assessFeedHistory, assessSnapshot, type FeedIssue, type HistoryIssue } from "../../services/api/src/liveFeedQuality.ts";
import { nightGuardView } from "../../services/api/src/nightGuard.ts";
import { validateTimetableBundle } from "../../services/api/src/officialTimetable.ts";
import { validateHolidayCalendar } from "../../services/api/src/serviceDay.ts";
import { aggregateRouteSchedule } from "../../services/api/src/transitEvidence.ts";
import { routeStops, validateCatalog } from "../../services/api/src/transitCatalog.ts";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index]!.replace(/^--/, ""), process.argv[index + 1] ?? "");
const base = args.get("base") ?? "https://tapso-api.vercel.app";
const routeNumbers = (args.get("routes") ?? "365").split(",").filter(Boolean);
const minutes = Number(args.get("minutes") ?? "10");
const intervalSeconds = Number(args.get("interval") ?? "30");
const out = args.get("out") ?? "artifacts/live-evidence";

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const catalog = validateCatalog(read("../../services/api/data/jeju-transit-catalog.json"));
const bundle = validateTimetableBundle(read("../../services/api/data/jeju-timetables.json")).bundle;
const calendar = validateHolidayCalendar(read("../../services/api/data/kr-public-holidays.json"));

const salt = randomBytes(16);
const pseudonym = (vehicleId: string): string => createHash("sha256").update(salt).update(vehicleId).digest("hex").slice(0, 10);

const variantsByNumber = new Map(routeNumbers.map((routeNo) => [routeNo, catalog.routes.filter((route) => route.routeNo === routeNo)]));
const stopsByRoute = new Map([...variantsByNumber.values()].flat().map((variant) => [variant.routeId, routeStops(catalog, variant)]));

interface PollRecord {
  at: string;
  routeNo: string;
  requests: number;
  failures: Record<string, number>;
  latencyMs: number[];
  vehicles: number;
  clean: number;
  suspect: number;
  byIssue: Partial<Record<FeedIssue, number>>;
  schedule: string | null;
  scheduleFreshness: string;
}

const polls: PollRecord[] = [];
const histories = new Map<string, VehicleObservation[]>();
const rawReceipts: Array<{ at: string; routeId: string; vehicle: string; stopSequence?: number; lat?: number; lng?: number }> = [];

async function fetchVariant(routeId: string): Promise<{ ok: true; rows: VehicleObservation[]; ms: number } | { ok: false; reason: string; ms: number }> {
  const started = performance.now();
  try {
    const response = await fetch(`${base}/v1/vehicles?routeId=${encodeURIComponent(routeId)}&cityCode=${catalog.source.cityCode}`, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "tapso-live-evidence/1" } });
    const ms = Math.round(performance.now() - started);
    if (!response.ok) return { ok: false, reason: `http_${response.status}`, ms };
    const body = (await response.json()) as { items: VehicleObservation[] };
    return { ok: true, rows: body.items, ms };
  } catch (error) {
    return { ok: false, reason: (error as Error).name === "TimeoutError" ? "timeout" : "network", ms: Math.round(performance.now() - started) };
  }
}

const deadline = Date.now() + minutes * 60_000;
const startedAt = new Date().toISOString();
while (Date.now() < deadline) {
  const tick = Date.now();
  for (const [routeNo, variants] of variantsByNumber) {
    // One read at a time: parallel bursts drew TAGO HTTP 429 on 2026-11-09, so the
    // observer itself must not be a source of the failures it measures.
    const results: Awaited<ReturnType<typeof fetchVariant>>[] = [];
    for (const variant of variants) results.push(await fetchVariant(variant.routeId));
    const rows = results.flatMap((result) => (result.ok ? result.rows : []));
    const failures: Record<string, number> = {};
    for (const result of results) if (!result.ok) failures[result.reason] = (failures[result.reason] ?? 0) + 1;
    const quality = assessSnapshot(rows, stopsByRoute);
    const at = new Date();
    for (const row of rows) {
      const key = `${pseudonym(row.vehicleId)}|${row.routeId}`;
      const pseudo = { ...row, vehicleId: pseudonym(row.vehicleId) };
      histories.set(key, [...(histories.get(key) ?? []), pseudo]);
      rawReceipts.push({ at: at.toISOString(), routeId: row.routeId, vehicle: pseudo.vehicleId, stopSequence: row.stopSequence, lat: row.latitude, lng: row.longitude });
    }
    const guard = nightGuardView(bundle, calendar, routeNo, at);
    polls.push({
      at: at.toISOString(),
      routeNo,
      requests: results.length,
      failures,
      latencyMs: results.map((result) => result.ms),
      vehicles: rows.length,
      clean: quality.clean,
      suspect: quality.suspect,
      byIssue: quality.byIssue,
      schedule: aggregateRouteSchedule(guard.entries)?.status ?? null,
      scheduleFreshness: guard.freshness,
    });
  }
  const wait = intervalSeconds * 1_000 - (Date.now() - tick);
  if (wait > 0 && Date.now() + wait < deadline) await new Promise((resolve) => setTimeout(resolve, wait));
  else if (wait > 0) break;
}

// Per-vehicle history: content changes measure how often the provider's row changed, by receipt.
const historyResults = [...histories.values()].map((receipts) => {
  const variant = catalog.routes.find((route) => route.routeId === receipts[0]!.routeId);
  const loop = variant && variant.topology !== "linear" ? (variant.sequences?.at(-1) ?? variant.stops.length) : undefined;
  const result = assessFeedHistory(receipts, loop);
  let changes = 0;
  for (let index = 1; index < receipts.length; index += 1) {
    const [a, b] = [receipts[index - 1]!, receipts[index]!];
    if (a.stopSequence !== b.stopSequence || a.latitude !== b.latitude || a.longitude !== b.longitude) changes += 1;
  }
  return { ...result, contentChanges: changes };
});

const latencies = polls.flatMap((poll) => poll.latencyMs).sort((left, right) => left - right);
const quantile = (q: number): number | null => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))]! : null);
const sum = <T>(items: T[], pick: (item: T) => number): number => items.reduce((total, item) => total + pick(item), 0);
const byRoute = routeNumbers.map((routeNo) => {
  const mine = polls.filter((poll) => poll.routeNo === routeNo);
  const issues: Partial<Record<FeedIssue, number>> = {};
  for (const poll of mine) for (const [issue, count] of Object.entries(poll.byIssue)) issues[issue as FeedIssue] = (issues[issue as FeedIssue] ?? 0) + (count ?? 0);
  const histories = historyResults.filter((history) => variantsByNumber.get(routeNo)!.some((variant) => variant.routeId === history.routeId));
  const historyIssues: Partial<Record<HistoryIssue, number>> = {};
  for (const history of histories) for (const issue of history.issues) historyIssues[issue] = (historyIssues[issue] ?? 0) + 1;
  const scheduleCounts: Record<string, number> = {};
  for (const poll of mine) scheduleCounts[poll.schedule ?? "no_usable_schedule"] = (scheduleCounts[poll.schedule ?? "no_usable_schedule"] ?? 0) + 1;
  return {
    routeNo,
    variants: variantsByNumber.get(routeNo)!.length,
    polls: mine.length,
    requests: sum(mine, (poll) => poll.requests),
    failedRequests: sum(mine, (poll) => Object.values(poll.failures).reduce((a, b) => a + b, 0)),
    pollsWithCleanVehicles: mine.filter((poll) => poll.clean > 0).length,
    vehicleRows: sum(mine, (poll) => poll.vehicles),
    suspectRows: sum(mine, (poll) => poll.suspect),
    issues,
    distinctVehicles: histories.length,
    historyIssues,
    receiptsPerContentChange: (() => {
      const changes = sum(histories, (history) => history.contentChanges);
      const steps = sum(histories, (history) => Math.max(0, history.receipts - 1));
      return changes > 0 ? Number((steps / changes).toFixed(2)) : null;
    })(),
    scheduleStatusByPoll: scheduleCounts,
    // Cross-check: clean vehicles while the timetable says no service is due.
    pollsWithCleanVehiclesWhileScheduleSaysLastDeparted: mine.filter((poll) => poll.clean > 0 && poll.schedule === "last_scheduled_departed").length,
    pollsWithCleanVehiclesBeforeFirstDeparture: mine.filter((poll) => poll.clean > 0 && poll.schedule === "before_first_departure").length,
    pollsWithoutVehiclesWhileScheduleRemains: mine.filter((poll) => poll.vehicles === 0 && poll.schedule === "scheduled_departures_remain").length,
  };
});

const summary = {
  schemaVersion: "tapso-live-evidence-summary-v1",
  label: "OBSERVED",
  source: `${base}/v1/vehicles (TAGO via TAPSO's 20 s cache)`,
  note: "Receipt times only; TAGO publishes no observation time. Vehicle numbers pseudonymised with a per-run salt that was not kept. Not ground truth.",
  startedAt,
  endedAt: new Date().toISOString(),
  intervalSeconds,
  catalogVersion: catalog.catalogVersion,
  timetableBundle: bundle.bundleVersion,
  requests: latencies.length,
  latencyMs: { p50: quantile(0.5), p90: quantile(0.9), p99: quantile(0.99), max: latencies.at(-1) ?? null },
  routes: byRoute,
};

mkdirSync(out, { recursive: true });
mkdirSync("work/live-evidence", { recursive: true });
const stamp = startedAt.replace(/[:.]/g, "").slice(0, 15);
writeFileSync(`${out}/${stamp}-summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(`work/live-evidence/${stamp}-raw.json`, `${JSON.stringify({ polls, receipts: rawReceipts }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
