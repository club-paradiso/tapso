import Foundation

// "Which bus comes first?" across different route variants. A stop count is
// not comparable between routes: on the 2026-10-03 catalog, from 제주대학교병원
// toward 제주지방법원, route 111's stops average about 4 km apart and route
// 212's about 0.6 km, so "2 stops away" on 111 can be farther than "6 stops
// away" on 212. Buses are therefore ranked by the distance they still have to
// travel along their own route, summed stop to stop from the catalog's
// coordinates. That is a distance, never a promised time: traffic and dwell
// are unknown, and the UI says "nearest", not "fastest".

/// Where a variant's nearest approaching bus is, relative to the boarding stop.
public struct TripApproach: Hashable, Sendable {
    /// Stops between the bus and the boarding stop (0: at the stop).
    public let stopsAway: Int
    /// Metres along the route from the bus's stop to the boarding stop, or
    /// `nil` when a stop on the way has no coordinate (never guessed).
    public let metersAway: Int?

    public init(stopsAway: Int, metersAway: Int?) {
        self.stopsAway = stopsAway
        self.metersAway = metersAway
    }
}

extension DestinationSearchIndex {
    /// Metres along `route` from the stop at `from` to the stop at `to`
    /// (positions, `from <= to`), summed segment by segment; `nil` if any stop
    /// in between has no coordinate.
    public func metersAlong(_ route: JejuTransitCatalog.Route, from: Int, to: Int) -> Double? {
        guard from >= 0, to < route.stops.count, from <= to else { return nil }
        var total = 0.0
        var position = from
        while position < to {
            let a = catalog.stops[route.stops[position]]
            let b = catalog.stops[route.stops[position + 1]]
            guard let aLat = a.lat, let aLng = a.lng, let bLat = b.lat, let bLng = b.lng else { return nil }
            total += NearbyStops.distanceMeters(aLat, aLng, bLat, bLng)
            position += 1
        }
        return total
    }

    /// The nearest bus still coming to the trip's boarding stop, from the
    /// provider stop sequences its buses report. A bus past the stop, beyond
    /// `horizonStops`, or on a sequence the variant does not list is ignored.
    /// Nearest means least distance along the route when every candidate has
    /// one, else fewest stops.
    public func approach(of trip: TripOption, vehicleSequences: [Int?], horizonStops: Int = StopNudge.horizonStops) -> TripApproach? {
        let route = trip.route
        var positionBySequence: [Int: Int] = [:]
        for position in 0...trip.boardingPosition {
            positionBySequence[route.sequence(at: position)] = position
        }
        let candidates: [TripApproach] = vehicleSequences.compactMap { sequence in
            guard let sequence, let position = positionBySequence[sequence] else { return nil }
            let stops = trip.boardingPosition - position
            guard stops >= 0, stops <= horizonStops else { return nil }
            let meters = metersAlong(route, from: position, to: trip.boardingPosition).map { Int($0.rounded()) }
            return TripApproach(stopsAway: stops, metersAway: meters)
        }
        return candidates.min(by: TripApproach.nearer)
    }

    /// Which variants to ask about first when only `budget` reads are allowed:
    /// one variant per route number in turn (the given order within a number),
    /// so every number gets a look before any number gets a second one.
    public static func arrivalCheckOrder(_ trips: [TripOption], budget: Int) -> [TripOption] {
        guard budget > 0 else { return [] }
        var queues: [String: [TripOption]] = [:]
        var numbers: [String] = []
        for trip in trips {
            if queues[trip.route.routeNo] == nil { numbers.append(trip.route.routeNo) }
            queues[trip.route.routeNo, default: []].append(trip)
        }
        var picked: [TripOption] = []
        var round = 0
        while picked.count < budget {
            var added = false
            for number in numbers {
                guard let queue = queues[number], round < queue.count else { continue }
                picked.append(queue[round])
                added = true
                if picked.count == budget { break }
            }
            if !added { break }
            round += 1
        }
        return picked
    }
}

extension TripApproach {
    /// True when `left` is nearer the boarding stop than `right`.
    public static func nearer(_ left: TripApproach, _ right: TripApproach) -> Bool {
        if let l = left.metersAway, let r = right.metersAway, l != r { return l < r }
        return left.stopsAway < right.stopsAway
    }

    /// Trips with an approaching bus first, nearest first; the rest keep their
    /// given order (ride length). Ties keep the given order too.
    public static func nearestFirst(_ trips: [TripOption], approaches: [String: TripApproach]) -> [TripOption] {
        trips.enumerated().sorted { left, right in
            switch (approaches[left.element.id], approaches[right.element.id]) {
            case let (l?, r?):
                if nearer(l, r) { return true }
                if nearer(r, l) { return false }
                return left.offset < right.offset
            case (.some, .none): return true
            case (.none, .some): return false
            case (.none, .none): return left.offset < right.offset
            }
        }.map(\.element)
    }
}
