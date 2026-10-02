import Foundation
import TapsoTransit
import XCTest

/// Where to get off for a shared place, and the walk handed back to a map app.
/// Every route and place below is SYNTHETIC: stops on a straight north–south
/// line in Hallim, 0.002° (≈222 m) apart, named for the test only.
final class HandoffDestinationTests: XCTestCase {
    private func stop(_ sequence: Int, _ name: String, latitude: Double) -> RouteStop {
        RouteStop(
            stop: Stop(id: StopID(rawValue: "SYN\(sequence)"), name: name, coordinate: Coordinate(latitude: latitude, longitude: 126.2400)),
            sequence: sequence
        )
    }

    private var line: [RouteStop] {
        (0...5).map { stop($0, "합성정류장\($0)", latitude: 33.4000 + Double($0) * 0.002) }
    }

    private let nearSecond = SharedPlace(source: .kakaoMap, name: "합성 카페", coordinate: Coordinate(latitude: 33.4045, longitude: 126.2400))

    func testRealCoordinatesSuggestTheNearestStopsWithStraightLineMetres() {
        let match = HandoffStopSuggester.match(for: nearSecond, among: line, coordinatesAreSurveyed: true)
        guard case let .nearby(suggestions) = match else { return XCTFail("expected nearby, got \(match)") }
        XCTAssertEqual(suggestions.map(\.routeStop.sequence), [2, 3, 1])
        XCTAssertEqual(suggestions.map(\.straightLineMeters), [60, 170, 280])
    }

    func testALoopSuggestsAStopOnceAtItsFirstVisit() {
        let loop = line + [RouteStop(stop: line[2].stop, sequence: 6)]
        let suggestions = HandoffStopSuggester.match(for: nearSecond, among: loop, coordinatesAreSurveyed: true).suggestions
        XCTAssertEqual(suggestions.map(\.routeStop.sequence), [2, 3, 1])
    }

    func testARouteThatPassesNowhereNearGetsNoSuggestionNotAFarNameMatch() {
        let seogwipo = SharedPlace(source: .naverMap, name: "합성정류장3", coordinate: Coordinate(latitude: 33.2500, longitude: 126.5600))
        XCTAssertEqual(HandoffStopSuggester.match(for: seogwipo, among: line, coordinatesAreSurveyed: true), .nearby([]))
    }

    func testSyntheticCoordinatesFallBackToWholeStopNamesInThePlaceName() {
        let stops = [
            stop(1, "협재", latitude: 33.40),
            stop(4, "협재해수욕장", latitude: 33.41),
            stop(5, "금능", latitude: 33.42),
        ]
        let place = SharedPlace(source: .kakaoMap, name: "협재해수욕장", coordinate: Coordinate(latitude: 33.394, longitude: 126.2397))
        let match = HandoffStopSuggester.match(for: place, among: stops, coordinatesAreSurveyed: false)
        guard case let .byName(suggestions) = match else { return XCTFail("expected byName, got \(match)") }
        XCTAssertEqual(suggestions.map(\.routeStop.stop.name), ["협재해수욕장", "협재"])
        XCTAssertEqual(suggestions.map(\.straightLineMeters), [nil, nil], "no distance without real coordinates")
    }

    func testAnAddressIsNeverMatchedWordByWord() {
        let stops = [stop(1, "한림", latitude: 33.40), stop(2, "협재리", latitude: 33.41)]
        let place = SharedPlace(source: .naverMap, address: "제주특별자치도 제주시 한림읍 협재리 2497-1")
        XCTAssertEqual(HandoffStopSuggester.match(for: place, among: stops, coordinatesAreSurveyed: true), .byName([]))
    }

    func testAPlaceOutsideJejuGetsNothing() {
        let seoul = SharedPlace(source: .appleMaps, name: "합성정류장2", coordinate: Coordinate(latitude: 37.5665, longitude: 126.9780))
        XCTAssertEqual(HandoffStopSuggester.match(for: seoul, among: line, coordinatesAreSurveyed: true), .outsideJeju)
        XCTAssertNil(MapHandoff.walkingRequest(to: seoul, in: .naverMap))
        XCTAssertNil(MapHandoff.walkingRequest(to: seoul, in: .kakaoMap))
    }

    func testTheHandoffCreatesAValidJourneyWithAnUnmeasuredLastMile() {
        let segments = HandoffJourney.segments(routeNumber: "202", boardSequence: 3, alightSequence: 9, place: nearSecond)
        XCTAssertEqual(segments.map(\.kind), [.ride, .walk])
        XCTAssertNil(segments.last?.meters, "a straight line is not a walking distance")
        XCTAssertEqual(JourneyContract.validate(segments), .success(JourneyShape(rideCount: 1, transferCount: 0)))

        XCTAssertEqual(HandoffJourney.segments(routeNumber: "202", boardSequence: 3, alightSequence: 9, place: nil).map(\.kind), [.ride])
        XCTAssertEqual(
            JourneyContract.validate(HandoffJourney.segments(routeNumber: "202", boardSequence: 9, alightSequence: 9, place: nearSecond)),
            .failure(.invalidRideOrder)
        )
    }

    func testTheWalkGoesToTheSharedPlaceThroughDocumentedSchemes() throws {
        let place = SharedPlace(source: .kakaoMap, name: "협재해수욕장", coordinate: Coordinate(latitude: 33.394, longitude: 126.2397))
        let naver = try XCTUnwrap(URLComponents(string: try XCTUnwrap(MapHandoff.walkingRequest(to: place, in: .naverMap)).urlString))
        XCTAssertEqual(naver.scheme, "nmap")
        XCTAssertEqual(naver.host, "route")
        XCTAssertEqual(naver.path, "/walk")
        XCTAssertEqual(naver.queryItems?.first { $0.name == "dlat" }?.value, "33.394000")
        XCTAssertEqual(naver.queryItems?.first { $0.name == "dlng" }?.value, "126.239700")
        XCTAssertEqual(naver.queryItems?.first { $0.name == "dname" }?.value, "협재해수욕장")
        XCTAssertEqual(naver.queryItems?.first { $0.name == "appname" }?.value, MapHandoff.appName)

        let kakao = try XCTUnwrap(URLComponents(string: try XCTUnwrap(MapHandoff.walkingRequest(to: place, in: .kakaoMap)).urlString))
        XCTAssertEqual(kakao.scheme, "kakaomap")
        XCTAssertEqual(kakao.host, "route")
        XCTAssertEqual(kakao.queryItems?.first { $0.name == "ep" }?.value, "33.394000,126.239700")
        XCTAssertEqual(kakao.queryItems?.first { $0.name == "by" }?.value, "FOOT")
    }

    func testANamedPlaceWithoutCoordinatesIsOnlySearchedAndALinkIsNothing() throws {
        let named = SharedPlace(source: .text, name: "비자림")
        let naver = try XCTUnwrap(MapHandoff.walkingRequest(to: named, in: .naverMap))
        XCTAssertTrue(naver.urlString.hasPrefix("nmap://search?"))
        XCTAssertNil(MapHandoff.walkingRequest(to: named, in: .kakaoMap))

        let link = SharedPlace(source: .kakaoMap, unresolvedLink: "https://kko.to/SynThetic9")
        XCTAssertNil(MapHandoff.walkingRequest(to: link, in: .naverMap))
        XCTAssertNil(MapHandoff.walkingRequest(to: link, in: .kakaoMap))
    }
}
