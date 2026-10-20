import Foundation

/// The language a journey speaks on every surface: the app, the Lock Screen and
/// Dynamic Island (`TapsoActivityAttributes.language`) and the server's Live
/// Activity alerts (`POST /v1/sessions` `language`, `MILESTONE_ALERTS_BY_LANGUAGE`).
///
/// It is fixed when the ride starts, from the language the app is actually
/// rendering in (`Bundle.main.preferredLocalizations`, which already reflects the
/// rider's per-app language in Settings), so the surfaces cannot drift apart
/// mid-ride. Official Korean stop names are never translated by it.
public enum JourneyLanguage: String, CaseIterable, Codable, Sendable {
    case ko
    case en
    case zhHans = "zh-Hans"
    case ja

    /// The first supported language among `identifiers` (most preferred first), by
    /// language code: `zh-Hans-CN` and `zh-Hans` read as Simplified Chinese, `ja-JP`
    /// as Japanese. Traditional Chinese is not supported and falls through, like any
    /// other language, to English, the tourist lingua franca.
    public static func resolve(_ identifiers: [String]) -> JourneyLanguage {
        for identifier in identifiers {
            if let language = match(identifier) { return language }
        }
        return .en
    }

    private static func match(_ identifier: String) -> JourneyLanguage? {
        let parts = identifier.replacingOccurrences(of: "_", with: "-").split(separator: "-").map { $0.lowercased() }
        guard let code = parts.first else { return nil }
        switch code {
        case "ko": return .ko
        case "en": return .en
        case "ja": return .ja
        case "zh":
            // Only Simplified: an explicit Hans script, or a mainland/Singapore region with no script.
            if parts.contains("hans") { return .zhHans }
            if parts.contains("hant") { return nil }
            return parts.count == 1 || parts.contains("cn") || parts.contains("sg") ? .zhHans : nil
        default: return nil
        }
    }

    /// The locale a surface renders this language's strings with.
    public var locale: Locale { Locale(identifier: rawValue) }
}
