import SwiftUI
import TapsoTransit

/// The ride. Remaining stops first, then the destination, then what to do.
/// Riding, two stops, next stop and arrival are four different layouts, not
/// one counter. Figma: `04 iOS` › Active Ride V2 and its state frames.
struct RideView: View {
    @Bindable var model: TapsoAppModel
    @State private var confirmingEnd = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            ScrollView {
                if model.isLiveRide, let failure = model.liveFailure {
                    LiveFailureNotice(failure: failure)
                        .padding(.horizontal, TapsoSpace.gutter)
                        .padding(.top, TapsoSpace.md)
                }
                if model.liveRideEndedByServer {
                    NoticeCard(
                        systemImage: "stop.circle",
                        title: "live.ride.ended.title",
                        message: "live.ride.ended.body",
                        tint: TapsoColor.journeyDegraded,
                        actionTitle: "ride.end.action",
                        action: { Task { await model.cancelRide() } }
                    )
                    .padding(.horizontal, TapsoSpace.gutter)
                    .padding(.top, TapsoSpace.md)
                }
                if let guidance = model.guidance {
                    RideContent(
                        snapshot: RideSnapshot(model: model, guidance: guidance),
                        onFinish: { Task { await model.finishRide() } },
                        onMapSearch: { app in
                            guard let request = model.rescueMapRequest(for: app) else { return }
                            Task { await model.openMapApp(request) }
                        },
                        onDismissResume: { model.dismissResumeNotice() }
                    )
                    .animation(TapsoMotion.animation(TapsoMotion.emphasis, reduceMotion: reduceMotion), value: guidance.moment)
                }
            }
            .background(TapsoColor.backgroundPrimary)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: TapsoSpace.xs) {
                        RouteBadge(number: model.routeNumber, role: model.guidance?.colorRole ?? .journeyActive, compact: true)
                        Text(verbatim: model.destinationName)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                    }
                    .accessibilityElement(children: .combine)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if !model.isLiveRide {
                            Button("ride.menu.demo", systemImage: "testtube.2") { model.isDemoPanelPresented = true }
                        }
                        Button("ride.menu.end", systemImage: "xmark.circle", role: .destructive) { confirmingEnd = true }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .frame(width: TapsoSize.minimumTouch, height: TapsoSize.minimumTouch)
                    }
                    .accessibilityLabel(Text("ride.menu"))
                }
            }
            .safeAreaInset(edge: .bottom) {
                if model.guidance?.moment != .arrived, model.guidance?.moment != .passedDestination {
                    Button("ride.end") { confirmingEnd = true }
                        .buttonStyle(SecondaryButtonStyle(foreground: TapsoColor.textSecondary))
                        .padding(.horizontal, TapsoSpace.gutter)
                        .padding(.bottom, TapsoSpace.xs)
                        .background(TapsoColor.backgroundPrimary)
                }
            }
            .confirmationDialog(Text("ride.end.confirm"), isPresented: $confirmingEnd, titleVisibility: .visible) {
                Button("ride.end.action", role: .destructive) { Task { await model.cancelRide() } }
                Button("common.keepRiding", role: .cancel) {}
            }
            .sheet(isPresented: $model.isDemoPanelPresented) {
                DemoControlsView(model: model)
                    .presentationDetents([.medium])
            }
        }
    }
}

/// Everything the ride screen shows, as plain values. The screen and the
/// snapshot tests build the same content from it.
struct RideSnapshot {
    let guidance: RideGuidance
    let routeNumber: String
    let destinationName: String
    let remainingStops: Int
    let totalStops: Int
    let currentStopName: String
    let upcomingStops: [String]
    let plate: String?
    let liveActivityUnavailable: Bool
    let resumed: Bool
    let mapHandoffFailed: MapApp?
    /// Past the stop: the Rescue plan for the way back.
    let rescue: PassedStopAdvice?
    let kakaoAvailable: Bool

