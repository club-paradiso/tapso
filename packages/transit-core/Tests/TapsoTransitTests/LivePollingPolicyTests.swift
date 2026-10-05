import XCTest
@testable import TapsoTransit

/// Foreground session reads: 15 s far out, 10 s near the destination, 10 s while rechecking
/// for at most two minutes, and never faster for a bus that is lost.
final class LivePollingPolicyTests: XCTestCase {
    func testFarWhileRidingWithManyStops() {
        for stops in [4, 8, 12, 30] {
            XCTAssertEqual(LivePollingPolicy.band(trust: .live, remainingStops: stops, recoveryElapsed: nil), .far, "\(stops)")
            XCTAssertEqual(LivePollingPolicy.interval(trust: .live, remainingStops: stops, recoveryElapsed: nil), .seconds(15))
        }
    }

    func testNearForThreeStopsOrFewerWhenTrusted() {
        for stops in [3, 2, 1, 0] {
            XCTAssertEqual(LivePollingPolicy.band(trust: .live, remainingStops: stops, recoveryElapsed: nil), .near, "\(stops)")
            XCTAssertEqual(LivePollingPolicy.band(trust: .estimated, remainingStops: stops, recoveryElapsed: nil), .near, "estimated \(stops)")
        }
        XCTAssertEqual(LivePollingPolicy.interval(trust: .live, remainingStops: 2, recoveryElapsed: nil), .seconds(10))
        XCTAssertEqual(LivePollingPolicy.band(trust: .live, remainingStops: -1, recoveryElapsed: nil), .far, "an unknown count is not near")
    }

    func testRecoveryIsFasterButBounded() {
        XCTAssertEqual(LivePollingPolicy.band(trust: .rechecking, remainingStops: 8, recoveryElapsed: .seconds(0)), .recovery)
        XCTAssertEqual(LivePollingPolicy.band(trust: .rechecking, remainingStops: 8, recoveryElapsed: .seconds(119)), .recovery)
        XCTAssertEqual(LivePollingPolicy.band(trust: .rechecking, remainingStops: 8, recoveryElapsed: .seconds(120)), .far, "past the budget the cadence returns to far")
        XCTAssertEqual(LivePollingPolicy.band(trust: .rechecking, remainingStops: 2, recoveryElapsed: .seconds(600)), .far, "near the destination too: rechecking is not a trusted count")
        XCTAssertEqual(LivePollingPolicy.interval(for: .recovery), .seconds(10))
    }

    func testUnavailableNeverPollsFaster() {
        for stops in [8, 2, 1] {
            XCTAssertEqual(LivePollingPolicy.band(trust: .unavailable, remainingStops: stops, recoveryElapsed: .seconds(5)), .far, "\(stops)")
        }
    }

    func testNoBandIsFasterThanTenSecondsOrSlowerThanFifteen() {
        for band in [LivePollingPolicy.Band.far, .near, .recovery] {
            let interval = LivePollingPolicy.interval(for: band)
            XCTAssertGreaterThanOrEqual(interval, .seconds(10), "\(band)")
            XCTAssertLessThanOrEqual(interval, .seconds(15), "\(band)")
        }
    }
}
