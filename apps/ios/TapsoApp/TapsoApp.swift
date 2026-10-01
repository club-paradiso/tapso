import SwiftUI

@main
struct TapsoApp: App {
    @State private var model = TapsoAppModel()
    @State private var live = LiveRideModel.app()

    var body: some Scene {
        WindowGroup {
            TapsoRootView(model: model, live: live)
                .onOpenURL { _ in
                    // `tapso://ride` from the Live Activity: the root already shows the ride if one is active.
                    model.path = []
                }
                .onChange(of: ShortcutInbox.shared.rideAgainRequests) { _, _ in
                    model.rideAgainFromShortcut()
                }
        }
    }
}
