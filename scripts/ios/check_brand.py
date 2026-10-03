#!/usr/bin/env python3
"""Brand integrity guard (docs/exec-plans/TAPSO_V1_RELEASE_CLOSURE.md, workstream A).

The visual wordmark is TAPSŌ with a precomposed macron (U+014C), drawn only by
`BrandWordmark`; the searchable product name TAPSO stays in CFBundleDisplayName,
identifiers and prose. Fails when either drifts.

Usage: python3 scripts/ios/check_brand.py
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORDMARK = "TAPSŌ"
MALFORMED = ["TAPS/O", "TAPSŌ", "TAPSO¯", "TAPSÔ", "TAPSÖ", "TAPS0̄"]


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
        if WORDMARK not in text:
            fail(f"{rel} must keep the visual wordmark {WORDMARK}")
        for bad in MALFORMED:
            if bad in text:
                fail(f"{rel} contains a malformed wordmark {bad!r}")

    print(f"brand ok: wordmark {WORDMARK} (U+014C) drawn by BrandWordmark; CFBundleDisplayName TAPSO; {len(swift_files)} Swift files checked")


if __name__ == "__main__":
    main()
