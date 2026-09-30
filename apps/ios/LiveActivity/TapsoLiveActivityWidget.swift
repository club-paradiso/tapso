import ActivityKit
import SwiftUI
import TapsoTransit
import WidgetKit

/// Wires the shared ride surfaces into ActivityKit. Layout lives in
/// `Shared/LiveActivitySurfaces.swift` so the app renders the same views.
struct TapsoLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TapsoActivityAttributes.self) { context in
            let moment = guidanceAccountingForStaleness(context.state, isStale: context.isStale).moment
            LockScreenRideView(
                attributes: context.attributes,
                state: context.state,
                isStale: context.isStale
            )
            .activityBackgroundTint(RideSurfacePalette.background(for: moment))
            .activitySystemActionForegroundColor(RideSurfacePalette.primaryText(for: moment))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    IslandExpandedLeading(attributes: context.attributes, state: context.state, isStale: context.isStale)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    IslandExpandedTrailing(state: context.state, isStale: context.isStale)
                }
                DynamicIslandExpandedRegion(.center) {
                    IslandExpandedCenter(state: context.state, isStale: context.isStale)
                }
                DynamicIslandExpandedRegion(.bottom, priority: 1) {
                    IslandExpandedBottom(attributes: context.attributes, state: context.state, isStale: context.isStale)
                }
            } compactLeading: {
                IslandCompactLeading(attributes: context.attributes, state: context.state, isStale: context.isStale)
            } compactTrailing: {
                IslandCompactTrailing(state: context.state, isStale: context.isStale)
            } minimal: {
                IslandMinimal(state: context.state, isStale: context.isStale)
            }
            .keylineTint(TapsoColor.journey(guidanceAccountingForStaleness(context.state, isStale: context.isStale).colorRole))
            .widgetURL(URL(string: "tapso://ride"))
        }
    }
}

private let previewAttributes = TapsoActivityAttributes(
    routeNumber: "365",
    routeID: "demo-route-365-outbound",
    boardingStopName: "제주버스터미널",
    destinationName: "제주출입국·외국인청",
    totalStops: 8,
    vehiclePlate: "••0001"
)

private func previewState(
    _ phase: JourneyState,
    _ remaining: Int,
    _ freshness: DataFreshness = .fresh,
    passed: Bool = false,
    offline: Bool = false
) -> TapsoActivityAttributes.ContentState {
    TapsoActivityAttributes.ContentState(
        phase: phase,
        currentStopName: "동문로터리",
        nextStopName: "제주여자상업고등학교",
        remainingStops: remaining,
        freshness: freshness,
        updatedAt: Date(timeIntervalSince1970: 1_800_000_000),
        destinationPassed: passed,
        isOffline: offline
    )
}

#Preview("Lock Screen", as: .content, using: previewAttributes) {
    TapsoLiveActivityWidget()
} contentStates: {
    previewState(.active, 6)
    previewState(.approachingDestination, 2)
    previewState(.nextStopIsDestination, 1)
    previewState(.arrived, 0)
    previewState(.active, 4, .stale)
    previewState(.arrived, 0, passed: true)
}

#Preview("Island · Compact", as: .dynamicIsland(.compact), using: previewAttributes) {
    TapsoLiveActivityWidget()
} contentStates: {
    previewState(.active, 6)
    previewState(.approachingDestination, 2)
    previewState(.nextStopIsDestination, 1)
    previewState(.arrived, 0)
    previewState(.vehicleTemporarilyLost, 4)
    previewState(.active, 4, offline: true)
}

#Preview("Island · Minimal", as: .dynamicIsland(.minimal), using: previewAttributes) {
    TapsoLiveActivityWidget()
} contentStates: {
    previewState(.active, 6)
    previewState(.nextStopIsDestination, 1)
    previewState(.arrived, 0)
}

#Preview("Island · Expanded", as: .dynamicIsland(.expanded), using: previewAttributes) {
    TapsoLiveActivityWidget()
} contentStates: {
    previewState(.active, 6)
    previewState(.approachingDestination, 2)
    previewState(.nextStopIsDestination, 1)
    previewState(.arrived, 0)
    previewState(.active, 4, .aging)
}
