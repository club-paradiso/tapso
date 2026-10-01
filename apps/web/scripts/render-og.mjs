/**
 * Renders public/og.png (1200 × 630) from the built page's own components.
 *
 *   npm run build && node scripts/render-og.mjs
 *
 * Needs Playwright with a Chromium (not a dependency of the site; any global
 * install works, e.g. `npx playwright`), and Pretendard installed as a system
 * font so the card does not depend on the font CDN. It opens dist/index.html,
 * keeps the hero's Lock Screen card and compact island exactly as the site
 * draws them, and lays them out beside the headline. Nothing is redrawn by
 * hand, so the card cannot drift from the page.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM ?? import.meta.url);
const { chromium } = require("playwright");

// The built page references /assets/...; serve dist/ so those paths resolve.
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname)).replace(/^([/\\])+/, "");
  try {
    const body = await readFile(join(dist, path === "" ? "index.html" : path));
    response.writeHead(200, { "content-type": types[extname(path || "index.html")] ?? "application/octet-stream" }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
await page.evaluate(() => {
  const card = document.querySelector(".hero-phone-front .la-lock")?.cloneNode(true);
  const island = document.querySelector(".hero-phone-back .isle-group")?.cloneNode(true);
  const mark = document.querySelector(".brand")?.cloneNode(true);
  if (!card || !island || !mark) throw new Error("hero surfaces not found in dist/index.html");
  document.body.innerHTML = "";
  document.body.style.margin = "0";
  const og = document.createElement("div");
  og.className = "og-card";
  og.innerHTML = `
    <div class="og-copy">
      <div class="og-brand"></div>
      <p class="og-title">와리지 말앙<br />혼저 탑서.</p>
      <p class="og-line">제주 버스 승차 동반자 · iPhone 앱 개발 중</p>
    </div>
    <div class="og-visual">
      <div class="og-island"></div>
      <div class="og-lock"></div>
      <span class="preview-tag">제품 미리보기 · 합성 데이터</span>
    </div>`;
  og.querySelector(".og-brand").append(mark);
  og.querySelector(".og-island").append(island);
  og.querySelector(".og-lock").append(card);
  document.body.append(og);
  const style = document.createElement("style");
  style.textContent = `
    .og-card { box-sizing: border-box; width: 1200px; height: 630px; display: grid; grid-template-columns: 1.08fr 0.92fr;
      align-items: center; gap: 40px; padding: 0 72px; background: var(--bg); position: relative; overflow: hidden; }
    .og-card::after { content: ""; position: absolute; right: -120px; top: -80px; width: 640px; height: 640px; border-radius: 50%;
      background: var(--mint); opacity: .14; -webkit-mask-image: radial-gradient(closest-side, #000, transparent); }
    .og-brand .brand { pointer-events: none; }
    .og-brand .brand-word { font-size: 26px; }
    .og-brand svg { width: 44px; height: 44px; }
    .og-title { margin: 22px 0 0; font-size: 92px; font-weight: 850; letter-spacing: -0.05em; line-height: 1.03; color: var(--ink); }
    .og-line { margin: 26px 0 0; font-size: 24px; font-weight: 700; color: var(--text-secondary); }
    .og-visual { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 18px; font-size: 18px; }
    .og-island { font-size: 22px; }
    .og-lock { width: 440px; padding: 16px; border-radius: 34px; background: linear-gradient(180deg, var(--night-elevated), var(--basalt)); font-size: 18px; }
    .og-visual .preview-tag { font-size: 14px; }`;
  document.head.append(style);
});
await page.waitForTimeout(300);
await page.screenshot({ path: join(root, "public/og.png") });
await browser.close();
server.close();
console.log("wrote public/og.png");
