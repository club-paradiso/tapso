import Foundation
import XCTest
@testable import TapsoTransit

final class LiveSetupTests: XCTestCase {
    private let stops = (1...10).map { LiveStop(stopId: "SYN-\($0)", name: $0 == 9 ? "제주시청(아라방면)" : "정류장 \($0)", sequence: $0) }

    func testRouteNumberAcceptsOnlyWhatCanBeOne() {
        XCTAssertEqual(LiveSetup.routeNumber(" 3 65 "), "365")
        XCTAssertEqual(LiveSetup.routeNumber("281-1"), "281-1")
        XCTAssertNil(LiveSetup.routeNumber(""))
        XCTAssertNil(LiveSetup.routeNumber("365&cityCode=1"))
        XCTAssertNil(LiveSetup.routeNumber("../v1"))
        XCTAssertNil(LiveSetup.routeNumber(String(repeating: "1", count: 13)))
    }

    func testExactRouteNumbersComeFirstAndNothingIsDropped() {
        let routes = [
            LiveRoute(routeId: "A", routeNumber: "3650"),
            LiveRoute(routeId: "B", routeNumber: "365"),
            LiveRoute(routeId: "C", routeNumber: "365"),
        ]
        XCTAssertEqual(LiveSetup.directions(routes, for: "365").map(\.routeId), ["B", "C", "A"])
    }

    func testDestinationsAndBoardingStopsFollowRouteOrder() {
        let shuffled = stops.reversed() as [LiveStop]
        XCTAssertEqual(LiveSetup.destinations(shuffled).map(\.sequence), Array(2...10))
        XCTAssertEqual(LiveSetup.boardingStops(shuffled, destination: stops[8]).map(\.sequence), Array(1...8))
        XCTAssertTrue(LiveSetup.boardingStops(stops, destination: stops[0]).isEmpty)
        XCTAssertEqual(LiveSetup.upcomingNames(shuffled, after: 7, through: 9), ["정류장 8", "제주시청(아라방면)"])
    }

    func testFilterIgnoresSpacesCaseAndPunctuation() {
        XCTAssertEqual(LiveSetup.filter(stops, query: "시청 아라").map(\.sequence), [9])
        XCTAssertEqual(LiveSetup.filter(stops, query: "  ").count, stops.count)
    }

    func testConfiguredEnvironmentFallsBackToProduction() {
        XCTAssertEqual(LiveEnvironment.configured(nil), .production)
        XCTAssertEqual(LiveEnvironment.configured(""), .production)
        XCTAssertEqual(LiveEnvironment.configured("http://example.com"), .production, "plain http only for the local server")
        XCTAssertEqual(LiveEnvironment.configured("https://staging.example.com").baseURL.host, "staging.example.com")
        XCTAssertEqual(LiveEnvironment.configured("http://127.0.0.1:8787").baseURL.port, 8787)
    }

    func testResumedRideKeepsItsSignalledMilestones() throws {
        let session = LiveSession(
            id: "s", routeId: "R", cityCode: "39",
            boardingStop: stops[0], destinationStop: stops[8],
            selectedVehicleId: "제주70자0001", selectionMode: "rider_confirmed", state: .tracking,
            progress: LiveProgress(currentStopSequence: 7, remainingStops: 2, phase: .approaching, source: "provider_stop_sequence"),
            sourceFreshness: ["제주70자0001": LiveCadence(state: "fresh")]
        )
        let now = Date(timeIntervalSince1970: 0)
        var ride = LiveRide(session: session, at: now)
        ride.markAlerted([.prepare])
        XCTAssertNil(ride.takeMilestone(now: now, isOffline: false))
    }
}
