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
/// side, one sheen and three faint pores for basalt, a tangerine hair pin, and
/// a face of eyes and cheeks. The rim takes the moment's colour.
///
/// In the app 돌이 is alive (`animated`): it blinks, glances while checking,
/// peeks now and then while the rider rests, and hops on arrival. Live
/// Activities stay still: ActivityKit gives them SwiftUI transitions only, so
/// the Lock Screen and the Dynamic Island draw the same face without motion.
/// Reduce Motion stills it everywhere.
struct DolBuddy: View {
    enum Expression: Equatable {
        /// Off the ride (Home): awake, looking at the rider.
        case awake
        case ride(RideMoment)
    }

    let expression: Expression
    var size: CGFloat = 36
    var animated = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(moment: RideMoment, size: CGFloat = 36, animated: Bool = false) {
        self.expression = .ride(moment)
        self.size = size
        self.animated = animated
    }

    init(expression: Expression, size: CGFloat = 36, animated: Bool = false) {
        self.expression = expression
        self.size = size
        self.animated = animated
    }

    private var accent: Color {
        switch expression {
        case .awake: TapsoColor.journeyActive
        case let .ride(moment): TapsoColor.journey(RideGuidancePolicy.colorRole(for: moment))
        }
    }

    /// Points per unit of the 72-unit Figma artboard.
    private var unit: CGFloat { size / 72 }

