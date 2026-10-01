import Foundation

// Jeju safety layer: Safe Return, Transfer Guardian and Rescue.
//
// Three deterministic decisions over facts another system already established.
// None of them invents a timetable, an arrival time or a distance: an input
// TAPSO does not have stays `nil`, and the answer becomes `unknown` (or, for
// Rescue, a hand-off to a map app) instead of a confident guess.
//
// Times are minutes on one clock where the caller's "now" is 0; ranges are what
// the evidence allows, never one guessed instant. The language-neutral
// specifications are `fixtures/journey/safe-return-v1.json`,
// `transfer-guardian-v1.json` and `rescue-v1.json`; the server implements the
// same rules (`services/api/src/journeySafety.ts`) and runs the same cases.
// Product notes: `docs/product/JEJU_SAFETY_LAYER_V3.md`. Policy values are
// ASSUMED product choices, recorded in each specification.

// MARK: - Safe Return

public struct SafeReturnPolicy: Codable, Hashable, Sendable {
    /// Be at the stop this long before the last practical bus.
    public var safetyMarginMinutes: Double
    /// Slack beyond a useful visit for "오늘 다녀오기 좋아요".
    public var comfortableSlackMinutes: Double
    /// Less slack than this is "tight".
    public var tightSlackMinutes: Double
    /// A gap between catchable buses at least this long is worth saying out loud.
    public var longWaitMinutes: Double
    /// Estimates derived from live data expire after this long.
    public var estimatedDataMaxAgeMinutes: Double

    public static let standard = SafeReturnPolicy(
        safetyMarginMinutes: 10,
        comfortableSlackMinutes: 90,
        tightSlackMinutes: 20,
        longWaitMinutes: 40,
        estimatedDataMaxAgeMinutes: 15
    )
}

public enum ReturnDataQuality: String, Codable, Hashable, Sendable {
    /// A published timetable. Complete, even when empty.
    case scheduled
    /// Derived from live data. Complete, even when empty, and it expires.
    case estimated
    /// No data.
    case unknown
}

public enum SafeReturnReason: String, Codable, Hashable, Sendable {
    case returnUnknown
    case dataExpired
    case arrivalUnknown
    case noReturnService
    case noTimeForVisit
    case longWait
    case disruption
    case estimatedTimes
}

public struct SafeReturnInput: Codable, Hashable, Sendable {
    /// When the rider reaches the place; `nil` when not known.
    public var arrival: Double?
    /// The shortest visit worth making.
    public var minimumStay: Double
    /// From the place back to the return stop.
    public var walkToReturnStop: Double?
    /// Departures of the return bus from the return stop; `nil` when not known.
    public var departures: [Double]?
    public var quality: ReturnDataQuality
    /// Age of an `estimated` list.
    public var dataAgeMinutes: Double?
    /// The last departure that still gets the rider home, when later buses do not.
    public var lastPracticalDeparture: Double?
    /// A relevant service notice affects the way back.
    public var disruption: Bool?

    public init(
        arrival: Double?,
        minimumStay: Double,
        walkToReturnStop: Double? = nil,
        departures: [Double]?,
        quality: ReturnDataQuality,
        dataAgeMinutes: Double? = nil,
        lastPracticalDeparture: Double? = nil,
        disruption: Bool? = nil
    ) {
        self.arrival = arrival
        self.minimumStay = minimumStay
        self.walkToReturnStop = walkToReturnStop
        self.departures = departures
        self.quality = quality
        self.dataAgeMinutes = dataAgeMinutes
        self.lastPracticalDeparture = lastPracticalDeparture
        self.disruption = disruption
    }
}

/// The reusable answer to "can I get back from there?" for Discover, Eat,
/// route discovery, next-stop discovery, Mystery Ride and TAPSO Drop.
public struct SafeReturnStatus: Codable, Hashable, Sendable {
    public let level: SafeReturnLevel
    /// Leave the place by this time.
    public let leaveBy: Double?
    /// The last practical bus back.
    public let lastDeparture: Double?
    /// The longest wait between catchable buses after a useful visit, within the plan.
    public let longestWait: Double?
    public let reasons: [SafeReturnReason]

