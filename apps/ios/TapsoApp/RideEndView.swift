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
                onAppleMaps: { model.openAppleMaps(for: outcome) },
                returnService: model.returnService,
                onRetryReturn: { Task { await model.loadReturnService(for: outcome) } }
            )
        }
        .background(TapsoColor.backgroundPrimary)
        .task { await model.loadReturnService(for: outcome) }
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
    /// Live rides: today's last buses for the way back.
    var returnService: ReturnService = .idle
    var onRetryReturn: () -> Void = {}

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

            ReturnTripCard(service: returnService, onRetry: onRetryReturn)

            Button("end.done", action: onDone)
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("end-done")
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.xxl)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Today's last buses of the route number, for the way back after a live ride.
/// Figma: `ReturnTripCard / V3`. Times are departures from each variant's starting
/// stop; the card says so, and never turns a published headway into a timetable.
struct ReturnTripCard: View {
    let service: ReturnService
    var onRetry: () -> Void = {}

    var body: some View {
        switch service {
        case .idle:
            EmptyView()
        case .loading:
            TapsoCard {
                HStack(spacing: TapsoSpace.sm) {
                    ProgressView()
                    Text("returnTrip.loading")
                        .font(.subheadline)
                        .foregroundStyle(TapsoColor.textSecondary)
                }
            }
        case let .failed(failure):
            LiveFailureNotice(failure: failure, retry: onRetry)
        case let .loaded(rows):
            TapsoCard {
                VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                    Label("returnTrip.title", systemImage: "moon.stars")
                        .font(.headline)
                        .foregroundStyle(TapsoColor.textPrimary)
                    ForEach(rows) { row in
                        ReturnTripRow(row: row)
                        if row.id != rows.last?.id {
                            Divider().overlay(TapsoColor.separator)
                        }
                    }
                    Text("returnTrip.note")
                        .font(.footnote)
                        .foregroundStyle(TapsoColor.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

struct ReturnTripRow: View {
    let row: ReturnServiceRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: TapsoSpace.xs) {
                RouteBadge(number: row.route.routeNumber)
                Text(String(format: RideText.string("returnTrip.direction"), row.route.startStopName ?? "—", row.route.endStopName ?? "—"))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(TapsoColor.textPrimary)
                    .lineLimit(2)
                if row.ridden {
                    Text("returnTrip.ridden")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(TapsoColor.textSecondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(TapsoColor.backgroundElevated, in: Capsule())
                }
            }
            Text(verbatim: levelText)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(levelColor)
            if let detail = detailText {
                Text(verbatim: detail)
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
            }
        }
        .padding(.vertical, TapsoSpace.xxs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var advice: LastBusAdvice { row.advice }

    private var levelText: String {
        let by = advice.beAtStopBy ?? ""
        switch advice.level {
        case .comfortable: return RideText.string("returnTrip.level.comfortable")
        case .leaveBy: return String(format: RideText.string("returnTrip.level.leaveBy"), by)
        case .tight: return String(format: RideText.string("returnTrip.level.tight"), by)
        case .notRecommended:
            return RideText.string(advice.isGone ? "returnTrip.level.gone" : "returnTrip.level.now")
        case .unknown: return RideText.string("returnTrip.level.unknown")
        }
    }

    private var levelColor: Color {
        switch advice.level {
        case .comfortable: TapsoColor.mintDeep
        case .leaveBy: TapsoColor.journeyArrival
        case .tight, .notRecommended: TapsoColor.journeyNext
        case .unknown: TapsoColor.textSecondary
        }
    }

    private var detailText: String? {
        var parts: [String] = []
        if let last = advice.lastDeparture {
            parts.append(String(format: RideText.string("returnTrip.last"), last))
        }
        if let headway = advice.headwayMinutes {
            let key = switch advice.day {
            case .weekday: "returnTrip.headway.weekday"
            case .saturday: "returnTrip.headway.saturday"
            case .sunday: "returnTrip.headway.sunday"
            }
            parts.append(String(format: RideText.string(key), headway))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
