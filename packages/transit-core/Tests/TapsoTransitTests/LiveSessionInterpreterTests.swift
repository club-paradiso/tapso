import Foundation
import TapsoTransit
import XCTest

/// The app's reading of real server session payloads. The payloads are
/// generated from the server's own coordinator (`scripts/journey/session-views.ts`,
/// SYNTHETIC route and buses) and CI checks they are current, so these
/// expectations are about what production actually sends.
final class LiveSessionInterpreterTests: XCTestCase {
    private struct Fixture: Decodable {
        let scenarios: [Scenario]
    }

    private struct Scenario: Decodable {
        let id: String
        let why: String
        let view: JourneySessionSnapshot
    }

    private func scenarios() throws -> [String: JourneySessionSnapshot] {
        let repository = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let url = repository.appendingPathComponent("fixtures/journey/session-views-v1.json")
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        return Dictionary(uniqueKeysWithValues: fixture.scenarios.map { ($0.id, $0.view) })
    }

    private func moment(_ snapshot: JourneySessionSnapshot?, offline: Bool = false) -> RideMoment? {
        snapshot.map { RideGuidancePolicy.moment(for: LiveSessionInterpreter.rideSignal(for: $0, isOffline: offline)) }
    }

    func testEveryGeneratedPayloadDecodes() throws {
        let views = try scenarios()
        XCTAssertGreaterThanOrEqual(views.count, 16)
        for (id, view) in views {
            XCTAssertNotEqual(view.sessionState, .unrecognized, id)
        }
    }

    /// The safety rule of the whole integration: a departed bus is never offered to a waiting rider.
    func testADepartedBusIsNeverProposed() throws {
        let views = try scenarios()
        let awaiting = try XCTUnwrap(views["awaiting-departed-only"])
        XCTAssertFalse((awaiting.candidates ?? []).isEmpty, "the server publishes its full ranking")
        XCTAssertTrue(LiveSessionInterpreter.proposals(from: awaiting).isEmpty)
        XCTAssertEqual(LiveSessionInterpreter.vehicleCheck(for: awaiting).stage, .notFoundYet)
    }

    /// Issue #80: at `READY_FOR_SHADOW` one bus is a question, never "this looks like your bus".
    func testOneApproachingBusIsAQuestionNotASuggestion() throws {
        let snapshot = try XCTUnwrap(scenarios()["confirmation-one"])
        XCTAssertEqual(snapshot.vehicleChoice?.presentation, "rider_identifies")
        let check = LiveSessionInterpreter.vehicleCheck(for: snapshot)
        XCTAssertEqual(check.stage, .choose)
        XCTAssertEqual(check.proposals.map(\.maskedPlate), ["••0412"])
        XCTAssertEqual(check.proposals.first?.stopsAway, 2)
    }

    func testTwoApproachingBusesAreARiderQuestionNearestFirst() throws {
        let snapshot = try XCTUnwrap(scenarios()["confirmation-two"])
        let check = LiveSessionInterpreter.vehicleCheck(for: snapshot)
        XCTAssertEqual(check.stage, .choose)
        XCTAssertEqual(check.proposals.map(\.maskedPlate), ["••0412", "••0388"])
        XCTAssertEqual(check.proposals.map(\.stopsAway), [1, 2])

        let afterRejecting = LiveSessionInterpreter.vehicleCheck(
            for: snapshot,
            excluding: [VehicleIdentifier(rawValue: "SYN70가0412")]
        )
        XCTAssertEqual(afterRejecting.stage, .choose)
        XCTAssertEqual(afterRejecting.proposals.map(\.maskedPlate), ["••0388"])
    }

    /// Issue #80: the rider's list is the server's raw positions, not the matcher's
    /// confirmation list. The bus at the stop and one beyond the matcher's window are
    /// both there, nearest first; nothing is suggested.
    func testAtShadowTheRiderSeesRawPositionsAndNoSuggestion() throws {
        let snapshot = try XCTUnwrap(scenarios()["rider-identifies-at-shadow"])
        XCTAssertFalse(LiveSessionInterpreter.allowsMatcherSuggestion(snapshot))
        XCTAssertEqual(snapshot.candidates?.count, 2, "the matcher's list is narrower and stays unread")
        let check = LiveSessionInterpreter.vehicleCheck(for: snapshot)
        XCTAssertEqual(check.stage, .choose)
        XCTAssertEqual(check.proposals.map(\.maskedPlate), ["••0456", "••0789", "••0123"])
        XCTAssertEqual(check.proposals.map(\.stopsAway), [0, 1, 7])
    }

