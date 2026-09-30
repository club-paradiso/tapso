import SwiftUI
import TapsoTransit

// The Lock Screen and Dynamic Island surfaces as plain views over the activity's
// attributes and state, so the widget extension and the app's snapshot tests
// render the same code. Figma: `04 iOS` › Live Activity V2.

/// Lock Screen and banner background for a moment. Escalates with the ride:
/// basalt while riding, coral at the next stop, tangerine on arrival.
enum RideSurfacePalette {
    static func background(for moment: RideMoment) -> Color {
        switch moment {
        case .nextStop, .passedDestination: TapsoColor.journeyNext
        case .arrived: TapsoColor.journeyArrival
        default: TapsoColor.basalt
        }
    }

    static func primaryText(for moment: RideMoment) -> Color {
        switch moment {
        case .arrived: TapsoColor.textOnAccent
        case .nextStop, .passedDestination: TapsoColor.textOnUrgent
        default: TapsoColor.textOnDarkSurface
        }
    }

    static func secondaryText(for moment: RideMoment) -> Color {
        primaryText(for: moment).opacity(moment == .arrived ? 0.72 : 0.7)
    }

    /// The accent on a basalt surface; on an escalated surface the text colour takes over.
    static func accent(for moment: RideMoment) -> Color {
        switch moment {
        case .nextStop, .passedDestination, .arrived: primaryText(for: moment)
        default: TapsoColor.journey(RideGuidancePolicy.colorRole(for: moment))
        }
    }
}

struct LockScreenRideView: View {
    let attributes: TapsoActivityAttributes
    let state: TapsoActivityAttributes.ContentState
    var isStale = false
    /// The widget draws its background with `activityBackgroundTint`; previews and tests draw it here.
    var drawsBackground = false

    private var guidance: RideGuidance { guidanceAccountingForStaleness(state, isStale: isStale) }
    private var moment: RideMoment { guidance.moment }
    private var primary: Color { RideSurfacePalette.primaryText(for: moment) }
    private var secondary: Color { RideSurfacePalette.secondaryText(for: moment) }
    private var accent: Color { RideSurfacePalette.accent(for: moment) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                RouteBadge(number: attributes.routeNumber, role: badgeRole, compact: false)
                Text(verbatim: attributes.destinationName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 4)
                if guidance.data != .live {
                    TrustBadge(kind: .data(guidance.data), onDark: true)
                } else if moment == .riding {
                    DolBuddy(moment: moment, size: 22)
                }
            }

            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(LocalizedStringKey(guidance.copy.headline))
                        .font(.title3.weight(.heavy))
                        .foregroundStyle(primary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                    Text(LocalizedStringKey(guidance.copy.detail))
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 4)
                RemainingOrSymbol(guidance: guidance, remaining: state.remainingStops, color: accent, large: true)
            }

            if showsRail {
                JourneyRail(
                    progress: JourneyRail.progress(remaining: state.remainingStops, total: attributes.totalStops),
                    role: guidance.colorRole,
                    trackColor: .white.opacity(0.16),
                    height: 9
                )
            }
        }
        .padding(16)
        .background {
            if drawsBackground {
                RideSurfacePalette.background(for: moment)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(RideText.accessibilitySummary(
            guidance: guidance,
            routeNumber: attributes.routeNumber,
            destination: attributes.destinationName,
            remainingStops: state.remainingStops
        )))
    }

    /// Not on the coral next-stop surface, where a coral rail would vanish; the destination name carries it there.
    private var showsRail: Bool {
        [.riding, .prepare, .delayed, .vehicleLost, .offline].contains(moment)
    }

    private var badgeRole: RideColorRole {
        switch moment {
        case .nextStop, .passedDestination, .arrived: .neutral
        default: guidance.colorRole
        }
    }
}

/// The count when it may be shown, otherwise the moment's symbol. Last-known counts are dimmed and labelled.
struct RemainingOrSymbol: View {
    let guidance: RideGuidance
    let remaining: Int
    let color: Color
    var large = false

    var body: some View {
        switch guidance.count {
        case .live, .lastKnown:
            VStack(alignment: .trailing, spacing: -2) {
                Text(remaining, format: .number)
                    .font(TapsoType.numeral(large ? 40 : 24))
                    .monospacedDigit()
                    .foregroundStyle(color)
                    .opacity(guidance.count == .lastKnown ? 0.55 : 1)
                    .contentTransition(.numericText())
                Text(guidance.count == .lastKnown ? LocalizedStringKey("count.lastKnown") : LocalizedStringKey("count.unit"))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(color.opacity(0.8))
            }
        case .hidden:
            Image(systemName: guidance.symbolName)
                .font(.system(size: large ? 26 : 18, weight: .bold))
                .foregroundStyle(color)
                .frame(width: large ? 48 : 32, height: large ? 48 : 32)
                .background(color.opacity(0.14), in: Circle())
        }
    }
}

// MARK: Dynamic Island

struct IslandCompactLeading: View {
    let attributes: TapsoActivityAttributes
    let state: TapsoActivityAttributes.ContentState

    var body: some View {
        let guidance = state.guidance
        HStack(spacing: 4) {
            DolBuddy(moment: guidance.moment, size: 18)
            Text(verbatim: attributes.routeNumber)
                .font(.caption.weight(.heavy))
                .monospacedDigit()
                .foregroundStyle(TapsoColor.journey(guidance.colorRole))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(String(format: RideText.string("a11y.route"), attributes.routeNumber)))
        .accessibilityHint(Text("a11y.island.hint"))
    }
}

