import SwiftUI

@main
struct TapsoApp: App {
    @State private var model = TapsoAppModel()

    init() {
        // Before the first scene: a relaunch for a saved-stop event needs the
        // monitor and the notification delegate in place (`AUTO_START.md`, M3).
        StopNudgeController.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            TapsoRootView(model: model)
                .onOpenURL { _ in
                    // `tapso://ride` from the Live Activity: the root already shows the ride if one is active.
                    model.path = []
                }
                .onChange(of: ShortcutInbox.shared.rideAgainRequests) { _, _ in
                    model.rideAgainFromShortcut()
                }
                .task {
                    // A cold launch from the control or a shortcut can run the intent
                    // before this view observes the inbox; the count is per process.
                    if ShortcutInbox.shared.rideAgainRequests > 0 {
                        model.rideAgainFromShortcut()
                    }
                }
        }
    }
}
