import SwiftUI
import TapsoTransit

// Components shared by the app, the Lock Screen and the Dynamic Island, so the
// three surfaces draw one product. Figma: `02F iOS Ride V2`.

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
/// Figma: `돌이 / V3` (`287:35`, page `05C`). A pebble that sits on its flat
/// side, one sheen and three faint pores for basalt, and a face made of eyes
/// only. The rim takes the moment's colour; the blush appears on arrival alone.
struct DolBuddy: View {
    let moment: RideMoment
    var size: CGFloat = 36

    private var accent: Color { TapsoColor.journey(RideGuidancePolicy.colorRole(for: moment)) }
    /// Points per unit of the 72-unit Figma artboard.
    private var unit: CGFloat { size / 72 }

    var body: some View {
        ZStack {
            DolShape(kind: .body)
                .fill(TapsoColor.basalt)
            DolShape(kind: .body)
                .stroke(accent, lineWidth: max(1, 3 * unit))
            DolShape(kind: .sheen)
                .fill(.white.opacity(0.13))
            // Below 30 pt the pores are under a pixel: noise, not texture.
            if size >= 30 {
                DolShape(kind: .circles(DolFace.pores))
                    .fill(.white.opacity(0.10))
            }
            face
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var face: some View {
        let eyeStroke = StrokeStyle(lineWidth: max(1, 3.4 * unit), lineCap: .round)
        switch moment {
        case .checking:
            DolShape(kind: .circles(DolFace.glancing)).fill(.white)
        case .riding:
            DolShape(kind: .arcs(DolFace.resting)).stroke(.white, style: eyeStroke)
        case .prepare:
            DolShape(kind: .circles(DolFace.lookingAhead)).fill(.white)
        case .nextStop, .passedDestination:
            DolShape(kind: .circles(DolFace.wideEyes)).fill(.white)
            DolShape(kind: .circles(DolFace.widePupils)).fill(TapsoColor.basalt)
            DolShape(kind: .circles(DolFace.wideGlints)).fill(.white)
        case .arrived:
            DolShape(kind: .arcs(DolFace.smiling)).stroke(.white, style: eyeStroke)
            DolShape(kind: .ellipses(DolFace.blush)).fill(TapsoColor.tangerine.opacity(0.85))
        case .ended:
            DolShape(kind: .arcs(DolFace.smiling)).stroke(.white, style: eyeStroke)
        case .delayed, .vehicleLost, .offline:
            DolShape(kind: .bars(DolFace.squinting)).fill(.white)
        }
    }
}

/// 돌이's geometry on the 72-unit Figma artboard (`돌이 / V3`).
private enum DolFace {
    struct Dot: Sendable { let x, y, r: CGFloat }
    /// A quadratic arc from (x0, y) through control (cx, cy) to (x1, y).
    struct Arc: Sendable { let x0, x1, y, cx, cy: CGFloat }
    struct Box: Sendable { let x, y, width, height: CGFloat }

    static let pores = [Dot(x: 46, y: 55.5, r: 1.3), Dot(x: 52.5, y: 57, r: 0.95), Dot(x: 41, y: 58.2, r: 0.8)]
    static let glancing = [Dot(x: 24, y: 38, r: 4.6), Dot(x: 42, y: 38, r: 4.6)]
    static let lookingAhead = [Dot(x: 32, y: 37, r: 5), Dot(x: 50, y: 37, r: 5)]
    static let wideEyes = [Dot(x: 28, y: 37, r: 7.5), Dot(x: 47, y: 37, r: 7.5)]
    static let widePupils = [Dot(x: 30.5, y: 35.5, r: 3.3), Dot(x: 49.5, y: 35.5, r: 3.3)]
    static let wideGlints = [Dot(x: 31.6, y: 34.3, r: 1.1), Dot(x: 50.6, y: 34.3, r: 1.1)]
    static let resting = [Arc(x0: 23, x1: 33, y: 37, cx: 28, cy: 43), Arc(x0: 41, x1: 51, y: 37, cx: 46, cy: 43)]
    static let smiling = [Arc(x0: 22, x1: 33, y: 40, cx: 27.5, cy: 31), Arc(x0: 41, x1: 52, y: 40, cx: 46.5, cy: 31)]
    static let blush = [Box(x: 14.5, y: 46.5, width: 6.8, height: 4), Box(x: 53, y: 46.5, width: 6.8, height: 4)]
    static let squinting = [Box(x: 23, y: 36.3, width: 10, height: 3.4), Box(x: 41, y: 36.3, width: 10, height: 3.4)]
}

private struct DolShape: Shape {
    enum Kind: Sendable {
        case body, sheen
        case circles([DolFace.Dot])
        case arcs([DolFace.Arc])
        case ellipses([DolFace.Box])
        case bars([DolFace.Box])
    }

    let kind: Kind

    func path(in rect: CGRect) -> Path {
        var path = Path()
        switch kind {
        case .body:
            path.move(to: CGPoint(x: 30, y: 14))
            path.addCurve(to: CGPoint(x: 66, y: 30), control1: CGPoint(x: 44, y: 11), control2: CGPoint(x: 60, y: 15))
            path.addCurve(to: CGPoint(x: 48, y: 61), control1: CGPoint(x: 71, y: 43), control2: CGPoint(x: 66, y: 58))
            path.addCurve(to: CGPoint(x: 8, y: 52), control1: CGPoint(x: 34, y: 63), control2: CGPoint(x: 16, y: 62))
            path.addCurve(to: CGPoint(x: 12, y: 23), control1: CGPoint(x: 2, y: 44), control2: CGPoint(x: 4, y: 31))
            path.addCurve(to: CGPoint(x: 30, y: 14), control1: CGPoint(x: 17, y: 18), control2: CGPoint(x: 23, y: 15))
            path.closeSubpath()
        case .sheen:
            path.move(to: CGPoint(x: 14, y: 29))
            path.addCurve(to: CGPoint(x: 33, y: 16.5), control1: CGPoint(x: 17, y: 22), control2: CGPoint(x: 24, y: 17))
            path.addCurve(to: CGPoint(x: 17.5, y: 31), control1: CGPoint(x: 26, y: 19.5), control2: CGPoint(x: 20, y: 24))
            path.addCurve(to: CGPoint(x: 14, y: 29), control1: CGPoint(x: 16.8, y: 32.6), control2: CGPoint(x: 13.6, y: 31.6))
            path.closeSubpath()
        case let .circles(dots):
            for dot in dots {
                path.addEllipse(in: CGRect(x: dot.x - dot.r, y: dot.y - dot.r, width: dot.r * 2, height: dot.r * 2))
            }
        case let .arcs(arcs):
            for arc in arcs {
                path.move(to: CGPoint(x: arc.x0, y: arc.y))
                path.addQuadCurve(to: CGPoint(x: arc.x1, y: arc.y), control: CGPoint(x: arc.cx, y: arc.cy))
            }
        case let .ellipses(boxes):
            for box in boxes {
                path.addEllipse(in: CGRect(x: box.x, y: box.y, width: box.width, height: box.height))
            }
        case let .bars(boxes):
            for box in boxes {
                path.addRoundedRect(
                    in: CGRect(x: box.x, y: box.y, width: box.width, height: box.height),
                    cornerSize: CGSize(width: box.height / 2, height: box.height / 2)
                )
            }
        }
        let scale = CGAffineTransform(translationX: rect.minX, y: rect.minY)
            .scaledBy(x: rect.width / 72, y: rect.height / 72)
        return path.applying(scale)
    }
}

/// Progress from boarding to destination: a moving bus that ends at the
/// tangerine destination. Figma: `JourneyRail / V2`.
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
/// Figma: `TrustBadge / V2` (`signal=vehicle-*` and `signal=data-*`).
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

    /// The moment's detail line. Past the stop it names the stop to get off at when the
    /// ride knows it (`PassedStopRescue`), so the app, Lock Screen and island say the same.
    static func detail(_ guidance: RideGuidance, exitStopName: String? = nil) -> String {
        if guidance.moment == .passedDestination, let exitStopName, !exitStopName.isEmpty {
            return String(format: string("rescue.exitAt"), exitStopName)
        }
        return string(guidance.copy.detail)
    }

    /// VoiceOver sentence for a ride: the count only when it is safe to act on.
    static func accessibilitySummary(
        guidance: RideGuidance,
        routeNumber: String,
        destination: String,
        remainingStops: Int,
        exitStopName: String? = nil
    ) -> String {
        let headline = string(guidance.copy.headline)
        let detail = Self.detail(guidance, exitStopName: exitStopName)
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
