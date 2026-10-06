/**
 * Prints how the official 제주버스정보시스템 passenger station page is built, for
 * a handful of catalog stops, so the crosswalk extractor can be written
 * against evidence instead of a guess (`docs/validation/JEJU_BIS_TAGO_STOP_CROSSWALK.md`).
 *
 *   node --experimental-strip-types scripts/crosswalk/probe-bis-station-pages.ts
 *
 * Run by .github/workflows/jeju-stop-crosswalk.yml because the agent
 * environment cannot reach bus.jeju.go.kr. Read-only, one request per second,
 * the passenger-facing page only, no key, no vehicle data. Nothing here is a
 * runtime dependency and nothing is committed from it.
 *
 * Output lines:
 *   ## <station>: HTTP <status>; <content-type>; <bytes> bytes; title=<title>
 *   EXPECT <tago id> <catalog name>        what the catalog says this candidate should be
 *   NAME <full|place|absent> <context>      where the catalog name appears in the page
 *   COORD <lat>,<lng> <metres from catalog> decimal pairs in Jeju's range found in the page
 *   SCRIPT <src> / CODE <line>              how the page loads its station data
 */

import { readFileSync } from "node:fs";
import { distanceMeters, placeName } from "../../services/api/src/stopCrosswalk.ts";

const BIS = "https://bus.jeju.go.kr";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type CatalogStop = { id: string; name: string; lat?: number | null; lng?: number | null };
const catalog = JSON.parse(readFileSync(new URL("../../services/api/data/jeju-transit-catalog.json", import.meta.url), "utf8")) as { stops: CatalogStop[] };
const byId = new Map(catalog.stops.map((stop) => [stop.id, stop]));

// The owner's own example pair (opposite poles of one place), another opposite
// pair, a stop without a direction marker, and one candidate id the catalog
// does not contain, to see what "no such station" looks like.
const SAMPLE = ["JEB405000314", "JEB405000315", "JEB405000006", "JEB405000007", "JEB406000002", "JEB405009999"];

async function get(url: string): Promise<{ status: number; type: string; body: string; finalUrl: string }> {
  await pause(1_000);
  try {
    const response = await fetch(url, {
      // Run 1 (no language header) rendered English names; the catalog is Korean.
      headers: { "user-agent": "TAPSO-crosswalk-probe/1.0 (+https://github.com/club-paradiso/tapso)", "accept-language": "ko-KR,ko;q=0.9" },
      signal: AbortSignal.timeout(20_000),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const type = response.headers.get("content-type") ?? "";
    const declared = /charset=["']?([\w-]+)/i.exec(type)?.[1] ?? "utf-8";
    let decoder: TextDecoder;
    try {
      decoder = new TextDecoder(declared.toLowerCase());
    } catch {
      decoder = new TextDecoder("utf-8");
    }
    return { status: response.status, type, body: decoder.decode(bytes), finalUrl: response.url };
  } catch (error) {
    return { status: 0, type: "", body: String(error), finalUrl: url };
  }
}

function context(body: string, index: number, needle: string): string {
  return body.slice(Math.max(0, index - 160), index + needle.length + 160).replace(/\s+/g, " ");
}

const INTERESTING = /ajax|\$\.(get|post)|fetch\(|url\s*[:=]|station_?id|stationId|stationNm|station_?nm|localX|localY|lat|lng|longitude|latitude|ridebooking|mode/i;

for (const tagoId of SAMPLE) {
  const station = tagoId.slice(3);
  const stop = byId.get(tagoId);
  const url = `${BIS}/mobile/station/detailStation/${station}?type=station&mode=ridebooking`;
  const page = await get(url);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.body)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  console.log(`\n## ${station}: HTTP ${page.status}; ${page.type}; ${page.body.length} bytes; final=${page.finalUrl}; title=${title}`);
  console.log(`EXPECT ${tagoId} ${stop ? stop.name : "(not in catalog)"}`);
  if (page.status !== 200) {
    console.log(page.body.slice(0, 300).replace(/\s+/g, " "));
    continue;
  }
  if (stop) {
    const full = page.body.indexOf(stop.name);
    const place = page.body.indexOf(placeName(stop.name));
    if (full >= 0) console.log(`NAME full ${context(page.body, full, stop.name)}`);
    else if (place >= 0) console.log(`NAME place ${context(page.body, place, placeName(stop.name))}`);
    else console.log("NAME absent");
  }
  const pairs = [...page.body.matchAll(/(3[34]\.\d{4,})\D{1,40}?(12[67]\.\d{4,})|(12[67]\.\d{4,})\D{1,40}?(3[34]\.\d{4,})/g)].slice(0, 8);
  for (const match of pairs) {
    const lat = Number(match[1] ?? match[4]);
    const lng = Number(match[2] ?? match[3]);
    const delta = stop && typeof stop.lat === "number" && typeof stop.lng === "number"
      ? `${Math.round(distanceMeters({ lat: stop.lat, lng: stop.lng }, { lat, lng }))} m`
      : "n/a";
    console.log(`COORD ${lat},${lng} ${delta}`);
  }
  const scripts = [...page.body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => new URL(match[1]!, url).href);
  for (const src of scripts) console.log(`SCRIPT ${src}`);
  const inline = [...page.body.matchAll(/<script(?![^>]+src)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]!).join("\n");
  let printed = 0;
  inline.split(/\r?\n/).forEach((line, index) => {
    if (printed >= 80 || !INTERESTING.test(line)) return;
    printed += 1;
    console.log(`CODE inline:${index + 1}: ${line.trim().slice(0, 300)}`);
  });
  // The raw markup around the station id, so an extractor targets real elements.
  const at = page.body.indexOf(`>${station}`) >= 0 ? page.body.indexOf(`>${station}`) : page.body.lastIndexOf(station);
  if (at >= 0) console.log(`HTML ${page.body.slice(Math.max(0, at - 700), at + 500).replace(/\s+/g, " ")}`);
  const hidden = [...page.body.matchAll(/<input[^>]+type=["']hidden["'][^>]*>/gi)].map((match) => match[0]).slice(0, 12);
  for (const input of hidden) console.log(`HIDDEN ${input.replace(/\s+/g, " ")}`);
  // Visible text, briefly: what a rider sees on the page.
  const text = page.body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  console.log(`TEXT ${text.slice(0, 600)}`);
}
