import SwiftUI
import TapsoTransit

// The Lock Screen and Dynamic Island surfaces as plain views over the activity's
// attributes and state, so the widget extension and the app's snapshot tests
// render the same code. Figma: `05 Live Activity · Dynamic Island` (`160:1208`); components on `02F iOS Ride V2`.

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
        primaryText(for: moment).opacity(secondaryOpacity(for: moment))
    }

    /// Dimmed only where the dimmed text still reads at 4.5:1 or more (basalt 9.3:1, tangerine 4.8:1).
    /// On coral, 70 % white reads 3.2:1 on the light coral and 70 % ink 4.3:1 on the dark one, so the
    /// secondary line is drawn at full strength there (5.0:1 and 7.0:1, `DESIGN_SYSTEM_V2.md`).
    static func secondaryOpacity(for moment: RideMoment) -> Double {
        switch moment {
        case .nextStop, .passedDestination: 1
        case .arrived: 0.72
        default: 0.7
        }
    }

    /// The unit label under the Lock Screen's count. At 80 % it reads under 4.5:1 on coral (white, 3.7:1)
    /// and, in light appearance, on basalt (slate, 4.4:1), so it is drawn at full strength.
    static let countLabelOpacity: Double = 1

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
                if moment == .riding {
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
                    Text(verbatim: RideText.detail(guidance, exitStopName: state.nextStopName))
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 4)
                RemainingOrSymbol(
                    guidance: guidance,
                    remaining: state.remainingStops,
                    color: accent,
                    large: true,
                    labelOpacity: RideSurfacePalette.countLabelOpacity
                )
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
            remainingStops: state.remainingStops,
            exitStopName: state.nextStopName
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
    /// The unit label under the numeral: dimmed on the black island, full strength on the Lock Screen
    /// (`RideSurfacePalette.countLabelOpacity`).
    var labelOpacity: Double = 0.8

    /// Dimmed, still at least 3:1 for a numeral this large on every surface (slate on basalt 3.7:1).
    static let lastKnownOpacity: Double = 0.7

    var body: some View {
        switch guidance.count {
        case .live, .lastKnown:
            VStack(alignment: .trailing, spacing: -2) {
                Text(remaining, format: .number)
                    .font(TapsoType.numeral(large ? 40 : 24))
                    .monospacedDigit()
                    .foregroundStyle(color)
                    .opacity(guidance.count == .lastKnown ? Self.lastKnownOpacity : 1)
                    .contentTransition(.numericText())
                Text(guidance.count == .lastKnown ? LocalizedStringKey("count.lastKnown") : LocalizedStringKey(RideText.countKey("count.unit", remaining)))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(color.opacity(labelOpacity))
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
    /// ActivityKit's `context.isStale`: past the stale date, the island shows aged data like the Lock Screen.
    var isStale = false

    private var guidance: RideGuidance { guidanceAccountingForStaleness(state, isStale: isStale) }

    var body: some View {
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
    /// ActivityKit's `context.isStale`: past the stale date, the island shows aged data like the Lock Screen.
    var isStale = false

    private var guidance: RideGuidance { guidanceAccountingForStaleness(state, isStale: isStale) }

    var body: some View {
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
                    Text(LocalizedStringKey(RideText.countKey("count.unit", state.remainingStops)))
                        .font(.caption2.weight(.bold))
                }
            }
        }
        .foregroundStyle(color)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(compactAccessibilityLabel(state, guidance)))
    }
}

struct IslandMinimal: View {
    let state: TapsoActivityAttributes.ContentState
    /// ActivityKit's `context.isStale`: past the stale date, the island shows aged data like the Lock Screen.
    var isStale = false

    private var guidance: RideGuidance { guidanceAccountingForStaleness(state, isStale: isStale) }

    var body: some View {
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
        .accessibilityLabel(Text(compactAccessibilityLabel(state, guidance)))
    }
}

