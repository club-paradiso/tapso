import MapKit
import SwiftUI
import TapsoTransit

// "정류장 이름은 모르는데 어디 가는지는 안다": the rider types a place or an
// address, Apple Maps (MapKit, on the phone, no TAPSO request and no key)
// turns it into a coordinate inside Jeju, and the catalog's own stops near it
// become destinations (`DestinationSearchIndex.places(near…)`). TAPSO never
// plans the walk or the trip here: it only answers which stop to get off at.

/// A place Apple Maps found for the query, inside Jeju.
struct PlaceCandidate: Identifiable, Hashable, Sendable {
    var id: String { "\(name)|\(latitude)|\(longitude)" }
    let name: String
    let address: String?
    let latitude: Double
    let longitude: Double
}

enum PlaceLookup {
    /// Jeju Island and its islets, for Apple Maps to search in.
    private static let jejuRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 33.38, longitude: 126.55),
        span: MKCoordinateSpan(latitudeDelta: 0.95, longitudeDelta: 0.95)
    )

    /// Places and addresses for the query, Jeju only, duplicates dropped, at most `limit`.
    static func search(_ query: String, limit: Int = 6) async throws -> [PlaceCandidate] {
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
        case found([PlaceCandidate])
        case failed
    }

    @State private var phase: Phase = .idle
    @State private var requested = false
    @State private var opened: PlaceCandidate.ID?
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
                                .font(.subheadline.weight(.semibold))
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
                let places = try await PlaceLookup.search(trimmed)
                guard !Task.isCancelled else { return }
                phase = .found(places)
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
                    .font(.subheadline)
                    .foregroundStyle(TapsoColor.textSecondary)
            }
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
        case .failed:
            VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                Text("search.place.failed")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("common.retry") { attempt += 1 }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(TapsoColor.mintDeep)
                    .frame(minHeight: TapsoSize.minimumTouch)
            }
        case let .found(places):
            if places.isEmpty {
                Text("search.place.empty")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, TapsoSpace.xs)
            } else {
                ForEach(places) { place in
                    placeRow(place)
                    Divider().overlay(TapsoColor.separator)
                }
            }
            Text("search.place.source")
                .font(.caption)
                .foregroundStyle(TapsoColor.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, TapsoSpace.xs)
        }
    }

    @ViewBuilder private func placeRow(_ place: PlaceCandidate) -> some View {
        let isOpen = opened == place.id
        Button {
            withAnimation(.snappy) { opened = isOpen ? nil : place.id }
        } label: {
            HStack(spacing: TapsoSpace.sm) {
                Image(systemName: "building.2.crop.circle")
                    .font(.title3)
                    .foregroundStyle(TapsoColor.mintDeep)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: place.name)
                        .font(.body.weight(.medium))
                        .foregroundStyle(TapsoColor.textPrimary)
                    if let address = place.address, address != place.name {
                        Text(verbatim: address)
                            .font(.footnote)
                            .foregroundStyle(TapsoColor.textSecondary)
                            .lineLimit(2)
                    }
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                    .font(.footnote.weight(.bold))
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
                .font(.footnote.weight(.semibold))
                .foregroundStyle(TapsoColor.textSecondary)
                .padding(.top, TapsoSpace.xxs)
            if nearby.isEmpty {
                Text("search.place.noStops")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, TapsoSpace.xs)
            } else {
                if near.isEmpty {
                    Text("search.place.far")
                        .font(.caption)
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
