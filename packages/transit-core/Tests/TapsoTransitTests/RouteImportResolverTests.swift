import Foundation
import TapsoTransit
import XCTest

/// Route and direction resolution against TAPSO's route data, and the importer around it.
/// Every route and screen is SYNTHETIC (`ScreenshotImportFixtures`).
final class RouteImportResolverTests: XCTestCase {
    private typealias F = ScreenshotImportFixtures
    private struct Unexpected: Error {}

    private let resolver = RouteImportResolver()

    private func resolve(_ lines: [String], confidence: Double = 0.95, routes: [TransitRoute] = F.allRoutes) -> RouteImportResult {
        resolver.resolve(F.reading(lines, confidence: confidence), routes: routes)
    }

    private func confirmed(_ result: RouteImportResult, file: StaticString = #filePath, line: UInt = #line) throws -> RouteImportProposal {
        guard case let .confirmed(proposal) = result else {
            XCTFail("expected a confirmation, got \(result)", file: file, line: line)
            throw Unexpected()
        }
        return proposal
    }

    private func choices(_ result: RouteImportResult, file: StaticString = #filePath, line: UInt = #line) throws -> [RouteImportProposal] {
        guard case let .choose(proposals) = result else {
            XCTFail("expected a list of candidates, got \(result)", file: file, line: line)
            throw Unexpected()
        }
        return proposals
    }

    // MARK: Confirmed

    func testAClearRouteIsConfirmedAndTheStopCountComesFromTransitData() throws {
        let result = resolve(F.kakaoLight)
        XCTAssertEqual(result.confidence, .high)
        let proposal = try confirmed(result)
        XCTAssertEqual(proposal.route.id.rawValue, "SYN-440-A")
        XCTAssertEqual(proposal.boarding?.stop.name, "고산동산(아라방면)")
        XCTAssertEqual(proposal.destination.stop.name, "국립제주트라우마치유센터")
        XCTAssertEqual(proposal.evidence, .orderedStops(count: 5))
        XCTAssertEqual(proposal.stopCount, 4, "sequence 5 minus sequence 1, from the route, not from the screenshot")
        XCTAssertFalse(proposal.numberWasCorrected)
    }

    func testALookAlikeBusNumberIsAcceptedOnlyBecauseTheRouteAndStopsBackIt() throws {
        let proposal = try confirmed(resolve(F.naverDark, confidence: 0.8))
        XCTAssertEqual(proposal.route.number, "440")
        XCTAssertTrue(proposal.numberWasCorrected)
        XCTAssertEqual(proposal.boarding?.stop.name, "용담어린이집")
        XCTAssertEqual(proposal.stopCount, 3)
    }

    func testALookAlikeNumberWithoutOrderedStopsDoesNotConfirm() throws {
        let proposals = try choices(resolve(["버스 44O", "도착", "합성종점"]))
        XCTAssertEqual(proposals.map(\.route.id.rawValue), ["SYN-440-A"])
        XCTAssertTrue(proposals[0].numberWasCorrected)
    }

    func testAStopTypoStillConfirmsAndTheProposalUsesTapsosSpelling() throws {
        let proposal = try confirmed(resolve(["440번", "용담어린이집", "대학동", "사대부고", "국립제주트라우마치유센타"]))
        XCTAssertEqual(proposal.destination.stop.name, "국립제주트라우마치유센터")
        XCTAssertGreaterThanOrEqual(proposal.weakestStopSimilarity, StopNameSimilarity.strongThreshold)
        XCTAssertLessThan(proposal.weakestStopSimilarity, 1)
    }

    func testWhitespaceVariationsDoNotChangeTheAnswer() throws {
        let spaced = try confirmed(resolve(["440번", "용담 어린이집", "대학동", "사대부고", "국립제주 트라우마 치유센터"]))
        let tight = try confirmed(resolve(["440번", "용담어린이집", "대학동", "사대부고", "국립제주트라우마치유센터"]))
        XCTAssertEqual(spaced.route.id, tight.route.id)
        XCTAssertEqual(spaced.boarding, tight.boarding)
        XCTAssertEqual(spaced.destination, tight.destination)
    }

    func testTwoVisibleStopsAreEnoughWhenTheirOrderFitsOneDirection() throws {
        let proposal = try confirmed(resolve(["440번", "용담어린이집", "국립제주트라우마치유센터"]))
        XCTAssertEqual(proposal.route.id.rawValue, "SYN-440-A")
        XCTAssertEqual(proposal.stopCount, 3)
    }

    func testOnlyADestinationThatFitsOneDirectionIsConfirmedWithoutABoardingStop() throws {
        // 합성종점 is the last stop outbound and the first stop inbound, where nobody gets off.
        let proposal = try confirmed(resolve(["440번", "합성종점"]))
        XCTAssertEqual(proposal.route.id.rawValue, "SYN-440-A")
        XCTAssertNil(proposal.boarding)
        XCTAssertNil(proposal.stopCount, "no boarding stop shown: the rider chooses it")
        XCTAssertEqual(proposal.evidence, .destinationOnly)
    }

