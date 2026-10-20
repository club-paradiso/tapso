import SwiftUI
import TapsoTransit
import UIKit

/// What went wrong, in the tester's words. The raw values are the server's
/// `FEEDBACK_CATEGORIES` (`services/api/src/feedbackStore.ts`).
enum FeedbackCategory: String, CaseIterable, Identifiable, Sendable {
    case busNotFound = "bus_not_found"
    case wrongBusSelected = "wrong_bus_selected"
    case wrongRemainingStops = "wrong_remaining_stops"
    case missedAlert = "missed_alert"
    case appFrozeOrQuit = "app_froze_or_quit"
    case translationOrWording = "translation_or_wording"
    case designOrUsability = "design_or_usability"
    case other

    var id: String { rawValue }

    var titleKey: LocalizedStringKey {
        switch self {
        case .busNotFound: "feedback.category.busNotFound"
        case .wrongBusSelected: "feedback.category.wrongBusSelected"
        case .wrongRemainingStops: "feedback.category.wrongRemainingStops"
        case .missedAlert: "feedback.category.missedAlert"
        case .appFrozeOrQuit: "feedback.category.appFrozeOrQuit"
        case .translationOrWording: "feedback.category.translationOrWording"
        case .designOrUsability: "feedback.category.designOrUsability"
        case .other: "feedback.category.other"
        }
    }
}

/// The body of `POST /v1/feedback`. Nothing about the tester beyond what is listed here.
struct FeedbackReport: Encodable, Equatable, Sendable {
    let category: String
    let message: String
    let appVersion: String
    let build: String
    let gitCommit: String
    let buildConfiguration: String
    let osVersion: String
    let deviceModel: String
    let language: String
    /// Only when the tester ticked the box (`diagnosticsConsent`).
    let diagnostics: String?
    let diagnosticsConsent: Bool

    /// The server keeps at most 24 000 characters of diagnostics; the newest lines matter most.
    static let diagnosticsLimit = 20_000

    @MainActor
    static func make(category: FeedbackCategory, message: String, diagnostics: String?) -> FeedbackReport {
        let identity = TapsoBuild.identity()
        let trimmed = diagnostics.map { text in
            text.count > diagnosticsLimit ? String(text.suffix(diagnosticsLimit)) : text
        }
        return FeedbackReport(
            category: category.rawValue,
            message: message.trimmingCharacters(in: .whitespacesAndNewlines),
            appVersion: identity.version,
            build: identity.build,
            gitCommit: identity.gitCommit,
            buildConfiguration: identity.configuration,
            osVersion: "iOS \(UIDevice.current.systemVersion)",
            deviceModel: deviceModelIdentifier(),
            language: JourneyLanguage.current.rawValue,
            diagnostics: trimmed,
            diagnosticsConsent: trimmed != nil
        )
    }

    /// The hardware identifier (`iPhone15,4`), never the device name the owner chose.
    static func deviceModelIdentifier() -> String {
        var system = utsname()
        uname(&system)
        let identifier = withUnsafeBytes(of: &system.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
        return identifier.isEmpty ? "unknown" : identifier
    }

    /// The same report as plain text, for the share-sheet fallback when sending fails.
    var plainText: String {
        var lines = [
            "TAPSO beta feedback",
            "category: \(category)",
            "build: \(appVersion) (\(build)) \(gitCommit) \(buildConfiguration)",
            "device: \(deviceModel) \(osVersion) · \(language)",
            "",
            message,
        ]
        if let diagnostics { lines += ["", diagnostics] }
        return lines.joined(separator: "\n")
    }
}

struct FeedbackReceipt: Decodable, Equatable, Sendable {
    let id: String
    let receivedAt: String
    /// `false` only on a development server that keeps reports in memory.
    let durable: Bool?

