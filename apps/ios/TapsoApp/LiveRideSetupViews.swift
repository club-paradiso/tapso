import SwiftUI
import TapsoTransit

// Live ride setup: route number → official variant → boarding and destination
// on the real stop list → the vehicle check against a server session. Every
// list here is what TAPSO's API returned just now; nothing is synthetic.
// Figma: the live setup has no current frames (the V1 trial, `191:2708`, is on `13 Archive`);
// the stop list near a shared place is `03 iOS — GO` › `V3 / 23` (`193:3049`).

/// Home's entry to a live ride. Figma: no Figma component yet; drawn inside the screens.
struct LiveRideEntryCard: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TapsoSpace.sm) {
                Image(systemName: "bus.fill")
                    .font(.title3)
                    .foregroundStyle(TapsoColor.mintDeep)
                    .frame(width: 40, height: 40)
                    .background(TapsoColor.journeyActive.opacity(0.14), in: RoundedRectangle(cornerRadius: TapsoRadius.sm, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: TapsoSpace.xs) {
                        Text("live.entry.title")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(TapsoColor.textPrimary)
                        LiveBadge()
                    }
                    Text("live.entry.body")
                        .font(.footnote)
                        .foregroundStyle(TapsoColor.textSecondary)
                }
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(TapsoColor.textTertiary)
            }
            .padding(TapsoSpace.md)
            .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.lg, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("live-ride-entry")
    }
}

/// "실시간 · 베타": live data, and an honest stage label. Figma: no Figma component yet; drawn inside the screens.
struct LiveBadge: View {
    var body: some View {
        Text("live.badge")
            .font(.caption2.weight(.bold))
            .foregroundStyle(TapsoColor.textOnAccent)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(TapsoColor.journeyActive, in: Capsule())
    }
}

/// A live request that did not answer, explained by what kind of failure it was.
/// Figma: no Figma component yet; drawn inside the screens.
struct LiveFailureNotice: View {
    let failure: TransitAPIFailure
    var retry: (() -> Void)?

    var body: some View {
        NoticeCard(
            systemImage: symbol,
            title: LocalizedStringKey(failure.copyKey + ".title"),
            message: LocalizedStringKey(failure.copyKey + ".body"),
            tint: failure.isTransient ? TapsoColor.journeyChecking : TapsoColor.journeyDegraded,
            actionTitle: retry == nil ? nil : "common.retry",
            action: retry
        )
    }

    private var symbol: String {
        switch failure {
        case .offline: "wifi.slash"
        case .timedOut, .providerTimeout: "clock.arrow.circlepath"
        case .sessionsUnavailable, .serviceUnavailable: "hourglass"
        default: "exclamationmark.triangle"
        }
    }
}

