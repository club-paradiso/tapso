import XCTest
@testable import TapsoTransit

final class JourneyLanguageTests: XCTestCase {
    func testTheAppsRenderingLanguageDecidesTheJourneyLanguage() {
        XCTAssertEqual(JourneyLanguage.resolve(["ko"]), .ko)
        XCTAssertEqual(JourneyLanguage.resolve(["ko-KR"]), .ko)
        XCTAssertEqual(JourneyLanguage.resolve(["en-GB"]), .en)
        XCTAssertEqual(JourneyLanguage.resolve(["ja-JP"]), .ja)
        XCTAssertEqual(JourneyLanguage.resolve(["zh-Hans"]), .zhHans)
        XCTAssertEqual(JourneyLanguage.resolve(["zh-Hans-CN"]), .zhHans)
        XCTAssertEqual(JourneyLanguage.resolve(["zh_CN"]), .zhHans)
    }

    func testUnsupportedLanguagesFallThroughInPreferenceOrder() {
        XCTAssertEqual(JourneyLanguage.resolve(["fr-FR", "ja"]), .ja)
        XCTAssertEqual(JourneyLanguage.resolve(["zh-Hant-TW", "ko"]), .ko, "Traditional Chinese is not Simplified")
        XCTAssertEqual(JourneyLanguage.resolve(["zh-TW"]), .en)
        XCTAssertEqual(JourneyLanguage.resolve(["de"]), .en)
        XCTAssertEqual(JourneyLanguage.resolve([]), .en)
    }

    func testTheWireValuesAreTheServersLanguageCodes() {
        // `JOURNEY_LANGUAGES` in services/api/src/journeySession.ts.
        XCTAssertEqual(JourneyLanguage.allCases.map(\.rawValue), ["ko", "en", "zh-Hans", "ja"])
    }
}