    // MARK: Direction

    func testStopsListedInReverseOrderResolveToTheOppositeDirection() throws {
        let proposal = try confirmed(resolve(["440번", "국립제주트라우마치유센터", "사대부고", "대학동"]))
        XCTAssertEqual(proposal.route.id.rawValue, "SYN-440-B")
        XCTAssertEqual(proposal.boarding?.sequence, 3)
        XCTAssertEqual(proposal.destination.sequence, 5)
        XCTAssertEqual(proposal.stopCount, 2)
    }

    func testADestinationServedInBothDirectionsAsksWhichOne() throws {
        let result = resolve(["440번", "국립제주트라우마치유센터"])
        XCTAssertEqual(result.confidence, .medium)
        let proposals = try choices(result)
        XCTAssertEqual(proposals.map(\.route.id.rawValue), ["SYN-440-A", "SYN-440-B"])
        XCTAssertTrue(proposals.allSatisfy { $0.boarding == nil })
    }

    func testALabelledDestinationIsStillNotGuessedBetweenDirections() throws {
        let proposals = try choices(resolve(["440번", "도착", "국립제주트라우마치유센터"]))
        XCTAssertEqual(proposals.count, 2)
    }

    func testAStopThatAppearsTwiceOnALoopListsBothVisits() throws {
        let proposals = try choices(resolve(["3001번", "제주시청"]))
        XCTAssertEqual(proposals.map(\.destination.sequence), [2, 4])
    }

    func testAnEarlierStopMakesTheLoopVisitUnambiguous() throws {
        let proposal = try confirmed(resolve(["3001번", "합성중간", "제주시청"]))
        XCTAssertEqual(proposal.boarding?.sequence, 3)
        XCTAssertEqual(proposal.destination.sequence, 4)
    }

    // MARK: Several candidates

    func testSeveralBusNumbersOnOneScreenshotAreAmbiguousNotConfirmed() throws {
        let result = resolve(["440번", "365번", "용담어린이집", "제주시청(아라방면)"])
        XCTAssertEqual(result.confidence, .medium)
        let proposals = try choices(result)
        XCTAssertEqual(proposals.map(\.route.number), ["365", "440"])
        XCTAssertTrue(proposals.allSatisfy { $0.stopCount != nil })
    }

    func testAtMostThreeCandidatesAreListed() throws {
        let many = (1...5).map { F.route("SYN-9-\($0)", number: "440", direction: .outbound, names: ["합성기점", "국립제주트라우마치유센터", "합성종점"]) }
        let proposals = try choices(resolve(["440번", "국립제주트라우마치유센터"], routes: many))
        XCTAssertEqual(proposals.count, RouteImportResolver.maxChoices)
    }

    // MARK: Rejected

    func testABusNumberAloneIsNeverEnough() {
        XCTAssertEqual(resolve(["440번"]), .notFound(.noStopMatch))
    }

    func testStopsTheRouteDoesNotHaveAreRejected() {
        XCTAssertEqual(resolve(["440번", "없는정류장이름입니다", "또없는정류장입니다"]), .notFound(.noStopMatch))
    }

    func testStopsInAnOrderNoDirectionHasAreRejected() {
        // 사대부고 (4), 용담어린이집 (2), 국립… (5): outbound and inbound both contradict two of the three.
        XCTAssertEqual(resolve(["440번", "사대부고", "용담어린이집", "국립제주트라우마치유센터"]), .notFound(.noStopMatch))
    }

    func testABusNumberTapsoDoesNotServeIsRejected() {
        XCTAssertEqual(resolve(["777번", "용담어린이집", "대학동"]), .notFound(.noSupportedBus))
    }

    func testAScreenWithoutAnyBusNumberIsNotARouteScreenshot() {
        XCTAssertEqual(resolve(F.notAMap), .notFound(.notARouteScreenshot))
    }

    func testAnOriginLabelledStopAloneIsNoUseAsADestination() {
        XCTAssertEqual(resolve(["440번", "출발", "대학동"]), .notFound(.noStopMatch))
    }

    func testNothingLegibleAndTooUncertainTextAreDistinguished() {
        XCTAssertEqual(resolve([]), .notFound(.noTextFound))
        XCTAssertEqual(resolve(F.kakaoLight, confidence: 0.1), .notFound(.lowQuality))
    }

    // MARK: Confidence

    func testUncertainTextIsNeverConfirmedEvenWhenTheStopsFit() throws {
        let result = resolve(F.kakaoLight, confidence: 0.3)
        XCTAssertEqual(result.confidence, .medium)
        XCTAssertEqual(try choices(result).map(\.route.id.rawValue), ["SYN-440-A"])
    }

