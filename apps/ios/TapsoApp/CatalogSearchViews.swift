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
                section("search.results", places: results, symbol: "mappin.circle.fill")
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

/// "어떤 버스를 탈까요?" on the catalog: every variant that reaches the place,
/// grouped by route number and never merged.
struct CatalogRouteSelectView: View {
    @Bindable var model: TapsoAppModel
    let placeName: String

    var body: some View {
        ScrollView {
            if let index = model.catalogIndex, let place = model.catalogPlace(named: placeName) {
                CatalogRouteSelectContent(
                    placeName: place.name,
                    groups: index.routeOptions(to: place),
                    onChoose: { option in
                        Task { await model.chooseCatalogRoute(option, placeName: place.name) }
                    }
                )
            }
        }
        .background(TapsoColor.backgroundPrimary)
        .navigationTitle(Text("setup.step.route"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct CatalogRouteSelectContent: View {
    let placeName: String
    let groups: [DestinationRouteGroup]
    let onChoose: (DestinationRouteOption) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.lg) {
            DestinationRecap(destinationName: placeName)
            QuestionTitle("route.question")
            Text("route.catalog.note")
                .font(.footnote)
                .foregroundStyle(TapsoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                    RouteBadge(number: group.routeNo)
                    if group.options.contains(where: { $0.twin != nil }) {
                        Text("route.catalog.twinNote")
                            .font(.caption)
                            .foregroundStyle(TapsoColor.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(group.options) { option in
                        Button { onChoose(option) } label: {
                            row(option)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("catalog-route-\(option.id)")
                    }
                }
            }
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row(_ option: DestinationRouteOption) -> some View {
        HStack(spacing: TapsoSpace.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(String(format: RideText.string("route.headsign"), option.terminus))
                    .font(.body.weight(.semibold))
                    .foregroundStyle(TapsoColor.textPrimary)
                Text(detail(option))
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
        .accessibilityElement(children: .combine)
    }

    private func detail(_ option: DestinationRouteOption) -> String {
        var parts = [String(format: RideText.string("live.route.from"), option.origin)]
        if let via = option.via {
            parts.append(String(format: RideText.string("route.catalog.via"), via))
        } else if let twin = option.twin {
            // Same stops under another route ID: the buses report on their own ID, so say they are separate.
            parts.append(String(format: RideText.string("route.catalog.twin"), twin.ordinal, twin.count))
        }
        parts.append(String(format: RideText.string("route.boardingCount"), option.boardingCount))
        return parts.joined(separator: " · ")
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
