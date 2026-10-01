/**
 * Captures the topology of named Jeju route numbers from TAPSO's own
 * production API: every official variant, its ordered stops and coordinates.
 * Public transit data only; no vehicle is requested.
 *
 *   node --experimental-strip-types scripts/data-sources/jeju-routes.ts [routeNo ...]
 *
 * Run by .github/workflows/data-source-probe.yml, because the agent
 * environment cannot reach the production API. Output lines:
 *   VARIANT <routeNo> <routeId> <stopCount> <topology> <start> → <end>
 *   STOP <routeId> <sequence> <stopId> <lat> <lng> <name>
 * scripts/data-sources/route-snapshot.ts turns a saved log into
 * fixtures/jeju/route-snapshot.json. Requests are paced well under the API's
 * 120 per minute per caller.
 */

const BASE = process.env.TAPSO_API_BASE ?? "https://tapso-api.vercel.app";
const CITY = "39";
const DEFAULT_NUMBERS = [
  "101", "102", "111", "112", "121", "122", "131", "132", "151", "152", "181", "182",
  "201", "202", "211", "212", "221", "222", "231", "232", "240", "251", "252", "260",
  "281", "282", "290", "291", "292", "295", "365", "800", "810", "820",
];
const numbers = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_NUMBERS;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(path: string): Promise<{ status: number; body: any }> {
  await pause(900);
  try {
    const response = await fetch(new URL(path, BASE), {
      headers: { accept: "application/json", "user-agent": "TAPSO-data-source-probe/1.0" },
      signal: AbortSignal.timeout(25_000),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch (error) {
    return { status: 0, body: { error: String(error) } };
  }
}

console.log(`CAPTURE ${new Date().toISOString()} ${BASE}`);
for (const number of numbers) {
  const routes = await json(`/v1/routes?cityCode=${CITY}&routeNo=${encodeURIComponent(number)}`);
  const items: any[] = Array.isArray(routes.body?.items) ? routes.body.items : [];
  const exact = items.filter((item) => String(item.routeNumber) === number);
  console.log(`ROUTENO ${number} HTTP ${routes.status} variants ${exact.length} (listed ${items.length})`);
  for (const variant of exact) {
    const stops = await json(`/v1/stops?routeId=${encodeURIComponent(variant.routeId)}&cityCode=${CITY}`);
    const list: any[] = Array.isArray(stops.body?.items) ? stops.body.items : [];
    const topology = stops.body?.meta?.topology?.kind ?? "unknown";
    console.log(`VARIANT ${number} ${variant.routeId} ${list.length} ${topology} ${variant.startStopName ?? "?"} → ${variant.endStopName ?? "?"} HTTP ${stops.status}`);
    for (const stop of list) {
      console.log(`STOP ${variant.routeId} ${stop.sequence} ${stop.stopId} ${stop.latitude ?? "-"} ${stop.longitude ?? "-"} ${stop.name}`);
    }
  }
}
console.log("CAPTURE_END");

export {};
