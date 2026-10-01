/**
 * Reads the published service day of named Jeju route numbers from TAPSO's own
 * production API (`GET /v1/route-info`, TAGO `getRouteInfoIem` behind it), so
 * the first live values are on record. Public route data only.
 *
 *   node --experimental-strip-types scripts/data-sources/route-info.ts [routeNo ...]
 *
 * Output lines:
 *   HOURS <routeNo> <routeId> first <HH:MM|-> last <HH:MM|-> headway <wd>/<sat>/<sun> HTTP <status> <start> → <end>
 * A 404 before the endpoint is deployed, or for a route TAGO publishes no
 * service day for, is printed as such and is not an error.
 */

const BASE = process.env.TAPSO_API_BASE ?? "https://tapso-api.vercel.app";
const CITY = "39";
const numbers = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["102", "202", "282", "365", "800"];
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
  for (const variant of items.filter((item) => String(item.routeNumber) === number)) {
    const info = await json(`/v1/route-info?routeId=${encodeURIComponent(variant.routeId)}&cityCode=${CITY}`);
    const item = info.body?.item ?? {};
    const headway = item.headwayMinutes ?? {};
    console.log(
      `HOURS ${number} ${variant.routeId} first ${item.firstDeparture ?? "-"} last ${item.lastDeparture ?? "-"} `
      + `headway ${headway.weekday ?? "-"}/${headway.saturday ?? "-"}/${headway.sunday ?? "-"} HTTP ${info.status} `
      + `${variant.startStopName ?? "?"} → ${variant.endStopName ?? "?"}`
      + (info.status === 200 ? "" : ` ${info.body?.error ?? ""}`),
    );
  }
}
console.log("CAPTURE_END");

export {};
