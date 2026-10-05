import Foundation

// Boarding-first setup on the catalog: destination, then "어디서 타요?", then
// only the buses that run from that stop to the destination. A rider thinks
// "I board here and get off there"; the old screen asked them to pick a route
// variant by its terminus and origin before they had said where they stand.
// Everything here is the catalog on the phone; nothing is live.

/// A place where the rider can board toward a destination: one name, one or
/// more provider stops (two poles with one name stay two stops).
public struct BoardingPlace: Hashable, Sendable, Identifiable {
    public var id: String { name }
    public let name: String
    public let stopIndexes: [Int]
    /// Variants that run from here to the destination.
    public let routeCount: Int
    /// The first stop's coordinates, for "내 근처" ordering; `nil` when the catalog has none.
    public let latitude: Double?
    public let longitude: Double?
}

/// One variant from a boarding place to a destination place.
public struct TripOption: Hashable, Sendable, Identifiable {
    public var id: String { "\(route.routeId)#\(boardingPosition)#\(destinationPosition)" }
    public let route: JejuTransitCatalog.Route
    public let boardingPosition: Int
    public let boardingSequence: Int
    public let boardingStopID: String
    public let boardingName: String
    public let destinationPosition: Int
    public let destinationSequence: Int
    public let destinationStopID: String
    public let destinationName: String
    public let terminus: String
    /// Stops ridden, boarding excluded, destination included.
    public var stopCount: Int { destinationPosition - boardingPosition }
}

extension DestinationSearchIndex {
    /// Every place from which some variant reaches `destination` later on its
    /// stop list, the destination itself excluded.
    public func boardingPlaces(toward destination: DestinationPlace) -> [BoardingPlace] {
        let targets = Set(destination.stopIndexes)
        var routesByStop: [Int: Set<String>] = [:]
        for route in catalog.routes {
            guard let last = route.stops.lastIndex(where: { targets.contains($0) }), last > 0 else { continue }
            for position in 0..<last where !targets.contains(route.stops[position]) {
                routesByStop[route.stops[position], default: []].insert(route.routeId)
            }
        }
        var byName: [String: (indexes: Set<Int>, routes: Set<String>)] = [:]
        for (stopIndex, routes) in routesByStop {
            let name = Self.placeName(catalog.stops[stopIndex].name)
            byName[name, default: ([], [])].indexes.insert(stopIndex)
            byName[name, default: ([], [])].routes.formUnion(routes)
        }
        return byName
            .map { name, value in
                let indexes = value.indexes.sorted()
                let located = indexes.lazy.map { self.catalog.stops[$0] }.first { $0.lat != nil && $0.lng != nil }
                return BoardingPlace(
                    name: name, stopIndexes: indexes, routeCount: value.routes.count,
                    latitude: located?.lat, longitude: located?.lng
                )
            }
            .sorted { $0.name < $1.name }
    }

    /// The same places, nearest first, for "내 근처". Places without coordinates go last.
    public static func nearest(_ places: [BoardingPlace], latitude: Double, longitude: Double, limit: Int = 5) -> [BoardingPlace] {
        func distance(_ place: BoardingPlace) -> Double {
            guard let lat = place.latitude, let lng = place.longitude else { return .infinity }
            // Equirectangular is plenty at Jeju's scale for ordering.
            let x = (lng - longitude) * cos((lat + latitude) / 2 * .pi / 180)
            let y = lat - latitude
            return x * x + y * y
        }
        return Array(places.sorted { distance($0) < distance($1) }.prefix(limit))
    }

    /// Places matching typed text, best first (same rules as destination search).
    public static func filter(_ places: [BoardingPlace], query: String, limit: Int = 40) -> [BoardingPlace] {
        let needle = StopNameMatcher.normalized(query)
        guard !needle.isEmpty else { return [] }
        let initialsOnly = needle.unicodeScalars.allSatisfy { (0x3131...0x314E).contains($0.value) }
        let ranked: [(Int, BoardingPlace)] = places.compactMap { place in
            let key = StopNameMatcher.normalized(place.name)
            if key == needle { return (0, place) }
            if key.hasPrefix(needle) { return (1, place) }
            if key.contains(needle) { return (2, place) }
            if initialsOnly, needle.count >= 2, initials(of: place.name).contains(needle) { return (3, place) }
            return nil
        }
        return ranked
            .sorted { $0.0 != $1.0 ? $0.0 < $1.0 : ($0.1.routeCount != $1.1.routeCount ? $0.1.routeCount > $1.1.routeCount : $0.1.name < $1.1.name) }
            .prefix(limit)
            .map(\.1)
    }

    /// Every variant that stops at `boarding` and later at `destination`. One
    /// option per variant: on a loop that passes either place twice, the
    /// shortest ride. Fewest stops first, then route number.
    public func trips(from boarding: BoardingPlace, to destination: DestinationPlace) -> [TripOption] {
        let boardSet = Set(boarding.stopIndexes)
        let destSet = Set(destination.stopIndexes)
        var options: [TripOption] = []
        for route in catalog.routes {
            var best: (board: Int, dest: Int)?
            var lastBoard: Int?
            for (position, stopIndex) in route.stops.enumerated() {
                if destSet.contains(stopIndex), let board = lastBoard {
                    if best == nil || position - board < best!.dest - best!.board { best = (board, position) }
                }
                if boardSet.contains(stopIndex) { lastBoard = position }
            }
            guard let best else { continue }
            let boardStop = catalog.stops[route.stops[best.board]]
            let destStop = catalog.stops[route.stops[best.dest]]
            options.append(TripOption(
                route: route,
                boardingPosition: best.board,
                boardingSequence: route.sequence(at: best.board),
                boardingStopID: boardStop.id,
                boardingName: boardStop.name,
                destinationPosition: best.dest,
                destinationSequence: route.sequence(at: best.dest),
                destinationStopID: destStop.id,
                destinationName: destStop.name,
                terminus: route.end ?? catalog.stops[route.stops[route.stops.count - 1]].name
            ))
        }
        return options.sorted {
            $0.stopCount != $1.stopCount ? $0.stopCount < $1.stopCount : Self.routeNumberOrder($0.route.routeNo, $1.route.routeNo)
        }
    }
}
