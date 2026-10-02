import ActivityKit
import SwiftUI
import WidgetKit

/// Wires the "돌아갈 시간" countdown into ActivityKit. Layout lives in
/// `Shared/ReturnActivitySurfaces.swift` so the app renders the same views.
struct TapsoReturnActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TapsoReturnAttributes.self) { context in
            ReturnLockScreenView(attributes: context.attributes, state: context.state, isStale: context.isStale)
                .activityBackgroundTint(ReturnSurfacePalette.background)
                .activitySystemActionForegroundColor(ReturnSurfacePalette.primary)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ReturnIslandExpandedLeading(attributes: context.attributes, isStale: context.isStale)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ReturnIslandExpandedTrailing(state: context.state, isStale: context.isStale)
                }
                DynamicIslandExpandedRegion(.bottom, priority: 1) {
                    ReturnIslandExpandedBottom(attributes: context.attributes, isStale: context.isStale)
                }
            } compactLeading: {
                ReturnIslandCompactLeading(attributes: context.attributes, isStale: context.isStale)
            } compactTrailing: {
                ReturnIslandCompactTrailing(state: context.state, isStale: context.isStale)
            } minimal: {
                ReturnIslandMinimal(isStale: context.isStale)
            }
            .keylineTint(ReturnSurfacePalette.accent(isLate: context.isStale))
            .widgetURL(URL(string: "tapso://return"))
        }
    }
}

/// SYNTHETIC: a route variant's last bus as the end screen would pin it.
private let previewAttributes = TapsoReturnAttributes(
    routeID: "SYN-202-E",
    routeNumber: "202",
    startStopName: "협재",
    endStopName: "제주버스터미널",
    beAtStopByText: "21:40",
    lastDeparture: "21:50"
)

private let previewState = TapsoReturnAttributes.ContentState(
    startedAt: Date(timeIntervalSince1970: 1_800_000_000),
    beAtStopBy: Date(timeIntervalSince1970: 1_800_000_000 + 5_000)
)

#Preview("Lock Screen", as: .content, using: previewAttributes) {
    TapsoReturnActivityWidget()
} contentStates: {
    previewState
}

#Preview("Island · Expanded", as: .dynamicIsland(.expanded), using: previewAttributes) {
    TapsoReturnActivityWidget()
} contentStates: {
    previewState
}
