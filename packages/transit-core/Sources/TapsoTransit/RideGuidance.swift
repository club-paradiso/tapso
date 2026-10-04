import Foundation

/// The decision a rider faces right now.
///
/// One value drives every surface: the app, the Lock Screen, the Dynamic
/// Island, alerts, haptics and VoiceOver. Two, one and zero stops are separate
/// moments because they ask separate questions, not one counter at three sizes.
public enum RideMoment: String, Codable, Hashable, Sendable, CaseIterable {
    /// "How is my ride going?" Three or more stops left, data fresh.
    case riding
    /// "Should I start preparing?" Exactly two stops left.
    case prepare
    /// "Do I get off next?" Exactly one stop left.
    case nextStop
    /// "Is this where I leave?" The bus is at the destination.
    case arrived
    /// The bus was seen beyond the destination.
    case passedDestination
    /// Live data is aging or stale. Tracking continues; no get-off alert.
    case delayed
    /// The tracked bus is missing from the feed. Tracking continues.
    case vehicleLost
    /// The phone has no connection. Tracking resumes when it returns.
    case offline
    /// Signals disagree or are being re-established. Fail closed: no alert.
    case checking
    /// The ride was finished or cancelled.
    case ended
}

/// Whether TAPSO knows which physical bus the rider is on.
///
/// Deliberately separate from `DataLinkStatus`: the right bus can be known
/// while its live data is late.
public enum VehicleIdentityStatus: String, Codable, Hashable, Sendable {
    case confirmed
    case rechecking
    case lost
}

/// Whether the live data behind the ride is current.
public enum DataLinkStatus: String, Codable, Hashable, Sendable {
    case live
    case delayed
    case offline
    case checking
}

/// What a rider may be told about the ride's reliability, and nothing finer.
///
/// Four words for every surface: the app, the Lock Screen and the Dynamic
/// Island say the same thing, and a root condition is said once. Backend
/// dimensions (cadence, receipts, matcher readiness) never reach this enum.
public enum RideTrust: String, Codable, Hashable, Sendable {
    /// No warning. The count is current and the milestones may fire.
    case live
    /// A useful bounded estimate: the count is shown with a small qualifier.
    case estimated
    /// Temporary uncertainty: one calm recovery message, the last count dimmed.
    case rechecking
    /// TAPSO cannot guide safely: one clear warning and what to do.
    case unavailable
}

/// A get-off milestone. Each fires at most once per ride.
public enum RideMilestone: String, Codable, Hashable, Sendable {
    case prepare
    case nextStop
    case arrived
}

/// What the rider should feel. Only milestones buzz; uncertain states never do.
public enum RideHaptic: String, Codable, Hashable, Sendable {
    case none
    /// Subtle: start getting ready.
    case preparation
    /// Strong and unmistakable: the next stop is yours.
    case nextStop
    /// Distinct final signal: get off here.
    case arrival
    /// One firm tap when the destination has been passed.
    case attention
}

/// Semantic colour roles. Surfaces map them to tokens; meaning is never carried by colour alone.
public enum RideColorRole: String, Codable, Hashable, Sendable {
    case journeyActive
    case journeyPrepare
    case journeyNext
    case journeyArrival
    case journeyChecking
    case journeyDegraded
    case neutral
}

/// What the rider can do to recover, if anything.
public enum RideRecoveryAction: String, Codable, Hashable, Sendable {
    case none
    /// Nothing to do: TAPSO keeps tracking.
    case keepWatching
    /// Check the bus's own stop display or announcement.
    case checkBusDisplay
    /// Get off at the next stop and head back.
    case getOffAndReturn
    /// The rider is off the bus: end the ride.
    case finishRide
}

/// The facts a guidance decision reads. Every surface builds one from the same ride state.
public struct RideSignal: Codable, Hashable, Sendable {
    public let phase: JourneyState
    public let remainingStops: Int
    public let freshness: DataFreshness
    public let destinationPassed: Bool
    public let isOffline: Bool
    public let isEstimated: Bool?

    public init(
        phase: JourneyState,
        remainingStops: Int,
        freshness: DataFreshness,
        destinationPassed: Bool = false,
        isOffline: Bool = false,
        isEstimated: Bool = false
    ) {
        self.phase = phase
        self.remainingStops = remainingStops
        self.freshness = freshness
        self.destinationPassed = destinationPassed
        self.isOffline = isOffline
        self.isEstimated = isEstimated ? true : nil
    }

