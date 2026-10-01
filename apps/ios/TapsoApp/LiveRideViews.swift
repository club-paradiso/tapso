import SwiftUI
import TapsoTransit

// The live ride's screens: route number, direction, where to get off, where
// to get on, the rider's own pick of the bus, the ride, the end. Real Jeju
// buses through the TAPSO transit API; nothing here is synthetic. Every
// screen says what is true right now, including what does not work yet.

/// The live flow, full screen over Home. Setup pushes; the vehicle check, the
/// ride and the end replace it, as in the sample ride.
struct LiveRideFlowView: View {
    @Bindable var live: LiveRideModel

    var body: some View {
        Group {
            switch live.ride?.stage {
            case .choosingVehicle?:
                NavigationStack { LiveVehicleView(live: live) }
            case .riding?:
                LiveRideScreen(live: live)
            case let .ended(end)?:
                LiveEndedView(live: live, end: end)
            case nil:
                NavigationStack(path: $live.path) {
                    LiveRouteEntryView(live: live)
                        .navigationDestination(for: LiveSetupStep.self) { step in
                            switch step {
                            case .direction: LiveDirectionView(live: live)
                            case .destination: LiveStopPickView(live: live, purpose: .destination)
                            case .boarding: LiveStopPickView(live: live, purpose: .boarding)
                            }
                        }
                }
            }
        }
        .tint(TapsoColor.mintDeep)
    }
}

// MARK: Shared pieces

/// "실시간 · 시험 중": live data, honestly labelled as a trial.
struct LiveTrialChip: View {
    var body: some View {
        Label("live.chip", systemImage: "dot.radiowaves.left.and.right")
            .font(.caption.weight(.semibold))
            .foregroundStyle(TapsoColor.mintDeep)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(TapsoColor.journeyActive.opacity(0.12), in: Capsule())
    }
}

/// What went wrong, in the rider's terms. One card per kind of failure.
struct LiveIssueCard: View {
    let issue: LiveIssue

    var body: some View {
        switch issue {
        case .offline:
            NoticeCard(systemImage: "wifi.slash", title: "live.issue.offline.title", message: "live.issue.offline.body", tint: TapsoColor.journeyDegraded)
        case .serverUnreachable:
            NoticeCard(systemImage: "icloud.slash", title: "live.issue.unreachable.title", message: "live.issue.unreachable.body", tint: TapsoColor.journeyDegraded)
        case .serviceUnavailable:
            NoticeCard(systemImage: "hourglass", title: "live.issue.service.title", message: "live.issue.service.body", tint: TapsoColor.journeyChecking)
        case .providerUnavailable:
            NoticeCard(systemImage: "antenna.radiowaves.left.and.right.slash", title: "live.issue.provider.title", message: "live.issue.provider.body", tint: TapsoColor.journeyDegraded)
        case .sessionEnded:
            NoticeCard(systemImage: "clock.badge.xmark", title: "live.issue.ended.title", message: "live.issue.ended.body", tint: TapsoColor.journeyDegraded)
        case .rateLimited:
            NoticeCard(systemImage: "tortoise", title: "live.issue.slow.title", message: "live.issue.slow.body", tint: TapsoColor.journeyChecking)
        case .serverError:
            NoticeCard(systemImage: "exclamationmark.triangle", title: "live.issue.server.title", message: "live.issue.server.body", tint: TapsoColor.journeyDegraded)
        case .setupInvalid:
            NoticeCard(systemImage: "questionmark.circle", title: "live.issue.invalid.title", message: "live.issue.invalid.body", tint: TapsoColor.journeyChecking)
        }
    }
}