struct IslandCompactTrailing: View {
    let state: TapsoActivityAttributes.ContentState

    var body: some View {
        let guidance = state.guidance
        let color = TapsoColor.journey(guidance.colorRole)
        Group {
            if let compact = guidance.copy.compact {
                HStack(spacing: 3) {
                    Image(systemName: guidance.symbolName)
                        .font(.system(size: 9, weight: .black))
                    Text(LocalizedStringKey(compact))
                        .lineLimit(1)
                    if guidance.moment == .prepare {
                        Text(state.remainingStops, format: .number)
                            .fontWeight(.black)
                            .monospacedDigit()
                    }
                }
                .font(.caption2.weight(.bold))
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(color.opacity(0.18), in: Capsule())
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(state.remainingStops, format: .number)
                        .font(.system(.subheadline, design: .rounded, weight: .black))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                    Text("count.unit")
                        .font(.caption2.weight(.bold))
                }
            }
        }
        .foregroundStyle(color)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(compactAccessibilityLabel(state)))
    }
}

struct IslandMinimal: View {
    let state: TapsoActivityAttributes.ContentState

    var body: some View {
        let guidance = state.guidance
        Group {
            if guidance.count == .live {
                Text(state.remainingStops, format: .number)
                    .font(.system(.subheadline, design: .rounded, weight: .black))
                    .monospacedDigit()
            } else {
                Image(systemName: guidance.symbolName)
                    .font(.caption.weight(.black))
            }
        }
        .foregroundStyle(TapsoColor.journey(guidance.colorRole))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(compactAccessibilityLabel(state)))
    }
}

struct IslandExpandedLeading: View {
    let attributes: TapsoActivityAttributes
    let state: TapsoActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 6) {
            DolBuddy(moment: state.guidance.moment, size: 26)
            RouteBadge(number: attributes.routeNumber, role: state.guidance.colorRole, compact: true)
        }
        .padding(.leading, 4)
    }
}

struct IslandExpandedTrailing: View {
    let state: TapsoActivityAttributes.ContentState

    var body: some View {
        let guidance = state.guidance
        RemainingOrSymbol(
            guidance: guidance,
            remaining: state.remainingStops,
            color: TapsoColor.journey(guidance.colorRole)
        )
        .padding(.trailing, 4)
    }
}

struct IslandExpandedCenter: View {
    let state: TapsoActivityAttributes.ContentState

    var body: some View {
        let guidance = state.guidance
        Text(LocalizedStringKey(guidance.copy.eyebrow))
            .font(.caption.weight(.bold))
            .foregroundStyle(TapsoColor.journey(guidance.colorRole))
            .lineLimit(1)
    }
}

struct IslandExpandedBottom: View {
    let attributes: TapsoActivityAttributes
    let state: TapsoActivityAttributes.ContentState

    var body: some View {
        let guidance = state.guidance
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(LocalizedStringKey(guidance.copy.headline))
                    .font(.headline.weight(.heavy))
                    .foregroundStyle(TapsoColor.textOnDarkSurface)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                HStack(spacing: 4) {
                    CitrusDot(size: 7)
                    Text(verbatim: attributes.destinationName)
                        .lineLimit(1)
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(TapsoColor.textOnDarkSurface.opacity(0.7))
            }
            if [.riding, .prepare, .nextStop].contains(guidance.moment) {
                JourneyRail(
                    progress: JourneyRail.progress(remaining: state.remainingStops, total: attributes.totalStops),
                    role: guidance.colorRole,
                    trackColor: .white.opacity(0.16),
                    height: 8
                )
            } else {
                Text(LocalizedStringKey(guidance.copy.detail))
                    .font(.caption)
                    .foregroundStyle(TapsoColor.textOnDarkSurface.opacity(0.75))
                    .lineLimit(2)
            }
            HStack(spacing: 12) {
                TrustBadge(kind: .vehicle(guidance.vehicle, plate: attributes.vehiclePlate), onDark: true)
                TrustBadge(kind: .data(guidance.data), onDark: true)
            }
        }
        .padding(.horizontal, 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(RideText.accessibilitySummary(
            guidance: guidance,
            routeNumber: attributes.routeNumber,
            destination: attributes.destinationName,
            remainingStops: state.remainingStops
        )))
    }
}

/// ActivityKit marks content stale after its stale date even if no update arrives.
/// A stale activity is treated as aged data, never as a fresh milestone.
func guidanceAccountingForStaleness(
    _ state: TapsoActivityAttributes.ContentState,
    isStale: Bool
) -> RideGuidance {
    guard isStale, state.freshness == .fresh else { return state.guidance }
    let signal = state.signal
    return RideGuidancePolicy.guidance(for: RideSignal(
        phase: signal.phase,
        remainingStops: signal.remainingStops,
        freshness: .stale,
        destinationPassed: signal.destinationPassed,
        isOffline: signal.isOffline
    ))
}

private func compactAccessibilityLabel(_ state: TapsoActivityAttributes.ContentState) -> String {
    let guidance = state.guidance
    switch guidance.count {
    case .live:
        return String(format: RideText.string("a11y.compact.count"), state.remainingStops) + " " + RideText.string(guidance.copy.headline)
    case .lastKnown, .hidden:
        return RideText.string(guidance.copy.headline)
    }
}