/// "몇 번 버스 타요?" The route number, then its official variants. Figma: no current frame.
struct LiveRouteSearchView: View {
    @Bindable var model: TapsoAppModel
    @State private var number = ""
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TapsoSpace.lg) {
                if let place = model.handoffPlace {
                    HandoffPlaceLine(place: place)
                }
                QuestionTitle("live.route.question")
                HStack(spacing: TapsoSpace.sm) {
                    TextField("live.route.placeholder", text: $number)
                        .font(.title2.weight(.bold))
                        .keyboardType(.numbersAndPunctuation)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .focused($focused)
                        .onSubmit(search)
                        .padding(.horizontal, TapsoSpace.md)
                        .frame(minHeight: TapsoSize.primaryButtonHeight)
                        .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
                        .accessibilityIdentifier("live-route-number")
                    Button(action: search) {
                        Image(systemName: "magnifyingglass")
                            .font(.headline)
                            .foregroundStyle(TapsoColor.textOnAccent)
                            .frame(width: TapsoSize.primaryButtonHeight, height: TapsoSize.primaryButtonHeight)
                            .background(TapsoColor.journeyActive, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
                    }
                    .accessibilityLabel(Text("live.route.search"))
                }

                if model.liveSavedJourneyChanged {
                    NoticeCard(
                        systemImage: "arrow.triangle.branch",
                        title: "live.savedChanged.title",
                        message: "live.savedChanged.body",
                        tint: TapsoColor.journeyChecking
                    )
                }

                results

                Label("live.route.note", systemImage: "info.circle")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, TapsoSpace.gutter)
            .padding(.vertical, TapsoSpace.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(TapsoColor.backgroundPrimary)
        .navigationTitle(Text("live.route.title"))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if case let .results(searched, _) = model.liveRouteSearch, number.isEmpty {
                number = searched
            } else if number.isEmpty {
                focused = true
            }
        }
    }

    private func search() {
        let query = number
        focused = false
        Task { await model.searchLiveRoutes(number: query) }
    }

    @ViewBuilder
    private var results: some View {
        switch model.liveRouteSearch {
        case .idle:
            if let failure = model.liveFailure {
                LiveFailureNotice(failure: failure)
            }
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity, minHeight: 80)
                .accessibilityLabel(Text("live.loading"))
        case let .results(searched, routes):
            if routes.isEmpty {
                NoticeCard(
                    systemImage: "magnifyingglass",
                    title: "live.route.empty.title",
                    message: LocalizedStringKey(String(format: RideText.string("live.route.empty.body"), searched)),
                    tint: TapsoColor.journeyDegraded
                )
            } else {
                VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                    Text("live.route.variants")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(TapsoColor.textSecondary)
                    ForEach(routes) { route in
                        Button {
                            Task { await model.chooseLiveRoute(route) }
                        } label: {
                            LiveRouteRow(route: route)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        case let .failed(_, failure):
            LiveFailureNotice(failure: failure, retry: search)
        }
    }
}

/// One official variant: number, first stop, last stop. Figma: no Figma component yet; drawn inside the screens.
struct LiveRouteRow: View {
    let route: TransitAPIRoute

    var body: some View {
        HStack(spacing: TapsoSpace.sm) {
            RouteBadge(number: route.routeNumber)
            VStack(alignment: .leading, spacing: 2) {
                Text(String(format: RideText.string("route.headsign"), route.endStopName ?? "—"))
                    .font(.body.weight(.semibold))
                    .foregroundStyle(TapsoColor.textPrimary)
                if let start = route.startStopName {
                    Text(String(format: RideText.string("live.route.from"), start))
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
        .frame(minHeight: 64)
        .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// "어디서 타요? 어디서 내려요?" on the variant's real stop list. Figma: `03 iOS — GO` › `V3 / 23 Live stops · near the shared place` (`193:3049`).
struct LiveStopPickerView: View {
    @Bindable var model: TapsoAppModel
    let routeID: String
    @State private var timetableSheet: TransitAPITimetable?

    var body: some View {
        ScrollView {
            switch model.liveStops {
            case .idle, .loading:
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 160)
                    .accessibilityLabel(Text("live.loading"))
            case let .failed(route, failure):
                LiveFailureNotice(failure: failure) {
                    Task { await model.loadLiveStops(route) }
                }
                .padding(.horizontal, TapsoSpace.gutter)
                .padding(.vertical, TapsoSpace.lg)
            case let .loaded(stops):
                LiveStopPickerContent(
                    stops: stops,
                    onChoose: { boarding, destination in
                        model.chooseLiveStops(boarding: boarding, destination: destination, on: stops)
                    },
                    place: model.handoffPlace,
                    suggestedDestination: model.screenshotDestinationRoute == stops.route.id ? model.screenshotDestination : nil,
                    fixedDestination: model.fixedDestination(on: stops),
                    destinationMoved: model.catalogDestinationMoved(on: stops),
                    timetable: AnyView(TimetableCard(
                        routeNumber: stops.route.number,
                        load: model.timetables[stops.route.number],
                        onLoad: { Task { await model.loadTimetable(routeNumber: stops.route.number) } },
                        onShowAll: { timetableSheet = $0 }
                    ))
                )
            }
        }
        .background(TapsoColor.backgroundPrimary)
        .sheet(isPresented: Binding(get: { timetableSheet != nil }, set: { if !$0 { timetableSheet = nil } })) {
            if let view = timetableSheet {
                TimetableSheet(view: view)
            }
        }
        .navigationTitle(Text("live.stops.title"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct LiveStopPickerContent: View {
    let stops: LiveRouteStops
    let onChoose: (RouteStop, RouteStop) -> Void
    /// A place shared from a map app: the destination step suggests the stops near it.
    var place: SharedPlace? = nil
    /// A stop a screenshot showed as the place to get off: offered once the rider has chosen where to board.
    var suggestedDestination: RouteStop? = nil
    /// The destination chosen in search, confirmed on this list: only the stops before it are offered.
    var fixedDestination: RouteStop? = nil
    /// The catalog's destination is no longer where it was on this route: the rider chooses again.
    var destinationMoved = false
    /// The route's official timetable card (`TimetableCard`), when shown.
    var timetable: AnyView? = nil

    @State private var boarding: RouteStop?
    @State private var query = ""

    private var candidates: [RouteStop] {
        let all = stops.route.stops
        let eligible: [RouteStop]
        if let boarding {
            eligible = all.filter { $0.sequence > boarding.sequence }
        } else if let fixedDestination {
            eligible = all.filter { $0.sequence < fixedDestination.sequence }
        } else {
            eligible = Array(all.dropLast())
        }
        let needle = StopNameMatcher.normalized(query)
        guard !needle.isEmpty else { return eligible }
        return eligible.filter { StopNameMatcher.normalized($0.stop.name).contains(needle) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.lg) {
            HStack(spacing: TapsoSpace.xs) {
                RouteBadge(number: stops.route.number)
                Text(String(format: RideText.string("route.headsign"), stops.route.destinationName))
                    .font(.subheadline)
                    .foregroundStyle(TapsoColor.textSecondary)
                LiveBadge()
            }

            if let timetable {
                timetable
            }

            if destinationMoved {
                NoticeCard(
                    systemImage: "arrow.triangle.branch",
                    title: "live.stops.catalogMoved.title",
                    message: "live.stops.catalogMoved.body",
                    tint: TapsoColor.journeyChecking
                )
            }

            if stops.topology != "linear" {
                Label("live.stops.loopNote", systemImage: "arrow.triangle.2.circlepath")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let boarding {
                HStack(spacing: TapsoSpace.sm) {
                    StopPair(boarding: boarding.stop.name, destination: RideText.string("live.stops.destinationPending"))
                    Spacer(minLength: 0)
                    Button("live.stops.changeBoarding") {
                        self.boarding = nil
                        query = ""
                    }
                    .font(.subheadline.weight(.semibold))
                }
                QuestionTitle("live.stops.destination")
                if let suggestedDestination, suggestedDestination.sequence > boarding.sequence {
                    screenshotSuggestion(suggestedDestination)
                }
                if let place {
                    suggestions(for: place, after: boarding)
                }
            } else {
                if let fixedDestination {
                    FixedDestinationLine(name: fixedDestination.stop.name)
                }
                if let place {
                    HandoffPlaceLine(place: place)
                }
                if let suggestedDestination, fixedDestination == nil {
                    ScreenshotDestinationLine(name: suggestedDestination.stop.name)
                }
                QuestionTitle("live.stops.boarding")
            }

            TextField("live.stops.filter", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, TapsoSpace.md)
                .frame(minHeight: TapsoSize.minimumTouch + 4)
                .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))

            LazyVStack(spacing: 0) {
                ForEach(candidates, id: \.sequence) { routeStop in
                    StopRow(
                        name: routeStop.stop.name,
                        detail: detail(for: routeStop),
                        systemImage: boarding == nil ? "figure.stand" : "mappin.circle.fill",
                        tint: boarding == nil ? TapsoColor.mintDeep : TapsoColor.tangerine
                    ) {
                        choose(routeStop)
                    }
                    Divider().overlay(TapsoColor.separator)
                }
            }
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Stops after the boarding stop that fit the shared place (`HandoffStopSuggester`). The rider still chooses.
    @ViewBuilder
    private func suggestions(for place: SharedPlace, after boarding: RouteStop) -> some View {
        let match = HandoffStopSuggester.match(
            for: place,
            among: stops.route.stops.filter { $0.sequence > boarding.sequence },
            coordinatesAreSurveyed: stops.coordinatesAreSurveyed
        )
        let noneNearby = match == .nearby([])
        if noneNearby || !match.suggestions.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text(String(format: RideText.string("live.stops.nearPlace"), place.name ?? place.address ?? ""))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(TapsoColor.textSecondary)
                if noneNearby {
                    Text(String(format: RideText.string("live.stops.nearPlace.none"), Int(HandoffStopSuggester.maxStraightLineMeters)))
                        .font(.footnote)
                        .foregroundStyle(TapsoColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, TapsoSpace.xs)
                }
                ForEach(match.suggestions, id: \.routeStop.sequence) { suggestion in
                    StopRow(
                        name: suggestion.routeStop.stop.name,
                        detail: suggestionDetail(suggestion),
                        systemImage: "star.circle.fill",
                        tint: TapsoColor.tangerine
                    ) {
                        choose(suggestion.routeStop)
                    }
                    Divider().overlay(TapsoColor.separator)
                }
            }
            .padding(TapsoSpace.md)
            .background(TapsoColor.tangerine.opacity(0.08), in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
            .accessibilityElement(children: .contain)
        }
    }

    /// The stop the screenshot showed. The rider still chooses.
    private func screenshotSuggestion(_ routeStop: RouteStop) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("mapImport.shot.suggested")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(TapsoColor.textSecondary)
            StopRow(
                name: routeStop.stop.name,
                detail: detail(for: routeStop),
                systemImage: "star.circle.fill",
                tint: TapsoColor.tangerine
            ) {
                choose(routeStop)
            }
        }
        .padding(TapsoSpace.md)
        .background(TapsoColor.tangerine.opacity(0.08), in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private func suggestionDetail(_ suggestion: HandoffStopSuggestion) -> String {
        let order = detail(for: suggestion.routeStop)
        guard let meters = suggestion.straightLineMeters else { return order }
        return order + " · " + String(format: RideText.string("live.stops.straightLine"), meters)
    }

    private func detail(for routeStop: RouteStop) -> String {
        if boarding == nil, let fixedDestination {
            let count = fixedDestination.sequence - routeStop.sequence
            return String(format: RideText.string(RideText.countKey("live.stops.toDestination", count)), count)
        }
        guard let boarding else {
            return String(format: RideText.string("live.stops.order"), routeStop.sequence)
        }
        let count = routeStop.sequence - boarding.sequence
        return String(format: RideText.string(RideText.countKey("live.stops.count", count)), count)
    }

    private func choose(_ routeStop: RouteStop) {
        if let boarding {
            onChoose(boarding, routeStop)
        } else if let fixedDestination {
            onChoose(routeStop, fixedDestination)
        } else {
            boarding = routeStop
            query = ""
        }
    }
}

/// The place the rider shared, kept in view while the ride is set up for it. Figma: no Figma component yet; drawn inside the screens.
struct HandoffPlaceLine: View {
    let place: SharedPlace

    var body: some View {
        Label {
            Text(String(format: RideText.string("live.handoff.place"), place.name ?? place.address ?? ""))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(TapsoColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "mappin.and.ellipse")
                .foregroundStyle(TapsoColor.tangerine)
        }
        .padding(.horizontal, TapsoSpace.sm)
        .padding(.vertical, TapsoSpace.xs)
        .background(TapsoColor.tangerine.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// The stop a screenshot showed as the place to get off, kept in view while the rider chooses where to board.
/// Figma: no Figma component yet; drawn inside the screens.
struct ScreenshotDestinationLine: View {
    let name: String

    var body: some View {
        Label {
            Text(String(format: RideText.string("mapImport.shot.seen"), name))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(TapsoColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "mappin.and.ellipse")
                .foregroundStyle(TapsoColor.tangerine)
        }
        .padding(.horizontal, TapsoSpace.sm)
        .padding(.vertical, TapsoSpace.xs)
        .background(TapsoColor.tangerine.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}
