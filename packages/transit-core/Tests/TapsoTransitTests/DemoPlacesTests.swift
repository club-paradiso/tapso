import XCTest
@testable import TapsoTransit

/// The demo's place lookup. All SYNTHETIC: demo places sit beside demo stops.
final class DemoPlacesTests: XCTestCase {
    func testSearchMatchesNameOrAddressAndNeedsTwoCharacters() {
        XCTAssertEqual(DemoCatalog.searchPlaces("동문").map(\.name), ["동문시장"])
        XCTAssertEqual(DemoCatalog.searchPlaces("중앙로").map(\.name), ["제주시 중앙로 14"])
        XCTAssertEqual(DemoCatalog.searchPlaces("관덕로").map(\.name), ["목관아"], "address matches too")
        XCTAssertTrue(DemoCatalog.searchPlaces("동").isEmpty)
        XCTAssertTrue(DemoCatalog.searchPlaces("서울").isEmpty)
    }

    func testEveryNearbyResultIsADemoDestinationNearestFirst() throws {
        let market = try XCTUnwrap(DemoCatalog.places.first { $0.name == "동문시장" })
        let nearby = DemoCatalog.nearbyDestinations(latitude: market.latitude, longitude: market.longitude)
        XCTAssertEqual(nearby.first?.name, "동문로터리")
        XCTAssertEqual(nearby.map(\.distanceMeters), nearby.map(\.distanceMeters).sorted())
        XCTAssertTrue(nearby.allSatisfy { DemoCatalog.destinationNames.contains($0.name) })
        XCTAssertTrue(nearby.allSatisfy { !DemoCatalog.routeOptions(toDestinationNamed: $0.name).isEmpty })
    }

    func testEveryPlaceButTheFarOneHasAStopInWalkingDistance() {
        for place in DemoCatalog.places {
            let nearby = DemoCatalog.nearbyDestinations(latitude: place.latitude, longitude: place.longitude)
            if place.name == "합성오름" {
                XCTAssertTrue(nearby.isEmpty)
                XCTAssertTrue(DemoCatalog.nearbyDestinations(latitude: place.latitude, longitude: place.longitude, radiusMeters: 2000).isEmpty)
            } else {
                XCTAssertFalse(nearby.isEmpty, place.name)
            }
        }
    }
}
