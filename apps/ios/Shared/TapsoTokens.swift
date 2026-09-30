import SwiftUI
import TapsoTransit
import UIKit

/// Design System V2 tokens. Figma: `TAPSO Color`, `TAPSO Dimensions` and the
/// `V2 Semantic` collection. Views read only these; no screen defines its own colour.
enum TapsoColor {
    // MARK: Background
    static let backgroundPrimary = dynamic(light: 0xFFFFFF, dark: 0x071923)
    static let backgroundSecondary = dynamic(light: 0xF5FAFB, dark: 0x0E222C)
    static let backgroundElevated = dynamic(light: 0xFFFFFF, dark: 0x16303D)

    // MARK: Text
    static let textPrimary = dynamic(light: 0x071923, dark: 0xFFFFFF)
    static let textSecondary = dynamic(light: 0x566973, dark: 0xB4C4CB)
    static let textTertiary = dynamic(light: 0x5F7079, dark: 0x8599A2)
    /// Text drawn on a journey fill. Ink everywhere except the coral next-stop fill.
    static let textOnAccent = Color(hex: 0x071923)
    /// Text on the coral next-stop fill: white on the deep light-mode coral, ink on the bright dark-mode coral.
    static let textOnUrgent = dynamic(light: 0xFFFFFF, dark: 0x071923)
    /// Text on basalt and the Dynamic Island, which are dark in every appearance.
    static let textOnDarkSurface = Color.white

    // MARK: Lines
    static let separator = dynamic(light: 0xDFE8EB, dark: 0x274452)

    // MARK: Journey
    static let journeyActive = Color(hex: 0x2FC7AA)
    static let journeyPrepare = Color(hex: 0xF4B84A)
    /// Deep enough for white text in light mode (5.0:1), bright enough for ink text and for use on black in dark mode.
    static let journeyNext = dynamic(light: 0xC93C3C, dark: 0xFF7A6E)
    static let journeyArrival = Color(hex: 0xF7972F)
    static let journeyChecking = dynamic(light: 0x4389EF, dark: 0x5B9BFF)
    static let journeyDegraded = dynamic(light: 0x8A9AA3, dark: 0x9FB0B8)

    // MARK: Trust
    static let vehicleConfirmed = journeyActive
    static let vehicleNeedsConfirmation = journeyChecking
    static let dataLive = journeyActive
    static let dataDelayed = journeyPrepare

    // MARK: Identity
    static let tangerine = Color(hex: 0xF7972F)
    static let basalt = Color(hex: 0x0F171A)
    static let basaltRaised = Color(hex: 0x1A2528)
    static let mintDeep = dynamic(light: 0x0B7F6D, dark: 0x2FC7AA)

    static func journey(_ role: RideColorRole) -> Color {
        switch role {
        case .journeyActive: journeyActive
        case .journeyPrepare: journeyPrepare
        case .journeyNext: journeyNext
        case .journeyArrival: journeyArrival
        case .journeyChecking: journeyChecking
        case .journeyDegraded: journeyDegraded
        case .neutral: basalt
        }
    }

    /// Foreground for text placed on a `journey(_:)` fill.
    static func onJourney(_ role: RideColorRole) -> Color {
        switch role {
        case .journeyNext: textOnUrgent
        case .neutral: textOnDarkSurface
        default: textOnAccent
        }
    }

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

enum TapsoSpace {
    static let xxs: CGFloat = 4
    static let xs: CGFloat = 8
    static let sm: CGFloat = 12
    static let md: CGFloat = 16
    static let lg: CGFloat = 20
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    /// Screen edge inset.
    static let gutter: CGFloat = 20
}

enum TapsoRadius {
    static let sm: CGFloat = 12
    static let control: CGFloat = 14
    static let md: CGFloat = 18
    static let lg: CGFloat = 24
    static let hero: CGFloat = 28
}

enum TapsoSize {
    /// Apple's minimum; TAPSO's primary actions are taller for use on a moving bus.
    static let minimumTouch: CGFloat = 44
    static let primaryButtonHeight: CGFloat = 56
    static let routeBadgeHeight: CGFloat = 30
}

enum TapsoType {
    /// The remaining-stop numeral. Scales with Dynamic Type from this base.
    static let heroNumeralBase: CGFloat = 76
    static let heroNumeralMax: CGFloat = 120

    static func numeral(_ size: CGFloat) -> Font {
        .system(size: size, weight: .black, design: .rounded)
    }

    static let routeNumber = Font.system(.headline, design: .rounded, weight: .heavy)
}

enum TapsoMotion {
    static let standard = Animation.easeInOut(duration: 0.25)
    static let emphasis = Animation.spring(response: 0.38, dampingFraction: 0.82)

    static func animation(_ base: Animation, reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : base
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(uiColor: UIColor(hex: hex))
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}
