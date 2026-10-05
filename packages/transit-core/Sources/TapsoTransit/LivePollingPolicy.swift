import Foundation

/// How often a live ride reads its session while TAPSO is in the foreground
/// (`TAPSO_V1_RELEASE_CLOSURE.md` §3 workstream D; mission §25).
///
/// Three bands, not one constant:
/// - `far`: three or more stops to go, data trusted. The server's 15 s cadence
///   is kept: each read costs one provider request, and nothing the rider must
///   act on changes faster than that this far out.
/// - `near`: the count is three or less and trusted. On a dense city route
///   stops are 300–500 m apart, about 30–60 s at bus speed, so a 15 s read can
///   be late by a whole stop for the prepare and next-stop moments. Ten seconds
///   halves that lateness for the few minutes it matters.
/// - `recovery`: the ride is rechecking (a provider hiccup, a missing poll, a
///   conflicting row). A faster read gets the count back sooner, but only for a
///   bounded window: past it the cadence returns to `far`, so a provider that
///   stays slow is not hammered and a persistent failure still surfaces.
///
/// An unavailable ride (bus lost, offline) polls at `far`: the server's own
/// grace window decides when a lost bus is lost, and polling faster cannot
/// make a missing bus reappear. In the background nothing polls; the server
/// and APNs own the ride then (`LIVE_ACTIVITY_PUSH.md` §3a).
public enum LivePollingPolicy {
    public enum Band: String, Codable, Hashable, Sendable {
        case far, near, recovery
    }

    public static let farInterval: Duration = .seconds(15)
    public static let nearInterval: Duration = .seconds(10)
    public static let recoveryInterval: Duration = .seconds(10)
    /// How long a rechecking ride may read faster before it falls back to `far`.
    public static let recoveryBudget: Duration = .seconds(120)
    /// Three stops: the moment before prepare, so prepare itself is never seen late.
    public static let nearStops = 3

    /// - Parameter recoveryElapsed: how long the ride has been rechecking without a break;
    ///   `nil` when it is not rechecking.
    public static func band(trust: RideTrust, remainingStops: Int, recoveryElapsed: Duration?) -> Band {
        switch trust {
        case .rechecking:
            if let recoveryElapsed, recoveryElapsed < recoveryBudget { return .recovery }
            return .far
        case .unavailable:
            return .far
        case .live, .estimated:
            return remainingStops >= 0 && remainingStops <= nearStops ? .near : .far
        }
    }

    public static func interval(for band: Band) -> Duration {
        switch band {
        case .far: farInterval
        case .near: nearInterval
        case .recovery: recoveryInterval
        }
    }

    public static func interval(trust: RideTrust, remainingStops: Int, recoveryElapsed: Duration?) -> Duration {
        interval(for: band(trust: trust, remainingStops: remainingStops, recoveryElapsed: recoveryElapsed))
    }
}
