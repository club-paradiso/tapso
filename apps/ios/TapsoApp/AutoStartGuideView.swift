import SwiftUI
import UIKit

/// "자동으로 시작하기" (`docs/exec-plans/AUTO_START.md`, M2). iOS lets only the
/// rider create a Shortcuts automation, so TAPSO teaches two recipes that run
/// "탑서로 다시 타기": arrive at the boarding stop, or a time of day. The location
/// stays with Shortcuts; TAPSO never receives it. Step wording follows Apple's
/// Korean Shortcuts guide; the "run without asking" option is described, not
/// named, because its label differs across iOS versions.
/// Figma: no Figma component yet; drawn inside the screens.
struct AutoStartGuideView: View {
    @Environment(\.openURL) private var openURL
    @State private var openFailed = false

    var body: some View {
        ScrollView {
            AutoStartGuideContent(openFailed: openFailed) {
                guard let url = URL(string: "shortcuts://") else { return }
                openURL(url) { accepted in openFailed = !accepted }
            }
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(TapsoColor.backgroundPrimary)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct AutoStartGuideContent: View {
    var openFailed = false
    let onOpenShortcuts: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.xl) {
            VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                QuestionTitle("autoStart.title")
                Text("autoStart.intro")
                    .font(.body)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            recipe(
                title: "autoStart.arrive.title",
                symbol: "mappin.and.ellipse",
                steps: ["autoStart.step.new", "autoStart.arrive.trigger", "autoStart.step.action", "autoStart.step.noAsk"]
            )
            recipe(
                title: "autoStart.time.title",
                symbol: "clock",
                steps: ["autoStart.step.new", "autoStart.time.trigger", "autoStart.step.action", "autoStart.step.noAsk"]
            )

            VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                Button(action: onOpenShortcuts) {
                    Label("autoStart.openShortcuts", systemImage: "arrow.up.forward.app")
                }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("open-shortcuts")
                if openFailed {
                    Text("autoStart.openFailed")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(TapsoColor.journeyNext)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                Label("autoStart.privacy", systemImage: "location.slash")
                Label("autoStart.limit", systemImage: "info.circle")
            }
            .font(.footnote)
            .foregroundStyle(TapsoColor.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func recipe(title: LocalizedStringKey, symbol: String, steps: [LocalizedStringKey]) -> some View {
        TapsoCard {
            VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                Label(title, systemImage: symbol)
                    .font(.headline)
                    .foregroundStyle(TapsoColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    HStack(alignment: .firstTextBaseline, spacing: TapsoSpace.sm) {
                        Text(verbatim: String(index + 1))
                            .font(.system(.caption, design: .rounded, weight: .black))
                            .foregroundStyle(TapsoColor.textOnAccent)
                            .frame(width: 20, height: 20)
                            .background(TapsoColor.journeyActive, in: Circle())
                            .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 5 }
                        Text(step)
                            .font(.subheadline)
                            .foregroundStyle(TapsoColor.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

/// Home's way into the recipes, shown once the rider has a ride to repeat.
/// Figma: no Figma component yet; drawn inside the screens.
struct AutoStartEntryRow: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TapsoSpace.sm) {
                Image(systemName: "wand.and.stars")
                    .font(.title3)
                    .foregroundStyle(TapsoColor.mintDeep)
                    .frame(width: 40, height: 40)
                    .background(TapsoColor.journeyActive.opacity(0.14), in: RoundedRectangle(cornerRadius: TapsoRadius.sm, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("autoStart.entry.title")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(TapsoColor.textPrimary)
                    Text("autoStart.entry.body")
                        .font(.footnote)
                        .foregroundStyle(TapsoColor.textSecondary)
                }
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(TapsoColor.textTertiary)
            }
            .padding(TapsoSpace.md)
            .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.lg, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("auto-start-entry")
    }
}