    private enum CodingKeys: String, CodingKey {
        case phase, remainingStops, freshness, destinationPassed, isOffline, isEstimated
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            phase: try values.decode(JourneyState.self, forKey: .phase),
            remainingStops: try values.decode(Int.self, forKey: .remainingStops),
            freshness: try values.decode(DataFreshness.self, forKey: .freshness),
            destinationPassed: try values.decodeIfPresent(Bool.self, forKey: .destinationPassed) ?? false,
            isOffline: try values.decodeIfPresent(Bool.self, forKey: .isOffline) ?? false,
            isEstimated: try values.decodeIfPresent(Bool.self, forKey: .isEstimated) ?? false
        )
    }
}

/// Localization keys for one moment. The strings live with each surface's resources.
public struct RideCopy: Hashable, Sendable {
    /// The one line that answers the rider's question.
    public let headline: String
    /// What happens next, or what to do.
    public let detail: String
    /// A pill for the Dynamic Island's compact trailing region; `nil` shows the count instead.
    public let compact: String?
    /// The short state label on the Lock Screen and expanded Island.
    public let eyebrow: String

    public init(headline: String, detail: String, compact: String?, eyebrow: String) {
        self.headline = headline
        self.detail = detail
        self.compact = compact
        self.eyebrow = eyebrow
    }
}

/// Everything a surface needs to present one moment.
public struct RideGuidance: Hashable, Sendable {
    public let moment: RideMoment
    public let vehicle: VehicleIdentityStatus
    public let data: DataLinkStatus
    public let milestone: RideMilestone?
    public let haptic: RideHaptic
    public let colorRole: RideColorRole
    public let symbolName: String
    public let recovery: RideRecoveryAction
    public let copy: RideCopy
    /// ActivityKit relevance: higher when the rider must act.
    public let relevanceScore: Double
    /// How the remaining-stop count may be shown.
    public let count: RideCountPresentation

    /// The one reliability word this moment carries (`RideTrust`).
    public var trust: RideTrust { RideGuidancePolicy.trust(for: moment, estimated: copy.eyebrow == "ride.predicted.eyebrow") }
}

/// Whether a remaining-stop count is current, a last-known value, or withheld.
public enum RideCountPresentation: String, Codable, Hashable, Sendable {
    /// Current and safe to act on.
    case live
    /// The last value TAPSO trusted; labelled as such, never used for an alert.
    case lastKnown
    /// Withheld: signals disagree, or the ride is past counting.
    case hidden
}

/// Maps a ride signal to guidance. Deterministic and fail-closed.
///
/// A get-off moment needs an exact agreement between the journey phase, the
/// remaining-stop count and fresh data. Anything else becomes a calmer state
/// that never alerts.
public enum RideGuidancePolicy {
    public static func moment(for signal: RideSignal) -> RideMoment {
        if signal.phase == .completed || signal.phase == .cancelled {
            return .ended
        }
        guard signal.remainingStops >= 0 else { return .checking }
        if signal.isEstimated == true {
            return signal.freshness == .fresh && signal.remainingStops > 2 ? .riding : .checking
        }
        if signal.isOffline {
            return .offline
        }
        if signal.phase == .vehicleTemporarilyLost {
            return .vehicleLost
        }
        if signal.freshness == .stale || signal.phase == .dataStale {
            return .delayed
        }
        if signal.freshness == .unknown || signal.phase == .vehicleRecovery {
            return .checking
        }
        if signal.freshness == .aging || signal.phase == .dataAging {
            return .delayed
        }
        if signal.destinationPassed {
            return signal.phase == .arrived && signal.remainingStops == 0
                ? .passedDestination
                : .checking
        }

        switch (signal.phase, signal.remainingStops) {
        case (.approachingDestination, 2):
            return .prepare
        case (.nextStopIsDestination, 1):
            return .nextStop
        case (.arrived, 0):
            return .arrived
        case (.active, 3...):
            return .riding
        default:
            return .checking
        }
    }

    public static func guidance(for signal: RideSignal) -> RideGuidance {
        let moment = moment(for: signal)
        return RideGuidance(
            moment: moment,
            vehicle: vehicleStatus(for: signal),
            data: dataStatus(for: signal),
            milestone: milestone(for: moment),
            haptic: haptic(for: moment),
            colorRole: colorRole(for: moment),
            symbolName: symbolName(for: moment),
            recovery: recovery(for: moment),
            copy: signal.isEstimated == true && moment == .riding
                ? RideCopy(headline: "ride.predicted.headline", detail: "ride.predicted.detail", compact: nil, eyebrow: "ride.predicted.eyebrow")
                : copy(for: moment),
            relevanceScore: relevanceScore(for: moment),
            count: countPresentation(for: moment)
        )
    }

