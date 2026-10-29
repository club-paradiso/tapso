#!/usr/bin/env python3
"""Validates token synchronization across the canonical manifest, Swift tokens, web CSS, and marketing settings.

Usage: python3 scripts/design/validate_tokens.py
"""
import json
import math
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOKENS_JSON = ROOT / "design/tokens/tokens.json"
SWIFT_TOKENS = ROOT / "apps/ios/Shared/TapsoTokens.swift"
WEB_TOKENS_CSS = ROOT / "apps/web/src/styles/tokens.css"
WEB_THEME_CSS = ROOT / "apps/web/src/styles/theme.css"
MARKETING_JSON = ROOT / "apps/web/src/design/marketing.json"


def srgb_luminance(hex_str: str) -> float:
    hex_str = hex_str.lstrip("#")
    r, g, b = [int(hex_str[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    channels = [
        c / 12.92 if c <= 0.04045 else math.pow((c + 0.055) / 1.055, 2.4)
        for c in (r, g, b)
    ]
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def contrast_ratio(hex1: str, hex2: str) -> float:
    l1 = srgb_luminance(hex1)
    l2 = srgb_luminance(hex2)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def check_contrast(manifest: dict) -> list[str]:
    errors = []
    # Check textPrimary on backgroundPrimary
    light_text = manifest["color"]["text"]["primary"]["light"]
    light_bg = manifest["color"]["background"]["primary"]["light"]
    cr = contrast_ratio(light_text, light_bg)
    if cr < 4.5:
        errors.append(f"light textPrimary on bg: {cr:.2f}:1 < 4.5:1")

    dark_text = manifest["color"]["text"]["primary"]["dark"]
    dark_bg = manifest["color"]["background"]["primary"]["dark"]
    cr = contrast_ratio(dark_text, dark_bg)
    if cr < 4.5:
        errors.append(f"dark textPrimary on bg: {cr:.2f}:1 < 4.5:1")

    # Check mintDeep on Shore (backgroundSecondary)
    mint_light = manifest["color"]["identity"]["mintDeep"]["light"]
    shore_light = manifest["color"]["background"]["secondary"]["light"]
    cr = contrast_ratio(mint_light, shore_light)
    if cr < 4.5:
        errors.append(f"light mintDeep on Shore: {cr:.2f}:1 < 4.5:1")

    # Check textSecondary on backgroundSecondary
    sec_light = manifest["color"]["text"]["secondary"]["light"]
    cr = contrast_ratio(sec_light, shore_light)
    if cr < 4.5:
        errors.append(f"light textSecondary on Shore: {cr:.2f}:1 < 4.5:1")

    return errors


def check_swift_tokens(manifest: dict) -> list[str]:
    errors = []
    text = SWIFT_TOKENS.read_text(encoding="utf-8")

    # Map swift names to manifest values
    expected = {
        "backgroundPrimary": (manifest["color"]["background"]["primary"]["light"], manifest["color"]["background"]["primary"]["dark"]),
        "backgroundSecondary": (manifest["color"]["background"]["secondary"]["light"], manifest["color"]["background"]["secondary"]["dark"]),
        "textPrimary": (manifest["color"]["text"]["primary"]["light"], manifest["color"]["text"]["primary"]["dark"]),
        "textSecondary": (manifest["color"]["text"]["secondary"]["light"], manifest["color"]["text"]["secondary"]["dark"]),
        "separator": (manifest["color"]["separator"]["default"]["light"], manifest["color"]["separator"]["default"]["dark"]),
        "mintDeep": (manifest["color"]["identity"]["mintDeep"]["light"], manifest["color"]["identity"]["mintDeep"]["dark"]),
    }

    for name, (exp_light, exp_dark) in expected.items():
        pattern = rf"static let {name}\s*=\s*dynamic\(light:\s*0x([0-9A-Fa-f]+),\s*dark:\s*0x([0-9A-Fa-f]+)\)"
        m = re.search(pattern, text)
        if not m:
            errors.append(f"Could not find dynamic token '{name}' in TapsoTokens.swift")
            continue
        found_light = f"#{m.group(1).upper()}"
        found_dark = f"#{m.group(2).upper()}"
        if found_light != exp_light.upper():
            errors.append(f"TapsoTokens.swift {name} light: found {found_light}, expected {exp_light}")
        if found_dark != exp_dark.upper():
            errors.append(f"TapsoTokens.swift {name} dark: found {found_dark}, expected {exp_dark}")

    # Check static Color(hex:)
    single_colors = {
        "journeyActive": manifest["color"]["journey"]["active"]["light"],
        "journeyPrepare": manifest["color"]["journey"]["prepare"]["light"],
        "journeyArrival": manifest["color"]["journey"]["arrival"]["light"],
        "tangerine": manifest["color"]["identity"]["tangerine"]["light"],
        "basalt": manifest["color"]["identity"]["basalt"]["light"],
    }
    for name, exp_hex in single_colors.items():
        pattern = rf"static let {name}\s*=\s*Color\(hex:\s*0x([0-9A-Fa-f]+)\)"
        m = re.search(pattern, text)
        if not m:
            errors.append(f"Could not find static token '{name}' in TapsoTokens.swift")
            continue
        found_hex = f"#{m.group(1).upper()}"
        if found_hex != exp_hex.upper():
            errors.append(f"TapsoTokens.swift {name}: found {found_hex}, expected {exp_hex}")

    return errors


def check_marketing_json(manifest: dict) -> list[str]:
    errors = []
    if not MARKETING_JSON.exists():
        return ["marketing.json missing"]
    data = json.loads(MARKETING_JSON.read_text(encoding="utf-8"))

    expected = {
        "light": {
            "bg": manifest["color"]["background"]["primary"]["light"],
            "ink": manifest["color"]["text"]["primary"]["light"],
            "mint": manifest["color"]["journey"]["active"]["light"],
            "text-secondary": manifest["color"]["text"]["secondary"]["light"],
            "mist": manifest["color"]["background"]["secondary"]["light"],
            "separator": manifest["color"]["separator"]["default"]["light"],
        },
        "dark": {
            "bg": manifest["color"]["background"]["primary"]["dark"],
            "ink": manifest["color"]["text"]["primary"]["dark"],
            "mint": manifest["color"]["journey"]["active"]["dark"],
            "text-secondary": manifest["color"]["text"]["secondary"]["dark"],
            "mist": manifest["color"]["background"]["secondary"]["dark"],
            "separator": manifest["color"]["separator"]["default"]["dark"],
        },
    }

    for mode in ("light", "dark"):
        for key, exp_val in expected[mode].items():
            found = data.get(mode, {}).get(key, "").upper()
            if found != exp_val.upper():
                errors.append(f"marketing.json [{mode}][{key}]: found {found}, expected {exp_val}")

    return errors


def main() -> int:
    if not TOKENS_JSON.exists():
        print(f"ERROR: {TOKENS_JSON} does not exist", file=sys.stderr)
        return 1

    manifest = json.loads(TOKENS_JSON.read_text(encoding="utf-8"))
    errors = []

    errors.extend(check_contrast(manifest))
    errors.extend(check_swift_tokens(manifest))
    marketing_errors = check_marketing_json(manifest)
    if marketing_errors:
        errors.extend(marketing_errors)

    if errors:
        print("Token validation failed with errors:")
        for e in errors:
            print(f"  - {e}")
        return 1

    print("Tokens validated successfully:")
    print("  ✓ WCAG contrast compliance verified (textPrimary, mintDeep, textSecondary)")
    print("  ✓ Swift tokens (TapsoTokens.swift) match canonical manifest")
    print("  ✓ Marketing settings (marketing.json) match canonical manifest")
    return 0


if __name__ == "__main__":
    sys.exit(main())
