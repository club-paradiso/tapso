#!/usr/bin/env python3
"""Keeps the checked-in Tapso.xcodeproj in step with the Swift files on disk.

XcodeGen (`apps/ios/project.yml`) is the source of truth, but it needs macOS.
This script makes the same membership edits XcodeGen would for flat source
folders, so the committed project builds on a machine without XcodeGen. CI
also regenerates the project with XcodeGen and compares source membership.

Usage: python3 scripts/ios/sync_xcodeproj.py [--check]
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
IOS = ROOT / "apps/ios"
PROJECT = IOS / "Tapso.xcodeproj/project.pbxproj"

# Folder → the Sources phases that compile it (app, Live Activity, share extension, tests).
# The share extension also compiles Shared/TapsoTokens.swift, listed by hand in its phase.
APP, EXTENSION, SHARE, TESTS = "779B7B7365A3FD895ED6DC44", "A7E097169D131746FC0B4825", "9070D4E8E5B9F0930C1303EB", "CB0AEBFC243A761C86835658"
GROUPS = {
    "TapsoApp": ("CAAA87E4928CDF78676CD392", [APP]),
    "Shared": ("2DD9A96AC488A534FCCDC0DD", [APP, EXTENSION]),
    "LiveActivity": ("B2BE8F29DB0AEF7B3F86029C", [EXTENSION]),
    "ShareExtension": ("5EE3A8D76407D1DF9BAD6C89", [SHARE]),
    "Tests": ("062A2546A85E60F33E64530A", [TESTS]),
}


def object_id(*parts: str) -> str:
    return hashlib.md5("|".join(parts).encode()).hexdigest()[:24].upper()


def block(text: str, object_key: str) -> tuple[int, int]:
    start = re.search(rf"^\t\t{object_key} ", text, re.M).start()
    end = text.index("\n\t\t};\n", start) + len("\n\t\t};\n")
    return start, end


def children(text: str, object_key: str, list_name: str) -> list[tuple[str, str]]:
    start, end = block(text, object_key)
    body = text[start:end]
    inner = body[body.index(f"{list_name} = (") : body.index(");", body.index(f"{list_name} = ("))]
    return re.findall(r"([0-9A-F]{24}) /\* (.+?) \*/,", inner)


def set_children(text: str, object_key: str, list_name: str, entries: list[tuple[str, str]]) -> str:
    start, end = block(text, object_key)
    body = text[start:end]
    open_at = body.index(f"{list_name} = (") + len(f"{list_name} = (")
    close_at = body.index(");", open_at)
    indent = "\t\t\t\t"
    lines = "".join(f"\n{indent}{identifier} /* {name} */," for identifier, name in entries)
    body = body[:open_at] + lines + "\n\t\t\t" + body[close_at:]
    return text[:start] + body + text[end:]


def insert_line(text: str, section: str, line: str) -> str:
    marker = f"/* End {section} section */"
    return text.replace(marker, line + "\n" + marker, 1)


def main() -> int:
    original = PROJECT.read_text()
    text = original
    refs = dict(re.findall(r"\t\t([0-9A-F]{24}) /\* ([^*]+?\.swift) \*/ = \{isa = PBXFileReference;", text))

    for folder, (group, phases) in GROUPS.items():
        on_disk = sorted(path.name for path in (IOS / folder).glob("*.swift"))
        members = children(text, group, "children")
        in_group = {name: identifier for identifier, name in members if name.endswith(".swift")}

        for name in sorted(set(in_group) - set(on_disk)):
            file_ref = in_group[name]
            text = re.sub(rf"\t\t[0-9A-F]{{24}} /\* {re.escape(name)} in Sources \*/ = \{{isa = PBXBuildFile; fileRef = {file_ref} .*?\n", "", text)
            text = re.sub(rf"\t\t{file_ref} /\* {re.escape(name)} \*/ = \{{isa = PBXFileReference;.*?\n", "", text)
            members = [(identifier, member) for identifier, member in members if identifier != file_ref]
            for phase in phases:
                entries = [(i, n) for i, n in children(text, phase, "files") if n != f"{name} in Sources"]
                text = set_children(text, phase, "files", entries)

        for name in sorted(set(on_disk) - set(in_group)):
            file_ref = object_id(folder, name, "file")
            text = insert_line(
                text,
                "PBXFileReference",
                f'\t\t{file_ref} /* {name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {name}; sourceTree = "<group>"; }};',
            )
            members.append((file_ref, name))
            for phase in phases:
                build = object_id(folder, name, phase)
                text = insert_line(
                    text,
                    "PBXBuildFile",
                    f"\t\t{build} /* {name} in Sources */ = {{isa = PBXBuildFile; fileRef = {file_ref} /* {name} */; }};",
                )
                entries = children(text, phase, "files") + [(build, f"{name} in Sources")]
                text = set_children(text, phase, "files", sorted(entries, key=lambda entry: entry[1].lower()))

        text = set_children(text, group, "children", sorted(members, key=lambda entry: entry[1].lower()))

    if "--check" in sys.argv:
        if text != original:
            print("Tapso.xcodeproj is out of date; run python3 scripts/ios/sync_xcodeproj.py")
            return 1
        print("Tapso.xcodeproj source membership matches the files on disk")
        return 0
    PROJECT.write_text(text)
    print("updated" if text != original else "already in sync")
    return 0


if __name__ == "__main__":
    sys.exit(main())