    /// One trust word per moment. `estimated` only for a predicted count that is still riding.
    public static func trust(for moment: RideMoment, estimated: Bool = false) -> RideTrust {
        switch moment {
        case .riding: estimated ? .estimated : .live
        case .prepare, .nextStop, .arrived, .passedDestination, .ended: .live
        case .delayed, .checking: .rechecking
        case .vehicleLost, .offline: .unavailable
        }
    }

    public static func countPresentation(for moment: RideMoment) -> RideCountPresentation {
        switch moment {
        case .riding, .prepare, .nextStop: .live
        case .delayed, .vehicleLost, .offline: .lastKnown
        case .arrived, .passedDestination, .checking, .ended: .hidden
        }
    }

    public static func vehicleStatus(for signal: RideSignal) -> VehicleIdentityStatus {
        switch signal.phase {
        case .vehicleTemporarilyLost: .lost
        case .vehicleRecovery, .matchingVehicle, .vehicleConfirmationRequired: .rechecking
        default: .confirmed
        }
    }

    public static func dataStatus(for signal: RideSignal) -> DataLinkStatus {
        if signal.isOffline { return .offline }
        switch signal.freshness {
        case .fresh: return signal.phase == .dataAging || signal.phase == .dataStale ? .delayed : .live
        case .aging, .stale: return .delayed
        case .unknown: return .checking
        }
    }

    public static func milestone(for moment: RideMoment) -> RideMilestone? {
        switch moment {
        case .prepare: .prepare
        case .nextStop: .nextStop
        case .arrived: .arrived
        default: nil
        }
    }

    public static func haptic(for moment: RideMoment) -> RideHaptic {
        switch moment {
        case .prepare: .preparation
        case .nextStop: .nextStop
        case .arrived: .arrival
        case .passedDestination: .attention
        default: .none
        }
    }

    public static func colorRole(for moment: RideMoment) -> RideColorRole {
        switch moment {
        case .riding: .journeyActive
        case .prepare: .journeyPrepare
        case .nextStop, .passedDestination: .journeyNext
        case .arrived: .journeyArrival
        case .checking: .journeyChecking
        case .delayed, .vehicleLost, .offline: .journeyDegraded
        case .ended: .neutral
        }
    }

    public static func symbolName(for moment: RideMoment) -> String {
        switch moment {
        case .riding: "bus.fill"
        case .prepare: "figure.stand"
        case .nextStop: "bell.fill"
        case .arrived: "figure.walk"
        case .passedDestination: "arrow.uturn.backward"
        case .delayed: "clock.arrow.circlepath"
        case .vehicleLost: "magnifyingglass"
        case .offline: "wifi.slash"
        case .checking: "arrow.triangle.2.circlepath"
        case .ended: "checkmark.circle.fill"
        }
    }

    public static func recovery(for moment: RideMoment) -> RideRecoveryAction {
        switch moment {
        case .riding, .prepare, .nextStop, .ended: .none
        case .arrived: .finishRide
        case .passedDestination: .getOffAndReturn
        case .delayed, .offline: .checkBusDisplay
        case .vehicleLost, .checking: .keepWatching
        }
    }

    public static func relevanceScore(for moment: RideMoment) -> Double {
        switch moment {
        case .arrived: 100
        case .nextStop, .passedDestination: 95
        case .prepare: 85
        case .delayed, .checking, .vehicleLost, .offline: 75
        case .riding: 50
        case .ended: 0
        }
    }

    public static func copy(for moment: RideMoment) -> RideCopy {
        let base = "ride.\(moment.rawValue)"
        let compact: String? = switch moment {
        case .riding: nil
        default: "\(base).compact"
        }
        return RideCopy(
            headline: "\(base).headline",
            detail: "\(base).detail",
            compact: compact,
            eyebrow: "\(base).eyebrow"
        )
    }

    /// Every localization key the guidance can produce. Surfaces test their resources against it.
    public static var allCopyKeys: [String] {
        RideMoment.allCases.flatMap { moment -> [String] in
            let copy = copy(for: moment)
            return [copy.headline, copy.detail, copy.eyebrow] + (copy.compact.map { [$0] } ?? [])
        }
    }
}

public extension RideSignal {
    /// Reads a ride session. With no accepted progress yet the count is unknown, which fails closed.
    ///
    /// - Parameter freshness: the session's freshness re-read against the clock now. A session
    ///   only reclassifies freshness when an observation arrives; silence must age it too.
    init(session: RideSession, freshness: DataFreshness? = nil, isOffline: Bool = false) {
        let progress = session.latestProgress
        self.init(
            phase: session.state,
            remainingStops: progress?.remainingStops ?? -1,
            freshness: freshness ?? progress?.freshness ?? .unknown,
            destinationPassed: progress?.phase == .passedDestination,
            isOffline: isOffline
        )
    }
}