    func testOneLineOutOfOrderIsToleratedButNeverConfirmed() throws {
        // 대학동 (3) listed after 사대부고 (4) contradicts the order; the other four lines agree.
        let result = resolve(["440번", "용담어린이집", "사대부고", "대학동", "국립제주트라우마치유센터"])
        let proposals = try choices(result)
        guard case .partiallyOrderedStops = proposals[0].evidence else { return XCTFail("expected partially ordered, got \(proposals[0].evidence)") }
    }

    func testResultsAreIndependentOfTheOrderRoutesArrive() {
        let forward = resolve(["440번", "국립제주트라우마치유센터"], routes: F.allRoutes)
        let reversed = resolve(["440번", "국립제주트라우마치유센터"], routes: F.allRoutes.reversed())
        XCTAssertEqual(forward, reversed)
    }

    // MARK: Screens from three map apps, light and dark

    func testKakaoNaverAndAppleScreensResolveToTheSameCanonicalRoute() throws {
        let screens: [(String, [String], Double)] = [
            ("kakao light", F.kakaoLight, 0.95),
            ("naver dark", F.naverDark, 0.8),
            ("apple light", F.appleLight, 0.95),
            ("apple dark", F.appleDark, 0.85),
        ]
        for (name, lines, confidence) in screens {
            let proposal = try confirmed(resolve(lines, confidence: confidence))
            XCTAssertEqual(proposal.route.id.rawValue, "SYN-440-A", name)
            XCTAssertEqual(proposal.destination.stop.name, "국립제주트라우마치유센터", name)
        }
    }

    // MARK: Importer

    func testTheImporterRunsRecognitionLookupAndResolution() async throws {
        let importer = ScreenshotRouteImporter(
            interpreter: LocalVisionRouteInterpreter(recognizer: FakeRecognizer(F.text(F.kakaoLight))),
            source: FakeRouteSource(routes: F.allRoutes)
        )
        let result = await importer.importRoute(from: Data())
        XCTAssertEqual(try confirmed(result).route.id.rawValue, "SYN-440-A")
    }

    func testOnlyBusNumbersAreSentToTheRouteSource() async {
        let source = RecordingRouteSource(routes: F.allRoutes)
        let importer = ScreenshotRouteImporter(
            interpreter: LocalVisionRouteInterpreter(recognizer: FakeRecognizer(F.text(F.kakaoLight))),
            source: source
        )
        _ = await importer.importRoute(from: Data())
        let requested = await source.requested
        XCTAssertEqual(requested, ["440"])
    }

    func testUnavailableRouteDataIsReportedNotGuessedAround() async {
        let importer = ScreenshotRouteImporter(
            interpreter: LocalVisionRouteInterpreter(recognizer: FakeRecognizer(F.text(F.kakaoLight))),
            source: FakeRouteSource(routes: F.allRoutes, isDown: true)
        )
        let result = await importer.importRoute(from: Data())
        XCTAssertEqual(result, .notFound(.routeDataUnavailable))
    }

    func testAnUnreadableImageAndAnEmptyRecognitionAreRecoverable() async {
        let source = FakeRouteSource(routes: F.allRoutes)
        let unreadable = ScreenshotRouteImporter(
            interpreter: LocalVisionRouteInterpreter(recognizer: FakeRecognizer(failing: .unreadableImage)),
            source: source
        )
        let unreadableResult = await unreadable.importRoute(from: Data())
        XCTAssertEqual(unreadableResult, .notFound(.unreadableImage))

        let empty = ScreenshotRouteImporter(
            interpreter: LocalVisionRouteInterpreter(recognizer: FakeRecognizer(RecognizedScreenshotText(blocks: []))),
            source: source
        )
        let emptyResult = await empty.importRoute(from: Data())
        XCTAssertEqual(emptyResult, .notFound(.noTextFound))
    }

    func testARemoteStyleInterpreterIsValidatedLikeAnyOther() async {
        // An interpreter that claims a stop the route does not have gets nothing through.
        struct Overconfident: RouteScreenshotInterpreter {
            func interpret(imageData: Data) async throws -> ScreenshotReading {
                ScreenshotReading(
                    busNumbers: [BusNumberCandidate(number: "440", wasCorrected: false, hasBusContext: true, confidence: 1)],
                    stopLines: [StopNameCandidate(text: "존재하지않는정류장이름", role: .destination, confidence: 1)],
                    ocrConfidence: 1,
                    lineCount: 2
                )
            }
        }
        let importer = ScreenshotRouteImporter(interpreter: Overconfident(), source: FakeRouteSource(routes: F.allRoutes))
        let result = await importer.importRoute(from: Data())
        XCTAssertEqual(result, .notFound(.noStopMatch))
    }
}

/// Records which route numbers were asked for.
private actor RecordingRouteSource: RouteImportCandidateSource {
    let routes: [TransitRoute]
    private(set) var requested: [String] = []

    init(routes: [TransitRoute]) {
        self.routes = routes
    }

    func variants(forRouteNumber number: String) async throws -> [TransitRoute] {
        requested.append(number)
        return routes.filter { $0.number == number }
    }
}
