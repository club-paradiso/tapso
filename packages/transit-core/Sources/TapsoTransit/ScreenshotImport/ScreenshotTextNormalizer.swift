import Foundation

/// A line of screenshot text after cleaning, with the recogniser's confidence in it.
public struct NormalizedLine: Hashable, Sendable {
    public let text: String
    public let confidence: Double

    public init(text: String, confidence: Double) {
        self.text = text
        self.confidence = confidence
    }
}

/// Cleans recognised text without destroying Korean words: full-width forms,
/// decorative arrows and bullets, stray whitespace, and the status-bar and
/// button text every map screenshot carries. Conservative on purpose: a line
/// is dropped only when the whole line is chrome.
public enum ScreenshotTextNormalizer {
    public static func lines(from text: RecognizedScreenshotText) -> [NormalizedLine] {
        var result: [NormalizedLine] = []
        for block in text.blocks {
            for piece in pieces(of: block.text) {
                let cleaned = collapseWhitespace(piece)
                guard hasContent(cleaned), !isChrome(cleaned) else { continue }
                result.append(NormalizedLine(text: cleaned, confidence: clamp(block.confidence)))
            }
        }
        return result
    }

    // MARK: Pieces

    /// A block can hold several lines, and a route summary joins stops with arrows:
    /// each part becomes its own line, in order.
    private static func pieces(of raw: String) -> [String] {
        let widthFixed = String(String.UnicodeScalarView(raw.unicodeScalars.map(halfWidth)))
        let composed = widthFixed.precomposedStringWithCanonicalMapping
        var parts: [String] = []
        var current = ""
        for character in composed {
            if character.isNewline || separators.contains(character) {
                parts.append(current)
                current = ""
            } else if decorations.contains(character) {
                current.append(" ")
            } else {
                current.append(character)
            }
        }
        parts.append(current)
        return parts
    }

    /// Arrows and chevrons between stops, and the vertical bars map apps draw between facts.
    private static let separators: Set<Character> = ["→", "➔", "➜", "➝", "▶", "▷", ">", "»", "›", "|", "│", "┃", "￨"]
    /// Bullets and glyphs that decorate a line but never belong to a name.
    private static let decorations: Set<Character> = ["•", "●", "○", "◦", "■", "□", "◆", "◇", "★", "☆", "…", "\u{00A0}", "\t"]

    private static func halfWidth(_ scalar: Unicode.Scalar) -> Unicode.Scalar {
        switch scalar.value {
        case 0xFF01...0xFF5E: return Unicode.Scalar(scalar.value - 0xFEE0) ?? scalar
        case 0x3000: return " "
        default: return scalar
        }
    }

    private static func collapseWhitespace(_ text: String) -> String {
        text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    private static func hasContent(_ text: String) -> Bool {
        text.unicodeScalars.contains { CharacterSet.alphanumerics.contains($0) }
    }

    private static func clamp(_ confidence: Double) -> Double {
        guard confidence.isFinite else { return 0 }
        return min(1, max(0, confidence))
    }

    // MARK: Chrome

    /// Whole-line UI text that says nothing about a route. `출발` and `도착` are kept:
    /// they label the stops that follow (`TransitEntityExtractor`).
    private static let chromeWords: Set<String> = [
        "경로", "길찾기", "길 찾기", "공유", "저장", "내 위치", "내위치", "현재 위치", "지도", "검색",
        "안내시작", "안내 시작", "시작", "대중교통", "자동차", "도보", "자전거", "버스", "지하철",
        "추천", "최단시간", "최소환승", "최소도보", "상세", "상세보기", "더보기", "닫기", "취소", "확인", "뒤로", "전체",
        "lte", "5g", "4g", "3g", "wifi", "wi-fi", "kt", "skt", "u+", "lg u+", "sos",
        "directions", "route", "routes", "start", "share", "save", "search", "transit", "walk", "walking",
        "drive", "driving", "bus", "details", "map", "maps", "leave now", "done", "cancel", "close", "back",
        "my location", "current location", "go", "more", "options", "now",
    ]

    private static func isChrome(_ line: String) -> Bool {
        let lower = line.lowercased()
        if chromeWords.contains(lower) { return true }
        if matches(lower, #"^(오전|오후|am|pm)?\s*\d{1,2}:\d{2}(\s*(am|pm))?$"#) { return true }
        if matches(lower, #"^\d{1,3}\s*%$"#) { return true }
        // "도보 5분", "걷기 12분", "5분", "1시간 20분", "350m", "1.2km"
        if matches(lower, #"^(도보|걷기|walk(ing)?)\s*\d+\s*(분|min|m|km)?$"#) { return true }
        if matches(lower, #"^(\d+\s*시간\s*)?\d+\s*분$"#) { return true }
        if matches(lower, #"^\d+(\.\d+)?\s*(m|km|min|hr|h)$"#) { return true }
        if matches(lower, #"^\d+\s*(분|min)\s*(후|전|남음)$"#) { return true }
        if matches(lower, #"^\d{1,3}(,\d{3})*\s*원$"#) { return true }
        return false
    }

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: .regularExpression) != nil
    }
}