    /// The first block of the receipt id, short enough to read out to an operator.
    var shortID: String { String(id.prefix(8)) }
}

/// A tester reports a problem without knowing what GitHub is. "Sent" is shown only for a
/// report the server confirmed; a failure says so and offers to share the report instead.
struct FeedbackView: View {
    @Bindable var model: TapsoAppModel
    @Environment(\.dismiss) private var dismiss

    @State private var category: FeedbackCategory?
    @State private var message = ""
    @State private var includeDiagnostics = false
    @State private var phase: Phase = .editing

    enum Phase: Equatable {
        case editing
        case sending
        case sent(FeedbackReceipt)
        case failed(FeedbackReport)
    }

    var body: some View {
        NavigationStack {
            Form {
                switch phase {
                case let .sent(receipt):
                    sent(receipt)
                default:
                    editor
                }
            }
            .navigationTitle("feedback.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.cancel") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private var editor: some View {
        Section {
            ForEach(FeedbackCategory.allCases) { option in
                Button {
                    category = option
                } label: {
                    HStack {
                        Text(option.titleKey)
                            .foregroundStyle(TapsoColor.textPrimary)
                        Spacer()
                        if category == option {
                            Image(systemName: "checkmark")
                                .foregroundStyle(TapsoColor.mintDeep)
                                .accessibilityHidden(true)
                        }
                    }
                    .frame(minHeight: TapsoSize.minimumTouch)
                    .contentShape(Rectangle())
                }
                .accessibilityAddTraits(category == option ? .isSelected : [])
            }
        } header: {
            Text("feedback.category.header")
        }

        Section {
            TextField("feedback.message.placeholder", text: $message, axis: .vertical)
                .lineLimit(3...8)
        } header: {
            Text("feedback.message.header")
        }

        Section {
            Toggle("feedback.diagnostics.toggle", isOn: $includeDiagnostics)
        } footer: {
            Text("feedback.diagnostics.footer")
        }

        Section {
            Button {
                Task { await send() }
            } label: {
                HStack {
                    Text("feedback.send")
                    if phase == .sending {
                        Spacer()
                        ProgressView()
                    }
                }
            }
            .disabled(category == nil || phase == .sending)
            if case let .failed(report) = phase {
                VStack(alignment: .leading, spacing: TapsoSpace.xs) {
                    Label("feedback.failed.title", systemImage: "exclamationmark.triangle")
                        .font(.tapso(.subheadline, .semibold))
                    Text("feedback.failed.detail")
                        .font(.tapso(.footnote))
                        .foregroundStyle(TapsoColor.textSecondary)
                    ShareLink(item: report.plainText) {
                        Label("feedback.failed.share", systemImage: "square.and.arrow.up")
                    }
                }
                .padding(.vertical, TapsoSpace.xxs)
            }
        } footer: {
            Text(verbatim: TapsoBuild.identity().line)
                .font(.tapso(.caption).monospacedDigit())
        }
    }

    private func sent(_ receipt: FeedbackReceipt) -> some View {
        Section {
            VStack(alignment: .leading, spacing: TapsoSpace.sm) {
                Label("feedback.sent.title", systemImage: "checkmark.circle.fill")
                    .font(.tapso(.headline))
                    .foregroundStyle(TapsoColor.mintDeep)
                Text(String(format: RideText.string("feedback.sent.receipt"), receipt.shortID))
                    .font(.tapso(.body))
                    .textSelection(.enabled)
                Text("feedback.sent.detail")
                    .font(.tapso(.footnote))
                    .foregroundStyle(TapsoColor.textSecondary)
            }
            .padding(.vertical, TapsoSpace.xs)
            Button("common.done") { dismiss() }
        }
    }

    private func send() async {
        guard let category else { return }
        phase = .sending
        let report = FeedbackReport.make(
            category: category,
            message: message,
            diagnostics: includeDiagnostics ? model.feedbackDiagnostics() : nil
        )
        if let receipt = await model.sendFeedback(report) {
            phase = .sent(receipt)
        } else {
            phase = .failed(report)
        }
    }
}
