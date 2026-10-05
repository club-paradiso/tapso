import AppIntents
import SwiftUI
import WidgetKit

/// "다시 타기" in Control Center, on the Lock Screen and on the Action button:
/// one press from anywhere to the vehicle check for the last ride, with no
/// Home and no search (`docs/exec-plans/AUTO_START.md`, M1).
@available(iOS 18.0, *)
struct RideAgainControl: ControlWidget {
    static let kind = "com.lucanomics.tapso.control.rideAgain"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: RideAgainOpenIntent()) {
                Label("control.rideAgain.label", systemImage: "bus.fill")
            }
        }
        .displayName("control.rideAgain.displayName")
        .description("control.rideAgain.description")
    }
}
