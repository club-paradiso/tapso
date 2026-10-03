"""Tests for the official Jeju timetable parser.

The real Route 365 and 442 files (downloaded 2026-10-03) are parsed as committed,
and the whole census (`fixtures/jeju/timetables/bis/`) is re-parsed and must
match its committed outcomes. Every other workbook here is SYNTHETIC, built in
the test with the layout of a real format family, to show what each family
yields and each way the parser refuses or withholds a file.
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


def workbook(path: Path, sheets: dict[str, dict[str, str]], merges: dict[str, list[str]] | None = None) -> Path:
    """A minimal XLSX: inline strings only, one entry per sheet {cell: text}, optional merged ranges."""
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
            merged = "".join(f'<mergeCell ref="{ref}"/>' for ref in (merges or {}).get(name, []))
            cells = "".join(
                f'<c r="{ref}" t="inlineStr"><is><t>{escape(text)}</t></is></c>' for ref, text in sheets[name].items()
            )
            archive.writestr(
                f"xl/worksheets/sheet{i + 1}.xml",
                f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row>{cells}</row></sheetData>'
                + (f"<mergeCells>{merged}</mergeCells>" if merged else "")
                + "</worksheet>",
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


CENSUS = ROOT / "fixtures/jeju/timetables/bis"


def parse_sheets(*sheets: dict[str, str], names: list[str] | None = None, listed: str | None = None, merges: dict[str, list[str]] | None = None) -> dict:
    with tempfile.TemporaryDirectory() as directory:
        titles = names or [f"합성{i}" for i in range(len(sheets))]
        path = workbook(Path(directory) / "synthetic.xlsx", dict(zip(titles, sheets)), merges)
        return jeju_xlsx.parse_file(path, "2026-10-03", listed_name=listed)


class Route365(unittest.TestCase):
    def test_the_real_file_parses_to_the_committed_dataset(self) -> None:
        dataset = jeju_xlsx.parse_file(RAW_365, "2026-10-03", listed_name="365")
        self.assertEqual(dataset, json.loads(DATASET_365.read_text(encoding="utf-8")))

    def test_what_the_file_says(self) -> None:
        dataset = jeju_xlsx.parse_file(RAW_365, "2026-10-03", listed_name="365")
        self.assertEqual(dataset["routeNumbers"], ["365"])
        self.assertEqual(dataset["status"], "parsed")
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
        self.assertEqual(first["firstTime"], "06:03")
        self.assertEqual(dataset["services"][0]["trips"][-1]["times"], ["21:55", "22:11", "22:23", "22:37", "22:44", "23:02", None])

    def test_the_census_download_parses_to_the_same_trips(self) -> None:
        mine = json.loads(DATASET_365.read_text(encoding="utf-8"))
        manifest = json.loads((CENSUS / "manifest.json").read_text(encoding="utf-8"))
        if manifest["retrievedOn"] != mine["retrievedOn"]:
            self.skipTest("the census is a later download; a changed official table is for review, not a test failure")
        record = next(r for r in manifest["timetables"] if r["name"] == "365")
        census = json.loads((CENSUS / f"{record['id']}.json").read_text(encoding="utf-8"))
        self.assertEqual([s["trips"] for s in mine["services"]], [s["trips"] for s in census["services"]])


class Route442(unittest.TestCase):
    def test_the_real_file_parses_to_the_committed_dataset(self) -> None:
        dataset = jeju_xlsx.parse_file(RAW_442, "2026-10-03", listed_name="442")
        self.assertEqual(dataset, json.loads(DATASET_442.read_text(encoding="utf-8")))

    def test_a_circular_route_with_no_day_type_and_a_known_summary_conflict(self) -> None:
        service = jeju_xlsx.parse_file(RAW_442, "2026-10-03")["services"][0]
        self.assertEqual(service["dayType"], "unstated")
        self.assertNotIn("dayLabel", service)
        self.assertEqual(service["timepoints"][0], service["timepoints"][-1])
        self.assertEqual(service["timepoints"][2], "제주여자 중고등학교")
        self.assertEqual(service["trips"][0]["times"], [None, None, "05:55", "06:00", "06:13", "06:24", "06:32", "06:38", "06:46", "06:58", None])
        self.assertEqual(service["trips"][-1]["times"][-3:], [None, None, None])
        self.assertEqual(service["status"], "ok")
        self.assertEqual(service["acceptedConflicts"], ["summary 첫차 05:50 disagrees with the trips (05:55)"])


class Census(unittest.TestCase):
    """The committed census must be exactly what the current parser makes of the committed files."""

    def test_every_entry_has_a_deterministic_outcome_matching_the_parser(self) -> None:
        manifest = json.loads((CENSUS / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["parser"], {"name": jeju_xlsx.PARSER_NAME, "version": jeju_xlsx.PARSER_VERSION})
        for record in manifest["timetables"]:
            with self.subTest(record["name"]):
                self.assertIn(record["outcome"], {"parsed", "source_conflict", "no_timetable", "parse_refused", "download_failed"})
                if "file" not in record:
                    self.assertEqual(record["outcome"], "no_timetable")
                    continue
                try:
                    dataset = jeju_xlsx.parse_file(CENSUS / record["file"], manifest["retrievedOn"], file_name=Path(record["file"]).name, listed_name=record["name"], schedule_id=record["id"])
                except jeju_xlsx.SuspendedNotice:
                    self.assertEqual(record["outcome"], "no_timetable")
                    continue
                except jeju_xlsx.TimetableParseError as error:
                    self.assertEqual((record["outcome"], record.get("reason")), ("parse_refused", str(error)))
                    continue
                self.assertEqual(record["outcome"], dataset["status"])
                self.assertEqual(dataset, json.loads((CENSUS / f"{record['id']}.json").read_text(encoding="utf-8")))


def sheet(title: str, header: list[str], rows: list[list[str]], summary: str = "", direction: str = "합성A→합성B", effective: str = "(시행일 : 2026. 6. 24.)") -> dict[str, str]:
    """A sheet in the real layout: header in row 7 from column C, trips from row 8."""
    cells = {"B2": title, "B3": direction, "B5": summary, "N5": effective, "B7": "구분"}
    columns = [jeju_xlsx.column_letter(3 + index) for index in range(max(len(header), max((len(row) for row in rows), default=0)))]
    for column, text in zip(columns, header):
        if text:
            cells[f"{column}7"] = text
    for index, row in enumerate(rows):
        cells[f"B{8 + index}"] = f"{index + 1}.0"
        for column, text in zip(columns, row):
            if text:
                cells[f"{column}{8 + index}"] = text
    return cells


class FormatFamilies(unittest.TestCase):
    """One SYNTHETIC sheet per layout read in the real census; the real example is named in each test."""

    def test_multi_route_workbook_with_a_route_column_and_per_route_summary(self) -> None:
        # Routes 231/232: "231번, 232번", a 노선번호 column, "[231번] 첫차 …" per route, "×" for not served.
        dataset = parse_sheets(sheet("231번, 232번", ["노선번호", "합성A", "합성B", "비고"],
                                     [["231번", "06:00", "06:10"], ["232번", "06:30", "×"], ["231번", "07:00", "07:10"]],
                                     summary="[231번] 첫차 6:00, 막차 7:00\n[232번] 첫차 6:30, 막차 6:30"), listed="231, 232")
        service = dataset["services"][0]
        self.assertEqual(dataset["routeNumbers"], ["231", "232"])
        self.assertEqual([trip["routeNumber"] for trip in service["trips"]], ["231", "232", "231"])
        self.assertEqual(service["trips"][1]["times"], ["06:30", None])
        self.assertEqual(service["status"], "ok")

    def test_title_shorthand_expands_and_must_match_the_listed_name(self) -> None:
        # Route 704-1/704-3: "704-1,3번\n(옵서버스)".
        rows = [["704-1", "06:00", "06:10"], ["704-3", "07:00", "07:10"]]
        dataset = parse_sheets(sheet("704-1,3번\n(옵서버스)", ["노선번호", "합성A", "합성B"], rows), listed="704-1, 704-3")
        self.assertEqual(dataset["routeNumbers"], ["704-1", "704-3"])
        self.assertEqual(dataset["services"][0]["serviceLabels"], ["옵서버스"])
        self.assertEqual(dataset["services"][0]["dayType"], "unstated")
        with self.assertRaises(jeju_xlsx.TimetableParseError) as caught:
            parse_sheets(sheet("704-1,3번", ["노선번호", "합성A", "합성B"], rows), listed="704-1, 704-2")
        self.assertEqual(caught.exception.family, "route_mapping")

    def test_day_labels_read_from_titles(self) -> None:
        for title, day in [("1번(평일)", "weekday"), ("1번 (평,옵서버스)", "weekday"), ("1번(토.공휴일)", "saturday_sunday_holiday"),
                           ("1번(한라눈꽃버스)\n(주말/공휴일)", "saturday_sunday_holiday"), ("1번 (토요일,옵서버스)", "saturday"),
                           ("1번 (일,공휴일,옵서버스)", "sunday_holiday"), ("1번(휴일) (옵서버스)", "holiday_saturday_unstated"), ("임시 1번", "unstated")]:
            with self.subTest(title):
                self.assertEqual(parse_sheets(sheet(title, ["합성A", "합성B"], [["06:00", "06:10"]]))["services"][0]["dayType"], day)

    def test_an_unknown_title_label_is_refused(self) -> None:
        with self.assertRaises(jeju_xlsx.TimetableParseError) as caught:
            parse_sheets(sheet("1번(일요일)", ["합성A", "합성B"], [["06:00", "06:10"]]))
        self.assertEqual(caught.exception.family, "title_label")

    def test_marks_mean_served_without_a_published_time(self) -> None:
        # Routes 251, 211, 282: "●", "O", "○" in (경유) and express-section columns.
        trip = parse_sheets(sheet("1번", ["합성A", "합성B(경유)", "합성C", "합성D"], [["06:00", "●", "O", "06:30"]]))["services"][0]["trips"][0]
        self.assertEqual(trip["times"], ["06:00", None, None, "06:30"])
        self.assertEqual(trip["marks"], {"1": "●", "2": "O"})

    def test_a_merged_header_names_both_columns(self) -> None:
        # Route 201: "고성" merged over two columns, a time in each.
        cells = sheet("201번", ["합성A", "고성", "", "합성C"], [["06:00", "06:10", "06:15", "06:30"]])
        dataset = parse_sheets(cells, merges={"합성0": ["D7:E7"]})
        self.assertEqual(dataset["services"][0]["timepoints"], ["합성A", "고성", "고성", "합성C"])
        self.assertEqual(dataset["services"][0]["trips"][0]["times"], ["06:00", "06:10", "06:15", "06:30"])

    def test_a_time_under_an_unmerged_blank_header_is_refused(self) -> None:
        with self.assertRaises(jeju_xlsx.TimetableParseError) as caught:
            parse_sheets(sheet("1번", ["합성A", "", "합성C"], [["06:00", "06:10", "06:30"]]))
        self.assertIn("under a blank header", str(caught.exception))

    def test_annotations_place_a_time_or_take_it_off_the_column(self) -> None:
        rows = [["5:30(출발)", "06:00\n(합성X 경유)", "06:10\n(승객 없을시 합성Y 종료)"],
                ["05:40\n(합성P 출발)", "06:10", "06:20(종료)"],
                ["06:30", "06:40\n(합성Q 앞)", "06:50(월,화,목,금)"]]
        trips = parse_sheets(sheet("1번", ["합성A", "합성B", "합성C"], rows))["services"][0]["trips"]
        self.assertEqual(trips[0]["times"], ["05:30", "06:00", "06:10"])
        self.assertEqual(trips[0]["cellAnnotations"], ["합성X 경유", "승객 없을시 합성Y 종료"])
        self.assertTrue(trips[0]["conditionalEnd"])
        # "(<place> 출발)": the time is that place's, not the column's.
        self.assertEqual(trips[1]["startsAt"], {"place": "합성P", "time": "05:40", "column": "합성A"})
        self.assertEqual(trips[1]["times"], [None, "06:10", "06:20"])
        self.assertEqual(trips[1]["endsAt"], "합성C")
        # A label that is not a role keeps its time off the column.
        self.assertEqual(trips[2]["times"], ["06:30", None, "06:50"])
        self.assertEqual(trips[2]["offTable"], [{"place": "합성Q 앞", "time": "06:40", "role": "at", "column": "합성B"}])
        self.assertEqual(trips[2]["operatesOn"], ["mon", "tue", "thu", "fri"])
        self.assertIn("operates_on:mon,tue,thu,fri", trips[2]["conditions"])

    def test_alternate_times_need_their_condition(self) -> None:
        # Route 455: "9:48\n(9:58)" and "\n(9:47)", "(2일, 7일 오일장 경유)" in 비고.
        trip = parse_sheets(sheet("1번", ["합성A", "합성B", "합성C", "비고"], [["09:42", "\n(9:47)", "9:48\n(9:58)", "(2일, 7일 오일장 경유)"]]))["services"][0]["trips"][0]
        self.assertEqual(trip["times"], ["09:42", None, "09:48"])
        self.assertEqual(trip["alternate"], {"times": [None, "09:47", "09:58"], "condition": "(2일, 7일 오일장 경유)"})
        with self.assertRaises(jeju_xlsx.TimetableParseError) as caught:
            parse_sheets(sheet("1번", ["합성A", "합성B"], [["09:42", "9:48\n(9:58)"]]))
        self.assertEqual(caught.exception.family, "alternate_times")

    def test_a_demand_responsive_window_is_not_a_timetable(self) -> None:
        # Route 721-2: "14:00 ~ 20:30 (실시간 호출형)" and the letters 수요응답호출운행 across the row.
        trip = parse_sheets(sheet("1번", ["합성A", "합성B", "합성C", "합성D"], [["14:00 ~ 20:30 (실시간 호출형)", "수", "요", "응답"]]))["services"][0]["trips"][0]
        self.assertEqual(trip["window"], {"from": "14:00", "to": "20:30", "label": "실시간 호출형"})
        self.assertEqual(trip["times"], [None, None, None, None])
        self.assertIsNone(trip["firstTime"])
        self.assertEqual(trip["conditions"], ["demand_responsive"])

    def test_a_suspension_notice_is_no_timetable(self) -> None:
        # Route 1112: "운", "행", "중", "단" spelled across a row, no time anywhere.
        with self.assertRaises(jeju_xlsx.SuspendedNotice):
            parse_sheets(sheet("1번", ["합성A", "합성B", "합성C", "합성D"], [["운", "행", "중", "단"]]))

    def test_a_late_night_table_crosses_midnight(self) -> None:
        # Route 3001: "(…)심야", 23:59 then 00:05.
        rows = [["23:40", "23:55", "00:05"], ["00:20", "00:30", "00:40"]]
        service = parse_sheets(sheet("3001번", ["합성A", "합성B", "합성C"], rows), names=["3001 (합성)심야"])["services"][0]
        self.assertEqual(service["trips"][0]["times"], ["23:40", "23:55", "24:05"])
        self.assertEqual(service["trips"][1]["times"], ["24:20", "24:30", "24:40"])
        self.assertTrue(service["crossesMidnight"])
        self.assertEqual(service["status"], "ok")

    def test_midnight_is_never_assumed_outside_a_late_night_table(self) -> None:
        service = parse_sheets(sheet("1번", ["합성A", "합성B"], [["23:50", "00:05"]]))["services"][0]
        self.assertEqual(service["status"], "source_conflict")
        self.assertIn("times run backwards", service["conflicts"][0])

    def test_equal_minutes_at_adjacent_timepoints_are_allowed(self) -> None:
        # Route 702-1: 신안상동 09:35, 신안하동 09:35.
        self.assertEqual(parse_sheets(sheet("1번", ["합성A", "합성B"], [["09:35", "09:35"]]))["services"][0]["status"], "ok")

    def test_a_malformed_time_withholds_the_service_without_correcting_it(self) -> None:
        # Route 415: "08;46".
        service = parse_sheets(sheet("1번", ["합성A", "합성B"], [["08:40", "08;46"]]))["services"][0]
        self.assertEqual(service["status"], "source_conflict")
        self.assertEqual(service["trips"][0]["times"], ["08:40", None])
        self.assertIn("malformed time '08;46'", service["conflicts"][0])

    def test_summary_rows_and_qualified_departures(self) -> None:
        rows = [["X", "05:50(출발)", "06:00"], ["05:35", "06:00", "06:10"], ["21:30", "21:40", "21:50"]]
        # Route 202: "첫차(제주 출발) 5:35" while the first row is a short trip from mid-route.
        self.assertEqual(parse_sheets(sheet("1번", ["제주터미널", "합성B", "합성C"], rows, summary="첫차(제주 출발) 5:35, 막차 21:30"))["status"], "parsed")
        # Unqualified, the first row is the 첫차: 5:35 is not it.
        withheld = parse_sheets(sheet("1번", ["제주터미널", "합성B", "합성C"], rows, summary="첫차 5:35, 막차 21:30"))
        self.assertEqual(withheld["status"], "source_conflict")
        self.assertEqual(withheld["services"][0]["conflicts"], ["summary 첫차 05:35 disagrees with the trips (05:50)"])
        self.assertEqual(parse_sheets(sheet("1번", ["제주터미널", "합성B", "합성C"], rows, summary="첫차(제주 출발) 5:35, 막차 21:31"))["status"], "source_conflict")

    def test_identical_sheets_merge_and_differing_ones_conflict(self) -> None:
        a = sheet("1번", ["합성A", "합성B"], [["06:00", "06:10"]], effective="(시행일 : 2023.12.13)")
        b = sheet("1번", ["합성A", "합성B"], [["06:00", "06:10"]], effective="(시행일 : 2026.4.30)")
        service = parse_sheets(a, b)["services"]
        self.assertEqual(len(service), 1)
        self.assertEqual(service[0]["sheets"], ["합성0", "합성1"])
        self.assertEqual((service[0]["effectiveFrom"], service[0]["effectiveDates"]), ("2026-04-30", ["2023-12-13", "2026-04-30"]))
        different = parse_sheets(a, sheet("1번", ["합성A", "합성B"], [["06:05", "06:15"]]))
        self.assertEqual(different["status"], "source_conflict")

    def test_a_season_in_the_route_column(self) -> None:
        # Route 43-1: "동절기" in the 노선번호 column.
        trips = parse_sheets(sheet("1번, 2번", ["노선번호", "합성A", "합성B"], [["1번", "06:00", "06:10"], ["동절기", "07:00", "07:10"]]), listed="1, 2")["services"][0]["trips"]
        self.assertEqual((trips[1]["routeNumber"], trips[1]["season"], trips[1]["conditions"]), (None, "동절기", ["동절기"]))

    def test_restricting_notes_become_conditions_and_a_shared_note_moves_to_the_service(self) -> None:
        rows = [["06:00", "06:10", "평일 운행"], ["07:00", "07:10", "평일 운행"]]
        service = parse_sheets(sheet("1100번(평일)", ["합성A", "합성B", "비고"], rows))["services"][0]
        self.assertEqual(service["note"], "평일 운행")
        self.assertNotIn("conditions", service["trips"][0])
        rows = [["16:10", "16:30", "11,12,1,2월 막차"], ["16:30", "16:50", "보성.신평"]]
        trips = parse_sheets(sheet("921번", ["합성A", "합성B", "비고"], rows))["services"][0]["trips"]
        self.assertEqual(trips[0]["conditions"], ["11,12,1,2월 막차"])
        self.assertNotIn("conditions", trips[1])

    def test_unreadable_cells_are_refused_with_the_cell_named(self) -> None:
        for text in ["06:3O", "6시 30분", "06:30~"]:
            with self.subTest(text):
                with self.assertRaises(jeju_xlsx.TimetableParseError) as caught:
                    parse_sheets(sheet("1번", ["합성A", "합성B"], [["06:00", text]]))
                self.assertIn("cell D8", str(caught.exception))

    def test_a_route_column_naming_another_route_is_refused(self) -> None:
        with self.assertRaises(jeju_xlsx.TimetableParseError) as caught:
            parse_sheets(sheet("1번, 2번", ["노선번호", "합성A", "합성B"], [["3번", "06:00", "06:10"]]))
        self.assertEqual(caught.exception.family, "route_column")

    def test_a_value_past_the_note_column_is_refused(self) -> None:
        cells = sheet("1번", ["합성A", "합성B", "비고"], [["06:00", "06:10", ""]])
        cells["G8"] = "07:30"
        with self.assertRaises(jeju_xlsx.TimetableParseError) as caught:
            parse_sheets(cells)
        self.assertIn("cell G8", str(caught.exception))

    def test_a_missing_trip_number(self) -> None:
        cells = sheet("1번", ["합성A", "합성B"], [["06:00", "06:10"], ["07:00", "07:10"]])
        cells["B9"] = "3"
        with self.assertRaises(jeju_xlsx.TimetableParseError) as caught:
            parse_sheets(cells)
        self.assertIn("expected trip 2", str(caught.exception))

    def test_an_impossible_effective_date_is_refused(self) -> None:
        with self.assertRaises(jeju_xlsx.TimetableParseError) as caught:
            parse_sheets(sheet("1번", ["합성A", "합성B"], [["06:00", "06:10"]], effective="(시행일 : 2026. 2. 30.)"))
        self.assertEqual(caught.exception.family, "effective_date")


if __name__ == "__main__":
    unittest.main()
