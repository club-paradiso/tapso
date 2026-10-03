import Foundation

/// How well a name read from a screenshot fits a stop's real name.
public struct StopNameMatch: Hashable, Sendable {
    /// 0...1. 1 means the names agree once spacing, punctuation and `방면` qualifiers are set aside.
    public let similarity: Double

    public init(similarity: Double) {
        self.similarity = similarity
    }
}

/// Deterministic, Hangul-aware stop-name comparison. No model, no network.
///
/// - Spacing, punctuation and case never matter (`국립제주 트라우마 치유센터`).
/// - A parenthetical qualifier (`(아라방면)`) and a trailing `정류장` / `방면` are set
///   aside for the core comparison, with a small penalty when the qualifiers differ
///   or only one side has one.
/// - Syllables are compared as jamo, so `센타` is one edit from `센터`, not a whole
///   different syllable. Short names must match exactly: two edits turn
///   `제주시청` into `제주시장`, a different place.
/// - A line that wraps a whole stop name of four or more syllables
///   (`용담어린이집 승차`) is accepted at a lower similarity.
/// - `aliases` maps one normalised name to another for places known by two names.
///   TAPSO ships none by default: an alias is data and needs a source.
public struct StopNameSimilarity: Sendable {
    /// Below this, a pair is not a match.
    public static let acceptThreshold = 0.85
    /// At or above this, the pair is a strong match.
    public static let strongThreshold = 0.95

    private let aliases: [String: String]

    public init(aliases: [String: String] = [:]) {
        var normalized: [String: String] = [:]
        for (name, canonical) in aliases {
            normalized[StopNameMatcher.normalized(name)] = StopNameMatcher.normalized(canonical)
        }
        self.aliases = normalized
    }

    public func match(_ observed: String, to stopName: String) -> StopNameMatch? {
        let seen = key(observed)
        let stop = key(stopName)
        guard !seen.core.isEmpty, !stop.core.isEmpty else { return nil }

        var best: Double?
        if let whole = Self.score(seen.full, stop.full) {
            best = whole
        }
        if let core = Self.score(seen.core, stop.core) {
            var adjusted = core
            if !seen.qualifier.isEmpty, !stop.qualifier.isEmpty, seen.qualifier != stop.qualifier {
                adjusted = min(adjusted, 0.9)
            } else if seen.qualifier.isEmpty != stop.qualifier.isEmpty {
                adjusted = min(adjusted, 0.97)
            }
            best = max(best ?? 0, adjusted)
        }
        if best == nil, stop.core.count >= 4, seen.core.count > stop.core.count, seen.core.contains(stop.core) {
            best = Self.acceptThreshold
        }
        guard let best, best >= Self.acceptThreshold else { return nil }
        return StopNameMatch(similarity: best)
    }

    // MARK: Keys

    private struct Key {
        /// Everything, set aside only spacing and punctuation.
        let full: String
        /// Without parenthetical qualifiers and a trailing `정류장` / `방면` / `행`.
        let core: String
        let qualifier: String
    }

    private func key(_ text: String) -> Key {
        var coreText = ""
        var qualifierText = ""
        var depth = 0
        for character in text {
            if "([（［".contains(character) {
                depth += 1
            } else if ")]）］".contains(character) {
                depth = max(0, depth - 1)
            } else if depth > 0 {
                qualifierText.append(character)
            } else {
                coreText.append(character)
            }
        }
        var core = StopNameMatcher.normalized(coreText)
        for suffix in ["버스정류장", "정류장", "정류소", "승강장", "방면"] where core.hasSuffix(suffix) && core.count - suffix.count >= 2 {
            core = String(core.dropLast(suffix.count))
            break
        }
        if core.hasSuffix("행"), core.count >= 4 { core = String(core.dropLast()) }
        var qualifier = StopNameMatcher.normalized(qualifierText)
        if qualifier.hasSuffix("방면"), qualifier.count > 2 { qualifier = String(qualifier.dropLast(2)) }
        return Key(
            full: aliases[StopNameMatcher.normalized(text)] ?? StopNameMatcher.normalized(text),
            core: aliases[core] ?? core,
            qualifier: qualifier
        )
    }

    // MARK: Scoring

    /// 1 for equal strings; for near-equal ones `1 - edits / length` when the edits fit the allowance.
    private static func score(_ lhs: String, _ rhs: String) -> Double? {
        guard !lhs.isEmpty, !rhs.isEmpty else { return nil }
        if lhs == rhs { return 1 }
        let left = jamo(lhs), right = jamo(rhs)
        let length = max(left.count, right.count)
        let allowed = length < 10 ? 0 : (length < 18 ? 1 : 2)
        guard allowed > 0 else { return nil }
        let distance = editDistance(left, right)
        guard distance <= allowed else { return nil }
        return 1 - Double(distance) / Double(length)
    }

    /// Each Hangul syllable as its initial, vowel and final jamo; anything else as itself.
    static func jamo(_ text: String) -> [Int] {
        var units: [Int] = []
        for scalar in text.lowercased().unicodeScalars {
            let value = Int(scalar.value)
            if (0xAC00...0xD7A3).contains(value) {
                let index = value - 0xAC00
                units.append(index / 588)
                units.append(100 + (index % 588) / 28)
                let final = index % 28
                if final != 0 { units.append(200 + final) }
            } else {
                units.append(1000 + value)
            }
        }
        return units
    }

    static func editDistance(_ lhs: [Int], _ rhs: [Int]) -> Int {
        if lhs.isEmpty { return rhs.count }
        if rhs.isEmpty { return lhs.count }
        var previous = Array(0...rhs.count)
        for (i, left) in lhs.enumerated() {
            var current = [i + 1] + [Int](repeating: 0, count: rhs.count)
            for (j, right) in rhs.enumerated() {
                let substitution = previous[j] + (left == right ? 0 : 1)
                current[j + 1] = min(substitution, previous[j + 1] + 1, current[j] + 1)
            }
            previous = current
        }
        return previous[rhs.count]
    }
}