    @MainActor
    init(model: TapsoAppModel, guidance: RideGuidance) {
        self.init(
            guidance: guidance,
            routeNumber: model.routeNumber,
            destinationName: model.destinationName,
            remainingStops: model.remainingStops,
            totalStops: model.totalStops,
            currentStopName: model.currentStopName,
            upcomingStops: model.upcomingStopNames,
            plate: model.vehiclePlate,
            liveActivityUnavailable: model.liveActivityUnavailable,
            resumed: model.resumedAfterRelaunch,
            mapHandoffFailed: model.mapHandoffFailed,
            rescue: model.passedStopAdvice,
            kakaoAvailable: model.rescueMapRequest(for: .kakaoMap) != nil
        )
    }

    init(
        guidance: RideGuidance,
        routeNumber: String,
        destinationName: String,
        remainingStops: Int,
        totalStops: Int,
        currentStopName: String,
        upcomingStops: [String],
        plate: String?,
        liveActivityUnavailable: Bool = false,
        resumed: Bool = false,
        mapHandoffFailed: MapApp? = nil,
        rescue: PassedStopAdvice? = nil,
        kakaoAvailable: Bool = false
    ) {
        self.guidance = guidance
        self.routeNumber = routeNumber
        self.destinationName = destinationName
        self.remainingStops = remainingStops
        self.totalStops = totalStops
        self.currentStopName = currentStopName
        self.upcomingStops = upcomingStops
        self.plate = plate
        self.liveActivityUnavailable = liveActivityUnavailable
        self.resumed = resumed
        self.mapHandoffFailed = mapHandoffFailed
        self.rescue = rescue
        self.kakaoAvailable = kakaoAvailable
    }
}

struct RideContent: View {
    let snapshot: RideSnapshot
    let onFinish: () -> Void
    let onMapSearch: (MapApp) -> Void
    let onDismissResume: () -> Void