    var body: some View {
        Group {
            if animated, !reduceMotion {
                TimelineView(.animation(minimumInterval: 1 / 30)) { context in
                    figure(DolMotion(expression: expression, time: context.date.timeIntervalSinceReferenceDate))
                }
            } else {
                figure(.still)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private func figure(_ motion: DolMotion) -> some View {
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
            face(motion)
                .scaleEffect(x: 1, y: motion.openness, anchor: UnitPoint(x: 0.5, y: 37.5 / 72))
            tangerinePin
        }
        .scaleEffect(x: 1, y: motion.breath, anchor: UnitPoint(x: 0.5, y: 62 / 72))
        .offset(y: motion.hop * unit)
    }

    @ViewBuilder
    private func face(_ motion: DolMotion) -> some View {
        let eyeStroke = StrokeStyle(lineWidth: max(1, 3.4 * unit), lineCap: .round)
        switch expression {
        case .awake:
            eyes(gaze: .zero)
            cheeks
        case let .ride(moment):
            switch moment {
            case .checking:
                eyes(gaze: CGPoint(x: motion.glance, y: -0.5))
            case .riding:
                if motion.peeking {
                    eyes(gaze: .zero)
                } else {
                    DolShape(kind: .arcs(DolFace.resting)).stroke(.white, style: eyeStroke)
                }
                cheeks
            case .prepare:
                eyes(gaze: CGPoint(x: 2.2, y: 0))
                cheeks
            case .nextStop, .passedDestination:
                eyes(gaze: CGPoint(x: -0.8, y: -1.4), radius: 8, pupil: 3.2)
            case .arrived, .ended:
                DolShape(kind: .arcs(DolFace.smiling)).stroke(.white, style: eyeStroke)
                cheeks
            case .delayed, .vehicleLost, .offline:
                DolShape(kind: .bars(DolFace.squinting)).fill(.white)
            }
        }
    }

    /// Open eyes: a white eye, a basalt pupil and a glint.
    /// Under 26 pt the pupil and glint are under a point and muddy the eye, so
    /// the island draws white eyes only.
    @ViewBuilder
    private func eyes(gaze: CGPoint, radius: CGFloat = 7, pupil: CGFloat = 3.7) -> some View {
        let eyes = DolFace.eyes(gaze: gaze, radius: radius, pupil: pupil)
        if size < 26 {
            DolShape(kind: .circles(DolFace.eyes(gaze: .zero, radius: 5.2, pupil: 0).whites)).fill(.white)
        } else {
            DolShape(kind: .circles(eyes.whites)).fill(.white)
            DolShape(kind: .circles(eyes.pupils)).fill(TapsoColor.basalt)
            DolShape(kind: .circles(eyes.glints)).fill(.white)
        }
    }

    /// A tangerine hair pin on the crown: Jeju, and the destination colour,
    /// worn rather than placed beside. The basalt ring keeps it apart from the
    /// rim; the leaf and glint drop under 22 pt.
    @ViewBuilder
    private var tangerinePin: some View {
        if size >= 22 {
            DolShape(kind: .leaf).fill(DolFace.leafGreen)
            DolShape(kind: .bars([DolFace.stem])).fill(DolFace.leafGreen)
        }
        DolShape(kind: .circles([DolFace.pin])).fill(TapsoColor.tangerine)
        DolShape(kind: .circles([DolFace.pin])).stroke(TapsoColor.basalt, lineWidth: max(0.5, 1.6 * unit))
        if size >= 22 {
            DolShape(kind: .circles([DolFace.pinGlint])).fill(.white.opacity(0.55))
        }
    }

    /// Coral cheeks on the calm moments; off in alerts and uncertainty, and
    /// under 22 pt, where they are under a point.
    @ViewBuilder
    private var cheeks: some View {
        if size >= 22 {
            DolShape(kind: .ellipses(DolFace.blush)).fill(TapsoColor.dolCheek)
        }
    }
}

/// 돌이's motion at one instant, a pure function of the clock so every frame
/// is reproducible and nothing is stored. Units are the 72-unit artboard.
struct DolMotion: Equatable {
    /// 1 open, 0 shut. Applies to open eyes; arcs and bars are already shut.
    var openness: CGFloat = 1
    /// Horizontal pupil offset while checking.
    var glance: CGFloat = 0
    /// Resting eyes open for a moment: "still watching".
    var peeking = false
    /// Vertical offset (negative is up) on arrival.
    var hop: CGFloat = 0
    /// Vertical scale of the whole pebble, from its flat bottom.
    var breath: CGFloat = 1

    static let still = DolMotion()

    static let blinkPeriod: Double = 4.2
    static let blinkDuration: Double = 0.16
    static let peekPeriod: Double = 7
    static let peekStart: Double = 5.4
    static let peekDuration: Double = 1.0
    static let hopPeriod: Double = 2.4
    static let hopDuration: Double = 0.5

    init(openness: CGFloat = 1, glance: CGFloat = 0, peeking: Bool = false, hop: CGFloat = 0, breath: CGFloat = 1) {
        self.openness = openness
        self.glance = glance
        self.peeking = peeking
        self.hop = hop
        self.breath = breath
    }

    init(expression: DolBuddy.Expression, time: Double) {
        breath = 1 - 0.02 * CGFloat(0.5 + 0.5 * sin(2 * .pi * time / 3.4))
        let moment: RideMoment? = if case let .ride(moment) = expression { moment } else { nil }

        switch moment {
        case nil, .checking, .prepare, .nextStop, .passedDestination:
            openness = Self.blink(at: time)
        case .riding:
            let phase = time.truncatingRemainder(dividingBy: Self.peekPeriod)
            peeking = phase >= Self.peekStart && phase < Self.peekStart + Self.peekDuration
            if peeking {
                // Opens with a blink, so the peek reads as waking, not as a cut.
                openness = Self.blinkShape((phase - Self.peekStart) / Self.blinkDuration)
            }
        case .arrived:
            let phase = time.truncatingRemainder(dividingBy: Self.hopPeriod)
            if phase < Self.hopDuration {
                hop = -5 * CGFloat(sin(.pi * phase / Self.hopDuration))
            }
        case .ended, .delayed, .vehicleLost, .offline:
            break
        }
        if moment == .checking {
            // Dwell at each side, then cross: tanh flattens the sine's peaks.
            let swing = tanh(3 * sin(2 * .pi * time / 1.8)) / tanh(3)
            glance = 2.6 * CGFloat(swing)
        }
    }

    /// A blink every `blinkPeriod`; every third one is a double blink.
    static func blink(at time: Double) -> CGFloat {
        let cycle = Int(time / blinkPeriod)
        let phase = time.truncatingRemainder(dividingBy: blinkPeriod)
        if phase < blinkDuration {
            return blinkShape(phase / blinkDuration)
        }
        if cycle % 3 == 2, phase >= 0.28, phase < 0.28 + blinkDuration {
            return blinkShape((phase - 0.28) / blinkDuration)
        }
        return 1
    }

    /// 1 → 0 → 1 over progress 0...1; 1 outside it. Never fully 0, so the
    /// shape keeps a hairline instead of vanishing.
    static func blinkShape(_ progress: Double) -> CGFloat {
        guard progress >= 0, progress < 1 else { return 1 }
        return max(0.08, CGFloat(abs(cos(.pi * progress))))
    }
}

/// 돌이's geometry on the 72-unit Figma artboard (`돌이 / V3`).
private enum DolFace {
    struct Dot: Sendable { let x, y, r: CGFloat }
    /// A quadratic arc from (x0, y) through control (cx, cy) to (x1, y).
    struct Arc: Sendable { let x0, x1, y, cx, cy: CGFloat }
    struct Box: Sendable { let x, y, width, height: CGFloat }

    static let pores = [Dot(x: 46, y: 55.5, r: 1.3), Dot(x: 52.5, y: 57, r: 0.95), Dot(x: 41, y: 58.2, r: 0.8)]
    /// Eye centres: close together, a little above the middle of the face.
    static let eyeCentres = [CGPoint(x: 29, y: 37.5), CGPoint(x: 45, y: 37.5)]
    static let resting = [Arc(x0: 23, x1: 35, y: 37.5, cx: 29, cy: 43.5), Arc(x0: 39, x1: 51, y: 37.5, cx: 45, cy: 43.5)]
    static let smiling = [Arc(x0: 23, x1: 35, y: 40.5, cx: 29, cy: 31.5), Arc(x0: 39, x1: 51, y: 40.5, cx: 45, cy: 31.5)]
    static let blush = [Box(x: 13.2, y: 43.2, width: 7.6, height: 4.6), Box(x: 53.2, y: 43.2, width: 7.6, height: 4.6)]
    static let pin = Dot(x: 55, y: 16, r: 6.4)
    static let pinGlint = Dot(x: 53.2, y: 14.2, r: 1.5)
    static let stem = Box(x: 54.2, y: 8.4, width: 1.6, height: 2.6)
    /// The leaf green of `CitrusDot`.
    static let leafGreen = Color(hex: 0x33BD6E)
    static let squinting = [Box(x: 24, y: 35.8, width: 10, height: 3.4), Box(x: 40, y: 35.8, width: 10, height: 3.4)]

    /// Whites, pupils and glints for a gaze (artboard units from a pupil that
    /// sits slightly down and in, looking at the rider).
    static func eyes(gaze: CGPoint, radius: CGFloat, pupil: CGFloat) -> (whites: [Dot], pupils: [Dot], glints: [Dot]) {
        let reach = max(0, radius - pupil - 0.6)
        let dx = min(reach, max(-reach, 0.8 + gaze.x))
        let dy = min(reach, max(-reach, 1 + gaze.y))
        let whites = eyeCentres.map { Dot(x: $0.x, y: $0.y, r: radius) }
        let pupils = eyeCentres.map { Dot(x: $0.x + dx, y: $0.y + dy, r: pupil) }
        let glints = pupils.map { Dot(x: $0.x + $0.r * 0.35, y: $0.y - $0.r * 0.4, r: $0.r * 0.36) }
        return (whites, pupils, glints)
    }
}

private struct DolShape: Shape {
    enum Kind: Sendable {
        case body, sheen, leaf
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
        case .leaf:
            path.move(to: CGPoint(x: 58.5, y: 9.5))
            path.addCurve(to: CGPoint(x: 67.5, y: 7), control1: CGPoint(x: 61, y: 6), control2: CGPoint(x: 65.5, y: 5.5))
            path.addCurve(to: CGPoint(x: 58.5, y: 9.5), control1: CGPoint(x: 65.5, y: 10), control2: CGPoint(x: 61.5, y: 11))
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
