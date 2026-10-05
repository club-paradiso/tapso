import SwiftUI
import TapsoTransit

/// Finds the physical bus and asks the rider to confirm it. Nothing is
/// selected without the rider's tap. Figma: `03 iOS — GO` › `V2 / 07 Matching (searching)`
/// (`158:214`), `V2 / 08 Vehicle confirmation` (`158:277`), `V2 / 09 Multiple candidates` (`158:353`).
struct VehicleCheckView: View {
    @Bindable var model: TapsoAppModel

    var body: some View {
        ScrollView {
            if let draft = model.draft, let route = draft.route {
                if draft.isLive, let failure = model.liveFailure {
                    LiveFailureNotice(failure: failure)
                        .padding(.horizontal, TapsoSpace.gutter)
                        .padding(.top, TapsoSpace.lg)
                }
                VehicleCheckContent(
                    check: model.vehicleCheck,
                    routeNumber: route.number,
                    boardingName: draft.boarding?.name ?? "",
                    destinationName: draft.destination?.name ?? "",
                    isLive: draft.isLive,
                    onConfirm: { proposal in Task { await model.confirmVehicle(proposal) } },
                    onReject: { model.rejectProposal($0) }
                )
            }
        }
        .background(TapsoColor.backgroundPrimary)
        .navigationTitle(Text("check.title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("common.cancel") { model.cancelSetup() }
            }
        }
    }
}

struct VehicleCheckContent: View {
    let check: VehicleCheck
    let routeNumber: String
    let boardingName: String
    let destinationName: String
    /// Live: the buses come from TAPSO's server. Demo: synthetic.
    var isLive = false
    let onConfirm: (VehicleProposal) -> Void
    let onReject: (VehicleProposal) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.lg) {
            BoardingContextCard(routeNumber: routeNumber, boardingName: boardingName, destinationName: destinationName)

            VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                HStack(spacing: TapsoSpace.sm) {
                    // Proposed: 돌이 looks at the rider, who checks the plate. Confirmed: it can rest.
                    DolBuddy(
                        expression: check.stage == .confirmed ? .ride(.riding) : check.stage == .proposed ? .awake : .ride(.checking),
                        size: 32,
                        animated: true
                    )
                    Text(LocalizedStringKey(check.headlineKey))
                        .font(.title2.weight(.bold))
                        .foregroundStyle(TapsoColor.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                }
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)

            switch check.stage {
            case .searching, .notFoundYet:
                SearchingIndicator(reduceMotion: reduceMotion)
            case .proposed, .confirmed:
                if let proposal = check.proposals.first {
                    ConfirmationCard(proposal: proposal, routeNumber: routeNumber, confirmed: check.stage == .confirmed)
                    if check.stage == .proposed {
                        VStack(spacing: TapsoSpace.sm) {
                            Button { onConfirm(proposal) } label: {
                                Text("check.confirm")
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .accessibilityIdentifier("confirm-vehicle")
                            Button { onReject(proposal) } label: {
                                Text("check.reject")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }
                    }
                }
            case .similarBuses, .choose:
                // `choose`: no suggestion is allowed (issue #80). Every bus is a
                // card the rider taps after reading its plate; none is first by
                // anything but where it is.
                VStack(spacing: TapsoSpace.sm) {
                    ForEach(check.proposals) { proposal in
                        Button { onConfirm(proposal) } label: {
                            ConfirmationCard(proposal: proposal, routeNumber: routeNumber, confirmed: false, selectable: true)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(Text("check.pick.hint"))
                    }
                    Button { check.proposals.forEach(onReject) } label: {
                        Text(LocalizedStringKey(check.stage == .choose ? "check.choose.none" : "check.noneOfThese"))
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }

            Label(LocalizedStringKey(isLive ? "check.why.live" : "check.why"), systemImage: "info.circle")
                .font(.footnote)
                .foregroundStyle(TapsoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, TapsoSpace.gutter)
        .padding(.vertical, TapsoSpace.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var detail: String {
        switch check.stage {
        case .searching, .notFoundYet:
            String(format: RideText.string(check.detailKey), routeNumber)
        default:
            RideText.string(check.detailKey)
        }
    }
}

/// Route, boarding stop and destination for the ride being set up. Figma: `BoardingContextCard / V2`.
struct BoardingContextCard: View {
    let routeNumber: String
    let boardingName: String
    let destinationName: String

    var body: some View {
        TapsoCard {
            HStack(alignment: .top, spacing: TapsoSpace.md) {
                RouteBadge(number: routeNumber)
                StopPair(boarding: boardingName, destination: destinationName)
                Spacer(minLength: 0)
            }
        }
    }
}

/// One candidate bus: the plate as painted on the bus, and where it is. Figma: `ConfirmationCard / V2`.
struct ConfirmationCard: View {
    let proposal: VehicleProposal
    let routeNumber: String
    let confirmed: Bool
    var selectable = false

    var body: some View {
        HStack(spacing: TapsoSpace.md) {
            VStack(alignment: .leading, spacing: TapsoSpace.xxs) {
                HStack(spacing: TapsoSpace.xs) {
                    RouteBadge(number: routeNumber, role: confirmed ? .journeyActive : .journeyChecking)
                    Text(position)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(TapsoColor.textSecondary)
                }
                Text(verbatim: proposal.maskedPlate)
                    .font(.system(.largeTitle, design: .rounded, weight: .heavy))
                    .monospacedDigit()
                    .foregroundStyle(TapsoColor.textPrimary)
                Text("check.plateHint")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textTertiary)
            }
            Spacer(minLength: 0)
            Image(systemName: confirmed ? "checkmark.circle.fill" : (selectable ? "hand.tap" : "bus.doubledecker"))
                .font(.title)
                .foregroundStyle(confirmed ? TapsoColor.vehicleConfirmed : TapsoColor.vehicleNeedsConfirmation)
        }
        .padding(TapsoSpace.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TapsoColor.backgroundElevated, in: RoundedRectangle(cornerRadius: TapsoRadius.lg, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: TapsoRadius.lg, style: .continuous)
                .stroke(
                    confirmed ? TapsoColor.vehicleConfirmed : TapsoColor.vehicleNeedsConfirmation.opacity(0.5),
                    lineWidth: confirmed ? 2 : 1.5
                )
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(String(
            format: RideText.string("a11y.proposal"),
            routeNumber,
            proposal.maskedPlate.filter(\.isNumber),
            position
        )))
    }

    private var position: String {
        switch proposal.stopsAway {
        case 0?: RideText.string("check.position.atStop")
        case let count?: String(format: RideText.string(RideText.countKey("check.position.away", count)), count)
        case nil: RideText.string("check.position.unknown")
        }
    }
}

private struct SearchingIndicator: View {
    let reduceMotion: Bool
    @State private var pulse = false

    var body: some View {
        HStack(spacing: TapsoSpace.sm) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.headline)
                .foregroundStyle(TapsoColor.journeyChecking)
                .symbolEffect(.pulse, options: .repeating, isActive: !reduceMotion)
            Text("check.searching.live")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(TapsoColor.journeyChecking)
        }
        .padding(TapsoSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TapsoColor.journeyChecking.opacity(pulse ? 0.16 : 0.08), in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) { pulse = true }
        }
        .accessibilityElement(children: .combine)
    }
}