    private var guidance: RideGuidance { snapshot.guidance }

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.lg) {
            if snapshot.resumed {
                NoticeCard(
                    systemImage: "arrow.clockwise.circle",
                    title: "ride.resumed.title",
                    message: "ride.resumed.body",
                    tint: TapsoColor.journeyActive,
                    actionTitle: "common.ok",
                    action: onDismissResume
                )
            }

            if [.delayed, .vehicleLost, .offline, .checking].contains(guidance.moment) {
                StatusBanner(guidance: guidance)
            }

            RideHeroCard(snapshot: snapshot, onFinish: onFinish, onMapSearch: onMapSearch)

            AdaptiveStack(spacing: TapsoSpace.lg) {
                TrustBadge(kind: .vehicle(guidance.vehicle, plate: snapshot.plate))
                TrustBadge(kind: .data(guidance.data))
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)

            if ![.arrived, .passedDestination, .ended].contains(guidance.moment) {
                StopLadder(
                    current: snapshot.currentStopName,
                    upcoming: snapshot.upcomingStops,
                    role: guidance.colorRole
                )
            }

            if let failed = snapshot.mapHandoffFailed {
                NoticeCard(
                    systemImage: "map",
                    title: "handoff.failed.title",
                    message: LocalizedStringKey("handoff.failed." + failed.rawValue),
                    tint: TapsoColor.journeyDegraded
                )
            }

            footer
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var footer: some View {
        if snapshot.liveActivityUnavailable {
            NoticeCard(
                systemImage: "iphone.slash",
                title: "ride.liveActivityOff.title",
                message: "ride.liveActivityOff.body",
                tint: TapsoColor.journeyDegraded
            )
        } else if guidance.moment == .riding {
            Label("ride.closeApp", systemImage: "iphone.gen3.radiowaves.left.and.right")
                .font(.footnote)
                .foregroundStyle(TapsoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// The moment-specific hero. Figma: `JourneyActionCard / V2` variants.
struct RideHeroCard: View {
    let snapshot: RideSnapshot
    let onFinish: () -> Void
    let onMapSearch: (MapApp) -> Void

    @ScaledMetric(relativeTo: .largeTitle) private var numeralSize = TapsoType.heroNumeralBase

    private var guidance: RideGuidance { snapshot.guidance }
    private var fill: Color { TapsoColor.journey(guidance.colorRole) }
    private var onFill: Color { TapsoColor.onJourney(guidance.colorRole) }

    var body: some View {
        Group {
            switch guidance.moment {
            case .prepare: prepare
            case .nextStop: nextStop
            case .arrived: arrived
            case .passedDestination: passed
            default: riding
            }
        }
        .accessibilityElement(children: .contain)
    }

    /// "How is my ride going?" A big count, calm colour.
    private var riding: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.sm) {
            Label(LocalizedStringKey(guidance.copy.eyebrow), systemImage: guidance.symbolName)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(guidance.count == .live ? TapsoColor.mintDeep : TapsoColor.textSecondary)
            if guidance.count == .hidden {
                // Signals disagree: no number to act on until they agree again.
                Text(String(format: RideText.string("ride.toDestination"), snapshot.destinationName))
                    .font(.title2.weight(.bold))
                    .foregroundStyle(TapsoColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: TapsoSpace.xs) {
                        numeral
                        countLabels
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        numeral
                        countLabels
                    }
                }
            }
            if guidance.moment == .riding {
                VStack(alignment: .leading, spacing: 2) {
                    Text(LocalizedStringKey(guidance.copy.headline))
                        .font(.headline)
                        .foregroundStyle(TapsoColor.textPrimary)
                    Text(LocalizedStringKey(guidance.copy.detail))
                        .font(.subheadline)
                        .foregroundStyle(TapsoColor.textSecondary)
                }
            }
            JourneyRail(
                progress: JourneyRail.progress(remaining: snapshot.remainingStops, total: snapshot.totalStops),
                role: guidance.colorRole
            )
            .padding(.top, TapsoSpace.xs)
        }
        .padding(TapsoSpace.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.hero, style: .continuous))
        .overlay(alignment: .topTrailing) {
            DolBuddy(moment: guidance.moment, size: 34)
                .padding(TapsoSpace.md)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(RideText.accessibilitySummary(
            guidance: guidance,
            routeNumber: snapshot.routeNumber,
            destination: snapshot.destinationName,
            remainingStops: snapshot.remainingStops
        )))
        .accessibilityIdentifier("remaining-stops")
    }

    private var numeral: some View {
        Text(snapshot.remainingStops, format: .number)
            .font(TapsoType.numeral(min(numeralSize, TapsoType.heroNumeralMax)))
            .monospacedDigit()
            .foregroundStyle(TapsoColor.textPrimary)
            .opacity(guidance.count == .lastKnown ? 0.45 : 1)
            .contentTransition(.numericText())
    }

    private var countLabels: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(LocalizedStringKey(RideText.countKey(guidance.count == .lastKnown ? "count.lastKnown.long" : "count.unit.long", snapshot.remainingStops)))
                .font(.title3.weight(.bold))
                .foregroundStyle(TapsoColor.textSecondary)
            Text(String(format: RideText.string("ride.toDestination"), snapshot.destinationName))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(TapsoColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// "Should I start preparing?" Amber, a fixed two, and what comes before your stop.
    private var prepare: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.sm) {
            Label(LocalizedStringKey(guidance.copy.eyebrow), systemImage: guidance.symbolName)
                .font(.subheadline.weight(.bold))
            Text(LocalizedStringKey(guidance.copy.headline))
                .font(.system(.largeTitle, design: .rounded, weight: .heavy))
                .fixedSize(horizontal: false, vertical: true)
            Text(LocalizedStringKey(guidance.copy.detail))
                .font(.title3.weight(.semibold))
            if let next = snapshot.upcomingStops.first {
                HStack(spacing: TapsoSpace.xs) {
                    Text("ride.nextStopLabel")
                        .font(.subheadline.weight(.semibold))
                        .opacity(0.75)
                    Text(verbatim: next)
                        .font(.subheadline.weight(.bold))
                }
                .padding(.top, TapsoSpace.xxs)
            }
        }
        .foregroundStyle(onFill)
        .padding(TapsoSpace.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(fill, in: RoundedRectangle(cornerRadius: TapsoRadius.hero, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(RideText.accessibilitySummary(
            guidance: guidance,
            routeNumber: snapshot.routeNumber,
            destination: snapshot.destinationName,
            remainingStops: snapshot.remainingStops
        )))
    }

    /// "Do I get off next?" Coral, the destination name, and the stop button.
    private var nextStop: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.md) {
            HStack(spacing: TapsoSpace.sm) {
                Image(systemName: guidance.symbolName)
                    .font(.title.weight(.bold))
                    .symbolEffect(.bounce, value: guidance.moment)
                Text(LocalizedStringKey(guidance.copy.headline))
                    .font(.system(.largeTitle, design: .rounded, weight: .black))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(verbatim: snapshot.destinationName)
                .font(.title.weight(.bold))
                .fixedSize(horizontal: false, vertical: true)
            Text(LocalizedStringKey(guidance.copy.detail))
                .font(.headline)
                .opacity(0.9)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(onFill)
        .padding(TapsoSpace.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(fill, in: RoundedRectangle(cornerRadius: TapsoRadius.hero, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(RideText.accessibilitySummary(
            guidance: guidance,
            routeNumber: snapshot.routeNumber,
            destination: snapshot.destinationName,
            remainingStops: snapshot.remainingStops
        )))
        .accessibilityAddTraits(.updatesFrequently)
    }

    /// "Is this where I leave?" Tangerine, the destination, one button.
    private var arrived: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.md) {
            HStack(spacing: TapsoSpace.sm) {
                Image(systemName: guidance.symbolName)
                    .font(.title.weight(.bold))
                Text(LocalizedStringKey(guidance.copy.headline))
                    .font(.system(.largeTitle, design: .rounded, weight: .black))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Text(verbatim: snapshot.destinationName)
                .font(.title.weight(.bold))
                .fixedSize(horizontal: false, vertical: true)
            Text(LocalizedStringKey(guidance.copy.detail))
                .font(.headline)
                .opacity(0.85)
            Button(action: onFinish) {
                Label("ride.gotOff", systemImage: "checkmark")
            }
            .buttonStyle(PrimaryButtonStyle(fill: TapsoColor.textOnAccent, foreground: .white))
            .accessibilityIdentifier("finish-ride")
            .padding(.top, TapsoSpace.xs)
        }
        .foregroundStyle(onFill)
        .padding(TapsoSpace.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(fill, in: RoundedRectangle(cornerRadius: TapsoRadius.hero, style: .continuous))
    }

    /// The destination went by. Where to get off, then the way back in the Rescue
    /// plan's order (`PassedStopRescue`): a measured short walk first, the map app last.
    private var passed: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.md) {
            Label(LocalizedStringKey(guidance.copy.headline), systemImage: guidance.symbolName)
                .font(.title2.weight(.heavy))
                .foregroundStyle(TapsoColor.journeyNext)
                .accessibilityAddTraits(.isHeader)
            Group {
                if let exit = snapshot.rescue?.exitStop {
                    Text(String(format: RideText.string("rescue.exitAt"), exit.stop.name))
                } else {
                    Text(LocalizedStringKey(guidance.copy.detail))
                }
            }
            .font(.headline)
            .foregroundStyle(TapsoColor.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
            Text(String(format: RideText.string("ride.passed.destination"), snapshot.destinationName))
                .font(.subheadline)
                .foregroundStyle(TapsoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let rescue = snapshot.rescue {
                RescueOptionList(advice: rescue)
            }
            Button { onMapSearch(.naverMap) } label: {
                Label("handoff.naver.findDestination", systemImage: "map")
            }
            .buttonStyle(PrimaryButtonStyle())
            if snapshot.kakaoAvailable {
                Button { onMapSearch(.kakaoMap) } label: {
                    Label("handoff.kakao.findDestination", systemImage: "map")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            Button(action: onFinish) {
                Text("ride.passed.end")
            }
            .buttonStyle(SecondaryButtonStyle())
        }
        .padding(TapsoSpace.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TapsoColor.journeyNext.opacity(0.08), in: RoundedRectangle(cornerRadius: TapsoRadius.hero, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: TapsoRadius.hero, style: .continuous)
                .stroke(TapsoColor.journeyNext, lineWidth: 2)
        }
    }
}

/// The Rescue plan's options in its order; the first is the suggestion when there is a
/// choice. A walk shows its straight-line distance, never minutes: the real walk is longer.
/// Figma: `04 iOS` › Product V3 › 30 Passed stop.
struct RescueOptionList: View {
    let advice: PassedStopAdvice

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.sm) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                HStack(alignment: .firstTextBaseline, spacing: TapsoSpace.sm) {
                    Image(systemName: row.symbol)
                        .foregroundStyle(TapsoColor.journeyNext)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: TapsoSpace.xs) {
                            Text(verbatim: row.title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(TapsoColor.textPrimary)
                            if index == 0 && rows.count > 1 {
                                Text("rescue.suggested")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(TapsoColor.journeyNext)
                            }
                        }
                        Text(verbatim: row.detail)
                            .font(.footnote)
                            .foregroundStyle(TapsoColor.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .combine)
            }
            if advice.walkTooFar, let meters = advice.straightLineMeters {
                Text(String(format: RideText.string("rescue.walk.tooFar"), meters))
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private struct Row {
        let symbol: String
        let title: String
        let detail: String
    }

    /// A passed-stop plan holds a walk back and the map app; `PassedStopRescue` never offers a ride back.
    private var rows: [Row] {
        advice.plan.options.compactMap { option -> Row? in
            switch option.action {
            case .walkBack:
                guard let meters = advice.straightLineMeters else { return nil }
                return Row(
                    symbol: "figure.walk",
                    title: RideText.string("rescue.walkBack.title"),
                    detail: String(format: RideText.string("rescue.walkBack.detail"), meters)
                )
            case .openMapApp:
                return Row(symbol: "map", title: RideText.string("rescue.mapApp.title"), detail: RideText.string("rescue.mapApp.detail"))
            case .rideBack, .waitForNextConnection, .takeAlternativeRoute:
                return nil
            }
        }
    }
}

/// The stops ahead, nearest first, ending at the destination. Figma: `StopRail / V2`.
struct StopLadder: View {
    let current: String
    let upcoming: [String]
    let role: RideColorRole

    private let visible = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            row(name: current, kind: .current)
            let ahead = Array(upcoming.dropLast())
            ForEach(Array(ahead.prefix(visible).enumerated()), id: \.offset) { _, name in
                row(name: name, kind: .ahead)
            }
            if ahead.count > visible {
                row(name: String(format: RideText.string("ride.moreStops"), ahead.count - visible), kind: .gap)
            }
            if let destination = upcoming.last {
                row(name: destination, kind: .destination)
            }
        }
        .padding(TapsoSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("ride.stopsAhead"))
    }

    private enum Kind { case current, ahead, gap, destination }

    private func row(name: String, kind: Kind) -> some View {
        HStack(spacing: TapsoSpace.sm) {
            ZStack {
                if kind != .destination {
                    Rectangle()
                        .fill(TapsoColor.separator)
                        .frame(width: 2)
                        .offset(y: 16)
                }
                switch kind {
                case .current:
                    Image(systemName: "bus.fill")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(TapsoColor.onJourney(role))
                        .frame(width: 22, height: 22)
                        .background(TapsoColor.journey(role), in: Circle())
                case .ahead:
                    Circle().stroke(TapsoColor.textTertiary, lineWidth: 2).frame(width: 10, height: 10)
                case .gap:
                    Image(systemName: "ellipsis").font(.caption).foregroundStyle(TapsoColor.textTertiary)
                case .destination:
                    CitrusDot(size: 16)
                }
            }
            .frame(width: 24, height: 32)
            Text(verbatim: name)
                .font(kind == .destination || kind == .current ? .body.weight(.semibold) : .subheadline)
                .foregroundStyle(kind == .gap ? TapsoColor.textTertiary : TapsoColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if kind == .current {
                Text("ride.now").font(.caption.weight(.bold)).foregroundStyle(TapsoColor.textSecondary)
            } else if kind == .destination {
                Text("ride.getOffHere").font(.caption.weight(.bold)).foregroundStyle(TapsoColor.tangerine)
            }
        }
    }
}
