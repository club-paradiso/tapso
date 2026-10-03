"""Tests for the official Jeju timetable parser.

The real Route 365 and 442 files (downloaded 2026-10-03) are parsed as committed.
Every other workbook here is SYNTHETIC, built in the test with the same
layout, to show each way the parser refuses a file it cannot vouch for.
"""

from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import jeju_xlsx

ROOT = Path(__file__).resolve().parents[2]
RAW_365 = ROOT / "fixtures/jeju/timetables/raw/365.xlsx"
DATASET_365 = ROOT / "fixtures/jeju/timetables/365.json"
RAW_442 = ROOT / "fixtures/jeju/timetables/raw/442.xlsx"
DATASET_442 = ROOT / "fixtures/jeju/timetables/442.json"


def workbook(path: Path, sheets: dict[str, dict[str, str]]) -> Path:
    """A minimal XLSX: inline strings only, one entry per sheet {cell: text}."""
    with zipfile.ZipFile(path, "w") as archive:
        names = list(sheets)
        archive.writestr(
            "xl/workbook.xml",
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
            + "".join(f'<sheet name="{escape(name)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, name in enumerate(names))
            + "</sheets></workbook>",
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(f'<Relationship Id="rId{i + 1}" Target="worksheets/sheet{i + 1}.xml"/>' for i in range(len(names)))
            + "</Relationships>",
        )
        for i, name in enumerate(names):
            cells = "".join(
                f'<c r="{ref}" t="inlineStr"><is><t>{escape(text)}</t></is></c>' for ref, text in sheets[name].items()
            )
            archive.writestr(
                f"xl/worksheets/sheet{i + 1}.xml",
                f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row>{cells}</row></sheetData></worksheet>',
            )
    return path


def synthetic_sheet(title: str = "999번(평일)", summary: str = "첫차 6:00, 막차 7:00, SYNTHETIC", rows: list[list[str]] | None = None) -> dict[str, str]:
    rows = rows if rows is not None else [["06:00", "06:10", ""], ["07:00", "07:10", ""]]
    cells = {"B2": title, "B3": "합성A→합성B", "B5": summary, "H5": "(시행일 : 2026. 6. 24.)", "B7": "구분", "C7": "합성A", "D7": "합성B", "E7": "비  고"}
    for index, row in enumerate(rows):
        number = 8 + index
        cells[f"B{number}"] = str(index + 1)
        for column, text in zip("CDE", row):
            if text:
                cells[f"{column}{number}"] = text
    return cells


class Route365(unittest.TestCase):
    def test_the_real_file_parses_to_the_committed_dataset(self) -> None:
        dataset = jeju_xlsx.parse_file(RAW_365, "2026-10-03")
        self.assertEqual(dataset, json.loads(DATASET_365.read_text(encoding="utf-8")))

    def test_what_the_file_says(self) -> None:
        dataset = jeju_xlsx.parse_file(RAW_365, "2026-10-03")
        self.assertEqual(dataset["routeNumber"], "365")
        self.assertEqual(dataset["label"], "OFFICIAL_DATED")
        self.assertEqual(dataset["source"]["sha256"], "8eafd16b3393be8c15ff26098edadde73fd10cd66d4584e9a6aa95b08b6d07a4")
        summary = [(s["dayType"], s["direction"], s.get("effectiveFrom"), len(s["trips"])) for s in dataset["services"]]
        self.assertEqual(
            summary,
            [
                ("weekday", "한라대→공항→시청→제주대", "2026-06-24", 66),
                ("weekday", "제주대→시청→공항→한라대", "2026-06-24", 64),
                ("saturday_sunday_holiday", "한라대→공항→시청→제주대", "2024-08-01", 53),
                ("saturday_sunday_holiday", "제주대→시청→공항→한라대", "2024-08-01", 52),
            ],
        )
        first = dataset["services"][0]["trips"][0]
        self.assertEqual(first["startsAt"], {"place": "월성마을", "time": "06:03", "column": "공항"})
        self.assertEqual(first["times"], [None, None, None, "06:14", "06:22", "06:41", None])
        self.assertEqual(dataset["services"][0]["trips"][-1]["times"], ["21:55", "22:11", "22:23", "22:37", "22:44", "23:02", None])


class Route442(unittest.TestCase):
    def test_the_real_file_parses_to_the_committed_dataset(self) -> None:
        dataset = jeju_xlsx.parse_file(RAW_442, "2026-10-03")
        self.assertEqual(dataset, json.loads(DATASET_442.read_text(encoding="utf-8")))

    def test_a_circular_route_with_no_day_type_and_a_known_summary_conflict(self) -> None:
        service = jeju_xlsx.parse_file(RAW_442, "2026-10-03")["services"][0]
        self.assertEqual(service["dayType"], "unstated")
        self.assertNotIn("dayLabel", service)
        self.assertEqual(service["timepoints"][0], service["timepoints"][-1])
        self.assertEqual(service["timepoints"][2], "제주여자 중고등학교")
        # "5:55\n(출발)": the trip starts at that timepoint; blank cells are not served.
        self.assertEqual(service["trips"][0], {"times": [None, None, "05:55", "06:00", "06:13", "06:24", "06:32", "06:38", "06:46", "06:58", None]})
        self.assertEqual(service["trips"][-1]["times"][-3:], [None, None, None])
        self.assertEqual(service["summaryConflicts"], ["summary 첫차 05:50 disagrees with the trips (05:55)"])


class Refusals(unittest.TestCase):
    def parse(self, *sheets: dict[str, str]) -> dict:
        with tempfile.TemporaryDirectory() as directory:
            path = workbook(Path(directory) / "synthetic.xlsx", {f"합성{i}": sheet for i, sheet in enumerate(sheets)})
            return jeju_xlsx.parse_file(path, "2026-10-03")

    def test_a_well_formed_synthetic_file_parses(self) -> None:
        dataset = self.parse(synthetic_sheet())
        self.assertEqual(dataset["services"][0]["trips"], [{"times": ["06:00", "06:10"]}, {"times": ["07:00", "07:10"]}])
        self.assertEqual(dataset["services"][0]["effectiveFrom"], "2026-06-24")

    def assertRefused(self, fragment: str, *sheets: dict[str, str]) -> None:
        with self.assertRaises(jeju_xlsx.TimetableParseError) as caught:
            self.parse(*sheets)
        self.assertIn(fragment, str(caught.exception))

    def test_an_unknown_day_label(self) -> None:
        self.assertRefused("not one TAPSO has read before", synthetic_sheet(title="999번(일요일)"))

    def test_a_time_past_midnight(self) -> None:
        self.assertRefused("unreadable value", synthetic_sheet(rows=[["23:50", "24:05", ""]], summary=""))

    def test_times_out_of_order_within_a_trip(self) -> None:
        self.assertRefused("not strictly ascending", synthetic_sheet(rows=[["06:10", "06:00", ""]], summary=""))

    def test_trips_out_of_order_at_a_timepoint(self) -> None:
        self.assertRefused("out of order at '합성A'", synthetic_sheet(rows=[["07:00", "07:10", ""], ["06:00", "06:10", ""]], summary=""))

    def test_a_summary_that_disagrees_with_the_trips(self) -> None:
        self.assertRefused("막차 7:30 disagrees", synthetic_sheet(summary="첫차 6:00, 막차 7:30"))

    def test_an_unreadable_cell(self) -> None:
        self.assertRefused("cell D8", synthetic_sheet(rows=[["06:00", "운휴", ""]], summary=""))

    def test_a_start_off_the_table_after_a_time(self) -> None:
        self.assertRefused("must come before every time", synthetic_sheet(rows=[["06:00", "06:10\n(합성C 출발)", ""]], summary=""))

    def test_a_start_here_is_a_time_at_that_timepoint_not_a_place(self) -> None:
        dataset = self.parse(synthetic_sheet(rows=[["5:55\n(출발)", "06:10", ""]], summary=""))
        self.assertEqual(dataset["services"][0]["trips"], [{"times": ["05:55", "06:10"]}])

    def test_a_title_without_a_day_type(self) -> None:
        self.assertEqual(self.parse(synthetic_sheet(title="999번"))["services"][0]["dayType"], "unstated")

    def test_a_known_conflict_is_accepted_only_for_its_route_sheet_and_times(self) -> None:
        sheet = synthetic_sheet(title="442번", summary="첫차(제주여고 출발) 05:50", rows=[["05:55", "06:00", ""]])
        with tempfile.TemporaryDirectory() as directory:
            path = workbook(Path(directory) / "synthetic.xlsx", {"442 순환(별빛누리-연북로-용담-시청-별빛누리)": sheet})
            self.assertEqual(jeju_xlsx.parse_file(path, "2026-10-03")["services"][0]["summaryConflicts"], ["summary 첫차 05:50 disagrees with the trips (05:55)"])
            other = workbook(Path(directory) / "other.xlsx", {"442 다른 시트": sheet})
            with self.assertRaises(jeju_xlsx.TimetableParseError):
                jeju_xlsx.parse_file(other, "2026-10-03")
        moved = synthetic_sheet(title="442번", summary="첫차 05:50", rows=[["05:56", "06:00", ""]])
        self.assertRefused("05:50 disagrees with the trips (05:56)", moved)

    def test_a_column_past_a_blank_header_is_refused_not_dropped(self) -> None:
        sheet = synthetic_sheet(summary="")
        del sheet["E7"]  # no 비고: the header ends at a blank
        sheet["F7"] = "합성C"
        sheet["F8"] = "06:20"
        self.assertRefused("right of the table's last column (D)", sheet)

    def test_a_value_past_the_note_column_is_refused(self) -> None:
        sheet = synthetic_sheet(summary="")
        sheet["F9"] = "07:30"
        self.assertRefused("cell F9", sheet)

    def test_a_missing_trip_number(self) -> None:
        sheet = synthetic_sheet()
        sheet["B9"] = "3"
        self.assertRefused("expected trip 2", sheet)

    def test_two_routes_in_one_file(self) -> None:
        self.assertRefused("more than one route", synthetic_sheet(), synthetic_sheet(title="998번(토,공휴일)"))

    def test_the_same_direction_and_day_twice(self) -> None:
        self.assertRefused("same direction and day type", synthetic_sheet(), synthetic_sheet())


if __name__ == "__main__":
    unittest.main()
