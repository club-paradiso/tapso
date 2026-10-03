/**
 * Prints how bus.jeju.go.kr's timetable page lists routes and serves each
 * route's XLSX, read from the page and the scripts it loads. Nothing is
 * downloaded and no endpoint is called: this is the evidence a downloader is
 * written against, so that no request path or parameter is guessed.
 *
 *   node --experimental-strip-types scripts/data-sources/jeju-timetable-endpoints.ts
 *
 * Run by .github/workflows/data-source-probe.yml, because the agent
 * environment cannot reach bus.jeju.go.kr.
 *
 * Output lines:
 *   ## <url>: HTTP <status>; <content-type>; <bytes> bytes
 *   SCRIPT <src>                       a script the page loads
 *   FORM <action> <method>             a form on the page
 *   INPUT <name>=<value>               its fields
 *   CODE <file>:<line>: <text>         script lines that name a request, a download or a route list
 */

const BIS = "https://bus.jeju.go.kr";
const PAGE = `${BIS}/publicTrafficInformation/generalBusSchedule`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(url: string): Promise<{ status: number; type: string; body: string }> {
  await pause(1_000);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "TAPSO-data-source-probe/1.0" },
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
    return { status: response.status, type, body: decoder.decode(bytes) };
  } catch (error) {
    return { status: 0, type: "", body: String(error) };
  }
}

const INTERESTING = /ajax|\$\.(get|post)|fetch\(|url\s*[:=]|location\.href|\.action|\.do\b|excel|xls|download|schedule|busType|routeNo|routeId|route_?num|viewtype|form|submit|onclick/i;

function printCode(file: string, source: string, limit = 160): void {
  let printed = 0;
  source.split(/\r?\n/).forEach((line, index) => {
    if (printed >= limit || !INTERESTING.test(line)) return;
    printed += 1;
    console.log(`CODE ${file}:${index + 1}: ${line.trim().slice(0, 300)}`);
  });
  if (printed >= limit) console.log(`CODE ${file}: (truncated at ${limit} lines)`);
}

for (const url of [PAGE, `${PAGE}?viewtype=2`]) {
  const page = await get(url);
  console.log(`\n## ${url}: HTTP ${page.status}; ${page.type}; ${page.body.length} bytes`);
  if (page.status !== 200) {
    console.log(page.body.slice(0, 300));
    continue;
  }
  const scripts = [...page.body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => new URL(match[1]!, url).href);
  for (const src of scripts) console.log(`SCRIPT ${src}`);
  for (const form of page.body.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = form[1]!;
    console.log(`FORM ${/action=["']([^"']*)/i.exec(attrs)?.[1] ?? "(none)"} ${/method=["']([^"']*)/i.exec(attrs)?.[1] ?? "get"}`);
    for (const input of form[2]!.matchAll(/<(?:input|select)\b[^>]*name=["']([^"']+)["'][^>]*?(?:value=["']([^"']*)["'])?/gi)) {
      console.log(`INPUT ${input[1]}=${input[2] ?? ""}`);
    }
  }
  const inline = [...page.body.matchAll(/<script(?![^>]+src)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]!).join("\n");
  printCode("inline", inline, 250);
  // Markup that triggers a request: onclick handlers and data attributes.
  printCode("markup", page.body.replace(/<script[\s\S]*?<\/script>/gi, ""), 80);
  for (const src of scripts.filter((link) => link.startsWith(BIS) && !/jquery|bootstrap|swiper|slick|polyfill/i.test(link))) {
    const script = await get(src);
    console.log(`\n## ${src}: HTTP ${script.status}; ${script.type}; ${script.body.length} bytes`);
    if (script.status === 200) printCode(new URL(src).pathname, script.body);
  }
  break;
}

export {};
