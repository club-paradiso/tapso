@preconcurrency import ActivityKit
import Foundation
import TapsoTransit

@MainActor
final class LiveActivityClient {
    private var activity: Activity<TapsoActivityAttributes>?
    private var alertedMilestones: Set<TapsoLiveActivityMilestone> = []

    init() {
        activity = Activity<TapsoActivityAttributes>.activities.first {
            switch $0.activityState {
            case .active, .stale:
                true
            default:
                false
            }
        }
        if let activity, let milestone = TapsoLiveActivityPolicy.milestone(for: activity.content.state) {
            alertedMilestones = [milestone]
        }
    }

    var activityID: String? { activity?.id }
    var activitiesEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    func start(
        attributes: TapsoActivityAttributes,
        state: TapsoActivityAttributes.ContentState
    ) async throws {
        guard activitiesEnabled else { throw LiveActivityError.disabled }
        await endAll()
        activity = try Activity.request(
            attributes: attributes,
            content: content(for: state),
            pushType: nil
        )
    }

    /// Updates the activity. Each milestone alerts at most once per ride, and
    /// only milestones alert: delayed, lost, offline and checking stay quiet.
    func update(state: TapsoActivityAttributes.ContentState) async {
        guard let activity else { return }
        var alert: AlertConfiguration?
        if let milestone = TapsoLiveActivityPolicy.milestone(for: state), !alertedMilestones.contains(milestone) {
            alertedMilestones.insert(milestone)
            alert = alertConfiguration(for: milestone)
        }
        await activity.update(content(for: state), alertConfiguration: alert)
    }

    func end(
        state: TapsoActivityAttributes.ContentState,
        immediately: Bool = false
    ) async {
        guard let activity else { return }
        let content = ActivityContent(
            state: state,
            staleDate: nil,
            relevanceScore: TapsoLiveActivityPolicy.relevanceScore(for: state)
        )
        let policy: ActivityUIDismissalPolicy = immediately
            ? .immediate
            : .after(Date().addingTimeInterval(60))
        await activity.end(content, dismissalPolicy: policy)
        self.activity = nil
        alertedMilestones = []
    }

    /// Ends every TAPSO activity, including one left by a ride the app no longer has.
    func endAll() async {
        for existing in Activity<TapsoActivityAttributes>.activities {
            await existing.end(nil, dismissalPolicy: .immediate)
        }
        activity = nil
        alertedMilestones = []
    }

    private func content(
        for state: TapsoActivityAttributes.ContentState
    ) -> ActivityContent<TapsoActivityAttributes.ContentState> {
        ActivityContent(
            state: state,
            staleDate: TapsoLiveActivityPolicy.staleDate(for: state),
            relevanceScore: TapsoLiveActivityPolicy.relevanceScore(for: state)
        )
    }

    private func alertConfiguration(for milestone: TapsoLiveActivityMilestone) -> AlertConfiguration {
        let key = "alert.\(milestone.rawValue)"
        return AlertConfiguration(
            title: LocalizedStringResource(String.LocalizationValue(key + ".title")),
            body: LocalizedStringResource(String.LocalizationValue(key + ".body")),
            sound: .default
        )
    }
}

enum LiveActivityError: LocalizedError {
    case disabled

    var errorDescription: String? {
        switch self {
        case .disabled:
            String(localized: "live_activity.disabled")
        }
    }
}
