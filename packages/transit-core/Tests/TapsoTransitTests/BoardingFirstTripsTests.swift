import XCTest
@testable import TapsoTransit

/// Boarding-first setup: "어디서 타요?" then only the buses from there.
/// Every route, stop and coordinate is SYNTHETIC.
final class BoardingFirstTripsTests: XCTestCase {
    private func index() -> DestinationSearchIndex {
        let names = ["합성터미널", "합성시청[동]", "합성시청[서]", "합성대학교", "합성공항", "합성마을", "합성오일장", "합성기점"]
        let stops = names.enumerated().map { i, name in
            JejuTransitCatalog.Stop(id: "SYN-\(i)", name: name, lat: 33.4 + Double(i) / 100, lng: 126.5)
        }
        return DestinationSearchIndex(catalog: JejuTransitCatalog(
            catalogVersion: "0123456789abcdef",
            generatedAt: "2026-10-06T00:00:00.000Z",
            stops: stops,
            routes: [
                .init(routeId: "SYN202A", routeNo: "202", start: "합성터미널", end: "합성대학교", stops: [0, 1, 3]),
                .init(routeId: "SYN202B", routeNo: "202", start: "합성대학교", end: "합성터미널", stops: [3, 2, 0]),
                .init(routeId: "SYN2021", routeNo: "202-1", start: "합성터미널", end: "합성대학교", stops: [0, 4, 5, 3]),
                // A loop that passes 합성오일장 twice.
                .init(routeId: "SYN440", routeNo: "440", topology: "repeating", stops: [7, 6, 5, 6, 3], sequences: [3, 4, 5, 6, 7]),
            ]
        ))
    }

    private func place(_ name: String, in index: DestinationSearchIndex) throws -> DestinationPlace {
        try XCTUnwrap(index.places.first { $0.name == name })
    }

    func testBoardingPlacesAreTheStopsBeforeTheDestination() throws {
        let index = index()
        let names = index.boardingPlaces(toward: try place("합성대학교", in: index)).map(\.name)
        // 202A: 터미널, 시청. 202-1: 터미널, 공항, 마을. 440: 기점, 오일장, 마을. Never 대학교 itself.
        XCTAssertEqual(names, ["합성공항", "합성기점", "합성마을", "합성시청", "합성오일장", "합성터미널"])
    }

    func testTripsAreOnlyTheBusesFromHereToThereShortestFirst() throws {
        let index = index()
        let university = try place("합성대학교", in: index)
        let places = index.boardingPlaces(toward: university)
        let terminal = try XCTUnwrap(places.first { $0.name == "합성터미널" })
        let trips = index.trips(from: terminal, to: university)
        XCTAssertEqual(trips.map(\.route.routeNo), ["202", "202-1"])
        XCTAssertEqual(trips.map(\.stopCount), [2, 3])
        XCTAssertEqual(trips.first?.boardingStopID, "SYN-0")
        XCTAssertEqual(trips.first?.destinationStopID, "SYN-3")
    }

    func testALoopUsesTheShortestRideAndItsProviderSequences() throws {
        let index = index()
        let university = try place("합성대학교", in: index)
        let market = try XCTUnwrap(index.boardingPlaces(toward: university).first { $0.name == "합성오일장" })
        let trip = try XCTUnwrap(index.trips(from: market, to: university).first)
        XCTAssertEqual(trip.route.routeId, "SYN440")
        XCTAssertEqual(trip.boardingPosition, 3)
        XCTAssertEqual(trip.boardingSequence, 6)
        XCTAssertEqual(trip.destinationSequence, 7)
        XCTAssertEqual(trip.stopCount, 1)
    }

    func testNearestAndTypedSearch() throws {
        let index = index()
        let places = index.boardingPlaces(toward: try place("합성대학교", in: index))
        // 합성공항 is stop 4 at 33.44.
        XCTAssertEqual(DestinationSearchIndex.nearest(places, latitude: 33.44, longitude: 126.5, limit: 2).first?.name, "합성공항")
        XCTAssertEqual(DestinationSearchIndex.filter(places, query: "오일").map(\.name), ["합성오일장"])
        XCTAssertEqual(DestinationSearchIndex.filter(places, query: "ㅎㅅㄱㅎ").map(\.name), ["합성공항"])
        XCTAssertTrue(DestinationSearchIndex.filter(places, query: " ").isEmpty)
    }
}
