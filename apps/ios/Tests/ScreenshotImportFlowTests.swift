import Foundation
import TapsoTransit
import UIKit
import Vision
import XCTest
@testable import Tapso

/// Screenshot route import, through the app model: a screenshot's text becomes a
/// route only after TAPSO's own route data (a stubbed transit API here) agrees,
/// nothing starts before the rider confirms, and what starts is the same live
/// setup a hand-chosen route starts. Every route, stop and screen is SYNTHETIC; no
/// screenshot is committed, and the Vision test draws its own images.
@MainActor
final class ScreenshotImportFlowTests: XCTestCase {
    private let outbound = ["고산동산(아라방면)", "용담어린이집", "대학동", "사대부고", "국립제주트라우마치유센터", "제주시청(아라방면)", "합성종점"]
    private let inbound = ["합성종점", "제주시청(공항방면)", "국립제주트라우마치유센터", "사대부고", "대학동", "용담어린이집", "고산동산(공항방면)"]
    private let kakaoLight = ["9:41", "LTE", "경로", "도보 5분", "440번", "고산동산(아라방면)", "용담어린이집", "대학동", "사대부고", "국립제주트라우마치유센터", "안내 시작"]

    // MARK: Confirmation comes first

    func testAScreenshotBecomesAConfirmationNotARide() async throws {
        let model = makeModel(screen: kakaoLight)
        model.importScreenshot(Data())
        XCTAssertEqual(model.screenshotImport, .reading)
        try await waitUntil { model.screenshotImport != .reading }

        guard case let .confirm(proposal) = model.screenshotImport else { return XCTFail("expected a confirmation, got \(model.screenshotImport)") }
        XCTAssertEqual(proposal.route.id.rawValue, "SYN-440-A")
        XCTAssertEqual(proposal.boarding?.stop.name, "고산동산(아라방면)")
        XCTAssertEqual(proposal.destination.stop.name, "국립제주트라우마치유센터")
        XCTAssertEqual(proposal.stopCount, 4, "counted from the API's stop sequences")
        XCTAssertNil(model.draft, "nothing is set up before the rider confirms")
        XCTAssertFalse(model.hasActiveRide)
        XCTAssertFalse(StubURLProtocol.recorded.contains { $0.url?.path == "/v1/sessions" }, "no live session before confirmation")
    }

