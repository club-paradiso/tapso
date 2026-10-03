import Foundation
@testable import TapsoTransit
import XCTest

/// Cleaning, extraction and stop-name matching. Inputs are SYNTHETIC (`ScreenshotImportFixtures`).
final class ScreenshotImportTests: XCTestCase {
    private func lines(_ raw: [String]) -> [String] {
        ScreenshotTextNormalizer.lines(from: ScreenshotImportFixtures.text(raw)).map(\.text)
    }

    // MARK: Normalizer

    func testStatusBarAndButtonChromeIsDroppedButNamesAreKept() {
        let kept = lines(ScreenshotImportFixtures.kakaoLight)
        XCTAssertEqual(kept, ["440번", "고산동산(아라방면)", "용담어린이집", "대학동", "사대부고", "국립제주트라우마치유센터"])
    }

    func testWalkingTimesDistancesAndFaresAreNotText() {
        XCTAssertEqual(lines(["도보 5분", "12분", "1시간 20분", "350m", "1.2km", "1,450원", "3분 후", "용담어린이집"]), ["용담어린이집"])
    }

    func testFullWidthDigitsArrowsAndWhitespaceAreNormalized() {
        XCTAssertEqual(lines(["４４０번"]), ["440번"])
        XCTAssertEqual(lines(["용담어린이집  →   대학동 ▶ 사대부고"]), ["용담어린이집", "대학동", "사대부고"])
        XCTAssertEqual(lines(["•  국립제주  트라우마치유센터 "]), ["국립제주 트라우마치유센터"])
    }

    func testOriginAndDestinationLabelsSurviveForTheExtractor() {
        XCTAssertEqual(lines(["출발", "도착"]), ["출발", "도착"])
    }

    func testConfidenceIsClampedToZeroOne() {
        let text = RecognizedScreenshotText(blocks: [
            RecognizedTextBlock(text: "대학동", confidence: 1.7),
            RecognizedTextBlock(text: "사대부고", confidence: .nan),
        ])
        XCTAssertEqual(ScreenshotTextNormalizer.lines(from: text).map(\.confidence), [1, 0])
    }

    // MARK: Bus numbers

    func testBusNumbersInTheShapesMapAppsUse() {
        for (raw, expected) in [("440", "440"), ("440번", "440"), ("버스 440", "440"), ("Bus 440", "440"), ("3001", "3001"), ("365번 버스", "365")] {
            let reading = ScreenshotImportFixtures.reading([raw])
            XCTAssertEqual(reading.busNumbers.map(\.number), [expected], raw)
        }
    }

    func testALookAlikeLetterIsCorrectedAndFlagged() throws {
        let candidate = try XCTUnwrap(ScreenshotImportFixtures.reading(["44O"]).busNumbers.first)
        XCTAssertEqual(candidate.number, "440")
        XCTAssertTrue(candidate.wasCorrected)
        XCTAssertFalse(try XCTUnwrap(ScreenshotImportFixtures.reading(["440"]).busNumbers.first).wasCorrected)
    }

    func testTimesDistancesExitsAndLoneDigitsAreNotBusNumbers() {
        for raw in ["9:41", "오전 10:25 도착", "350m", "12분", "3번 출구", "12번 출구", "1.25", "5", "O", "LTE"] {
            XCTAssertTrue(ScreenshotImportFixtures.reading([raw]).busNumbers.isEmpty, raw)
        }
    }

    func testABusWordMakesANumberRankFirst() {
        let reading = ScreenshotImportFixtures.reading(["합성로 123", "440번"])
        XCTAssertEqual(reading.busNumbers.map(\.number), ["440", "123"])
    }

    func testAtMostFourNumbersAreKept() {
        let reading = ScreenshotImportFixtures.reading(["101번", "102번", "103번", "104번", "105번", "106번"])
        XCTAssertEqual(reading.busNumbers.count, TransitEntityExtractor.maxBusNumbers)
    }

    // MARK: Stop lines

    func testStopLinesKeepOrderDropNumbersAndRepeatedLabels() {
        let reading = ScreenshotImportFixtures.reading(["440 용담어린이집", "대학동", "대학동", "버스 사대부고"])
        XCTAssertEqual(reading.stopLines.map(\.text), ["용담어린이집", "대학동", "사대부고"])
    }