    public init(level: SafeReturnLevel, leaveBy: Double?, lastDeparture: Double?, longestWait: Double?, reasons: [SafeReturnReason]) {
        self.level = level
        self.leaveBy = leaveBy
        self.lastDeparture = lastDeparture
        self.longestWait = longestWait
        self.reasons = reasons
    }

    /// Whether a recommendation may be offered at all. `unknown` is not a rejection, but it is never shown as safe.
    public var allowsRecommendation: Bool { level != .notRecommended }
}

public enum SafeReturn {
    public static func evaluate(_ input: SafeReturnInput, policy: SafeReturnPolicy = .standard) -> SafeReturnStatus {
        guard input.quality != .unknown, let departures = input.departures else { return undetermined(.returnUnknown) }
        if input.quality == .estimated {
            guard let age = input.dataAgeMinutes, age <= policy.estimatedDataMaxAgeMinutes else { return undetermined(.dataExpired) }
        }
        guard let arrival = input.arrival else { return undetermined(.arrivalUnknown) }

        let walk = input.walkToReturnStop ?? 0
        let latest = input.lastPracticalDeparture
        let catchable = departures
            .filter { departure in departure >= arrival + walk && (latest.map { departure <= $0 } ?? true) }
            .sorted()
        guard let last = catchable.last else {
            return SafeReturnStatus(level: .notRecommended, leaveBy: nil, lastDeparture: nil, longestWait: nil, reasons: [.noReturnService])
        }

        let leaveBy = last - walk - policy.safetyMarginMinutes
        let visitEnd = arrival + input.minimumStay
        let afterVisit = catchable.filter { $0 >= visitEnd + walk }
        let longestWait: Double? = afterVisit.count < 2
            ? nil
            : zip(afterVisit.dropFirst(), afterVisit).map { pair in pair.0 - pair.1 }.max()

        if visitEnd > leaveBy {
            return SafeReturnStatus(level: .notRecommended, leaveBy: leaveBy, lastDeparture: last, longestWait: longestWait, reasons: [.noTimeForVisit])
        }

        let slack = leaveBy - visitEnd
        var level: SafeReturnLevel = slack >= policy.comfortableSlackMinutes
            ? .comfortable
            : slack >= policy.tightSlackMinutes ? .leaveBy : .tight
        var reasons: [SafeReturnReason] = []
        if let longestWait, longestWait >= policy.longWaitMinutes {
            reasons.append(.longWait)
            if level == .comfortable { level = .leaveBy }
        }
        if input.disruption == true {
            reasons.append(.disruption)
            level = level == .comfortable ? .leaveBy : .tight
        }
        if input.quality == .estimated { reasons.append(.estimatedTimes) }
        return SafeReturnStatus(level: level, leaveBy: leaveBy, lastDeparture: last, longestWait: longestWait, reasons: reasons)
    }

    private static func undetermined(_ reason: SafeReturnReason) -> SafeReturnStatus {
        SafeReturnStatus(level: .unknown, leaveBy: nil, lastDeparture: nil, longestWait: nil, reasons: [reason])
    }
}

// MARK: - Transfer Guardian

public struct TransferGuardianPolicy: Codable, Hashable, Sendable {
    /// A worst-case margin at least this large is `safe`.
    public var safeMarginMinutes: Double
    /// A wait for the following connection at least this long is worth saying out loud.
    public var longWaitMinutes: Double

    public static let standard = TransferGuardianPolicy(safeMarginMinutes: 4, longWaitMinutes: 30)
}

/// What the evidence allows for one instant, in minutes. Never a single guess.
public struct MinuteRange: Codable, Hashable, Sendable {
    public let min: Double
    public let max: Double

    public init(min: Double, max: Double) {
        self.min = min
        self.max = max
    }

    var isValid: Bool { min.isFinite && max.isFinite && min <= max }
}

public struct TransferInput: Codable, Hashable, Sendable {
    /// When the bus the rider is on reaches the transfer stop.
    public var feederArrival: MinuteRange?
    /// Between the two stops; 0 when it is the same stop.
    public var walk: Double?
    /// When the planned connecting bus leaves the transfer stop.
    public var connection: MinuteRange?
    /// When the connecting bus after it leaves, if known.
    public var nextConnection: Double?
    /// A Rescue plan replaced this connection.
    public var recovering: Bool?

