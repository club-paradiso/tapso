import PhotosUI
import SwiftUI
import TapsoTransit

// Screenshot route import: pick a screenshot of a map app's route, TAPSO reads it
// on the device, checks it against its own route data, and the rider confirms.
// Figma: no frames yet; drawn from the existing tokens and components.

/// The screenshot entry on the map-import screen: the system photo picker and what came of the last photo.
///
/// `PhotosPicker` runs out of process and hands back only the photo the rider chose, so
/// TAPSO asks for no photo-library permission. The photo's bytes are read once and dropped.
struct ScreenshotImportSection: View {
    @Bindable var model: TapsoAppModel
    @State private var picked: PhotosPickerItem?

    var body: some View {
        ScreenshotImportContent(
            state: model.screenshotImport,
            picker: AnyView(pickerButton(prominent: true)),
            anotherPicker: AnyView(pickerButton(prominent: false)),
            onStart: { proposal in
                Task { await model.startScreenshotRoute(proposal) }
            },
            onOtherRoute: { model.chooseAnotherRoute(like: $0) },
            originalDeletion: model.originalDeletion,
            onDeleteOriginal: { Task { await model.deleteOriginalScreenshot() } }
        )
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task { await load(item) }
        }
    }

    @MainActor
    private func load(_ item: PhotosPickerItem) async {
        defer { picked = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            model.screenshotCouldNotLoad()
            return
        }
        model.importScreenshot(data, assetID: item.itemIdentifier)
    }

    @ViewBuilder
    private func pickerButton(prominent: Bool) -> some View {
        // `.shared()` makes the picker report the photo's identifier, for the rider's own "delete the original".
        PhotosPicker(selection: $picked, matching: .screenshots, photoLibrary: .shared()) {
            if prominent {
                Label("mapImport.shot.action", systemImage: "photo.on.rectangle")
                    .font(.headline)
                    .foregroundStyle(TapsoColor.textOnAccent)
                    .frame(maxWidth: .infinity, minHeight: TapsoSize.primaryButtonHeight)
                    .background(TapsoColor.journeyActive, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
                    .contentShape(Rectangle())
            } else {
                Label("mapImport.shot.another", systemImage: "photo.on.rectangle")
                    .font(.headline)
                    .foregroundStyle(TapsoColor.textPrimary)
                    .frame(maxWidth: .infinity, minHeight: TapsoSize.primaryButtonHeight - 8)
                    .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous)
                            .stroke(TapsoColor.separator, lineWidth: 1)
                    }
                    .contentShape(Rectangle())
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("screenshot-import-pick")
    }
}

