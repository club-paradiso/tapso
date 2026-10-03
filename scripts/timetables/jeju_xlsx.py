#!/usr/bin/env python3
"""Parse one official Jeju route timetable (XLSX from bus.jeju.go.kr) into
`tapso-jeju-timetable-v2` JSON.

    python3 scripts/timetables/jeju_xlsx.py RAW.xlsx --retrieved-on YYYY-MM-DD > OUT.json

Written against the real files, Routes 365 and 442 downloaded 2026-10-03
(`fixtures/jeju/timetables/raw/`). The layout it reads, per sheet:

    B2  "<route>번(<day label>)"          e.g. "365번(평일)", "365번(토,공휴일)";
        or "<route>번" alone (Route 442): the file states no day type
    B3  direction                        e.g. "한라대→공항→시청→제주대"
    B5  summary: first and last bus, headway, operator
    row 5, any column: "(시행일 : 2026. 6. 24.)"
    the row whose B is "구분": timepoint names, then "비고"
    below it, one trip per row: B = 1, 2, 3 ...; each timepoint cell is
        "HH:MM" or "H:MM"                 the scheduled time there
        "X" or blank                      the trip does not serve it
        "H:MM\\n(출발)"                    the trip starts here, at that time (Route 442)
        "H:MM\\n(<place> 출발)"            the trip starts at <place>, off the table, at that time
    A circular route heads the same timepoint more than once (Route 442).

Anything else stops the parse with the sheet and cell named. Nothing is
guessed: an unknown day label, a time past midnight, times out of order, or a
summary whose first or last bus disagrees with the trips are all errors. Uses
the standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

PARSER_NAME = "jeju-bis-xlsx"
PARSER_VERSION = "2"
SCHEMA_VERSION = "tapso-jeju-timetable-v2"
SOURCE_PAGE = "https://bus.jeju.go.kr/publicTrafficInformation/generalBusSchedule"

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

# The day labels seen in real files, verbatim, and what they mean. A label not
# listed here stops the parse; it is added only after reading a file that has it.
# "토,공휴일": Saturday and public holidays. Sunday is a public holiday under
# 관공서의 공휴일에 관한 규정 제2조 제1호, so the service runs on Sundays too.
DAY_LABELS = {
    "평일": "weekday",
    "토,공휴일": "saturday_sunday_holiday",
}

TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
STARTS_HERE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)\s*\n\s*\(\s*출발\s*\)$")
STARTS_AT = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)\s*\n\s*\(?\s*([^()\n]+?)\s*출발\s*\)?$")
TITLE = re.compile(r"^(\S+?)번(?:\s*\((.+)\))?$")

# Sheets whose own summary line disagrees with their trips, accepted one exact
# disagreement at a time: (route, sheet name, the message the parser would stop
# with). The trips are kept and the disagreement is recorded in the dataset.
# Keyed by content, not by file checksum: the site writes a fresh workbook on
# every download, so the same timetable never has the same bytes twice. Any
# other disagreement, or this one with different times, still stops the parse.
KNOWN_SUMMARY_CONFLICTS = {
    # Route 442, read 2026-10-03: the summary says "첫차(제주여고 출발) 05:50",
    # trip 1 reads "5:55 (출발)" under 제주여자중고등학교.
    ("442", "442 순환(별빛누리-연북로-용담-시청-별빛누리)", "summary 첫차 05:50 disagrees with the trips (05:55)"),
}
EFFECTIVE = re.compile(r"시행일\s*:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?")
SUMMARY_FIRST = re.compile(r"첫차[^0-9]*?(\d{1,2}:\d{2})")
SUMMARY_LAST = re.compile(r"막차\s*(\d{1,2}:\d{2})")


class TimetableParseError(Exception):
    pass


def hhmm(hours: str, minutes: str) -> str:
    return f"{int(hours):02d}:{minutes}"


def column_index(ref: str) -> tuple[int, int]:
    """'J12' -> (10, 12)"""
    match = re.match(r"^([A-Z]+)(\d+)$", ref)
    if not match:
        raise TimetableParseError(f"unreadable cell reference {ref!r}")
    letters, row = match.groups()
    column = 0
    for letter in letters:
        column = column * 26 + ord(letter) - 64
    return column, int(row)


def column_letter(column: int) -> str:
    out = ""
    while column:
        column, rest = divmod(column - 1, 26)
        out = chr(65 + rest) + out
    return out


def read_workbook(path: Path) -> list[tuple[str, dict[tuple[int, int], str]]]:
    """Each sheet as (name, {(column, row): text}). Numbers come back as their text."""
    with zipfile.ZipFile(path) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si", NS):
                shared.append("".join(node.text or "" for node in item.iter(f"{{{NS['m']}}}t")))
        relations = {
            rel.get("Id"): rel.get("Target")
            for rel in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels")).findall("rel:Relationship", NS)
        }
        sheets = []
        for sheet in ET.fromstring(archive.read("xl/workbook.xml")).find("m:sheets", NS).findall("m:sheet", NS):
            target = relations[sheet.get(f"{{{NS['r']}}}id")]
            member = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
            cells: dict[tuple[int, int], str] = {}
            for cell in ET.fromstring(archive.read(member)).iter(f"{{{NS['m']}}}c"):
                kind = cell.get("t")
                if kind == "inlineStr":
                    text = "".join(node.text or "" for node in cell.iter(f"{{{NS['m']}}}t"))
                else:
                    value = cell.find("m:v", NS)
                    if value is None or value.text is None:
                        continue
                    text = shared[int(value.text)] if kind == "s" else value.text
                cells[column_index(cell.get("r"))] = text
            sheets.append((sheet.get("name"), cells))
        return sheets


def parse_sheet(name: str, cells: dict[tuple[int, int], str]) -> tuple[str, dict]:
    def at(column: int, row: int) -> str:
        return cells.get((column, row), "")

    def where(column: int, row: int) -> str:
        return f"sheet {name!r} cell {column_letter(column)}{row}"

    title = TITLE.match(at(2, 2).strip())
    if not title:
        raise TimetableParseError(f"{where(2, 2)}: expected '<route>번(<day>)', found {at(2, 2)!r}")
    route = title.group(1)
    day_label = re.sub(r"\s+", "", title.group(2)) if title.group(2) else None
    if day_label is not None and day_label not in DAY_LABELS:
        raise TimetableParseError(f"{where(2, 2)}: day label {day_label!r} is not one TAPSO has read before")
    direction = at(2, 3).strip()
    if not direction:
        raise TimetableParseError(f"{where(2, 3)}: direction is empty")
    summary = at(2, 5).strip()

    effective = [EFFECTIVE.search(text) for (column, row), text in cells.items() if row == 5]
    effective = [match for match in effective if match]
    if len(effective) > 1:
        raise TimetableParseError(f"sheet {name!r}: more than one 시행일 in row 5")
    effective_from = None
    if effective:
        year, month, day = effective[0].groups()
        effective_from = f"{year}-{int(month):02d}-{int(day):02d}"

    header_rows = [row for (column, row), text in cells.items() if column == 2 and text.strip() == "구분"]
    if len(header_rows) != 1:
        raise TimetableParseError(f"sheet {name!r}: expected one '구분' header in column B, found {len(header_rows)}")
    header = header_rows[0]
    timepoints: list[str] = []
    note_column = None
    column = 3
    while at(column, header).strip():
        label = re.sub(r"\s+", "", at(column, header))
        if label == "비고":
            note_column = column
            break
        # Headers wrap long names over lines ("제주여자\n중고등학교"); the name keeps one space there.
        timepoints.append(re.sub(r"\s+", " ", at(column, header).strip()))
        column += 1
    if len(timepoints) < 2:
        raise TimetableParseError(f"sheet {name!r}: fewer than two timepoints in row {header}")
    last_column = (note_column or column - 1)

    trips = []
    row = header + 1
    last_row = max(r for (_, r) in cells)
    while row <= last_row:
        sequence = at(2, row).strip()
        if not sequence:
            if any(at(c, row).strip() for c in range(3, last_column + 1)):
                raise TimetableParseError(f"{where(2, row)}: a row with times but no trip number")
            row += 1
            continue
        if not re.match(r"^\d+(\.0)?$", sequence) or int(float(sequence)) != len(trips) + 1:
            raise TimetableParseError(f"{where(2, row)}: expected trip {len(trips) + 1}, found {sequence!r}")
        times: list[str | None] = []
        starts_at = None
        for index in range(len(timepoints)):
            column = 3 + index
            raw = at(column, row)
            text = raw.strip()
            match = TIME.match(text)
            if match:
                times.append(hhmm(*match.groups()))
            elif text.upper() == "X" or text == "":
                times.append(None)
            elif STARTS_HERE.match(text):
                times.append(hhmm(*STARTS_HERE.match(text).groups()))
            elif STARTS_AT.match(text):
                if starts_at is not None or any(time is not None for time in times):
                    raise TimetableParseError(f"{where(column, row)}: a start off the table must come before every time")
                hours, minutes, place = STARTS_AT.match(text).groups()
                starts_at = {"place": place, "time": hhmm(hours, minutes), "column": timepoints[index]}
                times.append(None)
            else:
                raise TimetableParseError(f"{where(column, row)}: unreadable value {raw!r}")
        sequence_times = ([starts_at["time"]] if starts_at else []) + [time for time in times if time is not None]
        if not any(time is not None for time in times):
            raise TimetableParseError(f"sheet {name!r} row {row}: trip {len(trips) + 1} has no time")
        if any(left >= right for left, right in zip(sequence_times, sequence_times[1:])):
            raise TimetableParseError(f"sheet {name!r} row {row}: times are not strictly ascending")
        trip: dict = {"times": times}
        if starts_at:
            trip["startsAt"] = starts_at
        note = at(note_column, row).strip() if note_column else ""
        if note:
            trip["note"] = note
        trips.append(trip)
        row += 1
    if not trips:
        raise TimetableParseError(f"sheet {name!r}: no trips")

    def first_time(trip: dict) -> str:
        return trip["startsAt"]["time"] if "startsAt" in trip else next(time for time in trip["times"] if time)

    starts = [first_time(trip) for trip in trips]
    # Trips may start at different places (the first buses start before the
    # first timepoint), so order is checked where trips meet: at each timepoint.
    for index, timepoint in enumerate(timepoints):
        column_times = [trip["times"][index] for trip in trips if trip["times"][index]]
        if any(left > right for left, right in zip(column_times, column_times[1:])):
            raise TimetableParseError(f"sheet {name!r}: trips are out of order at {timepoint!r}")
    # The sheet's own summary must agree with its trips.
    conflicts = []
    for pattern, expected, word in ((SUMMARY_FIRST, starts[0], "첫차"), (SUMMARY_LAST, starts[-1], "막차")):
        found = pattern.search(summary)
        if found and hhmm(*found.group(1).split(":")) != expected:
            message = f"summary {word} {found.group(1)} disagrees with the trips ({expected})"
            if (route, name, message) not in KNOWN_SUMMARY_CONFLICTS:
                raise TimetableParseError(f"sheet {name!r}: {message}")
            conflicts.append(message)

    service = {
        "sheet": name,
        "dayType": DAY_LABELS[day_label] if day_label else "unstated",
        **({"dayLabel": day_label} if day_label else {}),
        "direction": direction,
        **({"effectiveFrom": effective_from} if effective_from else {}),
        "summary": summary,
        "timepoints": timepoints,
        "trips": trips,
        **({"summaryConflicts": conflicts} if conflicts else {}),
    }
    return route, service


def parse_file(path: Path, retrieved_on: str, file_name: str | None = None) -> dict:
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", retrieved_on):
        raise TimetableParseError("--retrieved-on must be YYYY-MM-DD")
    sheets = read_workbook(path)
    if not sheets:
        raise TimetableParseError("the workbook has no sheet")
    routes, services = set(), []
    for name, cells in sheets:
        route, service = parse_sheet(name, cells)
        routes.add(route)
        services.append(service)
    if len(routes) != 1:
        raise TimetableParseError(f"the sheets name more than one route: {sorted(routes)}")
    keys = [(service["direction"], service["dayType"]) for service in services]
    if len(set(keys)) != len(keys):
        raise TimetableParseError("two sheets have the same direction and day type")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "label": "OFFICIAL_DATED",
        "source": {
            "publisher": "제주특별자치도 (bus.jeju.go.kr)",
            "dataset": "data.go.kr 3043887",
            "page": SOURCE_PAGE,
            "file": file_name or path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        },
        "retrievedOn": retrieved_on,
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "routeNumber": routes.pop(),
        "services": services,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("xlsx", type=Path)
    parser.add_argument("--retrieved-on", required=True, help="Korean date the file was downloaded, YYYY-MM-DD")
    parser.add_argument("--file-name", help="the file name as downloaded, if the path differs")
    args = parser.parse_args()
    try:
        dataset = parse_file(args.xlsx, args.retrieved_on, args.file_name)
    except TimetableParseError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    json.dump(dataset, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
