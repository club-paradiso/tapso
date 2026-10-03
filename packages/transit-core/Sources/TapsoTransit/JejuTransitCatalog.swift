import Foundation

// The canonical Jeju transit catalog (`tapso-jeju-catalog-v1`), as
// `GET /v1/catalog` serves it: every official route variant TAGO names for
// Jeju with its ordered stops, built by a reviewed pipeline
// (`scripts/catalog/build-jeju-catalog.ts`). The app keeps it on the device
// and searches it locally, so a keystroke never costs a request.
//
// Identity is the provider's and is never collapsed: one variant per provider
// route ID ("202" and "202-1" are different routes, and each direction is its
// own variant), one stop per provider stop ID (two poles with one name stay two
// stops). Nothing here is live: the catalog is the route network, not a bus.

public struct JejuTransitCatalog: Codable, Hashable, Sendable {
    public static let schemaVersion = "tapso-jeju-catalog-v1"

    public struct Stop: Codable, Hashable, Sendable {
        public let id: String
        public let name: String
        public let lat: Double?
        public let lng: Double?

        public init(id: String, name: String, lat: Double? = nil, lng: Double? = nil) {
            self.id = id
            self.name = name
            self.lat = lat
            self.lng = lng
        }
    }

    public struct Route: Codable, Hashable, Sendable {
        public let routeId: String
        public let routeNo: String
        public let routeType: String?
        public let start: String?
        public let end: String?
        /// `linear`, `loop` or `repeating`.
        public let topology: String
        /// Indexes into `stops`, in provider order.
        public let stops: [Int]
        /// Provider sequences parallel to `stops`; absent means 1…n.
        public let sequences: [Int]?

        public init(routeId: String, routeNo: String, routeType: String? = nil, start: String? = nil, end: String? = nil, topology: String = "linear", stops: [Int], sequences: [Int]? = nil) {
            self.routeId = routeId
            self.routeNo = routeNo
            self.routeType = routeType
            self.start = start
            self.end = end
            self.topology = topology
            self.stops = stops
            self.sequences = sequences
        }

        /// The provider sequence of the stop at `position`.
        public func sequence(at position: Int) -> Int {
            sequences?[position] ?? position + 1
        }
    }

    public let schemaVersion: String
    public let label: String
    public let catalogVersion: String
    public let generatedAt: String
    public let stops: [Stop]
    public let routes: [Route]

    public init(schemaVersion: String = JejuTransitCatalog.schemaVersion, label: String = "OFFICIAL_DERIVED", catalogVersion: String, generatedAt: String, stops: [Stop], routes: [Route]) {
        self.schemaVersion = schemaVersion
        self.label = label
        self.catalogVersion = catalogVersion
        self.generatedAt = generatedAt
        self.stops = stops
        self.routes = routes
    }

    public enum Invalid: Error, Equatable {
        case schema(String)
        case route(String)
    }

    /// Decodes and checks a catalog the way the server validated it: the schema,
    /// every stop index in range, sequences strictly ascending. A catalog that
    /// fails is never used, and the cached one stays.
    public static func decode(_ data: Data) throws -> JejuTransitCatalog {
        let catalog = try JSONDecoder().decode(JejuTransitCatalog.self, from: data)
        guard catalog.schemaVersion == schemaVersion, catalog.label == "OFFICIAL_DERIVED" else { throw Invalid.schema(catalog.schemaVersion) }
        for route in catalog.routes {
            guard route.stops.count >= 2, route.stops.allSatisfy({ $0 >= 0 && $0 < catalog.stops.count }) else { throw Invalid.route(route.routeId) }
            if let sequences = route.sequences {
                guard sequences.count == route.stops.count, zip(sequences, sequences.dropFirst()).allSatisfy({ $0 < $1 }) else { throw Invalid.route(route.routeId) }
            }
        }
        return catalog
    }

    /// One variant as TAPSO's API names it: what the live setup starts from.
    public func apiRoute(_ route: Route) -> TransitAPIRoute {
        TransitAPIRoute(
            routeId: route.routeId,
            routeNumber: route.routeNo,
            startStopName: route.start ?? route.stops.first.map { stops[$0].name },
            endStopName: route.end ?? route.stops.last.map { stops[$0].name },
            routeType: route.routeType
        )
    }
}

