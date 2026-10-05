import Foundation
import TapsoTransit

/// On-device persistence for saved journeys and the ride in progress.
/// Nothing leaves the phone.
struct JourneyStore {
    private static let libraryKey = "tapso.journeyLibrary.v1"
    private static let activeRideKey = "tapso.activeRide.v1"
    private static let stopNudgesKey = "tapso.stopNudges.v1"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func loadLibrary() -> JourneyLibrary {
        guard let data = defaults.data(forKey: Self.libraryKey),
              let library = try? JSONDecoder().decode(JourneyLibrary.self, from: data)
        else { return JourneyLibrary() }
        return library
    }

    func saveLibrary(_ library: JourneyLibrary) {
        defaults.set(try? JSONEncoder().encode(library), forKey: Self.libraryKey)
    }

    /// Saved-stop nudges (`AUTO_START.md`, M3): opt-ins with the boarding stop's
    /// coordinates, and today's silences. On the phone only.
    func loadStopNudges() -> StopNudgeSettings {
        guard let data = defaults.data(forKey: Self.stopNudgesKey),
              let settings = try? JSONDecoder().decode(StopNudgeSettings.self, from: data)
        else { return StopNudgeSettings() }
        return settings
    }

    func saveStopNudges(_ settings: StopNudgeSettings) {
        defaults.set(try? JSONEncoder().encode(settings), forKey: Self.stopNudgesKey)
    }

    func loadActiveRide() -> ActiveRide? {
        guard let data = defaults.data(forKey: Self.activeRideKey) else { return nil }
        return try? JSONDecoder().decode(ActiveRide.self, from: data)
    }

    func saveActiveRide(_ ride: ActiveRide?) {
        if let ride, let data = try? JSONEncoder().encode(ride) {
            defaults.set(data, forKey: Self.activeRideKey)
        } else {
            defaults.removeObject(forKey: Self.activeRideKey)
        }
    }
}
