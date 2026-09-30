import XCTest
@testable import TapsoTransit

final class RideGuidanceTests: XCTestCase {
    private func moment(
        _ phase: JourneyState,
        _ remaining: Int,
        _ freshness: DataFreshness = .fresh,
        passed: Bool = false,
        offline: Bool = false
    ) -> RideMoment {
        RideGuidancePolicy.moment(
            for: RideSignal(
                phase: phase,
                remainingStops: remaining,
                freshness: freshness,
                destinationPassed: passed,
                isOffline: offline
            )
        )
    }

    func testTwoOneAndZeroStopsAreDistinctMoments() {
        XCTAssertEqual(moment(.active, 8), .riding)
        XCTAssertEqual(moment(.active, 3), .riding)
        XCTAssertEqual(moment(.approachingDestination, 2), .prepare)
        XCTAssertEqual(moment(.nextStopIsDestination, 1), .nextStop)
        XCTAssertEqual(moment(.arrived, 0), .arrived)
    }

    func testEachActionMomentAnswersADifferentQuestion() {
        let moments: [RideMoment] = [.riding, .prepare, .nextStop, .arrived]
        let guidance = moments.map { m in
            RideGuidancePolicy.guidance(for: RideSignal(
                phase: [.active, .approachingDestination, .nextStopIsDestination, .arrived][moments.firstIndex(of: m)!],
                remainingStops: [5, 2, 1, 0][moments.firstIndex(of: m)!],
                freshness: .fresh
            ))
        }
        XCTAssertEqual(guidance.map(\.moment), moments)
        XCTAssertEqual(Set(guidance.map(\.copy.headline)).count, 4)
        XCTAssertEqual(Set(guidance.map(\.symbolName)).count, 4)
        XCTAssertEqual(Set(guidance.map(\.colorRole)).count, 4)
        XCTAssertEqual(guidance.map(\.haptic), [.none, .preparation, .nextStop, .arrival])
        XCTAssertEqual(guidance.map(\.milestone), [nil, .prepare, .nextStop, .arrived])
    }

    func testPhaseAndCountDisagreementFailsClosed() {
        XCTAssertEqual(moment(.nextStopIsDestination, 2), .checking)
        XCTAssertEqual(moment(.arrived, 1), .checking)
        XCTAssertEqual(moment(.approachingDestination, 1), .checking)
        XCTAssertEqual(moment(.active, 2), .checking)
        XCTAssertEqual(moment(.active, -1), .checking)
    }

    func testStaleOrAgingDataNeverEscalates() {
        XCTAssertEqual(moment(.nextStopIsDestination, 1, .stale), .delayed)
        XCTAssertEqual(moment(.arrived, 0, .stale), .delayed)
        XCTAssertEqual(moment(.approachingDestination, 2, .aging), .delayed)
        XCTAssertEqual(moment(.dataStale, 4), .delayed)
        XCTAssertEqual(moment(.active, 8, .unknown), .checking)
        XCTAssertEqual(moment(.vehicleRecovery, 4), .checking)
    }

    func testVehicleIdentityAndDataFreshnessAreSeparateSignals() {
        let delayedButKnown = RideGuidancePolicy.guidance(for: RideSignal(
            phase: .active, remainingStops: 5, freshness: .stale
        ))
        XCTAssertEqual(delayedButKnown.moment, .delayed)
        XCTAssertEqual(delayedButKnown.vehicle, .confirmed)
        XCTAssertEqual(delayedButKnown.data, .delayed)

        let lostButLive = RideGuidancePolicy.guidance(for: RideSignal(
            phase: .vehicleTemporarilyLost, remainingStops: 5, freshness: .fresh
        ))
        XCTAssertEqual(lostButLive.moment, .vehicleLost)
        XCTAssertEqual(lostButLive.vehicle, .lost)
        XCTAssertEqual(lostButLive.data, .live)

        let offline = RideGuidancePolicy.guidance(for: RideSignal(
            phase: .active, remainingStops: 5, freshness: .fresh, isOffline: true
        ))
        XCTAssertEqual(offline.moment, .offline)
        XCTAssertEqual(offline.vehicle, .confirmed)
        XCTAssertEqual(offline.data, .offline)
    }

    func testOfflineOutranksEveryOtherRideState() {
        XCTAssertEqual(moment(.nextStopIsDestination, 1, offline: true), .offline)
        XCTAssertEqual(moment(.vehicleTemporarilyLost, 3, .stale, offline: true), .offline)
        XCTAssertEqual(moment(.completed, 0, offline: true), .ended)
    }

    func testPassedDestinationIsItsOwnMomentNotAnArrival() {
        let passed = RideGuidancePolicy.guidance(for: RideSignal(
            phase: .arrived, remainingStops: 0, freshness: .fresh, destinationPassed: true
        ))
        XCTAssertEqual(passed.moment, .passedDestination)
        XCTAssertNil(passed.milestone, "passing the stop must not fire the arrival alert")
        XCTAssertEqual(passed.haptic, .attention)
        XCTAssertEqual(passed.recovery, .getOffAndReturn)
        XCTAssertEqual(moment(.arrived, 0, .stale, passed: true), .delayed)
        XCTAssertEqual(moment(.active, 4, passed: true), .checking)
    }

