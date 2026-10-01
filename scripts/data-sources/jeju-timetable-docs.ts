/**
 * Prints what Jeju's official sources publish about bus timetables (first and
 * last departures) and on what terms, because TAGO's route info carries no
 * service day for Jeju (`VERIFIED` 2026-10-01, 50 variants of 102, 202, 282,
 * 365 and 800). Public pages only: no key, no API call, and no timetable file
 * is downloaded.
 *
 *   node --experimental-strip-types scripts/data-sources/jeju-timetable-docs.ts
 *
 * Run by .github/workflows/data-source-probe.yml, because the agent
 * environment cannot reach data.go.kr or bus.jeju.go.kr. The output is
 * evidence for docs/DATA_SOURCES.md, labelled REPORTED-OFFICIAL. Nothing it
 * prints licenses the data: the terms it finds are recorded before any use.
 *
 * Output lines:
 *   ## <source>: HTTP <status>; <page title>
 *   DATASETS <search>: <id> <id> ...
 *   META <label>: <value>       data.go.kr's dataset table, verbatim
 *   LINK <text> → <href>        links that name a timetable, a download or terms
 *   NEAR <word>: <text>         the page's own words around <word>
 */

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const unique = <T>(values: T[]) => [...new Set(values)];

/** Decodes with the page's declared charset; Korean public sites still serve EUC-KR. */
async function get(url: string): Promise<{ status: number; body: string }> {
  await pause(1_000);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "TAPSO-data-source-probe/1.0", accept: "text/html,application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 4_096));
    const declared = /charset=["']?([\w-]+)/i.exec(response.headers.get("content-type") ?? "")?.[1]
      ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]
      ?? "utf-8";
    let decoder: TextDecoder;
    try {
      decoder = new TextDecoder(declared.toLowerCase());
    } catch {
      decoder = new TextDecoder("utf-8");
    }
    return { status: response.status, body: decoder.decode(bytes) };
  } catch (error) {
    return { status: 0, body: String(error) };
  }
}

function plain(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

const title = (html: string) => /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? "(no title)";

function printNear(text: string, words: string[], span = 400): void {
  for (const word of words) {
    const at = text.indexOf(word);
    console.log(`NEAR ${word}: ${at < 0 ? "(not on the page)" : text.slice(Math.max(0, at - 120), at + span)}`);
  }
}

function printLinks(html: string, base: string, pattern: RegExp, limit = 25): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1]!.trim();
    const text = plain(match[2] ?? "");
    if (!pattern.test(href) && !pattern.test(text)) continue;
    let absolute = href;
    try {
      absolute = new URL(href, base).toString();
    } catch {
      // Kept as written: a javascript: handler or a malformed link is still evidence.
    }
    if (found.has(absolute)) continue;
    found.add(absolute);
    if (found.size <= limit) console.log(`LINK ${text || "(no text)"} → ${absolute}`);
  }
  return [...found];
}

/** data.go.kr shows a dataset's metadata as a table of <th> labels and <td> values. */
function printMeta(html: string): void {
  let rows = 0;
  for (const match of html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const label = plain(match[1] ?? "");
    const value = plain(match[2] ?? "");
    if (!label || label.length > 40) continue;
    console.log(`META ${label}: ${value.slice(0, 400)}`);
    if (++rows >= 40) break;
  }
  if (rows === 0) console.log("META (no label/value table found)");
}

const PORTAL = "https://www.data.go.kr";

async function portalSearch(keyword: string, type: "API" | "FILE"): Promise<string[]> {
  const search = await get(`${PORTAL}/tcs/dss/selectDataSetList.do?dType=${type}&keyword=${encodeURIComponent(keyword)}`);
  const ids = unique([...search.body.matchAll(/\/data\/(\d{5,9})\/(?:openapi|fileData)\.do/g)].map((match) => match[1]!));
  console.log(`\nDATASETS ${type} "${keyword}" (HTTP ${search.status}): ${ids.join(" ") || "(none found)"}`);
  return ids;
}

async function portalDataset(id: string): Promise<void> {
  // A dataset is either an Open API or a file; the other path answers with a page that has no provider.
  const statuses: string[] = [];
  for (const kind of ["fileData", "openapi"] as const) {
    const page = await get(`${PORTAL}/data/${id}/${kind}.do`);
    const text = plain(page.body);
    statuses.push(`${kind} HTTP ${page.status}`);
    if (page.status !== 200 || !text.includes("제공기관") || !/제주/.test(text)) continue;
    console.log(`\n## data.go.kr ${id} (${kind}): HTTP ${page.status}; ${title(page.body)}`);
    printMeta(page.body);
    printLinks(page.body, PORTAL, /시간표|timetable|schedule|bus\.jeju|jejudatahub|download|다운로드/i);
    printNear(text, ["시간표", "첫차", "막차", "이용허락범위", "출처"], 300);
    return;
  }
  console.log(`\n## data.go.kr ${id}: no Jeju dataset page answered (${statuses.join(", ")})`);
}

// 1. The national portal: what Jeju publishes as timetables, current or dated.
const searched = unique([
  ...(await portalSearch("제주 버스 시간표", "FILE")),
  ...(await portalSearch("제주 버스 시간표", "API")),
  ...(await portalSearch("제주특별자치도 버스", "API")),
]);
// 3043887: "제주버스시간표정보" (file), 15058442: "버스정보시스템" (API), named by the portal's own search results.
for (const id of unique(["3043887", "15058442", ...searched]).slice(0, 10)) await portalDataset(id);

// 2. Jeju's bus information system: the passenger-facing timetable and its terms.
const BIS = "https://bus.jeju.go.kr";
for (const path of ["/publicTrafficInformation/generalBusSchedule?viewtype=2", "/publicTrafficInformation/generalBusSchedule"]) {
  const page = await get(`${BIS}${path}`);
  console.log(`\n## bus.jeju.go.kr${path}: HTTP ${page.status}; ${title(page.body)}`);
  if (page.status !== 200) {
    console.log(page.body.slice(0, 300));
    continue;
  }
  const text = plain(page.body);
  printNear(text, ["시간표", "첫차", "막차", "기점", "엑셀", "다운로드", "저작권", "공공누리", "이용약관"], 400);
  const terms = printLinks(page.body, BIS, /저작권|copyright|약관|policy|공공누리|kogl/i);
  printLinks(page.body, BIS, /excel|xls|download|다운로드|schedule|시간표/i);
  for (const url of terms.filter((link) => link.startsWith(BIS)).slice(0, 3)) {
    const policy = await get(url);
    console.log(`\n## terms ${url}: HTTP ${policy.status}; ${title(policy.body)}`);
    printNear(plain(policy.body), ["저작권", "공공누리", "출처", "상업", "변경", "무단"], 500);
  }
  break;
}

export {};
