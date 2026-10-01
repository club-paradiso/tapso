import SwiftUI
import TapsoTransit

// App-only components. Figma: `02F iOS Ride V2`.

/// One primary action per screen. 56 pt tall for a moving bus. Figma: `Button / V2` (`kind=primary`).
struct PrimaryButtonStyle: ButtonStyle {
    var fill: Color = TapsoColor.journeyActive
    var foreground: Color = TapsoColor.textOnAccent

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity, minHeight: TapsoSize.primaryButtonHeight)
            .padding(.horizontal, TapsoSpace.md)
            .background(fill, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
            .opacity(configuration.isPressed ? 0.82 : 1)
            .contentShape(Rectangle())
    }
}

/// Figma: `Button / V2` (`kind=secondary`).
struct SecondaryButtonStyle: ButtonStyle {
    var foreground: Color = TapsoColor.textPrimary

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity, minHeight: TapsoSize.primaryButtonHeight - 8)
            .padding(.horizontal, TapsoSpace.md)
            .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous)
                    .stroke(TapsoColor.separator, lineWidth: 1)
            }
            .opacity(configuration.isPressed ? 0.82 : 1)
            .contentShape(Rectangle())
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
            .font(.subheadline.weight(.bold))
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
            .font(.title.weight(.bold))
            .foregroundStyle(TapsoColor.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }
}

/// States plainly that the app runs on synthetic data. Figma: no Figma component yet; drawn inside the screens.
struct DemoDataChip: View {
    var body: some View {
        Label("demo.chip", systemImage: "testtube.2")
            .font(.caption.weight(.semibold))
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
                    .font(.subheadline)
                    .foregroundStyle(TapsoColor.textSecondary)
                Text(verbatim: destination)
                    .font(.headline)
                    .foregroundStyle(TapsoColor.textPrimary)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(String(format: RideText.string("a11y.stopPair"), boarding, destination)))
    }
}

/// A saved or recent ride, restartable in one tap. Figma: `RecentJourneyCard / V2`.
struct RecentJourneyCard: View {
    let journey: SavedJourney
    let onRide: () -> Void
    let onToggleFavorite: () -> Void

    var body: some View {
        TapsoCard {
            VStack(alignment: .leading, spacing: TapsoSpace.md) {
                HStack(spacing: TapsoSpace.xs) {
                    RouteBadge(number: journey.routeNumber)
                    Text(String(format: RideText.string("route.headsign"), journey.headsign))
                        .font(.subheadline)
                        .foregroundStyle(TapsoColor.textSecondary)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Button(action: onToggleFavorite) {
                        Image(systemName: journey.isFavorite ? "star.fill" : "star")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(journey.isFavorite ? TapsoColor.tangerine : TapsoColor.textTertiary)
                            .frame(width: TapsoSize.minimumTouch, height: TapsoSize.minimumTouch)
                    }
                    .accessibilityLabel(Text(journey.isFavorite ? LocalizedStringKey("favorite.remove") : LocalizedStringKey("favorite.add")))
                }
                StopPair(boarding: journey.boardingStopName, destination: journey.destinationStopName)
                Button(action: onRide) {
                    Label("home.rideAgain", systemImage: "arrow.forward")
                        .labelStyle(TrailingIconLabelStyle())
                }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityHint(Text("home.rideAgain.hint"))
            }
        }
    }
}

/// A compact favourite. Figma: no Figma component yet; drawn inside the screens.
struct FavoriteJourneyRow: View {
    let journey: SavedJourney
    let onRide: () -> Void

    var body: some View {
        Button(action: onRide) {
            HStack(spacing: TapsoSpace.sm) {
                RouteBadge(number: journey.routeNumber)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: journey.destinationStopName)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(TapsoColor.textPrimary)
                    Text(String(format: RideText.string("favorite.from"), journey.boardingStopName))
                        .font(.footnote)
                        .foregroundStyle(TapsoColor.textSecondary)
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(TapsoColor.textTertiary)
            }
            .padding(.vertical, TapsoSpace.sm)
            .frame(minHeight: TapsoSize.minimumTouch)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("home.rideAgain.hint"))
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
                    .font(.title3)
                    .foregroundStyle(tint)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: name)
                        .font(.body.weight(.medium))
                        .foregroundStyle(TapsoColor.textPrimary)
                    if let detail {
                        Text(verbatim: detail)
                            .font(.footnote)
                            .foregroundStyle(TapsoColor.textSecondary)
                    }
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.bold))
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
                .font(.headline)
                .foregroundStyle(color)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 4) {
                Text(LocalizedStringKey(guidance.copy.headline))
                    .font(.headline)
                    .foregroundStyle(TapsoColor.textPrimary)
                Text(LocalizedStringKey(guidance.copy.detail))
                    .font(.subheadline)
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
                    .font(.headline)
                    .foregroundStyle(tint)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                        .foregroundStyle(TapsoColor.textPrimary)
                    Text(message)
                        .font(.subheadline)
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
