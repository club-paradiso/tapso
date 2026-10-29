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

test("web header and footer share the rounded iOS wordmark treatment", () => {
  const mark = css.match(/\.brand-word,\s*\.footer-logo > span\s*\{([^}]+)\}/)?.[1];
  assert.ok(mark, "Header and footer must share one wordmark rule");
  assert.match(mark, /font-family:\s*ui-rounded,\s*"SF Pro Rounded"/);
  assert.match(mark, /font-weight:\s*900;/);
  assert.match(mark, /letter-spacing:\s*1\.2px;/);
  assert.match(mark, /white-space:\s*nowrap;/);
  assert.match(css, /\.brand-word\s*\{\s*font-size:\s*1\.25rem;/);
  assert.match(css, /\.footer-logo\s*\{[^}]*font-size:\s*1\.25rem;/s);
  assert.match(header, /TAPSŌ <span>탑서<\/span>/);
  assert.match(footer, /TAPSŌ <span>탑서<\/span>/);
});

test("the Korean descriptor keeps Pretendard instead of inheriting rounded Latin branding", () => {
  assert.match(css, /\.brand-word span\s*\{\s*font-family:\s*var\(--font\);/);
  assert.match(css, /\.footer-logo > span > span\s*\{\s*font-family:\s*var\(--font\);/);
});
