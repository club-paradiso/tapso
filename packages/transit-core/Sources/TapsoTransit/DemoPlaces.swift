import Foundation

/// SYNTHETIC. Places and addresses the demo's destination search can look up,
/// so the "don't know the stop, know the place" flow can be rehearsed with no
/// network. Names echo Jeju places, but every coordinate is invented and set
/// beside a `DemoFixtures` stop (themselves invented); none is a real position.
public struct DemoPlace: Hashable, Sendable, Identifiable {
    public var id: String { name }
    public let name: String
    public let address: String?
    public let latitude: Double
    public let longitude: Double
}

/// A demo destination near a demo place.
public struct DemoNearbyStop: Hashable, Sendable, Identifiable {
    public var id: String { name }
    public let name: String
    public let distanceMeters: Int
    public let walkMinutes: Int
}

extension DemoCatalog {
    public static let places: [DemoPlace] = [
        DemoPlace(name: "동문시장", address: "샘플 주소 · 동문로", latitude: 33.5084, longitude: 126.5214),
        DemoPlace(name: "목관아", address: "샘플 주소 · 관덕로", latitude: 33.5047, longitude: 126.5193),
        DemoPlace(name: "제주시청 종합민원실", address: "샘플 주소 · 광양9길", latitude: 33.5113, longitude: 126.5240),
        DemoPlace(name: "제주시 중앙로 14", address: nil, latitude: 33.5063, longitude: 126.5203),
        // Far from every demo stop: shows what happens when nothing is in walking distance.
        DemoPlace(name: "합성오름", address: "샘플 주소 · 오름길", latitude: 33.4000, longitude: 126.6000),
    ]

    /// Places whose name or address contains the query, ignoring spaces and punctuation.
    public static func searchPlaces(_ query: String) -> [DemoPlace] {
        let needle = StopNameMatcher.normalized(query)
        guard needle.count >= 2 else { return [] }
        return places.filter { place in
            StopNameMatcher.normalized(place.name).contains(needle)
                || StopNameMatcher.normalized(place.address ?? "").contains(needle)
        }
    }

    /// Demo destinations within `radiusMeters` of a coordinate, nearest first,
    /// with the same straight-line distance and walk estimate the real search uses.
    public static func nearbyDestinations(latitude: Double, longitude: Double, radiusMeters: Double = NearbyStops.defaultRadiusMeters, limit: Int = 5) -> [DemoNearbyStop] {
        guard radiusMeters > 0, limit > 0 else { return [] }
        var nearest: [String: Double] = [:]
        for route in routes {
            for routeStop in route.stops {
                let name = routeStop.stop.name
                guard !routeOptions(toDestinationNamed: name).isEmpty else { continue }
                let meters = NearbyStops.distanceMeters(latitude, longitude, routeStop.stop.coordinate.latitude, routeStop.stop.coordinate.longitude)
                nearest[name] = min(nearest[name] ?? .infinity, meters)
            }
        }
        return nearest
            .filter { $0.value <= radiusMeters }
            .sorted { $0.value != $1.value ? $0.value < $1.value : $0.key < $1.key }
            .prefix(limit)
            .map { DemoNearbyStop(name: $0.key, distanceMeters: Int($0.value.rounded()), walkMinutes: NearbyStops.walkMinutes(forStraightLine: $0.value)) }
    }
}