    func testAStopNameContainingTheWordBusIsNotBroken() {
        XCTAssertEqual(ScreenshotImportFixtures.reading(["제주버스터미널"]).stopLines.map(\.text), ["제주버스터미널"])
    }

    func testLabelsMarkTheLineThatFollowsOrTheRestOfTheLine() {
        let reading = ScreenshotImportFixtures.reading(["출발", "용담어린이집", "도착: 사대부고", "도착 3:20"])
        XCTAssertEqual(reading.stopLines.map(\.text), ["용담어린이집", "사대부고"])
        XCTAssertEqual(reading.stopLines.map(\.role), [.origin, .destination])
    }

    func testAnEmptyOrTextlessScreenReadsAsEmpty() {
        XCTAssertEqual(ScreenshotImportFixtures.reading([]), .empty)
        XCTAssertEqual(ScreenshotImportFixtures.reading(["9:41", "LTE", "100%"]).lineCount, 0)
    }

    // MARK: Similarity

    private let similarity = StopNameSimilarity()

    func testSpacingAndPunctuationNeverMatter() {
        XCTAssertEqual(similarity.match("국립제주 트라우마 치유센터", to: "국립제주트라우마치유센터")?.similarity, 1)
        XCTAssertEqual(similarity.match("용담 어린이집", to: "용담어린이집")?.similarity, 1)
    }

    func testOneWrongJamoInALongNameStillMatchesStrongly() throws {
        let match = try XCTUnwrap(similarity.match("국립제주트라우마치유센타", to: "국립제주트라우마치유센터"))
        XCTAssertGreaterThanOrEqual(match.similarity, StopNameSimilarity.strongThreshold)
        XCTAssertLessThan(match.similarity, 1)
    }

    func testShortNamesMustMatchExactly() {
        XCTAssertNil(similarity.match("제주시장", to: "제주시청"))
        XCTAssertNil(similarity.match("대학", to: "대학동"))
        XCTAssertNotNil(similarity.match("대학동", to: "대학동"))
    }

    func testDifferentLongNamesDoNotMatch() {
        XCTAssertNil(similarity.match("국립제주박물관앞", to: "국립제주트라우마치유센터"))
    }

    func testQualifiersAreSetAsideWithAPenalty() throws {
        let missing = try XCTUnwrap(similarity.match("제주시청", to: "제주시청(아라방면)"))
        XCTAssertEqual(missing.similarity, 0.97, accuracy: 0.0001)
        let same = try XCTUnwrap(similarity.match("제주시청(아라방면)", to: "제주시청(아라방면)"))
        XCTAssertEqual(same.similarity, 1)
        let different = try XCTUnwrap(similarity.match("제주시청(아라방면)", to: "제주시청(공항방면)"))
        XCTAssertEqual(different.similarity, 0.9, accuracy: 0.0001)
    }

    func testTrailingStopWordsAreSetAside() {
        XCTAssertEqual(similarity.match("용담어린이집 정류장", to: "용담어린이집")?.similarity, 1)
    }

    func testALineWrappingAWholeStopNameIsAcceptedBelowStrong() throws {
        let match = try XCTUnwrap(similarity.match("용담어린이집 승차", to: "용담어린이집"))
        XCTAssertLessThan(match.similarity, StopNameSimilarity.strongThreshold)
        XCTAssertNil(similarity.match("대학동 입구 앞 합성 식당", to: "대학동"), "a short name is never found inside a longer line")
    }

    func testAnAliasTableIsHonouredAndEmptyByDefault() {
        XCTAssertNil(similarity.match("합성공항", to: "합성국제공항"))
        let aliased = StopNameSimilarity(aliases: ["합성공항": "합성국제공항"])
        XCTAssertEqual(aliased.match("합성 공항", to: "합성국제공항")?.similarity, 1)
    }

    func testHangulIsComparedAsJamo() {
        // 센타 → 센터: one vowel apart, not a whole syllable.
        XCTAssertEqual(StopNameSimilarity.editDistance(StopNameSimilarity.jamo("센타"), StopNameSimilarity.jamo("센터")), 1)
        XCTAssertEqual(StopNameSimilarity.jamo("가").count, 2)
        XCTAssertEqual(StopNameSimilarity.jamo("각").count, 3)
    }
}