    func testOnlyTheBusNumberLeavesTheDevice() async throws {
        let model = makeModel(screen: kakaoLight)
        model.importScreenshot(Data())
        try await waitUntil { model.screenshotImport != .reading }

        let requests = StubURLProtocol.recorded
        XCTAssertFalse(requests.isEmpty)
        for request in requests {
            XCTAssertTrue(["/v1/routes", "/v1/stops"].contains(request.url?.path), "unexpected request \(request.url?.absoluteString ?? "")")
            XCTAssertEqual(request.httpMethod, "GET")
            let query = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems ?? []
            XCTAssertTrue(Set(query.map(\.name)).isSubset(of: ["routeNo", "routeId", "cityCode"]))
            XCTAssertFalse((request.url?.absoluteString ?? "").contains("%"), "no encoded text from the screenshot in a request")
        }
        let numbers = requests
            .filter { $0.url?.path == "/v1/routes" }
            .compactMap { $0.url }
            .compactMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "routeNo" }?.value }
        XCTAssertEqual(numbers, ["440"])
    }

    func testConfirmingStartsTheSameLiveVehicleCheckAsChoosingByHand() async throws {
        let model = makeModel(screen: kakaoLight)
        model.openMapImport()
        model.importScreenshot(Data())
        try await waitUntil { model.screenshotImport != .reading }
        guard case let .confirm(proposal) = model.screenshotImport else { return XCTFail("expected a confirmation") }

        await model.startScreenshotRoute(proposal)
        XCTAssertEqual(model.screenshotImport, .idle)
        let draft = try XCTUnwrap(model.draft)
        XCTAssertTrue(draft.isLive)
        XCTAssertEqual(draft.liveRoute?.id.rawValue, "SYN-440-A")
        XCTAssertEqual(draft.boardingSequence, 1)
        XCTAssertEqual(draft.destinationSequence, 5)
        XCTAssertEqual(draft.totalStops, 4)
        XCTAssertEqual(model.path.last, .vehicleCheck)
        model.cancelSetup()
    }

    func testADestinationOnlyScreenshotLetsTheRiderChooseWhereToBoard() async throws {
        let model = makeModel(screen: ["440번", "합성종점"])
        model.openMapImport()
        model.importScreenshot(Data())
        try await waitUntil { model.screenshotImport != .reading }
        guard case let .confirm(proposal) = model.screenshotImport else { return XCTFail("expected a confirmation, got \(model.screenshotImport)") }
        XCTAssertNil(proposal.boarding)

        await model.startScreenshotRoute(proposal)
        XCTAssertEqual(model.path.last, .liveStops(routeID: "SYN-440-A"))
        XCTAssertEqual(model.screenshotDestination?.stop.name, "합성종점")
        XCTAssertNil(model.draft, "the rider has not chosen a boarding stop yet")
        guard case .loaded = model.liveStops else { return XCTFail("the stop list should be ready") }
    }

    // MARK: Several candidates, and choosing another

    func testAmbiguousScreenshotOffersBothDirectionsAndTheRiderPicksOne() async throws {
        let model = makeModel(screen: ["440번", "국립제주트라우마치유센터"])
        model.openMapImport()
        model.importScreenshot(Data())
        try await waitUntil { model.screenshotImport != .reading }
        guard case let .choose(proposals) = model.screenshotImport else { return XCTFail("expected candidates, got \(model.screenshotImport)") }
        XCTAssertEqual(proposals.map(\.route.id.rawValue), ["SYN-440-A", "SYN-440-B"])

        await model.startScreenshotRoute(proposals[1])
        XCTAssertEqual(model.path.last, .liveStops(routeID: "SYN-440-B"), "the rider's pick, not the first candidate")
    }

    func testAnotherRouteOpensTheBusNumbersOwnVariants() async throws {
        let model = makeModel(screen: kakaoLight)
        model.openMapImport()
        model.importScreenshot(Data())
        try await waitUntil { model.screenshotImport != .reading }
        guard case let .confirm(proposal) = model.screenshotImport else { return XCTFail("expected a confirmation") }

        model.chooseAnotherRoute(like: proposal)
        XCTAssertEqual(model.path, [.liveRoutes])
        XCTAssertEqual(model.screenshotImport, .idle)
        try await waitUntil {
            if case .results = model.liveRouteSearch { return true }
            return false
        }
        guard case let .results(number, routes) = model.liveRouteSearch else { return XCTFail("expected results") }
        XCTAssertEqual(number, "440")
        XCTAssertEqual(routes.count, 2)
    }

    // MARK: Failing safely and recovering

    func testAScreenshotTapsoCannotVerifyFailsWithoutStartingAnything() async throws {
        let model = makeModel(screen: ["메시지", "받는 사람", "안녕하세요"])
        model.importScreenshot(Data())
        try await waitUntil { model.screenshotImport != .reading }
        XCTAssertEqual(model.screenshotImport, .failed(.notARouteScreenshot))
        XCTAssertNil(model.draft)
        XCTAssertTrue(StubURLProtocol.recorded.isEmpty, "no bus number, nothing to look up")
    }

    func testUnavailableRouteDataIsReported() async throws {
        let model = makeModel(screen: kakaoLight)
        StubURLProtocol.respond { _ in (500, Data()) }
        model.importScreenshot(Data())
        try await waitUntil { model.screenshotImport != .reading }
        XCTAssertEqual(model.screenshotImport, .failed(.routeDataUnavailable))
    }

    func testCancellingOrFailingToLoadThePhotoIsRecoverable() async throws {
        let model = makeModel(screen: kakaoLight)
        model.importScreenshot(Data())
        model.cancelScreenshotImport()
        XCTAssertEqual(model.screenshotImport, .idle)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(model.screenshotImport, .idle, "a cancelled read never reports back")

        model.screenshotCouldNotLoad()
        XCTAssertEqual(model.screenshotImport, .failed(.unreadableImage))

        model.importScreenshot(Data())
        try await waitUntil { model.screenshotImport != .reading }
        guard case .confirm = model.screenshotImport else { return XCTFail("a new photo should work after a failure") }
    }

    func testLeavingTheImportScreenCancelsTheRead() async throws {
        let model = makeModel(screen: kakaoLight)
        model.openMapImport()
        model.importScreenshot(Data())
        model.path = []
        model.pathDidChange([])
        XCTAssertEqual(model.screenshotImport, .idle)
    }

    // MARK: Deleting the original from Photos

    func testTheRiderCanDeleteTheOriginalAndTapsoAsksPhotosOnlyThen() async throws {
        let eraser = FakeEraser(outcome: .deleted)
        let model = makeModel(screen: kakaoLight, eraser: eraser)
        XCTAssertEqual(model.originalDeletion, .unavailable)
        model.importScreenshot(Data(), assetID: "SYN-ASSET-1")
        XCTAssertEqual(model.originalDeletion, .available)
        try await waitUntil { model.screenshotImport != .reading }
        let before = await eraser.requested
        XCTAssertEqual(before, [], "nothing is deleted, and photo access is not asked, until the rider taps")

        await model.deleteOriginalScreenshot()
        XCTAssertEqual(model.originalDeletion, .deleted)
        let requested = await eraser.requested
        XCTAssertEqual(requested, ["SYN-ASSET-1"])

        await model.deleteOriginalScreenshot()
        let again = await eraser.requested
        XCTAssertEqual(again, ["SYN-ASSET-1"], "deleted once, not twice")
    }

    func testDecliningIosConfirmationOrPhotoAccessIsRecoverable() async throws {
        let eraser = FakeEraser(outcome: .cancelled)
        let model = makeModel(screen: kakaoLight, eraser: eraser)
        model.importScreenshot(Data(), assetID: "SYN-ASSET-2")
        try await waitUntil { model.screenshotImport != .reading }

        await model.deleteOriginalScreenshot()
        XCTAssertEqual(model.originalDeletion, .available, "iOS's own confirmation declined: nothing changed, can ask again")

        await eraser.set(.denied)
        await model.deleteOriginalScreenshot()
        XCTAssertEqual(model.originalDeletion, .failed(.denied))
        XCTAssertTrue(model.screenshotImport.isResult, "the route result is unaffected")

        await eraser.set(.deleted)
        await model.deleteOriginalScreenshot()
        XCTAssertEqual(model.originalDeletion, .deleted, "a failure can be retried")
    }

    func testPhotosNotShowingThePhotoReportsAFailureNotASuccess() async throws {
        let model = makeModel(screen: kakaoLight, eraser: FakeEraser(outcome: .notFound))
        model.importScreenshot(Data(), assetID: "SYN-ASSET-3")
        try await waitUntil { model.screenshotImport != .reading }
        await model.deleteOriginalScreenshot()
        XCTAssertEqual(model.originalDeletion, .failed(.other))
    }

    func testAPhotoWithoutAnIdentifierOrAFreshPhotoOffersNoDeletion() async throws {
        let eraser = FakeEraser(outcome: .deleted)
        let model = makeModel(screen: kakaoLight, eraser: eraser)
        model.importScreenshot(Data())
        XCTAssertEqual(model.originalDeletion, .unavailable, "a shared screenshot has no identifier")
        await model.deleteOriginalScreenshot()
        let none = await eraser.requested
        XCTAssertEqual(none, [])

        model.importScreenshot(Data(), assetID: "SYN-ASSET-4")
        model.importScreenshot(Data(), assetID: nil)
        XCTAssertEqual(model.originalDeletion, .unavailable, "a new photo never inherits the last one's identifier")
        model.importScreenshot(Data(), assetID: "SYN-ASSET-5")
        model.cancelScreenshotImport()
        XCTAssertEqual(model.originalDeletion, .unavailable)
        await model.deleteOriginalScreenshot()
        let afterCancel = await eraser.requested
        XCTAssertEqual(afterCancel, [])
    }

    // MARK: Shared from Photos (share extension)

    func testAScreenshotSharedFromPhotosIsCheckedAndStillWaitsForConfirmation() async throws {
        let model = makeModel(screen: [])
        let inbox = HandoffInbox(defaults: try XCTUnwrap(UserDefaults(suiteName: "tapso.tests.handoff.\(UUID().uuidString)")))
        let blocks = kakaoLight.map { RecognizedTextBlock(text: $0, confidence: 0.95) }
        let reading = TransitEntityExtractor.reading(from: ScreenshotTextNormalizer.lines(from: RecognizedScreenshotText(blocks: blocks)))
        XCTAssertTrue(reading.isUsable)
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        inbox.put(reading, at: now)

        model.collectHandoff(from: inbox, now: now.addingTimeInterval(30))
        XCTAssertEqual(model.path, [.mapImport], "the import screen opens with the result")
        XCTAssertEqual(model.screenshotImport, .reading)
        try await waitUntil { model.screenshotImport != .reading }
        guard case let .confirm(proposal) = model.screenshotImport else { return XCTFail("expected a confirmation, got \(model.screenshotImport)") }
        XCTAssertEqual(proposal.route.id.rawValue, "SYN-440-A")
        XCTAssertNil(model.draft, "nothing starts before the rider confirms")
        XCTAssertFalse(StubURLProtocol.recorded.contains { $0.url?.path == "/v1/sessions" })

        model.cancelScreenshotImport()
        model.collectHandoff(from: inbox, now: now.addingTimeInterval(60))
        XCTAssertEqual(model.screenshotImport, .idle, "the inbox hands a reading over once")
    }

    func testAnExpiredSharedReadingIsIgnored() throws {
        let model = makeModel(screen: [])
        let inbox = HandoffInbox(defaults: try XCTUnwrap(UserDefaults(suiteName: "tapso.tests.handoff.\(UUID().uuidString)")))
        let blocks = kakaoLight.map { RecognizedTextBlock(text: $0, confidence: 0.95) }
        let reading = TransitEntityExtractor.reading(from: ScreenshotTextNormalizer.lines(from: RecognizedScreenshotText(blocks: blocks)))
        let saved = Date(timeIntervalSince1970: 1_800_000_000)
        inbox.put(reading, at: saved)
        model.collectHandoff(from: inbox, now: saved.addingTimeInterval(HandoffInbox.lifetime + 1))
        XCTAssertEqual(model.screenshotImport, .idle)
        XCTAssertEqual(model.path, [])
    }

    // MARK: Link import still works

    func testPastingALinkStillWorksAndSupersedesAScreenshotInProgress() async throws {
        let model = makeModel(screen: kakaoLight)
        model.openMapImport()
        model.importScreenshot(Data())
        model.importSharedText("[카카오맵] 합성 카페\n제주특별자치도 제주시 합성로 12\n33.4996, 126.5312")
        XCTAssertEqual(model.screenshotImport, .idle)
        XCTAssertEqual(model.sharedPlace?.name, "합성 카페")
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(model.screenshotImport, .idle)
        XCTAssertEqual(model.sharedPlace?.name, "합성 카페", "a screenshot result never overwrites a pasted place")
    }

    // MARK: Vision, on the device's own recogniser

    func testVisionReadsRenderedRouteScreensInLightAndDarkMode() async throws {
        let supported = (try? VNRecognizeTextRequest().supportedRecognitionLanguages()) ?? []
        try XCTSkipUnless(supported.contains("ko-KR"), "this runtime's Vision has no Korean text recognition")

        for dark in [false, true] {
            let png = try XCTUnwrap(Self.renderRouteScreen(["440번", "용담어린이집", "대학동", "사대부고", "국립제주트라우마치유센터"], dark: dark))
            let text = try await VisionScreenshotTextRecognizer().recognizeText(in: png)
            let reading = TransitEntityExtractor.reading(from: ScreenshotTextNormalizer.lines(from: text))
            XCTAssertTrue(reading.busNumbers.contains { $0.number == "440" }, "bus number, dark=\(dark): \(text.blocks.map(\.text))")
            let similarity = StopNameSimilarity()
            let found = ["용담어린이집", "대학동", "사대부고", "국립제주트라우마치유센터"].filter { name in
                reading.stopLines.contains { similarity.match($0.text, to: name) != nil }
            }
            XCTAssertGreaterThanOrEqual(found.count, 3, "stops, dark=\(dark): \(reading.stopLines.map(\.text))")
        }
    }

    func testAnUndecodableImageIsReportedNotCrashed() async {
        do {
            _ = try await VisionScreenshotTextRecognizer().recognizeText(in: Data([0, 1, 2, 3]))
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? ScreenshotRecognitionError, .unreadableImage)
        }
    }

    // MARK: Helpers

    private func makeModel(screen: [String], confidence: Double = 0.95, eraser: any ScreenshotOriginalEraser = FakeEraser(outcome: .deleted)) -> TapsoAppModel {
        stubTransitAPI()
        let client = TapsoAPIClient.stubbed()
        let catalog = LiveRouteImportCatalog(api: client)
        let importer = ScreenshotRouteImporter(
            interpreter: LocalVisionRouteInterpreter(recognizer: FixtureRecognizer(lines: screen, confidence: confidence)),
            source: catalog
        )
        let model = TapsoAppModel(
            store: JourneyStore(defaults: UserDefaults(suiteName: "tapso.tests.\(UUID().uuidString)")!),
            liveActivity: nil,
            api: client,
            routeCatalog: catalog,
            screenshotImporter: importer,
            originalEraser: eraser
        )
        model.speed = .manual
        return model
    }

    private func stubTransitAPI() {
        let routes = Self.routesPayload
        let outboundStops = Self.stopsPayload(outbound)
        let inboundStops = Self.stopsPayload(inbound)
        StubURLProtocol.respond { request in
            let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let routeID = items.first { $0.name == "routeId" }?.value
            switch (request.url?.path ?? "", routeID) {
            case ("/v1/routes", _): return (200, routes)
            case ("/v1/stops", "SYN-440-A"): return (200, outboundStops)
            case ("/v1/stops", "SYN-440-B"): return (200, inboundStops)
            default: return (503, Data(#"{"error":"SESSIONS_UNAVAILABLE","message":"synthetic"}"#.utf8))
            }
        }
    }

    private static let routesPayload = Data(#"""
    {"items":[
      {"routeId":"SYN-440-A","routeNumber":"440","startStopName":"고산동산(아라방면)","endStopName":"합성종점"},
      {"routeId":"SYN-440-B","routeNumber":"440","startStopName":"합성종점","endStopName":"고산동산(공항방면)"}
    ],"meta":{"provider":"synthetic","cityCode":"39","routeNo":"440","count":2,"variantsPreserved":true}}
    """#.utf8)

    private static func stopsPayload(_ names: [String]) -> Data {
        let items = names.enumerated().map { index, name in
            #"{"stopId":"SYN-S\#(index + 1)-\#(name)","name":"\#(name)","sequence":\#(index + 1),"latitude":\#(33.45 + Double(index) * 0.002),"longitude":126.5}"#
        }
        return Data(#"{"items":[\#(items.joined(separator: ","))],"meta":{"topology":{"kind":"linear"}}}"#.utf8)
    }

    /// A synthetic route screen: one line of text per row on a plain light or dark background.
    private static func renderRouteScreen(_ lines: [String], dark: Bool) -> Data? {
        let size = CGSize(width: 1170, height: 1400)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.pngData { context in
            (dark ? UIColor.black : UIColor.white).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 64, weight: .semibold),
                .foregroundColor: dark ? UIColor.white : UIColor.black,
            ]
            for (index, line) in lines.enumerated() {
                (line as NSString).draw(at: CGPoint(x: 80, y: 120 + CGFloat(index) * 160), withAttributes: attributes)
            }
        }
    }

    private func waitUntil(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTFail("condition not met within 5 s", file: file, line: line)
    }
}

/// Stands in for Photos: records what it was asked to delete and answers as told.
private actor FakeEraser: ScreenshotOriginalEraser {
    private var outcome: OriginalEraseOutcome
    private(set) var requested: [String] = []

    init(outcome: OriginalEraseOutcome) {
        self.outcome = outcome
    }

    func set(_ outcome: OriginalEraseOutcome) {
        self.outcome = outcome
    }

    func erase(assetIdentifier: String) async -> OriginalEraseOutcome {
        requested.append(assetIdentifier)
        return outcome
    }
}

private extension ScreenshotImportState {
    var isResult: Bool {
        switch self {
        case .confirm, .choose, .failed: true
        case .idle, .reading: false
        }
    }
}

/// Reads a fixed transcript instead of an image.
private struct FixtureRecognizer: ScreenshotTextRecognizer {
    let lines: [String]
    let confidence: Double

    func recognizeText(in imageData: Data) async throws -> RecognizedScreenshotText {
        RecognizedScreenshotText(blocks: lines.map { RecognizedTextBlock(text: $0, confidence: confidence) })
    }
}
