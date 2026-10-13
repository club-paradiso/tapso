import XCTest
@testable import TapsoTransit

/// Place or address → nearby catalog stops. Every stop and coordinate here is SYNTHETIC.
final class NearbyStopsTests: XCTestCase {
    /// Poles 111 m apart (0.001° of latitude) along one meridian, a two-pole place, and one pole with no coordinate.
    private func index() -> DestinationSearchIndex {
        let stops: [JejuTransitCatalog.Stop] = [
            .init(id: "SYN-0", name: "합성기점", lat: 33.500, lng: 126.500),
            .init(id: "SYN-1", name: "합성시청[동]", lat: 33.501, lng: 126.500),
            .init(id: "SYN-2", name: "합성시청[서]", lat: 33.5012, lng: 126.5002),
            .init(id: "SYN-3", name: "합성시장", lat: 33.503, lng: 126.500),
            .init(id: "SYN-4", name: "합성먼곳", lat: 33.540, lng: 126.500),
            .init(id: "SYN-5", name: "합성좌표없음"),
        ]
        let catalog = JejuTransitCatalog(
            catalogVersion: "0123456789abcdef",
            generatedAt: "2026-10-13T00:00:00.000Z",
            stops: stops,
            routes: [
                .init(routeId: "SYNA", routeNo: "300", stops: [0, 1, 3, 4, 5]),
                .init(routeId: "SYNB", routeNo: "300", stops: [4, 3, 2, 0]),
                .init(routeId: "SYNC", routeNo: "301", stops: [0, 3]),
            ]
        )
        return DestinationSearchIndex(catalog: catalog)
    }

    func testNearestFirstWithinRadiusAndOnlyCatalogPlaces() {
        let nearby = index().places(nearLatitude: 33.5011, longitude: 126.500)
        XCTAssertEqual(nearby.map(\.place.name), ["합성시청", "합성기점", "합성시장"])
        XCTAssertFalse(nearby.contains { $0.place.name == "합성먼곳" }, "4 km away is not near")
        XCTAssertFalse(nearby.contains { $0.place.name == "합성좌표없음" }, "a stop without a coordinate is never placed")
    }

    func testTwoPolesCountOnceAtTheNearerPole() {
        let nearby = index().places(nearLatitude: 33.5012, longitude: 126.5002)
        let city = nearby.first { $0.place.name == "합성시청" }
        XCTAssertEqual(city?.distanceMeters, 0)
        XCTAssertEqual(nearby.filter { $0.place.name == "합성시청" }.count, 1)
    }

    func testDistanceAndWalkEstimate() {
        let meters = NearbyStops.distanceMeters(33.500, 126.500, 33.501, 126.500)
        XCTAssertEqual(meters, 111.2, accuracy: 0.5)
        XCTAssertEqual(NearbyStops.walkMinutes(forStraightLine: 0), 1)
        XCTAssertEqual(NearbyStops.walkMinutes(forStraightLine: 111), 2, "111 m × 1.3 ÷ 75 m/min, rounded up")
        XCTAssertEqual(NearbyStops.walkMinutes(forStraightLine: 800), 14)
    }

    func testOutsideJejuFindsNothing() {
        XCTAssertTrue(index().places(nearLatitude: 37.5665, longitude: 126.9780).isEmpty, "Seoul City Hall")
        XCTAssertTrue(NearbyStops.isInJeju(latitude: 33.4996, longitude: 126.5312), "Jeju City")
        XCTAssertTrue(NearbyStops.isInJeju(latitude: 33.1180, longitude: 126.2670), "Marado")
        XCTAssertFalse(NearbyStops.isInJeju(latitude: 34.80, longitude: 126.39), "Mokpo")
    }

    func testRadiusAndLimit() {
        let index = index()
        XCTAssertEqual(index.places(nearLatitude: 33.500, longitude: 126.500, radiusMeters: 50).map(\.place.name), ["합성기점"])
        XCTAssertEqual(index.places(nearLatitude: 33.500, longitude: 126.500, limit: 1).count, 1)
        XCTAssertTrue(index.places(nearLatitude: 33.500, longitude: 126.500, radiusMeters: 0).isEmpty)
    }
}
