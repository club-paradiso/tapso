import XCTest
@testable import TapsoTransit

/// Home's recent destinations and same-number trips. All SYNTHETIC.
final class RecentsAndViaTests: XCTestCase {
    func testTwoPolesOfOnePlaceAreOneRecentDestinationWithoutTheMarker() {
        var library = JourneyLibrary()
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        for (offset, pole) in ["합성마을[동]", "합성마을[서]", "색달동[야크마을]"].enumerated() {
            library.recordRide(SavedJourney(
                routeID: RouteID(rawValue: "SYN-\(offset)"), routeNumber: "360", headsign: "합성종점",
                boardingStopID: StopID(rawValue: "SYN-B\(offset)"), boardingStopName: "합성출발",
                destinationStopID: StopID(rawValue: "SYN-D\(offset)"), destinationStopName: pole,
                lastRiddenAt: base.addingTimeInterval(Double(offset))
            ), at: base.addingTimeInterval(Double(offset)))
        }
        XCTAssertEqual(library.recentDestinationNames, ["색달동[야크마을]", "합성마을"], "a non-compass bracket is part of the name")
    }

    func testSameNumberVariantsWithDifferentStopsNameAStopOfTheirOwn() throws {
        let names = ["합성탑승", "합성하차", "합성공항", "합성경유A", "합성경유B"]
        let stops = names.enumerated().map { JejuTransitCatalog.Stop(id: "SYN-\($0.offset)", name: $0.element, lat: 33.4 + Double($0.offset) / 1000, lng: 126.5) }
        let catalog = JejuTransitCatalog(catalogVersion: "0123456789abcdef", generatedAt: "2026-10-13T00:00:00.000Z", stops: stops, routes: [
            .init(routeId: "SYN111A", routeNo: "111", end: "합성공항", stops: [3, 0, 1, 2]),
            .init(routeId: "SYN111B", routeNo: "111", end: "합성공항", stops: [4, 0, 1, 2]),
            // Real shape (111, 2026-10-03): one variant is the other minus a stop.
            .init(routeId: "SYN111C", routeNo: "111", end: "합성공항", stops: [3, 4, 0, 1, 2]),
            .init(routeId: "SYN132", routeNo: "132", end: "합성공항", stops: [0, 1, 2]),
        ])
        let index = DestinationSearchIndex(catalog: catalog)
        let destination = try XCTUnwrap(index.places.first { $0.name == "합성하차" })
        let boarding = try XCTUnwrap(index.boardingPlaces(toward: destination).first { $0.name == "합성탑승" })
        let trips = index.trips(from: boarding, to: destination)
        let pair = trips.filter { $0.route.routeId != "SYN111C" }
        let via = Dictionary(uniqueKeysWithValues: pair.map { ($0.route.routeId, index.tripDistinction($0, among: pair)) })
        XCTAssertEqual(via["SYN111A"], .via("합성경유A"))
        XCTAssertEqual(via["SYN111B"], .via("합성경유B"))
        XCTAssertEqual(via["SYN132"], .some(nil), "alone under its number: nothing to tell apart")

        let subset = trips.filter { $0.route.routeId != "SYN111B" }
        let a = try XCTUnwrap(subset.first { $0.route.routeId == "SYN111A" })
        let c = try XCTUnwrap(subset.first { $0.route.routeId == "SYN111C" })
        XCTAssertEqual(index.tripDistinction(c, among: subset), .via("합성경유B"))
        XCTAssertEqual(index.tripDistinction(a, among: subset), .skips("합성경유B"), "no stop of its own: name the one it skips")
    }

    func testEveryLabelSeparatesFromEverySiblingOrFallsBackToAnOrdinal() throws {
        // Review case: {base}, {base,X}, {base,Y}, {base,X,Y}.
        let names = ["합성탑승", "합성하차", "합성공항", "합성X", "합성Y"]
        let stops = names.enumerated().map { JejuTransitCatalog.Stop(id: "SYN-\($0.offset)", name: $0.element, lat: 33.4 + Double($0.offset) / 1000, lng: 126.5) }
        let catalog = JejuTransitCatalog(catalogVersion: "0123456789abcdef", generatedAt: "2026-10-13T00:00:00.000Z", stops: stops, routes: [
            .init(routeId: "SYN1", routeNo: "111", end: "합성공항", stops: [0, 1, 2]),
            .init(routeId: "SYN2", routeNo: "111", end: "합성공항", stops: [3, 0, 1, 2]),
            .init(routeId: "SYN3", routeNo: "111", end: "합성공항", stops: [4, 0, 1, 2]),
            .init(routeId: "SYN4", routeNo: "111", end: "합성공항", stops: [3, 4, 0, 1, 2]),
        ])
        let index = DestinationSearchIndex(catalog: catalog)
        let destination = try XCTUnwrap(index.places.first { $0.name == "합성하차" })
        let boarding = try XCTUnwrap(index.boardingPlaces(toward: destination).first { $0.name == "합성탑승" })
        let trips = index.trips(from: boarding, to: destination)
        XCTAssertEqual(trips.count, 4)
        let labels = trips.map { index.tripDistinction($0, among: trips) }
        XCTAssertTrue(labels.allSatisfy { $0 != nil })
        XCTAssertEqual(Set(labels.compactMap { $0 }).count, 4, "no two trips share a label")
        let byID = Dictionary(uniqueKeysWithValues: zip(trips.map(\.route.routeId), labels))
        XCTAssertEqual(byID["SYN1"], .ordinal(1, of: 4), "skips X and Y, but neither is served by every sibling")
    }
}