    public init(
        feederArrival: MinuteRange?,
        walk: Double? = nil,
        connection: MinuteRange?,
        nextConnection: Double? = nil,
        recovering: Bool? = nil
    ) {
        self.feederArrival = feederArrival
        self.walk = walk
        self.connection = connection
        self.nextConnection = nextConnection
        self.recovering = recovering
    }
}

public enum TransferReason: String, Codable, Hashable, Sendable {
    case feederUnknown
    case connectionUnknown
    case invalidInput
    case longWaitIfMissed
}

public struct TransferAssessment: Codable, Hashable, Sendable {
    public let risk: TransferRisk
    /// Connection departure minus the rider's readiness, in the worst case.
    public let worstMargin: Double?
    /// The same, in the best case.
    public let bestMargin: Double?
    /// The longest wait for the following connection if this one is missed.
    public let waitIfMissed: Double?
    public let reasons: [TransferReason]

    public init(risk: TransferRisk, worstMargin: Double?, bestMargin: Double?, waitIfMissed: Double?, reasons: [TransferReason]) {
        self.risk = risk
        self.worstMargin = worstMargin
        self.bestMargin = bestMargin
        self.waitIfMissed = waitIfMissed
        self.reasons = reasons
    }
}

/// "Is this transfer still realistically achievable?" — not "8 minutes until transfer".
public enum TransferGuardian {
    public static func assess(_ input: TransferInput, policy: TransferGuardianPolicy = .standard) -> TransferAssessment {
        if input.recovering == true {
            return TransferAssessment(risk: .recovering, worstMargin: nil, bestMargin: nil, waitIfMissed: nil, reasons: [])
        }
        guard let feeder = input.feederArrival else { return undetermined(.feederUnknown) }
        guard let connection = input.connection else { return undetermined(.connectionUnknown) }
        let walk = input.walk ?? 0
        guard feeder.isValid, connection.isValid, walk.isFinite, walk >= 0 else { return undetermined(.invalidInput) }

        let readyEarliest = feeder.min + walk
        let readyLatest = feeder.max + walk
        let worstMargin = connection.min - readyLatest
        let bestMargin = connection.max - readyEarliest
        let risk: TransferRisk
        if bestMargin < 0 {
            risk = .missed
        } else if worstMargin >= policy.safeMarginMinutes {
            risk = .safe
        } else if worstMargin >= 0 {
            risk = .tight
        } else {
            risk = .atRisk
        }
        var waitIfMissed: Double?
        if let next = input.nextConnection, next >= readyEarliest {
            waitIfMissed = next - readyEarliest
        }
        let reasons: [TransferReason] = (waitIfMissed ?? 0) >= policy.longWaitMinutes ? [.longWaitIfMissed] : []
        return TransferAssessment(risk: risk, worstMargin: worstMargin, bestMargin: bestMargin, waitIfMissed: waitIfMissed, reasons: reasons)
    }

    private static func undetermined(_ reason: TransferReason) -> TransferAssessment {
        TransferAssessment(risk: .unknown, worstMargin: nil, bestMargin: nil, waitIfMissed: nil, reasons: [reason])
    }
}

// MARK: - Rescue

public struct RescuePolicy: Codable, Hashable, Sendable {
    /// ASSUMED walking pace, about 4.2 km/h.
    public var walkingMetersPerMinute: Double
    /// Beyond this TAPSO does not propose walking back.
    public var maxWalkBackMeters: Double
    /// A walk back this short is preferred over waiting for a bus.
    public var comfortableWalkMinutes: Double
    /// A wait at least this long is marked as long.
    public var longWaitMinutes: Double

    public static let standard = RescuePolicy(
        walkingMetersPerMinute: 70,
        maxWalkBackMeters: 1_200,
        comfortableWalkMinutes: 15,
        longWaitMinutes: 30
    )
}

public enum RescueKind: String, Codable, Hashable, Sendable, CaseIterable {
    case passedDestination
    case missedConnection
    case wrongDirection
}

public enum RescueAction: String, Codable, Hashable, Sendable {
    case walkBack
    case rideBack
    case waitForNextConnection
    case takeAlternativeRoute
    case openMapApp
}

