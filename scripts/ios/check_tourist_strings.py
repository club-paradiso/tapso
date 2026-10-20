#!/usr/bin/env python3
"""Checks the tourist-pivot string tables in `apps/ios/Shared/TouristStrings.swift`.

Unlike the product `Localizable.strings` tables (checked by
`check_localization.py`), the tourist tables live in Swift so a missing key can
fall back per key (requested -> ko -> en -> key). This script enforces the
table contract instead:

- ko, en, zh-Hans and ja hold exactly the same keys;
- at least 30 keys (the tourist journey's core copy);
- no empty values;
- every `"tourist.*"` literal used in Swift sources exists in the tables;
- every table key starts with the `tourist.` prefix.

Runs without Xcode.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
TABLE_FILE = ROOT / "apps/ios/Shared/TouristStrings.swift"
LANGUAGES = ("ko", "en", "zhHans", "ja")
MIN_KEYS = 30

ENTRY = re.compile(r'^\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)",?\s*$')
LANG_BLOCK = re.compile(r"\.(ko|en|zhHans|ja): \[\n(.*?)\n        \],", re.S)
USED_KEY = re.compile(r'"(tourist\.[A-Za-z0-9_.\-]+)"')


def load_tables(path: pathlib.Path) -> dict[str, dict[str, str]]:
    source = path.read_text()
    tables: dict[str, dict[str, str]] = {}
    for match in LANG_BLOCK.finditer(source):
        language, body = match.group(1), match.group(2)
        entries: dict[str, str] = {}
        for number, line in enumerate(body.splitlines(), 1):
            if not line.strip():
                continue
            entry = ENTRY.match(line)
            if not entry:
                sys.exit(f"{path}:{number}: not a table entry: {line.strip()}")
            key = entry.group(1)
            if key in entries:
                sys.exit(f"{path}:{number}: duplicate key {key}")
            entries[key] = entry.group(2)
        tables[language] = entries
    return tables


def main() -> int:
    if not TABLE_FILE.exists():
        sys.exit(f"missing {TABLE_FILE}")
    tables = load_tables(TABLE_FILE)

    missing = [lang for lang in LANGUAGES if lang not in tables]
    if missing:
        sys.exit(f"languages missing from the table: {missing}")

    reference = set(tables["ko"])
    if len(reference) < MIN_KEYS:
        sys.exit(f"ko holds {len(reference)} keys, need at least {MIN_KEYS}")
    for lang in LANGUAGES:
        keys = set(tables[lang])
        if keys != reference:
            only = sorted(keys ^ reference)
            sys.exit(f"{lang} key set differs from ko: {only[:10]}")
        for key, value in tables[lang].items():
            if not key.startswith("tourist."):
                sys.exit(f"{lang}: key without tourist. prefix: {key}")
            if not value:
                sys.exit(f"{lang}: empty value for {key}")

    used: set[str] = set()
    for swift in list((ROOT / "apps/ios").rglob("*.swift")) + list(
        (ROOT / "packages/transit-core/Sources").rglob("*.swift")
    ):
        if "/Tests/" in str(swift):
            continue
        used.update(USED_KEY.findall(swift.read_text()))
    # `tableKey` builds "tourist.language.<rawValue>" at runtime; the picker
    # reads those keys, so they count as used.
    for lang in ("ko", "en", "zh-Hans", "ja"):
        used.add(f"tourist.language.{lang}")
    unknown = sorted(used - reference)
    if unknown:
        sys.exit(f"keys used in Swift but missing from the tables: {unknown}")

    print(f"tourist tables OK: {len(reference)} keys x {len(LANGUAGES)} languages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
