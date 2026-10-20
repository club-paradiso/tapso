import SwiftUI

/// The tourist guide-language preference. `nil` means "Automatic": the device
/// locale decides (`TouristLanguage.defaultForDeviceLocale`), so a foreign
/// tourist's phone already opens TAPSO in the right language with no setup.
/// Persisted in `UserDefaults` (injectable for tests), additive to the existing
/// settings — nothing else reads or writes this key.
@Observable
final class TouristLanguageStore {
    private static let storageKey = "tapso.touristLanguage"

    private let defaults: UserDefaults

    /// The explicit choice, or `nil` for Automatic (device locale).
    var selection: TouristLanguage? {
        didSet { persist() }
    }

    /// The language the UI should actually render.
    var resolved: TouristLanguage {
        selection ?? TouristLanguage.defaultForDeviceLocale()
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.selection = defaults.string(forKey: Self.storageKey)
            .flatMap(TouristLanguage.init(rawValue:))
    }

    private func persist() {
        if let selection {
            defaults.set(selection.rawValue, forKey: Self.storageKey)
        } else {
            defaults.removeObject(forKey: Self.storageKey)
        }
    }
}

/// The language picker: Automatic first, then the four supported languages.
/// Presented from the Home intro card; the rest of the app reads
/// `store.resolved` through `TouristText`.
struct TouristLanguagePickerView: View {
    @Bindable var store: TouristLanguageStore
    @Environment(\.dismiss) private var dismiss

    private var language: TouristLanguage { store.resolved }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    automaticRow
                } footer: {
                    Text(TouristText.string("tourist.language.subtitle", language: language))
                }
                Section {
                    ForEach(TouristLanguage.allCases) { option in
                        languageRow(option)
                    }
                }
            }
            .navigationTitle(TouristText.string("tourist.language.title", language: language))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(TouristText.string("tourist.common.done", language: language)) {
                        dismiss()
                    }
                }
            }
        }
    }

    private var automaticRow: some View {
        Button {
            store.selection = nil
            dismiss()
        } label: {
            HStack {
                Text(TouristText.string("tourist.language.automatic", language: language))
                    .foregroundStyle(TapsoColor.textPrimary)
                Spacer()
                if store.selection == nil {
                    Image(systemName: "checkmark")
                        .foregroundStyle(TapsoColor.mintDeep)
                        .accessibilityHidden(true)
                }
            }
        }
        .accessibilityHint(Text(TouristText.string("tourist.language.subtitle", language: language)))
    }

    private func languageRow(_ option: TouristLanguage) -> some View {
        Button {
            store.selection = option
            dismiss()
        } label: {
            HStack {
                Text(TouristText.string(option.tableKey, language: language))
                    .foregroundStyle(TapsoColor.textPrimary)
                Spacer()
                if store.selection == option {
                    Image(systemName: "checkmark")
                        .foregroundStyle(TapsoColor.mintDeep)
                        .accessibilityHidden(true)
                }
            }
        }
    }
}

/// The entry point on the first-run Home intro card: a globe row showing the
/// current guide language, opening the picker as a sheet. Additive — the card
/// keeps its existing layout and steps.
struct TouristLanguageRow: View {
    @Bindable var store: TouristLanguageStore
    @State private var isPickerPresented = false

    private var language: TouristLanguage { store.resolved }

    var body: some View {
        Button {
            isPickerPresented = true
        } label: {
            HStack(spacing: TapsoSpace.sm) {
                Image(systemName: "globe")
                    .foregroundStyle(TapsoColor.mintDeep)
                    .accessibilityHidden(true)
                Text(TouristText.string("tourist.home.languageRow", language: language))
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(TapsoColor.textPrimary)
                Spacer()
                Text(TouristText.string(language.tableKey, language: language))
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(TapsoColor.textTertiary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, TapsoSpace.xs)
            .contentShape(Rectangle())
        }
        .accessibilityHint(Text(TouristText.string("tourist.language.subtitle", language: language)))
        .sheet(isPresented: $isPickerPresented) {
            TouristLanguagePickerView(store: store)
        }
    }
}
