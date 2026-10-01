import Foundation

/// A place a rider handed to TAPSO from a map app's share sheet or by pasting.
///
/// Only what the shared content itself says: a name, an address, a coordinate.
/// TAPSO never fetches a shared link on the phone (`docs/product/MAP_HANDOFF_V3.md`);
/// a short link that needs the network to mean anything is kept as
/// `unresolvedLink` so the screen can say so.
public struct SharedPlace: Codable, Hashable, Sendable {
    public let source: SharedPlaceSource
    public let name: String?
    public let address: String?
    public let coordinate: Coordinate?
    /// A link that only the network could resolve (`kko.to`, `naver.me`, a place id). Never fetched here.
    public let unresolvedLink: String?

    public init(
        source: SharedPlaceSource,
        name: String? = nil,
        address: String? = nil,
        coordinate: Coordinate? = nil,
        unresolvedLink: String? = nil
    ) {
        self.source = source
        self.name = name
        self.address = address
        self.coordinate = coordinate
        self.unresolvedLink = unresolvedLink
    }

    /// `nil` when there is no coordinate to tell.
    public var isInJeju: Bool? { coordinate.map(JejuRegion.contains) }

    /// Nothing but a link: the rider has to search instead.
    public var isLinkOnly: Bool { name == nil && address == nil && coordinate == nil }

    /// The words a stop search can use.
    public var searchText: String {
        [name, address].compactMap { $0 }.joined(separator: " ")
    }
}

public enum SharedPlaceSource: String, Codable, Hashable, Sendable, CaseIterable {
    case kakaoMap
    case naverMap
    case appleMaps
    case googleMaps
    case geoURI
    case text
}

/// Jeju Special Self-Governing Province, generously: the main island, Udo,
/// Gapado, Marado and the Chuja islands. TAPSO is a Jeju product; a place
/// outside this box gets an honest "제주 밖이에요", not a bus search.
public enum JejuRegion {
    public static let latitude: ClosedRange<Double> = 33.0...34.1
    public static let longitude: ClosedRange<Double> = 126.0...127.1

    public static func contains(_ coordinate: Coordinate) -> Bool {
        latitude.contains(coordinate.latitude) && longitude.contains(coordinate.longitude)
    }
}

/// Reads shared map content on the device, with no network request.
///
/// URL shapes and their labels (`docs/product/MAP_HANDOFF_V3.md`):
/// - Apple Maps legacy `?q=&ll=&address=&daddr=` and unified `/place`,
///   `/directions`, `/search`, `/look-around` — VERIFIED, developer.apple.com.
/// - `geo:lat,lng` — RFC 5870.
/// - NAVER Map `nmap://place|search|route/*` — REPORTED-OFFICIAL (NAVER Cloud URL scheme guide).
/// - KakaoMap `kakaomap://route?ep=` — REPORTED-OFFICIAL (Kakao URL scheme guide);
///   `map.kakao.com/link/map|to|roadview|from|by|search/…` — REPORTED-OFFICIAL (Kakao Maps web
///   guide, quoted by `scripts/data-sources/tago-docs.ts` on 2026-10-01).
/// - Share text `[카카오맵] …` / `[네이버 지도] …` with a short link — REPORTED.
public enum SharedPlaceParser {
    public static func parse(text: String?, urls: [String] = []) -> SharedPlace? {
        let body = text ?? ""
        let links = (urls + linksIn(body)).reduce(into: [String]()) { list, link in
            if !list.contains(link) { list.append(link) }
        }
        var fromLinks = Partial()
        for link in links {
            fromLinks.merge(parseLink(link))
        }
        let fromText = parseText(body)

        let source = fromLinks.source ?? fromText.source ?? .text
        let name = fromText.name ?? fromLinks.name
        let address = fromText.address ?? fromLinks.address
        let coordinate = fromLinks.coordinate ?? fromText.coordinate
        let unresolved = fromLinks.unresolvedLink
        guard name != nil || address != nil || coordinate != nil || unresolved != nil else { return nil }
        return SharedPlace(source: source, name: name, address: address, coordinate: coordinate, unresolvedLink: unresolved)
    }

    // MARK: Links

    private struct Partial {
        var source: SharedPlaceSource?
        var name: String?
        var address: String?
        var coordinate: Coordinate?
        var unresolvedLink: String?

        mutating func merge(_ other: Partial) {
            source = source ?? other.source
            name = name ?? other.name
            address = address ?? other.address
            coordinate = coordinate ?? other.coordinate
            unresolvedLink = unresolvedLink ?? other.unresolvedLink
        }
    }