public struct RescueInput: Codable, Hashable, Sendable {
    public var kind: RescueKind
    /// Where the rider can get off next.
    public var nextStopName: String?
    /// From that stop back to the destination, when both are surveyed.
    public var walkBackMeters: Double?
    /// A bus of the same route runs the other way through both stops.
    public var oppositeDirection: Bool?
    public var oppositeWaitMinutes: Double?
    public var nextConnectionWaitMinutes: Double?
    /// Other routes TAPSO knows serve the destination from here.
    public var alternativeRoutes: [String]?

    public init(
        kind: RescueKind,
        nextStopName: String? = nil,
        walkBackMeters: Double? = nil,
        oppositeDirection: Bool? = nil,
        oppositeWaitMinutes: Double? = nil,
        nextConnectionWaitMinutes: Double? = nil,
        alternativeRoutes: [String]? = nil
    ) {
        self.kind = kind
        self.nextStopName = nextStopName
        self.walkBackMeters = walkBackMeters
        self.oppositeDirection = oppositeDirection
        self.oppositeWaitMinutes = oppositeWaitMinutes
        self.nextConnectionWaitMinutes = nextConnectionWaitMinutes
        self.alternativeRoutes = alternativeRoutes
    }
}

public struct RescueOption: Codable, Hashable, Sendable {
    public let action: RescueAction
    public let minutes: Double?
    public let routeNumber: String?
    public let longWait: Bool

    public init(action: RescueAction, minutes: Double? = nil, routeNumber: String? = nil, longWait: Bool = false) {
        self.action = action
        self.minutes = minutes
        self.routeNumber = routeNumber
        self.longWait = longWait
    }
}

public struct RescuePlan: Codable, Hashable, Sendable {
    /// Get off here first; `nil` when the rider is not on a bus that must be left.
    public let exitAt: String?
    /// Ordered; the first is the recommendation. A map-app hand-off is always last.
    public let options: [RescueOption]

    public init(exitAt: String?, options: [RescueOption]) {
        self.exitAt = exitAt
        self.options = options
    }

    public var recommended: RescueOption? { options.first }
}

/// "한 정거장 지나쳤어요" answered with what to do, not with an error.
public enum Rescue {
    public static func plan(_ input: RescueInput, policy: RescuePolicy = .standard) -> RescuePlan {
        let map = RescueOption(action: .openMapApp)
        let exitAt = input.kind == .missedConnection ? nil : input.nextStopName

        switch input.kind {
        case .missedConnection:
            var waitOptions: [RescueOption] = []
            var shortWait = false
            if let wait = input.nextConnectionWaitMinutes {
                let long = wait >= policy.longWaitMinutes
                waitOptions.append(RescueOption(action: .waitForNextConnection, minutes: wait, longWait: long))
                shortWait = !long
            }
            let alternatives: [RescueOption] = (input.alternativeRoutes ?? []).map { route in
                RescueOption(action: .takeAlternativeRoute, routeNumber: route)
            }
            var options: [RescueOption]
            if shortWait {
                options = waitOptions + alternatives
            } else {
                options = alternatives + waitOptions
            }
            options.append(map)
            return RescuePlan(exitAt: exitAt, options: options)

        case .wrongDirection:
            var options: [RescueOption] = []
            if input.oppositeDirection == true {
                options.append(RescueOption(action: .rideBack, minutes: input.oppositeWaitMinutes))
            }
            options.append(map)
            return RescuePlan(exitAt: exitAt, options: options)

        case .passedDestination:
            let rideBack = input.oppositeDirection == true ? RescueOption(action: .rideBack, minutes: input.oppositeWaitMinutes) : nil
            var walkBack: RescueOption?
            if let meters = input.walkBackMeters, meters.isFinite, meters >= 0, meters <= policy.maxWalkBackMeters {
                walkBack = RescueOption(action: .walkBack, minutes: (meters / policy.walkingMetersPerMinute).rounded(.up))
            }
            var preferWalk = false
            if let walkMinutes = walkBack?.minutes {
                if walkMinutes <= policy.comfortableWalkMinutes || rideBack == nil {
                    preferWalk = true
                } else if let rideWait = rideBack?.minutes, walkMinutes <= rideWait {
                    preferWalk = true
                }
            }
            let ordered: [RescueOption?] = preferWalk ? [walkBack, rideBack] : [rideBack, walkBack]
            var options: [RescueOption] = ordered.compactMap { $0 }
            options.append(map)
            return RescuePlan(exitAt: exitAt, options: options)
        }
    }
}
