import Foundation

/// A stop on the rider's chosen route that fits a place they shared from a map app.
public struct HandoffStopSuggestion: Hashable, Sendable {
    public let routeStop: RouteStop
    /// Straight-line metres from the shared place, rounded to 10 m; `nil` for a name match.
    /// A straight line is not a walking distance, so no surface turns it into minutes.
    public let straightLineMeters: Int?

    public init(routeStop: RouteStop, straightLineMeters: Int?) {
        self.routeStop = routeStop
        self.straightLineMeters = straightLineMeters
    }
}

/// What a shared place says about where to get off.
public enum HandoffStopMatch: Hashable, Sendable {
    /// Both coordinates are real: stops within `HandoffStopSuggester.maxStraightLineMeters`, nearest first.
    /// Empty when this route passes nowhere near the place.
    case nearby([HandoffStopSuggestion])
    /// No pair of real coordinates: stops whose whole name appears in the place's name.
    case byName([HandoffStopSuggestion])
    /// The place is outside Jeju; TAPSO suggests nothing.
    case outsideJeju

    public var suggestions: [HandoffStopSuggestion] {
        switch self {
        case let .nearby(list), let .byName(list): list
        case .outsideJeju: []
        }
    }
}

/// Which stop on the chosen route to get off at, for a shared place. Suggestions
/// only: the rider chooses (`docs/product/MAP_HANDOFF_V3.md`).
///
/// - Coordinates are compared only when both are real: the place's came from the
///   rider's map app, the stops' from TAGO (`coordinatesAreSurveyed`). Synthetic
///   demo coordinates never produce a "nearby" suggestion.
/// - When they can be compared, they decide: a route that passes nowhere near the
///   place gets no suggestion, not a name match far away.
/// - Without them, a stop is suggested only when its whole name appears in the
///   place's name. Addresses are never matched word by word: a district name in
///   an address says nothing about which stop is near.
public enum HandoffStopSuggester {
    /// `ASSUMED`: roughly a 15-minute walk once streets bend a straight line. Beyond it a stop is not "near".
    public static let maxStraightLineMeters = 1_000.0
    public static let limit = 3

    public static func match(for place: SharedPlace, among stops: [RouteStop], coordinatesAreSurveyed: Bool) -> HandoffStopMatch {
        if place.isInJeju == false { return .outsideJeju }
        if let coordinate = place.coordinate, coordinatesAreSurveyed {
            let measured: [Measured] = stops.compactMap { routeStop in
                let meters = routeStop.stop.coordinate.distance(to: coordinate)
                guard meters.isFinite, meters <= maxStraightLineMeters else { return nil }
                return Measured(routeStop: routeStop, meters: meters)
            }
            let nearestFirst = measured.sorted { lhs, rhs in
                lhs.meters != rhs.meters ? lhs.meters < rhs.meters : lhs.routeStop.sequence < rhs.routeStop.sequence
            }
            return .nearby(firstDistinct(nearestFirst.map { item in
                HandoffStopSuggestion(routeStop: item.routeStop, straightLineMeters: Int((item.meters / 10).rounded()) * 10)
            }))
        }
        let name = StopNameMatcher.normalized(place.name ?? "")
        guard !name.isEmpty else { return .byName([]) }
        let named = stops
            .filter { routeStop in
                let needle = StopNameMatcher.normalized(routeStop.stop.name)
                return needle.count >= 2 && name.contains(needle)
            }
            .sorted { lhs, rhs in
                let left = StopNameMatcher.normalized(lhs.stop.name).count
                let right = StopNameMatcher.normalized(rhs.stop.name).count
                return left != right ? left > right : lhs.sequence < rhs.sequence
            }
        return .byName(firstDistinct(named.map { HandoffStopSuggestion(routeStop: $0, straightLineMeters: nil) }))
    }

    private struct Measured {
        let routeStop: RouteStop
        let meters: Double
    }

    /// A loop passes some stops twice; the first visit in this order is the one suggested.
    private static func firstDistinct(_ ranked: [HandoffStopSuggestion]) -> [HandoffStopSuggestion] {
        var seen = Set<StopID>()
        var result: [HandoffStopSuggestion] = []
        for suggestion in ranked where seen.insert(suggestion.routeStop.stop.id).inserted {
            result.append(suggestion)
            if result.count == limit { break }
        }
        return result
    }
}

/// The journey a map hand-off creates, in the Journey Contract's vocabulary
/// (`docs/product/JOURNEY_CONTRACT_V3.md`): one ride, then the last-mile walk
/// to the shared place. The walk's distance stays unmeasured: TAPSO knows a
/// straight line, not a walking route.
public enum HandoffJourney {
    public static func segments(
        routeNumber: String,
        boardSequence: Int,
        alightSequence: Int,
        place: SharedPlace?
    ) -> [JourneySegmentSpec] {
        var segments = [JourneySegmentSpec(
            kind: .ride,
            routeNumber: routeNumber,
            boardSequence: boardSequence,
            alightSequence: alightSequence
        )]
        if place != nil {
            segments.append(JourneySegmentSpec(kind: .walk))
        }
        return segments
    }
}
