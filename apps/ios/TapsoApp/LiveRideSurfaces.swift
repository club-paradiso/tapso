import Foundation
import TapsoTransit

/// The live ride's Live Activity and feedback: the same ActivityKit client,
/// attributes and content state as the sample ride, so the Lock Screen and
/// Dynamic Island draw a live ride exactly as they draw the sample.
///
/// Updates come from the app while it runs. There is no push update yet
/// (`pushType` stays `nil`): once iOS suspends the app, the activity keeps its
/// last state and reads as stale two minutes after the last server answer.
@MainActor
final class ActivityLiveRideSurfaces: LiveRideSurfaces {
    private let activity = LiveActivityClient()

    func start(_ content: LiveRideContent, resuming: Bool) async throws {
        if resuming, activity.activityID != nil {
            await activity.update(state: Self.state(content), alerting: nil)
            return
        }
        try await activity.start(attributes: Self.attributes(content), state: Self.state(content))
    }

    func update(_ content: LiveRideContent, alerting milestone: RideMilestone?) async {
        await activity.update(state: Self.state(content), alerting: milestone)
    }

    func end(_ content: LiveRideContent, immediately: Bool) async {
        await activity.end(state: Self.state(content), immediately: immediately)
    }

    func announce(_ guidance: RideGuidance, haptic: Bool) {
        if haptic {
            RideFeedback.play(guidance.haptic)
        }
        RideFeedback.announce(guidance)
    }

    static func attributes(_ content: LiveRideContent) -> TapsoActivityAttributes {
        TapsoActivityAttributes(
            routeNumber: content.routeNumber,
            routeID: content.routeID,
            boardingStopName: content.boardingStopName,
            destinationName: content.destinationName,
            totalStops: content.totalStops,
            vehiclePlate: content.vehiclePlate
        )
    }

    static func state(_ content: LiveRideContent) -> TapsoActivityAttributes.ContentState {
        TapsoActivityAttributes.ContentState(
            phase: content.phase,
            currentStopName: content.currentStopName,
            nextStopName: content.nextStopName,
            remainingStops: content.remainingStops,
            freshness: content.freshness,
            updatedAt: content.updatedAt,
            destinationPassed: content.destinationPassed,
            isOffline: content.isOffline
        )
    }
}

extension LiveRideModel {
    /// The app's live model: the configured API (`TAPSOAPIBaseURL`, production
    /// unless a build says otherwise), the real network, ActivityKit, and the
    /// ride record in `UserDefaults`.
    static func app(bundle: Bundle = .main) -> LiveRideModel {
        let environment = LiveEnvironment.configured(bundle.object(forInfoDictionaryKey: "TAPSOAPIBaseURL") as? String)
        return LiveRideModel(
            client: .live(environment: environment),
            surfaces: ActivityLiveRideSurfaces(),
            store: DefaultsLiveRideRecordStore()
        )
    }
}
