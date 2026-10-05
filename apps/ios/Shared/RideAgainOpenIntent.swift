import AppIntents

/// The control's action: open TAPSO at the vehicle check for the last ride
/// (`docs/exec-plans/AUTO_START.md`, M1). An `OpenIntent`, so the system opens
/// the app and runs `perform()` there; Apple requires the intent in both the
/// app and the widget extension. With no saved ride, the app opens search.
struct RideAgainOpenIntent: OpenIntent {
    static var title: LocalizedStringResource { "control.rideAgain.title" }
    static var description: IntentDescription { IntentDescription("control.rideAgain.description") }

    @Parameter(title: "control.rideAgain.target")
    var target: RideAgainTarget

    init() {
        target = .lastRide
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        ShortcutInbox.shared.rideAgainRequests += 1
        return .result()
    }
}

/// Where the control lands. One place today; an enum because `OpenIntent`
/// takes its destination as a parameter.
enum RideAgainTarget: String, AppEnum {
    case lastRide

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "control.rideAgain.target" }
    static var caseDisplayRepresentations: [RideAgainTarget: DisplayRepresentation] {
        [.lastRide: DisplayRepresentation(title: "control.rideAgain.lastRide")]
    }
}
