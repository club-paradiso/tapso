import XCTest
@testable import TapsoTransit

/// Regression guard for the boarding/riding contract (`guidance(for:rideLength:)`).
///
/// PR #145 replaced `RideGuidancePolicy.guidance(for: signal, rideLength: draft.totalStops)`
/// with `guidance(for: signal)`. Every assertion here that names a waiting state fails
/// against that call, so the contract cannot be dropped silently again. The signals
/// are SYNTHETIC: a bus advancing one stop per observation, phases derived the way the
/// server derives them (counted from the destination).
final class RideBoardingRegressionTests: XCTestCase {
    /// The phase the server reports for a bus `remaining` stops from the destination.
    private func phase(_ remaining: Int) -> JourneyState {
        switch remaining {
        case 0: .arrived
        case 1: .nextStopIsDestination
        case 2: .approachingDestination
        default: .active
        }
    }

    private func signal(_ remaining: Int) -> RideSignal {
        RideSignal(phase: phase(remaining), remainingStops: remaining, freshness: .fresh)
    }

    private func guidance(busToDestination remaining: Int, rideLength: Int) -> RideGuidance {
        RideGuidancePolicy.guidance(for: signal(remaining), rideLength: rideLength)
    }

    /// Milestones in the order a ride would raise them as the bus advances from `start`.
    private func milestones(from start: Int, rideLength: Int) -> [(remaining: Int, milestone: RideMilestone)] {
        stride(from: start, through: 0, by: -1).compactMap { remaining in
            guidance(busToDestination: remaining, rideLength: rideLength).milestone.map { (remaining: remaining, milestone: $0) }
        }
    }

    func testBusThreeStopsBeforeBoardingIsWaiting() {
        // 4-stop ride, bus 3 stops before the boarding stop: 7 stops from the destination.
        let g = guidance(busToDestination: 7, rideLength: 4)
        XCTAssertTrue(g.isWaiting)
        XCTAssertEqual(g.stopsBeforeBoarding, 3)
        XCTAssertEqual(g.displayedCount(remaining: 7), 3, "the rider sees how far the bus is, not 7")
        XCTAssertEqual(g.copy.headline, "ride.waiting.headline")
        XCTAssertNil(g.milestone)
        XCTAssertEqual(g.haptic, .none)
    }

    func testBusOneStopBeforeBoardingIsWaiting() {
        let g = guidance(busToDestination: 5, rideLength: 4)
        XCTAssertEqual(g.stopsBeforeBoarding, 1)
        XCTAssertEqual(g.moment, .riding)
        XCTAssertNil(g.milestone)
    }

    func testBusAtTheBoardingStopIsNoLongerWaiting() {
        let g = guidance(busToDestination: 4, rideLength: 4)
        XCTAssertFalse(g.isWaiting)
        XCTAssertNil(g.stopsBeforeBoarding)
        XCTAssertEqual(g.displayedCount(remaining: 4), 4)
        XCTAssertEqual(g, RideGuidancePolicy.guidance(for: signal(4)), "aboard, the plain policy applies unchanged")
    }

    func testOneStopRideBeforeBoardingNeverSaysPrepareOrNextStop() {
        // Bus two stops from the destination is one stop before boarding a 1-stop ride.
        let twoOut = guidance(busToDestination: 2, rideLength: 1)
        XCTAssertEqual(RideGuidancePolicy.guidance(for: signal(2)).moment, .prepare, "the unguarded call would say prepare")
        XCTAssertEqual(twoOut.moment, .riding)
        XCTAssertEqual(twoOut.stopsBeforeBoarding, 1)
        XCTAssertNil(twoOut.milestone)

        // At the boarding stop of a 1-stop ride the next stop is the destination: that is correct.
        XCTAssertEqual(guidance(busToDestination: 1, rideLength: 1).milestone, .nextStop)
    }

    func testTwoStopRideBeforeBoardingHasNoPrepareUntilAboard() {
        let threeOut = guidance(busToDestination: 3, rideLength: 2)
        XCTAssertEqual(threeOut.stopsBeforeBoarding, 1)
        XCTAssertNil(threeOut.milestone)
        // At boarding, two stops remain: the prepare moment is now true for the rider.
        XCTAssertEqual(guidance(busToDestination: 2, rideLength: 2).milestone, .prepare)
    }

    func testBusConfirmedWhileApproachingStaysWaitingUntilItArrives() {
        // Confirmation does not move the bus: a bus confirmed 2 stops out is still 2 stops out.
        for remaining in [6, 5] {
            let g = guidance(busToDestination: remaining, rideLength: 4)
            XCTAssertTrue(g.isWaiting, "remaining \(remaining)")
            XCTAssertEqual(g.count, .live)
        }
    }

    func testTransitionFromApproachingToRiding() {
        let sequence = stride(from: 7, through: 0, by: -1).map { guidance(busToDestination: $0, rideLength: 4) }
        let waiting = sequence.prefix(while: \.isWaiting)
        XCTAssertEqual(waiting.count, 3, "7, 6, 5 are before boarding")
        XCTAssertEqual(waiting.map { $0.stopsBeforeBoarding }, [3, 2, 1])
        XCTAssertTrue(sequence.dropFirst(3).allSatisfy { !$0.isWaiting }, "once aboard, never waiting again")
        XCTAssertEqual(sequence[3].moment, .riding)
        XCTAssertEqual(sequence[3].copy.headline, RideGuidancePolicy.guidance(for: signal(4)).copy.headline)
    }

    func testNoPrematureTwoStopOrNextStopAlertForAnyShortRide() {
        for rideLength in 1...4 {
            let raised = milestones(from: rideLength + 5, rideLength: rideLength)
            for (remaining, milestone) in raised {
                XCTAssertLessThanOrEqual(remaining, rideLength, "ride \(rideLength): \(milestone) raised before boarding at \(remaining)")
            }
            XCTAssertEqual(raised.last?.milestone, .arrived, "ride \(rideLength)")
        }
        XCTAssertEqual(milestones(from: 9, rideLength: 4).map { $0.milestone }, [.prepare, .nextStop, .arrived])
        XCTAssertEqual(milestones(from: 6, rideLength: 1).map { $0.milestone }, [.nextStop, .arrived])
    }

    func testDegradedDataWhileWaitingStillReportsTheBoardingGap() {
        let stale = RideSignal(phase: .dataStale, remainingStops: 6, freshness: .stale)
        let g = RideGuidancePolicy.guidance(for: stale, rideLength: 4)
        XCTAssertEqual(g.moment, .delayed)
        XCTAssertEqual(g.stopsBeforeBoarding, 2, "a last-known count is never shown as a ride under way")
        XCTAssertNil(g.milestone)
    }

    func testTheWaitingDecisionIsAFunctionOfTheSignalAndRideLengthOnly() {
        // Every surface (app, Lock Screen, Dynamic Island, push planner) calls the same
        // function with the same two facts, so they cannot disagree about waiting.
        for remaining in 0...9 {
            for rideLength in 1...5 {
                XCTAssertEqual(guidance(busToDestination: remaining, rideLength: rideLength),
                               guidance(busToDestination: remaining, rideLength: rideLength))
                XCTAssertEqual(guidance(busToDestination: remaining, rideLength: rideLength).isWaiting, remaining > rideLength)
            }
        }
    }
}
