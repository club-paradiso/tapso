#!/usr/bin/env python3
"""Mint means observed data (V4 UX audit U-09, docs/audits/TAPSO_V4_UX_AUDIT.md).

Mint (`journeyActive`, `mintDeep`, `dataLive`, `vehicleConfirmed`, the `.journeyActive`
role) tells the rider "this is happening, TAPSO saw it": a confirmed bus, a current
position, a ride under way. Before U-09 it also decorated home icons, the "실시간 · 베타"
feature badge, the ride-resumed notice and the timetable-based "comfortable" last-bus
state, so green implied certainty where there was none.

Two rules:
1. Surfaces that claim nothing about data never use mint (`NEUTRAL_SURFACES`).
2. Every other mint use is counted per file against `ALLOWED`, each with its reason.
   A new mint use fails until it is justified there; a removed one must lower the count,
   so the list cannot silently go stale.

Usage: python3 scripts/ios/check_colour_semantics.py
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
IOS = ROOT / "apps/ios"

MINT = re.compile(
    r"TapsoColor\.(?:journeyActive|mintDeep|dataLive|vehicleConfirmed)\b"
    r"|(?:role:\s*|\?\?\s*|:\s*RideColorRole\s*=\s*)\.journeyActive\b"
)

# (file, start marker, end marker): the text between the markers must not use mint.
NEUTRAL_SURFACES: list[tuple[str, str, str, str]] = [
    ("apps/ios/TapsoApp/HomeView.swift", "", "", "home screen: icons, tiles, intro card and links claim nothing about data"),
    ("apps/ios/TapsoApp/LiveRideSetupViews.swift", "struct LiveBadge", "\n}\n", "the 실시간 · 베타 badge names a feature, it is not a live reading"),
    ("apps/ios/TapsoApp/LiveRideSetupViews.swift", "struct LiveRideEntryCard", "\n}\n", "home's live-ride entry is a door, not data"),
    ("apps/ios/TapsoApp/RideView.swift", "if snapshot.resumed {", "\n            }\n", "the ride-resumed notice says the app restarted, not that anything was observed"),
    ("apps/ios/TapsoApp/RideEndView.swift", "case .comfortable: TapsoColor", "\n", "'comfortable' last bus is read from a timetable (OFFICIAL_DATED), never observed"),
]

# Mint uses that remain, per file, and why. Counts are exact.
ALLOWED: dict[str, tuple[int, str]] = {
    # Observed data.
    "apps/ios/Shared/RideSurfaceComponents.swift": (4, "active ride role, awake 돌이 on a live ride, confirmed vehicle, live-data trust"),
    "apps/ios/TapsoApp/VehicleCheckView.swift": (2, "the rider-confirmed vehicle"),
    "apps/ios/TapsoApp/BoardingFirstViews.swift": (3, "a current bus position (grey once stale) and 'nearest now', shown only with a current position"),
    "apps/ios/TapsoApp/RideView.swift": (3, "route badge of the ride under way; the confirmed bus on its way; the keep-awake toggle (control tint)"),
    "apps/ios/TapsoApp/BetaFeedback.swift": (2, "selected-option checkmark (control state) and the server's sent receipt"),
    # Controls: the app-wide tint is still mint. Changing it is an open owner decision.
    "apps/ios/TapsoApp/TapsoRootView.swift": (1, "app control tint"),
    "apps/ios/TapsoApp/AppComponents.swift": (2, "primary button fill and the row button's forward arrow"),
    "apps/ios/TapsoApp/SetupViews.swift": (1, "paste button tint"),
    "apps/ios/TapsoApp/AutoStartGuideView.swift": (1, "toggle tint"),
    "apps/ios/TapsoApp/PlaceLookupViews.swift": (2, "map-open and retry buttons"),
    "apps/ios/TapsoApp/RideEndView.swift": (1, "pin button"),
    "apps/ios/TapsoApp/LiveRideSetupViews.swift": (1, "route search button fill"),
    "apps/ios/TapsoApp/ScreenshotImportViews.swift": (1, "paste button fill"),
    "apps/ios/ShareExtension/ShareSheetView.swift": (1, "primary button fill"),
}

EXCLUDED_PARTS = {"Tests"}
EXCLUDED_NAMES = {"TapsoTokens.swift"}


def mint_count(text: str) -> int:
    return len(MINT.findall(text))


def surface_text(text: str, start: str, end: str) -> str | None:
    """The slice of `text` from `start` to the first `end` after it; the whole text for an empty start."""
    if not start:
        return text
    i = text.find(start)
    if i < 0:
        return None
    j = text.find(end, i + len(start)) if end else -1
    return text[i:] if j < 0 else text[i:j]


def neutral_surface_errors(files: dict[str, str]) -> list[str]:
    errors: list[str] = []
    for rel, start, end, why in NEUTRAL_SURFACES:
        if rel not in files:
            errors.append(f"{rel} is missing")
            continue
        part = surface_text(files[rel], start, end)
        if part is None:
            errors.append(f"{rel}: marker {start!r} not found; update NEUTRAL_SURFACES")
        elif mint_count(part):
            where = start or "the file"
            errors.append(f"{rel} uses mint in {where!r}: {why}")
    return errors


def allowance_errors(files: dict[str, str], allowed: dict[str, tuple[int, str]]) -> list[str]:
    errors: list[str] = []
    for rel, text in sorted(files.items()):
        found = mint_count(text)
        expected = allowed.get(rel, (0, ""))[0]
        if found > expected:
            errors.append(
                f"{rel}: {found} mint uses, {expected} allowed. Mint means observed data; "
                "use TapsoColor.decorative / decorativeFill, or justify it in ALLOWED"
            )
        elif found < expected:
            errors.append(f"{rel}: {found} mint uses but ALLOWED says {expected}; lower the count")
    for rel in allowed:
        if rel not in files:
            errors.append(f"ALLOWED lists {rel}, which no longer exists")
    return errors


def product_swift_files() -> dict[str, str]:
    files: dict[str, str] = {}
    for path in sorted(IOS.rglob("*.swift")):
        if EXCLUDED_PARTS.intersection(path.relative_to(IOS).parts) or path.name in EXCLUDED_NAMES:
            continue
        files[str(path.relative_to(ROOT))] = path.read_text(encoding="utf-8")
    return files


def main() -> None:
    files = product_swift_files()
    errors = neutral_surface_errors(files) + allowance_errors(files, ALLOWED)
    if errors:
        for error in errors:
            print(f"colour semantics: {error}", file=sys.stderr)
        sys.exit(1)
    total = sum(mint_count(text) for text in files.values())
    print(f"colour semantics ok: {total} mint uses in {len(ALLOWED)} files, all justified; {len(NEUTRAL_SURFACES)} neutral surfaces mint-free")


if __name__ == "__main__":
    main()
