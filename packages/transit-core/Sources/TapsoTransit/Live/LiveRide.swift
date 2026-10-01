import Foundation

// The live ride, as a value: what the server last said, what failed since, and
// what every surface should therefore show. Pure and clock-injected, so each
// transition (stale data, expiry, network loss, recovery) is a deterministic
// test rather than a timing accident. The app runs the polling loop; this type
// decides what each answer means.

/// A bus the rider might be about to board, drawn from raw provider positions.
public struct LiveVehicleChoice: Hashable, Sendable, Identifiable {
    public let vehicleId: String
    /// `••1234`: the last four digits, which the rider can read off the bus.
    public let maskedPlate: String
    /// Stops before the boarding stop: `0` at the stop, `-1` just left it.
    public let stopsAway: Int

    public var id: String { vehicleId }
}

public enum LiveVehicleBoard {
    /// Buses near the boarding stop, nearest first, from raw positions only.
    ///
    /// This is not a ranking and proposes nothing. At `READY_FOR_SHADOW` the
    /// matcher's output never reaches the rider; the rider reads the plate and
    /// chooses. A bus seen twice is listed once, at its nearer place.
    public static func choices(
        vehicles: [LiveVehicle],
        boardingSequence: Int,
        maxStopsBefore: Int = 6,
        maxStopsPast: Int = 1
    ) -> [LiveVehicleChoice] {
        var nearest: [String: Int] = [:]
        for vehicle in vehicles {
            guard let sequence = vehicle.stopSequence else { continue }
            let away = boardingSequence - sequence
            guard away <= maxStopsBefore, away >= -maxStopsPast else { continue }
            if let known = nearest[vehicle.vehicleId], Self.order(known) <= Self.order(away) { continue }
            nearest[vehicle.vehicleId] = away
        }
        return nearest
            .map { LiveVehicleChoice(vehicleId: $0.key, maskedPlate: VehiclePlate.masked($0.key), stopsAway: $0.value) }
            .sorted { lhs, rhs in
                Self.order(lhs.stopsAway) == Self.order(rhs.stopsAway)
                    ? lhs.vehicleId < rhs.vehicleId
                    : Self.order(lhs.stopsAway) < Self.order(rhs.stopsAway)
            }
    }

    /// At the stop first, then approaching by distance, then just departed.
    private static func order(_ stopsAway: Int) -> Int {
        stopsAway >= 0 ? stopsAway : 1_000 - stopsAway
    }
}

/// What the rider is told when something went wrong.
public enum LiveIssue: Hashable, Sendable {
    /// The phone has no connection.
    case offline
    /// The server could not be reached or did not answer in time.
    case serverUnreachable
    /// This deployment does not serve rides yet.
    case serviceUnavailable
    /// Bus data is unavailable at the source.
    case providerUnavailable
    /// The ride session is gone (ended elsewhere or expired).
    case sessionEnded
    /// Too many requests; the app slows down by itself.
    case rateLimited
    /// The server failed.
    case serverError
    /// The ride could not be set up as asked.
    case setupInvalid

    public init(_ error: LiveAPIError) {
        switch error {
        case .offline: self = .offline
        case .timeout, .network, .cancelled: self = .serverUnreachable
        case .sessionsUnavailable: self = .serviceUnavailable
        case .providerUnavailable: self = .providerUnavailable
        case .sessionNotFound, .sessionExpired: self = .sessionEnded
        case .rateLimited: self = .rateLimited
        case .server, .decoding: self = .serverError
        case .invalidRequest: self = .setupInvalid
        }
    }
}

/// Why a live ride stopped.
public enum LiveRideEnd: String, Hashable, Sendable, Codable {
    /// The rider ended it.
    case finished
    /// The server no longer has the session.
    case sessionEnded
}

public struct LiveRide: Hashable, Sendable {
    public enum Stage: Hashable, Sendable {
        /// The session exists; the rider has not said which bus they are on.
        case choosingVehicle
        /// The rider's bus is confirmed and tracked.
        case riding
        case ended(LiveRideEnd)
    }

    public private(set) var session: LiveSession
    public private(set) var stage: Stage
    /// When the server last answered successfully.
    public private(set) var lastSuccessAt: Date
    public private(set) var issue: LiveIssue?
    public private(set) var consecutiveFailures: Int
    /// Milestones already signalled, so each alerts at most once per ride.
    public private(set) var alertedMilestones: Set<RideMilestone>

    /// How long the app's own link to the server may go quiet before the ride reads as delayed.
    public static let linkPolicy = FreshnessPolicy(freshThrough: 45, agingThrough: 120)

    public init(session: LiveSession, at now: Date) {
        self.session = session
        stage = session.selectedVehicleId == nil ? .choosingVehicle : .riding
        lastSuccessAt = now
        issue = nil
        consecutiveFailures = 0
        alertedMilestones = []
    }

