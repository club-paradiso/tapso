import Observation

/// Hands a shortcut's or a control's request to the running app. Compiled into
/// the widget extension too, because the control's intent must be in both
/// targets; only the app observes it.
@Observable
@MainActor
final class ShortcutInbox {
    static let shared = ShortcutInbox()
    var rideAgainRequests = 0
    /// The saved journey a Shortcuts automation asked for; `nil` means the last ride.
    var requestedJourneyID: String?
}