    /// The switch the gate would have to award first: only confirmation-assisted
    /// readiness lets the matcher's list be presented, and a tap still commits.
    func testConfirmationAssistedReadinessMaySuggestTheMatchersList() throws {
        let snapshot = try XCTUnwrap(scenarios()["matcher-suggestion-at-confirmation-assisted"])
        XCTAssertTrue(LiveSessionInterpreter.allowsMatcherSuggestion(snapshot))
        let check = LiveSessionInterpreter.vehicleCheck(for: snapshot)
        XCTAssertEqual(check.stage, .similarBuses)
        XCTAssertEqual(check.proposals.map(\.maskedPlate), ["••0456", "••0789"])
        XCTAssertNil(snapshot.selectedVehicleId)

        let one = LiveSessionInterpreter.vehicleCheck(for: snapshot, excluding: [VehicleIdentifier(rawValue: "SYN70가0456")])
        XCTAssertEqual(one.stage, .proposed)
    }

    /// A server that does not say how to present the buses gets no suggestion.
    func testASilentServerGetsNoSuggestion() throws {
        let json = #"""
        {"id":"syn","routeId":"SYN","cityCode":"39","boardingStop":{"stopId":"S4","name":"넷","sequence":4},"destinationStop":{"stopId":"S9","name":"아홉","sequence":9},"state":"confirmation_required","candidates":[{"vehicleId":"SYN70가0412","stopOffset":-2,"zone":"approaching","rejectedReasons":[]}]}
        """#
        let silent = try JSONDecoder().decode(JourneySessionSnapshot.self, from: Data(json.utf8))
        XCTAssertFalse(LiveSessionInterpreter.allowsMatcherSuggestion(silent))
        XCTAssertEqual(LiveSessionInterpreter.vehicleCheck(for: silent).stage, .choose)

        let unknown = json.replacingOccurrences(of: #""state""#, with: #""vehicleChoice":{"presentation":"something_new","vehicles":[]},"state""#)
        let future = try JSONDecoder().decode(JourneySessionSnapshot.self, from: Data(unknown.utf8))
        XCTAssertFalse(LiveSessionInterpreter.allowsMatcherSuggestion(future))
        XCTAssertEqual(LiveSessionInterpreter.vehicleCheck(for: future).stage, .notFoundYet)
    }

    func testAConfirmedSessionIsConfirmed() throws {
        let check = LiveSessionInterpreter.vehicleCheck(for: try XCTUnwrap(scenarios()["confirmed-tracking"]))
        XCTAssertEqual(check.stage, .confirmed)
        XCTAssertEqual(check.proposals.map(\.maskedPlate), ["••0412"])
    }

    func testRideMomentsFollowTheServer() throws {
        let views = try scenarios()
        let expected: [String: RideMoment] = [
            "confirmed-tracking": .riding,
            "tracking-riding": .riding,
            "tracking-riding-later": .riding,
            "tracking-prepare": .prepare,
            "tracking-next-stop": .nextStop,
            "arrived": .arrived,
            "passed-destination": .passedDestination,
            "degraded-provider-timeout": .delayed,
            "degraded-missing": .delayed,
            "lost": .vehicleLost,
            "confirmed-cadence-unknown": .checking,
            "awaiting-departed-only": .checking,
            "confirmation-one": .checking,
        ]
        for (id, moment) in expected {
            XCTAssertEqual(self.moment(views[id]), moment, id)
        }
        let riding = try XCTUnwrap(views["tracking-riding"])
        XCTAssertEqual(LiveSessionInterpreter.rideSignal(for: riding).remainingStops, 5)
        XCTAssertEqual(LiveSessionInterpreter.currentStopSequence(for: riding), 5)
    }

    /// The server's Live Activity push port (`liveActivityContent.ts`) computed these from the
    /// same payloads; a push must say exactly what the app would show.
    func testServerPushSignalsAgreeWithTheApp() throws {
        struct Entry: Decodable {
            let id: String
            let signal: RideSignal
            let moment: RideMoment
            let milestone: RideMilestone?
        }
        struct File: Decodable { let signals: [Entry] }
        let repository = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let url = repository.appendingPathComponent("fixtures/journey/live-activity-signals-v1.json")
        let entries = try JSONDecoder().decode(File.self, from: Data(contentsOf: url)).signals
        let views = try scenarios()
        XCTAssertEqual(Set(entries.map(\.id)), Set(views.keys))
        for entry in entries {
            let view = try XCTUnwrap(views[entry.id])
            let signal = LiveSessionInterpreter.rideSignal(for: view)
            XCTAssertEqual(signal, entry.signal, entry.id)
            let guidance = RideGuidancePolicy.guidance(for: signal)
            XCTAssertEqual(guidance.moment, entry.moment, entry.id)
            XCTAssertEqual(guidance.milestone, entry.milestone, entry.id)
        }
    }

    /// Late, missing or unconfirmed data never produces a get-off alert.
    func testNoMilestoneWithoutFreshServerProgress() throws {
        for (id, view) in try scenarios() {
            let guidance = RideGuidancePolicy.guidance(for: LiveSessionInterpreter.rideSignal(for: view))
            if view.sessionState != .tracking && view.sessionState != .arrived {
                XCTAssertNil(guidance.milestone, id)
            }
            let offline = RideGuidancePolicy.guidance(for: LiveSessionInterpreter.rideSignal(for: view, isOffline: true))
            XCTAssertNil(offline.milestone, "\(id) offline")
        }
        XCTAssertEqual(moment(try scenarios()["tracking-next-stop"], offline: true), .offline)
    }

    func testFailureClassificationPrefersTheServerCode() {
        XCTAssertEqual(TransitAPIFailure.classify(status: 503, code: "SESSIONS_UNAVAILABLE"), .sessionsUnavailable)
        XCTAssertEqual(TransitAPIFailure.classify(status: 503, code: "SESSION_STORE_UNAVAILABLE"), .sessionsUnavailable)
        XCTAssertEqual(TransitAPIFailure.classify(status: 503, code: "BLOCKED_BY_CREDENTIALS"), .serviceUnavailable)
        XCTAssertEqual(TransitAPIFailure.classify(status: 504, code: "PROVIDER_TIMEOUT"), .providerTimeout)
        XCTAssertEqual(TransitAPIFailure.classify(status: 502, code: "PROVIDER_UNAVAILABLE"), .providerUnavailable)
        XCTAssertEqual(TransitAPIFailure.classify(status: 502, code: "PROVIDER_RESPONSE_INVALID"), .providerInvalid)
        XCTAssertEqual(TransitAPIFailure.classify(status: 404, code: "SESSION_NOT_FOUND"), .sessionNotFound)
        XCTAssertEqual(TransitAPIFailure.classify(status: 410, code: "SESSION_EXPIRED"), .sessionExpired)
        XCTAssertEqual(TransitAPIFailure.classify(status: 429, code: "RATE_LIMITED"), .rateLimited)
        XCTAssertEqual(TransitAPIFailure.classify(status: 400, code: "INVALID_INPUT"), .rejected)
        XCTAssertEqual(TransitAPIFailure.classify(status: 500, code: "INTERNAL_ERROR"), .server)
        XCTAssertEqual(TransitAPIFailure.classify(status: 504, code: nil), .providerTimeout)
        XCTAssertEqual(TransitAPIFailure.classify(status: 502, code: nil), .server)
        XCTAssertEqual(TransitAPIFailure.classify(URLError(.notConnectedToInternet)), .offline)
        XCTAssertEqual(TransitAPIFailure.classify(URLError(.timedOut)), .timedOut)
        XCTAssertEqual(Set(TransitAPIFailure.allCases.map(\.copyKey)).count, TransitAPIFailure.allCases.count)
        XCTAssertFalse(TransitAPIFailure.sessionsUnavailable.isTransient)
        XCTAssertTrue(TransitAPIFailure.providerTimeout.isTransient)
    }

    func testLiveRouteKeepsProviderOrderAndFlagsMissingCoordinates() {
        let api = TransitAPIRoute(routeId: "SYN-R", routeNumber: "202", startStopName: "출발", endStopName: "종점")
        let surveyed = TransitRoute.live(api, stops: [
            TransitAPIStop(stopId: "B", name: "둘", sequence: 2, latitude: 33.4, longitude: 126.3),
            TransitAPIStop(stopId: "A", name: "하나", sequence: 1, latitude: 33.39, longitude: 126.29),
        ])
        XCTAssertTrue(surveyed.coordinatesAreSurveyed)
        XCTAssertEqual(surveyed.route.stops.map(\.stop.name), ["하나", "둘"])
        XCTAssertEqual(surveyed.route.routeStop(sequence: 2)?.stop.id, "B")
        XCTAssertEqual(surveyed.route.destinationName, "종점")

        let unsurveyed = TransitRoute.live(api, stops: [TransitAPIStop(stopId: "A", name: "하나", sequence: 1)])
        XCTAssertFalse(unsurveyed.coordinatesAreSurveyed)
    }
}