    /// A successful refresh or confirmation.
    public mutating func apply(_ refreshed: LiveSession, at now: Date) {
        guard refreshed.id == session.id, !isEnded else { return }
        session = refreshed
        lastSuccessAt = now
        issue = nil
        consecutiveFailures = 0
        if refreshed.selectedVehicleId != nil { stage = .riding }
    }

    /// A failed request. A session the server no longer has ends the ride; everything else is waited out.
    public mutating func apply(_ error: LiveAPIError, at now: Date) {
        guard !isEnded else { return }
        if error == .cancelled { return }
        consecutiveFailures += 1
        issue = LiveIssue(error)
        if error == .sessionNotFound || error == .sessionExpired {
            stage = .ended(.sessionEnded)
        }
    }

    public mutating func finish() {
        stage = .ended(.finished)
    }

    public var isEnded: Bool {
        if case .ended = stage { return true }
        return false
    }

    /// The facts every surface reads, once the rider's bus is confirmed.
    public func signal(now: Date, isOffline: Bool) -> RideSignal? {
        guard stage == .riding, session.selectedVehicleId != nil else { return nil }
        let link = Self.linkPolicy.classify(observedAt: lastSuccessAt, relativeTo: now)
        let (phase, remaining, passed) = Self.position(of: session)
        return RideSignal(
            phase: phase,
            remainingStops: remaining,
            freshness: Self.freshness(server: session, link: link),
            destinationPassed: passed,
            isOffline: isOffline || issue == .offline
        )
    }

    public func guidance(now: Date, isOffline: Bool) -> RideGuidance? {
        signal(now: now, isOffline: isOffline).map(RideGuidancePolicy.guidance(for:))
    }

    /// Milestones signalled before, by an earlier run of the app, so a resumed ride does not alert them again.
    public mutating func markAlerted(_ milestones: Set<RideMilestone>) {
        alertedMilestones.formUnion(milestones)
    }

    /// The milestone to alert for now, if it has not alerted on this ride yet.
    public mutating func takeMilestone(now: Date, isOffline: Bool) -> RideMilestone? {
        guard let milestone = guidance(now: now, isOffline: isOffline)?.milestone,
              !alertedMilestones.contains(milestone) else { return nil }
        alertedMilestones.insert(milestone)
        return milestone
    }

    /// When to ask the server again: a steady pace while things work, backing off while they do not.
    public var nextPollDelay: Duration {
        let base: Duration = stage == .choosingVehicle ? .seconds(20) : .seconds(15)
        guard consecutiveFailures > 0 else { return base }
        if issue == .rateLimited { return .seconds(60) }
        var delay = base
        for _ in 0..<min(consecutiveFailures, 3) { delay = delay * 2 }
        return min(delay, .seconds(90))
    }

    // MARK: Mapping

    static func position(of session: LiveSession) -> (JourneyState, Int, Bool) {
        guard let progress = session.progress else {
            return (.vehicleRecovery, 0, false)
        }
        let remaining = progress.remainingStops
        switch session.state {
        case .lost:
            return (.vehicleTemporarilyLost, remaining, false)
        case .degraded:
            // The server keeps the last accepted progress and says why in prose
            // only, so the reason is read from structure: a failed provider read
            // is late data; the rider's bus absent from the snapshot is a lost
            // bus; anything else (stale cadence, a route or direction conflict)
            // is late data too. None of them alerts.
            if session.providerRead?.state == "failed" { return (.dataStale, remaining, false) }
            if let selected = session.selectedVehicleId, session.sourceFreshness?[selected] == nil {
                return (.vehicleTemporarilyLost, remaining, false)
            }
            return (.dataStale, remaining, false)
        case .awaitingMatch, .confirmationRequired, .unknown:
            return (.vehicleRecovery, remaining, false)
        case .tracking, .arrived, .passedDestination:
            switch progress.phase {
            case .active: return (.active, remaining, false)
            case .approaching: return (.approachingDestination, remaining, false)
            case .nextStop: return (.nextStopIsDestination, remaining, false)
            case .arrived: return (.arrived, 0, false)
            case .passedDestination: return (.arrived, 0, true)
            case .unknown: return (.vehicleRecovery, remaining, false)
            }
        }
    }

    /// The worse of what the server says about the bus's data and how long the app has gone without the server.
    static func freshness(server session: LiveSession, link: DataFreshness) -> DataFreshness {
        if link == .stale { return .stale }
        var server = session.selectedCadence?.freshness ?? .unknown
        if let read = session.providerRead, read.state == "failed" {
            let byFailures: DataFreshness = read.consecutiveFailures >= 3 ? .stale : .aging
            server = worse(server, byFailures)
        }
        if server == .unknown { return .unknown }
        return worse(server, link)
    }

    private static func worse(_ lhs: DataFreshness, _ rhs: DataFreshness) -> DataFreshness {
        let rank: [DataFreshness: Int] = [.fresh: 0, .aging: 1, .stale: 2, .unknown: 3]
        return (rank[lhs] ?? 3) >= (rank[rhs] ?? 3) ? lhs : rhs
    }
}