/// What the screenshot entry shows for each state. Pure: the photo picker is passed in.
struct ScreenshotImportContent: View {
    let state: ScreenshotImportState
    let picker: AnyView
    let anotherPicker: AnyView
    var onStart: (RouteImportProposal) -> Void = { _ in }
    var onOtherRoute: (RouteImportProposal) -> Void = { _ in }
    var originalDeletion: OriginalDeletionState = .unavailable
    var onDeleteOriginal: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.md) {
            stateContent
            if showsOriginalNote {
                originalNote
            }
        }
    }

    /// Once there is a result to look at, say what happened to the picture, and offer to delete the original.
    private var showsOriginalNote: Bool {
        switch state {
        case .confirm, .choose, .failed: true
        case .idle, .reading: false
        }
    }

    @ViewBuilder
    private var originalNote: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.xs) {
            switch originalDeletion {
            case .unavailable:
                Text("mapImport.shot.kept")
            case .available:
                Text("mapImport.shot.kept")
                Button(action: onDeleteOriginal) {
                    Label("mapImport.shot.delete", systemImage: "trash")
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: TapsoSize.minimumTouch, alignment: .leading)
                }
                .tint(TapsoColor.journeyDegraded)
                .accessibilityHint(Text("mapImport.shot.delete.hint"))
                .accessibilityIdentifier("screenshot-import-delete-original")
            case .deleting:
                HStack(spacing: TapsoSpace.xs) {
                    ProgressView()
                    Text("mapImport.shot.deleting")
                }
            case .deleted:
                Label("mapImport.shot.deleted", systemImage: "checkmark.circle.fill")
            case let .failed(failure):
                if failure == .denied {
                    Text("mapImport.shot.deleteDenied")
                } else {
                    Text("mapImport.shot.deleteFailed")
                }
                Button(action: onDeleteOriginal) {
                    Label("mapImport.shot.delete", systemImage: "trash")
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: TapsoSize.minimumTouch, alignment: .leading)
                }
                .tint(TapsoColor.journeyDegraded)
            }
        }
        .font(.footnote)
        .foregroundStyle(TapsoColor.textSecondary)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var stateContent: some View {
        switch state {
        case .idle:
            VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                picker
                Text("mapImport.shot.hint")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .reading:
            HStack(spacing: TapsoSpace.sm) {
                ProgressView()
                Text("mapImport.shot.reading")
                    .font(.body.weight(.medium))
                    .foregroundStyle(TapsoColor.textPrimary)
            }
            .frame(maxWidth: .infinity, minHeight: TapsoSize.primaryButtonHeight, alignment: .leading)
            .accessibilityElement(children: .combine)
        case let .confirm(proposal):
            confirmation(proposal)
        case let .choose(proposals):
            if proposals.count == 1, let only = proposals.first {
                confirmation(only)
            } else {
                candidates(proposals)
            }
        case let .failed(failure):
            let copy = ScreenshotFailureCopy.copy(for: failure)
            VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                NoticeCard(systemImage: copy.symbol, title: copy.title, message: copy.body, tint: TapsoColor.journeyChecking)
                anotherPicker
            }
        }
    }

    private func confirmation(_ proposal: RouteImportProposal) -> some View {
        let startKey: LocalizedStringKey = proposal.boarding == nil ? "mapImport.shot.confirm.boarding" : "mapImport.shot.confirm.start"
        return VStack(alignment: .leading, spacing: TapsoSpace.md) {
            Text("mapImport.shot.confirm.title")
                .font(.title3.weight(.bold))
                .foregroundStyle(TapsoColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
            ScreenshotRouteSummary(proposal: proposal)
            if proposal.boarding == nil {
                Text("mapImport.shot.confirm.boardingNote")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button { onStart(proposal) } label: {
                Label(startKey, systemImage: "bus.fill")
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityIdentifier("screenshot-import-start")
            Button("mapImport.shot.confirm.other") { onOtherRoute(proposal) }
                .buttonStyle(SecondaryButtonStyle())
            anotherPicker
        }
    }

    private func candidates(_ proposals: [RouteImportProposal]) -> some View {
        VStack(alignment: .leading, spacing: TapsoSpace.sm) {
            Text(String(format: RideText.string("mapImport.shot.choose.title"), proposals.count))
                .font(.title3.weight(.bold))
                .foregroundStyle(TapsoColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text("mapImport.shot.choose.hint")
                .font(.subheadline)
                .foregroundStyle(TapsoColor.textSecondary)
            ForEach(Array(proposals.enumerated()), id: \.offset) { _, proposal in
                Button { onStart(proposal) } label: {
                    ScreenshotCandidateRow(proposal: proposal)
                }
                .buttonStyle(.plain)
            }
            anotherPicker
        }
    }
}

/// The route as TAPSO's own data has it: number, direction, boarding and destination, stop count.
struct ScreenshotRouteSummary: View {
    let proposal: RouteImportProposal

    var body: some View {
        TapsoCard {
            VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                HStack(spacing: TapsoSpace.xs) {
                    RouteBadge(number: proposal.route.number)
                    Text(String(format: RideText.string("route.headsign"), proposal.route.destinationName))
                        .font(.subheadline)
                        .foregroundStyle(TapsoColor.textSecondary)
                }
                if let boarding = proposal.boarding {
                    StopPair(boarding: boarding.stop.name, destination: proposal.destination.stop.name)
                } else {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("recap.getOffAt")
                            .font(.footnote)
                            .foregroundStyle(TapsoColor.textSecondary)
                        Text(verbatim: proposal.destination.stop.name)
                            .font(.headline)
                            .foregroundStyle(TapsoColor.textPrimary)
                    }
                }
                if let count = proposal.stopCount {
                    Text(String(format: RideText.string(RideText.countKey("mapImport.shot.stops", count)), count))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(TapsoColor.textSecondary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilitySummary))
    }

    private var accessibilitySummary: String {
        let number = proposal.route.number
        let destination = proposal.destination.stop.name
        guard let boarding = proposal.boarding else {
            return String(format: RideText.string("mapImport.shot.a11y.destination"), number, destination)
        }
        var summary = String(format: RideText.string("mapImport.shot.a11y.full"), number, boarding.stop.name, destination)
        if let count = proposal.stopCount {
            summary += ", " + String(format: RideText.string(RideText.countKey("mapImport.shot.stops", count)), count)
        }
        return summary
    }
}

/// One candidate in a list of several. Figma: no Figma component yet; drawn like `LiveRouteRow`.
struct ScreenshotCandidateRow: View {
    let proposal: RouteImportProposal

    var body: some View {
        HStack(spacing: TapsoSpace.sm) {
            RouteBadge(number: proposal.route.number)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: places)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(TapsoColor.textPrimary)
                Text(verbatim: detail)
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
            }
            .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward")
                .font(.footnote.weight(.bold))
                .foregroundStyle(TapsoColor.textTertiary)
        }
        .padding(TapsoSpace.md)
        .frame(minHeight: 64)
        .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityText))
    }

    private var places: String {
        let destination = proposal.destination.stop.name
        guard let boarding = proposal.boarding else {
            return RideText.string("recap.getOffAt") + " " + destination
        }
        return boarding.stop.name + " → " + destination
    }

    private var detail: String {
        var parts = [String(format: RideText.string("route.headsign"), proposal.route.destinationName)]
        if let count = proposal.stopCount {
            parts.append(String(format: RideText.string(RideText.countKey("mapImport.shot.stops", count)), count))
        }
        return parts.joined(separator: " · ")
    }

    private var accessibilityText: String {
        let number = proposal.route.number
        let destination = proposal.destination.stop.name
        guard let boarding = proposal.boarding else {
            return String(format: RideText.string("mapImport.shot.a11y.destination"), number, destination) + ", " + detail
        }
        return String(format: RideText.string("mapImport.shot.a11y.full"), number, boarding.stop.name, destination) + ", " + detail
    }
}

