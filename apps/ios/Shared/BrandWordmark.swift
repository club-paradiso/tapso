import SwiftUI

/// The brand's names, each for one use (`docs/BRAND_RISK.md`, release gate
/// "Brand integrity" in `docs/exec-plans/TAPSO_V1_RELEASE_CLOSURE.md`).
///
/// - `wordmark` is the visual mark: `TAPSŌ`, with a precomposed macron Ō
///   (U+014C). It is drawn by `BrandWordmark` and nowhere else.
/// - `productName` is the searchable name: `TAPSO`. It stays in
///   `CFBundleDisplayName`, bundle identifiers, URL schemes and prose.
/// - `koreanName` is `탑서`, what VoiceOver says in Korean (`brand.name`).
enum TapsoBrand {
    static let wordmark = "TAPS\u{014C}"
    static let productName = "TAPSO"
    static let koreanName = "탑서"
}

/// The one way the wordmark is rendered: Home, the Debug/demo Home and any
/// future branded surface use this view, so the macron cannot drift into a
/// string literal again. VoiceOver reads the product name, not the mark.
struct BrandWordmark: View {
    /// With 돌이 beside the mark, as on Home.
    var showsBuddy = true
    var textStyle: Font.TextStyle = .title3

    var body: some View {
        HStack(spacing: TapsoSpace.xs) {
            if showsBuddy {
                DolBuddy(moment: .riding, size: 28)
            }
            Text(verbatim: TapsoBrand.wordmark)
                .font(.system(textStyle, design: .rounded, weight: .black))
                .tracking(1.2)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .foregroundStyle(TapsoColor.textPrimary)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("brand.name"))
    }
}