    func testUncertainStatesAreQuietAndNeverAlert() {
        for moment in [RideMoment.delayed, .vehicleLost, .offline, .checking, .ended, .riding] {
            XCTAssertEqual(RideGuidancePolicy.haptic(for: moment), .none, "\(moment)")
            XCTAssertNil(RideGuidancePolicy.milestone(for: moment), "\(moment)")
        }
    }

    func testCountIsLiveOnlyWhenSafeToActOn() {
        XCTAssertEqual(RideGuidancePolicy.countPresentation(for: .riding), .live)
        XCTAssertEqual(RideGuidancePolicy.countPresentation(for: .nextStop), .live)
        XCTAssertEqual(RideGuidancePolicy.countPresentation(for: .delayed), .lastKnown)
        XCTAssertEqual(RideGuidancePolicy.countPresentation(for: .vehicleLost), .lastKnown)
        XCTAssertEqual(RideGuidancePolicy.countPresentation(for: .checking), .hidden)
        XCTAssertEqual(RideGuidancePolicy.countPresentation(for: .passedDestination), .hidden)
    }

    func testRelevanceRisesTowardArrival() {
        let scores = [RideMoment.riding, .prepare, .nextStop, .arrived].map(RideGuidancePolicy.relevanceScore(for:))
        XCTAssertEqual(scores, scores.sorted())
        XCTAssertGreaterThan(RideGuidancePolicy.relevanceScore(for: .delayed), RideGuidancePolicy.relevanceScore(for: .riding))
    }

    /// Exhaustive: no combination of inputs produces a milestone without an exact, fresh, online agreement.
    func testMilestonesRequireExactFreshOnlineAgreementForEveryInput() {
        let phases: [JourneyState] = [
            .idle, .planning, .waitingForBoarding, .matchingVehicle, .vehicleConfirmationRequired,
            .active, .approachingDestination, .nextStopIsDestination, .arrived, .dataAging, .dataStale,
            .vehicleTemporarilyLost, .vehicleRecovery, .cancelled, .completed
        ]
        let exact: [JourneyState: Int] = [.approachingDestination: 2, .nextStopIsDestination: 1, .arrived: 0]
        for phase in phases {
            for remaining in -2...10 {
                for freshness in [DataFreshness.fresh, .aging, .stale, .unknown] {
                    for passed in [false, true] {
                        for offline in [false, true] {
                            let guidance = RideGuidancePolicy.guidance(for: RideSignal(
                                phase: phase, remainingStops: remaining, freshness: freshness,
                                destinationPassed: passed, isOffline: offline
                            ))
                            guard guidance.milestone != nil else { continue }
                            XCTAssertEqual(freshness, .fresh)
                            XCTAssertFalse(offline)
                            XCTAssertFalse(passed)
                            XCTAssertEqual(exact[phase], remaining, "\(phase) \(remaining)")
                        }
                    }
                }
            }
        }
    }

    func testEveryMomentHasItsOwnCopyKeys() {
        let headlines = RideMoment.allCases.map { RideGuidancePolicy.copy(for: $0).headline }
        XCTAssertEqual(Set(headlines).count, RideMoment.allCases.count)
        XCTAssertNil(RideGuidancePolicy.copy(for: .riding).compact, "riding shows the count, not a pill")
        XCTAssertTrue(RideGuidancePolicy.allCopyKeys.allSatisfy { $0.hasPrefix("ride.") })
        XCTAssertEqual(Set(RideGuidancePolicy.allCopyKeys).count, RideGuidancePolicy.allCopyKeys.count)
    }

    func testSignalFromSessionWithoutProgressFailsClosed() {
        let session = RideSession(plan: DemoFixtures.plan, startedAt: DemoFixtures.referenceDate, state: .active)
        XCTAssertEqual(RideGuidancePolicy.moment(for: RideSignal(session: session)), .checking)
    }

    func testSilenceAgesASessionIntoDelayedWithoutNewObservations() throws {
        var session = RideSession(
            plan: DemoFixtures.plan,
            startedAt: DemoFixtures.referenceDate,
            matchedVehicleID: "demo-bus-365-A",
            state: .active
        )
        let observation = DemoFixtures.observation(stopSequence: 2)
        _ = session.apply(observation: observation, route: DemoFixtures.route, now: observation.timestamp)
        let policy = FreshnessPolicy.conservativeDefault
        let later = policy.classify(observedAt: observation.timestamp, relativeTo: observation.timestamp.addingTimeInterval(150))
        let guidance = RideGuidancePolicy.guidance(for: RideSignal(session: session, freshness: later))
        XCTAssertEqual(guidance.moment, .delayed)
        XCTAssertEqual(guidance.vehicle, .confirmed)
        XCTAssertEqual(guidance.count, .lastKnown)
    }
}
