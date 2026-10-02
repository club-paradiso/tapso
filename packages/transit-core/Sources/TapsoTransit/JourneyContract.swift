import Foundation

/// TAPSO Journey Contract v1: one vocabulary for a journey and for what every
/// surface shows during it.
///
/// The server (`services/api/src/journeyContract.ts`), this core and the
/// marketing site share it instead of each inventing journey semantics. The
/// language-neutral specification is `fixtures/journey/journey-contract-v1.json`;
/// both implementations run every case in it. Product description:
/// `docs/product/JOURNEY_CONTRACT_V3.md`.
///
/// Nothing here decides which bus a rider is on: vehicle selection stays with
/// the server's directed matcher and the rider's confirmation.
public enum JourneyContract {
    public static let version = "tapso-journey-contract-v1"

    /// A journey is a sequence of segments with at least one ride. Consecutive
    /// rides are joined by exactly one transfer, which is where the Transfer
    /// Guardian watches; a walk is only ever the first or the last mile.
    public static func validate(_ segments: [JourneySegmentSpec]) -> Result<JourneyShape, JourneyContractError> {
        var rideCount = 0
        var transferCount = 0
        for (index, segment) in segments.enumerated() {
            if let meters = segment.meters, !(meters.isFinite && meters >= 0) {
                return .failure(.invalidDistance)
            }
            let previous: JourneySegmentKind? = index > 0 ? segments[index - 1].kind : nil
            let next: JourneySegmentKind? = index + 1 < segments.count ? segments[index + 1].kind : nil
            switch segment.kind {
            case .ride:
                rideCount += 1
                guard
                    let board = segment.boardSequence,
                    let alight = segment.alightSequence,
                    alight > board
                else { return .failure(.invalidRideOrder) }
                if previous == .ride { return .failure(.missingTransfer) }
            case .transfer:
                transferCount += 1
                if previous != .ride || next != .ride { return .failure(.danglingTransfer) }
            case .walk:
                let rideFollows = segments[(index + 1)...].contains { $0.kind == .ride }
                if previous == .ride && rideFollows { return .failure(.walkBetweenRides) }
            }
        }
        guard rideCount > 0 else { return .failure(.noRide) }
        return .success(JourneyShape(rideCount: rideCount, transferCount: transferCount))
    }
}

public enum JourneySegmentKind: String, Codable, Hashable, Sendable, CaseIterable {
    case walk
    case ride
    case transfer
}

/// The Transfer Guardian's reading of the next connection.
public enum TransferRisk: String, Codable, Hashable, Sendable, CaseIterable {
    /// Comfortably makeable.
    case safe
    /// Makeable, with little margin.
    case tight
    /// Likely to be missed unless something changes.
    case atRisk
    /// No longer makeable.
    case missed
    /// A recovery plan replaced the connection.
    case recovering
    /// Not enough live data to say. Never shown as urgency.
    case unknown
}

/// How comfortably the rider can get back. See `SafeReturnStatus`.
public enum SafeReturnLevel: String, Codable, Hashable, Sendable, CaseIterable {
    /// "오늘 다녀오기 좋아요": return options stay open well past a useful visit.
    case comfortable
    /// "17:40 전에는 돌아오는 게 좋아요": fine, with a leave-by time.
    case leaveBy
    /// Possible, with a short visit or a long wait.
    case tight
    /// "지금은 다른 곳이 나아요": no practical way back after a useful visit.
    case notRecommended
    /// Not enough data to say. Never presented as safe.
    case unknown
}

/// The single thing every surface shows. Mirrors the specification's `surfaceStates`.
public enum JourneySurfaceState: String, Codable, Hashable, Sendable, CaseIterable {
    case waiting
    case confirm
    case riding
    case prepare
    case nextStop
    case transfer
    case transferRisk
    case arrival
    case delayed
    case checking
    case discovery
    case recovery
    case ended
}

/// What the rider should do now. Mirrors the specification's `nextActions`.
public enum JourneyNextAction: String, Codable, Hashable, Sendable, CaseIterable {
    case walkToStop
    case waitForBus
    case confirmBus
    case stayOnBus
    case prepareToExit
    case pressStopButton
    case exitHere
    case exitAndTransfer
    case boardNextBus
    case checkBusDisplay
    case keepWatching
    case checkAlternative
    case followRecovery
    case considerStop
    case finish
}

/// One segment in the specification's minimal shape.
public struct JourneySegmentSpec: Codable, Hashable, Sendable {
    public let kind: JourneySegmentKind
    /// Walking distance for a walk or transfer; `nil` when not measured.
    public let meters: Double?
    public let routeNumber: String?
    public let boardSequence: Int?
    public let alightSequence: Int?

    public init(
        kind: JourneySegmentKind,
        meters: Double? = nil,
        routeNumber: String? = nil,
        boardSequence: Int? = nil,
        alightSequence: Int? = nil
    ) {
        self.kind = kind
        self.meters = meters
        self.routeNumber = routeNumber
        self.boardSequence = boardSequence
        self.alightSequence = alightSequence
    }
}

