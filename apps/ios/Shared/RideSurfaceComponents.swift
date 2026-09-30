import SwiftUI
import TapsoTransit

// Components shared by the app, the Lock Screen and the Dynamic Island, so the
// three surfaces draw one product. Figma: `02D Journey` V2 components.

/// Route number in a rounded capsule. Figma: `RouteBadge / V2`.
struct RouteBadge: View {
    let number: String
    var role: RideColorRole = .journeyActive
    var compact = false

    var body: some View {
        HStack(spacing: compact ? 3 : 5) {
            Image(systemName: "bus.fill")
                .font(.system(size: compact ? 9 : 12, weight: .bold))
            Text(verbatim: number)
                .font(compact ? .caption.weight(.heavy) : TapsoType.routeNumber)
                .monospacedDigit()
        }
        .foregroundStyle(TapsoColor.onJourney(role))
        .padding(.horizontal, compact ? 6 : 10)
        .frame(minHeight: compact ? 18 : TapsoSize.routeBadgeHeight)
        .background(TapsoColor.journey(role), in: Capsule())
        // The route number is how a rider recognises the bus: never truncate it.
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(String(format: String(localized: "a11y.route"), number)))
    }
}

/// The tangerine destination marker. Decorative.
struct CitrusDot: View {
    var size: CGFloat = 8

    var body: some View {
        Circle()
            .fill(TapsoColor.tangerine)
            .overlay(alignment: .topTrailing) {
                Capsule()
                    .fill(Color(hex: 0x33BD6E))
                    .frame(width: size * 0.45, height: max(1, size * 0.2))
                    .rotationEffect(.degrees(-28))
                    .offset(x: size * 0.08, y: -size * 0.04)
            }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// 돌이, TAPSO's basalt companion. A small supporting mark whose expression
/// follows the ride; it never carries information on its own. Decorative.
struct DolBuddy: View {
    let moment: RideMoment
    var size: CGFloat = 36

    private var accent: Color { TapsoColor.journey(RideGuidancePolicy.colorRole(for: moment)) }
    private var unit: CGFloat { size / 36 }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 11 * unit, style: .continuous)
                .fill(LinearGradient(
                    colors: [TapsoColor.basaltRaised, TapsoColor.basalt],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
                .overlay {
                    RoundedRectangle(cornerRadius: 11 * unit, style: .continuous)
                        .stroke(accent.opacity(0.5), lineWidth: max(0.6, 0.9 * unit))
                }
            Capsule()
                .fill(accent)
                .frame(width: 20 * unit, height: 4 * unit)
                .offset(y: -11 * unit)
            HStack(spacing: 7 * unit) {
                eye
                eye
            }
            .offset(y: -2 * unit)
            HStack(spacing: 13 * unit) {
                Circle().fill(TapsoColor.tangerine.opacity(0.85))
                Circle().fill(TapsoColor.tangerine.opacity(0.85))
            }
            .frame(width: 18 * unit, height: 3 * unit)
            .offset(y: 4 * unit)
            mouth
                .offset(y: 8 * unit)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var eye: some View {
        switch moment {
        case .checking, .vehicleLost, .offline, .delayed:
            Capsule().fill(.white.opacity(0.9)).frame(width: 3 * unit, height: 1.4 * unit)
        default:
            Circle().fill(.white.opacity(0.92)).frame(width: 3 * unit, height: 3 * unit)
        }
    }

    @ViewBuilder
    private var mouth: some View {
        switch moment {
        case .riding, .ended:
            SmileShape()
                .stroke(.white.opacity(0.8), style: StrokeStyle(lineWidth: 1.2 * unit, lineCap: .round))
                .frame(width: 8 * unit, height: 4 * unit)
        case .arrived:
            SmileShape()
                .stroke(.white.opacity(0.9), style: StrokeStyle(lineWidth: 1.5 * unit, lineCap: .round))
                .frame(width: 10 * unit, height: 5 * unit)
        case .prepare:
            Circle().fill(.white.opacity(0.8)).frame(width: 3 * unit, height: 3 * unit)
        case .nextStop, .passedDestination:
            Capsule().fill(.white.opacity(0.85)).frame(width: 3.2 * unit, height: 5 * unit)
        case .delayed, .vehicleLost, .offline, .checking:
            Capsule().fill(.white.opacity(0.72)).frame(width: 7 * unit, height: 1.4 * unit)
        }
    }
}

private struct SmileShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY),
            control: CGPoint(x: rect.midX, y: rect.maxY)
        )
        return path
    }
}

/// Progress from boarding to destination: a moving bus that ends at the
/// tangerine destination. Figma: `JourneyProgressRail / V2`.
struct JourneyRail: View {
    /// 0 at boarding, 1 at the destination.
    let progress: Double
    let role: RideColorRole
    var trackColor: Color = TapsoColor.separator
    var height: CGFloat = 10

