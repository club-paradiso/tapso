import ActivityKit
import Foundation
import TapsoTransit

public struct TapsoActivityAttributes: ActivityAttributes, Sendable {
    public struct ContentState: Codable, Hashable, Sendable {
        public let phase: JourneyState
        public let currentStopName: String
        public let nextStopName: String?
        public let remainingStops: Int
        public let freshness: DataFreshness
        public let updatedAt: Date
        /// The bus was last seen beyond the destination. Optional so older payloads still decode.
        public let destinationPassed: Bool?
        /// The phone has no connection. Optional so older payloads still decode.
        public let isOffline: Bool?

        public init(
            phase: JourneyState,
            currentStopName: String,
            nextStopName: String?,
            remainingStops: Int,
            freshness: DataFreshness,
            updatedAt: Date,
            destinationPassed: Bool = false,
            isOffline: Bool = false
        ) {
            self.phase = phase
            self.currentStopName = currentStopName
            self.nextStopName = nextStopName
            self.remainingStops = remainingStops
            self.freshness = freshness
            self.updatedAt = updatedAt
            self.destinationPassed = destinationPassed
            self.isOffline = isOffline
        }

        /// The same facts every other surface reads.
        public var signal: RideSignal {
            RideSignal(
                phase: phase,
                remainingStops: remainingStops,
                freshness: freshness,
                destinationPassed: destinationPassed ?? false,
                isOffline: isOffline ?? false
            )
        }

        public var guidance: RideGuidance {
            RideGuidancePolicy.guidance(for: signal)
        }
    }

    public let routeNumber: String
    public let routeID: String
    public let boardingStopName: String
    public let destinationName: String
    public let totalStops: Int
    /// The masked plate of the rider-confirmed bus, e.g. `••0001`.
    public let vehiclePlate: String?

    public init(
        routeNumber: String,
        routeID: String,
        boardingStopName: String,
        destinationName: String,
        totalStops: Int,
        vehiclePlate: String? = nil
    ) {
        self.routeNumber = routeNumber
        self.routeID = routeID
        self.boardingStopName = boardingStopName
        self.destinationName = destinationName
        self.totalStops = totalStops
        self.vehiclePlate = vehiclePlate
    }
}
