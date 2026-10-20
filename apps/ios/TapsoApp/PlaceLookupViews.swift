import MapKit
import SwiftUI
import TapsoTransit

// "정류장 이름은 모르는데 어디 가는지는 안다": the rider types a place or an
// address, Kakao Local (through TAPSO's server, which holds the key) or else
// Apple Maps (MapKit, on the phone) turns it into a coordinate inside Jeju,
// and the catalog's own stops near it become destinations
// (`DestinationSearchIndex.places(near…)`). TAPSO never plans the walk or the
// trip here: it only answers which stop to get off at.

/// A place the lookup found for the query, inside Jeju.
struct PlaceCandidate: Identifiable, Hashable, Sendable {
    var id: String { "\(name)|\(latitude)|\(longitude)" }
    let name: String
    let address: String?
    let latitude: Double
    let longitude: Double
}

enum PlaceLookup {
    /// Who answered: shown under the results, since each names places its own way.
    enum Source: Equatable, Sendable {
        case kakao
        case apple
    }

    /// Kakao Local through TAPSO's server first (best Korean place names); Apple Maps
    /// on the phone when the server has no key, fails, or finds nothing.
    static func search(_ query: String, api: TapsoAPIClient = TapsoAPIClient()) async throws -> (places: [PlaceCandidate], source: Source) {
        do {
            let found = try await api.places(query: query)
                .map { PlaceCandidate(name: $0.name, address: $0.address, latitude: $0.lat, longitude: $0.lng) }
                .filter { NearbyStops.isInJeju(latitude: $0.latitude, longitude: $0.longitude) }
            if !found.isEmpty { return (found, .kakao) }
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            // Fall through to Apple Maps: the server's lookup is a better answer, not the only one.
        }
        return (try await appleSearch(query), .apple)
    }

    /// The same box `NearbyStops` accepts (Jeju, Udo, Gapado, Marado, Chujado), for Apple Maps
    /// to search in: with `.required` (iOS 18+) a narrower region would hide Chujado's stops.
    private static let jejuRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(
            latitude: (NearbyStops.jejuLatitude.lowerBound + NearbyStops.jejuLatitude.upperBound) / 2,
            longitude: (NearbyStops.jejuLongitude.lowerBound + NearbyStops.jejuLongitude.upperBound) / 2
        ),
        span: MKCoordinateSpan(
            latitudeDelta: NearbyStops.jejuLatitude.upperBound - NearbyStops.jejuLatitude.lowerBound,
            longitudeDelta: NearbyStops.jejuLongitude.upperBound - NearbyStops.jejuLongitude.lowerBound
        )
    )

    /// Places and addresses for the query, Jeju only, duplicates dropped, at most `limit`.
    static func appleSearch(_ query: String, limit: Int = 6) async throws -> [PlaceCandidate] {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        request.region = jejuRegion
        request.resultTypes = [.pointOfInterest, .address]
        if #available(iOS 18.0, *) {
            request.regionPriority = .required
        }
        let search = MKLocalSearch(request: request)
        let found: [PlaceCandidate] = try await withCheckedThrowingContinuation { continuation in
            search.start { response, error in
                if let error {
                    // "No results" is an answer, not a failure.
                    if (error as? MKError)?.code == .placemarkNotFound {
                        continuation.resume(returning: [])
                    } else {
                        continuation.resume(throwing: error)
                    }
                    return
                }
                let items = response?.mapItems ?? []
                continuation.resume(returning: items.map { item in
                    let coordinate = item.placemark.coordinate
                    return PlaceCandidate(
                        name: item.name ?? item.placemark.title ?? query,
                        address: item.placemark.title,
                        latitude: coordinate.latitude,
                        longitude: coordinate.longitude
                    )
                })
            }
        }
        withExtendedLifetime(search) {}
        var seen = Set<String>()
        return found
            .filter { NearbyStops.isInJeju(latitude: $0.latitude, longitude: $0.longitude) }
            .filter { seen.insert($0.name + "|" + ($0.address ?? "")).inserted }
            .prefix(limit)
            .map { $0 }
    }
}

/// Places and addresses for the query, each opening onto the catalog stops near it.
/// Runs by itself when no stop name matches; otherwise waits to be asked, so a
/// stop search never sends a request.
struct PlaceLookupSection: View {
    let query: String
    let index: DestinationSearchIndex
    /// True when the stop-name search already found something: the lookup is offered, not run.
    let stopsMatched: Bool
    let onChoose: (DestinationPlace) -> Void

