/** Keep the public wordmark aligned with the native SwiftUI source of truth. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ios = readFileSync(new URL("../../ios/Shared/BrandWordmark.swift", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/sections.css", import.meta.url), "utf8");
const header = readFileSync(new URL("../src/sections/Header.tsx", import.meta.url), "utf8");
const footer = readFileSync(new URL("../src/sections/Footer.tsx", import.meta.url), "utf8");

test("iOS brand uses a system rounded black wordmark with 1.2-point tracking", () => {
  assert.match(ios, /\.font\(\.system\(textStyle, design: \.rounded, weight: \.black\)\)/);
  assert.match(ios, /\.tracking\(1\.2\)/);
  assert.match(ios, /static let wordmark = "TAPS\\u\{014C\}"/);
});

test("header and footer use one rounded wordmark without a visible Korean suffix", () => {
  const mark = css.match(/\\.brand-word,\\s*\\.footer-logo > span\\s*\\{([^}]+)\\}/)?.[1];
  assert.ok(mark, "Header and footer must share one wordmark rule");
  assert.match(mark, /font-family:\\s*ui-rounded,\\s*"SF Pro Rounded"/);
  assert.match(mark, /font-weight:\\s*900;/);
  assert.match(mark, /letter-spacing:\\s*1\\.2px;/);
  assert.match(mark, /white-space:\\s*nowrap;/);
  assert.match(css, /\\.brand-word\\s*\\{\\s*font-size:\\s*1\\.25rem;/);
  assert.match(css, /\\.footer-logo\\s*\\{[^}]*font-size:\\s*1\\.25rem;/s);
  assert.match(header, /data-wordmark="TAPSŌ"/);
  assert.match(footer, /role="img" aria-label="TAPSŌ"/);
  for (const source of [header, footer]) {
    assert.match(source, /TAPS<span className="brand-word-o"/);
    assert.doesNotMatch(source, /<span>탑서<\\/span>/);
  }
});

test("macron is drawn over a same-font O to avoid a heavy fallback Ō glyph", () => {
  assert.match(css, /\\.brand-word-o\\s*\\{[^}]*font:\\s*inherit;/s);
  assert.match(css, /\\.brand-word-o::after\\s*\\{[^}]*background:\\s*currentColor;/s);
  assert.match(css, /\\.brand-word-o::after\\s*\\{[^}]*width:\\s*0\\.54em;/s);
  const theme = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  assert.doesNotMatch(theme, /\\.site-header\\s+\\.brand-word\\s*>\\s*span\\s*\\{\\s*display:\\s*none;/);
  assert.doesNotMatch(theme, /\\.site-header\\.is-over-film\\s+\\.brand-word\\s+span/);
});
