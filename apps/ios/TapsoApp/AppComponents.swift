import SwiftUI
import TapsoTransit

// App-only components. Figma: `02F iOS Ride V2`.

/// One primary action per screen. 56 pt tall for a moving bus. Figma: `Button / V2` (`kind=primary`).
struct PrimaryButtonStyle: ButtonStyle {
    var fill: Color = TapsoColor.journeyActive
    var foreground: Color = TapsoColor.textOnAccent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.tapso(.headline))
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity, minHeight: TapsoSize.primaryButtonHeight)
            .padding(.horizontal, TapsoSpace.md)
            .background(fill, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
            .opacity(configuration.isPressed ? 0.82 : 1)
            .pressFeedback(configuration.isPressed, reduceMotion: reduceMotion)
            .contentShape(Rectangle())
    }
}

/// Figma: `Button / V2` (`kind=secondary`).
struct SecondaryButtonStyle: ButtonStyle {
    var foreground: Color = TapsoColor.textPrimary
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.tapso(.headline))
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity, minHeight: TapsoSize.primaryButtonHeight - 8)
            .padding(.horizontal, TapsoSpace.md)
            .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous)
                    .stroke(TapsoColor.separator, lineWidth: 1)
            }
            .opacity(configuration.isPressed ? 0.82 : 1)
            .pressFeedback(configuration.isPressed, reduceMotion: reduceMotion)
            .contentShape(Rectangle())
    }
}

extension View {
    /// A button settles a little under the finger, so a tap on a moving bus is felt as taken.
    /// Under Reduce Motion only the dimming remains.
    fileprivate func pressFeedback(_ isPressed: Bool, reduceMotion: Bool) -> some View {
        scaleEffect(isPressed && !reduceMotion ? 0.98 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: isPressed)
    }
}

/// A surface card. Figma: no Figma component yet; drawn inside the screens.
struct TapsoCard<Content: View>: View {
    var padding: CGFloat = TapsoSpace.md
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.lg, style: .continuous))
    }
}

struct SectionTitle: View {
    let key: LocalizedStringKey

    init(_ key: LocalizedStringKey) {
        self.key = key
    }

