import SwiftUI
import TapsoTransit

// Boarding-first setup on the catalog (destination → 어디서 타요? → 탈 수 있는 버스).
// A rider thinks "I board here and get off there". The old screen asked them to
// pick a route variant by its terminus and origin ("한라병원 출발 · 1곳에서 탈 수
// 있어요") before they had said where they stand.
// Figma: no Figma component yet; drawn inside the screens.

/// "어디서 타요?": only the stops from which some bus reaches the destination.
struct CatalogBoardingView: View {
    @Bindable var model: TapsoAppModel
    let placeName: String
    @State private var query = ""

    var body: some View {
        let places = model.boardingPlaces(towardPlaceNamed: placeName)
        ScrollView {
            CatalogBoardingContent(
                placeName: placeName,
                places: places,
                query: query,
                recentNames: model.library.recents.map(\.boardingStopName),
                nearby: model.nearbyBoarding,
                onNearby: { Task { await model.findNearbyBoarding(towardPlaceNamed: placeName) } },
                onChoose: { model.chooseBoardingPlace($0, destinationName: placeName) }
            )
        }
        .scrollDismissesKeyboard(.interactively)
        .background(TapsoColor.backgroundPrimary)
        .safeAreaInset(edge: .top) {
            HStack(spacing: TapsoSpace.sm) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(TapsoColor.mintDeep)
                TextField("boardFirst.search.placeholder", text: $query)
                    .font(.body)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("boarding-query")
                if !query.isEmpty {
                    Button { query = "" } label: {
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
        .navigationTitle(Text("boardFirst.step.boarding"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct CatalogBoardingContent: View {
    let placeName: String
    let places: [BoardingPlace]
    let query: String
    var recentNames: [String] = []
    var nearby: NearbyBoarding = .idle
    var onNearby: () -> Void = {}
    let onChoose: (BoardingPlace) -> Void

    /// Up to this many places are listed without a search.
    private static let listAllLimit = 12

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var recents: [BoardingPlace] {
        var seen = Set<String>()
        return recentNames.compactMap { name in
            let key = DestinationSearchIndex.placeName(name)
            guard seen.insert(key).inserted else { return nil }
            return places.first { $0.name == key }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.lg) {
            DestinationRecap(destinationName: placeName)
            VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                QuestionTitle("boardFirst.question")
                Text("boardFirst.note")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if !trimmed.isEmpty {
                let results = DestinationSearchIndex.filter(places, query: trimmed)
                if results.isEmpty {
                    NoticeCard(systemImage: "magnifyingglass", title: "search.empty.title", message: "boardFirst.search.empty", tint: TapsoColor.textTertiary)
                } else {
                    section("search.results", places: results, symbol: "mappin")
                }
            } else {
                nearbyBlock
                if !recents.isEmpty {
                    section("boardFirst.recent", places: recents, symbol: "clock.arrow.circlepath")
                }
                if places.count <= Self.listAllLimit {
                    section("boardFirst.all", places: places, symbol: "mappin")
                } else {
                    Label {
                        Text(String(format: RideText.string("boardFirst.search.hint"), places.count))
                    } icon: {
                        Image(systemName: "magnifyingglass")
                    }
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var nearbyBlock: some View {
        switch nearby {
        case .idle:
            Button(action: onNearby) {
                Label("boardFirst.nearby.action", systemImage: "location")
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("boarding-nearby")
        case .locating:
            HStack(spacing: TapsoSpace.sm) {
                ProgressView()
                Text("boardFirst.nearby.locating")
                    .font(.subheadline)
                    .foregroundStyle(TapsoColor.textSecondary)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
        case .unavailable:
            VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                Text("boardFirst.nearby.unavailable")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("boardFirst.nearby.retry", action: onNearby)
                    .font(.footnote.weight(.semibold))
            }
        case .approximateOnly:
            // Approximate Location cannot tell one pole from the one across the road.
            Text("boardFirst.nearby.approximate")
                .font(.footnote)
                .foregroundStyle(TapsoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        case let .found(found):
            if !found.isEmpty {
                section("boardFirst.nearby.title", places: found, symbol: "location.fill")
            }
        }
    }

    private func section(_ title: LocalizedStringKey, places: [BoardingPlace], symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle(title)
                .padding(.bottom, TapsoSpace.xxs)
            ForEach(places) { place in
                StopRow(
                    name: place.name,
                    detail: String(format: RideText.string("boardFirst.routeCount"), place.routeCount),
                    systemImage: symbol,
                    tint: TapsoColor.mintDeep
                ) { onChoose(place) }
                .accessibilityIdentifier("boarding-\(place.name)")
            }
        }
    }
}

/// "어떤 버스를 탈까요?" with both ends fixed: only the buses from here to there,
/// the one coming soonest first.
struct CatalogTripsView: View {
    @Bindable var model: TapsoAppModel
    let placeName: String
    let boardingName: String

    var body: some View {
        let trips = model.trips(fromBoardingNamed: boardingName, toPlaceNamed: placeName)
        ScrollView {
            CatalogTripsContent(
                boardingName: boardingName,
                placeName: placeName,
                trips: trips,
                arrivals: model.tripArrivals,
                onChoose: { trip in Task { await model.chooseTrip(trip, placeName: placeName) } }
            )
        }
        .refreshable { await model.loadTripArrivals(trips) }
        .background(TapsoColor.backgroundPrimary)
        .navigationTitle(Text("setup.step.route"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct CatalogTripsContent: View {
    let boardingName: String
    let placeName: String
    let trips: [TripOption]
    let arrivals: [String: TripArrival]
    let onChoose: (TripOption) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.lg) {
            TapsoCard {
                StopPair(boarding: boardingName, destination: placeName)
            }
            QuestionTitle("route.question")
            VStack(spacing: TapsoSpace.sm) {
                ForEach(Array(trips.enumerated()), id: \.element.id) { offset, trip in
                    Button { onChoose(trip) } label: {
                        card(trip, soonest: offset == 0 && arrivals[trip.id]?.stops != nil)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("trip-\(trip.id)")
                }
            }
            Label("boardFirst.trips.note", systemImage: "info.circle")
                .font(.footnote)
                .foregroundStyle(TapsoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func card(_ trip: TripOption, soonest: Bool) -> some View {
        HStack(alignment: .center, spacing: TapsoSpace.sm) {
            VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                HStack(spacing: TapsoSpace.xs) {
                    RouteBadge(number: trip.route.routeNo)
                    if soonest {
                        Text("boardFirst.trips.soonest")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(TapsoColor.textOnAccent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(TapsoColor.tangerine, in: Capsule())
                    }
                }
                Text(String(format: RideText.string("route.headsign"), trip.terminus))
                    .font(.body.weight(.semibold))
                    .foregroundStyle(TapsoColor.textPrimary)
                Text(detail(trip))
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
            }
            .multilineTextAlignment(.leading)
            Spacer(minLength: TapsoSpace.xs)
            arrival(arrivals[trip.id])
            Image(systemName: "chevron.forward")
                .font(.footnote.weight(.bold))
                .foregroundStyle(TapsoColor.textTertiary)
        }
        .padding(TapsoSpace.md)
        .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.lg, style: .continuous))
        .overlay {
            if soonest {
                RoundedRectangle(cornerRadius: TapsoRadius.lg, style: .continuous)
                    .stroke(TapsoColor.journeyActive, lineWidth: 2)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// Ride length, and for twins (one stop list under two provider route IDs,
    /// `DECISIONS.md`) which of them: their buses report on their own IDs.
    private func detail(_ trip: TripOption) -> String {
        let length = String(format: RideText.string("boardFirst.trips.rideLength"), trip.stopCount)
        let twins = trips
            .filter { $0.route.routeNo == trip.route.routeNo && $0.route.stops == trip.route.stops }
            .sorted { $0.route.routeId < $1.route.routeId }
        guard twins.count > 1, let ordinal = twins.firstIndex(where: { $0.id == trip.id }) else { return length }
        return length + " · " + String(format: RideText.string("boardFirst.trips.twin"), ordinal + 1, twins.count)
    }

    @ViewBuilder
    private func arrival(_ arrival: TripArrival?) -> some View {
        switch arrival {
        case .loading, .none:
            ProgressView()
                .accessibilityLabel(Text("boardFirst.arrival.loading"))
        case let .stopsAway(count):
            VStack(alignment: .trailing, spacing: 0) {
                if count == 0 {
                    Text("boardFirst.arrival.atStop")
                        .font(.subheadline.weight(.heavy))
                } else {
                    Text(verbatim: String(count))
                        .font(.system(.title2, design: .rounded, weight: .black))
                        .monospacedDigit()
                    Text("boardFirst.arrival.stopsAway")
                        .font(.caption2.weight(.bold))
                }
            }
            .foregroundStyle(TapsoColor.mintDeep)
        case .noneNearby:
            Text("boardFirst.arrival.none")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TapsoColor.textTertiary)
                .multilineTextAlignment(.trailing)
        case .unavailable:
            Image(systemName: "wifi.slash")
                .foregroundStyle(TapsoColor.textTertiary)
                .accessibilityLabel(Text("boardFirst.arrival.unavailable"))
        }
    }
}
