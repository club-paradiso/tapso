@preconcurrency import ActivityKit
import Foundation
import TapsoTransit

@MainActor
final class LiveActivityClient {
    private var activity: Activity<TapsoActivityAttributes>?

    init() {
        activity = Activity<TapsoActivityAttributes>.activities.first {
            switch $0.activityState {
            case .active, .stale:
                true
            default:
                false
            }
        }
    }

    var activityID: String? { activity?.id }
    var activitiesEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    /// Starts the ride's activity. With `push`, ActivityKit is asked for a push token so the server
    /// can update the activity while the app is suspended. A build without the push entitlement
    /// refuses that request; the activity then starts without push, as it always did.
    func start(
        attributes: TapsoActivityAttributes,
        state: TapsoActivityAttributes.ContentState,
        push: Bool = false
    ) async throws {
        guard activitiesEnabled else { throw LiveActivityError.disabled }
        await endAll()
        if push, let pushed = try? Activity.request(attributes: attributes, content: content(for: state), pushType: .token) {
            activity = pushed
            return
        }
        activity = try Activity.request(
            attributes: attributes,
            content: content(for: state),
            pushType: nil
        )
    }

    /// Every push token the current activity is given, the first one and each rotation. An activity
    /// started without push never yields one.
    func pushTokens() -> AsyncStream<Data>? {
        guard let activity else { return nil }
        return AsyncStream { continuation in
            let task = Task {
                for await token in activity.pushTokenUpdates {
                    continuation.yield(token)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Updates the activity, alerting only for `milestone`. The app model decides
    /// it from the ride's persisted `alertedMilestones`, so each milestone alerts at
    /// most once per ride, and delayed, lost, offline and checking stay quiet. A
    /// milestone the state does not itself carry is ignored.
    func update(state: TapsoActivityAttributes.ContentState, alerting milestone: TapsoLiveActivityMilestone?) async {
        guard let activity else { return }
        var alert: AlertConfiguration?
        if let milestone, milestone == TapsoLiveActivityPolicy.milestone(for: state) {
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
    }

    /// Ends every TAPSO activity, including one left by a ride the app no longer has.
    func endAll() async {
        for existing in Activity<TapsoActivityAttributes>.activities {
            await existing.end(nil, dismissalPolicy: .immediate)
        }
        activity = nil
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

/// The "돌아갈 시간" countdown (`TapsoReturnAttributes`): at most one, started and ended by the
/// rider. Its content never changes after it starts, so it needs no update and no push.
@MainActor
final class ReturnReminderClient {
    private var activity: Activity<TapsoReturnAttributes>?

    init() {
        activity = Activity<TapsoReturnAttributes>.activities.first {
            switch $0.activityState {
            case .active, .stale:
                true
            default:
                false
            }
        }
    }

    var activitiesEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    /// The pinned variant and its countdown, while one is on screen.
    var current: (attributes: TapsoReturnAttributes, state: TapsoReturnAttributes.ContentState)? {
        guard let activity else { return nil }
        return (activity.attributes, activity.content.state)
    }

    func start(attributes: TapsoReturnAttributes, state: TapsoReturnAttributes.ContentState) async throws {
        guard activitiesEnabled else { throw LiveActivityError.disabled }
        await end()
        // Stale from the moment to be at the stop: the surfaces then say so instead of counting.
        activity = try Activity.request(
            attributes: attributes,
            content: ActivityContent(state: state, staleDate: state.beAtStopBy, relevanceScore: Self.relevance),
            pushType: nil
        )
    }

    func end() async {
        for existing in Activity<TapsoReturnAttributes>.activities {
            await existing.end(nil, dismissalPolicy: .immediate)
        }
        activity = nil
    }

    /// Below every ride moment (`TapsoLiveActivityPolicy`), so a ride under way keeps the Dynamic Island.
    static let relevance: Double = 10
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
