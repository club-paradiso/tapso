import SwiftUI
import TapsoTransit

// Destination-first on real Jeju data: the canonical catalog (`GET /v1/catalog`),
// searched on the phone. Where you get off → which bus reaches it (each
// variant kept apart) → the server's current stop list with that stop fixed →
// where you board → the bus. Figma: no current frames; the V2 destination
// search (`157:179`) and route select (`157:245`) layouts, on real data.

/// Search results and recents over the catalog.
struct CatalogDestinationSearchContent: View {
    let query: String
    let index: DestinationSearchIndex
    let recentNames: [String]
    /// The catalog's build date, shown: the network is official data as of that day, not live.
    let generatedAt: String
    var refreshFailed = false
    let onChoose: (DestinationPlace) -> Void

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var results: [DestinationPlace] { trimmed.isEmpty ? [] : index.search(trimmed) }
    private var recents: [DestinationPlace] {
        recentNames.compactMap { name in
            let key = DestinationSearchIndex.placeName(name)
            return index.places.first { $0.name == key }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.lg) {
            if trimmed.isEmpty {
                if !recents.isEmpty {
                    section("search.recent", places: recents, symbol: "clock.arrow.circlepath")
                }
                Label {
                    Text(String(format: RideText.string("search.catalog.hint"), index.places.count))
                } icon: {
                    Image(systemName: "magnifyingglass")
                }
                .font(.footnote)
                .foregroundStyle(TapsoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            } else if results.isEmpty {
                NoticeCard(
                    systemImage: "magnifyingglass",
                    title: "search.empty.title",
                    message: "search.catalog.empty",
                    tint: TapsoColor.textTertiary
                )
            } else {
                section("search.results", places: results, symbol: "mappin")
            }
            Label {
                Text(String(format: RideText.string(refreshFailed ? "search.catalog.asOfStale" : "search.catalog.asOf"), Self.day(generatedAt)))
            } icon: {
                Image(systemName: "info.circle")
            }
            .font(.caption)
            .foregroundStyle(TapsoColor.textTertiary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func section(_ title: LocalizedStringKey, places: [DestinationPlace], symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle(title)
                .padding(.bottom, TapsoSpace.xxs)
            ForEach(places) { place in
                StopRow(
                    name: place.name,
                    detail: String(format: RideText.string(RideText.countKey("search.catalog.routes", place.routeCount)), place.routeCount),
                    systemImage: symbol,
                    tint: TapsoColor.tangerine
                ) { onChoose(place) }
                Divider().overlay(TapsoColor.separator)
            }
        }
    }

    /// "2026-10-03T07:41:12.000Z" → "2026-10-03".
    static func day(_ timestamp: String) -> String {
        String(timestamp.prefix(10))
    }
}

/// The catalog is not on the phone yet: loading, or why not, and the way that works without it.
struct CatalogPendingContent: View {
    let status: CatalogStatus
    let onRetry: () -> Void
    let onLive: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.lg) {
            switch status {
            case let .failed(failure):
                LiveFailureNotice(failure: failure, retry: onRetry)
            default:
                HStack(spacing: TapsoSpace.sm) {
                    ProgressView()
                    Text("search.catalog.loading")
                        .font(.subheadline)
                        .foregroundStyle(TapsoColor.textSecondary)
                }
                .frame(maxWidth: .infinity, minHeight: 80)
            }
            LiveRideEntryCard(action: onLive)
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The destination fixed from search, kept in view while the rider chooses where to board.
struct FixedDestinationLine: View {
    let name: String

    var body: some View {
        Label {
            Text(String(format: RideText.string("live.stops.fixedDestination"), name))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(TapsoColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "flag.checkered")
                .foregroundStyle(TapsoColor.tangerine)
        }
        .padding(.horizontal, TapsoSpace.sm)
        .padding(.vertical, TapsoSpace.xs)
        .background(TapsoColor.tangerine.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}
