import Observation
import SwiftUI
import TapsoTransit
import UIKit
import UniformTypeIdentifiers

/// The share sheet's state: read what was shared, then keep it for the app or copy it.
@MainActor
@Observable
final class ShareModel {
    enum Phase: Equatable {
        case reading
        case nothing
        case found(SharedPlace)
        case saved(SharedPlace)
        case copied(SharedPlace)
    }

    private(set) var phase: Phase = .reading
    @ObservationIgnored var onFinish: () -> Void = {}
    @ObservationIgnored private var pending: [NSExtensionItem] = []
    /// `nil` when the App Group is not provisioned for this install.
    private let inbox: HandoffInbox?

    init(inbox: HandoffInbox?) {
        self.inbox = inbox
    }

    var canHandOff: Bool { inbox != nil }

    func receive(_ items: [NSExtensionItem]) {
        pending = items
        Task { await self.readPending() }
    }

    /// Keeps only the parsed place, for the app to take once (`HandoffInbox`).
    func save() {
        guard case let .found(place) = phase, let inbox else { return }
        inbox.put(place, at: Date())
        phase = .saved(place)
    }

    /// The fallback without an App Group: the rider's own copy, pasted in TAPSO.
    func copy() {
        guard case let .found(place) = phase else { return }
        UIPasteboard.general.string = Self.pasteText(for: place)
        phase = .copied(place)
    }

    func finish() {
        onFinish()
    }

    /// Lines `SharedPlaceParser` reads back: the name, the address, the coordinate.
    static func pasteText(for place: SharedPlace) -> String {
        var lines: [String] = []
        if let name = place.name { lines.append(name) }
        if let address = place.address { lines.append(address) }
        if let coordinate = place.coordinate {
            lines.append(String(format: "%.6f, %.6f", coordinate.latitude, coordinate.longitude))
        }
        return lines.joined(separator: "\n")
    }

    private func readPending() async {
        let items = pending
        pending = []
        var texts: [String] = []
        var links: [String] = []
        for item in items {
            if let text = item.attributedContentText?.string, !text.isEmpty {
                texts.append(text)
            }
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    if let url = await Self.load(URL.self, from: provider) {
                        links.append(url.absoluteString)
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    if let text = await Self.load(String.self, from: provider) {
                        texts.append(text)
                    }
                }
            }
        }
        if let place = SharedPlaceParser.parse(text: texts.joined(separator: "\n"), urls: links) {
            phase = .found(place)
        } else {
            phase = .nothing
        }
    }

    private static func load<T: Transferable & Sendable>(_ type: T.Type, from provider: NSItemProvider) async -> T? {
        await withCheckedContinuation { continuation in
            _ = provider.loadTransferable(type: type) { result in
                continuation.resume(returning: try? result.get())
            }
        }
    }
}

/// Figma: `03 iOS — GO` › `V3 / 24 Share sheet · place found` (`193:3098`).
struct ShareSheetView: View {
    let model: ShareModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: TapsoSpace.lg) {
                    content
                    Label("share.privacy", systemImage: "hand.raised")
                        .font(.footnote)
                        .foregroundStyle(TapsoColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, TapsoSpace.gutter)
                .padding(.vertical, TapsoSpace.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(TapsoColor.backgroundPrimary)
            .navigationTitle(Text("share.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("share.close") { model.finish() }
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .reading:
            ProgressView {
                Text("share.reading")
            }
            .frame(maxWidth: .infinity, minHeight: 120)
        case .nothing:
            ShareMessage(systemImage: "questionmark.circle", title: "share.nothing.title", message: "share.nothing.body")
        case let .found(place):
            SharePlaceSummary(place: place)
            if place.isInJeju == false {
                ShareMessage(systemImage: "mappin.slash", title: "mapImport.outside.title", message: "mapImport.outside.body")
            } else if place.isLinkOnly {
                ShareMessage(systemImage: "link", title: "mapImport.linkOnly.title", message: "mapImport.linkOnly.body")
            } else if model.canHandOff {
                Button("share.save") { model.save() }
                    .buttonStyle(ShareActionStyle())
            } else {
                Text("share.unavailable")
                    .font(.subheadline)
                    .foregroundStyle(TapsoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("share.copy") { model.copy() }
                    .buttonStyle(ShareActionStyle())
            }
        case let .saved(place):
            SharePlaceSummary(place: place)
            ShareMessage(systemImage: "checkmark.circle.fill", title: "share.saved.title", message: "share.saved.body")
            Button("share.done") { model.finish() }
                .buttonStyle(ShareActionStyle())
        case let .copied(place):
            SharePlaceSummary(place: place)
            ShareMessage(systemImage: "doc.on.clipboard", title: "share.copied.title", message: "share.copied.body")
            Button("share.done") { model.finish() }
                .buttonStyle(ShareActionStyle())
        }
    }
}

/// What TAPSO read: where it came from, the name, the address, and whether the location is known.
struct SharePlaceSummary: View {
    let place: SharedPlace

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.xs) {
            Text(LocalizedStringKey("mapImport.source." + place.source.rawValue))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(TapsoColor.textSecondary)
            if let title = place.name ?? place.address {
                Text(verbatim: title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(TapsoColor.textPrimary)
            } else {
                Text("mapImport.unnamed")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(TapsoColor.textPrimary)
            }
            if place.name != nil, let address = place.address {
                Text(verbatim: address)
                    .font(.subheadline)
                    .foregroundStyle(TapsoColor.textSecondary)
            }
            Text(locationKey)
                .font(.footnote)
                .foregroundStyle(TapsoColor.textSecondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TapsoSpace.md)
        .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var locationKey: LocalizedStringKey {
        if place.isInJeju == true { return "mapImport.location.jeju" }
        if place.isInJeju == false { return "mapImport.location.outside" }
        return place.isLinkOnly ? "mapImport.location.linkOnly" : "mapImport.location.nameOnly"
    }
}

struct ShareMessage: View {
    let systemImage: String
    let title: LocalizedStringKey
    let message: LocalizedStringKey

    var body: some View {
        HStack(alignment: .top, spacing: TapsoSpace.sm) {
            Image(systemName: systemImage)
                .font(.headline)
                .foregroundStyle(TapsoColor.journeyChecking)
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
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The extension's one primary action, sized like the app's `PrimaryButtonStyle`.
struct ShareActionStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(TapsoColor.textOnAccent)
            .frame(maxWidth: .infinity, minHeight: TapsoSize.primaryButtonHeight)
            .background(TapsoColor.journeyActive, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
            .opacity(configuration.isPressed ? 0.82 : 1)
            .contentShape(Rectangle())
    }
}
