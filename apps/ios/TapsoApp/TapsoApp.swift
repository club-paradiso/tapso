import SwiftUI

@main
struct TapsoApp: App {
    @State private var model = TapsoAppModel()

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
        }
    }
}
