import Foundation

// How TAPSO takes a device location fix (`BOARDING_ANCHOR_POSITION_V2.md` §5).
// Pure policy, so it is tested without Core Location: the app's
// `RideLocationSampler` only forwards fixes and the clock.
//
// Apple documents `requestLocation()` as reporting exactly one fix and, when
// the requested accuracy takes too long, delivering "a less accurate location
// value rather than reporting an error". V1 took that single fix at a 100 m
// request while `HybridPositionEngine` refuses anything worse than 50 m, so
// most ordinary ride samples could never be used. V2 runs standard updates for
// a bounded window, keeps the best acceptable fix and stops early once a fix
// is good enough. It never leaves updates running between samples.

/// What the rider has granted. Only `fullAccuracy` can produce ride evidence:
/// under reduced accuracy Apple ignores `desiredAccuracy` entirely.
public enum LocationPermission: String, Codable, Hashable, Sendable {
    case notDetermined, denied, restricted, reducedAccuracy, fullAccuracy

    public var allowsPreciseRideEvidence: Bool { self == .fullAccuracy }
}

public enum LocationSamplingMode: String, Codable, Hashable, Sendable, CaseIterable {
    /// "내 근처": rank boarding places before a ride. Never ride evidence.
    case nearbyStops
    /// Riding, official progress live, three or more stops to go.
    case normal
    /// The confirmed bus has not yet officially reached the rider's pole.
    case boarding
    /// Three stops or fewer to the destination.
    case destinationNear
    /// Official progress is delayed, conflicted or not yet established, or the rider asked to recheck.
    case recovery

    public var isRide: Bool { self != .nearbyStops }
}

/// Every number is an engineering assumption awaiting device calibration
/// (`BOARDING_ANCHOR_POSITION_V2.md` §11), not a measured value.
public struct LocationSamplingPolicy: Hashable, Sendable {
    public let mode: LocationSamplingMode
    /// Metres asked of Core Location (mapped to a `kCLLocationAccuracy…` constant by the app).
    public let requestedAccuracy: Double
    /// A fix at least this good ends the window early.
    public let goodEnoughAccuracy: Double
    /// The worst fix that may be returned at all.
    public let acceptableAccuracy: Double
    /// How long updates may run for one sample, seconds.
    public let window: TimeInterval
    /// How old a delivered fix may be (a cached fix arrives instantly but may be stale), seconds.
    public let maximumFixAge: TimeInterval
    /// The minimum spacing between two samples in this mode, seconds.
    public let minimumInterval: TimeInterval

    public static func policy(for mode: LocationSamplingMode) -> LocationSamplingPolicy {
        let engineLimit = HybridPositionEngine.maximumDeviceAccuracy
        switch mode {
        case .nearbyStops:
            // Ordering stops a few hundred metres apart; user-initiated, so never throttled.
            return .init(mode: mode, requestedAccuracy: 10, goodEnoughAccuracy: 30, acceptableAccuracy: 150,
                         window: 5, maximumFixAge: 30, minimumInterval: 0)
        case .normal:
            // Battery-conscious: shorter window, every other far-band poll at most.
            return .init(mode: mode, requestedAccuracy: 10, goodEnoughAccuracy: 20, acceptableAccuracy: engineLimit,
                         window: 4, maximumFixAge: 10, minimumInterval: 30)
        case .boarding:
            // The rider is still waiting at the pole: the phone only checks the anchor
            // (the engine uses no estimate before boarding), so it need not run every poll.
            return .init(mode: mode, requestedAccuracy: 10, goodEnoughAccuracy: 15, acceptableAccuracy: engineLimit,
                         window: 6, maximumFixAge: 10, minimumInterval: 20)
        case .destinationNear:
            // The last stops: at most once per near-band poll.
            return .init(mode: mode, requestedAccuracy: 10, goodEnoughAccuracy: 15, acceptableAccuracy: engineLimit,
                         window: 6, maximumFixAge: 10, minimumInterval: 10)
        case .recovery:
            return .init(mode: mode, requestedAccuracy: 10, goodEnoughAccuracy: 20, acceptableAccuracy: engineLimit,
                         window: 6, maximumFixAge: 10, minimumInterval: 10)
        }
    }