/// One plain sentence per failure. Keys are literal so `check_localization.py` sees them.
enum ScreenshotFailureCopy {
    struct Copy {
        let title: LocalizedStringKey
        let body: LocalizedStringKey
        let symbol: String
    }

    static func copy(for failure: RouteImportFailure) -> Copy {
        switch failure {
        case .unreadableImage:
            Copy(title: "mapImport.shot.unreadable.title", body: "mapImport.shot.unreadable.body", symbol: "photo")
        case .noTextFound:
            Copy(title: "mapImport.shot.noText.title", body: "mapImport.shot.noText.body", symbol: "photo")
        case .lowQuality:
            Copy(title: "mapImport.shot.blurry.title", body: "mapImport.shot.blurry.body", symbol: "photo")
        case .notARouteScreenshot:
            Copy(title: "mapImport.shot.notRoute.title", body: "mapImport.shot.notRoute.body", symbol: "photo")
        case .noSupportedBus:
            Copy(title: "mapImport.shot.noBus.title", body: "mapImport.shot.noBus.body", symbol: "magnifyingglass")
        case .routeDataUnavailable:
            Copy(title: "mapImport.shot.data.title", body: "mapImport.shot.data.body", symbol: "exclamationmark.triangle")
        case .noStopMatch, .interrupted:
            Copy(title: "mapImport.shot.fail.title", body: "mapImport.shot.fail.body", symbol: "magnifyingglass")
        }
    }
}
