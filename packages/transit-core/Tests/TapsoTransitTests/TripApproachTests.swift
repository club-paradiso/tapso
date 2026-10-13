import XCTest
@testable import TapsoTransit

/// Ranking buses across route variants by distance along their own route.
/// Every route, stop and coordinate here is SYNTHETIC: one variant with stops
/// about 4 km apart (like an airport-bound route) and one with stops about
/// 0.5 km apart (like a city trunk route), both to the same two places.
final class TripApproachTests: XCTestCase {
    private func index(missingCoordinate: Bool = false) -> DestinationSearchIndex {
        var stops: [JejuTransitCatalog.Stop] = [
            .init(id: "SYN-B", name: "합성탑승", lat: 33.40, lng: 126.50),
            .init(id: "SYN-D", name: "합성하차", lat: 33.39, lng: 126.50),
        ]
        // Sparse: 3 stops before boarding, 0.036° (~4 km) apart, south of it.
        for k in 1...3 { stops.append(.init(id: "SYN-S\(k)", name: "합성원거리\(k)", lat: 33.40 - 0.036 * Double(k), lng: 126.52)) }
        // Dense: 7 stops before boarding, 0.0045° (~0.5 km) apart, north of it.
        for k in 1...7 {
            let blank = missingCoordinate && k == 3
            stops.append(.init(id: "SYN-N\(k)", name: "합성근거리\(k)", lat: blank ? nil : 33.40 + 0.0045 * Double(k), lng: blank ? nil : 126.50))
        }
        // Indexes: S1..S3 = 2...4, N1..N7 = 5...11.
        let sparse = JejuTransitCatalog.Route(routeId: "SYN111", routeNo: "111", stops: [4, 3, 2, 0, 1], sequences: [10, 11, 12, 13, 14])
        let dense = JejuTransitCatalog.Route(routeId: "SYN212", routeNo: "212", stops: [11, 10, 9, 8, 7, 6, 5, 0, 1])
        let denseTwin = JejuTransitCatalog.Route(routeId: "SYN212B", routeNo: "212", stops: [11, 10, 9, 8, 7, 6, 5, 0, 1])
        return DestinationSearchIndex(catalog: JejuTransitCatalog(
            catalogVersion: "0123456789abcdef", generatedAt: "2026-10-13T00:00:00.000Z", stops: stops,
            routes: [sparse, dense, denseTwin]
        ))
    }

    private func trips(_ index: DestinationSearchIndex) throws -> [TripOption] {
        let destination = try XCTUnwrap(index.places.first { $0.name == "합성하차" })
        let boarding = try XCTUnwrap(index.boardingPlaces(toward: destination).first { $0.name == "합성탑승" })
        return index.trips(from: boarding, to: destination)
    }

    func testFewerStopsIsNotNearerAcrossRoutes() throws {
        let index = index()
        let all = try trips(index)
        let sparse = try XCTUnwrap(all.first { $0.route.routeId == "SYN111" })
        let dense = try XCTUnwrap(all.first { $0.route.routeId == "SYN212" })
        // Sparse bus at its first stop (sequence 10): 3 stops, ~12 km. Dense bus 6 stops out: ~3 km.
        let far = try XCTUnwrap(index.approach(of: sparse, vehicleSequences: [10]))
        let near = try XCTUnwrap(index.approach(of: dense, vehicleSequences: [2]))
        XCTAssertEqual(far.stopsAway, 3)
        XCTAssertEqual(near.stopsAway, 6)
        XCTAssertEqual(Double(try XCTUnwrap(far.metersAway)), 12_420, accuracy: 300)
        XCTAssertEqual(Double(try XCTUnwrap(near.metersAway)), 3_002, accuracy: 100)
        let ranked = TripApproach.nearestFirst(all, approaches: [sparse.id: far, dense.id: near])
        XCTAssertEqual(ranked.first?.route.routeId, "SYN212", "6 stops on the dense route beats 3 on the sparse one")
        XCTAssertEqual(ranked.last?.route.routeId, "SYN212B", "a variant with no approaching bus goes last")
    }

    func testPassedUnknownAndFarBusesAreIgnoredAndTheNearestOfSeveralWins() throws {
        let index = index()
        let dense = try XCTUnwrap(try trips(index).first { $0.route.routeId == "SYN212" })
        XCTAssertNil(index.approach(of: dense, vehicleSequences: [9, nil, 99]), "9 is past the boarding stop (8); 99 is not on the variant")
        XCTAssertEqual(index.approach(of: dense, vehicleSequences: [1, 6, nil])?.stopsAway, 2)
        XCTAssertNil(index.approach(of: dense, vehicleSequences: [1], horizonStops: 5), "7 stops out is beyond the horizon")
        XCTAssertEqual(index.approach(of: dense, vehicleSequences: [8])?.metersAway, 0, "at the stop")
    }

    func testAMissingCoordinateFallsBackToStopsNeverToAGuess() throws {
        let index = index(missingCoordinate: true)
        let all = try trips(index)
        let sparse = try XCTUnwrap(all.first { $0.route.routeId == "SYN111" })
        let dense = try XCTUnwrap(all.first { $0.route.routeId == "SYN212" })
        let near = try XCTUnwrap(index.approach(of: dense, vehicleSequences: [2]))
        XCTAssertNil(near.metersAway, "the path crosses the stop with no coordinate")
        XCTAssertEqual(index.approach(of: dense, vehicleSequences: [6])?.metersAway.map { $0 > 0 }, true, "a path that avoids it still has a distance")
        let far = try XCTUnwrap(index.approach(of: sparse, vehicleSequences: [10]))
        XCTAssertEqual(TripApproach.nearestFirst(all, approaches: [sparse.id: far, dense.id: near]).first?.route.routeId, "SYN111", "without a distance, fewer stops decides")
    }

    func testRankingIsATotalOrderWhenSomeDistancesAreMissing() throws {
        // Three variants; one distance unknown. Pairwise mixing would cycle; one rule must hold.
        let all = try trips(index())
        XCTAssertEqual(all.count, 3)
        let approaches = [
            all[0].id: TripApproach(stopsAway: 1, metersAway: 10_000),
            all[1].id: TripApproach(stopsAway: 2, metersAway: nil),
            all[2].id: TripApproach(stopsAway: 3, metersAway: 1_000),
        ]
        let expected = [all[0].id, all[1].id, all[2].id]
        for order in [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1]] {
            let ranked = TripApproach.nearestFirst(order.map { all[$0] }, approaches: approaches)
            XCTAssertEqual(ranked.map(\.id), expected, "by stops for all, whatever the input order")
        }
        let allKnown = [all[0].id: TripApproach(stopsAway: 1, metersAway: 10_000), all[2].id: TripApproach(stopsAway: 3, metersAway: 1_000)]
        XCTAssertEqual(TripApproach.nearestFirst(all, approaches: allKnown).first?.id, all[2].id, "with every distance known, distance decides")
    }

    func testCheckOrderGivesEveryRouteNumberATurnFirst() throws {
        let all = try trips(index())
        let order = DestinationSearchIndex.arrivalCheckOrder(all, budget: 2)
        XCTAssertEqual(Set(order.map(\.route.routeNo)), ["111", "212"], "one per number before a second 212")
        XCTAssertEqual(DestinationSearchIndex.arrivalCheckOrder(all, budget: 10).count, 3)
        XCTAssertTrue(DestinationSearchIndex.arrivalCheckOrder(all, budget: 0).isEmpty)
    }
}
