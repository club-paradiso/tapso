#!/usr/bin/env python3
"""Brand integrity guard (docs/exec-plans/TAPSO_V1_RELEASE_CLOSURE.md, workstream A).

The visual wordmark is TAPSŌ with a precomposed macron (U+014C), drawn only by
`BrandWordmark`; the searchable product name TAPSO stays in CFBundleDisplayName,
identifiers and prose. Fails when either drifts.

The website draws the same wordmark in one of two accepted ways: the literal
precomposed TAPSŌ, or (since PR #170) `TAPS` plus a same-font `O` span whose
macron is a CSS bar, so no fallback font can make only the Ō heavier. Either way
the accessible name stays TAPSO and no Korean suffix is drawn. `web_wordmark_errors`
and `web_macron_css_errors` check that structure; scripts/ios/test_check_brand.py
holds the negative controls.

Usage: python3 scripts/ios/check_brand.py
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORDMARK = "TAPSŌ"
MALFORMED = ["TAPS/O", "TAPSŌ", "TAPSO¯", "TAPSÔ", "TAPSÖ", "TAPS0̄"]


SPLIT_O = re.compile(r'TAPS\s*<span className="brand-word-o"[^>]*>O</span>')
ACCESSIBLE_NAME = re.compile(r'aria-label="TAPSO["\s,]|data-wordmark="TAPSO"')
KOREAN_SUFFIX = re.compile(r"<span[^>]*>\s*탑서\s*</span>")


def web_wordmark_errors(rel: str, text: str) -> list[str]:
    """Problems in one web component that draws the wordmark (empty list: fine)."""
    errors: list[str] = []
    for bad in MALFORMED:
        if bad in text:
            errors.append(f"{rel} contains a malformed wordmark {bad!r}")
    if WORDMARK not in text and not SPLIT_O.search(text):
        errors.append(
            f"{rel} must keep the visual wordmark {WORDMARK}: either the literal, "
            'or TAPS followed by <span className="brand-word-o">O</span>'
        )
    if WORDMARK not in text and SPLIT_O.search(text) and not ACCESSIBLE_NAME.search(text):
        errors.append(f'{rel} draws the split wordmark but has no accessible name "TAPSO"')
    if KOREAN_SUFFIX.search(text):
        errors.append(f"{rel} draws a Korean suffix beside the wordmark")
    return errors


def web_macron_css_errors(css: str) -> list[str]:
    """The split wordmark needs its same-font O and the macron bar drawn in currentColor."""
    errors: list[str] = []
    o_rule = re.search(r"\.brand-word-o\s*\{([^}]*)\}", css)
    if not o_rule or not re.search(r"font:\s*inherit", o_rule.group(1)):
        errors.append(".brand-word-o must inherit the wordmark font so the O matches TAPS")
    bar = re.search(r"\.brand-word-o::after\s*\{([^}]*)\}", css)
    if not bar or "background: currentColor" not in bar.group(1) or "width:" not in bar.group(1):
        errors.append(".brand-word-o::after must draw the macron with background: currentColor")
    return errors


def fail(message: str) -> None:
    print(f"brand: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    brand = (ROOT / "apps/ios/Shared/BrandWordmark.swift").read_text(encoding="utf-8")
    if 'static let wordmark = "TAPS\\u{014C}"' not in brand:
        fail("BrandWordmark.swift must define the wordmark as TAPS\\u{014C}")
    if "Text(verbatim: TapsoBrand.wordmark)" not in brand:
        fail("BrandWordmark must draw TapsoBrand.wordmark")

    swift_files = list((ROOT / "apps/ios").rglob("*.swift"))
    for path in swift_files:
        if path.name == "BrandWordmark.swift":
            continue
        text = path.read_text(encoding="utf-8")
        # Tests may assert the literal; product code may not draw it.
        if "Tests" not in path.parts:
            for literal in (f'"{WORDMARK}"', 'verbatim: "TAPSO"'):
                if literal in text:
                    fail(f"{path.relative_to(ROOT)} draws the wordmark as a string literal; use BrandWordmark")
        for bad in MALFORMED:
            if bad in text:
                fail(f"{path.relative_to(ROOT)} contains a malformed wordmark {bad!r}")

    home = (ROOT / "apps/ios/TapsoApp/HomeView.swift").read_text(encoding="utf-8")
    if "BrandWordmark()" not in home:
        fail("HomeView must render BrandWordmark()")

    spec = (ROOT / "apps/ios/project.yml").read_text(encoding="utf-8")
    if not re.search(r"CFBundleDisplayName: TAPSO\n", spec):
        fail("CFBundleDisplayName must stay TAPSO (searchable product name)")
    if "TapsoGitCommit" not in spec:
        fail("project.yml must write TapsoGitCommit (build identity)")

    for rel in ("apps/web/src/sections/Header.tsx", "apps/web/src/sections/Footer.tsx"):
        text = (ROOT / rel).read_text(encoding="utf-8")
        errors = web_wordmark_errors(rel, text)
        if errors:
            fail(errors[0])
        if WORDMARK not in text:
            css = (ROOT / "apps/web/src/styles/sections.css").read_text(encoding="utf-8")
            css_errors = web_macron_css_errors(css)
            if css_errors:
                fail(css_errors[0])

    print(f"brand ok: wordmark {WORDMARK} (U+014C) drawn by BrandWordmark; CFBundleDisplayName TAPSO; {len(swift_files)} Swift files checked")


if __name__ == "__main__":
    main()