private struct LiveLoadingRow: View {
    var body: some View {
        HStack(spacing: TapsoSpace.sm) {
            ProgressView()
            Text("live.loading")
                .font(.subheadline)
                .foregroundStyle(TapsoColor.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: Route number

struct LiveRouteEntryView: View {
    @Bindable var live: LiveRideModel
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TapsoSpace.lg) {
                LiveTrialChip()
                QuestionTitle("live.route.question")
                HStack(spacing: TapsoSpace.sm) {
                    TextField("live.route.placeholder", text: $live.routeQuery)
                        .font(.title3.weight(.semibold))
                        .keyboardType(.numbersAndPunctuation)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .focused($focused)
                        .onSubmit { Task { await live.searchRoutes() } }
                        .padding(.horizontal, TapsoSpace.md)
                        .frame(minHeight: TapsoSize.primaryButtonHeight)
                        .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
                        .accessibilityIdentifier("live-route-number")
                    Button {
                        Task { await live.searchRoutes() }
                    } label: {
                        Text("live.route.search")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .frame(width: 112)
                    .disabled(live.isLoading)
                }

                if live.isLoading {
                    LiveLoadingRow()
                } else if let issue = live.setupIssue {
                    LiveIssueCard(issue: issue)
                } else if live.searchedNumber != nil, live.routes.isEmpty {
                    NoticeCard(systemImage: "magnifyingglass", title: "live.route.none.title", message: "live.route.none.body", tint: TapsoColor.textTertiary)
                }

                VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                    Label("live.note.data", systemImage: "bus")
                    Label("live.note.confirm", systemImage: "hand.tap")
                    Label("live.note.foreground", systemImage: "iphone")
                }
                .font(.footnote)
                .foregroundStyle(TapsoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, TapsoSpace.gutter)
            .padding(.vertical, TapsoSpace.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(TapsoColor.backgroundPrimary)
        .navigationTitle(Text("live.title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("live.close") { Task { await live.close() } }
            }
        }
        .onAppear { focused = live.routeQuery.isEmpty }
    }
}

// MARK: Direction

struct LiveDirectionView: View {
    @Bindable var live: LiveRideModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TapsoSpace.lg) {
                QuestionTitle("live.direction.question")
                VStack(spacing: TapsoSpace.sm) {
                    ForEach(live.directions) { route in
                        Button {
                            Task { await live.chooseRoute(route) }
                        } label: {
                            HStack(spacing: TapsoSpace.sm) {
                                RouteBadge(number: route.routeNumber)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(String(format: RideText.string("route.headsign"), route.endStopName ?? route.routeNumber))
                                        .font(.body.weight(.semibold))
                                        .foregroundStyle(TapsoColor.textPrimary)
                                    if let start = route.startStopName {
                                        Text(String(format: RideText.string("live.direction.from"), start))
                                            .font(.footnote)
                                            .foregroundStyle(TapsoColor.textSecondary)
                                    }
                                }
                                .multilineTextAlignment(.leading)
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.forward")
                                    .font(.footnote.weight(.bold))
                                    .foregroundStyle(TapsoColor.textTertiary)
                            }
                            .padding(TapsoSpace.md)
                            .frame(maxWidth: .infinity, minHeight: TapsoSize.minimumTouch, alignment: .leading)
                            .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.lg, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .disabled(live.isLoading)
                    }
                }
                if live.isLoading {
                    LiveLoadingRow()
                } else if let issue = live.setupIssue {
                    LiveIssueCard(issue: issue)
                }
            }
            .padding(.horizontal, TapsoSpace.gutter)
            .padding(.vertical, TapsoSpace.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(TapsoColor.backgroundPrimary)
        .navigationTitle(Text("setup.step.route"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: Where to get off, where to get on

struct LiveStopPickView: View {
    enum Purpose { case destination, boarding }

    @Bindable var live: LiveRideModel
    let purpose: Purpose
    @State private var query = ""

    private var options: [LiveStop] {
        LiveSetup.filter(purpose == .destination ? live.destinationOptions : live.boardingOptions, query: query)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TapsoSpace.lg) {
                if purpose == .boarding {
                    DestinationRecap(destinationName: live.destinationName)
                    QuestionTitle("boarding.question")
                } else {
                    HStack(spacing: TapsoSpace.xs) {
                        RouteBadge(number: live.routeNumber)
                        if let end = live.route?.endStopName {
                            Text(String(format: RideText.string("route.headsign"), end))
                                .font(.subheadline)
                                .foregroundStyle(TapsoColor.textSecondary)
                        }
                    }
                    QuestionTitle("home.question")
                }

                TextField("live.stops.filter", text: $query)
                    .autocorrectionDisabled()
                    .padding(.horizontal, TapsoSpace.md)
                    .frame(minHeight: TapsoSize.minimumTouch)
                    .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))

                if live.isLoading {
                    LiveLoadingRow()
                } else if let issue = live.setupIssue {
                    LiveIssueCard(issue: issue)
                }

                VStack(spacing: 0) {
                    ForEach(options) { stop in
                        StopRow(
                            name: stop.name,
                            detail: detail(for: stop),
                            systemImage: purpose == .destination ? "mappin.circle.fill" : "figure.wave",
                            tint: purpose == .destination ? TapsoColor.tangerine : TapsoColor.mintDeep
                        ) {
                            choose(stop)
                        }
                        .disabled(live.isLoading)
                        Divider().overlay(TapsoColor.separator)
                    }
                }
            }
            .padding(.horizontal, TapsoSpace.gutter)
            .padding(.vertical, TapsoSpace.md)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(TapsoColor.backgroundPrimary)
        .navigationTitle(Text(LocalizedStringKey(purpose == .destination ? "recap.getOffAt" : "setup.step.boarding")))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func detail(for stop: LiveStop) -> String? {
        guard purpose == .boarding, let destination = live.destination else { return nil }
        let count = destination.sequence - stop.sequence
        return String(format: RideText.string(RideText.countKey("boarding.stopsToDestination", count)), count)
    }

    private func choose(_ stop: LiveStop) {
        switch purpose {
        case .destination:
            live.chooseDestination(stop)
        case .boarding:
            Task { await live.chooseBoarding(stop) }
        }
    }
}

// MARK: The rider's bus

/// Buses near the stop from raw positions, nearest first. The rider reads the
/// plate and picks; nothing is preselected, and nothing is picked for them.
struct LiveVehicleView: View {
    @Bindable var live: LiveRideModel
    @State private var selected: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var headline: LocalizedStringKey {
        if !live.hasLookedForBuses { return "check.searching.headline" }
        switch live.choices.count {
        case 0: return "check.notFoundYet.headline"
        case 1: return "live.vehicle.one.headline"
        default: return "check.similarBuses.headline"
        }
    }

    private var detail: String {
        if !live.hasLookedForBuses || live.choices.isEmpty {
            return String(format: RideText.string(live.hasLookedForBuses ? "check.notFoundYet.detail" : "check.searching.detail"), live.routeNumber)
        }
        return RideText.string("live.vehicle.pick.detail")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TapsoSpace.lg) {
                LiveTrialChip()
                BoardingContextCard(routeNumber: live.routeNumber, boardingName: live.boardingName, destinationName: live.destinationName)

                VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                    Text(headline)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(TapsoColor.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(TapsoColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)

                if let issue = live.confirmIssue ?? live.ride?.issue {
                    LiveIssueCard(issue: issue)
                }

                if live.choices.isEmpty {
                    SearchingIndicator(reduceMotion: reduceMotion)
                } else {
                    VStack(spacing: TapsoSpace.sm) {
                        ForEach(live.choices) { choice in
                            Button {
                                selected = choice.vehicleId
                            } label: {
                                ConfirmationCard(
                                    proposal: VehicleProposal(vehicleID: VehicleIdentifier(rawValue: choice.vehicleId), plate: choice.vehicleId, stopsAway: choice.stopsAway),
                                    routeNumber: live.routeNumber,
                                    confirmed: selected == choice.vehicleId,
                                    selectable: true
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(selected == choice.vehicleId ? .isSelected : [])
                            .accessibilityHint(Text("live.vehicle.pick.hint"))
                        }
                    }
                    Button {
                        guard let choice = live.choices.first(where: { $0.vehicleId == selected }) else { return }
                        Task { await live.confirm(choice) }
                    } label: {
                        if live.confirmingVehicleId != nil {
                            ProgressView()
                        } else {
                            Text("check.confirm")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(selected == nil || live.confirmingVehicleId != nil)
                    .accessibilityIdentifier("live-confirm-vehicle")
                }

                Label("live.vehicle.why", systemImage: "info.circle")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, TapsoSpace.gutter)
            .padding(.vertical, TapsoSpace.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(TapsoColor.backgroundPrimary)
        .navigationTitle(Text("check.title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("common.cancel") { Task { await live.close() } }
            }
        }
        .onChange(of: live.choices) { _, choices in
            // A bus that is no longer near the stop cannot stay picked.
            if let selected, !choices.contains(where: { $0.vehicleId == selected }) { self.selected = nil }
        }
    }
}

// MARK: The ride

struct LiveRideScreen: View {
    @Bindable var live: LiveRideModel
    @State private var confirmingEnd = false
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            ScrollView {
                if let guidance = live.guidance {
                    RideContent(
                        snapshot: RideSnapshot(
                            guidance: guidance,
                            routeNumber: live.routeNumber,
                            destinationName: live.destinationName,
                            remainingStops: live.remainingStops,
                            totalStops: live.totalStops,
                            currentStopName: live.currentStopName,
                            upcomingStops: live.upcomingStopNames,
                            plate: live.plate,
                            liveActivityUnavailable: live.liveActivityUnavailable,
                            resumed: live.resumed,
                            isLive: true
                        ),
                        onFinish: { Task { await live.finish() } },
                        onMapSearch: openMap,
                        onDismissResume: { live.dismissResumeNotice() }
                    )
                    .animation(TapsoMotion.animation(TapsoMotion.emphasis, reduceMotion: reduceMotion), value: guidance.moment)
                }
            }
            .background(TapsoColor.backgroundPrimary)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: TapsoSpace.xs) {
                        RouteBadge(number: live.routeNumber, role: live.guidance?.colorRole ?? .journeyActive, compact: true)
                        Text(verbatim: live.destinationName)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if live.guidance?.moment != .arrived, live.guidance?.moment != .passedDestination {
                    Button("ride.end") { confirmingEnd = true }
                        .buttonStyle(SecondaryButtonStyle(foreground: TapsoColor.textSecondary))
                        .padding(.horizontal, TapsoSpace.gutter)
                        .padding(.bottom, TapsoSpace.xs)
                        .background(TapsoColor.backgroundPrimary)
                }
            }
            .confirmationDialog(Text("ride.end.confirm"), isPresented: $confirmingEnd, titleVisibility: .visible) {
                Button("ride.end.action", role: .destructive) { Task { await live.cancelRide() } }
                Button("common.keepRiding", role: .cancel) {}
            }
        }
    }

    /// A name search only: the hand-off never claims a walking route it cannot vouch for.
    private func openMap(_ app: MapApp) {
        guard let destination = live.destination else { return }
        let stop = Stop(
            id: StopID(rawValue: destination.stopId),
            name: destination.name,
            coordinate: Coordinate(latitude: destination.latitude ?? 0, longitude: destination.longitude ?? 0)
        )
        guard let request = MapHandoff.walkingRequest(to: stop, in: app, coordinatesAreSurveyed: false),
              let url = URL(string: request.urlString) else { return }
        openURL(url)
    }
}

// MARK: The end

struct LiveEndedView: View {
    let live: LiveRideModel
    let end: LiveRideEnd

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.lg) {
            Spacer(minLength: 0)
            Image(systemName: end == .finished ? "checkmark.circle.fill" : "clock.badge.xmark")
                .font(.system(size: 56, weight: .bold))
                .foregroundStyle(end == .finished ? TapsoColor.journeyActive : TapsoColor.journeyDegraded)
                .accessibilityHidden(true)
            Text(LocalizedStringKey(end == .finished ? "live.end.title" : "live.issue.ended.title"))
                .font(.largeTitle.weight(.heavy))
                .foregroundStyle(TapsoColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(LocalizedStringKey(end == .finished ? "live.end.body" : "live.issue.ended.body"))
                .font(.body)
                .foregroundStyle(TapsoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button("end.done") { live.dismissEnded() }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("live-end-done")
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(TapsoColor.backgroundPrimary)
    }
}

/// The way into a live ride from Home. Figma: `04 iOS` › Home V2 (live entry).
struct LiveEntryCard: View {
    let action: () -> Void

    var body: some View {
        TapsoCard {
            VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                LiveTrialChip()
                Text("live.entry.title")
                    .font(.headline)
                    .foregroundStyle(TapsoColor.textPrimary)
                Text("live.entry.body")
                    .font(.subheadline)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("live.entry.action", action: action)
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("start-live-ride")
            }
        }
    }
}
