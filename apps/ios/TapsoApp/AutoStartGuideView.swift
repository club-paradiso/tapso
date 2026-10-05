import SwiftUI
import TapsoTransit
import UIKit

/// "자동으로 시작하기" (`docs/exec-plans/AUTO_START.md`, M2 and M3). First the
/// saved-stop nudge switches (M3), then the Shortcuts recipes. iOS lets only the
/// rider create a Shortcuts automation, so TAPSO teaches two recipes that run
/// "탑서로 다시 타기": arrive at the boarding stop, or a time of day. The location
/// stays with Shortcuts; TAPSO never receives it. Step wording follows Apple's
/// Korean Shortcuts guide; the "run without asking" option is described, not
/// named, because its label differs across iOS versions.
/// Figma: no Figma component yet; drawn inside the screens.
struct AutoStartGuideView: View {
    let library: JourneyLibrary
    @Environment(\.openURL) private var openURL
    @State private var openFailed = false
    @State private var nudges = StopNudgeController.shared

    var body: some View {
        ScrollView {
            AutoStartGuideContent(
                openFailed: openFailed,
                nudgeRows: StopNudgeRow.rows(library: library, settings: nudges.settings),
                nudgeFailure: nudges.lastFailure,
                nudgeNeedsAlways: !nudges.settings.stops.isEmpty && nudges.authorization != .authorizedAlways,
                onToggleNudge: { id, on in
                    Task {
                        if on, let journey = library.journey(id: id) {
                            await nudges.enable(journey)
                        } else {
                            await nudges.disable(id)
                        }
                    }
                },
                onOpenShortcuts: {
                    guard let url = URL(string: "shortcuts://") else { return }
                    openURL(url) { accepted in openFailed = !accepted }
                }
            )
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(TapsoColor.backgroundPrimary)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One saved journey in the saved-stop nudge list.
struct StopNudgeRow: Identifiable, Equatable {
    let id: String
    let routeNumber: String
    let boardingStopName: String
    let destinationStopName: String
    let isOn: Bool
    /// Only a live journey has a real stop to watch.
    let isLive: Bool

    /// Favourites first, then recent rides, each once.
    static func rows(library: JourneyLibrary, settings: StopNudgeSettings) -> [StopNudgeRow] {
        var seen = Set<String>()
        return (library.favorites + library.recents)
            .filter { seen.insert($0.id).inserted }
            .map {
                StopNudgeRow(
                    id: $0.id, routeNumber: $0.routeNumber, boardingStopName: $0.boardingStopName,
                    destinationStopName: $0.destinationStopName, isOn: settings.isEnabled($0.id), isLive: $0.isLive
                )
            }
    }
}

struct AutoStartGuideContent: View {
    var openFailed = false
    var nudgeRows: [StopNudgeRow] = []
    var nudgeFailure: StopNudgeController.EnableFailure? = nil
    var nudgeNeedsAlways = false
    var onToggleNudge: (String, Bool) -> Void = { _, _ in }
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

            // The least work for the rider first: one switch, and TAPSO speaks first.
            stopNudgeSection

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

    /// `AUTO_START.md` M3: TAPSO speaks first at an opted-in boarding stop.
    private var stopNudgeSection: some View {
        TapsoCard {
            VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                Label("stopNudge.section.title", systemImage: "bell.badge")
                    .font(.headline)
                    .foregroundStyle(TapsoColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text("stopNudge.section.body")
                    .font(.subheadline)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(nudgeRows) { row in
                    Toggle(isOn: Binding(get: { row.isOn }, set: { onToggleNudge(row.id, $0) })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: "\(row.routeNumber) · \(row.boardingStopName)")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(TapsoColor.textPrimary)
                            Text(verbatim: "→ \(row.destinationStopName)")
                                .font(.footnote)
                                .foregroundStyle(TapsoColor.textSecondary)
                        }
                    }
                    .tint(TapsoColor.journeyActive)
                    .disabled(!row.isLive)
                }
                if let key = failureKey {
                    Text(key)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(TapsoColor.journeyNext)
                        .fixedSize(horizontal: false, vertical: true)
                } else if nudgeNeedsAlways {
                    Text("stopNudge.needsAlways")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(TapsoColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Label("stopNudge.privacy", systemImage: "iphone")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var failureKey: LocalizedStringKey? {
        switch nudgeFailure {
        case .none: nil
        case .notLive: "stopNudge.failure.notLive"
        case .limitReached: "stopNudge.failure.limit"
        case .locationDenied: "stopNudge.failure.locationDenied"
        case .stopUnknown: "stopNudge.failure.stopUnknown"
        case .network: "stopNudge.failure.network"
        }
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
