/**
 * Injects the server-rendered page into dist/index.html.
 *
 * Runs after `vite build` and `vite build --ssr`. The marketing page is static
 * content with small interactive demos, so shipping it as HTML makes the hero
 * and every section readable before JavaScript loads (and to crawlers and
 * link previews), then `hydrateRoot` in src/main.tsx attaches the demos.
 *
 * It also refuses to ship copy that would misrepresent the product: the same
 * guard `test/marketingCopy.test.ts` applies to the sources, here applied to
 * the HTML a visitor actually receives.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const ssrDir = join(root, "dist-ssr");

const { render, FORBIDDEN_CLAIMS } = await import(pathToFileURL(join(ssrDir, "entry-server.js")).href);


const html = render();
const text = html.replace(/<[^>]+>/g, " ");
const hits = FORBIDDEN_CLAIMS.filter(({ pattern }) => pattern.test(text));
if (hits.length > 0) {
  for (const hit of hits) console.error(`prerender: forbidden claim — ${hit.reason} (${hit.pattern})`);
  process.exit(1);
}

const indexPath = join(dist, "index.html");
const template = await readFile(indexPath, "utf8");
const marker = '<div id="root"></div>';
if (!template.includes(marker)) {
  console.error("prerender: #root marker not found in dist/index.html");
  process.exit(1);
}
await writeFile(indexPath, template.replace(marker, `<div id="root">${html}</div>`));
await rm(ssrDir, { recursive: true, force: true });
console.log(`prerender: wrote ${Math.round(html.length / 1024)} kB of HTML into dist/index.html`);
