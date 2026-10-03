import Foundation

/// Finds stop names inside text shared from another app, without any network request.
///
/// A map app's share sheet sends a place name and a short link. The link would
/// need a request to resolve, so TAPSO reads only the words, and the rider
/// confirms what it found.
public enum StopNameMatcher {
    public static func normalized(_ text: String) -> String {
        let removable = CharacterSet.whitespacesAndNewlines
            .union(.punctuationCharacters)
            .union(.symbols)
            .union(CharacterSet(charactersIn: "·•ㆍ"))
        return String(text.lowercased().unicodeScalars.filter { !removable.contains($0) })
    }

    /// Stop names that appear in `text`, longest first so the most specific wins.
    public static func matches(in text: String, among names: [String]) -> [String] {
        let haystack = normalized(text)
        guard !haystack.isEmpty else { return [] }
        return names
            .filter { name in
                let needle = normalized(name)
                return needle.count >= 2 && haystack.contains(needle)
            }
            .sorted { normalized($0).count > normalized($1).count }
    }
}