public enum JourneyContractError: String, Error, Codable, Hashable, Sendable {
    case noRide
    case missingTransfer
    case danglingTransfer
    case invalidRideOrder
    case walkBetweenRides
    case invalidDistance
}

public struct JourneyShape: Hashable, Sendable {
    public let rideCount: Int
    public let transferCount: Int

    public init(rideCount: Int, transferCount: Int) {
        self.rideCount = rideCount
        self.transferCount = transferCount
    }
}

/// The facts surface resolution reads. Every field is something another system already decided.
public struct JourneySurfaceInput: Hashable, Sendable {
    /// The kind of segment the rider is in now.
    public var segment: JourneySegmentKind
    /// True when no ride segment follows the current one.
    public var finalLeg: Bool
    /// The vehicle check, before a ride moment exists.
    public var preRide: VehicleCheckStage?
    /// The current ride's moment from `RideGuidancePolicy`, once riding.
    public var rideMoment: RideMoment?
    /// The Transfer Guardian's view of the next connection, if one is planned.
    public var transferRisk: TransferRisk?
    /// A Rescue plan is in force.
    public var recoveryActive: Bool
    /// A next-stop discovery is available for this ride.
    public var discoveryHint: Bool

    public init(
        segment: JourneySegmentKind,
        finalLeg: Bool,
        preRide: VehicleCheckStage? = nil,
        rideMoment: RideMoment? = nil,
        transferRisk: TransferRisk? = nil,
        recoveryActive: Bool = false,
        discoveryHint: Bool = false
    ) {
        self.segment = segment
        self.finalLeg = finalLeg
        self.preRide = preRide
        self.rideMoment = rideMoment
        self.transferRisk = transferRisk
        self.recoveryActive = recoveryActive
        self.discoveryHint = discoveryHint
    }
}

public struct JourneySurface: Hashable, Sendable {
    public let state: JourneySurfaceState
    public let action: JourneyNextAction

    public init(_ state: JourneySurfaceState, _ action: JourneyNextAction) {
        self.state = state
        self.action = action
    }
}

/// Picks the single most important thing to show now, for the app hero, the
/// Lock Screen and every Dynamic Island region alike.
///
/// Fail closed: anything not recognised as a confident moment becomes
/// `checking`, which never alerts. Precedence, highest first: ended; an active
/// recovery; the segment's own moment, where getting off at the right stop
/// outranks a risky connection and late data outranks everything that depends
/// on timing; a connection at risk; a discovery hint, offered only on the final
/// ride so TAPSO never suggests a detour while a connection is planned.
public enum JourneySurfacePolicy {
    public static func resolve(_ input: JourneySurfaceInput) -> JourneySurface {
        if input.rideMoment == .ended { return JourneySurface(.ended, .finish) }
        if input.recoveryActive { return JourneySurface(.recovery, .followRecovery) }

        switch input.segment {
        case .walk:
            return input.finalLeg ? JourneySurface(.arrival, .finish) : JourneySurface(.waiting, .walkToStop)
        case .transfer:
            switch input.transferRisk {
            case .recovering:
                return JourneySurface(.recovery, .followRecovery)
            case .atRisk, .missed:
                return JourneySurface(.transferRisk, .checkAlternative)
            case .safe, .tight, .unknown, nil:
                return JourneySurface(.transfer, .boardNextBus)
            }
        case .ride:
            return resolveRide(input)
        }
    }

    private static func resolveRide(_ input: JourneySurfaceInput) -> JourneySurface {
        guard let moment = input.rideMoment else {
            switch input.preRide {
            case .searching, .notFoundYet:
                return JourneySurface(.waiting, .waitForBus)
            case .proposed, .similarBuses, .choose:
                return JourneySurface(.confirm, .confirmBus)
            case .confirmed, nil:
                return JourneySurface(.checking, .keepWatching)
            }
        }
        switch moment {
        case .passedDestination:
            return JourneySurface(.recovery, .followRecovery)
        case .arrived:
            return input.finalLeg ? JourneySurface(.arrival, .exitHere) : JourneySurface(.transfer, .exitAndTransfer)
        case .nextStop:
            return JourneySurface(.nextStop, .pressStopButton)
        case .prepare:
            return JourneySurface(.prepare, .prepareToExit)
        case .delayed, .offline:
            return JourneySurface(.delayed, .checkBusDisplay)
        case .vehicleLost:
            return JourneySurface(.delayed, .keepWatching)
        case .checking:
            return JourneySurface(.checking, .keepWatching)
        case .ended:
            return JourneySurface(.ended, .finish)
        case .riding:
            if !input.finalLeg {
                if input.transferRisk == .recovering { return JourneySurface(.recovery, .followRecovery) }
                if input.transferRisk == .atRisk || input.transferRisk == .missed {
                    return JourneySurface(.transferRisk, .checkAlternative)
                }
            }
            if input.finalLeg && input.discoveryHint { return JourneySurface(.discovery, .considerStop) }
            return JourneySurface(.riding, .stayOnBus)
        }
    }
}
