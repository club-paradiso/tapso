import XCTest
@testable import Tapso

/// The screen after a live ride (`RideEndView`). TAGO's route info usually has no
/// Jeju last bus (V4 system audit F-03), so the "돌아갈 때 막차" rows mostly read
/// "막차 정보 없음". Tonight's official schedule (NightGuard) is the rider's answer,
/// so it gets its own block above those rows instead of sitting inside the
/// timetable card, where it showed only after that card's own download succeeded.
final class ReturnScreenLayoutTests: XCTestCase {
    func testTonightsScheduleComesBeforeTheLastBusRows() throws {
        let sections = ReturnScreenLayout.sections(timetableOffered: true)
        let tonight = try XCTUnwrap(sections.firstIndex(of: .tonight))
        let returnTrips = try XCTUnwrap(sections.firstIndex(of: .returnTrips))
        XCTAssertLessThan(tonight, returnTrips)
    }

    func testTheFullTimetableFollowsAsReference() throws {
        let sections = ReturnScreenLayout.sections(timetableOffered: true)
        let returnTrips = try XCTUnwrap(sections.firstIndex(of: .returnTrips))
        let timetable = try XCTUnwrap(sections.firstIndex(of: .timetable))
        XCTAssertLessThan(returnTrips, timetable)
        XCTAssertEqual(sections.first, .handoff, "the walk from the stop comes first")
        XCTAssertEqual(sections.last, .done)
    }

    func testWithoutAnOfficialTimetableThereIsNoTonightBlock() {
        // No city code (the sample ride): no official table to read tonight from.
        XCTAssertEqual(ReturnScreenLayout.sections(timetableOffered: false), [.handoff, .returnTrips, .done])
    }
}