    var body: some View {
        GeometryReader { proxy in
            let marker = height + 8
            let clamped = min(max(progress, 0), 1)
            let travel = max(0, proxy.size.width - marker)
            ZStack(alignment: .leading) {
                Capsule().fill(trackColor)
                    .frame(height: height / 2.5)
                Capsule().fill(TapsoColor.journey(role))
                    .frame(width: max(marker / 2, travel * clamped + marker / 2), height: height / 2.5)
                CitrusDot(size: height)
                    .offset(x: proxy.size.width - height)
                RoundedRectangle(cornerRadius: marker * 0.32, style: .continuous)
                    .fill(TapsoColor.journey(role))
                    .frame(width: marker, height: marker)
                    .overlay {
                        Image(systemName: "bus.fill")
                            .font(.system(size: marker * 0.52, weight: .bold))
                            .foregroundStyle(TapsoColor.onJourney(role))
                    }
                    .offset(x: travel * clamped)
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: height + 8)
        .accessibilityHidden(true)
    }

    static func progress(remaining: Int, total: Int) -> Double {
        let total = max(1, total)
        return 1 - Double(min(max(remaining, 0), total)) / Double(total)
    }
}

/// Vehicle identity and data freshness, side by side and never merged.
/// Figma: `VehicleConfidenceStatus / V2` and `DataFreshnessStatus / V2`.
struct TrustBadge: View {
    enum Kind { case vehicle(VehicleIdentityStatus, plate: String?), data(DataLinkStatus) }

    let kind: Kind
    var onDark = false

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: symbol)
                .font(.caption2.weight(.bold))
                .foregroundStyle(color)
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(onDark ? Color.white.opacity(0.82) : TapsoColor.textSecondary)
            if case let .vehicle(_, plate?) = kind {
                Text(verbatim: plate)
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(onDark ? Color.white.opacity(0.6) : TapsoColor.textTertiary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityText))
    }

    /// The plate is read as its digits ("plate ending 0001"), not the mask characters.
    private var accessibilityText: String {
        guard case let .vehicle(_, plate?) = kind else { return label }
        return label + ", " + String(format: RideText.string("a11y.trust.plate"), plate.filter(\.isNumber))
    }

    private var label: String {
        let key: String = switch kind {
        case let .vehicle(status, _): "trust.vehicle." + status.rawValue
        case let .data(status): "trust.data." + status.rawValue
        }
        return RideText.string(key)
    }

    private var symbol: String {
        switch kind {
        case .vehicle(.confirmed, _): "checkmark.seal.fill"
        case .vehicle(.rechecking, _): "arrow.triangle.2.circlepath"
        case .vehicle(.lost, _): "magnifyingglass"
        case .data(.live): "dot.radiowaves.left.and.right"
        case .data(.delayed): "clock.arrow.circlepath"
        case .data(.offline): "wifi.slash"
        case .data(.checking): "arrow.triangle.2.circlepath"
        }
    }

    private var color: Color {
        switch kind {
        case .vehicle(.confirmed, _): TapsoColor.vehicleConfirmed
        case .vehicle(.rechecking, _): TapsoColor.vehicleNeedsConfirmation
        case .vehicle(.lost, _): TapsoColor.journeyDegraded
        case .data(.live): TapsoColor.dataLive
        case .data(.delayed): TapsoColor.dataDelayed
        case .data(.offline): TapsoColor.journeyDegraded
        case .data(.checking): TapsoColor.journeyChecking
        }
    }
}

enum RideText {
    static func string(_ key: String) -> String {
        String(localized: String.LocalizationValue(key))
    }

    /// The singular variant (`<key>.one`) for a count of one, so English never says "1 stops".
    static func countKey(_ key: String, _ count: Int) -> String {
        count == 1 ? key + ".one" : key
    }

    /// VoiceOver sentence for a ride: the count only when it is safe to act on.
    static func accessibilitySummary(
        guidance: RideGuidance,
        routeNumber: String,
        destination: String,
        remainingStops: Int
    ) -> String {
        let headline = string(guidance.copy.headline)
        let detail = string(guidance.copy.detail)
        switch guidance.count {
        case .live:
            return String(format: string(countKey("a11y.ride.live", remainingStops)), routeNumber, destination, remainingStops, headline, detail)
        case .lastKnown:
            return String(format: string(countKey("a11y.ride.lastKnown", remainingStops)), routeNumber, destination, remainingStops, headline, detail)
        case .hidden:
            return String(format: string("a11y.ride.hidden"), routeNumber, destination, headline, detail)
        }
    }
}
