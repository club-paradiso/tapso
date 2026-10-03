import XCTest
@testable import TapsoTransit

/// Destination search over the canonical catalog. Every route, stop and
/// coordinate here is SYNTHETIC; the shapes are the real ones (branches of one
/// number, both directions, two poles of one name, a loop, a stop visited twice).
final class JejuTransitCatalogTests: XCTestCase {
    private func catalog() -> JejuTransitCatalog {
        let names = [
            "합성터미널", "합성시청[동]", "합성시청[서]", "합성대학교", "합성공항", "합성마을", "합성오일장", "색달동[야크마을]", "합성순환", "합성기점",
        ]
        let stops = names.enumerated().map { index, name in
            JejuTransitCatalog.Stop(id: "SYN-\(index)", name: name, lat: 33.4 + Double(index) / 1000, lng: 126.5)
        }
        return JejuTransitCatalog(
            catalogVersion: "0123456789abcdef",
            generatedAt: "2026-10-03T00:00:00.000Z",
            stops: stops,
            routes: [
                // 202 outbound and inbound: the two poles of 합성시청.
                .init(routeId: "SYN202A", routeNo: "202", start: "합성터미널", end: "합성대학교", stops: [0, 1, 3]),
                .init(routeId: "SYN202B", routeNo: "202", start: "합성대학교", end: "합성터미널", stops: [3, 2, 0]),
                // 202-1 is its own route, and a branch with the same ends as 202A.
                .init(routeId: "SYN2021", routeNo: "202-1", start: "합성터미널", end: "합성대학교", stops: [0, 4, 3]),
                .init(routeId: "SYN2021X", routeNo: "202-1", start: "합성터미널", end: "합성대학교", stops: [0, 5, 3]),
                // A loop that passes 합성오일장 twice, with provider sequences other than 1…n.
                .init(routeId: "SYN440", routeNo: "440", topology: "repeating", stops: [8, 6, 5, 6, 8], sequences: [3, 4, 5, 6, 7]),
                .init(routeId: "SYN1100", routeNo: "1100", start: "합성기점", end: "색달동[야크마을]", stops: [9, 4, 7]),
                // The provider lists one stop list under two route IDs (real: 32 pairs on 2026-10-03, e.g. 202).
                .init(routeId: "SYN510B", routeNo: "510", start: "합성기점", end: "합성마을", stops: [9, 6, 5]),
                .init(routeId: "SYN510A", routeNo: "510", start: "합성기점", end: "합성마을", stops: [9, 6, 5]),
            ]
        )
    }

    func testDecodingChecksWhatTheServerChecked() throws {
        let data = try JSONEncoder().encode(catalog())
        XCTAssertEqual(try JejuTransitCatalog.decode(data).routes.count, 8)
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        raw["schemaVersion"] = "tapso-jeju-catalog-v0"
        XCTAssertThrowsError(try JejuTransitCatalog.decode(JSONSerialization.data(withJSONObject: raw)))
        var routes = try XCTUnwrap(raw["routes"] as? [[String: Any]])
        raw["schemaVersion"] = JejuTransitCatalog.schemaVersion
        routes[0]["stops"] = [0, 99]
        raw["routes"] = routes
        XCTAssertThrowsError(try JejuTransitCatalog.decode(JSONSerialization.data(withJSONObject: raw)))
    }

    func testPlacesGatherTwoPolesButKeepOtherBrackets() {
        let index = DestinationSearchIndex(catalog: catalog())
        let city = index.places.first { $0.name == "합성시청" }
        XCTAssertEqual(city?.stopIndexes, [1, 2])
        XCTAssertNotNil(index.places.first { $0.name == "색달동[야크마을]" }, "a bracket that is not a compass marker is part of the name")
        XCTAssertNil(index.places.first { $0.name == "합성기점" }, "only ever a first stop: not a destination")
        XCTAssertNotNil(index.places.first { $0.name == "합성순환" }, "a loop reaches its start again at the end")
    }