struct IslandExpandedLeading: View {
    let attributes: TapsoActivityAttributes
    let state: TapsoActivityAttributes.ContentState
    /// ActivityKit's `context.isStale`: past the stale date, the island shows aged data like the Lock Screen.
    var isStale = false

    private var guidance: RideGuidance { guidanceAccountingForStaleness(state, isStale: isStale) }

    var body: some View {
        HStack(spacing: 6) {
            DolBuddy(moment: guidance.moment, size: 26)
            RouteBadge(number: attributes.routeNumber, role: guidance.colorRole, compact: true)
        }
        .padding(.leading, 4)
    }
}

struct IslandExpandedTrailing: View {
    let state: TapsoActivityAttributes.ContentState
    /// ActivityKit's `context.isStale`: past the stale date, the island shows aged data like the Lock Screen.
    var isStale = false

    private var guidance: RideGuidance { guidanceAccountingForStaleness(state, isStale: isStale) }

    var body: some View {
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
    /// ActivityKit's `context.isStale`: past the stale date, the island shows aged data like the Lock Screen.
    var isStale = false

    private var guidance: RideGuidance { guidanceAccountingForStaleness(state, isStale: isStale) }

    var body: some View {
        Text(LocalizedStringKey(guidance.copy.eyebrow))
            .font(.caption.weight(.bold))
            .foregroundStyle(TapsoColor.journey(guidance.colorRole))
            .lineLimit(1)
    }
}

struct IslandExpandedBottom: View {
    let attributes: TapsoActivityAttributes
    let state: TapsoActivityAttributes.ContentState
    /// ActivityKit's `context.isStale`: past the stale date, the island shows aged data like the Lock Screen.
    var isStale = false

    private var guidance: RideGuidance { guidanceAccountingForStaleness(state, isStale: isStale) }

    var body: some View {
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
                Text(verbatim: RideText.detail(guidance, exitStopName: state.nextStopName))
                    .font(.caption)
                    .foregroundStyle(TapsoColor.textOnDarkSurface.opacity(0.75))
                    .lineLimit(2)
            }
            if let plate = attributes.vehiclePlate {
                Text(verbatim: plate)
                    .font(.caption)
                    .foregroundStyle(TapsoColor.textOnDarkSurface.opacity(0.7))
            }
        }
        .padding(.horizontal, 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(RideText.accessibilitySummary(
            guidance: guidance,
            routeNumber: attributes.routeNumber,
            destination: attributes.destinationName,
            remainingStops: state.remainingStops,
            exitStopName: state.nextStopName
        )))
    }
}

/// ActivityKit marks content stale after its stale date even if no update arrives.
/// A stale activity is treated as aged data, never as a fresh milestone.
func guidanceAccountingForStaleness(
    _ state: TapsoActivityAttributes.ContentState,
    isStale: Bool
) -> RideGuidance {
    if let expiry = state.trackingValidUntil, Date() > expiry {
        return RideGuidancePolicy.guidance(for: RideSignal(phase: .vehicleRecovery, remainingStops: -1, freshness: .unknown))
    }
    guard isStale, state.freshness == .fresh else { return state.guidance }
    let signal = state.signal
    return RideGuidancePolicy.guidance(for: RideSignal(
        phase: signal.phase,
        remainingStops: signal.remainingStops,
        freshness: .stale,
        destinationPassed: signal.destinationPassed,
        isOffline: signal.isOffline,
        isEstimated: signal.isEstimated ?? false
    ))
}

private func compactAccessibilityLabel(_ state: TapsoActivityAttributes.ContentState, _ guidance: RideGuidance) -> String {
    switch guidance.count {
    case .live:
        return String(format: RideText.string(RideText.countKey("a11y.compact.count", state.remainingStops)), state.remainingStops) + " " + RideText.string(guidance.copy.headline)
    case .lastKnown, .hidden:
        return RideText.string(guidance.copy.headline)
    }
}
