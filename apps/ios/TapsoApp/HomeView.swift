import SwiftUI
import TapsoTransit

/// Home answers one question — where are you getting off? — and makes a
/// repeat ride one tap. A first ride opens with what TAPSO does (`HomeIntroCard`);
/// a returning rider is asked the question first and finds the last ride and
/// favourites as one-tap rows below it (`HomeLayout`). No map, no feed, no dashboard. Figma: `03 iOS — GO` › `V2 / 01 Home · first ride`
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
                onAutoStart: { model.openAutoStartGuide() },
                onDemoSettings: { model.isDemoPanelPresented = true },
                onFeedback: TapsoBuild.showsFieldTools ? { model.isFeedbackPresented = true } : nil,
                pendingPlaceName: model.sharedPlace.flatMap { $0.name ?? $0.address }
            )
        }
        .sheet(isPresented: $model.isFeedbackPresented) { FeedbackView(model: model) }
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
    var onAutoStart: () -> Void = {}
    var onDemoSettings: () -> Void = {}
    /// Debug and Beta builds: the tester's way to report a problem (`FeedbackView`).
    var onFeedback: (() -> Void)? = nil
    /// A place shared from a map app that is waiting for a ride.
    var pendingPlaceName: String? = nil
    /// The sample ride and its "체험판" chip exist only in a demo build (`TapsoBuild`).
    var showsDemo = TapsoBuild.showsDemo

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.xl) {
            header
            ForEach(HomeLayout.sections(for: library, showsDemo: showsDemo), id: \.self) { section in
                view(for: section)
            }
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func view(for section: HomeSection) -> some View {
        switch section {
        case .intro:
            // A first ride: say what TAPSO does before asking anything.
            VStack(alignment: .leading, spacing: TapsoSpace.md) {
                HomeIntroCard()
                SearchFieldButton(action: onSearch)
            }
        case .destination:
            VStack(alignment: .leading, spacing: TapsoSpace.md) {
                QuestionTitle("home.question")
                SearchFieldButton(action: onSearch)
                if !library.recentDestinationNames.isEmpty {
                    recentDestinations
                }
            }
        case .rideAgain:
            rideAgain
        case .autoStart:
            AutoStartEntryRow(action: onAutoStart)
        case .otherWays:
            // The other two ways in are alternatives to the search, not peers of it.
            VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                SectionTitle("home.otherWays")
                LiveRideEntryCard(action: onLive)
                MapHandoffIntakeCard(pendingPlaceName: pendingPlaceName, action: onMapImport)
            }
        case .sample:
            firstRideCard
        case .privacy:
            VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                Label("home.privacy", systemImage: "location.slash")
                    .font(.tapso(.footnote))
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let onFeedback {
                    Button(action: onFeedback) {
                        Label("feedback.entry", systemImage: "exclamationmark.bubble")
                            .font(.tapso(.subheadline, .semibold))
                            .frame(minHeight: TapsoSize.minimumTouch)
                    }
                    .foregroundStyle(TapsoColor.mintDeep)
                    .accessibilityIdentifier("home-feedback")
                }
            }
        }
    }

    /// The last ride, then favourites: each one tap from the bus check.
    private var rideAgain: some View {
        let journeys = HomeLayout.rideAgainJourneys(in: library)
        return VStack(alignment: .leading, spacing: TapsoSpace.xs) {
            SectionTitle("home.rideAgain")
            VStack(spacing: 0) {
                ForEach(journeys) { journey in
                    RideAgainRow(
                        journey: journey,
                        isLatest: journey.id == library.recents.first?.id,
                        onRide: { onRideAgain(journey) },
                        onToggleFavorite: { onToggleFavorite(journey) }
                    )
                    if journey.id != journeys.last?.id {
                        Divider().overlay(TapsoColor.separator)
                    }
                }
            }
            .padding(.leading, TapsoSpace.md)
            .padding(.trailing, TapsoSpace.xxs)
            .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.lg, style: .continuous))
        }
    }

    /// Home shows only the brand. The sample-ride settings are a development tool, so a
    /// Debug build opens them from a long press on the wordmark instead of a "synthetic data"
    /// chip: a tester riding real Jeju buses must never be told their data is fake.
    private var header: some View {
        HStack(alignment: .center) {
            brand
            Spacer()
        }
    }

    /// The canonical wordmark (`BrandWordmark`); never a string literal here.
    @ViewBuilder
    private var brand: some View {
        if showsDemo {
            BrandWordmark()
                .contentShape(Rectangle())
                .onLongPressGesture(minimumDuration: 0.6, perform: onDemoSettings)
                .accessibilityAction(named: Text("demo.chip.hint"), onDemoSettings)
                .accessibilityIdentifier("demo-settings")
        } else {
            BrandWordmark()
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
                                .font(.tapso(.subheadline, .semibold))
                                .foregroundStyle(TapsoColor.textPrimary)
                        }
                        .padding(.horizontal, TapsoSpace.sm)
                        .frame(minHeight: TapsoSize.minimumTouch)
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
                        .font(.tapso(.headline))
                        .foregroundStyle(TapsoColor.textPrimary)
                }
                Text("home.sample.body")
                    .font(.tapso(.subheadline))
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
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.md) {
            // At accessibility sizes 돌이 sits above the words, which then get the full width.
            let layout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: TapsoSpace.sm))
                : AnyLayout(HStackLayout(alignment: .center, spacing: TapsoSpace.md))
            layout {
                DolBuddy(expression: .awake, size: 64, animated: true)
                VStack(alignment: .leading, spacing: TapsoSpace.xxs) {
                    Text("home.intro.title")
                        .font(.tapso(.title2, .bold))
                        .foregroundStyle(TapsoColor.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    Text("home.intro.body")
                        .font(.tapso(.subheadline))
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
                    .font(.tapso(.caption2, .bold))
                    .foregroundStyle(TapsoColor.textTertiary)
                    .accessibilityHidden(true)
            }
            HStack(spacing: 6) {
                Text(verbatim: String(index + 1))
                    .font(.tapso(.caption, .black))
                    .foregroundStyle(TapsoColor.textOnAccent)
                    .frame(width: 20, height: 20)
                    .background(TapsoColor.journeyActive, in: Circle())
                // In a row the steps keep their width so ViewThatFits can measure them;
                // stacked, they wrap instead of running off a narrow or large-type screen.
                if separated {
                    Text(key)
                        .font(.tapso(.footnote, .semibold))
                        .foregroundStyle(TapsoColor.textPrimary)
                        .lineLimit(1)
                        .fixedSize()
                } else {
                    Text(key)
                        .font(.tapso(.footnote, .semibold))
                        .foregroundStyle(TapsoColor.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
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
                    .font(.tapso(.headline))
                    .foregroundStyle(TapsoColor.mintDeep)
                Text("home.search.placeholder")
                    .font(.tapso(.body))
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
                    .font(.tapso(.title3))
                    .foregroundStyle(TapsoColor.mintDeep)
                    .frame(width: 40, height: 40)
                    .background(TapsoColor.journeyActive.opacity(0.14), in: RoundedRectangle(cornerRadius: TapsoRadius.sm, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("home.mapImport.title")
                        .font(.tapso(.body, .semibold))
                        .foregroundStyle(TapsoColor.textPrimary)
                    if let pendingPlaceName {
                        Text(String(format: RideText.string("home.mapImport.pending"), pendingPlaceName))
                            .font(.tapso(.footnote, .semibold))
                            .foregroundStyle(TapsoColor.mintDeep)
                    } else {
                        Text("home.mapImport.body")
                            .font(.tapso(.footnote))
                            .foregroundStyle(TapsoColor.textSecondary)
                    }
                }
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward")
                    .font(.tapso(.footnote, .bold))
                    .foregroundStyle(TapsoColor.textTertiary)
            }
            .padding(TapsoSpace.md)
            .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.lg, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// One block of Home. The order is decided by `HomeLayout`, not by the view, so a
/// new way in (a future "오늘 뭐하젠?" discovery entry, `LIVE_RIDE_RELIABILITY_HOME_V3.md`
/// §12) is one case and one rule here, never another branch in a growing stack.
enum HomeSection: Hashable, CaseIterable {
    /// First ride only: what TAPSO does, then the search.
    case intro
    /// "어디서 내릴까요?", the search and recent stops: the primary action.
    case destination
    /// The last ride and favourites, one tap each.
    case rideAgain
    /// The automatic-start guide entry.
    case autoStart
    /// Bus number and map import.
    case otherWays
    /// The synthetic sample ride, demo builds only.
    case sample
    case privacy
}

enum HomeLayout {
    /// Home's blocks, top to bottom. Destination search always comes before any shortcut.
    static func sections(for library: JourneyLibrary, showsDemo: Bool) -> [HomeSection] {
        let returning = !library.recents.isEmpty
        var sections: [HomeSection] = returning ? [.destination] : [.intro]
        if !rideAgainJourneys(in: library).isEmpty { sections.append(.rideAgain) }
        if returning { sections.append(.autoStart) }
        sections.append(.otherWays)
        if showsDemo, !returning { sections.append(.sample) }
        sections.append(.privacy)
        return sections
    }

    /// The last ride first, then favourites without repeating it.
    static func rideAgainJourneys(in library: JourneyLibrary) -> [SavedJourney] {
        let latest = library.recents.first
        return (latest.map { [$0] } ?? []) + library.favorites.filter { $0.id != latest?.id }
    }
}