    var body: some View {
        Text(key)
            .font(.tapso(.subheadline, .bold))
            .foregroundStyle(TapsoColor.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The rider's own question at the top of a setup screen.
struct QuestionTitle: View {
    let key: LocalizedStringKey

    init(_ key: LocalizedStringKey) {
        self.key = key
    }

    var body: some View {
        Text(key)
            .font(.tapso(.title, .bold))
            .foregroundStyle(TapsoColor.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }
}

/// States plainly that the app runs on synthetic data. Figma: no Figma component yet; drawn inside the screens.
struct DemoDataChip: View {
    var body: some View {
        Label("demo.chip", systemImage: "testtube.2")
            .font(.tapso(.caption, .semibold))
            .foregroundStyle(TapsoColor.textSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(TapsoColor.backgroundSecondary, in: Capsule())
            .overlay { Capsule().stroke(TapsoColor.separator, lineWidth: 1) }
    }
}

/// Boarding and destination, top to bottom. Figma: `StopPair / V2`.
struct StopPair: View {
    let boarding: String
    let destination: String

    var body: some View {
        HStack(alignment: .top, spacing: TapsoSpace.sm) {
            VStack(spacing: 3) {
                Circle().stroke(TapsoColor.textTertiary, lineWidth: 2).frame(width: 9, height: 9)
                Rectangle().fill(TapsoColor.separator).frame(width: 2).frame(minHeight: 14)
                CitrusDot(size: 11)
            }
            .padding(.top, 5)
            VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                Text(verbatim: boarding)
                    .font(.tapso(.subheadline))
                    .foregroundStyle(TapsoColor.textSecondary)
                Text(verbatim: destination)
                    .font(.tapso(.headline))
                    .foregroundStyle(TapsoColor.textPrimary)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(String(format: RideText.string("a11y.stopPair"), boarding, destination)))
    }
}

/// A ride to repeat, in one tap: the last ride first, then favourites
/// (`LIVE_RIDE_RELIABILITY_HOME_V3.md` §10). Compact on purpose: Home asks
/// where the rider is getting off first, and a repeat ride is a shortcut
/// below that question, not the screen's headline. The star sits beside the
/// row, never inside its button, so one tap never does two things.
struct RideAgainRow: View {
    let journey: SavedJourney
    /// The most recent ride, tagged as such.
    var isLatest = false
    let onRide: () -> Void
    var onToggleFavorite: (() -> Void)? = nil
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(spacing: TapsoSpace.xs) {
            Button(action: onRide) {
                HStack(spacing: TapsoSpace.sm) {
                    if !typeSize.isAccessibilitySize {
                        RouteBadge(number: journey.routeNumber)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        // At accessibility sizes the badge sits above the names, which then get the full width.
                        if typeSize.isAccessibilitySize {
                            RouteBadge(number: journey.routeNumber)
                        }
                        if isLatest {
                            Text("home.rideAgain.latest")
                                .font(.tapso(.caption, .semibold))
                                .foregroundStyle(TapsoColor.textSecondary)
                        }
                        Text(verbatim: journey.destinationStopName)
                            .font(.tapso(.body, .semibold))
                            .foregroundStyle(TapsoColor.textPrimary)
                        Text(String(format: RideText.string("favorite.from"), journey.boardingStopName))
                            .font(.tapso(.footnote))
                            .foregroundStyle(TapsoColor.textSecondary)
                    }
                    .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    // At accessibility sizes the names need the width; the whole row is still the button.
                    if !typeSize.isAccessibilitySize {
                        Image(systemName: "arrow.forward.circle.fill")
                            .font(.tapso(.title2))
                            .foregroundStyle(TapsoColor.journeyActive)
                            .accessibilityHidden(true)
                    }
                }
                .padding(.vertical, TapsoSpace.sm)
                .frame(minHeight: TapsoSize.minimumTouch)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityHint(Text("home.rideAgain.hint"))
            .accessibilityIdentifier(isLatest ? "ride-again-latest" : "ride-again")
            if let onToggleFavorite {
                Button(action: onToggleFavorite) {
                    Image(systemName: journey.isFavorite ? "star.fill" : "star")
                        .font(.tapso(.body, .semibold))
                        .foregroundStyle(journey.isFavorite ? TapsoColor.tangerine : TapsoColor.textTertiary)
                        .frame(width: TapsoSize.minimumTouch, height: TapsoSize.minimumTouch)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(journey.isFavorite ? LocalizedStringKey("favorite.remove") : LocalizedStringKey("favorite.add")))
            }
        }
    }
}

/// A tappable stop name in a list. Figma: `StopRow / V2`.
struct StopRow: View {
    let name: String
    var detail: String?
    var systemImage = "mappin.circle.fill"
    var tint: Color = TapsoColor.textTertiary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TapsoSpace.sm) {
                Image(systemName: systemImage)
                    .font(.tapso(.title3))
                    .foregroundStyle(tint)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: name)
                        .font(.tapso(.body, .medium))
                        .foregroundStyle(TapsoColor.textPrimary)
                    if let detail {
                        Text(verbatim: detail)
                            .font(.tapso(.footnote))
                            .foregroundStyle(TapsoColor.textSecondary)
                    }
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward")
                    .font(.tapso(.footnote, .bold))
                    .foregroundStyle(TapsoColor.textTertiary)
            }
            .padding(.vertical, TapsoSpace.sm)
            .frame(minHeight: TapsoSize.minimumTouch)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A calm explanation of a degraded state: what happened, whether tracking continues, what to do.
/// Figma: `StatusBanner / V2`.
struct StatusBanner: View {
    let guidance: RideGuidance

    var body: some View {
        let color = TapsoColor.journey(guidance.colorRole)
        HStack(alignment: .top, spacing: TapsoSpace.sm) {
            Image(systemName: guidance.symbolName)
                .font(.tapso(.headline))
                .foregroundStyle(color)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 4) {
                Text(LocalizedStringKey(guidance.copy.headline))
                    .font(.tapso(.headline))
                    .foregroundStyle(TapsoColor.textPrimary)
                Text(LocalizedStringKey(guidance.copy.detail))
                    .font(.tapso(.subheadline))
                    .foregroundStyle(TapsoColor.textSecondary)
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(TapsoSpace.md)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous)
                .stroke(color.opacity(0.35), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A notice with an optional action. Figma: no Figma component yet; drawn inside the screens.
struct NoticeCard: View {
    let systemImage: String
    let title: LocalizedStringKey
    let message: LocalizedStringKey
    var tint: Color = TapsoColor.journeyChecking
    var actionTitle: LocalizedStringKey?
    var action: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.sm) {
            HStack(alignment: .top, spacing: TapsoSpace.sm) {
                Image(systemName: systemImage)
                    .font(.tapso(.headline))
                    .foregroundStyle(tint)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.tapso(.headline))
                        .foregroundStyle(TapsoColor.textPrimary)
                    Text(message)
                        .font(.tapso(.subheadline))
                        .foregroundStyle(TapsoColor.textSecondary)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TapsoSpace.md)
        .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: TapsoSpace.xs) {
            configuration.title
            configuration.icon
        }
    }
}

/// Reflows a horizontal pair vertically at accessibility text sizes.
struct AdaptiveStack<Content: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    var spacing: CGFloat = TapsoSpace.sm
    @ViewBuilder var content: Content

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: spacing) { content }
        } else {
            HStack(spacing: spacing) { content }
        }
    }
}