    private enum Phase: Equatable {
        case idle
        case loading
        case found([PlaceCandidate], PlaceLookup.Source)
        case failed
    }

    @State private var phase: Phase = .idle
    @State private var requested = false
    @State private var opened: PlaceCandidate.ID?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var attempt = 0

    private static let nearRadius = NearbyStops.defaultRadiusMeters
    private static let farRadius: Double = 2000

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var runs: Bool { trimmed.count >= 2 && (!stopsMatched || requested) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if trimmed.count >= 2 {
                if runs {
                    SectionTitle("search.place.title")
                        .padding(.bottom, TapsoSpace.xxs)
                    content
                } else {
                    Button {
                        requested = true
                    } label: {
                        Label {
                            Text(String(format: RideText.string("search.place.offer"), trimmed))
                                .font(.tapso(.subheadline, .semibold))
                                .multilineTextAlignment(.leading)
                        } icon: {
                            Image(systemName: "map")
                        }
                        .foregroundStyle(TapsoColor.mintDeep)
                        .frame(maxWidth: .infinity, minHeight: TapsoSize.minimumTouch, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("place-lookup-offer")
                }
            }
        }
        .onChange(of: trimmed) {
            requested = false
            opened = nil
            phase = .idle
        }
        .task(id: "\(trimmed)#\(runs)#\(attempt)") {
            guard runs else { return }
            // Wait for the rider to stop typing: one request per settled query.
            try? await Task.sleep(for: .milliseconds(450))
            guard !Task.isCancelled else { return }
            phase = .loading
            do {
                let (places, source) = try await PlaceLookup.search(trimmed)
                guard !Task.isCancelled else { return }
                phase = .found(places, source)
                if places.count == 1 { opened = places[0].id }
            } catch {
                guard !Task.isCancelled else { return }
                phase = .failed
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .idle, .loading:
            HStack(spacing: TapsoSpace.sm) {
                ProgressView()
                Text("search.place.loading")
                    .font(.tapso(.subheadline))
                    .foregroundStyle(TapsoColor.textSecondary)
            }
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
        case .failed:
            VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                Text("search.place.failed")
                    .font(.tapso(.footnote))
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("common.retry") { attempt += 1 }
                    .font(.tapso(.subheadline, .semibold))
                    .foregroundStyle(TapsoColor.mintDeep)
                    .frame(minHeight: TapsoSize.minimumTouch)
            }
        case let .found(places, source):
            if places.isEmpty {
                Text("search.place.empty")
                    .font(.tapso(.footnote))
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, TapsoSpace.xs)
            } else {
                ForEach(places) { place in
                    placeRow(place)
                    Divider().overlay(TapsoColor.separator)
                }
            }
            Text(source == .kakao ? LocalizedStringKey("search.place.source.kakao") : LocalizedStringKey("search.place.source"))
                .font(.tapso(.caption))
                .foregroundStyle(TapsoColor.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, TapsoSpace.xs)
        }
    }

    @ViewBuilder private func placeRow(_ place: PlaceCandidate) -> some View {
        let isOpen = opened == place.id
        Button {
            withAnimation(TapsoMotion.animation(.snappy, reduceMotion: reduceMotion)) { opened = isOpen ? nil : place.id }
        } label: {
            HStack(spacing: TapsoSpace.sm) {
                Image(systemName: "building.2.crop.circle")
                    .font(.tapso(.title3))
                    .foregroundStyle(TapsoColor.mintDeep)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: place.name)
                        .font(.tapso(.body, .medium))
                        .foregroundStyle(TapsoColor.textPrimary)
                    if let address = place.address, address != place.name {
                        Text(verbatim: address)
                            .font(.tapso(.footnote))
                            .foregroundStyle(TapsoColor.textSecondary)
                            .lineLimit(2)
                    }
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                    .font(.tapso(.footnote, .bold))
                    .foregroundStyle(TapsoColor.textTertiary)
            }
            .padding(.vertical, TapsoSpace.sm)
            .frame(minHeight: TapsoSize.minimumTouch)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("search.place.a11y.open"))
        if isOpen {
            nearbyStops(for: place)
                .padding(.leading, TapsoSpace.lg)
                .transition(.opacity)
        }
    }

    @ViewBuilder private func nearbyStops(for place: PlaceCandidate) -> some View {
        let near = index.places(nearLatitude: place.latitude, longitude: place.longitude, radiusMeters: Self.nearRadius)
        let nearby = near.isEmpty
            ? index.places(nearLatitude: place.latitude, longitude: place.longitude, radiusMeters: Self.farRadius, limit: 3)
            : near
        VStack(alignment: .leading, spacing: 0) {
            Text(String(format: RideText.string("search.place.nearby"), place.name))
                .font(.tapso(.footnote, .semibold))
                .foregroundStyle(TapsoColor.textSecondary)
                .padding(.top, TapsoSpace.xxs)
            if nearby.isEmpty {
                Text("search.place.noStops")
                    .font(.tapso(.footnote))
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, TapsoSpace.xs)
            } else {
                if near.isEmpty {
                    Text("search.place.far")
                        .font(.tapso(.caption))
                        .foregroundStyle(TapsoColor.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, TapsoSpace.xxs)
                }
                ForEach(nearby) { stop in
                    StopRow(
                        name: stop.place.name,
                        detail: String(format: RideText.string("search.place.stopDetail"), stop.walkMinutes, stop.distanceMeters),
                        systemImage: "mappin",
                        tint: TapsoColor.tangerine
                    ) { onChoose(stop.place) }
                }
            }
        }
        .padding(.bottom, TapsoSpace.xs)
    }
}

