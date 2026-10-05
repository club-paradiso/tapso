import XCTest
@testable import TapsoTransit

/// AUTO_START.md M3: which bus the nudge names, and the rider's opt-ins.
final class StopNudgeTests: XCTestCase {
    func testNearestBusThatHasNotPassedTheStop() {
        // Boarding at sequence 10: buses at 7 (3 away), 9 (1 away), 12 (passed), unknown.
        XCTAssertEqual(StopNudge.nearestStopsAway(boardingSequence: 10, vehicleSequences: [7, 9, 12, nil]), 1)
        XCTAssertEqual(StopNudge.nearestStopsAway(boardingSequence: 10, vehicleSequences: [10, 4]), 0)
    }

    func testNoBusWithinTheHorizonIsUnknown() {
        XCTAssertNil(StopNudge.nearestStopsAway(boardingSequence: 30, vehicleSequences: [2, 31]))
        XCTAssertNil(StopNudge.nearestStopsAway(boardingSequence: 10, vehicleSequences: [nil]))
        XCTAssertNil(StopNudge.nearestStopsAway(boardingSequence: 10, vehicleSequences: []))
    }

    func testMessageByDistance() {
        XCTAssertEqual(StopNudge.Message(routeNumber: "365", stopsAway: 2), .approaching(routeNumber: "365", stopsAway: 2))
        XCTAssertEqual(StopNudge.Message(routeNumber: "365", stopsAway: 0), .atStop(routeNumber: "365"))
        XCTAssertEqual(StopNudge.Message(routeNumber: "365", stopsAway: nil), .unknown(routeNumber: "365"))
    }

    func testOptInsAreCappedAndRefreshInPlace() {
        var settings = StopNudgeSettings()
        for index in 0..<StopNudge.maximumStops {
            XCTAssertTrue(settings.enable(.init(journeyID: "SYN-\(index)", latitude: 33.5, longitude: 126.5)))
        }
        XCTAssertFalse(settings.enable(.init(journeyID: "SYN-extra", latitude: 33.5, longitude: 126.5)))
        XCTAssertTrue(settings.enable(.init(journeyID: "SYN-0", latitude: 33.6, longitude: 126.6)))
        XCTAssertEqual(settings.stops.count, StopNudge.maximumStops)
        XCTAssertEqual(settings.stops.first?.latitude, 33.6)
        settings.disable("SYN-0")
        XCTAssertFalse(settings.isEnabled("SYN-0"))
    }

    func testNotTodaySilencesUntilTheNextDay() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Asia/Seoul"))
        let morning = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 10, day: 6, hour: 8, minute: 5)))
        var settings = StopNudgeSettings()
        settings.snoozeForToday("SYN-A", now: morning, calendar: calendar)
        XCTAssertTrue(settings.isSnoozed("SYN-A", now: morning.addingTimeInterval(3600 * 10)))
        let nextMorning = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 10, day: 7, hour: 0, minute: 1)))
        XCTAssertFalse(settings.isSnoozed("SYN-A", now: nextMorning))
        XCTAssertFalse(settings.isSnoozed("SYN-B", now: morning))
    }
}
