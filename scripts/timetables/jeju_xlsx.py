#!/usr/bin/env python3
"""Parse one official Jeju route timetable (XLSX from bus.jeju.go.kr) into
`tapso-jeju-timetable-v3` JSON.

    python3 scripts/timetables/jeju_xlsx.py RAW.xlsx --retrieved-on YYYY-MM-DD [--name "231, 232"] > OUT.json

Written against the real files: Routes 365 and 442 (downloaded by hand
2026-10-03, `fixtures/jeju/timetables/raw/`) and the full census of 234
workbooks (`fixtures/jeju/timetables/bis/raw/`). Every rule below names the
layout it was read from; docs/exec-plans/JEJU_PRODUCTION_V1.md lists the
format families.

Per sheet:

    B2  title: route numbers, an optional day label, optional service labels
          "365번(평일)"  "231번, 232번"  "704-1,3번\\n(옵서버스)"  "임시 590번"
          "741-1번 (토요일,옵서버스)"  "921 우도마을버스\\n(해안도로 순환)"
    B3  direction                        "한라대→공항→시청→제주대"
    B5  summary: first and last bus, per route when the sheet has several
          "[231번] 첫차 6:00, 막차 21:25, ..."
    row 5, any column: "(시행일 : 2026. 6. 24.)"
    the row whose B is "구분": optional "노선번호" column, timepoint names,
        blank spacer columns, then "비고"
    below it, one trip per row, B = 1, 2, 3 ...

What a timepoint cell may hold (anything else stops the parse, cell named):

    "HH:MM"                       the time there
    "", "X", "×", "-"             not served there
    "X(공항 미경유)"               not served there, with the source's note
    "●" "○" "O" "◎"               served there, no time published (the
                                  "(경유)" and express-section columns)
    "H:MM(출발)"                   the trip starts here
    "H:MM(종료)" "(도착)" "(종점)"  the trip ends here
    "H:MM(<place> 출발)",          the trip starts at <place>, at that time;
      "<place> 출발 H:MM"          the time is <place>'s, not this column's
    "H:MM(<x> 경유)" "(<x>미경유)"  the time here, via or not via <x>
    "H:MM(승객 없을시 <x> 종료)"    the time here; may end early (conditional)
    "H:MM(월,화,목,금)"             the time here, on those weekdays only
    "H:MM(<anything else>)",       a time labelled with another place: kept
      "<label> H:MM"               with its label, never as this column's time
    "H:MM\\n(H:MM)", "\\n(H:MM)"    an alternate time (e.g. market days); the
                                  condition must be stated in 비고
    "공항 6:35한라병원 6:44"         several labelled times, none this column's
    text with no digit             a note; no time
    a row of "H:MM ~ H:MM (실시간 호출형)" and spelled-out letters
                                  a demand-responsive window, no timetable
    a row spelling "운행 중단"      the source's suspension notice

Nothing is guessed. A time comes only from the grammar above. A trip whose
times run backwards (other than across midnight in a late-night table), a
summary whose first or last bus disagrees with the trips, or two sheets for
the same direction and day that disagree, make that service SOURCE_CONFLICT:
kept, reported, never served as a schedule. Uses the standard library only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

PARSER_NAME = "jeju-bis-xlsx"
PARSER_VERSION = "3"
SCHEMA_VERSION = "tapso-jeju-timetable-v3"
SOURCE_PAGE = "https://bus.jeju.go.kr/publicTrafficInformation/generalBusSchedule"

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

# Day labels seen in real titles, verbatim (whitespace removed), and what they
# mean. A label not listed stops the parse; it is added only after reading a
# file that has it, with its evidence here.
DAY_LABELS = {
    "평일": "weekday",
    # Route 742-2: title "(평,옵서버스)", sheet name "(평일)".
    "평": "weekday",
    # "토,공휴일": Saturday and public holidays. Sunday is a public holiday under
    # 관공서의 공휴일에 관한 규정 제2조 제1호, so the service runs on Sundays too.
    "토,공휴일": "saturday_sunday_holiday",
    "토.공휴일": "saturday_sunday_holiday",
    "토·공휴일": "saturday_sunday_holiday",
    # Route 1100: "주말/공휴일". 주말 is Saturday and Sunday.
    "주말/공휴일": "saturday_sunday_holiday",
    "토요일": "saturday",
    # Routes 741-1, 741-2, 742-2: "일,공휴일" next to a separate "토요일" sheet.
    "일,공휴일": "sunday_holiday",
    # Routes 705, 772-1, 772-2: "휴일" alone. The same publisher's sheet names use
    # "(휴일)" both for "토,공휴일" (Routes 320, 360, 365, 415) and for
    # "일,공휴일" (Routes 741-1, 741-2, 742-2). Both include Sundays and public
    # holidays; whether Saturday is included is not stated. TAPSO never picks
    # this service for a Saturday.
    "휴일": "holiday_saturday_unstated",
}

# Labels in a title that describe the service, not the day. Kept verbatim.
SERVICE_LABELS = {
    "옵서버스", "공항리무진", "도심급행", "자율주행", "임시노선", "임시", "심야", "새벽심야",
    "한라눈꽃버스", "순환", "해안코스", "야간코스", "임시수요맞춤", "수요맞춤형", "수요맞춤",
    "관광지순환", "해안도로순환", "마을안길", "도심코스",
}

TIME_CORE = r"([01]?\d|2[0-3])\s*:\s*([0-5]\d)"
TIME = re.compile(rf"^{TIME_CORE}$")
TIME_ANY = re.compile(TIME_CORE)
SEASONS = {"동절기", "하절기"}
# A 비고 or cell note that limits when a trip runs. Such a trip is shown with
# its note and never counted as a day's first or last bus.
RESTRICTING = re.compile(
    r"운행\s*안\s*함|운행안함|미운행|만\s*운행|막차|첫차|동절기|하절기|입항|방학|평일|주말|공휴일|휴일|토요일|일요일"
    r"|\d+\s*월|\d+\s*일|오일장|운행\s*중단|임시|수요|호출|예약|격일|홀수|짝수"
)
NOT_SERVED = {"", "X", "x", "×", "-", "－"}
MARKS = {"●", "○", "O", "◎"}
WEEKDAYS = {"월": "mon", "화": "tue", "수": "wed", "목": "thu", "금": "fri", "토": "sat", "일": "sun"}
EFFECTIVE = re.compile(r"시행일\s*:\s*(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})")
EFFECTIVE_MISSING = re.compile(r"시행일\s*:\s*미입력")
ROUTE_TOKEN = re.compile(r"\d{1,4}(?:-\d{1,2})?")

# Sheets whose own summary line disagrees with their trips, accepted one exact
# disagreement at a time: (route, sheet name, message). The trips are kept and
# the disagreement is recorded. Keyed by content, not by checksum: the site
# writes a fresh workbook on every download. Any other disagreement makes the
# service SOURCE_CONFLICT.
KNOWN_SUMMARY_CONFLICTS = {
    # Route 442, read 2026-10-03: the summary says "첫차(제주여고 출발) 05:50",
    # trip 1 reads "5:55 (출발)" under 제주여자중고등학교. Which is right is UNKNOWN;
    # the trips are what TAPSO shows, with the conflict stated.
    ("442", "442 순환(별빛누리-연북로-용담-시청-별빛누리)", "summary 첫차 05:50 disagrees with the trips (05:55)"),
}


class TimetableParseError(Exception):
    """The file is outside the grammar: TAPSO cannot vouch for any of it."""

    def __init__(self, message: str, family: str = "unclassified") -> None:
        super().__init__(message)
        self.family = family


class MalformedTime(TimetableParseError):
    """A cell that is almost a time ("07;35"). Never corrected: the service becomes SOURCE_CONFLICT."""

    def __init__(self, message: str) -> None:
        super().__init__(message, "malformed_time")


def looks_like_time(text: str) -> bool:
    """Digits that could be (part of) a time: a digit next to ':' or ';' ("06:3O"
    included), H.MM, or a run of 3-4 digits. Such text must match the time
    grammar exactly; only text with none of these is kept as a note."""
    return bool(re.search(r"\d\s*[:;]|[:;]\s*\d|\d{1,2}\.\d{2}(?!\d)|\d{3,4}|\d\s*시(?:\s*\d|\b|$)|\d\s*분", text))


class SuspendedNotice(Exception):
    """Every sheet is the source's own notice that the service is suspended."""


