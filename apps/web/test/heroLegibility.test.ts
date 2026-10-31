/**
 * The hero must stay readable without burying the footage. Scrim opacity is
 * capped on desktop and mobile; shadowed type keeps the copy legible on video.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const coast = readFileSync(new URL("../src/styles/coast.css", import.meta.url), "utf8");
const mobileFirst = readFileSync(new URL("../src/styles/mobile-first.css", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");

/** Every declaration block that starts with exactly this selector, joined. */
function rule(css: string, selector: string): string {
  const blocks: string[] = [];
  for (let at = css.indexOf(`${selector} {`); at >= 0; at = css.indexOf(`${selector} {`, at + 1)) {
    blocks.push(css.slice(at, css.indexOf("}", at)));
  }
  assert.ok(blocks.length > 0, `missing ${selector}`);
  return blocks.join("\n");
}

test("the glass button is dark glass with a visible border, never white-on-white", () => {
  const glass = rule(coast, ".coast-v4 .btn-glass");
  assert.match(glass, /color:\s*#fff/);
  assert.match(glass, /background:\s*rgb\(var\(--film-basalt\) \/ (4\d|5\d|6\d)%\)/);
  assert.match(glass, /border-color:\s*rgb\(255 255 255 \/ [5-9]\d%\)/);
  assert.doesNotMatch(coast, /\.btn-glass:hover \{ background: rgb\(255 255 255/);
});

test("desktop shade is lighter over the footage and still fades off on the right", () => {
  const shade = rule(coast, ".coast-v4 .coast-shade");
  assert.ok(shade.includes("linear-gradient(90deg, rgb(var(--film-basalt) / 65%) 0%, rgb(var(--film-basalt) / 45%) 39%"));
  assert.ok(shade.includes("linear-gradient(180deg, rgb(var(--film-basalt) / 45%) 0%, transparent 30%)"));
  const after = rule(coast, ".coast-v4 .coast-shade::after");
  assert.ok(after.includes("rgb(var(--film-basalt) / 64%)"));
  assert.ok(after.includes("mask-image: linear-gradient(90deg"));
  assert.ok(!after.includes("180deg"));
});

test("phone and tablet overrides cannot bring back the near-opaque black overlay", () => {
  for (const css of [coast.slice(coast.indexOf("@media (max-width: 759px)")), mobileFirst]) {
    const gradient = css.split(".coast-shade {")[1]?.split("linear-gradient(0deg, ")[1]?.split(");")[0] ?? "";
    const stops = [...gradient.matchAll(/\/ (\d+)%\)/g)].map((m) => Number(m[1]));
    assert.equal(stops.length, 4, "mobile shade must have four opacity stops");
    assert.ok(stops[0]! >= 70 && stops[0]! <= 80, "bottom copy zone should stay legible but let video show");
    assert.ok(stops[1]! >= 58 && stops[1]! <= 65, "middle of the video is no longer heavily shaded");
    assert.ok(stops[2]! <= 35, "upper footage stays visible");
    assert.ok(stops[3]! <= 6, "top of the frame is nearly clear");
  }
  assert.ok(coast.includes(".coast-shade::after { content: none; }"));
});

test("shadowed hero text maintains legibility with the lighter shade", () => {
  assert.ok(rule(coast, ".coast-v4 h1").includes("text-shadow: 0 3px 20px"));
  assert.ok(coast.includes(".coast-gloss, .coast-lede, .coast-status-line, .coast-status-link"));
});

test("the header over the film uses solid white type and a firm toggle", () => {
  assert.match(rule(theme, ".site-header.is-over-film .site-nav a"), /color:\s*#ffffff/);
  assert.match(rule(theme, ".site-header.is-over-film .theme-toggle"), /background:\s*rgb\(15 23 26 \/ 50%\)/);
});

test("the credit line keeps a shadow where the bottom shade is eased", () => {
  assert.match(rule(coast, ".coast-v4 .coast-credit"), /text-shadow:/);
});

test("film colour is lifted without raising brightness", () => {
  const film = rule(coast, ".coast-v4 .coast-film");
  assert.match(film, /filter:\s*saturate\(1\.\d+\) contrast\(1\.0\d\)/);
  assert.doesNotMatch(film, /brightness\(/);
});
