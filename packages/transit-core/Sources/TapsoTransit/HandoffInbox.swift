import Foundation

/// The one-place hand-off from TAPSO's share extension to the app.
///
/// A share extension cannot open its containing app: in iOS only the Today
/// and iMessage extension points support `NSExtensionContext.open(_:)`
/// (VERIFIED, developer.apple.com). So the extension stores the parsed place
/// here, in the App Group both targets share, and the app picks it up the next
/// time it becomes active.
///
/// Minimal by design: only the parsed `SharedPlace` (never the raw shared
/// text), one place at a time, read once and deleted, and ignored after
/// `lifetime`.
///
/// A shared screenshot (`docs/product/SCREENSHOT_IMPORT_V1.md`) travels the same
/// way, as a `ScreenshotReading`: the bus numbers and stop lines the extension read
/// on the device, never the image. The inbox holds one thing: putting a reading
/// replaces a waiting place and the other way round.
public struct HandoffInbox {
    public static let appGroup = "group.com.lucanomics.tapso"
    public static let lifetime: TimeInterval = 30 * 60
    private static let key = "tapso.handoff.v1"
    private static let readingKey = "tapso.handoff.screenshot.v1"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    /// The App Group's store, or `nil` where the group is not provisioned
    /// (an unsigned build, or a signing team without the App Group). An
    /// unprovisioned suite would silently be private to one process, so it is
    /// refused rather than used.
    public static func shared() -> HandoffInbox? {
        guard
            FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) != nil,
            let defaults = UserDefaults(suiteName: appGroup)
        else { return nil }
        return HandoffInbox(defaults: defaults)
    }

    /// Replaces whatever was waiting.
    public func put(_ place: SharedPlace, at date: Date) {
        guard let data = try? JSONEncoder().encode(Entry(place: place, savedAt: date)) else { return }
        defaults.removeObject(forKey: Self.readingKey)
        defaults.set(data, forKey: Self.key)
    }

    /// Replaces whatever was waiting with what a shared screenshot said.
    public func put(_ reading: ScreenshotReading, at date: Date) {
        guard let data = try? JSONEncoder().encode(ReadingEntry(reading: reading, savedAt: date)) else { return }
        defaults.removeObject(forKey: Self.key)
        defaults.set(data, forKey: Self.readingKey)
    }

    /// The waiting screenshot reading, once. Same lifetime rules as `take(now:)`.
    public func takeReading(now: Date) -> ScreenshotReading? {
        defer { defaults.removeObject(forKey: Self.readingKey) }
        guard
            let data = defaults.data(forKey: Self.readingKey),
            let entry = try? JSONDecoder().decode(ReadingEntry.self, from: data)
        else { return nil }
        let age = now.timeIntervalSince(entry.savedAt)
        guard age >= -60, age <= Self.lifetime else { return nil }
        return entry.reading
    }

    /// The waiting place, once. Anything older than `lifetime`, or dated in the future, is discarded.
    public func take(now: Date) -> SharedPlace? {
        defer { defaults.removeObject(forKey: Self.key) }
        guard
            let data = defaults.data(forKey: Self.key),
            let entry = try? JSONDecoder().decode(Entry.self, from: data)
        else { return nil }
        let age = now.timeIntervalSince(entry.savedAt)
        guard age >= -60, age <= Self.lifetime else { return nil }
        return entry.place
    }

    private struct ReadingEntry: Codable {
        let reading: ScreenshotReading
        let savedAt: Date
    }

    private struct Entry: Codable {
        let place: SharedPlace
        let savedAt: Date
    }
}
