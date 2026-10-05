import SwiftUI
import TapsoTransit

/// Home answers one question — where are you getting off? — and makes a
/// repeat ride one tap. A first ride opens with what TAPSO does (`HomeIntroCard`);
/// a returning rider sees the last ride first. No map, no feed, no dashboard. Figma: `03 iOS — GO` › `V2 / 01 Home · first ride`
/// (`157:15`) and `V2 / 02 Home · recent & favourites` (`157:73`).
struct HomeView: View {
    @Bindable var model: TapsoAppModel

    var body: some View {
        ScrollView {
            HomeContent(
                library: model.library,
                onSearch: { model.openSearch() },
                onDestination: { model.chooseRecentDestination(named: $0) },
                onRideAgain: { model.rideAgain($0) },
                onToggleFavorite: { model.toggleFavorite($0) },
                onMapImport: { model.openMapImport() },
                onLive: { model.openLiveSearch() },
                onSample: { model.startDemo() },
                onDemoSettings: { model.isDemoPanelPresented = true },
                pendingPlaceName: model.sharedPlace.flatMap { $0.name ?? $0.address }
            )
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(TapsoColor.backgroundPrimary)
        .toolbar(.hidden, for: .navigationBar)
    }
}

struct HomeContent: View {
    let library: JourneyLibrary
    let onSearch: () -> Void
    let onDestination: (String) -> Void
    let onRideAgain: (SavedJourney) -> Void
    let onToggleFavorite: (SavedJourney) -> Void
    let onMapImport: () -> Void
    var onLive: () -> Void = {}
    let onSample: () -> Void
    var onDemoSettings: () -> Void = {}
    /// A place shared from a map app that is waiting for a ride.
    var pendingPlaceName: String? = nil
    /// The sample ride and its "체험판" chip exist only in a demo build (`TapsoBuild`).
    var showsDemo = TapsoBuild.showsDemo

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.xl) {
            header

            if let recent = library.recents.first {
                // A returning rider: the fastest ride is the last one, so it leads.
                VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                    SectionTitle("home.recentJourney")
                    RecentJourneyCard(
                        journey: recent,
                        onRide: { onRideAgain(recent) },
                        onToggleFavorite: { onToggleFavorite(recent) }
                    )
                }

                VStack(alignment: .leading, spacing: TapsoSpace.md) {
                    QuestionTitle("home.question")
                    SearchFieldButton(action: onSearch)
                    if !library.recentDestinationNames.isEmpty {
                        recentDestinations
                    }
                }
            } else {
                // A first ride: say what TAPSO does before asking anything.
                VStack(alignment: .leading, spacing: TapsoSpace.md) {
                    HomeIntroCard()
                    SearchFieldButton(action: onSearch)
                }
            }

            let favorites = library.favorites.filter { $0.id != library.recents.first?.id }
            if !favorites.isEmpty {
                VStack(alignment: .leading, spacing: TapsoSpace.xxs) {
                    SectionTitle("home.favorites")
                    VStack(spacing: 0) {
                        ForEach(favorites) { journey in
                            FavoriteJourneyRow(journey: journey) { onRideAgain(journey) }
                            if journey.id != favorites.last?.id {
                                Divider().overlay(TapsoColor.separator)
                            }
                        }
                    }
                    .padding(.horizontal, TapsoSpace.md)
                    .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.lg, style: .continuous))
                }
            }

            // The other two ways in are alternatives to the search, not peers of it.
            VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                SectionTitle("home.otherWays")
                LiveRideEntryCard(action: onLive)
                MapHandoffIntakeCard(pendingPlaceName: pendingPlaceName, action: onMapImport)
            }

            if showsDemo, library.recents.isEmpty {
                firstRideCard
            }

            Label("home.privacy", systemImage: "location.slash")
                .font(.footnote)
                .foregroundStyle(TapsoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var header: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center) {
                brand
                Spacer()
                if showsDemo { demoChip }
            }
            VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                brand
                if showsDemo { demoChip }
            }
        }
    }

    /// The canonical wordmark (`BrandWordmark`); never a string literal here.
    private var brand: some View {
        BrandWordmark()
    }

    /// The synthetic-data label doubles as the way into the demo settings.
    private var demoChip: some View {
        Button(action: onDemoSettings) {
            DemoDataChip()
        }
        .buttonStyle(.plain)
        .frame(minHeight: TapsoSize.minimumTouch)
        .accessibilityHint(Text("demo.chip.hint"))
        .accessibilityIdentifier("demo-settings")
    }

    private var recentDestinations: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TapsoSpace.xs) {
                ForEach(library.recentDestinationNames, id: \.self) { name in
                    Button { onDestination(name) } label: {
                        HStack(spacing: 6) {
                            CitrusDot(size: 8)
                            Text(verbatim: name)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(TapsoColor.textPrimary)
                        }
                        .padding(.horizontal, TapsoSpace.sm)
                        .frame(minHeight: 40)
                        .background(TapsoColor.backgroundSecondary, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(Text("home.destinationChip.hint"))
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("home.recentDestinations"))
    }

    private var firstRideCard: some View {
        TapsoCard {
            VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                HStack(spacing: TapsoSpace.xs) {
                    RouteBadge(number: DemoFixtures.route.number)
                    Text("home.sample.title")
                        .font(.headline)
                        .foregroundStyle(TapsoColor.textPrimary)
                }
                Text("home.sample.body")
                    .font(.subheadline)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("home.sample.action", action: onSample)
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("start-demo-ride")
            }
        }
    }
}