def hhmm(hours: str | int, minutes: str | int) -> str:
    return f"{int(hours):02d}:{int(minutes):02d}"


def minutes_of(text: str) -> int:
    hours, minutes = text.split(":")
    return int(hours) * 60 + int(minutes)


def from_minutes(value: int) -> str:
    return f"{value // 60:02d}:{value % 60:02d}"


def column_index(ref: str) -> tuple[int, int]:
    """'J12' -> (10, 12)"""
    match = re.match(r"^([A-Z]+)(\d+)$", ref)
    if not match:
        raise TimetableParseError(f"unreadable cell reference {ref!r}", "workbook")
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


class Cells(dict):
    """{(column, row): text}, plus the sheet's merged ranges as ((c1, r1), (c2, r2))."""

    merges: list[tuple[tuple[int, int], tuple[int, int]]] = []


def read_workbook(path: Path) -> list[tuple[str, dict[tuple[int, int], str]]]:
    """Each sheet as (name, Cells). Numbers come back as their text."""
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
            cells = Cells()
            tree = ET.fromstring(archive.read(member))
            cells.merges = []
            for merge in tree.iter(f"{{{NS['m']}}}mergeCell"):
                first, _, last = (merge.get("ref") or "").partition(":")
                if first and last:
                    cells.merges.append((column_index(first), column_index(last)))
            for cell in tree.iter(f"{{{NS['m']}}}c"):
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


def squash(text: str) -> str:
    return re.sub(r"\s+", "", text)


