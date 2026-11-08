/**
 * Does TAGO's stop arrival service (data.go.kr 15098530) answer for Jeju, and
 * do its predictions agree with TAGO's live positions? Read-only.
 *
 *   TAGO_SERVICE_KEY=… node --experimental-strip-types scripts/data-sources/arrival-probe.ts
 *
 * Runs from `.github/workflows/arrival-probe.yml` with the repository secret;
 * the agent environment has no key. Prints counts and route numbers only: no
 * vehicle number (the arrival contract has none) and never the key or a URL
 * carrying it. Without a key it prints BLOCKED and exits 0.
 *
 * Positions come from TAPSO's public `/v1/vehicles` at the same moment, so a
 * comparison is between two TAGO services, not against ground truth.
 */

import { readFileSync } from "node:fs";

import { ARRIVAL_ENDPOINT, parseArrivalResponse, predictionAgreesWithPositions } from "../../services/api/src/tagoArrival.ts";
import { routeStops, validateCatalog } from "../../services/api/src/transitCatalog.ts";

const key = process.env.TAGO_SERVICE_KEY?.trim();
const base = process.env.TAPSO_API_BASE ?? "https://tapso-api.vercel.app";
const rounds = Number(process.env.ROUNDS ?? "3");
const pauseMs = Number(process.env.PAUSE_MS ?? "45000");

if (!key) {
  console.log("BLOCKED: TAGO_SERVICE_KEY is not set; no call made.");
  process.exit(0);
}

const catalog = validateCatalog(JSON.parse(readFileSync(new URL("../../services/api/data/jeju-transit-catalog.json", import.meta.url), "utf8")));
const cityCode = catalog.source.cityCode;
// Sample stops spread along two well-observed routes (catalog, not invented).
const sample = [
  ["JEB405136521", [5, 15, 25, 35]],
  ["JEB405136522", [10, 30]],
] as const;
const probes = sample.flatMap(([routeId, sequences]) => {
  const variant = catalog.routes.find((route) => route.routeId === routeId);
  if (!variant) return [];
  const stops = routeStops(catalog, variant);
  return sequences.flatMap((sequence) => stops.filter((stop) => stop.sequence === sequence).map((stop) => ({ routeId, stop })));
});

async function arrivals(stopId: string) {
  const url = new URL(ARRIVAL_ENDPOINT);
  url.searchParams.set("serviceKey", key!);
  url.searchParams.set("cityCode", cityCode);
  url.searchParams.set("nodeId", stopId);
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("_type", "json");
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { return { http: response.status, parse: { ok: false as const, reason: `non-JSON body (${text.slice(0, 80).replace(/serviceKey=[^&\s]+/g, "serviceKey=…")})` } }; }
    return { http: response.status, parse: parseArrivalResponse(body) };
  } catch (error) {
    return { http: 0, parse: { ok: false as const, reason: (error as Error).name } };
  }
}

async function vehicleSequences(routeId: string): Promise<number[] | null> {
  try {
    const response = await fetch(`${base}/v1/vehicles?routeId=${encodeURIComponent(routeId)}&cityCode=${cityCode}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { items: { stopSequence?: number }[] };
    return body.items.flatMap((item) => (Number.isInteger(item.stopSequence) ? [item.stopSequence!] : []));
  } catch {
    return null;
  }
}

const totals = { calls: 0, answered: 0, rows: 0, rejected: 0, consistent: 0, inconsistent: 0, noPositions: 0, otherVariant: 0 };
for (let round = 1; round <= rounds; round += 1) {
  console.log(`\n## round ${round} at ${new Date().toISOString()}`);
  for (const { routeId, stop } of probes) {
    totals.calls += 1;
    const [result, positions] = await Promise.all([arrivals(stop.stopId), vehicleSequences(routeId)]);
    if (!result.parse.ok) {
      console.log(`${stop.stopId} (${stop.name}, seq ${stop.sequence} of ${routeId}): HTTP ${result.http}, ${result.parse.reason}`);
      continue;
    }
    totals.answered += 1;
    totals.rows += result.parse.rows.length;
    totals.rejected += result.parse.rejected.length;
    const routes = [...new Set(result.parse.rows.map((row) => row.routeNo))].sort();
    const mine = result.parse.rows.filter((row) => row.routeId === routeId);
    totals.otherVariant += result.parse.rows.length - mine.length;
    const verdicts = mine.map((row) => (positions === null ? "no_positions" : predictionAgreesWithPositions(row, stop.sequence, positions)));
    for (const verdict of verdicts) {
      if (verdict === "consistent") totals.consistent += 1;
      else if (verdict === "inconsistent") totals.inconsistent += 1;
      else totals.noPositions += 1;
    }
    console.log(`${stop.stopId} (${stop.name}, seq ${stop.sequence} of ${routeId}): HTTP ${result.http}, totalCount ${result.parse.totalCount}, rows ${result.parse.rows.length}, rejected ${result.parse.rejected.length}; route numbers ${routes.join(" ") || "none"}; this variant: ${mine.map((row) => `${row.stopsAway} stops/${row.providerEstimateSeconds}s`).join(", ") || "none"}; positions on this variant ${positions === null ? "unavailable" : positions.length}; agreement ${verdicts.join(", ") || "n/a"}`);
  }
  if (round < rounds) await new Promise((resolve) => setTimeout(resolve, pauseMs));
}
console.log(`\nTOTALS ${JSON.stringify(totals)}`);
console.log(totals.answered === 0 ? "VERDICT: no call answered usable JSON; Jeju coverage not established" : totals.rows === 0 ? "VERDICT: answered, but no prediction rows for the sampled Jeju stops" : "VERDICT: Jeju predictions returned; see agreement counts (two provider services, not ground truth)");