/// The demo's place lookup: the same "place → stops near it" flow on SYNTHETIC
/// places (`DemoCatalog.places`), so it can be rehearsed with no network and no key.
struct DemoPlaceLookupSection: View {
    let query: String
    let onChoose: (String) -> Void

    @State private var opened: DemoPlace.ID?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let farRadius: Double = 2000

    private var places: [DemoPlace] { DemoCatalog.searchPlaces(query) }

    var body: some View {
        if !places.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                SectionTitle("search.place.title")
                    .padding(.bottom, TapsoSpace.xxs)
                ForEach(places) { place in
                    row(place)
                    Divider().overlay(TapsoColor.separator)
                }
                Label("search.place.demoNote", systemImage: "testtube.2")
                    .font(.tapso(.caption))
                    .foregroundStyle(TapsoColor.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, TapsoSpace.xs)
            }
            .onChange(of: query) { opened = nil }
        }
    }

    @ViewBuilder private func row(_ place: DemoPlace) -> some View {
        let isOpen = opened == place.id || places.count == 1
        Button {
            withAnimation(TapsoMotion.animation(.snappy, reduceMotion: reduceMotion)) { opened = isOpen ? nil : place.id }
        } label: {
            HStack(spacing: TapsoSpace.sm) {
                Image(systemName: "building.2.crop.circle")
                    .font(.tapso(.title3))
                    .foregroundStyle(TapsoColor.mintDeep)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: place.name)
                        .font(.tapso(.body, .medium))
                        .foregroundStyle(TapsoColor.textPrimary)
                    if let address = place.address {
                        Text(verbatim: address)
                            .font(.tapso(.footnote))
                            .foregroundStyle(TapsoColor.textSecondary)
                    }
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                    .font(.tapso(.footnote, .bold))
                    .foregroundStyle(TapsoColor.textTertiary)
            }
            .padding(.vertical, TapsoSpace.sm)
            .frame(minHeight: TapsoSize.minimumTouch)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("search.place.a11y.open"))
        if isOpen {
            nearby(place)
                .padding(.leading, TapsoSpace.lg)
                .transition(.opacity)
        }
    }

    @ViewBuilder private func nearby(_ place: DemoPlace) -> some View {
        let near = DemoCatalog.nearbyDestinations(latitude: place.latitude, longitude: place.longitude)
        let stops = near.isEmpty
            ? DemoCatalog.nearbyDestinations(latitude: place.latitude, longitude: place.longitude, radiusMeters: Self.farRadius, limit: 3)
            : near
        VStack(alignment: .leading, spacing: 0) {
            Text(String(format: RideText.string("search.place.nearby"), place.name))
                .font(.tapso(.footnote, .semibold))
                .foregroundStyle(TapsoColor.textSecondary)
                .padding(.top, TapsoSpace.xxs)
            if stops.isEmpty {
                Text("search.place.noStops")
                    .font(.tapso(.footnote))
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, TapsoSpace.xs)
            } else {
                if near.isEmpty {
                    Text("search.place.far")
                        .font(.tapso(.caption))
                        .foregroundStyle(TapsoColor.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, TapsoSpace.xxs)
                }
                ForEach(stops) { stop in
                    StopRow(
                        name: stop.name,
                        detail: String(format: RideText.string("search.place.stopDetail"), stop.walkMinutes, stop.distanceMeters),
                        systemImage: "mappin",
                        tint: TapsoColor.tangerine
                    ) { onChoose(stop.name) }
                }
            }
        }
        .padding(.bottom, TapsoSpace.xs)
    }
}