    func testSearchRanksExactPrefixContainsAndInitials() {
        let index = DestinationSearchIndex(catalog: catalog())
        XCTAssertEqual(index.search("합성시청").map(\.name), ["합성시청"])
        XCTAssertEqual(index.search(" 합성 시 청 ").map(\.name), ["합성시청"], "whitespace never matters")
        XCTAssertEqual(index.search("대학").map(\.name), ["합성대학교"])
        XCTAssertEqual(index.search("ㅎㅅㄷ").map(\.name), ["합성대학교"])
        XCTAssertEqual(index.search("없는정류장"), [])
        XCTAssertEqual(index.search(""), [])
    }

    func testRouteOptionsKeepVariantsAndRefuseImpossibleJourneys() throws {
        let index = DestinationSearchIndex(catalog: catalog())
        let city = try XCTUnwrap(index.places.first { $0.name == "합성시청" })
        let groups = index.routeOptions(to: city)
        XCTAssertEqual(groups.map(\.routeNo), ["202"])
        XCTAssertEqual(groups[0].options.map(\.route.routeId).sorted(), ["SYN202A", "SYN202B"])
        XCTAssertTrue(groups[0].options.allSatisfy { $0.boardingCount >= 1 })

        let university = try XCTUnwrap(index.places.first { $0.name == "합성대학교" })
        let reaching = index.routeOptions(to: university)
        XCTAssertEqual(reaching.map(\.routeNo), ["202", "202-1"], "202 and 202-1 are different routes")
        XCTAssertEqual(reaching[0].options.map(\.route.routeId), ["SYN202A"], "202B starts there: nowhere to board before it")
        let branches = reaching[1].options
        XCTAssertEqual(Set(branches.compactMap(\.via)), ["합성공항", "합성마을"], "same ends: told apart by a stop only one serves")
        XCTAssertTrue(branches.allSatisfy { $0.twin == nil }, "a stop already tells them apart")
    }

    func testIdenticalVariantsUnderTwoRouteIDsAreNumberedNotMerged() throws {
        let index = DestinationSearchIndex(catalog: catalog())
        let market = try XCTUnwrap(index.places.first { $0.name == "합성오일장" })
        let group = try XCTUnwrap(index.routeOptions(to: market).first { $0.routeNo == "510" })
        XCTAssertEqual(group.options.count, 2, "both route IDs stay: their buses report on their own ID")
        XCTAssertTrue(group.options.allSatisfy { $0.via == nil })
        let numbered = Dictionary(uniqueKeysWithValues: group.options.map { ($0.route.routeId, $0.twin) })
        XCTAssertEqual(numbered["SYN510A"], DestinationRouteOption.Twin(ordinal: 1, count: 2), "route ID order, not catalog order")
        XCTAssertEqual(numbered["SYN510B"], DestinationRouteOption.Twin(ordinal: 2, count: 2))

        // A loop visiting a stop twice is one variant offered twice, not twins.
        let loop = try XCTUnwrap(index.routeOptions(to: market).first { $0.routeNo == "440" })
        XCTAssertTrue(loop.options.allSatisfy { $0.twin == nil })
    }

    func testAStopVisitedTwiceOffersEachVisitWithTheProviderSequence() throws {
        let index = DestinationSearchIndex(catalog: catalog())
        let market = try XCTUnwrap(index.places.first { $0.name == "합성오일장" })
        let options = try XCTUnwrap(index.routeOptions(to: market).first).options
        XCTAssertEqual(options.map(\.destinationSequence), [4, 6])
        XCTAssertEqual(options.map(\.boardingCount), [1, 3])
        let route = index.transitRoute(options[1].route)
        XCTAssertEqual(route.routeStop(sequence: 6)?.stop.name, "합성오일장")
        XCTAssertEqual(index.catalog.apiRoute(options[1].route).routeId, "SYN440")
    }

    func testRouteNumbersSortAsRidersReadThem() {
        let sorted = ["1100", "202-1", "202", "101", "임시", "36"].sorted(by: DestinationSearchIndex.routeNumberOrder)
        XCTAssertEqual(sorted, ["36", "101", "202", "202-1", "1100", "임시"])
    }
}
