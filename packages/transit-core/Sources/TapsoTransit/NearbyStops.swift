import Foundation

// "I don't know the stop's name, but I know where I'm going": a place or
// address the rider typed, resolved to a coordinate on the phone (MapKit), is
// turned here into the catalog's own stops near it. Nothing is invented: every
// result is a destination place the search index already offers, and the
// distance is a straight line, labelled as approximate wherever it is shown.

/// A catalog place near a coordinate, with how far its nearest pole is.
public struct NearbyPlace: Hashable, Sendable, Identifiable {
    public var id: String { place.name }
    public let place: DestinationPlace
    /// Straight-line distance to the nearest pole of the place, in meters.
    public let distanceMeters: Int
    /// A walking estimate from that distance; never a routed walk.
    public let walkMinutes: Int
}

public enum NearbyStops {
    /// Jeju Island and its inhabited islets (Udo, Gapado, Marado, Chujado): a coordinate
    /// outside this box is not a place a Jeju bus can take you near, so no stop is offered.
    public static let jejuLatitude: ClosedRange<Double> = 33.08...34.05
    public static let jejuLongitude: ClosedRange<Double> = 126.08...127.0

    /// Default search radius: about a ten-minute walk.
    public static let defaultRadiusMeters: Double = 800
    /// Walking speed and the factor that turns a straight line into a street walk.
    static let metersPerMinute: Double = 75
    static let detourFactor: Double = 1.3

    public static func isInJeju(latitude: Double, longitude: Double) -> Bool {
        jejuLatitude.contains(latitude) && jejuLongitude.contains(longitude)
    }

    /// Great-circle distance in meters.
    public static func distanceMeters(_ lat1: Double, _ lng1: Double, _ lat2: Double, _ lng2: Double) -> Double {
        let earth = 6_371_000.0
        let rad = Double.pi / 180
        let dLat = (lat2 - lat1) * rad
        let dLng = (lng2 - lng1) * rad
        let a = sin(dLat / 2) * sin(dLat / 2) + cos(lat1 * rad) * cos(lat2 * rad) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * earth * asin(min(1, sqrt(a)))
    }

    /// Minutes on foot for a straight-line distance, rounded up, at least one.
    public static func walkMinutes(forStraightLine meters: Double) -> Int {
        max(1, Int((meters * detourFactor / metersPerMinute).rounded(.up)))
    }
}

extension DestinationSearchIndex {
    /// Destination places with a pole within `radiusMeters` of the coordinate,
    /// nearest first (ties by how many routes reach them). A pole without a
    /// coordinate is never guessed at; a coordinate outside Jeju finds nothing.
    public func places(nearLatitude latitude: Double, longitude: Double, radiusMeters: Double = NearbyStops.defaultRadiusMeters, limit: Int = 5) -> [NearbyPlace] {
        guard NearbyStops.isInJeju(latitude: latitude, longitude: longitude), radiusMeters > 0, limit > 0 else { return [] }
        var found: [NearbyPlace] = []
        for place in places {
            let nearest = place.stopIndexes.compactMap { index -> Double? in
                let stop = catalog.stops[index]
                guard let lat = stop.lat, let lng = stop.lng else { return nil }
                return NearbyStops.distanceMeters(latitude, longitude, lat, lng)
            }.min()
            guard let nearest, nearest <= radiusMeters else { continue }
            found.append(NearbyPlace(
                place: place,
                distanceMeters: Int(nearest.rounded()),
                walkMinutes: NearbyStops.walkMinutes(forStraightLine: nearest)
            ))
        }
        return Array(found.sorted { left, right in
            if left.distanceMeters != right.distanceMeters { return left.distanceMeters < right.distanceMeters }
            if left.place.routeCount != right.place.routeCount { return left.place.routeCount > right.place.routeCount }
            return left.place.name < right.place.name
        }.prefix(limit))
    }
}
