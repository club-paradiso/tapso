/**
 * Mobile UX regression guards (320–430px phones).
 *
 * The marketing page is read mostly on iPhones, so the rules that make it
 * usable one-handed — a reachable nav, 44px targets, safe-area insets,
 * announced form errors — are pinned here the same way calmMotion.test.ts
 * and darkModeContrast.test.ts pin theirs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const sections = read("../src/styles/sections.css");
const base = read("../src/styles/base.css");
const theme = read("../src/styles/theme.css");
const coast = read("../src/styles/coast.css");
const island = read("../src/styles/island.css");
const forms = read("../src/styles/forms.css");
const tokens = read("../src/styles/tokens.css");
const waitlistForm = read("../src/components/WaitlistForm.tsx");
const supportDialog = read("../src/components/SupportDialog.tsx");
const indexHtml = read("../index.html");

/** The slice of a stylesheet starting at a media query (its own rules come first). */
function mediaSlice(css: string, query: string): string {
  const start = css.indexOf(query);
  assert.ok(start >= 0, "missing media query: " + query);
  return css.slice(start, start + 3000);
}

function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(escaped + "\\s*\\{([^{}]*)\\}"));
  assert.ok(match, "missing CSS rule: " + selector);
  return match[1]!;
}

test("mobile header keeps the page nav reachable as a scrollable second row", () => {
  // The nav must never be display:none again: phones had no section jumps.
  assert.doesNotMatch(sections, /\.site-nav\s*\{\s*display:\s*none/);
  const mobile = mediaSlice(sections, "@media (max-width: 959px)");
  assert.match(mobile, /\.site-nav\s*\{[^}]*display:\s*block/);
  assert.match(mobile, /\.site-nav ul\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(mobile, /\.site-nav a\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(mobile, /\.site-header-inner\s*\{[^}]*flex-wrap:\s*wrap/);
  // Anchored sections clear the taller two-row header.
  assert.match(mobile, /scroll-padding-top:\s*124px/);
});

test("mobile header stays opaque over the hero film and the film does not tuck under it", () => {
  const mobileTheme = mediaSlice(theme, "@media (max-width: 959px)");
  assert.match(mobileTheme, /\.site-header\.is-over-film\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--bg\)/);
  assert.match(coast, /@media \(max-width: 959px\)\s*\{\s*\.coast-v4\s*\{\s*margin-top:\s*0/);
});

test("content respects iPhone safe areas", () => {
  assert.match(rule(base, ".container"), /padding-left:\s*max\(var\(--gutter\), env\(safe-area-inset-left\)\)/);
  assert.match(rule(base, ".container"), /padding-right:\s*max\(var\(--gutter\), env\(safe-area-inset-right\)\)/);
  assert.match(rule(sections, ".site-footer"), /env\(safe-area-inset-bottom\)/);
  const sheet = mediaSlice(forms, "@media (max-width: 700px)");
  assert.match(sheet, /env\(safe-area-inset-bottom\)/);
});

test("interactive targets meet the 44px touch minimum", () => {
  assert.match(tokens, /--touch-min:\s*44px;/);
  // The Dynamic Island demo graphic is ~2.3em tall; its stage pads the
  // overlay toggle up to 44px, and the button itself holds no visible text
  // (axe label-content-name-mismatch: the graphic's "3655정거장" can never
  // appear inside the spoken label).
  assert.match(rule(island, ".dock-stage"), /min-height:\s*var\(--touch-min\)/);
  assert.match(rule(island, ".dock-stage"), /min-width:\s*var\(--touch-min\)/);
  assert.match(rule(island, ".dock-button"), /position:\s*absolute/);
  const dockSource = read("../src/components/IslandDock.tsx");
  assert.match(dockSource, /className="dock-stage"/);
  assert.doesNotMatch(dockSource, /<button[^>]*>\s*<Island/);
  // A template placeholder typed as JSX text renders a literal "$" to users.
  assert.doesNotMatch(dockSource, /dock-note">[^<]*\$\{/);
  // Standalone rule only (not `.site-header.is-over-film .theme-toggle`).
  const toggle = theme.match(/(?:^|\n)\.theme-toggle\s*\{([^{}]*)\}/);
  assert.ok(toggle, "missing standalone .theme-toggle rule");
  assert.match(toggle[1]!, /min-height:\s*var\(--touch-min\)/);
  assert.match(toggle[1]!, /min-width:\s*var\(--touch-min\)/);
  // In dark mode the brand mark's basalt tile must lift off the dark header.
  assert.match(theme, /\[data-theme="dark"\] \.site-header \.brand-mark rect:first-child\s*\{\s*fill:\s*var\(--night-elevated\)/);
  assert.match(rule(sections, ".site-nav a"), /min-height:\s*var\(--touch-min\)/);
});

test("hero microcopy stays readable on phones", () => {
  const mobile = mediaSlice(coast, "@media (max-width: 759px)");
  assert.match(mobile, /\.coast-status-line\s*\{\s*font-size:\s*0\.875rem/);
  assert.match(mobile, /\.coast-credit\s*\{[^}]*font-size:\s*0\.75rem/);
  assert.doesNotMatch(coast, /font-size:\s*0\.6875rem/);
  assert.match(mobile, /\.coast-bottom\s*\{\s*bottom:\s*max\(16px, env\(safe-area-inset-bottom\)\)/);
});

test("bus view tabs stay on one line and scroll instead of wrapping", () => {
  const mobile = mediaSlice(sections, "@media (max-width: 719px)");
  assert.match(mobile, /\.segmented\s*\{[^}]*flex-wrap:\s*nowrap/);
  assert.match(mobile, /\.segmented\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(mobile, /\.segmented button\s*\{[^}]*white-space:\s*nowrap/);
});

test("waitlist validation moves focus to the first invalid field", () => {
  assert.match(waitlistForm, /const emailRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(waitlistForm, /const consentRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(waitlistForm, /\(emailBad \? emailRef : consentRef\)\.current\?\.focus\(\)/);
  assert.match(waitlistForm, /ref=\{emailRef\}/);
  assert.match(waitlistForm, /ref=\{consentRef\}/);
  // Server-side invalid results focus the field they blame, too.
  assert.match(waitlistForm, /outcome\.field === "email"\) \{\s*setEmailError\("메일 주소를 다시 확인해주세요\."\);\s*emailRef\.current\?\.focus\(\)/);
});

test("support sheet announces the account copy and explains an out-of-range amount", () => {
  assert.match(supportDialog, /className="visually-hidden" role="status"/);
  assert.match(supportDialog, /계좌번호가 복사됐어요\./);
  assert.match(supportDialog, /const customInvalid =/);
  assert.match(supportDialog, /aria-invalid=\{customInvalid \|\| undefined\}/);
  assert.match(supportDialog, /className="field-error" id=\{`\$\{customFieldId\}-error`\} role="alert"/);
  // Scrolling inside the sheet must not chain into the page behind it.
  assert.match(rule(forms, ".support-dialog-body"), /overscroll-behavior:\s*contain/);
  // The close button must survive scrolling: header outside the scroll area.
  assert.match(rule(forms, ".support-dialog[open]"), /display:\s*flex/);
  assert.match(rule(forms, ".support-dialog-body"), /overflow-y:\s*auto/);
  assert.ok(
    supportDialog.indexOf("support-dialog-header") < supportDialog.indexOf("support-dialog-body"),
    "support dialog header must render before (outside) the scrolling body",
  );
});

test("support routes stay Toss transfer, bank copy and Buy Me a Coffee", () => {
  assert.match(supportDialog, /토스 앱에서 바로 송금하기/);
  assert.match(supportDialog, /계좌번호 복사/);
  assert.match(supportDialog, /Buy Me a Coffee/);
});

test("browser chrome colour follows the OS colour scheme", () => {
  assert.match(indexHtml, /<meta name="theme-color" media="\(prefers-color-scheme: light\)" content="#ffffff" \/>/);
  assert.match(indexHtml, /<meta name="theme-color" media="\(prefers-color-scheme: dark\)" content="#0f171a" \/>/);
  assert.doesNotMatch(indexHtml, /<meta name="theme-color" content=/);
});


test("long Jeju boarding stop takes the full mobile row instead of a 40% column", () => {
  const scene = read("../src/components/JourneyParts.tsx");
  assert.match(scene, /className="scene-boarding-label"/);
  assert.match(scene, /<span>\{BOARDING_STOP\}<\/span>/);
  assert.match(scene, /slot === 0 \?/);
  // At ordinary phone widths, the boarding name and bus chip are stacked.
  assert.match(sections, /@media \(max-width: 719px\)\s*\{[\s\S]*?\.scene-slot\.is-boarding\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(sections, /\.scene-slot\.is-boarding \.scene-bus\s*\{[^}]*grid-column:\s*1/);
  assert.match(sections, /\.scene-stop\s*\{[^}]*max-width:\s*none/);
  assert.match(sections, /\.scene-boarding-label > span\s*\{[^}]*overflow-wrap:\s*anywhere/);
  // Prevent bringing back the old narrow-left-column regression.
  const mobileLayout = sections.slice(sections.lastIndexOf("@media (max-width: 719px)"));
  assert.doesNotMatch(mobileLayout, /\.scene-stop\s*\{[^}]*max-width:\s*40%/);
});

test("other mobile bus chips stay compact and the nav remains comfortably reachable", () => {
  assert.match(sections, /\.scene-bus\s*\{[^}]*max-width:\s*146px/);
  assert.match(sections, /@media \(max-width: 359px\)\s*\{[\s\S]*?\.scene-slot:not\(\.is-boarding\)/);
  assert.match(sections, /\.site-nav a\s*\{[^}]*font-size:\s*clamp\(0\.8125rem, 3\.5vw, 0\.9375rem\)/);
  assert.match(sections, /\.site-nav ul\s*\{[^}]*scroll-snap-type:\s*x proximity/);
  assert.match(rule(sections, ".site-nav a"), /min-height:\s*var\(--touch-min\)/);
});
