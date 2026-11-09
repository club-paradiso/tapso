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
 *
 * The sample is chosen when the probe runs (`chooseArrivalProbeTargets`): for
 * the candidate route numbers (ROUTES, default 365,281,132,785,791) every
 * catalog variant's positions are read one request at a time (parallel bursts
 * draw TAGO HTTP 429), and only variants with a bus reported now are probed,
 * at stops 2 and 5 ahead of it. A fixed sample tested nothing at 06:13 on
 * 2026-11-09 (213 rows, 0 comparable). With no bus on any candidate it prints
 * NO_RUNNING_SAMPLE and makes no arrival call.
 */

import { readFileSync } from "node:fs";

import { ARRIVAL_ENDPOINT, chooseArrivalProbeTargets, parseArrivalResponse, predictionAgreesWithPositions, type ArrivalProbeCandidate } from "../../services/api/src/tagoArrival.ts";
import { routeStops, validateCatalog } from "../../services/api/src/transitCatalog.ts";

const key = process.env.TAGO_SERVICE_KEY?.trim();
const base = process.env.TAPSO_API_BASE ?? "https://tapso-api.vercel.app";
const rounds = Number(process.env.ROUNDS ?? "3");
const pauseMs = Number(process.env.PAUSE_MS ?? "45000");
const routeNumbers = (process.env.ROUTES ?? "365,281,132,785,791").split(",").map((value) => value.trim()).filter(Boolean);

if (!key) {
  console.log("BLOCKED: TAGO_SERVICE_KEY is not set; no call made.");
  process.exit(0);
}

const catalog = validateCatalog(JSON.parse(readFileSync(new URL("../../services/api/data/jeju-transit-catalog.json", import.meta.url), "utf8")));
const cityCode = catalog.source.cityCode;

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
    // A refused call is diagnosed by its body (data.go.kr explains 403s there), with the key redacted.
    const snippet = text.slice(0, 300).replace(/serviceKey=[^&\s"<]+/g, "serviceKey=…").replace(/\s+/g, " ");
    if (!response.ok) return { http: response.status, parse: { ok: false as const, reason: `HTTP ${response.status} body: ${snippet} (content-type ${response.headers.get("content-type") ?? "none"})` } };
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

// Control: the same key on the location service TAPSO already uses in production
// (BusLcInfoInqireService, dataset 15098533). If this answers and arrivals do not,
// the key is fine and 15098530 is not (yet) active on it. Never prints the key.
{
  const looksEncoded = /%[0-9A-Fa-f]{2}/.test(key);
  const control = new URL("https://apis.data.go.kr/1613000/BusLcInfoInqireService/getRouteAcctoBusLcList");
  control.searchParams.set("serviceKey", key);
  control.searchParams.set("cityCode", cityCode);
  control.searchParams.set("routeId", "JEB405136521");
  control.searchParams.set("numOfRows", "5");
  control.searchParams.set("_type", "json");
  let verdict = "network error";
  try {
    const response = await fetch(control, { signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    const code = /"resultCode"\s*:\s*"(\w+)"/.exec(text)?.[1] ?? /"returnReasonCode"\s*:\s*"(\w+)"/.exec(text)?.[1] ?? "none";
    verdict = `HTTP ${response.status}, code ${code}`;
  } catch (error) {
    verdict = (error as Error).name;
  }
  console.log(`CONTROL location service (15098533) with the same key: ${verdict}`);
  console.log(`KEY FORMAT: contains percent-escapes (looks like the Encoding key): ${looksEncoded ? "yes" : "no"}; length ${key.length}`);
}

// Choose the sample now: variants of the candidate route numbers with a bus reported at this moment.
const candidates: ArrivalProbeCandidate[] = [];
let positionReadsFailed = 0;
for (const variant of catalog.routes.filter((route) => routeNumbers.includes(route.routeNo))) {
  const positions = await vehicleSequences(variant.routeId); // one at a time
  if (positions === null) positionReadsFailed += 1;
  candidates.push({
    routeId: variant.routeId,
    routeNo: variant.routeNo,
    stops: routeStops(catalog, variant).map((stop) => ({ stopId: stop.stopId, name: stop.name, sequence: stop.sequence })),
    vehicleSequences: positions ?? [],
  });
}
const targets = chooseArrivalProbeTargets(candidates);
const running = candidates.filter((candidate) => candidate.vehicleSequences.length > 0).length;
console.log(`SAMPLE at ${new Date().toISOString()}: route numbers ${routeNumbers.join(" ")}; ${candidates.length} variants read, ${positionReadsFailed} reads failed, ${running} with a bus reported; ${targets.length} target stops`);
for (const target of targets) console.log(`  ${target.routeNo} ${target.routeId}: ${target.stopId} (${target.stopName}, seq ${target.stopSequence}), ${target.stopSequence - target.vehicleSequence} stops ahead of a bus at seq ${target.vehicleSequence}`);
if (targets.length === 0) {
  console.log(positionReadsFailed === candidates.length
    ? "NO_RUNNING_SAMPLE: every position read failed; nothing can be compared, no arrival call made"
    : "NO_RUNNING_SAMPLE: no bus reported on any candidate variant now; no arrival call made");
  process.exit(0);
}
const probes = targets.map((target) => ({ routeId: target.routeId, stop: { stopId: target.stopId, name: target.stopName, sequence: target.stopSequence } }));

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
