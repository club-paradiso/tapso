import Foundation

/// What a build may show. The synthetic demo (sample ride, scenario controls,
/// the "체험판" chip) exists for development and tests only: a Release build
/// shows riders real Jeju data and nothing else.
enum TapsoBuild {
    #if DEBUG
    static let showsDemo = true
    #else
    static let showsDemo = false
    #endif
}
