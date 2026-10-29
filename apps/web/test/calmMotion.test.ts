import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fromRoot = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const hero = fromRoot("../src/sections/Hero.tsx");
const coast = fromRoot("../src/styles/coast.css");
const islandDock = fromRoot("../src/components/IslandDock.tsx");
const islandCss = fromRoot("../src/styles/island.css");
const journeyCss = fromRoot("../src/styles/journey.css");
const filmHook = fromRoot("../src/lib/useHeroFilm.ts");
const motionHook = fromRoot("../src/lib/useReducedMotion.ts");
const baseCss = fromRoot("../src/styles/base.css");

test("hero contains no scroll-pinned film-to-phone choreography", () => {
  assert.doesNotMatch(hero, /useScrollStage|requestAnimationFrame|scroll\.step|stepAt\(/);
  assert.doesNotMatch(coast, /position:\s*sticky|height:\s*290svh|height:\s*260svh|--film-clip/);
  assert.match(coast, /min-height:\s*max\(730px,\s*100svh\)/);
});

test("film scene and iPhone demo are deliberate visitor choices", () => {
  assert.match(hero, /aria-pressed=\{scene === "coast"\}/);
  assert.match(hero, /aria-pressed=\{scene === "preview"\}/);
  assert.match(hero, /onClick=\{\(\) => onPick\(index\)\}/);
  assert.match(hero, /앱 화면은 미리보기 · 합성 데이터/);
  assert.doesNotMatch(hero, /setInterval|setTimeout/);
});

test("film pauses when the product preview is selected", () => {
  assert.match(hero, /useHeroFilm\(video, section, reduceMotion, scene === "coast"\)/);
  assert.match(filmHook, /if \(!enabled\)/);
  assert.match(filmHook, /film\.pause\(\)/);
});

test("floating island opens only by activation and has no signal glow", () => {
  assert.match(islandDock, /const open = visible && pinned/);
  assert.doesNotMatch(islandDock, /milestoneToSignal|setSignal|onPointerEnter|onPointerLeave/);
  assert.doesNotMatch(islandDock, /signalling=\{/);
  assert.doesNotMatch(islandCss, /animation:\s*isle-tick|animation:\s*isle-content-in/);
});

test("story phone changes without scroll-induced entrance animation", () => {
  assert.doesNotMatch(journeyCss, /animation:\s*stage-in|animation:\s*stage-screen-in/);
  assert.doesNotMatch(journeyCss, /@keyframes stage-in|@keyframes stage-screen-in/);
});

test("site motion setting persists and disables CSS motion independently of OS", () => {
  assert.match(motionHook, /localStorage\.setItem/);
  assert.match(motionHook, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(motionHook, /document\.documentElement\.dataset\.motion/);
  assert.match(baseCss, /html\[data-motion="reduce"\]/);
  assert.match(hero, /움직임 줄이기/);
});
