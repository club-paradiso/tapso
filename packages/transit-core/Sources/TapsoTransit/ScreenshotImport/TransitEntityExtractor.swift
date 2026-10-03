import Foundation

/// A bus number a screenshot may show. A guess until a route of that number exists in TAPSO's data.
public struct BusNumberCandidate: Codable, Hashable, Sendable {
    public let number: String
    /// The text read `44O` and TAPSO read `440`: only trusted when route data and stops back it up.
    public let wasCorrected: Bool
    /// Followed by `번`, or preceded by `버스`: more likely a route than an address number.
    public let hasBusContext: Bool
    public let confidence: Double

    public init(number: String, wasCorrected: Bool, hasBusContext: Bool, confidence: Double) {
        self.number = number
        self.wasCorrected = wasCorrected
        self.hasBusContext = hasBusContext
        self.confidence = confidence
    }
}

public enum StopLineRole: String, Codable, Hashable, Sendable {
    case plain
    /// Labelled `출발` / `출발지`.
    case origin
    /// Labelled `도착` / `도착지` / `목적지`.
    case destination
}

/// A line that may name a stop, in the order the screenshot shows them.
public struct StopNameCandidate: Codable, Hashable, Sendable {
    public let text: String
    public let role: StopLineRole
    public let confidence: Double

    public init(text: String, role: StopLineRole = .plain, confidence: Double) {
        self.text = text
        self.role = role
        self.confidence = confidence
    }
}

/// What a screenshot says, as claims to verify. Produced by an interpreter
/// (local OCR today; a remote model could produce the same shape later) and
/// consumed only by `RouteImportResolver`, which treats every field as untrusted.
public struct ScreenshotReading: Codable, Hashable, Sendable {
    /// Ranked, most likely first, at most `TransitEntityExtractor.maxBusNumbers`.
    public let busNumbers: [BusNumberCandidate]
    public let stopLines: [StopNameCandidate]
    /// Mean recogniser confidence over the kept lines; 0 when nothing was read.
    public let ocrConfidence: Double
    public let lineCount: Int

    public init(busNumbers: [BusNumberCandidate], stopLines: [StopNameCandidate], ocrConfidence: Double, lineCount: Int) {
        self.busNumbers = busNumbers
        self.stopLines = stopLines
        self.ocrConfidence = ocrConfidence
        self.lineCount = lineCount
    }

    /// Worth handing to the app: a bus number and at least one line that may name a stop.
    /// Anything less cannot become a route, so a share extension says so instead of saving it.
    public var isUsable: Bool { !busNumbers.isEmpty && !stopLines.isEmpty }

    public static let empty = ScreenshotReading(busNumbers: [], stopLines: [], ocrConfidence: 0, lineCount: 0)
}

/// Finds bus-number and stop-name claims in cleaned lines. Deterministic, no
/// network, no knowledge of TAPSO's routes: that is the resolver's job.
public enum TransitEntityExtractor {
    public static let maxBusNumbers = 4

    public static func reading(from lines: [NormalizedLine]) -> ScreenshotReading {
        guard !lines.isEmpty else { return .empty }
        var numbers: [BusNumberCandidate] = []
        var stops: [StopNameCandidate] = []
        var pendingRole: StopLineRole?
        var seenStopKeys = Set<String>()

        for line in lines {
            let scan = scanBusNumbers(in: line)
            numbers.append(contentsOf: scan.candidates)
            var text = scan.remainder
            var role = StopLineRole.plain

            switch label(in: text) {
            case .timeOnly:
                // "도착 3:20" is an arrival time, not a place.
                pendingRole = nil
                continue
            case let .alone(labelRole):
                // A label alone: the next line is the place it names.
                pendingRole = labelRole
                continue
            case let .withText(labelRole, remainder):
                role = labelRole
                text = remainder
            case .absent:
                if let pending = pendingRole { role = pending }
            }
            pendingRole = nil

            guard isStopLike(text) else { continue }
            // A map label repeats a name the list already showed: keep the first.
            guard seenStopKeys.insert(compactKey(text)).inserted else { continue }
            stops.append(StopNameCandidate(text: text, role: role, confidence: line.confidence))
        }

        let mean = lines.map(\.confidence).reduce(0, +) / Double(lines.count)
        return ScreenshotReading(
            busNumbers: rank(numbers),
            stopLines: stops,
            ocrConfidence: mean,
            lineCount: lines.count
        )
    }

    // MARK: Bus numbers

    private struct Scan {
        let candidates: [BusNumberCandidate]
        /// The line without the numbers, `번` and `버스` words: what is left may name a stop.
        let remainder: String
    }

    private static let unitsAfterNumber = ["분", "정거장", "정류장", "개", "명", "원", "km", "m", "%", "시간", "초", "층", "호", "출구", "출입구", "승강장", "번째", "번 출구", "번출구"]
    private static let confusable: [Character: Character] = ["O": "0", "o": "0", "I": "1", "l": "1"]

