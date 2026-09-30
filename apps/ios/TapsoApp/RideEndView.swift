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
                naverAvailable: model.mapRequest(for: .naverMap, to: outcome.destination) != nil,
                kakaoAvailable: model.mapRequest(for: .kakaoMap, to: outcome.destination) != nil,
                handoffFailed: model.mapHandoffFailed,
                onMap: { app in
                    guard let request = model.mapRequest(for: app, to: outcome.destination) else { return }
                    Task { await model.openMapApp(request) }
                },
                onDone: { model.dismissOutcome() }
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

    private var passed: Bool { outcome.moment == .passedDestination }

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
                    RouteBadge(number: outcome.routeNumber, role: .neutral)
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
                    Label("handoff.title", systemImage: "figure.walk")
                        .font(.headline)
                        .foregroundStyle(TapsoColor.textPrimary)
                    Text("handoff.body")
                        .font(.subheadline)
                        .foregroundStyle(TapsoColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if naverAvailable {
                        Button { onMap(.naverMap) } label: {
                            Label("handoff.naver.findDestination", systemImage: "map")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    if !kakaoAvailable {
                        Text("handoff.kakao.unavailable")
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
