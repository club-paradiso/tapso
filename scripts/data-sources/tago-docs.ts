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

/*
 * Each dataset page links its machine-readable OpenAPI document
 * (`/catalog/<id>/openapi.json`). Print every operation with its parameters
 * and response fields, so the full contract is on record, not only the first
 * operation the HTML page shows.
 */
type OpenApi = { paths?: Record<string, Record<string, { summary?: string; parameters?: Array<{ name?: string; required?: boolean; description?: string }>; responses?: Record<string, unknown> }>> };

function fieldNames(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((child) => fieldNames(child, out));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties" && value && typeof value === "object") Object.keys(value).forEach((name) => out.add(name));
      fieldNames(value, out);
    }
  }
  return out;
}

for (const id of ["15098534", "15098529", "15098530"]) {
  await pause(1_000);
  const spec = await get(`https://www.data.go.kr/catalog/${id}/openapi.json`);
  console.log(`\n## openapi.json ${id}: HTTP ${spec.status}`);
  let parsed: OpenApi | undefined;
  try {
    parsed = JSON.parse(spec.body) as OpenApi;
  } catch {
    console.log(spec.body.slice(0, 400));
    continue;
  }
  for (const [path, methods] of Object.entries(parsed.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const parameters = (operation.parameters ?? []).map((p) => `${p.name}${p.required ? "*" : ""}`).join(", ");
      const fields = [...fieldNames(operation.responses)].filter((name) => !["response", "header", "body", "items", "item"].includes(name));
      console.log(`OP ${method.toUpperCase()} ${path} — ${operation.summary ?? ""}\n   params: ${parameters}\n   fields: ${fields.join(", ")}`);
    }
  }
}

/* Kakao Maps' published web guide, for the map link URL shapes TAPSO parses. */
await pause(1_000);
const kakao = await get("https://apis.map.kakao.com/web/guide/");
const kakaoText = plain(kakao.body);
console.log(`\n## Kakao Maps web guide: HTTP ${kakao.status}`);
for (const needle of ["link/map", "link/to", "link/search", "link/roadview"]) {
  const at = kakaoText.indexOf(needle);
  console.log(`--- ${needle}: ${at < 0 ? "(not found)" : kakaoText.slice(Math.max(0, at - 300), at + 500)}`);
}
