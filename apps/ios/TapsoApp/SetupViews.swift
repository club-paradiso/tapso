import SwiftUI
import TapsoTransit

// Destination-first setup: where you get off → which bus → where you board.
// Each screen asks one question; a step is skipped when it has only one answer.

/// "어디서 내릴까요?" Figma: `03 iOS — GO` › `V2 / 03 Destination search` (`157:179`).
struct DestinationSearchView: View {
    @Bindable var model: TapsoAppModel
    @State private var query = ""
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            DestinationSearchContent(
                query: query,
                recentNames: model.library.recentDestinationNames,
                onChoose: { model.chooseDestination(named: $0) }
            )
        }
        .scrollDismissesKeyboard(.interactively)
        .background(TapsoColor.backgroundPrimary)
        .safeAreaInset(edge: .top) {
            HStack(spacing: TapsoSpace.sm) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(TapsoColor.mintDeep)
                TextField("home.search.placeholder", text: $query)
                    .font(.body)
                    .focused($focused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("destination-query")
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(TapsoColor.textTertiary)
                            .frame(width: TapsoSize.minimumTouch, height: TapsoSize.minimumTouch)
                    }
                    .accessibilityLabel(Text("search.clear"))
                }
            }
            .padding(.leading, TapsoSpace.md)
            .frame(minHeight: TapsoSize.primaryButtonHeight)
            .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
            .padding(.horizontal, TapsoSpace.gutter)
            .padding(.bottom, TapsoSpace.xs)
            .background(TapsoColor.backgroundPrimary)
        }
        .navigationTitle(Text("search.title"))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { focused = true }
    }
}

struct DestinationSearchContent: View {
    let query: String
    let recentNames: [String]
    let onChoose: (String) -> Void

    private var results: [String] {
        query.trimmingCharacters(in: .whitespaces).isEmpty ? [] : DemoCatalog.searchDestinations(query)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.lg) {
            if query.trimmingCharacters(in: .whitespaces).isEmpty {
                if !recentNames.isEmpty {
                    section("search.recent", names: recentNames, symbol: "clock.arrow.circlepath")
                }
                section("search.allStops", names: DemoCatalog.destinationNames, symbol: "mappin.circle.fill")
                Label("search.demoNote", systemImage: "testtube.2")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if results.isEmpty {
                NoticeCard(
                    systemImage: "magnifyingglass",
                    title: "search.empty.title",
                    message: "search.empty.body",
                    tint: TapsoColor.textTertiary
                )
            } else {
                section("search.results", names: results, symbol: "mappin.circle.fill")
            }
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func section(_ title: LocalizedStringKey, names: [String], symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle(title)
                .padding(.bottom, TapsoSpace.xxs)
            ForEach(names, id: \.self) { name in
                StopRow(name: name, systemImage: symbol, tint: TapsoColor.tangerine) { onChoose(name) }
                Divider().overlay(TapsoColor.separator)
            }
        }
    }
}

/// "어떤 버스를 탈까요?" Shown only when more than one route direction reaches the destination.
/// Figma: `03 iOS — GO` › `V2 / 04 Route select` (`157:245`).
struct RouteSelectView: View {
    @Bindable var model: TapsoAppModel
    let destinationName: String

