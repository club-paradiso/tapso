import Foundation
import TapsoTransit

/// SYNTHETIC fixtures for screenshot import. No real screenshot is committed.
///
/// Routes: stop names are taken from the feature brief for readability; their
/// order, sequence numbers, ids and coordinates are invented, and so is every
/// "route". They are not TAGO data and prove nothing about Jeju's real network.
///
/// Screens: each fixture is an OCR transcript shaped like one map app's route
/// view, in light or dark mode. Dark-mode transcripts carry lower confidence and
/// one look-alike misread, as dark UI tends to produce. They are written by hand
/// from the structure the apps show (status bar, header, stop list, buttons), not
/// copied from a device capture, and are labelled SYNTHETIC wherever they appear.
enum ScreenshotImportFixtures {
    // MARK: Routes (SYNTHETIC)

    static func routeStop(_ sequence: Int, _ name: String) -> RouteStop {
        RouteStop(
            stop: Stop(
                id: StopID(rawValue: "SYN-S\(sequence)-\(name)"),
                name: name,
                coordinate: Coordinate(latitude: 33.4000 + Double(sequence) * 0.002, longitude: 126.5000)
            ),
            sequence: sequence
        )
    }

    static func route(_ id: String, number: String, direction: RouteDirection, names: [String]) -> TransitRoute {
        TransitRoute(
            id: RouteID(rawValue: id),
            number: number,
            direction: direction,
            originName: names.first ?? "",
            destinationName: names.last ?? "",
            stops: names.enumerated().map { routeStop($0.offset + 1, $0.element) }
        )
    }

    static let outbound440 = route("SYN-440-A", number: "440", direction: .outbound, names: [
        "고산동산(아라방면)", "용담어린이집", "대학동", "사대부고", "국립제주트라우마치유센터", "제주시청(아라방면)", "합성종점",
    ])

    static let inbound440 = route("SYN-440-B", number: "440", direction: .inbound, names: [
        "합성종점", "제주시청(공항방면)", "국립제주트라우마치유센터", "사대부고", "대학동", "용담어린이집", "고산동산(공항방면)",
    ])

    static let route365 = route("SYN-365-A", number: "365", direction: .outbound, names: [
        "합성기점", "용담어린이집", "합성환승장", "제주시청(아라방면)", "합성종점365",
    ])

    /// Passes 제주시청 twice, as a loop does.
    static let loop3001 = route("SYN-3001-L", number: "3001", direction: .unknown, names: [
        "합성기점", "제주시청", "합성중간", "제주시청", "합성종점",
    ])

    static let allRoutes = [outbound440, inbound440, route365, loop3001]

    // MARK: Screens (SYNTHETIC OCR transcripts)

    /// KakaoMap-like, light: status bar, header, one bus leg with its stops.
    static let kakaoLight: [String] = [
        "9:41", "LTE", "100%",
        "경로", "도보 5분",
        "440번",
        "고산동산(아라방면)", "용담어린이집", "대학동", "사대부고", "국립제주트라우마치유센터",
        "안내 시작", "공유",
    ]

    /// NAVER Map-like, dark: lower confidence, `440` read as `44O`, a travel-time line.
    static let naverDark: [String] = [
        "오전 9:41", "5G", "87%",
        "대중교통", "추천", "최소환승",
        "버스 44O", "34분",
        "용담 어린이집", "대학동", "사대부고", "국립제주 트라우마 치유센터",
        "상세보기",
    ]

    /// Apple Maps-like, light, English chrome around Korean stops.
    static let appleLight: [String] = [
        "9:41", "Directions", "Transit",
        "Bus 440",
        "용담어린이집", "대학동", "사대부고", "국립제주트라우마치유센터",
        "Walk 5 min", "Start", "Share",
    ]

    /// Apple Maps-like, dark.
    static let appleDark: [String] = [
        "9:41", "Directions",
        "Bus 440",
        "용담어린이집", "사대부고", "국립제주트라우마치유센터",
        "Leave now", "Done",
    ]

    /// Not a map at all.
    static let notAMap: [String] = ["메시지", "받는 사람", "안녕하세요", "보내기"]

    // MARK: Builders

    static func text(_ lines: [String], confidence: Double = 0.95) -> RecognizedScreenshotText {
        RecognizedScreenshotText(blocks: lines.map { RecognizedTextBlock(text: $0, confidence: confidence) })
    }

    static func reading(_ lines: [String], confidence: Double = 0.95) -> ScreenshotReading {
        TransitEntityExtractor.reading(from: ScreenshotTextNormalizer.lines(from: text(lines, confidence: confidence)))
    }
}

struct FakeRecognizer: ScreenshotTextRecognizer {
    let outcome: @Sendable () throws -> RecognizedScreenshotText

    init(_ text: RecognizedScreenshotText) {
        outcome = { text }
    }

    init(failing error: ScreenshotRecognitionError) {
        outcome = { throw error }
    }

    func recognizeText(in imageData: Data) async throws -> RecognizedScreenshotText {
        try outcome()
    }
}

struct SourceUnavailable: Error {}

struct FakeRouteSource: RouteImportCandidateSource {
    let routes: [TransitRoute]
    var isDown = false

    func variants(forRouteNumber number: String) async throws -> [TransitRoute] {
        if isDown { throw SourceUnavailable() }
        return routes.filter { $0.number == number }
    }
}
