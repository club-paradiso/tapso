import SwiftUI
import TapsoTransit

/// Home answers one question — where are you getting off? — and makes a
/// repeat ride one tap. No map, no feed, no dashboard. Figma: `04 iOS` › Home V2.
struct HomeView: View {
    @Bindable var model: TapsoAppModel

    var body: some View {
        ScrollView {
            HomeContent(
                library: model.library,
                onSearch: { model.openSearch() },
                onDestination: { name in
                    model.path = [.search]
                    model.chooseDestination(named: name)
                },
                onRideAgain: { model.rideAgain($0) },
                onToggleFavorite: { model.toggleFavorite($0) },
                onMapImport: { model.openMapImport() },
                onSample: { model.startDemo() }
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
    let onSample: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.xl) {
            header

            VStack(alignment: .leading, spacing: TapsoSpace.md) {
                QuestionTitle("home.question")
                SearchFieldButton(action: onSearch)
                if !library.recentDestinationNames.isEmpty {
                    recentDestinations
                }
            }

            if let recent = library.recents.first {
                VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                    SectionTitle("home.recentJourney")
                    RecentJourneyCard(
                        journey: recent,
                        onRide: { onRideAgain(recent) },
                        onToggleFavorite: { onToggleFavorite(recent) }
                    )
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

            MapHandoffIntakeCard(action: onMapImport)

            if library.recents.isEmpty {
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
        HStack(alignment: .center) {
            HStack(spacing: TapsoSpace.xs) {
                DolBuddy(moment: .riding, size: 28)
                Text(verbatim: "TAPSO")
                    .font(.system(.title3, design: .rounded, weight: .black))
                    .tracking(1.2)
                    .foregroundStyle(TapsoColor.textPrimary)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("brand.name"))
            Spacer()
            DemoDataChip()
        }
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

/// Looks like a field and opens search; typing happens on the next screen. Figma: `DestinationSearchField / V2`.
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

/// Entry to start from a place shared by KakaoMap or NAVER Map. Figma: `MapHandoffCard / V2`.
struct MapHandoffIntakeCard: View {
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
                    Text("home.mapImport.body")
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
    }
}
