import Foundation

/// A ride's state. `RideSession` is the only thing that moves it: the app creates one session
/// per ride (`TapsoAppModel`) and feeds it the matched bus's observations.
public enum JourneyState: String, Codable, Hashable, Sendable {
    case idle
    case planning
    case waitingForBoarding
    case matchingVehicle
    case vehicleConfirmationRequired
    case active
    case approachingDestination
    case nextStopIsDestination
    case arrived
    case dataAging
    case dataStale
    case vehicleTemporarilyLost
    case vehicleRecovery
    case cancelled
    case completed
}

public enum RideSessionUpdate: Hashable, Sendable {
    case applied(DestinationProgress)
    case duplicate
    case outOfOrder
    case wrongVehicle
    case progressFailure(DestinationProgressFailure)
}

public struct RideSession: Identifiable, Codable, Hashable, Sendable {
    public let id: UUID
    public let plan: RidePlan
    public let startedAt: Date
    public private(set) var matchedVehicleID: VehicleIdentifier?
    public private(set) var state: JourneyState
    public private(set) var latestObservation: VehicleObservation?
    public private(set) var latestProgress: DestinationProgress?

    public init(
        id: UUID = UUID(),
        plan: RidePlan,
        startedAt: Date,
        matchedVehicleID: VehicleIdentifier? = nil,
        state: JourneyState = .waitingForBoarding,
        latestObservation: VehicleObservation? = nil,
        latestProgress: DestinationProgress? = nil
    ) {
        self.id = id
        self.plan = plan
        self.startedAt = startedAt
        self.matchedVehicleID = matchedVehicleID
        self.state = state
        self.latestObservation = latestObservation
        self.latestProgress = latestProgress
    }

    public mutating func confirm(vehicleID: VehicleIdentifier) {
        matchedVehicleID = vehicleID
        state = .active
    }

    public mutating func markVehicleLost() {
        guard ![JourneyState.completed, .cancelled, .arrived].contains(state) else { return }
        state = .vehicleTemporarilyLost
    }

    public mutating func apply(
        observation: VehicleObservation,
        route: TransitRoute,
        now: Date,
        engine: DestinationProgressEngine = .init()
    ) -> RideSessionUpdate {
        guard observation.vehicleID == matchedVehicleID else { return .wrongVehicle }
        if let latestObservation {
            if observation.timestamp == latestObservation.timestamp { return .duplicate }
            if observation.timestamp < latestObservation.timestamp { return .outOfOrder }
        }

        switch engine.calculate(observation: observation, route: route, plan: plan, now: now) {
        case let .failure(error):
            return .progressFailure(error)
        case let .success(progress):
            latestObservation = observation
            latestProgress = progress
            state = Self.state(for: progress)
            return .applied(progress)
        }
    }

    public mutating func complete() {
        state = .completed
    }

    public mutating func cancel() {
        state = .cancelled
    }

    private static func state(for progress: DestinationProgress) -> JourneyState {
        switch progress.freshness {
        case .stale, .unknown: return .dataStale
        case .aging: return .dataAging
        case .fresh:
            switch progress.phase {
            case .active: return .active
            case .approachingDestination: return .approachingDestination
            case .nextStopIsDestination: return .nextStopIsDestination
            case .arrived, .passedDestination: return .arrived
            case .unknown: return .dataStale
            }
        }
    }
}
