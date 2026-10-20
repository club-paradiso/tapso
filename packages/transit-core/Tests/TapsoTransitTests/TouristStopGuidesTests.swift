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
}
