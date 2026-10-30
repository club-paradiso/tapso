/**
 * The hero must stay readable without burying the footage. The shade is heavy
 * only where the copy sits, and the buttons carry their own dark backing, so
 * white text does not depend on which frame of the film is showing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const coast = readFileSync(new URL("../src/styles/coast.css", import.meta.url), "utf8");
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

test("the bottom shade eases off on the right and the top band stays for the header", () => {
  const shade = rule(coast, ".coast-v4 .coast-shade");
  assert.match(shade, /linear-gradient\(180deg, rgb\(var\(--film-basalt\) \/ 65%\) 0%, transparent 30%\)/);
  const after = rule(coast, ".coast-v4 .coast-shade::after");
  assert.match(after, /mask-image:\s*linear-gradient\(90deg/);
  assert.doesNotMatch(after, /180deg/);
});

test("on phones the top of the frame is light and the shade is heavy where the copy sits", () => {
  const mobile = coast.slice(coast.indexOf("@media (max-width: 759px)"));
  const gradient = mobile.match(/\.coast-shade \{\s*[^}]*linear-gradient\(0deg, ([^;]+)\);/s)?.[1] ?? "";
  const stops = [...gradient.matchAll(/\/ (\d+)%\)(?: (\d+)%)?/g)].map((m) => Number(m[1]));
  assert.ok(stops.length >= 4, "mobile shade has four stops");
  assert.ok(stops[0]! >= 85, "bottom stop stays dark under the copy");
  assert.ok(stops[1]! >= 65, "copy zone stays dark");
  assert.ok(stops[stops.length - 1]! <= 10, "top of the frame is nearly clear");
  assert.match(mobile, /\.coast-shade::after \{ content: none; \}/);
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
