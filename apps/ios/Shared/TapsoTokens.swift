import SwiftUI
import TapsoTransit
import UIKit

/// Design System V3 tokens ("basalt"). Figma: `TAPSO Color`, `TAPSO Dimensions` and the
/// `V2 Semantic` collection; direction in `docs/beta/DESIGN_DIRECTION.md`.
/// Views read only these; no screen defines its own colour.
///
/// V3 moves the neutrals from navy ink to Jeju basalt (#0F171A, the identity colour), and
/// the light surfaces from mist to Shore (#F3F5F4). The journey colours and their meanings
/// are unchanged: they are safety semantics, not decoration. Every text pair is at least
/// WCAG AA (4.5:1); the ratios are noted where they are tight.
enum TapsoColor {
    // MARK: Background
    static let backgroundPrimary = dynamic(light: 0xFFFFFF, dark: 0x0F171A)
    /// Shore: rows, fields and the ride card. Ink on it 16.6:1; secondary text 5.7:1.
    static let backgroundSecondary = dynamic(light: 0xF3F5F4, dark: 0x172124)
    static let backgroundElevated = dynamic(light: 0xFFFFFF, dark: 0x1F2B2F)

    // MARK: Text
    /// Basalt ink, never pure black (18.1:1 on white). Off-white in dark (16.1:1 on basalt).
    static let textPrimary = dynamic(light: 0x0F171A, dark: 0xEEF2F1)
    static let textSecondary = dynamic(light: 0x56636A, dark: 0xA9B6BA)
    /// 5.2:1 on Shore, 5.6:1 dark on the raised surface.
    static let textTertiary = dynamic(light: 0x5C686E, dark: 0x8C999E)
    /// Text drawn on a journey fill. Basalt everywhere except the coral next-stop fill.
    static let textOnAccent = Color(hex: 0x0F171A)
    /// Text on the coral next-stop fill: white on the deep light-mode coral (5.0:1), basalt on the bright dark-mode coral (7.1:1).
    static let textOnUrgent = dynamic(light: 0xFFFFFF, dark: 0x0F171A)
    /// Text on basalt and the Dynamic Island, which are dark in every appearance.
    static let textOnDarkSurface = Color.white

    // MARK: Lines
    static let separator = dynamic(light: 0xE1E6E4, dark: 0x2A373B)

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
    /// 돌이's cheeks: the bright coral, which stays pink on basalt in both appearances.
    static let dolCheek = Color(hex: 0xFF7A6E)
    static let basalt = Color(hex: 0x0F171A)
    static let basaltRaised = Color(hex: 0x1A2528)
    /// Mint for text and glyphs on light surfaces: 5.1:1 on Shore (the V2 #0B7F6D was 4.49:1).
    static let mintDeep = dynamic(light: 0x097666, dark: 0x2FC7AA)

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

/// Pretendard faces bundled in the app (`apps/ios/Fonts`, SIL OFL 1.1). The extensions do not
/// bundle them, so every face falls back to the system font there, by design.
enum TapsoFont {
    static let regular = "Pretendard-Regular"
    static let semibold = "Pretendard-SemiBold"
    static let extraBold = "Pretendard-ExtraBold"

    /// Faces that are actually registered in this process (resolved once).
    static let registered: Set<String> = Set([regular, semibold, extraBold].filter { UIFont(name: $0, size: 12) != nil })

    /// Three weights stand in for nine: regular/medium → Regular, semibold/bold → SemiBold,
    /// heavy/black → ExtraBold. Light weights are not used in TAPSO.
    static func face(for weight: Font.Weight) -> String {
        switch weight {
        case .heavy, .black: extraBold
        case .semibold, .bold: semibold
        default: regular
        }
    }

    /// The default point size of each text style at the default Dynamic Type size, so
    /// `Font.custom(_:size:relativeTo:)` scales exactly like the system style it replaces.
    static func baseSize(_ style: Font.TextStyle) -> CGFloat {
        switch style {
        case .largeTitle: 34
        case .title: 28
        case .title2: 22
        case .title3: 20
        case .headline, .body: 17
        case .callout: 16
        case .subheadline: 15
        case .footnote: 13
        case .caption: 12
        case .caption2: 11
        @unknown default: 17
        }
    }
}

extension Font {
    /// TAPSO's type: Pretendard at a system text style's size, scaling with Dynamic Type, or
    /// the system font at the same style and weight where Pretendard is not registered.
    /// `headline` defaults to semibold, as the system style does.
    static func tapso(_ style: Font.TextStyle, _ weight: Font.Weight? = nil) -> Font {
        let weight = weight ?? (style == .headline ? .semibold : .regular)
        let face = TapsoFont.face(for: weight)
        guard TapsoFont.registered.contains(face) else { return .system(style, weight: weight) }
        return .custom(face, size: TapsoFont.baseSize(style), relativeTo: style)
    }
}

enum TapsoType {
    /// The remaining-stop numeral. Scales with Dynamic Type from this base.
    static let heroNumeralBase: CGFloat = 76
    static let heroNumeralMax: CGFloat = 120

    /// Pretendard ExtraBold with tabular figures in the app; SF Pro Rounded Black where
    /// Pretendard is not registered (the Lock Screen and Dynamic Island).
    static func numeral(_ size: CGFloat) -> Font {
        guard TapsoFont.registered.contains(TapsoFont.extraBold) else {
            return .system(size: size, weight: .black, design: .rounded)
        }
        return .custom(TapsoFont.extraBold, fixedSize: size).monospacedDigit()
    }

    static var routeNumber: Font {
        TapsoFont.registered.contains(TapsoFont.extraBold)
            ? Font.tapso(.headline, .heavy).monospacedDigit()
            : Font.system(.headline, design: .rounded, weight: .heavy)
    }
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
