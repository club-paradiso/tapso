import SwiftUI
import TapsoTransit
import UIKit

/// Foreground haptics and VoiceOver announcements for a change of ride moment.
///
/// Haptics play only while the app is running. The Live Activity's milestone
/// alert (screen, sound, expanded Island) is sent by the running app too: this
/// build has no remote updates, so a suspended app sends nothing and the
/// activity turns to "delayed" at its stale date. iOS offers a Live Activity no
/// custom vibration pattern, so none is promised.
@MainActor
enum RideFeedback {
    static func play(_ haptic: RideHaptic) {
        switch haptic {
        case .none:
            break
        case .preparation:
            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        case .nextStop:
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case .arrival:
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case .attention:
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }

    static func announce(_ guidance: RideGuidance) {
        guard UIAccessibility.isVoiceOverRunning else { return }
        let text = RideText.string(guidance.copy.headline) + ". " + RideText.string(guidance.copy.detail)
        AccessibilityNotification.Announcement(text).post()
    }
}
