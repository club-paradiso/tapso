/**
 * Prints what data.go.kr publishes about the TAGO bus services TAPSO uses or
 * may use: dataset ids, operation names, service URLs, and the text around
 * each operation (request and response fields). Public documentation only:
 * no service key, and no call to the API itself.
 *
 *   node --experimental-strip-types scripts/data-sources/tago-docs.ts
 *
 * Run by .github/workflows/data-source-probe.yml, because the agent
 * environment cannot reach data.go.kr. The output is evidence for
 * docs/DATA_SOURCES.md, labelled REPORTED-OFFICIAL until a credentialed call
 * confirms it.
 */

const DATASETS = [
  "국토교통부_(TAGO)_버스정류소정보",
  "국토교통부_(TAGO)_버스도착정보",
  "국토교통부_(TAGO)_버스노선정보",
];

async function get(url: string): Promise<{ status: number; body: string }> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "TAPSO-data-source-probe/1.0", accept: "text/html,application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    return { status: response.status, body: await response.text() };
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
    .replace(/\s+/g, " ");
}

const unique = <T>(values: T[]) => [...new Set(values)];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

for (const name of DATASETS) {
  const search = await get(`https://www.data.go.kr/tcs/dss/selectDataSetList.do?dType=API&keyword=${encodeURIComponent(name)}`);
  const ids = unique([...search.body.matchAll(/\/data\/(\d{8})\/openapi\.do/g)].map((match) => match[1]!));
  console.log(`\n## ${name}: search HTTP ${search.status}; datasets ${ids.join(", ") || "(none found)"}`);
  for (const id of ids.slice(0, 2)) {
    await pause(1_000);
    const page = await get(`https://www.data.go.kr/data/${id}/openapi.do`);
    const text = plain(page.body);
    const title = /<title>([^<]*)<\/title>/i.exec(page.body)?.[1]?.replace(/\s+/g, " ").trim();
    console.log(`\n### dataset ${id}: HTTP ${page.status}; ${title ?? "(no title)"}`);
    console.log(`service URLs: ${unique([...text.matchAll(/https?:\/\/apis\.data\.go\.kr\/1613000\/[A-Za-z]+/g)].map((m) => m[0])).join(", ")}`);
    const operations = unique([...text.matchAll(/\bget[A-Z][A-Za-z]+\b/g)].map((m) => m[0]));
    console.log(`operations: ${operations.join(", ")}`);
    const links = unique([...page.body.matchAll(/(?:href|src|url)\s*[=:]\s*["']([^"']*(?:swagger|Detail|oas|openapi)[^"']*)["']/gi)].map((m) => m[1]!));
    console.log(`documentation links: ${links.slice(0, 20).join(" | ")}`);
    for (const operation of operations) {
      const at = text.indexOf(operation);
      console.log(`--- ${operation}: ${text.slice(at, at + 1_500)}`);
    }
  }
}

export {};