    private static func scanBusNumbers(in line: NormalizedLine) -> Scan {
        let characters = Array(line.text)
        var candidates: [BusNumberCandidate] = []
        var removed = [Bool](repeating: false, count: characters.count)
        var index = 0
        while index < characters.count {
            guard isASCIIAlphanumeric(characters[index]) else { index += 1; continue }
            var end = index
            while end < characters.count, isASCIIAlphanumeric(characters[end]) { end += 1 }
            let token = Array(characters[index..<end])
            defer { index = end }

            guard (2...4).contains(token.count), token.allSatisfy({ $0.isNumber || confusable[$0] != nil }) else { continue }
            let digits = token.filter { $0.isNumber && $0.isASCII }.count
            guard digits >= 2 else { continue }

            // Times (9:41), decimals (1.2) and ranges (3-5) are not route numbers.
            if index > 0, [":", ".", "-", ","].contains(characters[index - 1]) { continue }
            if end < characters.count, [":", ".", "-"].contains(characters[end]) { continue }

            let after = String(characters[end...]).drop(while: { $0 == " " })
            let hasNumberWord = after.hasPrefix("번") && !after.hasPrefix("번째") && !after.hasPrefix("번 출구") && !after.hasPrefix("번출구")
            if !hasNumberWord, unitsAfterNumber.contains(where: { after.hasPrefix($0) }) { continue }
            let before = String(characters[..<index]).trimmingCharacters(in: .whitespaces)
            let hasBusWord = before.hasSuffix("버스") || before.lowercased().hasSuffix("bus")

            let corrected = String(token.map { confusable[$0] ?? $0 })
            candidates.append(BusNumberCandidate(
                number: corrected,
                wasCorrected: corrected != String(token),
                hasBusContext: hasNumberWord || hasBusWord,
                confidence: line.confidence
            ))
            for position in index..<end { removed[position] = true }
            if hasNumberWord {
                var position = end
                while position < characters.count, characters[position] == " " { position += 1 }
                if position < characters.count, characters[position] == "번" { removed[position] = true }
            }
        }
        var remainder = ""
        for (position, character) in characters.enumerated() where !removed[position] {
            remainder.append(character)
        }
        // The standalone word `버스` goes; a name that contains it (제주버스터미널) stays whole.
        remainder = remainder
            .split(whereSeparator: { $0.isWhitespace })
            .filter { $0 != "버스" && $0.lowercased() != "bus" }
            .joined(separator: " ")
        return Scan(candidates: candidates, remainder: remainder)
    }

    private static func isASCIIAlphanumeric(_ character: Character) -> Bool {
        character.isASCII && (character.isLetter || character.isNumber)
    }

    /// Most likely first: bus context, then 3–4 digits, then recogniser confidence, then reading order.
    /// The same number twice keeps its best reading.
    private static func rank(_ candidates: [BusNumberCandidate]) -> [BusNumberCandidate] {
        var best: [String: (candidate: BusNumberCandidate, order: Int)] = [:]
        for (order, candidate) in candidates.enumerated() {
            if let existing = best[candidate.number], weight(existing.candidate) >= weight(candidate) { continue }
            best[candidate.number] = (candidate, best[candidate.number]?.order ?? order)
        }
        return best.values
            .sorted { lhs, rhs in
                let left = weight(lhs.candidate), right = weight(rhs.candidate)
                return left != right ? left > right : lhs.order < rhs.order
            }
            .prefix(maxBusNumbers)
            .map { $0.candidate }
    }

    private static func weight(_ candidate: BusNumberCandidate) -> Double {
        (candidate.hasBusContext ? 2 : 0)
            + (candidate.number.count >= 3 ? 1 : 0)
            + (candidate.wasCorrected ? 0 : 0.5)
            + candidate.confidence
    }

    // MARK: Labels and stop-like lines

    private static let labels: [(String, StopLineRole)] = [
        ("출발지", .origin), ("출발", .origin), ("도착지", .destination), ("도착", .destination), ("목적지", .destination),
        ("from", .origin), ("to", .destination),
    ]

    private enum LabelReading {
        case absent
        case alone(StopLineRole)
        case withText(StopLineRole, String)
        case timeOnly
    }

    /// `출발`, `도착: 용담어린이집`, `도착 용담어린이집`. A time after the label ("도착 3:20") is not a place.
    private static func label(in line: String) -> LabelReading {
        let lower = line.lowercased()
        for (word, role) in labels {
            guard lower.hasPrefix(word) else { continue }
            let rest = String(line.dropFirst(word.count))
            if rest.isEmpty { return .alone(role) }
            guard let first = rest.first, first == " " || first == ":" else { continue }
            let remainder = rest.drop(while: { $0 == " " || $0 == ":" }).trimmingCharacters(in: .whitespaces)
            if remainder.isEmpty { return .alone(role) }
            if remainder.range(of: #"^(오전|오후)?\s*\d{1,2}:\d{2}"#, options: .regularExpression) != nil { return .timeOnly }
            return .withText(role, remainder)
        }
        return .absent
    }

    /// Worth trying against the stop list: has at least two letters of a script that names stops.
    private static func isStopLike(_ text: String) -> Bool {
        let letters = text.unicodeScalars.filter { CharacterSet.letters.contains($0) }
        return letters.count >= 2 && text.count <= 40 && !text.contains(":")
    }

    private static func compactKey(_ text: String) -> String {
        StopNameMatcher.normalized(text)
    }
}