/// A stop name as a rider would search it: one entry per name, gathering the
/// poles that share it ("시청[동]" and "시청[서]" are one place to get off,
/// two provider stops).
public struct DestinationPlace: Hashable, Sendable, Identifiable {
    public var id: String { name }
    /// The provider name without its direction marker ("[동]", "[서]").
    public let name: String
    /// Indexes into the catalog's stops, every pole with this name.
    public let stopIndexes: [Int]
    /// How many variants can drop a rider here (the stop is not their first).
    public let routeCount: Int
}

/// One way to reach a place: a variant, and where on it the place is.
public struct DestinationRouteOption: Hashable, Sendable, Identifiable {
    public var id: String { "\(route.routeId)#\(destinationPosition)" }
    public let route: JejuTransitCatalog.Route
    /// Position of the destination in the variant's stop list (0-based).
    public let destinationPosition: Int
    /// The provider sequence of the destination: what the live setup checks against.
    public let destinationSequence: Int
    public let destinationStopID: String
    public let destinationName: String
    /// Where the variant starts and ends, for its label.
    public let origin: String
    public let terminus: String
    /// Stops before the destination: where the rider can board.
    public let boardingCount: Int
    /// A stop that tells this variant apart from another with the same ends; `nil` when its ends already do.
    public let via: String?
}

/// Variants of one route number reaching the place, shown together but never merged.
public struct DestinationRouteGroup: Hashable, Sendable, Identifiable {
    public var id: String { routeNo }
    public let routeNo: String
    public let options: [DestinationRouteOption]
}

/// Local search over the catalog: no request per keystroke, no invented stop.
public struct DestinationSearchIndex: Sendable {
    public let catalog: JejuTransitCatalog
    public let places: [DestinationPlace]
    private let keys: [(normalized: String, initials: String)]

    public init(catalog: JejuTransitCatalog) {
        self.catalog = catalog
        var byName: [String: [Int]] = [:]
        for (index, stop) in catalog.stops.enumerated() {
            byName[Self.placeName(stop.name), default: []].append(index)
        }
        // A place can be a destination only where some variant stops there after its first stop.
        var reachable: [Int: Set<String>] = [:]
        for route in catalog.routes {
            for position in route.stops.indices.dropFirst() {
                reachable[route.stops[position], default: []].insert(route.routeId)
            }
        }
        let places = byName
            .map { name, indexes in
                DestinationPlace(
                    name: name,
                    stopIndexes: indexes.sorted(),
                    routeCount: indexes.reduce(into: Set<String>()) { $0.formUnion(reachable[$1] ?? []) }.count
                )
            }
            .filter { $0.routeCount > 0 }
            .sorted { $0.name < $1.name }
        self.places = places
        keys = places.map { (StopNameMatcher.normalized($0.name), Self.initials(of: $0.name)) }
    }

    /// The name a rider searches: the provider's, without a trailing compass
    /// marker ("[동]", "[서]", "[남]", "[북]") that tells two poles of one place
    /// apart. Any other bracket ("색달동[야크마을]") is part of the name.
    public static func placeName(_ providerName: String) -> String {
        var name = providerName.trimmingCharacters(in: .whitespaces)
        if let range = name.range(of: #"\s*\[(동|서|남|북)\]$"#, options: .regularExpression) {
            name.removeSubrange(range)
        }
        return name.isEmpty ? providerName : name
    }

    /// Places whose name contains the query: exact first, then prefix, then
    /// anywhere, then by initial consonants ("ㅈㅈㄷ" finds 제주대); ties by how
    /// many routes reach the place. Whitespace and punctuation never matter.
    public func search(_ query: String, limit: Int = 40) -> [DestinationPlace] {
        let needle = StopNameMatcher.normalized(query)
        guard !needle.isEmpty else { return [] }
        let initialsOnly = needle.unicodeScalars.allSatisfy { (0x3131...0x314E).contains($0.value) }
        var scored: [(rank: Int, place: DestinationPlace)] = []
        for (index, place) in places.enumerated() {
            let key = keys[index]
            let rank: Int?
            if key.normalized == needle { rank = 0 }
            else if key.normalized.hasPrefix(needle) { rank = 1 }
            else if key.normalized.contains(needle) { rank = 2 }
            else if initialsOnly, needle.count >= 2, key.initials.contains(needle) { rank = 3 }
            else { rank = nil }
            if let rank { scored.append((rank, place)) }
        }
        return scored
            .sorted { left, right in
                if left.rank != right.rank { return left.rank < right.rank }
                if left.place.routeCount != right.place.routeCount { return left.place.routeCount > right.place.routeCount }
                return left.place.name < right.place.name
            }
            .prefix(limit)
            .map(\.place)
    }

