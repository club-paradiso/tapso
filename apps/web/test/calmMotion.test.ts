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

test("two permanent video layers crossfade instead of reloading one element", () => {
  assert.match(hero, /useHeroCrossfade/);
  assert.match(hero, /const videoA = useRef<HTMLVideoElement>/);
  assert.match(hero, /const videoB = useRef<HTMLVideoElement>/);
  assert.match(hero, /first=\{videoA\}/);
  assert.match(hero, /second=\{videoB\}/);
  assert.match(hero, /className=\{`coast-film \$\{role\(0\)\}`\}/);
  assert.match(hero, /className=\{`coast-film \$\{role\(1\)\}`\}/);
  assert.doesNotMatch(hero, /onEnded|setFilmIndex|영상 멈추기|영상 재생|PauseIcon|PlayIcon/);
  assert.match(coast, /\.coast-film\.is-incoming\s*\{[^}]*opacity:\s*1;[^}]*z-index:\s*2/s);
  assert.match(coast, /transition:\s*opacity 1200ms ease-in-out/);
});

test("the next scene preloads and starts before the outgoing video ends", () => {
  assert.match(filmHook, /prepare\(0, 0\)/);
  assert.match(filmHook, /prepare\(1, 1\)/);
  assert.match(filmHook, /timeupdate/);
  assert.match(filmHook, /duration - outgoing\.currentTime > PRE_ROLL_SECONDS/);
  assert.match(filmHook, /incoming\.readyState < HTMLMediaElement\.HAVE_CURRENT_DATA/);
  assert.match(filmHook, /void incoming\.play\(\)\.then\(\(\) =>/);
  assert.match(filmHook, /setIncomingSlot\(nextSlot\)/);
  assert.match(filmHook, /outgoing\.pause\(\)/);
  assert.match(filmHook, /setActiveSlot\(nextSlot\)/);
  assert.match(filmHook, /prepare\(\(nextSlot === 0 \? 1 : 0\)/);
  assert.match(hero, /\bloop\b/);
});

test("video playback never overrides OS motion and data-saver settings", () => {
  assert.match(hero, /FILM_SCENES\.filter/);
  assert.match(hero, /filmAssetsExist/);
  assert.match(filmHook, /if \(prefersStill\(reduceMotion\)\) return;/);
  assert.match(filmHook, /connection\?\.saveData/);
  assert.match(filmHook, /document\.hidden/);
  assert.match(filmHook, /IntersectionObserver/);
  assert.doesNotMatch(hero, /coast-scene-picker|coast-control-button|setInterval/);
});

test("floating island opens only by activation and has no signal glow", () => {
  assert.match(islandDock, /const open = visible && pinned/);
  assert.doesNotMatch(islandDock, /milestoneToSignal|setSignal|onPointerEnter|onPointerLeave/);
  assert.doesNotMatch(islandDock, /signalling=\{/);
  assert.doesNotMatch(islandCss, /animation:\s*isle-tick|animation:\s*isle-content-in/);
});

test("sticky iPhone preview stays comfortably below the navigation bar", () => {
  const stage = journeyCss.match(/\.stage\s*\{[^}]*\}/)?.[0];
  assert.ok(stage, "Sticky stage rules must exist");
  assert.match(stage, /position:\s*sticky/);
  assert.match(stage, /--stage-top:\s*clamp\(104px,\s*13svh,\s*144px\)/);
  assert.match(stage, /top:\s*var\(--stage-top\)/);
  assert.match(stage, /height:\s*calc\(100svh\s*-\s*var\(--stage-top\)\)/);
  assert.doesNotMatch(stage, /top:\s*64px|height:\s*calc\(100svh\s*-\s*64px\)|min-height:\s*560px/);
  assert.match(journeyCss, /@media \(min-width: 900px\) and \(max-height: 820px\)/);
  assert.match(journeyCss, /@media \(min-width: 900px\) and \(max-height: 650px\)/);
  assert.match(journeyCss, /--pw:\s*clamp\(170px,\s*16vw,\s*215px\)/);
  // Narrow viewports use the in-step preview, not the sticky side rail.
  assert.match(journeyCss, /@media \(max-width: 899px\)\s*\{[\s\S]*?\.journey-stage\s*\{\s*display:\s*none/);
});

test("story phone changes without scroll-induced entrance animation", () => {
  assert.doesNotMatch(journeyCss, /animation:\s*stage-in|animation:\s*stage-screen-in/);
  assert.doesNotMatch(journeyCss, /@keyframes stage-in|@keyframes stage-screen-in/);
});

test("native OS reduced motion is honored without an on-page motion button", () => {
  assert.match(motionHook, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(motionHook, /query\.addEventListener\("change", sync\)/);
  assert.doesNotMatch(motionHook, /localStorage[.](getItem|setItem)|getSiteReducedMotion|setSiteReducedMotion/);
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
