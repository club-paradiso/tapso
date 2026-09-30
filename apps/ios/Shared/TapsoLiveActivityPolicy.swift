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

    static func displayPhase(
        for state: TapsoActivityAttributes.ContentState
    ) -> TapsoLiveActivityDisplayPhase {
        RideGuidancePolicy.moment(for: state.signal)
    }

    static func milestone(
        for state: TapsoActivityAttributes.ContentState
    ) -> TapsoLiveActivityMilestone? {
        state.guidance.milestone
    }

    static func relevanceScore(
        for state: TapsoActivityAttributes.ContentState
    ) -> Double {
        state.guidance.relevanceScore
    }

    static func staleDate(
        for state: TapsoActivityAttributes.ContentState
    ) -> Date? {
        switch displayPhase(for: state) {
        case .arrived, .ended:
            nil
        default:
            state.updatedAt.addingTimeInterval(staleInterval)
        }
    }
}
