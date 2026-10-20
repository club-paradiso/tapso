import Foundation
import TapsoTransit

extension JourneyLanguage {
    /// The language this build is rendering in right now: the rider's per-app language in
    /// Settings when set, otherwise the best match for the device languages.
    static var current: JourneyLanguage {
        resolve(Bundle.main.preferredLocalizations)
    }
}
