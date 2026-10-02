#!/usr/bin/env python3
"""Checks that every localization key the iOS app and Live Activity use exists
in both ko and en, and that the two tables hold the same keys.

Keys are string literals with a known prefix in the Swift sources, plus the
families the core builds at runtime (ride moments, vehicle-check stages, trust
states, demo scenarios, milestones, map apps). Runs without Xcode.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
IOS = ROOT / "apps/ios"
CORE = ROOT / "packages/transit-core/Sources/TapsoTransit"
PREFIXES = (
    "a11y", "brand", "home", "search", "setup", "route", "boarding", "recap", "mapImport",
    "check", "ride", "count", "trust", "favorite", "demo", "end", "handoff", "common",
    "alert", "live_activity", "shortcut", "live", "share", "returnTrip", "rescue",
)
LITERAL = re.compile(r'"((?:%s)\.[A-Za-z0-9_.]+)"' % "|".join(PREFIXES))
# `RideText.countKey("<key>", n)` also reads "<key>.one" for a count of one.
COUNT_KEY = re.compile(r'countKey\(\s*(?:[^()]*\?\s*)?"([^"]+)"(?:\s*:\s*"([^"]+)")?')
STRINGS_LINE = re.compile(r'^"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)";\s*$')


def enum_cases(path: pathlib.Path, name: str) -> list[str]:
    source = path.read_text()
    body = re.search(r"enum %s\b[^{]*\{(.*?)\n\}" % name, source, re.S).group(1)
    return re.findall(r"^\s*case (\w+)", body, re.M)


def load(table: pathlib.Path) -> dict[str, str]:
    entries = {}
    for number, line in enumerate(table.read_text().splitlines(), 1):
        if not line.strip() or line.startswith("//") or (line.startswith("/*") and line.rstrip().endswith("*/")):
            continue
        match = STRINGS_LINE.match(line)
        if not match:
            sys.exit(f"{table}:{number}: not a strings entry: {line}")
        if match.group(1) in entries:
            sys.exit(f"{table}:{number}: duplicate key {match.group(1)}")
        entries[match.group(1)] = match.group(2)
    return entries


def main() -> int:
    used = set()
    for path in list(IOS.rglob("*.swift")):
        if "/Tests/" in str(path):
            continue
        source = path.read_text()
        used.update(LITERAL.findall(source))
        for keys in COUNT_KEY.findall(source):
            used.update(f"{key}.one" for key in keys if key)

    moments = enum_cases(CORE / "RideGuidance.swift", "RideMoment")
    for moment in moments:
        used.update({f"ride.{moment}.headline", f"ride.{moment}.detail", f"ride.{moment}.eyebrow"})
        if moment != "riding":
            used.add(f"ride.{moment}.compact")
    for stage in enum_cases(CORE / "VehicleCheck.swift", "VehicleCheckStage"):
        used.update({f"check.{stage}.headline", f"check.{stage}.detail"})
    for status in enum_cases(CORE / "RideGuidance.swift", "VehicleIdentityStatus"):
        used.add(f"trust.vehicle.{status}")
    for status in enum_cases(CORE / "RideGuidance.swift", "DataLinkStatus"):
        used.add(f"trust.data.{status}")
    for milestone in enum_cases(CORE / "RideGuidance.swift", "RideMilestone"):
        used.update({f"alert.{milestone}.title", f"alert.{milestone}.body"})
    for scenario in enum_cases(CORE / "DemoCatalog.swift", "DemoRideScenario"):
        used.add(f"demo.scenario.{scenario}")
    for app in enum_cases(CORE / "MapHandoff.swift", "MapApp"):
        used.add(f"handoff.failed.{app}")
    # `SharedPlaceCard`: "mapImport.source." + `SharedPlaceSource.rawValue`.
    for source in enum_cases(CORE / "SharedPlace.swift", "SharedPlaceSource"):
        used.add(f"mapImport.source.{source}")
    # `TransitAPIFailure.copyKey` + ".title" / ".body", built at runtime.
    failures = re.findall(r'case \.(\w+): "(\w+)"', (CORE / "TransitAPIModels.swift").read_text())
    if not failures:
        sys.exit("no TransitAPIFailure names found in TransitAPIModels.swift")
    for case, name in failures:
        if case != name:
            sys.exit(f"TransitAPIFailure.{case} names itself {name}")
        used.update({f"live.error.{name}.title", f"live.error.{name}.body"})
    # Prefixes built by concatenation in Swift, not literal keys themselves.
    used -= {"trust.vehicle.", "trust.data.", "demo.scenario.", "handoff.failed.", "alert.", "mapImport.source."}
    used = {key for key in used if not key.endswith(".")}

    ko = load(IOS / "Resources/ko.lproj/Localizable.strings")
    en = load(IOS / "Resources/en.lproj/Localizable.strings")
    problems = []
    for key in sorted(used):
        for name, table in (("ko", ko), ("en", en)):
            if key not in table:
                problems.append(f"missing in {name}: {key}")
    for key in sorted(set(ko) ^ set(en)):
        problems.append(f"only in {'ko' if key in ko else 'en'}: {key}")
    for key in sorted(set(ko) & set(en)):
        if ko[key].count("%") != en[key].count("%"):
            problems.append(f"format arguments differ: {key}")
    unused = sorted(set(ko) - used)
    if problems:
        print("\n".join(problems))
        return 1
    print(f"localization ok: {len(used)} keys used, {len(ko)} per table" + (f", unused: {', '.join(unused)}" if unused else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
