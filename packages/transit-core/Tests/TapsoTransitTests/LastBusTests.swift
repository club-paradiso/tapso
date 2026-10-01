import Foundation
import TapsoTransit
import XCTest

/// The last bus through the Safe Return engine. Service days are SYNTHETIC values
/// in the shape `GET /v1/route-info` returns; dates are fixed Korean times.
final class LastBusTests: XCTestCase {
    private func seoul(_ day: Int, _ hour: Int, _ minute: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = LastBus.timeZone
        // 2026-10-01 is a Thursday, the 3rd a Saturday, the 4th a Sunday.
        return calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    private let evening = TransitAPIRouteServiceHours(
        routeId: "SYN-202-E",
        firstDeparture: "06:00",
        lastDeparture: "22:30",
        headwayMinutes: .init(weekday: 30, saturday: 35, sunday: 40)
    )

    func testTheLevelFallsAsTheLastDepartureNears() {
        let cases: [(Int, Int, SafeReturnLevel)] = [(19, 0, .comfortable), (21, 30, .leaveBy), (22, 5, .tight), (22, 25, .notRecommended)]
        for (hour, minute, level) in cases {
            let advice = LastBus.advice(for: evening, now: seoul(1, hour, minute))
            XCTAssertEqual(advice.level, level, "\(hour):\(minute)")
            XCTAssertEqual(advice.lastDeparture, "22:30")
        }
        XCTAssertEqual(LastBus.advice(for: evening, now: seoul(1, 19, 0)).beAtStopBy, "22:20", "the Safe Return margin before the starting stop's departure")
    }

    func testAfterTheLastDepartureTheBusIsGone() {
        let advice = LastBus.advice(for: evening, now: seoul(1, 22, 40))
        XCTAssertEqual(advice.level, .notRecommended)
        XCTAssertTrue(advice.isGone)
        XCTAssertNil(advice.beAtStopBy)
    }

    func testALastDepartureAfterMidnightBelongsToTheSameServiceDay() {
        let late = TransitAPIRouteServiceHours(routeId: "SYN-LATE", firstDeparture: "05:40", lastDeparture: "00:20")
        XCTAssertEqual(LastBus.advice(for: late, now: seoul(1, 23, 50)).level, .leaveBy)
        let afterMidnight = LastBus.advice(for: late, now: seoul(2, 0, 5))
        XCTAssertEqual(afterMidnight.level, .tight)
        XCTAssertEqual(afterMidnight.beAtStopBy, "00:10")
        XCTAssertTrue(LastBus.advice(for: late, now: seoul(2, 0, 30)).isGone)
    }

    func testNoPublishedLastDepartureIsUnknownNeverSafe() {
        XCTAssertEqual(LastBus.advice(for: nil, now: seoul(1, 12, 0)).level, .unknown)
        let noLast = TransitAPIRouteServiceHours(routeId: "SYN", firstDeparture: "06:00")
        let advice = LastBus.advice(for: noLast, now: seoul(1, 12, 0))
        XCTAssertEqual(advice.level, .unknown)
        XCTAssertEqual(advice.reasons, [.returnUnknown])
        XCTAssertNil(advice.beAtStopBy)
    }

    func testTodaysHeadwayFollowsTheKoreanDay() {
        XCTAssertEqual(LastBus.advice(for: evening, now: seoul(1, 12, 0)).headwayMinutes, 30)
        XCTAssertEqual(LastBus.advice(for: evening, now: seoul(3, 12, 0)).day, .saturday)
        XCTAssertEqual(LastBus.advice(for: evening, now: seoul(3, 12, 0)).headwayMinutes, 35)
        XCTAssertEqual(LastBus.advice(for: evening, now: seoul(4, 12, 0)).headwayMinutes, 40)
        // 23:30 UTC on Friday the 2nd is already Saturday in Jeju.
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let fridayNightUTC = utc.date(from: DateComponents(year: 2026, month: 10, day: 2, hour: 23, minute: 30))!
        XCTAssertEqual(LastBus.advice(for: evening, now: fridayNightUTC).day, .saturday)
    }
}
