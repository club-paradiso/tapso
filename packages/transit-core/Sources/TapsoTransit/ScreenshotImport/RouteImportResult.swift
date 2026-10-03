import Foundation

/// How much of the answer a screenshot supports. Internal vocabulary: the UI
/// shows a confirmation, a short list, or "not found", never a percentage.
public enum RouteImportConfidence: String, Hashable, Sendable {
    /// One route and direction is strongly supported.
    case high
    /// Several routes or directions remain, or one is only weakly supported.
    case medium
    /// Nothing safe can be inferred.
    case low
}

/// What the screenshot proved about a proposal, in TAPSO's own data.
public enum RouteImportEvidence: Hashable, Sendable {
    /// `count` visible stops were found on this route variant in the order the screenshot lists them.
    case orderedStops(count: Int)
    /// Same, but one visible line disagreed with the order and was set aside.
    case partiallyOrderedStops(count: Int)
    /// One stop was found, and it is somewhere to get off: the rider still picks where to board.
    case destinationOnly
}

/// A route, direction and stops that exist in TAPSO's transit data and fit the screenshot.
/// Every field comes from the data TAPSO fetched; none is copied from the screenshot.
public struct RouteImportProposal: Hashable, Sendable {
    public let route: TransitRoute
    /// `nil` when the screenshot showed only where to get off.
    public let boarding: RouteStop?
    public let destination: RouteStop
    public let evidence: RouteImportEvidence
    /// For ranking only. Not shown, not stored.
    public let score: Int
    /// The bus number was read with a look-alike character fixed (`44O` → `440`).
    public let numberWasCorrected: Bool
    /// Lowest stop-name similarity among the stops used.
    public let weakestStopSimilarity: Double

    /// Stops from boarding to destination, computed from TAPSO's sequences; `nil` without a boarding stop.
    public var stopCount: Int? {
        boarding.map { max(1, destination.sequence - $0.sequence) }
    }

    public init(
        route: TransitRoute,
        boarding: RouteStop?,
        destination: RouteStop,
        evidence: RouteImportEvidence,
        score: Int,
        numberWasCorrected: Bool,
        weakestStopSimilarity: Double
    ) {
        self.route = route
        self.boarding = boarding
        self.destination = destination
        self.evidence = evidence
        self.score = score
        self.numberWasCorrected = numberWasCorrected
        self.weakestStopSimilarity = weakestStopSimilarity
    }
}

/// Why no safe route came out. Each maps to one plain sentence for the rider.
public enum RouteImportFailure: Hashable, Sendable {
    /// The image could not be read as a picture.
    case unreadableImage
    /// Nothing legible in it.
    case noTextFound
    /// The text is too uncertain to build on.
    case lowQuality
    /// Text, but no bus number: not a route screenshot.
    case notARouteScreenshot
    /// Bus numbers, but none of them is a route TAPSO serves.
    case noSupportedBus
    /// A route TAPSO serves, but the stops shown do not fit it in a direction that works.
    case noStopMatch
    /// TAPSO's route data could not be loaded.
    case routeDataUnavailable
    /// The analysis was cancelled before it finished.
    case interrupted
}

public enum RouteImportResult: Hashable, Sendable {
    /// High confidence: show the confirmation. Guidance still waits for the rider's tap.
    case confirmed(RouteImportProposal)
    /// Medium confidence: the strongest verified candidates, best first.
    case choose([RouteImportProposal])
    case notFound(RouteImportFailure)

    public var confidence: RouteImportConfidence {
        switch self {
        case .confirmed: .high
        case .choose: .medium
        case .notFound: .low
        }
    }
}