    /// The ride mode for the next sample. Destination proximity wins: the last
    /// stops are where a late or wrong count costs the rider most.
    public static func rideMode(
        remainingStops: Int,
        hybridState: HybridTrackingState?,
        manual: Bool,
        officialSequence: Int?,
        boardingSequence: Int?
    ) -> LocationSamplingMode {
        if remainingStops >= 0 && remainingStops <= LivePollingPolicy.nearStops { return .destinationNear }
        if manual || hybridState != .live { return .recovery }
        if let boardingSequence, (officialSequence ?? Int.min) <= boardingSequence { return .boarding }
        return .normal
    }
}

/// Why a sample produced no usable fix. Diagnostics only; never shown verbatim.
public enum LocationUnavailableReason: String, Codable, Hashable, Sendable {
    case permissionNotDetermined, denied, restricted, reducedAccuracy, throttled, busy, noAcceptableFix, failed
}

public enum LocationSampleOutcome: Hashable, Sendable {
    case fix(DevicePositionSample)
    case unavailable(LocationUnavailableReason)

    public var sample: DevicePositionSample? {
        if case .fix(let sample) = self { return sample }
        return nil
    }
}

/// Collects the fixes Core Location delivers during one window and keeps the best.
public struct LocationFixSelector: Sendable {
    public enum Decision: Equatable, Sendable { case keepListening, finish }

    public enum Rejection: String, Codable, Hashable, Sendable, CaseIterable {
        case invalidAccuracy, invalidCoordinate, stale, future, tooInaccurate
    }

    public let policy: LocationSamplingPolicy
    public let startedAt: Date
    public private(set) var best: DevicePositionSample?
    public private(set) var rejections: [Rejection: Int] = [:]

    public init(policy: LocationSamplingPolicy, startedAt: Date) {
        self.policy = policy
        self.startedAt = startedAt
    }

    public var deadline: Date { startedAt.addingTimeInterval(policy.window) }

    /// Offers one delivered fix. `now` is the device clock when it arrived.
    public mutating func offer(_ fix: DevicePositionSample, now: Date) -> Decision {
        if let rejection = rejection(for: fix, now: now) {
            rejections[rejection, default: 0] += 1
            return now >= deadline ? .finish : .keepListening
        }
        if let current = best {
            // Better accuracy wins; equal accuracy prefers the newer fix.
            if fix.accuracy < current.accuracy || (fix.accuracy == current.accuracy && fix.timestamp > current.timestamp) {
                best = fix
            }
        } else {
            best = fix
        }
        if let best, best.accuracy <= policy.goodEnoughAccuracy { return .finish }
        return now >= deadline ? .finish : .keepListening
    }

    /// The answer at the end of the window. A kept fix is re-checked for age at
    /// `now`: a window that ran long cannot hand back a fix that went stale in it.
    public func result(at now: Date) -> LocationSampleOutcome {
        guard let best, now.timeIntervalSince(best.timestamp) <= policy.maximumFixAge else {
            return .unavailable(.noAcceptableFix)
        }
        return .fix(best)
    }

    private func rejection(for fix: DevicePositionSample, now: Date) -> Rejection? {
        // Core Location reports an invalid fix with a negative accuracy.
        guard fix.accuracy.isFinite, fix.accuracy > 0 else { return .invalidAccuracy }
        guard RideMapMatcher.valid(fix.coordinate) else { return .invalidCoordinate }
        let age = now.timeIntervalSince(fix.timestamp)
        if age < -2 { return .future }
        if age > policy.maximumFixAge { return .stale }
        if fix.accuracy > policy.acceptableAccuracy { return .tooInaccurate }
        return nil
    }
}

/// Spacing between samples, per mode. A user-initiated recheck uses `recovery`'s spacing.
public struct LocationSampleThrottle: Sendable {
    private var lastStartedAt: [LocationSamplingMode: Date] = [:]
    private var lastRideStartedAt: Date?

    public init() {}

    /// Ride modes share one clock, so switching modes cannot double the sampling
    /// rate; "내 근처" has its own and never blocks (or is blocked by) a ride.
    public mutating func begin(_ policy: LocationSamplingPolicy, now: Date) -> Bool {
        let last = policy.mode.isRide ? lastRideStartedAt : lastStartedAt[policy.mode]
        if let last, now.timeIntervalSince(last) >= 0, now.timeIntervalSince(last) < policy.minimumInterval { return false }
        if policy.mode.isRide { lastRideStartedAt = now } else { lastStartedAt[policy.mode] = now }
        return true
    }

    public mutating func reset() {
        lastStartedAt = [:]
        lastRideStartedAt = nil
    }
}
