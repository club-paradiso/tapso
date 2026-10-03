import XCTest
@testable import TapsoTransit

/// Decodes the server's own timetable views (`fixtures/journey/timetable-views-v1.json`,
/// generated from the committed official bundle by `scripts/journey/timetable-views.ts`)
/// and checks what the rider reads from each.
final class OfficialTimetableTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Entry: Decodable {
            let name: String
            let item: TransitAPITimetable
        }

        let views: [Entry]
    }

    private func view(_ name: String) throws -> TransitAPITimetable {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("fixtures/journey/timetable-views-v1.json")
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        return try XCTUnwrap(fixture.views.first { $0.name == name }?.item)
    }

    func testADatedRouteOnAWeekdayGivesTodaysFirstAndLastWithTheAsOfDate() throws {
        let summary = TimetableSummary.make(try view("dated-weekday"))
        XCTAssertEqual(summary.kind, .today)
        XCTAssertEqual(summary.asOf, "2026-10-03")
        XCTAssertFalse(summary.isStale)
        XCTAssertEqual(summary.lines.map(\.dayLabel), ["평일", "평일"])
        XCTAssertEqual(summary.lines.first?.first, .init(time: "06:00", from: "한라대"))
    }

    func testASubstituteHolidayUsesTheHolidayTable() throws {
        let summary = TimetableSummary.make(try view("dated-substitute-holiday"))
        XCTAssertEqual(summary.kind, .today)
        XCTAssertEqual(summary.holidayName, "개천절 대체 휴일")
        XCTAssertEqual(summary.lines.map(\.dayLabel), ["토,공휴일", "토,공휴일"])
    }

    func testATableWithNoDayTypeIsNeverCalledToday() throws {
        let summary = TimetableSummary.make(try view("undated"))
        XCTAssertEqual(summary.kind, .undated)
        XCTAssertFalse(summary.lines.isEmpty)
        XCTAssertTrue(summary.lines.allSatisfy { $0.dayLabel == nil })
    }

    func testAConflictingDirectionIsWithheldAndTheOtherStillShown() throws {
        let view = try view("partly-withheld")
        let withheld = view.services.filter { $0.status == "source_conflict" }
        XCTAssertFalse(withheld.isEmpty)
        XCTAssertTrue(withheld.allSatisfy { $0.trips.isEmpty && $0.first == nil })
        let summary = TimetableSummary.make(view)
        XCTAssertEqual(Set(summary.lines.map(\.direction)), Set(view.services.filter { $0.status == "ok" }.map(\.direction)))
    }

    func testConflictsAndMissingTablesClaimNothing() throws {
        XCTAssertEqual(TimetableSummary.make(try view("withheld")).kind, .withheld)
        XCTAssertEqual(TimetableSummary.make(try view("withheld")).lines, [])
        XCTAssertEqual(TimetableSummary.make(try view("no-timetable")).kind, .unavailable)
    }

    func testAStaleBundleIsADatedRecordNotToday() throws {
        let summary = TimetableSummary.make(try view("stale"))
        XCTAssertTrue(summary.isStale)
        XCTAssertNotEqual(summary.kind, .today)
        XCTAssertEqual(summary.asOf, "2026-10-03")
    }

    func testTimesAfterMidnightReadAsTheNextDay() {
        XCTAssertEqual(TimetableClock.display("24:05").text, "00:05")
        XCTAssertTrue(TimetableClock.display("24:05").nextDay)
        XCTAssertEqual(TimetableClock.display("06:30").text, "06:30")
        XCTAssertFalse(TimetableClock.display("06:30").nextDay)
    }
}