    private static func linksIn(_ text: String) -> [String] {
        let pattern = #"(?:https?://|nmap://|kakaomap://|geo:)[^\s<>"']+"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            Range(match.range, in: text).map { String(text[$0]).trimmingCharacters(in: CharacterSet(charactersIn: ".,)]")) }
        }
    }

    private static func parseLink(_ link: String) -> Partial {
        let lower = link.lowercased()
        if lower.hasPrefix("geo:") {
            let body = String(link.dropFirst(4)).split(separator: "?").first.map(String.init) ?? ""
            return Partial(source: .geoURI, coordinate: coordinate(body))
        }
        guard let components = URLComponents(string: link) else { return Partial() }
        let host = components.host?.lowercased() ?? ""
        let scheme = components.scheme?.lowercased() ?? ""
        let path = components.percentEncodedPath.removingPercentEncoding ?? components.path
        let query = { (name: String) -> String? in
            components.queryItems?.first { $0.name == name }?.value.flatMap { $0.isEmpty ? nil : $0 }
        }

        if scheme == "nmap" {
            switch host {
            case "place":
                let point = pair(query("lat"), query("lng"))
                return Partial(source: .naverMap, name: query("name"), coordinate: point)
            case "search":
                return Partial(source: .naverMap, name: query("query"))
            case "route":
                return Partial(source: .naverMap, name: query("dname"), coordinate: pair(query("dlat"), query("dlng")))
            default:
                return Partial(source: .naverMap)
            }
        }
        if scheme == "kakaomap" {
            return Partial(source: .kakaoMap, coordinate: query("ep").flatMap(coordinate))
        }

        switch host {
        case "maps.apple.com", "maps.apple":
            return appleMaps(path: path, query: query)
        case "map.kakao.com", "m.map.kakao.com":
            return kakaoWeb(path: path, link: link)
        case "kko.to", "place.map.kakao.com", "kakao.link":
            return Partial(source: .kakaoMap, unresolvedLink: link)
        case "naver.me":
            return Partial(source: .naverMap, unresolvedLink: link)
        case "map.naver.com", "m.map.naver.com", "m.place.naver.com", "pcmap.place.naver.com":
            if let searched = path.range(of: "/search/") {
                let rest = path[searched.upperBound...].split(separator: "/").first.map(String.init)
                return Partial(source: .naverMap, name: rest.flatMap(clean), unresolvedLink: link)
            }
            return Partial(source: .naverMap, unresolvedLink: link)
        case "maps.app.goo.gl", "goo.gl":
            return Partial(source: .googleMaps, unresolvedLink: link)
        case "maps.google.com", "www.google.com", "google.com":
            guard host != "www.google.com" && host != "google.com" || path.hasPrefix("/maps") else { return Partial() }
            if let q = query("q") ?? query("query") {
                if let point = coordinate(q) { return Partial(source: .googleMaps, coordinate: point) }
                return Partial(source: .googleMaps, name: clean(q))
            }
            return Partial(source: .googleMaps, unresolvedLink: link)
        default:
            return Partial()
        }
    }

    private static func appleMaps(path: String, query: (String) -> String?) -> Partial {
        switch path {
        case "/place", "/look-around":
            return Partial(source: .appleMaps, name: query("name").flatMap(clean), address: query("address").flatMap(clean), coordinate: query("coordinate").flatMap(coordinate))
        case "/directions":
            guard let destination = query("destination") else { return Partial(source: .appleMaps) }
            if let point = coordinate(destination) { return Partial(source: .appleMaps, coordinate: point) }
            return Partial(source: .appleMaps, name: clean(destination))
        case "/search":
            return Partial(source: .appleMaps, name: query("query").flatMap(clean))
        default:
            // Legacy map links: `q` names the place (or is a search), `ll` pins it, `address` and `daddr` locate it.
            var partial = Partial(source: .appleMaps)
            partial.coordinate = query("ll").flatMap(coordinate)
            if let q = query("q") {
                if let point = coordinate(q) { partial.coordinate = partial.coordinate ?? point } else { partial.name = clean(q) }
            }
            for key in ["address", "daddr"] {
                guard let value = query(key) else { continue }
                if let point = coordinate(value) { partial.coordinate = partial.coordinate ?? point } else { partial.address = partial.address ?? clean(value) }
            }
            return partial
        }
    }

    /// Kakao Maps web links (REPORTED-OFFICIAL, Kakao Maps web guide): `/link/map|to|roadview/<target>`,
    /// `/link/from/<origin>/to/<target>`, `/link/by/<mode>/<origin>/…/<target>` and `/link/search/<query>`,
    /// where a target is `<name>,<lat>,<lng>`, `<lat>,<lng>` or a place id.
    private static func kakaoWeb(path: String, link: String) -> Partial {
        let segments = path.split(separator: "/").map(String.init)
        guard segments.count >= 3, segments[0] == "link" else { return Partial(source: .kakaoMap, unresolvedLink: link) }
        switch segments[1] {
        case "map", "to", "roadview":
            return kakaoTarget(segments[2], link: link)
        case "from":
            guard let to = segments.firstIndex(of: "to"), to + 1 < segments.count else {
                return Partial(source: .kakaoMap, unresolvedLink: link)
            }
            return kakaoTarget(segments[to + 1], link: link)
        case "by":
            // The last segment is the destination; the ones before it are the origin and any waypoints.
            guard segments.count >= 4 else { return Partial(source: .kakaoMap, unresolvedLink: link) }
            return kakaoTarget(segments[segments.count - 1], link: link)
        case "search":
            return Partial(source: .kakaoMap, name: clean(segments[2...].joined(separator: "/")))
        default:
            return Partial(source: .kakaoMap, unresolvedLink: link)
        }
    }

    /// `<name>,<lat>,<lng>` or `<lat>,<lng>`. Anything else is a place id that only the network could resolve.
    private static func kakaoTarget(_ segment: String, link: String) -> Partial {
        let parts = segment.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
        if parts.count >= 3, let point = pair(parts[parts.count - 2], parts[parts.count - 1]) {
            return Partial(source: .kakaoMap, name: clean(parts.dropLast(2).joined(separator: ",")), coordinate: point)
        }
        if parts.count == 2, let point = pair(parts[0], parts[1]) {
            return Partial(source: .kakaoMap, coordinate: point)
        }
        return Partial(source: .kakaoMap, unresolvedLink: link)
    }

    // MARK: Text

    private static func parseText(_ text: String) -> Partial {
        var partial = Partial()
        var names: [String] = []
        for raw in text.components(separatedBy: .newlines) {
            // Links were read above; what is left of the line is words.
            var line = raw
            for link in linksIn(raw) {
                line = line.replacingOccurrences(of: link, with: " ")
            }
            line = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty else { continue }
            if let tag = sourceTag(in: line) {
                partial.source = partial.source ?? tag.source
                line = tag.remainder
                if line.isEmpty { continue }
            }
            if partial.coordinate == nil, let point = coordinate(line) {
                partial.coordinate = point
                continue
            }
            if partial.address == nil, isAddress(line) {
                partial.address = line
                continue
            }
            names.append(line)
        }
        partial.name = names.first.flatMap { $0.count <= 60 ? $0 : nil }
        return partial
    }

    private static func sourceTag(in line: String) -> (source: SharedPlaceSource, remainder: String)? {
        let tags: [(String, SharedPlaceSource)] = [
            ("[카카오맵]", .kakaoMap), ("[카카오 맵]", .kakaoMap), ("[KakaoMap]", .kakaoMap),
            ("[네이버 지도]", .naverMap), ("[네이버지도]", .naverMap), ("[NAVER Map]", .naverMap),
        ]
        for (tag, source) in tags where line.hasPrefix(tag) {
            return (source, line.dropFirst(tag.count).trimmingCharacters(in: .whitespaces))
        }
        return nil
    }

    /// A Jeju road-name or lot address: the province, or a city followed by a numbered road, village or district.
    private static func isAddress(_ line: String) -> Bool {
        if line.contains("제주특별자치도") { return true }
        let pattern = #"(제주시|서귀포시).*(로|길|읍|면|동|리)\s*[0-9]"#
        return line.range(of: pattern, options: .regularExpression) != nil
    }

    // MARK: Values

    /// `lat,lng`, or `lng,lat` when that is the only reading that lands in a plausible range.
    static func coordinate(_ text: String) -> Coordinate? {
        let pattern = #"(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)"#
        guard let match = text.range(of: pattern, options: .regularExpression) else { return nil }
        let numbers = text[match].split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard numbers.count == 2 else { return nil }
        return pair(numbers[0], numbers[1])
    }

    private static func pair(_ first: String?, _ second: String?) -> Coordinate? {
        guard let first, let second, let a = Double(first), let b = Double(second) else { return nil }
        return pair(a, b)
    }

    private static func pair(_ first: Double, _ second: Double) -> Coordinate? {
        guard first.isFinite, second.isFinite else { return nil }
        if abs(first) <= 90, abs(second) <= 180 {
            return Coordinate(latitude: first, longitude: second)
        }
        // `lng,lat`: only possible when the first value cannot be a latitude.
        if abs(second) <= 90, abs(first) <= 180 {
            return Coordinate(latitude: second, longitude: first)
        }
        return nil
    }

    private static func clean(_ text: String) -> String? {
        let decoded = (text.removingPercentEncoding ?? text)
            .replacingOccurrences(of: "+", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return decoded.isEmpty ? nil : decoded
    }
}
