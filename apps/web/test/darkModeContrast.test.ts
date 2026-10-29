/**
 * Dark-mode contrast regression guards for the marketing site.
 *
 * Surfaces painted with fixed basalt/black must never use the theme-dependent
 * --bg value as their light foreground. Likewise text on mint/amber/etc must
 * not inherit the theme-dependent --ink value.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = {
  tokens: readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8"),
  sections: readFileSync(new URL("../src/styles/sections.css", import.meta.url), "utf8"),
  journey: readFileSync(new URL("../src/styles/journey.css", import.meta.url), "utf8"),
  island: readFileSync(new URL("../src/styles/island.css", import.meta.url), "utf8"),
  surfaces: readFileSync(new URL("../src/styles/surfaces.css", import.meta.url), "utf8"),
  forms: readFileSync(new URL("../src/styles/forms.css", import.meta.url), "utf8"),
  base: readFileSync(new URL("../src/styles/base.css", import.meta.url), "utf8"),
  theme: readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8"),
};

function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(escaped + "\\s*\\{([^{}]*)\\}"));
  assert.ok(match, "missing CSS rule: " + selector);
  return match[1]!;
}

function hex(name: string): string {
  const match = css.tokens.match(new RegExp("^\\s*--" + name + ":\\s*(#[0-9a-f]{6})\\s*;", "mi"));
  assert.ok(match, "missing colour token: " + name);
  return match[1]!;
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map((i) => {
    const value = parseInt(color.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrast(first: string, second: string): number {
  const [dark, light] = [luminance(first), luminance(second)].sort((a, b) => a - b);
  return (light! + 0.05) / (dark! + 0.05);
}

test("dark backgrounds keep a stable, readable white foreground in both themes", () => {
  for (const [file, selector] of [
    ["sections", ".on-dark"],
    ["sections", ".flow-card.tone-tapso"],
    ["sections", ".privacy-label b"],
    ["sections", ".site-footer"],
    ["sections", ".footer-nav a:hover"],
    ["island", ".isle"],
    ["island", ".dock"],
    ["journey", ".step-note"],
    ["journey", ".variant-chip"],
    ["journey", ".glance-mark-label"],
    ["surfaces", ".phone-dark .phone-screen"],
    ["surfaces", ".lock-clock"],
    ["surfaces", ".la-lock"],
    ["surfaces", ".island"],
  ] as const) {
    assert.match(rule(css[file], selector), /color:\s*var\(--on-dark-surface\)\s*;/, file + " " + selector);
  }
  assert.ok(contrast(hex("on-dark-surface"), hex("basalt")) >= 7);
});

test("bright journey fills retain dark text even when the page theme is dark", () => {
  for (const role of ["active", "prepare", "arrival", "checking", "degraded"]) {
    assert.match(rule(css.tokens, ".role-" + role), /--on-role:\s*var\(--on-light-accent\)\s*;/);
  }
  for (const fill of ["mint", "amber", "tangerine", "blue", "slate", "coral-on-dark"]) {
    assert.ok(contrast(hex("on-light-accent"), hex(fill)) >= 4.5, fill);
  }
  assert.match(rule(css.tokens, ".role-next"), /--on-role:\s*var\(--on-dark-surface\)\s*;/);
  assert.ok(contrast(hex("on-dark-surface"), hex("coral")) >= 4.5);
});

test("mint CTAs and highlighted icons do not use dark-theme --ink", () => {
  assert.match(css.forms, /\.figma-submit,\s*\.figma-support\s*\{[^}]*color:\s*var\(--on-light-accent\)/s);
  assert.match(rule(css.forms, ".figma-support"), /color:\s*var\(--ink\)\s*;/);
  assert.match(rule(css.sections, ".tone-tapso .flow-icon"), /color:\s*var\(--on-light-accent\)\s*;/);
  for (const selector of [".scene-bus-body", ".privacy-token.is-bus", ".waitlist-promises svg"]) {
    assert.match(rule(css.sections, selector), /color:\s*var\(--on-light-accent\)\s*;/, selector);
  }
  assert.match(rule(css.base, ".btn-primary"), /color:\s*var\(--on-light-accent\)\s*;/);
  assert.match(rule(css.island, ".isle-group.role-next"), /--on-role:\s*var\(--on-light-accent\)\s*;/);
  assert.match(rule(css.theme, '[data-theme="dark"]'), /--text-tertiary:\s*#8c999e\s*;/);
  assert.ok(contrast("#8c999e", hex("bg")) < 4.5, "light backgrounds should use their own tertiary text token");
});
