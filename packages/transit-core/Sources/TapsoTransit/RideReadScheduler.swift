import Foundation

/// When a live ride reads its session (`LIVE_RIDE_RELIABILITY_HOME_V3.md` §2.1).
///
/// A pure state machine; the app's polling loop asks it how long to wait and
/// tells it when a read begins and ends. Times are seconds on a monotonic
/// clock, so a wall-clock change mid-ride cannot stretch or shrink a wait.
///
/// - The policy interval is the time from one read's **start** to the next
///   one's start. A slow answer does not push the following read back by its
///   own length.
/// - One read at a time. A refresh asked for while a read is in flight is kept
///   as one pending refresh and runs as soon as that read ends; any number of
///   further asks collapse into the same one.
/// - An asked-for refresh (return to the app, network back, the rider's tap)
///   runs at once, but never sooner than `minimumGap` after the last start, so
///   flapping between active and inactive cannot become a burst of reads.
public struct RideReadScheduler: Sendable, Equatable {
    /// Why a read runs.
    public enum Trigger: String, Codable, Hashable, Sendable {
        /// The policy cadence came round.
        case cadence
        /// The rider came back to TAPSO.
        case foreground
        /// The rider asked.
        case manual
        /// The phone's network came back.
        case networkRestored
        /// A ride restored at launch, or a loop restarted.
        case resume
    }

    /// What became of an asked-for refresh.
    public enum RequestOutcome: String, Equatable, Sendable {
        /// Nothing is in flight: it runs now (or after `minimumGap`).
        case scheduled
        /// A read is in flight: it runs right after.
        case queued
        /// A refresh was already waiting; this one joins it.
        case coalesced
    }

    /// The shortest time between two read starts, whatever asked for them.
    public static let minimumGap: Double = 2

    public private(set) var inFlight = false
    public private(set) var pending: Trigger?
    public private(set) var lastStart: Double?
    /// Increases by one per read, so an answer can be ordered by when its read began.
    public private(set) var generation = 0

    public init() {}

    /// Asks for a read outside the cadence.
    @discardableResult
    public mutating func request(_ trigger: Trigger) -> RequestOutcome {
        if pending != nil { return .coalesced }
        pending = trigger
        return inFlight ? .queued : .scheduled
    }

    /// Seconds to wait before the next read may start; `0` means now. While a
    /// read is in flight the loop is not waiting, so this is not asked then.
    public func delay(now: Double, interval: Double) -> Double {
        guard let lastStart else { return 0 }
        let gap = pending == nil ? interval : Self.minimumGap
        return max(0, lastStart + gap - now)
    }

    /// A read starts. Returns its trigger and generation.
    public mutating func begin(now: Double) -> (trigger: Trigger, generation: Int) {
        let trigger = pending ?? .cadence
        pending = nil
        inFlight = true
        lastStart = now
        generation += 1
        return (trigger, generation)
    }

    /// The read ended, answered or not.
    public mutating func finish() {
        inFlight = false
    }
}

/// Whether an answer may replace what the ride shows. Completion order is not
/// evidence order: a read that started earlier, or an answer whose evidence
/// is older, never overwrites newer progress.
public enum RideEvidenceOrder {
    public struct Stamp: Codable, Hashable, Sendable {
        /// The read's generation (`RideReadScheduler.generation`).
        public let generation: Int
        /// When the evidence was observed, on the phone's clock (`RideEvidenceClock`); `nil` when the answer carried none.
        public let evidenceAt: Date?

        public init(generation: Int, evidenceAt: Date?) {
            self.generation = generation
            self.evidenceAt = evidenceAt
        }
    }

    public static func accepts(_ incoming: Stamp, over current: Stamp?) -> Bool {
        guard let current else { return true }
        if incoming.generation < current.generation { return false }
        if let new = incoming.evidenceAt, let old = current.evidenceAt, new < old { return false }
        return true
    }
}

/// Evidence time on the phone's clock, free of clock skew.
///
/// The server stamps `progress.evidenceAt` (its receipt of the provider row)
/// and `updatedAt` (its evaluation of the session) on the same clock. Their
/// difference is the evidence's age when the server answered; the phone
/// subtracts that age from when the answer reached it. A phone whose clock is
/// a minute off therefore neither ages fresh data nor freshens old data.
///
/// Re-evaluating old evidence now does not make it new: this is the time the
/// bus was last *observed*, not the time anything was computed.
public enum RideEvidenceClock {
    public static func evidenceAt(serverEvidenceAt: Date?, serverEvaluatedAt: Date?, receivedAt: Date) -> Date? {
        guard let serverEvidenceAt else { return nil }
        guard let serverEvaluatedAt else { return receivedAt }
        let age = max(0, serverEvaluatedAt.timeIntervalSince(serverEvidenceAt))
        return receivedAt.addingTimeInterval(-age)
    }
}

/// What a failed read during a ride does to the ride.
///
/// A ride is ended only by an answer that says the session is gone or the
/// request can never succeed. A session store or server that is briefly
/// unavailable is retried a bounded number of times first: one Redis hiccup
/// must not stop tracking a bus the rider is sitting on.
public enum RideReadFailurePolicy {
    public enum Action: String, Equatable, Sendable {
        /// Keep the last confirmed progress, age it, read again on the cadence.
        case retry
        /// The session cannot come back: stop reading and say so.
        case endSession
    }

    /// Consecutive "unavailable" answers tolerated before the ride gives up:
    /// about a minute at the recovery cadence.
    public static let unavailableRetryLimit = 5

    /// - Parameter consecutiveFailures: failed reads in a row, this one included.
    public static func action(for failure: TransitAPIFailure, consecutiveFailures: Int) -> Action {
        switch failure {
        case .sessionNotFound, .sessionExpired, .rejected:
            .endSession
        case .sessionsUnavailable, .serviceUnavailable:
            consecutiveFailures >= unavailableRetryLimit ? .endSession : .retry
        case .offline, .timedOut, .providerTimeout, .providerUnavailable, .providerInvalid, .rateLimited, .server, .unexpectedResponse:
            .retry
        }
    }
}