    var body: some View {
        ScrollView {
            RouteSelectContent(
                destinationName: destinationName,
                options: DemoCatalog.routeOptions(toDestinationNamed: destinationName),
                onChoose: { model.chooseRoute($0) }
            )
        }
        .background(TapsoColor.backgroundPrimary)
        .navigationTitle(Text("setup.step.route"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct RouteSelectContent: View {
    let destinationName: String
    let options: [DemoCatalog.RouteOption]
    let onChoose: (DemoCatalog.RouteOption) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.lg) {
            DestinationRecap(destinationName: destinationName)
            QuestionTitle("route.question")
            VStack(spacing: TapsoSpace.sm) {
                ForEach(options) { option in
                    Button { onChoose(option) } label: {
                        HStack(spacing: TapsoSpace.sm) {
                            RouteBadge(number: option.route.number)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(String(format: RideText.string("route.headsign"), option.route.destinationName))
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(TapsoColor.textPrimary)
                                Text(String(format: RideText.string("route.boardingCount"), option.boardingStops.count))
                                    .font(.footnote)
                                    .foregroundStyle(TapsoColor.textSecondary)
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
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// "어디서 타나요?" The boarding stop, not a trip origin. Figma: `03 iOS — GO` › `V2 / 05 Boarding stop` (`157:289`).
struct BoardingStopView: View {
    @Bindable var model: TapsoAppModel
    let routeID: RouteID
    let destinationStopID: StopID

    var body: some View {
        ScrollView {
            if let route = DemoCatalog.route(id: routeID), let destination = route.routeStop(id: destinationStopID) {
                BoardingStopContent(route: route, destination: destination) { stop in
                    model.chooseBoarding(stop, routeID: routeID, destinationStopID: destinationStopID)
                }
            }
        }
        .background(TapsoColor.backgroundPrimary)
        .navigationTitle(Text("setup.step.boarding"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct BoardingStopContent: View {
    let route: TransitRoute
    let destination: RouteStop
    let onChoose: (Stop) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.lg) {
            HStack(spacing: TapsoSpace.xs) {
                RouteBadge(number: route.number)
                Text(String(format: RideText.string("route.headsign"), route.destinationName))
                    .font(.subheadline)
                    .foregroundStyle(TapsoColor.textSecondary)
            }
            DestinationRecap(destinationName: destination.stop.name)
            QuestionTitle("boarding.question")
            Text("boarding.explain")
                .font(.subheadline)
                .foregroundStyle(TapsoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 0) {
                ForEach(Array(route.stops.filter { $0.sequence < destination.sequence }.reversed()), id: \.stop.id) { routeStop in
                    StopRow(
                        name: routeStop.stop.name,
                        detail: String(format: RideText.string(RideText.countKey("boarding.stopsToDestination", destination.sequence - routeStop.sequence)), destination.sequence - routeStop.sequence),
                        systemImage: "figure.stand",
                        tint: TapsoColor.mintDeep
                    ) { onChoose(routeStop.stop) }
                    Divider().overlay(TapsoColor.separator)
                }
            }
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The destination chosen so far. Figma: no Figma component yet; drawn inside the screens.
struct DestinationRecap: View {
    let destinationName: String

    var body: some View {
        HStack(spacing: TapsoSpace.xs) {
            CitrusDot(size: 10)
            Text("recap.getOffAt")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(TapsoColor.textSecondary)
            Text(verbatim: destinationName)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(TapsoColor.textPrimary)
        }
        .padding(.horizontal, TapsoSpace.sm)
        .padding(.vertical, TapsoSpace.xs)
        .background(TapsoColor.tangerine.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// Start from a map app's route: a screenshot of it, a place shared from the share
/// sheet by TAPSO's share extension, or text pasted here. Read on the device; no
/// picture or shared link is fetched or sent.
/// Figma: `03 iOS — GO` › `V2 / 06 Map-app handoff intake` (`157:379`) and `V3 / 20–22`
/// (`193:2961`, `193:2990`, `193:3019`).
struct MapImportView: View {
    @Bindable var model: TapsoAppModel
    @State private var pasted: String?

    var body: some View {
        ScrollView {
            MapImportContent(
                place: model.sharedPlace,
                unreadable: model.sharedPlaceUnreadable,
                demoMatches: model.sharedPlace.map { model.stopNames(inSharedText: $0.searchText) } ?? [],
                screenshot: AnyView(ScreenshotImportSection(model: model)),
                paste: AnyView(
                    PasteButton(payloadType: String.self) { strings in
                        pasted = strings.joined(separator: "\n")
                    }
                    .buttonBorderShape(.roundedRectangle(radius: TapsoRadius.md))
                    .controlSize(.large)
                    .tint(TapsoColor.journeyActive)
                ),
                onLive: { model.continueWithLiveRoute() },
                onChooseDemo: { model.chooseDestination(named: $0) },
                onSearch: { model.path = [.search] },
                onClear: { model.dismissSharedPlace() }
            )
        }
        .background(TapsoColor.backgroundPrimary)
        .navigationTitle(Text("mapImport.title"))
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: pasted) { _, text in
            guard let text else { return }
            model.importSharedText(text)
            pasted = nil
        }
    }
}

struct MapImportContent: View {
    /// What was pasted or shared, read on the device. `nil` before anything arrives.
    let place: SharedPlace?
    var unreadable = false
    /// Synthetic demo destinations named in the shared place, for the sample ride.
    var demoMatches: [String] = []
    /// The screenshot entry (`ScreenshotImportSection`): the primary way in.
    var screenshot: AnyView = AnyView(EmptyView())
    let paste: AnyView
    var onLive: () -> Void = {}
    let onChooseDemo: (String) -> Void
    let onSearch: () -> Void
    var onClear: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.lg) {
            QuestionTitle("mapImport.question")
            if let place {
                SharedPlaceCard(place: place, onClear: onClear)
                actions(for: place)
            } else {
                screenshot
                VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                    SectionTitle("mapImport.other")
                    Text("mapImport.other.hint")
                        .font(.footnote)
                        .foregroundStyle(TapsoColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    paste
                    Button("mapImport.search", action: onSearch)
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("map-import-search")
                }
                if unreadable {
                    NoticeCard(
                        systemImage: "link",
                        title: "mapImport.none.title",
                        message: "mapImport.none.body",
                        tint: TapsoColor.journeyChecking,
                        actionTitle: "mapImport.none.action",
                        action: onSearch
                    )
                }
            }
            Label("mapImport.privacy", systemImage: "hand.raised")
                .font(.footnote)
                .foregroundStyle(TapsoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func actions(for place: SharedPlace) -> some View {
        if place.isInJeju == false {
            NoticeCard(
                systemImage: "mappin.slash",
                title: "mapImport.outside.title",
                message: "mapImport.outside.body",
                tint: TapsoColor.journeyDegraded,
                actionTitle: "mapImport.another",
                action: onClear
            )
        } else if place.isLinkOnly {
            NoticeCard(
                systemImage: "link",
                title: "mapImport.linkOnly.title",
                message: "mapImport.linkOnly.body",
                tint: TapsoColor.journeyChecking,
                actionTitle: "mapImport.none.action",
                action: onSearch
            )
        } else {
            VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                Text("mapImport.live.title")
                    .font(.headline)
                    .foregroundStyle(TapsoColor.textPrimary)
                Text("mapImport.live.body")
                    .font(.subheadline)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button(action: onLive) {
                    Label("mapImport.live.action", systemImage: "bus.fill")
                }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("map-import-live")
            }
            if !demoMatches.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: TapsoSpace.xs) {
                        SectionTitle("mapImport.found")
                        DemoDataChip()
                    }
                    ForEach(demoMatches, id: \.self) { name in
                        StopRow(name: name, systemImage: "flag.fill", tint: TapsoColor.tangerine) { onChooseDemo(name) }
                        Divider().overlay(TapsoColor.separator)
                    }
                }
            }
        }
    }
}

/// What TAPSO read from a shared place, and what it could not: a name, an
/// address, whether the location is known and in Jeju. Figma: no Figma component yet; drawn inside the screens.
struct SharedPlaceCard: View {
    let place: SharedPlace
    var onClear: (() -> Void)?

    var body: some View {
        TapsoCard {
            VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                HStack(spacing: TapsoSpace.xs) {
                    Label(LocalizedStringKey("mapImport.source." + place.source.rawValue), systemImage: "square.and.arrow.down")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(TapsoColor.textSecondary)
                    Spacer(minLength: 0)
                    if let onClear {
                        Button("mapImport.clear", action: onClear)
                            .font(.footnote.weight(.semibold))
                            .accessibilityIdentifier("map-import-clear")
                    }
                }
                Text(verbatim: place.name ?? place.address ?? RideText.string("mapImport.unnamed"))
                    .font(.title3.weight(.bold))
                    .foregroundStyle(TapsoColor.textPrimary)
                if place.name != nil, let address = place.address {
                    Text(verbatim: address)
                        .font(.subheadline)
                        .foregroundStyle(TapsoColor.textSecondary)
                }
                Label(locationKey, systemImage: locationSymbol)
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .contain)
    }

    private var locationKey: LocalizedStringKey {
        if place.isInJeju == true { return "mapImport.location.jeju" }
        if place.isInJeju == false { return "mapImport.location.outside" }
        return place.isLinkOnly ? "mapImport.location.linkOnly" : "mapImport.location.nameOnly"
    }

    private var locationSymbol: String {
        if place.isInJeju == true { return "mappin.and.ellipse" }
        if place.isInJeju == false { return "mappin.slash" }
        return place.isLinkOnly ? "link" : "text.magnifyingglass"
    }
}