/// Home's first-ride card: what TAPSO does, in the rider's order, before the
/// search asks anything. 돌이 is awake and blinks; the promise is one line and
/// the three steps are the whole product. Figma: no Figma component yet; drawn inside the screens.
struct HomeIntroCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.md) {
            HStack(alignment: .center, spacing: TapsoSpace.md) {
                DolBuddy(expression: .awake, size: 64, animated: true)
                VStack(alignment: .leading, spacing: TapsoSpace.xxs) {
                    Text("home.intro.title")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(TapsoColor.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    Text("home.intro.body")
                        .font(.subheadline)
                        .foregroundStyle(TapsoColor.textSecondary)
                }
                .fixedSize(horizontal: false, vertical: true)
            }

            ViewThatFits(in: .horizontal) {
                HStack(spacing: TapsoSpace.xs) { steps(separated: true) }
                VStack(alignment: .leading, spacing: TapsoSpace.xs) { steps(separated: false) }
            }
            .accessibilityElement(children: .combine)
        }
        .padding(TapsoSpace.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TapsoColor.journeyActive.opacity(0.10), in: RoundedRectangle(cornerRadius: TapsoRadius.hero, style: .continuous))
    }

    private static let stepKeys: [LocalizedStringKey] = ["home.intro.step1", "home.intro.step2", "home.intro.step3"]

    @ViewBuilder
    private func steps(separated: Bool) -> some View {
        ForEach(Array(Self.stepKeys.enumerated()), id: \.offset) { index, key in
            if separated, index > 0 {
                Image(systemName: "chevron.forward")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(TapsoColor.textTertiary)
                    .accessibilityHidden(true)
            }
            HStack(spacing: 6) {
                Text(verbatim: String(index + 1))
                    .font(.system(.caption, design: .rounded, weight: .black))
                    .foregroundStyle(TapsoColor.textOnAccent)
                    .frame(width: 20, height: 20)
                    .background(TapsoColor.journeyActive, in: Circle())
                Text(key)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(TapsoColor.textPrimary)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
    }
}

/// Looks like a field and opens search; typing happens on the next screen. Figma: `SearchField / V2`.
struct SearchFieldButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TapsoSpace.sm) {
                Image(systemName: "magnifyingglass")
                    .font(.headline)
                    .foregroundStyle(TapsoColor.mintDeep)
                Text("home.search.placeholder")
                    .font(.body)
                    .foregroundStyle(TapsoColor.textSecondary)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, TapsoSpace.md)
            .frame(maxWidth: .infinity, minHeight: TapsoSize.primaryButtonHeight)
            .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous)
                    .stroke(TapsoColor.journeyActive.opacity(0.55), lineWidth: 1.5)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("home.search.placeholder"))
        .accessibilityHint(Text("home.search.hint"))
        .accessibilityIdentifier("destination-search")
    }
}

/// Entry to start from a place shared by KakaoMap or NAVER Map. Figma: no Figma component yet; drawn inside the screens.
struct MapHandoffIntakeCard: View {
    var pendingPlaceName: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TapsoSpace.sm) {
                Image(systemName: "map")
                    .font(.title3)
                    .foregroundStyle(TapsoColor.mintDeep)
                    .frame(width: 40, height: 40)
                    .background(TapsoColor.journeyActive.opacity(0.14), in: RoundedRectangle(cornerRadius: TapsoRadius.sm, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("home.mapImport.title")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(TapsoColor.textPrimary)
                    if let pendingPlaceName {
                        Text(String(format: RideText.string("home.mapImport.pending"), pendingPlaceName))
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(TapsoColor.mintDeep)
                    } else {
                        Text("home.mapImport.body")
                            .font(.footnote)
                            .foregroundStyle(TapsoColor.textSecondary)
                    }
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
    }
}
