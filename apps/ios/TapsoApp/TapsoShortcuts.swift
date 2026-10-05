import AppIntents

/// "탑서로 다시 타기": Siri, Spotlight, the Action button or a Shortcut opens
/// TAPSO at the vehicle check for the last ride. It opens the app rather than
/// starting a Live Activity directly, because a bus is only selected by the
/// rider's confirmation.
struct RideAgainIntent: AppIntent {
    static var title: LocalizedStringResource { "shortcut.rideAgain.title" }
    static var description: IntentDescription { IntentDescription("shortcut.rideAgain.description") }
    static var openAppWhenRun: Bool { true }

    @MainActor
    func perform() async throws -> some IntentResult {
        ShortcutInbox.shared.rideAgainRequests += 1
        return .result()
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