def one_line(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


# ---------------------------------------------------------------- titles

def route_numbers_in(text: str) -> list[str]:
    """Route numbers in a title or listing, with the "704-1,3" shorthand expanded.

    "231번, 232번" -> [231, 232]; "704-1,3번" -> [704-1, 704-3]. A bare one- or
    two-digit number directly after "<n>-<m>" and a comma is that route's
    sibling branch; nowhere else is a number completed."""
    found: list[str] = []
    for match in re.finditer(r"(\d{1,4}(?:-\d{1,2})?)", text):
        token = match.group(1)
        previous = found[-1] if found else None
        between = text[match.start() - 1] if match.start() > 0 else ""
        if previous and "-" in previous and "-" not in token and len(token) <= 2 and between == ",":
            token = f"{previous.split('-')[0]}-{token}"
        found.append(token)
    return list(dict.fromkeys(found))


def parse_title(text: str, where: str) -> dict:
    """{routes, dayLabel, serviceLabels} from a sheet title, or a parse error."""
    groups = re.findall(r"\(([^()]*)\)", text)
    rest = re.sub(r"\([^()]*\)", " ", text)
    day_labels: list[str] = []
    service_labels: list[str] = []
    route_text = rest
    for group in groups:
        compact = squash(group)
        if re.fullmatch(r"\d{1,4}(?:-\d{1,2})?번?", compact):
            route_text += f" {compact}"
            continue
        tokens = [token for token in compact.split(",") if token]
        index = 0
        while index < len(tokens):
            for end in range(len(tokens), index, -1):
                candidate = ",".join(tokens[index:end])
                if candidate in DAY_LABELS:
                    day_labels.append(candidate)
                    break
                if candidate in SERVICE_LABELS:
                    service_labels.append(candidate)
                    break
            else:
                raise TimetableParseError(f"{where}: title label {tokens[index]!r} is not one TAPSO has read before", "title_label")
            index = end
    # Prefixes and suffixes naming the service: "수요맞춤형 111-1번", "임시 590번",
    # "921 우도마을버스", "동복리마을버스(N번)".
    for pattern in (r"수요맞춤형", r"임시", r"(\S*마을버스)"):
        for match in re.finditer(pattern, route_text):
            service_labels.append(squash(match.group(0)))
        route_text = re.sub(pattern, " ", route_text)
    routes = route_numbers_in(route_text)
    leftover = re.sub(r"\d{1,4}(?:-\d{1,2})?|번|[,/\s]", "", route_text)
    if leftover:
        raise TimetableParseError(f"{where}: title has unread text {leftover!r}", "title_text")
    if not routes:
        raise TimetableParseError(f"{where}: title names no route", "title_text")
    if len(day_labels) > 1:
        raise TimetableParseError(f"{where}: title has two day labels {day_labels}", "title_label")
    return {"routes": routes, "dayLabel": day_labels[0] if day_labels else None, "serviceLabels": list(dict.fromkeys(service_labels))}


# ---------------------------------------------------------------- cells

def classify_annotation(text: str, column_name: str | None) -> tuple[str, dict]:
    """What a digit-free annotation next to a time says about that time.

    Returns (kind, detail): "start_here", "end_here", "via", "conditional",
    "days", "start_at", "end_at" or "labelled"."""
    note = one_line(text.strip().strip("()").strip())
    compact = squash(note)
    if compact == "출발":
        return "start_here", {}
    if compact in ("종료", "도착", "종점"):
        return "end_here", {}
    if "없" in compact and ("종료" in compact or "미운행" in compact or "미경유" in compact):
        return "conditional", {"note": note}
    if compact.endswith("경유"):
        return "via", {"note": note}
    if re.fullmatch(r"[월화수목금토일](,[월화수목금토일])+", compact):
        return "days", {"days": [WEEKDAYS[day] for day in compact.split(",")]}
    for suffix, here, there in (("출발", "start_here", "start_at"), ("종료", "end_here", "end_at"), ("종점", "end_here", "end_at"), ("회차", "end_here", "end_at")):
        if compact.endswith(suffix):
            place = re.sub(r"\s*(출발|종료|종점|회차)$", "", note).strip()
            if column_name is not None and squash(place) == squash(column_name):
                return here, {}
            return there, {"place": place}
    return "labelled", {"label": note}


def parse_cell(raw: str, column_name: str | None) -> dict:
    """One timepoint cell. Raises TimetableParseError on anything outside the grammar."""
    text = raw.strip()
    if text in NOT_SERVED:
        return {"kind": "none"}
    if text in MARKS:
        return {"kind": "mark", "mark": text}
    not_served = re.fullmatch(r"[Xx×]\s*\(?\s*([^()]+?)\s*\)?", text, flags=re.S)
    if not_served and looks_like_time(not_served.group(1)):
        not_served = None
    if not_served:
        return {"kind": "none", "note": one_line(not_served.group(1))}
    if not looks_like_time(text):
        return {"kind": "note", "note": one_line(text)}
    match = TIME.fullmatch(text)
    if match:
        return {"kind": "time", "time": hhmm(*match.groups())}
    window = re.fullmatch(rf"{TIME_CORE}\s*~\s*{TIME_CORE}\s*\(?\s*([^()\d]*?)\s*\)?", text, flags=re.S)
    if window:
        h1, m1, h2, m2, label = window.groups()
        return {"kind": "window", "from": hhmm(h1, m1), "to": hhmm(h2, m2), "label": one_line(label)}
    alternate = re.fullmatch(rf"(?:{TIME_CORE})?\s*\(\s*{TIME_CORE}\s*\)", text, flags=re.S)
    if alternate:
        h1, m1, h2, m2 = alternate.groups()
        return {"kind": "alternate", "time": hhmm(h1, m1) if h1 is not None else None, "alternate": hhmm(h2, m2)}
    prefixed = re.fullmatch(rf"\(\s*([^()\d]+?)\s*{TIME_CORE}\s*\)\s*{TIME_CORE}", text, flags=re.S)
    if prefixed:
        place, h1, m1, h2, m2 = prefixed.groups()
        return {"kind": "time", "time": hhmm(h2, m2), "offTable": [{"place": one_line(place), "time": hhmm(h1, m1), "role": "before"}]}
    suffix = re.fullmatch(rf"{TIME_CORE}\s*\(?\s*([^()]+?)\s*\)?", text, flags=re.S)
    prefix = re.fullmatch(rf"\(?\s*([^()]+?)\s*\)?\s*{TIME_CORE}", text, flags=re.S)
    if suffix and looks_like_time(suffix.group(3)):
        suffix = None
    if prefix and looks_like_time(prefix.group(1)):
        prefix = None
    if suffix or prefix:
        if suffix:
            hours, minutes, note = suffix.groups()
        else:
            note, hours, minutes = prefix.groups()
        time = hhmm(hours, minutes)
        kind, detail = classify_annotation(note, column_name)
        if kind == "start_here":
            return {"kind": "time", "time": time, "role": "start"}
        if kind == "end_here":
            return {"kind": "time", "time": time, "role": "end"}
        if kind in ("via", "conditional"):
            return {"kind": "time", "time": time, "note": detail["note"], **({"conditional": True} if kind == "conditional" else {})}
        if kind == "days":
            return {"kind": "time", "time": time, "days": detail["days"]}
        if kind == "start_at":
            return {"kind": "start_at", "place": detail["place"], "time": time}
        if kind == "end_at":
            return {"kind": "labelled", "place": detail["place"], "time": time, "role": "end"}
        return {"kind": "labelled", "place": detail["label"], "time": time, "role": "at"}
    around = re.fullmatch(rf"([^()\d:]+?)\s*{TIME_CORE}\s*\(?\s*(출발|종료|도착|종점)\s*\)?", text, flags=re.S)
    if around:
        place, hours, minutes, word = around.groups()
        kind, detail = classify_annotation(f"{place} {word}", column_name)
        time = hhmm(hours, minutes)
        if kind == "start_here":
            return {"kind": "time", "time": time, "role": "start"}
        if kind == "end_here":
            return {"kind": "time", "time": time, "role": "end"}
        if kind == "start_at":
            return {"kind": "start_at", "place": detail["place"], "time": time}
        return {"kind": "labelled", "place": detail["place"], "time": time, "role": "end"}
    # Last resort for one time and one free-text label that itself has brackets:
    # "22:05 터미널(제주은행)" (Route 461), "12:21\n중앙로터리 (동쪽)종료" (Route 680).
    after = re.fullmatch(rf"{TIME_CORE}\s+(.+)", text, flags=re.S)
    before = re.fullmatch(rf"(.+?)\s*{TIME_CORE}", text, flags=re.S)
    loose = (after.group(1), after.group(2), after.group(3)) if after else (before.group(2), before.group(3), before.group(1)) if before else None
    if loose:
        hours, minutes, note = loose
        if not looks_like_time(note):
            kind, detail = classify_annotation(note, column_name)
            time = hhmm(hours, minutes)
            if kind == "start_here":
                return {"kind": "time", "time": time, "role": "start"}
            if kind == "end_here":
                return {"kind": "time", "time": time, "role": "end"}
            if kind in ("via", "conditional"):
                return {"kind": "time", "time": time, "note": detail["note"], **({"conditional": True} if kind == "conditional" else {})}
            if kind == "start_at":
                return {"kind": "start_at", "place": detail["place"], "time": time}
            if kind == "end_at":
                return {"kind": "labelled", "place": detail["place"], "time": time, "role": "end"}
            if kind == "labelled":
                return {"kind": "labelled", "place": detail["label"], "time": time, "role": "at"}
    malformed = re.fullmatch(r"([01]?\d|2[0-3])\s*[;.]\s*([0-5]\d)", text)
    if malformed:
        raise MalformedTime(f"malformed time {raw!r} in the source")
    pairs = re.findall(rf"([^\d:~()]+?)\s*{TIME_CORE}", text)
    if len(pairs) >= 2 and re.fullmatch(rf"(?:\s*[^\d:~()]+?\s*{TIME_CORE}\s*)+", text, flags=re.S):
        return {"kind": "multi", "entries": [{"place": one_line(place), "time": hhmm(hours, minutes), "role": "at"} for place, hours, minutes in pairs]}
    raise TimetableParseError(f"unreadable value {raw!r}", "cell_value")


# ---------------------------------------------------------------- sheets

def row_text(cells: dict, row: int, first: int, last: int) -> str:
    return "".join(squash(cells.get((column, row), "")) for column in range(first, last + 1))


def parse_sheet(name: str, cells: dict[tuple[int, int], str], listed_routes: list[str] | None = None) -> dict:
    """One sheet as a service, or {"suspended": True, ...} for a suspension notice."""

    def at(column: int, row: int) -> str:
        return cells.get((column, row), "")

    def where(column: int, row: int) -> str:
        return f"sheet {name!r} cell {column_letter(column)}{row}"

    title_text = at(2, 2).strip()
    if not title_text:
        raise TimetableParseError(f"{where(2, 2)}: no title", "title_text")
    title = parse_title(title_text, where(2, 2))
    direction = one_line(at(2, 3))
    summary = at(2, 5).strip()

    effective_from = None
    effective_note = None
    effective = [EFFECTIVE.search(text) for (column, row), text in cells.items() if row == 5]
    effective = [match for match in effective if match]
    if len(effective) > 1:
        raise TimetableParseError(f"sheet {name!r}: more than one 시행일 in row 5", "effective_date")
    if effective:
        year, month, day = (int(part) for part in effective[0].groups())
        try:
            effective_from = dt.date(year, month, day).isoformat()
        except ValueError as error:
            raise TimetableParseError(f"sheet {name!r}: 시행일 {year}.{month}.{day} is not a date", "effective_date") from error
    elif any(EFFECTIVE_MISSING.search(text) for (column, row), text in cells.items() if row == 5):
        effective_note = "미입력"

    header_rows = [row for (column, row), text in cells.items() if column == 2 and text.strip() == "구분"]
    if len(header_rows) != 1:
        raise TimetableParseError(f"sheet {name!r}: expected one '구분' header in column B, found {len(header_rows)}", "header")
    header = header_rows[0]
    last_row = max(row for (_, row) in cells)
    last_column_any = max(column for (column, _) in cells)
    trip_rows = [row for row in range(header + 1, last_row + 1) if at(2, row).strip()]

    # The source's own suspension notice: no time anywhere, and a row spelling 운행 중단.
    body = "".join(row_text(cells, row, 3, last_column_any) for row in range(header + 1, last_row + 1))
    if "운행중단" in body and not TIME_ANY.search(re.sub(r"\(\d{4}\.\d{1,2}\.\d{1,2}\)", "", body)):
        return {"suspended": True, "sheet": name, "routes": title["routes"], "notice": "운행 중단"}

    # A header merged across columns (Route 201: "고성" over I7:J7) names every
    # column it covers: two times under one place. Only the header row is filled;
    # a merged trip cell is never copied.
    merged_header: set[int] = set()
    for (c1, r1), (c2, r2) in getattr(cells, "merges", []):
        if r1 <= header <= r2 and c2 > c1 and at(c1, r1).strip():
            for c in range(c1 + 1, c2 + 1):
                if not at(c, header).strip():
                    cells[(c, header)] = at(c1, r1)
                    merged_header.add(c)

    column = 3
    route_column = None
    if squash(at(3, header)) == "노선번호":
        route_column = 3
        column = 4
    timepoints: list[tuple[int, str]] = []
    spacers: list[int] = []
    note_column = None
    while column <= last_column_any:
        label = at(column, header)
        compact = squash(label)
        if compact.startswith("비고"):
            note_column = column
            break
        if not compact:
            spacers.append(column)
        else:
            timepoints.append((column, one_line(label)))
        column += 1
    # Trailing blank headers are not spacers: they are the space after the table.
    while spacers and spacers[-1] > (timepoints[-1][0] if timepoints else 0):
        spacers.pop()
    if len(timepoints) < 2:
        raise TimetableParseError(f"sheet {name!r}: fewer than two timepoints in row {header}", "header")
    last_column = note_column or timepoints[-1][0]
    demand_rows = {r for (c, r), text in cells.items() if r > header and "~" in text and TIME_ANY.search(text)}
    stray = sorted((c, r) for (c, r), text in cells.items() if r > header and c > last_column and text.strip() and r not in demand_rows)
    if stray:
        raise TimetableParseError(f"{where(*stray[0])}: a value right of the table's last column ({column_letter(last_column)})", "layout")

    names = [label for _, label in timepoints]
    trips: list[dict] = []
    for row in range(header + 1, last_row + 1):
        sequence = at(2, row).strip()
        if not sequence:
            if any(at(c, row).strip() for c in range(3, last_column + 1)):
                raise TimetableParseError(f"{where(2, row)}: a row with times but no trip number", "layout")
            continue
        if not re.match(r"^\d+(\.0)?$", sequence) or int(float(sequence)) != len(trips) + 1:
            raise TimetableParseError(f"{where(2, row)}: expected trip {len(trips) + 1}, found {sequence!r}", "layout")
        note = one_line(at(note_column, row)) if note_column else ""
        allowed = list(dict.fromkeys(title["routes"] + (listed_routes or [])))
        trip = parse_trip(name, row, cells, timepoints, spacers, route_column, allowed if route_column else title["routes"], note)
        trips.append(trip)
    if not trips:
        raise TimetableParseError(f"sheet {name!r}: no trips", "layout")

    service: dict = {
        "sheets": [name],
        "routeNumbers": list(dict.fromkeys(title["routes"] + [trip["routeNumber"] for trip in trips if trip["routeNumber"]])),
        "dayType": DAY_LABELS[title["dayLabel"]] if title["dayLabel"] else "unstated",
        **({"dayLabel": title["dayLabel"]} if title["dayLabel"] else {}),
        **({"serviceLabels": title["serviceLabels"]} if title["serviceLabels"] else {}),
        "direction": direction,
        **({"effectiveFrom": effective_from} if effective_from else {}),
        **({"effectiveNote": effective_note} if effective_note else {}),
        "summary": summary,
        "timepoints": names,
        "trips": trips,
    }
    check_service(service, name)
    return service


def parse_trip(name, row, cells, timepoints, spacers, route_column, routes, note) -> dict:
    def where(column: int) -> str:
        return f"sheet {name!r} cell {column_letter(column)}{row}"

    trip: dict = {}
    if route_column and squash(cells.get((route_column, row), "")) in SEASONS:
        # Route 43-1: "동절기" where the route number belongs. The trip runs in
        # winter only, and which of the routes it is the table does not say.
        trip["routeNumber"] = None
        trip["season"] = squash(cells.get((route_column, row), ""))
    elif route_column:
        found = route_numbers_in(squash(cells.get((route_column, row), "")))
        if len(found) != 1 or found[0] not in routes:
            raise TimetableParseError(f"{where(route_column)}: route {cells.get((route_column, row), '')!r} is not one the title names {routes}", "route_column")
        trip["routeNumber"] = found[0]
    elif len(routes) == 1:
        trip["routeNumber"] = routes[0]
    else:
        raise TimetableParseError(f"sheet {name!r}: the title names {routes} but trips carry no route number", "route_column")

    columns = sorted([(column, label, False) for column, label in timepoints] + [(column, "", True) for column in spacers])
    texts = {column: cells.get((column, row), "") for column, _, _ in columns}
    joined = "".join(squash(text) for text in texts.values())

    # A demand-responsive window: one "H:MM ~ H:MM (...)" cell and the rest spelling a phrase.
    windows = [(column, parse_cell(text, None)) for column, text in texts.items() if "~" in text]
    if windows:
        if len(windows) != 1 or windows[0][1].get("kind") != "window":
            raise TimetableParseError(f"{where(windows[0][0])}: unreadable value {texts[windows[0][0]]!r}", "cell_value")
        spelled = "".join(squash(text) for column, text in texts.items() if column != windows[0][0])
        if re.search(r"\d", spelled) or not ("호출" in spelled or "수요응답" in spelled or "호출" in windows[0][1]["label"]):
            raise TimetableParseError(f"{where(windows[0][0])}: a time window outside a demand-responsive row", "demand_responsive")
        window = windows[0][1]
        trip.update(times=[None] * len(timepoints), window={"from": window["from"], "to": window["to"], "label": window["label"] or spelled})
        if note:
            trip["note"] = note
        trip["_order"] = []
        return trip

    times: list[str | None] = []
    marks: dict[str, str] = {}
    cell_notes: dict[str, str] = {}
    off_table: list[dict] = []
    alternates: list[str | None] = []
    has_alternate = False
    days = None
    notes: list[str] = []
    starts_at = None
    ends_at_column = None
    conditional = False
    index = -1
    malformed: list[str] = []
    order: list[tuple[int, str]] = []  # (position, time) in route order, for the sequence check
    for column, label, spacer in columns:
        text = texts[column]
        try:
            cell = parse_cell(text, None if spacer else label)
        except MalformedTime as error:
            malformed.append(f"{column_letter(column)}{row}: {error}")
            cell = {"kind": "none"}
        except TimetableParseError as error:
            raise TimetableParseError(f"{where(column)}: {error}", error.family) from None
        position = column * 2
        if spacer:
            if cell["kind"] in ("none",) and not cell.get("note"):
                continue
            if cell["kind"] == "labelled" or cell["kind"] == "start_at":
                entry = {"place": cell["place"], "time": cell["time"], "role": "start" if cell["kind"] == "start_at" else cell.get("role", "at"), "after": names_before(timepoints, column)}
                off_table.append(entry)
                order.append((position, cell["time"]))
                continue
            raise TimetableParseError(f"{where(column)}: {text!r} under a blank header", "layout")
        index += 1
        alternate = None
        kind = cell["kind"]
        if kind == "none":
            times.append(None)
            if cell.get("note"):
                cell_notes[str(index)] = cell["note"]
        elif kind == "mark":
            times.append(None)
            marks[str(index)] = cell["mark"]
        elif kind == "note":
            times.append(None)
            cell_notes[str(index)] = cell["note"]
        elif kind == "time":
            times.append(cell["time"])
            order.append((position + 1, cell["time"]))
            for extra in cell.get("offTable", []):
                off_table.append({**extra, "role": "at", "before": label})
                order.append((position, extra["time"]))
            if cell.get("note"):
                notes.append(cell["note"])
            if cell.get("conditional"):
                conditional = True
            if cell.get("days"):
                if days is not None and days != cell["days"]:
                    raise TimetableParseError(f"{where(column)}: two different weekday restrictions in one trip", "cell_value")
                days = cell["days"]
            if cell.get("role") == "start" and any(time is not None for time in times[:-1]):
                raise TimetableParseError(f"{where(column)}: a trip starts after an earlier time", "cell_value")
            if cell.get("role") == "end":
                ends_at_column = label
        elif kind == "start_at" and (starts_at is not None or any(time is not None for time in times) or off_table):
            # "7:27(제주평화양로원 출발)" after 절물 07:20 (Route 43-1): a point the bus
            # leaves on the way, off the table. The time is that place's.
            times.append(None)
            off_table.append({"place": cell["place"], "time": cell["time"], "role": "at", "column": label})
            order.append((position, cell["time"]))
        elif kind == "start_at":
            starts_at = {"place": cell["place"], "time": cell["time"], "column": label}
            times.append(None)
            order.append((position, cell["time"]))
        elif kind == "labelled":
            times.append(None)
            off_table.append({"place": cell["place"], "time": cell["time"], "role": cell["role"], "column": label})
            order.append((position + (2 if cell["role"] == "end" else 0), cell["time"]))
        elif kind == "multi":
            times.append(None)
            for entry in cell["entries"]:
                off_table.append({**entry, "column": label})
                order.append((position, entry["time"]))
        elif kind == "alternate":
            times.append(cell["time"])
            if cell["time"]:
                order.append((position + 1, cell["time"]))
            alternate = cell["alternate"]
            has_alternate = True
        elif kind == "window":
            raise TimetableParseError(f"{where(column)}: a time window outside a demand-responsive row", "demand_responsive")
        alternates.append(alternate)

    if not any(time is not None for time in times) and starts_at is None and not off_table:
        raise TimetableParseError(f"sheet {name!r} row {row}: trip has no time", "layout")
    trip["times"] = times
    if starts_at:
        trip["startsAt"] = starts_at
    if off_table:
        trip["offTable"] = off_table
    if ends_at_column:
        trip["endsAt"] = ends_at_column
    if marks:
        trip["marks"] = marks
    if cell_notes:
        trip["cellNotes"] = cell_notes
    if has_alternate:
        if not note:
            raise TimetableParseError(f"sheet {name!r} row {row}: alternate times with no condition in 비고", "alternate_times")
        trip["alternate"] = {"times": alternates, "condition": note}
    if days:
        trip["operatesOn"] = days
    if conditional:
        trip["conditionalEnd"] = True
    trip_notes = list(dict.fromkeys(notes))
    if trip_notes:
        trip["cellAnnotations"] = trip_notes
    if note:
        trip["note"] = note
    trip["_order"] = [time for _, time in sorted(order, key=lambda item: item[0])]
    if malformed:
        trip["_malformed"] = malformed
    if has_alternate:
        trip["_alternateOrder"] = [time for time in alternates if time]
    return trip


def names_before(timepoints: list[tuple[int, str]], column: int) -> str | None:
    before = [label for c, label in timepoints if c < column]
    return before[-1] if before else None


def check_service(service: dict, name: str) -> None:
    """Order within trips, midnight, summary agreement. Contradictions become conflicts."""
    conflicts: list[str] = []
    warnings: list[str] = []
    late_night = any(label in ("심야", "새벽심야") for label in service.get("serviceLabels", [])) or "심야" in name
    crossed = False
    previous_start = None
    for number, trip in enumerate(service["trips"], start=1):
        order = trip.pop("_order")
        conflicts.extend(f"trip {number}: {item}" for item in trip.pop("_malformed", []))
        alternate_order = trip.pop("_alternateOrder", None)
        # Midnight, only in a late-night table (title or sheet says 심야): a time
        # before 05:00 that follows one from 20:00 on is the next day's, written
        # as 24:MM and later. A trip that starts before 05:00 after a trip that
        # started from 20:00 on is wholly the next day's. Nowhere else.
        whole = 0
        if late_night and order and previous_start is not None and minutes_of(order[0]) < 5 * 60 and previous_start >= 20 * 60:
            whole = 24 * 60
        values = next_day(order, whole) if late_night else [minutes_of(time) for time in order]
        backwards = next((index for index in range(1, len(values)) if values[index] < values[index - 1]), None)
        if backwards is not None:
            conflicts.append(f"trip {number}: times run backwards ({order[backwards - 1]} then {order[backwards]})")
        if late_night:
            times = [time for time in trip["times"]]
            shifted = iter(next_day([time for time in times if time], whole))
            trip["times"] = [from_minutes(next(shifted)) if time else None for time in times]
            if trip.get("startsAt"):
                trip["startsAt"]["time"] = from_minutes(minutes_of(trip["startsAt"]["time"]) + whole)
            if any(value >= 24 * 60 for value in values):
                crossed = True
        if alternate_order:
            alt = [minutes_of(time) for time in alternate_order]
            if any(left > right for left, right in zip(alt, alt[1:])):
                conflicts.append(f"trip {number}: alternate times run backwards")
        start = values[0] if values else None
        trip["firstTime"] = from_minutes(start) if start is not None else None
        if start is not None:
            previous_start = start
    if crossed:
        service["crossesMidnight"] = True

    # Conditions: notes that limit when a trip runs. A note every trip carries
    # describes the service ("평일 운행" on Route 1100's weekday sheet) and moves
    # to the service.
    notes = [trip.get("note", "") for trip in service["trips"]]
    if notes and notes[0] and all(note == notes[0] for note in notes):
        service["note"] = notes[0]
        for trip in service["trips"]:
            trip.pop("note", None)
    for trip in service["trips"]:
        conditions = []
        if trip.get("note") and RESTRICTING.search(trip["note"]):
            conditions.append(trip["note"])
        conditions.extend(note for note in trip.get("cellNotes", {}).values() if RESTRICTING.search(note))
        if trip.get("season"):
            conditions.append(trip["season"])
        if trip.get("operatesOn"):
            conditions.append("operates_on:" + ",".join(trip["operatesOn"]))
        if trip.get("alternate"):
            conditions.append(trip["alternate"]["condition"])
        if trip.get("window"):
            conditions.append("demand_responsive")
        if conditions:
            trip["conditions"] = list(dict.fromkeys(conditions))

    # Rows out of time order are reported, not fatal: first and last are taken over all trips.
    for index, timepoint in enumerate(service["timepoints"]):
        column_times = [minutes_of(trip["times"][index]) for trip in service["trips"] if trip["times"][index]]
        if any(left > right for left, right in zip(column_times, column_times[1:])):
            warnings.append(f"rows are not in time order at {timepoint!r}")

    # The summary must agree with the trips, per route when it names several.
    summary = service["summary"]
    segments = split_summary(summary, service["routeNumbers"])
    for route, text in segments.items():
        # The summary's 첫차 and 막차 are the table's first and last rows for that
        # route (Route 365: row 1 starts at 월성마을 06:03 and a later row at
        # 한라대 06:00; the summary says "첫차(월성마을 출발) 6:03"). Rows are
        # ordered by the core section, not by start.
        starts = [minutes_of(trip["firstTime"]) for trip in service["trips"] if trip.get("routeNumber") == route and trip.get("firstTime")]
        if not starts:
            continue
        if re.search(r"동절기|하절기|월\s*막차|월\s*첫차", text):
            warnings.append(f"summary for {route} is seasonal; not checked")
            continue
        route_trips = [trip for trip in service["trips"] if trip.get("routeNumber") == route and trip.get("firstTime")]
        first = re.search(r"첫차\s*(?:\(\s*([^()]*?)\s*\))?[^0-9(]*?(\d{1,2}:\d{2})", text)
        last = re.search(r"막차\s*(?:\(\s*([^()]*?)\s*\))?[^0-9(]*?(\d{1,2}:\d{2})", text)
        for found, word in ((first, "첫차"), (last, "막차")):
            if not found:
                continue
            qualifier, published_text = found.groups()
            published = minutes_of(hhmm(*published_text.split(":")))
            place = re.sub(r"\s*(출발|기준)$", "", qualifier or "").strip()
            # The published time is the table's first (last) row, as on Route 365.
            # A qualified summary may instead name its own departure point:
            # "첫차(제주 출발) 5:35" on Route 202, whose first rows are short trips
            # from 고산; then it is the earliest (latest) trip starting there.
            # Either reading must give the published time exactly.
            expected = starts[0] if word == "첫차" else starts[-1]
            if place and published % 1440 != expected % 1440:
                matching = [minutes_of(trip["firstTime"]) for trip in route_trips if starts_from(trip, service["timepoints"], place)]
                if matching:
                    expected = min(matching) if word == "첫차" else max(matching)
            if published % 1440 != expected % 1440:
                message = f"summary {word} {hhmm(*published_text.split(':'))} disagrees with the trips ({from_minutes(expected % 1440)})"
                if (route, name, message) in KNOWN_SUMMARY_CONFLICTS:
                    service.setdefault("acceptedConflicts", []).append(message)
                else:
                    conflicts.append(message if len(segments) == 1 else f"[{route}] {message}")
    if conflicts:
        service["status"] = "source_conflict"
        service["conflicts"] = conflicts
    else:
        service["status"] = "ok"
    if warnings:
        service["warnings"] = warnings


def starts_from(trip: dict, timepoints: list[str], place: str) -> bool:
    """Whether a trip begins at `place` (by name containment either way, spaces ignored)."""
    if trip.get("startsAt"):
        origin = trip["startsAt"]["place"]
    else:
        index = next((i for i, time in enumerate(trip["times"]) if time), None)
        origin = timepoints[index] if index is not None else ""
    key, origin = squash(place), squash(origin)
    return bool(key) and bool(origin) and (key in origin or origin in key)


def next_day(times: list[str], whole: int) -> list[int]:
    """Minutes since the service day's midnight, for times in route order."""
    out: list[int] = []
    seen_late = whole > 0
    for time in times:
        value = minutes_of(time) + whole
        if value >= 20 * 60:
            seen_late = True
        elif seen_late and value < 5 * 60:
            value += 24 * 60
        out.append(value)
    return out


def split_summary(summary: str, routes: list[str]) -> dict[str, str]:
    """The summary line per route: "[231번] 첫차 ..." segments, or the whole line for one route."""
    marked = list(re.finditer(r"\[\s*(\d{1,4}(?:-\d{1,2})?)\s*번?\s*\]", summary))
    if not marked:
        return {routes[0]: summary} if len(routes) == 1 else {}
    segments = {}
    for index, match in enumerate(marked):
        end = marked[index + 1].start() if index + 1 < len(marked) else len(summary)
        segments[match.group(1)] = summary[match.end():end]
    return segments


# ---------------------------------------------------------------- files

def parse_file(path: Path, retrieved_on: str, file_name: str | None = None, listed_name: str | None = None,
               schedule_id: str | None = None) -> dict:
    """The whole workbook as one dataset. `listed_name` is the name the site lists the
    timetable under (GSCHEDULE_NM); when given, the routes the titles name must match it."""
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", retrieved_on):
        raise TimetableParseError("--retrieved-on must be YYYY-MM-DD", "usage")
    sheets = read_workbook(path)
    if not sheets:
        raise TimetableParseError("the workbook has no sheet", "workbook")
    services = []
    suspended = []
    listed_routes = route_numbers_in(listed_name) if listed_name else None
    for name, cells in sheets:
        parsed = parse_sheet(name, cells, listed_routes)
        (suspended if parsed.get("suspended") else services).append(parsed)
    routes = list(dict.fromkeys(route for item in services + suspended for route in item["routes" if item.get("suspended") else "routeNumbers"]))
    if listed_name is not None:
        listed = set(ROUTE_TOKEN.findall(listed_name))
        if listed and listed != set(routes):
            raise TimetableParseError(f"the titles name routes {sorted(routes)} but the site lists {listed_name!r}", "route_mapping")
    if not services:
        raise SuspendedNotice(f"every sheet is a suspension notice ({', '.join(item['sheet'] for item in suspended)})")
    if suspended:
        raise TimetableParseError(f"some sheets are suspension notices and some are timetables: {[item['sheet'] for item in suspended]}", "suspended_mixed")

    merged: list[dict] = []
    for service in services:
        key = (service["direction"], service["dayType"])
        twin = next((other for other in merged if (other["direction"], other["dayType"]) == key), None)
        if twin is None:
            merged.append(service)
            continue
        same = all(service.get(field) == twin.get(field) for field in ("timepoints", "trips", "routeNumbers", "status")) and squash(service["summary"]) == squash(twin["summary"])
        if same:
            # The multi-route workbooks repeat one table on a sheet per route.
            twin["sheets"].extend(service["sheets"])
            dates = sorted({date for date in (twin.get("effectiveFrom"), service.get("effectiveFrom")) if date} | set(twin.get("effectiveDates", [])))
            if len(dates) > 1:
                # Identical tables dated differently: both dates are published. The
                # later one is used, so the table is never applied before either date.
                twin["effectiveDates"] = dates
                twin["effectiveFrom"] = dates[-1]
            continue
        for item in (twin, service):
            item["status"] = "source_conflict"
            item.setdefault("conflicts", []).append(f"another sheet for {key[0]!r} ({key[1]}) has a different table")
        merged.append(service)

    status = "source_conflict" if any(service["status"] == "source_conflict" for service in merged) else "parsed"
    labels = list(dict.fromkeys(label for service in merged for label in service.get("serviceLabels", [])))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "label": "OFFICIAL_DATED",
        "source": {
            "publisher": "제주특별자치도 (bus.jeju.go.kr)",
            "dataset": "data.go.kr 3043887",
            "page": SOURCE_PAGE,
            "file": file_name or path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            **({"scheduleId": schedule_id} if schedule_id else {}),
            **({"listedName": listed_name} if listed_name else {}),
        },
        "retrievedOn": retrieved_on,
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "routeNumbers": routes,
        **({"serviceLabels": labels} if labels else {}),
        "status": status,
        "services": merged,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("xlsx", type=Path)
    parser.add_argument("--retrieved-on", required=True, help="Korean date the file was downloaded, YYYY-MM-DD")
    parser.add_argument("--file-name", help="the file name as downloaded, if the path differs")
    parser.add_argument("--name", help="the name the site lists the timetable under")
    args = parser.parse_args()
    try:
        dataset = parse_file(args.xlsx, args.retrieved_on, args.file_name, args.name)
    except (TimetableParseError, SuspendedNotice) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    json.dump(dataset, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
