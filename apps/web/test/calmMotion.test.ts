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

test("the film playlist progresses automatically, without user-facing scene or pause controls", () => {
  assert.match(hero, /FILM_SCENES\.filter/);
  assert.match(hero, /filmAssetsExist/);
  assert.match(hero, /onEnded=\{onEnded\}/);
  assert.match(hero, /setFilmIndex\(\(index\) => \(index \+ 1\) % playlist\.length\)/);
  assert.match(hero, /loop=\{playlist\.length <= 1\}/);
  assert.doesNotMatch(hero, /coast-scene-picker|onClick=\{\(\) => pickScene/);
  assert.doesNotMatch(hero, /영상 멈추기|영상 재생|PauseIcon|PlayIcon|FilmControls/);
  assert.doesNotMatch(hero, /setInterval|setTimeout/);
});

test("automatic playback respects the saved motion setting and visibility", () => {
  assert.match(hero, /useHeroFilm\(video, section, reduceMotion, true, current\.film\)/);
  assert.match(hero, /if \(!reduceMotion && playlist\.length > 1\)/);
  assert.match(filmHook, /if \(prefersStill\(reduceMotion\)\)/);
  assert.match(filmHook, /onScreen\.current/);
  assert.match(filmHook, /document\.hidden/);
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

test("native OS reduced motion is honored without an on-page motion button", () => {
  assert.match(motionHook, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(motionHook, /query\.addEventListener\("change", sync\)/);
  assert.doesNotMatch(motionHook, /localStorage|getSiteReducedMotion|setSiteReducedMotion/);
  assert.doesNotMatch(hero, /움직임 줄이기|움직임 기본값|toggleReducedMotion|coast-control-button/);
  assert.doesNotMatch(baseCss, /html\[data-motion="reduce"\]/);
});

test("page anchors jump instantly without a long animated fly-through", () => {
  const htmlStyles = baseCss.match(/html\s*\{[^}]*\}/)?.[0];
  assert.ok(htmlStyles, "Expected global html styles");
  assert.match(htmlStyles, /scroll-behavior:\s*auto/);
  assert.match(htmlStyles, /scroll-padding-top:\s*80px/);
  assert.doesNotMatch(htmlStyles, /scroll-behavior:\s*smooth/);
  const header = fromRoot("../src/sections/Header.tsx");
  const nav = fromRoot("../src/content/site.ts");
  assert.match(header, /href=\{item\.href\}/);
  assert.match(nav, /href:\s*"#status"/);
  assert.match(nav, /href:\s*"#support"/);
});
