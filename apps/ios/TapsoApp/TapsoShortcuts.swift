import AppIntents
import TapsoTransit

/// "탑서로 다시 타기": Siri, Spotlight, the Action button or a Shortcut opens
/// TAPSO at the vehicle check for the last ride. It opens the app rather than
/// starting a Live Activity directly, because a bus is only selected by the
/// rider's confirmation.
///
/// A Shortcuts automation (arrive at a stop, a time of day) can name which
/// saved journey to start (`AUTO_START.md`, M2); with none, the last ride.
struct RideAgainIntent: AppIntent {
    static var title: LocalizedStringResource { "shortcut.rideAgain.title" }
    static var description: IntentDescription { IntentDescription("shortcut.rideAgain.description") }
    static var openAppWhenRun: Bool { true }

    @Parameter(title: "shortcut.rideAgain.journey")
    var journey: SavedJourneyEntity?

    @MainActor
    func perform() async throws -> some IntentResult {
        ShortcutInbox.shared.requestedJourneyID = journey?.id
        ShortcutInbox.shared.rideAgainRequests += 1
        return .result()
    }
}

/// A saved journey as Shortcuts shows it: "365 · 제주버스터미널 → 제주시청(아라방면)".
/// Read from the phone's own library; nothing is fetched.
struct SavedJourneyEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "shortcut.journey.type" }
    static var defaultQuery: SavedJourneyQuery { SavedJourneyQuery() }

    let id: String
    let routeNumber: String
    let boardingStopName: String
    let destinationStopName: String

    init(_ journey: SavedJourney) {
        id = journey.id
        routeNumber = journey.routeNumber
        boardingStopName = journey.boardingStopName
        destinationStopName = journey.destinationStopName
    }

    var label: String { "\(routeNumber) · \(boardingStopName) → \(destinationStopName)" }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(label)")
    }
}

struct SavedJourneyQuery: EntityQuery {
    /// Tests point this at their own defaults.
    nonisolated(unsafe) static var store = JourneyStore()

    func entities(for identifiers: [String]) async throws -> [SavedJourneyEntity] {
        let library = Self.store.loadLibrary()
        return identifiers.compactMap { library.journey(id: $0).map(SavedJourneyEntity.init) }
    }

    /// Favourites first, then the most recent, each once.
    func suggestedEntities() async throws -> [SavedJourneyEntity] {
        let library = Self.store.loadLibrary()
        var seen = Set<String>()
        return (library.favorites + library.recents)
            .filter { seen.insert($0.id).inserted }
            .map(SavedJourneyEntity.init)
    }
}

struct TapsoShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: RideAgainIntent(),
            phrases: [
                "\(.applicationName)로 다시 타기",
                "Ride again with \(.applicationName)"
            ],
            shortTitle: "shortcut.rideAgain.short",
            systemImageName: "bus.fill"
        )
    }
}
