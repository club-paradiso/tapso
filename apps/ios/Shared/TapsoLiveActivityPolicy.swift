import Foundation
import TapsoTransit

/// The Live Activity's view of `RideGuidancePolicy`. It adds only what is
/// ActivityKit-specific (stale dates); every decision comes from the core so
/// the app, Lock Screen and Dynamic Island cannot disagree.
typealias TapsoLiveActivityMilestone = RideMilestone
typealias TapsoLiveActivityDisplayPhase = RideMoment

enum TapsoLiveActivityPolicy {
    /// Nonterminal content goes stale this long after its observation.
    static let staleInterval: TimeInterval = 120

    /// Every decision takes the ride length (`attributes.totalStops`) so a bus still on its
    /// way to the boarding stop is waiting here exactly as it is in the app.
    static func displayPhase(
        for state: TapsoActivityAttributes.ContentState,
        rideLength: Int
    ) -> TapsoLiveActivityDisplayPhase {
        state.guidance(rideLength: rideLength).moment
    }

    static func milestone(
        for state: TapsoActivityAttributes.ContentState,
        rideLength: Int
    ) -> TapsoLiveActivityMilestone? {
        state.guidance(rideLength: rideLength).milestone
    }

    static func relevanceScore(
        for state: TapsoActivityAttributes.ContentState,
        rideLength: Int
    ) -> Double {
        state.guidance(rideLength: rideLength).relevanceScore
    }

    static func staleDate(
        for state: TapsoActivityAttributes.ContentState,
        rideLength: Int
    ) -> Date? {
        if let expiry = state.trackingValidUntil { return expiry }
        return switch displayPhase(for: state, rideLength: rideLength) {
        case .arrived, .ended:
            nil
        default:
            state.updatedAt.addingTimeInterval(staleInterval)
        }
    }
}
