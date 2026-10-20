import XCTest
@testable import TapsoTransit

/// The tourist pivot's curated stop guides: 30 real catalog stops with
/// en/zh/ja one-liners. The 4,338-stop catalog is intentionally not translated.
final class TouristStopGuidesTests: XCTestCase {
    func testCoversAtLeast25TouristStops() {
        XCTAssertGreaterThanOrEqual(allTouristStopGuides.count, 25)
    }

    func testStopIdsAreUniqueAndWellFormed() {
        let ids = allTouristStopGuides.map(\.stopId)
        XCTAssertEqual(Set(ids).count, ids.count, "duplicate stop IDs")
        for id in ids {
            XCTAssertFalse(id.isEmpty)
            // Provider stop IDs in the canonical catalog start with JEB.
            XCTAssertTrue(id.hasPrefix("JEB"), "unexpected stop ID shape: \(id)")
        }
    }

    func testEveryGuideHasNonEmptyNamesAndBlurbs() {
        for guide in allTouristStopGuides {
            XCTAssertFalse(guide.stopNameKo.isEmpty, guide.stopId)
            XCTAssertFalse(guide.spotNameKo.isEmpty, guide.stopId)
            XCTAssertFalse(guide.spotNameEn.isEmpty, guide.stopId)
            XCTAssertFalse(guide.spotNameZh.isEmpty, guide.stopId)
            XCTAssertFalse(guide.spotNameJa.isEmpty, guide.stopId)
            XCTAssertFalse(guide.blurbEn.isEmpty, guide.stopId)
            XCTAssertFalse(guide.blurbZh.isEmpty, guide.stopId)
            XCTAssertFalse(guide.blurbJa.isEmpty, guide.stopId)
        }
    }

    func testBlurbForLanguagePicksTheRightField() {
        guard let airport = touristGuide(forStopId: "JEB405000663") else {
            return XCTFail("airport guide missing")
        }
        XCTAssertEqual(airport.blurb(for: .ko), airport.stopNameKo)
        XCTAssertEqual(airport.blurb(for: .en), airport.blurbEn)
        XCTAssertEqual(airport.blurb(for: .zhHans), airport.blurbZh)
        XCTAssertEqual(airport.blurb(for: .ja), airport.blurbJa)
    }

    func testLookupFindsKnownStopAndMissesUnknown() {
        XCTAssertNotNil(touristGuide(forStopId: "JEB406000816")) // Seongsan Ilchulbong
        XCTAssertNil(touristGuide(forStopId: "JEB000000000"))
        XCTAssertNil(touristGuide(forStopId: ""))
    }

    func testGuidesSurviveACodableRoundTrip() throws {
        let data = try JSONEncoder().encode(allTouristStopGuides)
        let decoded = try JSONDecoder().decode([TouristStopGuide].self, from: data)
        XCTAssertEqual(decoded, allTouristStopGuides)
    }

    /// Every guide names a real stop of the committed catalog by its provider id, with the
    /// catalog's own Korean name: a guide can never point at a renamed or invented stop.
    func testEveryGuideIsARealCatalogStopUnderItsOfficialName() throws {
        struct Catalog: Decodable {
            struct Stop: Decodable { let id: String; let name: String }
            let stops: [Stop]
        }
        let repository = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let url = repository.appendingPathComponent("services/api/data/jeju-transit-catalog.json")
        let catalog = try JSONDecoder().decode(Catalog.self, from: Data(contentsOf: url))
        let names = Dictionary(catalog.stops.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        XCTAssertGreaterThan(names.count, 4_000)
        for guide in allTouristStopGuides {
            XCTAssertEqual(names[guide.stopId], guide.stopNameKo, guide.stopId)
        }
    }

    func testSpotNamesMatchInEveryLanguageWithoutInventingStops() {
        let seongsan = allTouristStopGuides.first { $0.spotNameEn.lowercased().contains("seongsan") }
        XCTAssertNotNil(seongsan)
        if let seongsan {
            for language in JourneyLanguage.allCases {
                XCTAssertTrue(seongsan.matches(seongsan.spotName(for: language)), "\(language)")
            }
        }
        XCTAssertFalse(allTouristStopGuides.contains { $0.matches("s") }, "one Latin letter is not a query")
        XCTAssertFalse(allTouristStopGuides.contains { $0.matches("zzqx") })
    }

    /// On the published catalog, a foreign query reaches the official Korean place and nothing else.
    func testTouristSearchResolvesToOfficialCatalogPlaces() throws {
        let repository = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: repository.appendingPathComponent("services/api/data/jeju-transit-catalog.json"))
        let index = DestinationSearchIndex(catalog: try JejuTransitCatalog.decode(data))
        var reachable = 0
        for guide in allTouristStopGuides {
            let found = index.touristSearch(guide.spotNameEn)
            if let place = found.first(where: { $0.name == DestinationSearchIndex.placeName(guide.stopNameKo) }) {
                reachable += 1
                XCTAssertNotNil(index.touristGuide(for: place), guide.stopId)
            }
            for place in found {
                XCTAssertNotNil(allTouristStopGuides.first { DestinationSearchIndex.placeName($0.stopNameKo) == place.name }, place.name)
            }
        }
        XCTAssertEqual(reachable, allTouristStopGuides.count, "every curated stop is a destination on the published network")
        XCTAssertEqual(index.touristSearch("qzx"), [])
    }
}
