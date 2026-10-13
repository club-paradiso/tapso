import XCTest
@testable import TapsoTransit

/// A confirmed bus that has not reached the boarding stop yet. Shape from a real
/// ride on 2026-10-13 (route 360, 3-stop ride, bus confirmed one stop out); the
/// signals here are SYNTHETIC.
final class RideBeforeBoardingTests: XCTestCase {
    private func signal(_ remaining: Int, _ phase: JourneyState = .active) -> RideSignal {
        RideSignal(phase: phase, remainingStops: remaining, freshness: .fresh)
    }

    func testStopsBeforeBoardingIsTheExcessOverTheRide() {
        XCTAssertEqual(RideGuidancePolicy.stopsBeforeBoarding(remaining: 4, rideLength: 3), 1)
        XCTAssertNil(RideGuidancePolicy.stopsBeforeBoarding(remaining: 3, rideLength: 3), "at the boarding stop")
        XCTAssertNil(RideGuidancePolicy.stopsBeforeBoarding(remaining: -1, rideLength: 3), "unknown count")
        XCTAssertNil(RideGuidancePolicy.stopsBeforeBoarding(remaining: 4, rideLength: 0))
    }

    func testABusStillComingSaysSoAndNeverAlerts() {
        let waiting = RideGuidancePolicy.guidance(for: signal(4), rideLength: 3)
        XCTAssertEqual(waiting.moment, .riding)
        XCTAssertEqual(waiting.copy.eyebrow, "ride.waiting.eyebrow")
        XCTAssertNil(waiting.milestone)
        XCTAssertEqual(waiting.haptic, .none)
        XCTAssertEqual(waiting.count, .live)

        // A 1-stop ride whose bus is 1 stop out: the plain policy would say "get ready".
        XCTAssertEqual(RideGuidancePolicy.guidance(for: signal(2, .approachingDestination)).milestone, .prepare)
        let short = RideGuidancePolicy.guidance(for: signal(2, .approachingDestination), rideLength: 1)
        XCTAssertNil(short.milestone, "no get-off alert before the rider is aboard")
        XCTAssertEqual(short.copy.eyebrow, "ride.waiting.eyebrow")
    }

    func testOnceTheBusReachesTheStopGuidanceIsUnchanged() {
        for (remaining, phase) in [(3, JourneyState.active), (2, .approachingDestination), (1, .nextStopIsDestination), (0, .arrived)] {
            XCTAssertEqual(RideGuidancePolicy.guidance(for: signal(remaining, phase), rideLength: 3),
                           RideGuidancePolicy.guidance(for: signal(remaining, phase)), "remaining \(remaining)")
        }
    }

    func testDegradedDataKeepsItsOwnMomentWhileWaiting() {
        let stale = RideSignal(phase: .dataStale, remainingStops: 4, freshness: .stale)
        XCTAssertEqual(RideGuidancePolicy.guidance(for: stale, rideLength: 3).moment, .delayed)
        let lost = RideSignal(phase: .vehicleTemporarilyLost, remainingStops: 4, freshness: .fresh)
        XCTAssertEqual(RideGuidancePolicy.guidance(for: lost, rideLength: 3).moment, .vehicleLost)
    }
}
