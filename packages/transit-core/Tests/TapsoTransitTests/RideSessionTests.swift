import XCTest
@testable import TapsoTransit

/// Journey transitions as the app drives them: `RideSession` (`TapsoAppModel`
/// creates one per ride and feeds it observations). All data is the SYNTHETIC
/// demo fixture.
final class RideSessionTests: XCTestCase {
    func testAnUnconfirmedRideBecomesActiveOnlyWhenTheRiderConfirms() {
        var session = RideSession(plan: DemoFixtures.plan, startedAt: DemoFixtures.referenceDate, state: .vehicleConfirmationRequired)
        XCTAssertNil(session.matchedVehicleID)
        session.confirm(vehicleID: "demo-bus-365-A")
        XCTAssertEqual(session.state, .active)
        XCTAssertEqual(session.matchedVehicleID, "demo-bus-365-A")
    }

    func testApproachToArrivalFlow() {
        var session = activeSession()
        XCTAssertEqual(apply(&session, stop: 6, seconds: 0), .approachingDestination)
        XCTAssertEqual(apply(&session, stop: 7, seconds: 10), .nextStopIsDestination)
        XCTAssertEqual(apply(&session, stop: 8, seconds: 20), .arrived)
        session.complete()
        XCTAssertEqual(session.state, .completed)
    }

    func testActiveToStaleAndBackToActive() {
        var session = activeSession()
        // Observed 121 s before now: past the stale bound.
        XCTAssertEqual(apply(&session, stop: 2, seconds: -121, now: DemoFixtures.referenceDate), .dataStale)
        XCTAssertEqual(apply(&session, stop: 3, seconds: 0, now: DemoFixtures.referenceDate), .active)
    }

    func testVehicleLossAndRecovery() {
        var session = activeSession()
        session.markVehicleLost()
        XCTAssertEqual(session.state, .vehicleTemporarilyLost)
        XCTAssertEqual(apply(&session, stop: 3, seconds: 0), .active, "a fresh position of the same bus recovers the ride")
    }

    func testALostVehicleNeverReopensAFinishedRide() {
        for finish in [JourneyState.arrived, .completed, .cancelled] {
            var session = RideSession(plan: DemoFixtures.plan, startedAt: DemoFixtures.referenceDate, matchedVehicleID: "demo-bus-365-A", state: finish)
            session.markVehicleLost()
            XCTAssertEqual(session.state, finish)
        }
    }

    func testCancellation() {
        var session = activeSession()
        session.cancel()
        XCTAssertEqual(session.state, .cancelled)
    }

    func testRideSessionRejectsDuplicateAndOutOfOrderUpdates() {
        var session = activeSession()
        let initial = DemoFixtures.observation(stopSequence: 1, seconds: 10)
        XCTAssertApplied(session.apply(
            observation: initial,
            route: DemoFixtures.route,
            now: initial.timestamp
        ))
        XCTAssertEqual(
            session.apply(observation: initial, route: DemoFixtures.route, now: initial.timestamp),
            .duplicate
        )
        let old = DemoFixtures.observation(stopSequence: 0, seconds: 5)
        XCTAssertEqual(
            session.apply(observation: old, route: DemoFixtures.route, now: initial.timestamp),
            .outOfOrder
        )
    }

    func testRideSessionRejectsWrongVehicle() {
        var session = activeSession()
        let other = DemoFixtures.observation(vehicleID: "other", stopSequence: 1)
        XCTAssertEqual(
            session.apply(observation: other, route: DemoFixtures.route, now: other.timestamp),
            .wrongVehicle
        )
        XCTAssertEqual(session.state, .active, "another bus's position changes nothing")
    }

    private func activeSession() -> RideSession {
        RideSession(
            plan: DemoFixtures.plan,
            startedAt: DemoFixtures.referenceDate,
            matchedVehicleID: "demo-bus-365-A",
            state: .active
        )
    }

    /// Applies the matched bus at `stop`, observed `seconds` after the reference date,
    /// read at `now` (default: the observation's own time), and returns the new state.
    private func apply(_ session: inout RideSession, stop: Int, seconds: TimeInterval, now: Date? = nil) -> JourneyState {
        let observation = DemoFixtures.observation(stopSequence: stop, seconds: seconds)
        XCTAssertApplied(session.apply(observation: observation, route: DemoFixtures.route, now: now ?? observation.timestamp))
        return session.state
    }

    private func XCTAssertApplied(
        _ update: RideSessionUpdate,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .applied = update else {
            XCTFail("Expected applied update, got \(update)", file: file, line: line)
            return
        }
    }
}