    /// Every variant that can drop the rider at the place, grouped by route
    /// number. A variant where the place is its first stop is left out (nowhere
    /// to board before it); a variant that stops there twice offers each stop.
    public func routeOptions(to place: DestinationPlace) -> [DestinationRouteGroup] {
        let targets = Set(place.stopIndexes)
        var options: [DestinationRouteOption] = []
        for route in catalog.routes {
            for position in route.stops.indices.dropFirst() where targets.contains(route.stops[position]) {
                let stop = catalog.stops[route.stops[position]]
                options.append(DestinationRouteOption(
                    route: route,
                    destinationPosition: position,
                    destinationSequence: route.sequence(at: position),
                    destinationStopID: stop.id,
                    destinationName: stop.name,
                    origin: route.start ?? catalog.stops[route.stops[0]].name,
                    terminus: route.end ?? catalog.stops[route.stops[route.stops.count - 1]].name,
                    boardingCount: position,
                    via: nil
                ))
            }
        }
        let grouped = Dictionary(grouping: options, by: { $0.route.routeNo })
        return grouped
            .map { routeNo, list in DestinationRouteGroup(routeNo: routeNo, options: disambiguate(list.sorted(by: Self.optionOrder))) }
            .sorted { Self.routeNumberOrder($0.routeNo, $1.routeNo) }
    }

    /// The ordered stops of one variant, as the live setup's route model.
    public func transitRoute(_ route: JejuTransitCatalog.Route) -> TransitRoute {
        let stops = route.stops.enumerated().map { position, index in
            let stop = catalog.stops[index]
            return TransitAPIStop(stopId: stop.id, name: stop.name, sequence: route.sequence(at: position), latitude: stop.lat, longitude: stop.lng)
        }
        return TransitRoute.live(catalog.apiRoute(route), stops: stops).route
    }

    private func disambiguate(_ options: [DestinationRouteOption]) -> [DestinationRouteOption] {
        options.map { option in
            let twins = options.filter { $0.id != option.id && $0.origin == option.origin && $0.terminus == option.terminus }
            guard !twins.isEmpty else { return option }
            // The first stop this variant serves that a same-ended twin does not.
            let mine = option.route.stops.map { catalog.stops[$0].name }
            let theirs = Set(twins.flatMap { $0.route.stops.map { catalog.stops[$0].name } })
            let via = mine.first { !theirs.contains($0) }
            return DestinationRouteOption(
                route: option.route,
                destinationPosition: option.destinationPosition,
                destinationSequence: option.destinationSequence,
                destinationStopID: option.destinationStopID,
                destinationName: option.destinationName,
                origin: option.origin,
                terminus: option.terminus,
                boardingCount: option.boardingCount,
                via: via
            )
        }
    }

    private static func optionOrder(_ left: DestinationRouteOption, _ right: DestinationRouteOption) -> Bool {
        if left.terminus != right.terminus { return left.terminus < right.terminus }
        if left.origin != right.origin { return left.origin < right.origin }
        if left.route.routeId != right.route.routeId { return left.route.routeId < right.route.routeId }
        return left.destinationPosition < right.destinationPosition
    }

    /// "101" before "102" before "102-1" before "1100"; anything unnumbered after, by text.
    public static func routeNumberOrder(_ left: String, _ right: String) -> Bool {
        let parse: (String) -> (Int, Int)? = { text in
            let parts = text.split(separator: "-", maxSplits: 1).map(String.init)
            guard let base = Int(parts[0]) else { return nil }
            return (base, parts.count > 1 ? Int(parts[1]) ?? Int.max : -1)
        }
        switch (parse(left), parse(right)) {
        case let (l?, r?): return l != r ? (l.0, l.1) < (r.0, r.1) : left < right
        case (.some, .none): return true
        case (.none, .some): return false
        default: return left < right
        }
    }

    /// Initial consonants of Hangul syllables, other characters kept as normalized.
    static func initials(of name: String) -> String {
        let table: [Character] = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"]
        var out = ""
        for scalar in StopNameMatcher.normalized(name).unicodeScalars {
            if (0xAC00...0xD7A3).contains(scalar.value) {
                out.append(table[Int((scalar.value - 0xAC00) / 588)])
            } else {
                out.unicodeScalars.append(scalar)
            }
        }
        return out
    }
}
