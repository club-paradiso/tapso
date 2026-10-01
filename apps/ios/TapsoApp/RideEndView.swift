import SwiftUI
import TapsoTransit

/// After the ride: a short close, and the walk handed to a map app.
/// Figma: `04 iOS` › End Journey V2.
struct RideEndView: View {
    @Bindable var model: TapsoAppModel
    let outcome: RideOutcome

    var body: some View {
        ScrollView {
            RideEndContent(
                outcome: outcome,
                naverAvailable: model.mapRequest(for: .naverMap, outcome: outcome) != nil,
                kakaoAvailable: model.mapRequest(for: .kakaoMap, outcome: outcome) != nil,
                handoffFailed: model.mapHandoffFailed,
                onMap: { app in
                    guard let request = model.mapRequest(for: app, outcome: outcome) else { return }
                    Task { await model.openMapApp(request) }
                },
                onDone: { model.dismissOutcome() },
                appleMapsAvailable: model.appleMapsTarget(for: outcome) != nil,
                appleMapsFailed: model.appleMapsFailed,
                onAppleMaps: { model.openAppleMaps(for: outcome) }
            )
        }
        .background(TapsoColor.backgroundPrimary)
    }
}

struct RideEndContent: View {
    let outcome: RideOutcome
    let naverAvailable: Bool
    let kakaoAvailable: Bool
    let handoffFailed: MapApp?
    let onMap: (MapApp) -> Void
    let onDone: () -> Void
    var appleMapsAvailable = false
    var appleMapsFailed = false
    var onAppleMaps: () -> Void = {}

    private var passed: Bool { outcome.moment == .passedDestination }
    /// The shared place the walk goes to, when the ride started from one.
    private var placeName: String? { outcome.place.flatMap { $0.name ?? $0.address } }

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.xl) {
            VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                DolBuddy(moment: passed ? .passedDestination : .arrived, size: 56)
                Text(passed ? LocalizedStringKey("end.passed.title") : LocalizedStringKey("end.title"))
                    .font(.largeTitle.weight(.bold))
                    .foregroundStyle(TapsoColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                HStack(spacing: TapsoSpace.xs) {
                    RouteBadge(number: outcome.routeNumber)
                    Text(verbatim: outcome.destination.name)
                        .font(.headline)
                        .foregroundStyle(TapsoColor.textPrimary)
                }
                Text(passed ? LocalizedStringKey("end.passed.body") : LocalizedStringKey("end.body"))
                    .font(.subheadline)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            TapsoCard {
                VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                    if let placeName {
                        Label {
                            Text(String(format: RideText.string("handoff.place.title"), placeName))
                        } icon: {
                            Image(systemName: "figure.walk")
                        }
                        .font(.headline)
                        .foregroundStyle(TapsoColor.textPrimary)
                        Text("handoff.place.body")
                            .font(.subheadline)
                            .foregroundStyle(TapsoColor.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Label("handoff.title", systemImage: "figure.walk")
                            .font(.headline)
                            .foregroundStyle(TapsoColor.textPrimary)
                        Text("handoff.body")
                            .font(.subheadline)
                            .foregroundStyle(TapsoColor.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if naverAvailable {
                        Button { onMap(.naverMap) } label: {
                            Label("handoff.continue.naverMap", systemImage: "map")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    if kakaoAvailable {
                        Button { onMap(.kakaoMap) } label: {
                            Label("handoff.continue.kakaoMap", systemImage: "map")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    if appleMapsAvailable {
                        Button(action: onAppleMaps) {
                            Label("handoff.show.appleMaps", systemImage: "map")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    if outcome.place == nil && !kakaoAvailable {
                        Text("handoff.kakao.unavailable")
                            .font(.footnote)
                            .foregroundStyle(TapsoColor.textTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let place = outcome.place, place.coordinate == nil {
                        Text("handoff.place.nameOnly")
                            .font(.footnote)
                            .foregroundStyle(TapsoColor.textTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let handoffFailed {
                        Text(LocalizedStringKey("handoff.failed." + handoffFailed.rawValue))
                            .font(.footnote)
                            .foregroundStyle(TapsoColor.journeyNext)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if appleMapsFailed {
                        Text("handoff.failed.appleMaps")
                            .font(.footnote)
                            .foregroundStyle(TapsoColor.journeyNext)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            Button("end.done", action: onDone)
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("end-done")
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.xxl)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
