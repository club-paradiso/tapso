import Foundation

public struct RouteID: RawRepresentable, Codable, Hashable, Sendable, ExpressibleByStringLiteral {
    public let rawValue: String

    public init(rawValue: String) { self.rawValue = rawValue }
    public init(stringLiteral value: String) { rawValue = value }
}

public struct StopID: RawRepresentable, Codable, Hashable, Sendable, ExpressibleByStringLiteral {
    public let rawValue: String

    public init(rawValue: String) { self.rawValue = rawValue }
    public init(stringLiteral value: String) { rawValue = value }
}

public struct VehicleIdentifier: RawRepresentable, Codable, Hashable, Sendable, ExpressibleByStringLiteral {
    public let rawValue: String

    public init(rawValue: String) { self.rawValue = rawValue }
    public init(stringLiteral value: String) { rawValue = value }
}

public struct Coordinate: Codable, Hashable, Sendable {
    public let latitude: Double
    public let longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }

    public func distance(to other: Coordinate) -> Double {
        let radius = 6_371_000.0
        let latitudeDelta = (other.latitude - latitude) * .pi / 180
        let longitudeDelta = (other.longitude - longitude) * .pi / 180
        let latitude1 = latitude * .pi / 180
        let latitude2 = other.latitude * .pi / 180
        let a = sin(latitudeDelta / 2) * sin(latitudeDelta / 2)
            + cos(latitude1) * cos(latitude2)
            * sin(longitudeDelta / 2) * sin(longitudeDelta / 2)
        return radius * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    public func bearing(to other: Coordinate) -> Double {
        let latitude1 = latitude * .pi / 180
        let latitude2 = other.latitude * .pi / 180
        let longitudeDelta = (other.longitude - longitude) * .pi / 180
        let y = sin(longitudeDelta) * cos(latitude2)
        let x = cos(latitude1) * sin(latitude2)
            - sin(latitude1) * cos(latitude2) * cos(longitudeDelta)
        return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }
}

public enum RouteDirection: String, Codable, Hashable, Sendable {
    case outbound
    case inbound
    case unknown
}

public struct Stop: Codable, Hashable, Identifiable, Sendable {
    public let id: StopID
    public let name: String
    public let coordinate: Coordinate

    public init(id: StopID, name: String, coordinate: Coordinate) {
        self.id = id
        self.name = name
        self.coordinate = coordinate
    }
}

public struct RouteStop: Codable, Hashable, Sendable {
    public let stop: Stop
    public let sequence: Int

    public init(stop: Stop, sequence: Int) {
        self.stop = stop
        self.sequence = sequence
    }
}

public struct TransitRoute: Codable, Hashable, Identifiable, Sendable {
    public let id: RouteID
    public let number: String
    public let direction: RouteDirection
    public let variantID: String?
    public let originName: String
    public let destinationName: String
    public let stops: [RouteStop]

    public init(
        id: RouteID,
        number: String,
        direction: RouteDirection,
        variantID: String? = nil,
        originName: String,
        destinationName: String,
        stops: [RouteStop]
    ) {
        self.id = id
        self.number = number
        self.direction = direction
        self.variantID = variantID
        self.originName = originName
        self.destinationName = destinationName
        self.stops = stops.sorted { $0.sequence < $1.sequence }
    }

    public func routeStop(id: StopID) -> RouteStop? {
        stops.first { $0.stop.id == id }
    }

    public func expectedBearing(at stopID: StopID) -> Double? {
        guard
            let index = stops.firstIndex(where: { $0.stop.id == stopID }),
            stops.indices.contains(index + 1)
        else { return nil }
        return stops[index].stop.coordinate.bearing(to: stops[index + 1].stop.coordinate)
    }
}

public enum VehicleEvent: String, Codable, Hashable, Sendable {
    case approachingStop
    case arrivedAtStop
    case departedStop
    case inTransit
    case unknown
}

public struct VehicleObservation: Codable, Hashable, Sendable {
    public let vehicleID: VehicleIdentifier
    public let routeID: RouteID
    public let routeVariantID: String?
    public let direction: RouteDirection
    public let timestamp: Date
    public let coordinate: Coordinate
    public let headingDegrees: Double?
    public let speedKilometersPerHour: Double?
    public let confirmedStopID: StopID?
    public let event: VehicleEvent

    public init(
        vehicleID: VehicleIdentifier,
        routeID: RouteID,
        routeVariantID: String? = nil,
        direction: RouteDirection,
        timestamp: Date,
        coordinate: Coordinate,
        headingDegrees: Double? = nil,
        speedKilometersPerHour: Double? = nil,
        confirmedStopID: StopID? = nil,
        event: VehicleEvent = .unknown
    ) {
        self.vehicleID = vehicleID
        self.routeID = routeID
        self.routeVariantID = routeVariantID
        self.direction = direction
        self.timestamp = timestamp
        self.coordinate = coordinate
        self.headingDegrees = headingDegrees
        self.speedKilometersPerHour = speedKilometersPerHour
        self.confirmedStopID = confirmedStopID
        self.event = event
    }
}

public struct VehicleCandidate: Codable, Hashable, Identifiable, Sendable {
    public var id: VehicleIdentifier { vehicleID }
    public let vehicleID: VehicleIdentifier
    public let observations: [VehicleObservation]

    public init(vehicleID: VehicleIdentifier, observations: [VehicleObservation]) {
        self.vehicleID = vehicleID
        self.observations = observations
    }

    public var latest: VehicleObservation? {
        observations.max { $0.timestamp < $1.timestamp }
    }
}

public struct RidePlan: Codable, Hashable, Sendable {
    public let routeID: RouteID
    public let routeVariantID: String?
    public let direction: RouteDirection
    public let boardingStopID: StopID
    public let destinationStopID: StopID

    public init(
        routeID: RouteID,
        routeVariantID: String? = nil,
        direction: RouteDirection,
        boardingStopID: StopID,
        destinationStopID: StopID
    ) {
        self.routeID = routeID
        self.routeVariantID = routeVariantID
        self.direction = direction
        self.boardingStopID = boardingStopID
        self.destinationStopID = destinationStopID
    }
}

public struct BoardingContext: Codable, Hashable, Sendable {
    public let tappedAt: Date
    public let oneShotLocation: Coordinate?

    public init(tappedAt: Date, oneShotLocation: Coordinate? = nil) {
        self.tappedAt = tappedAt
        self.oneShotLocation = oneShotLocation
    }
}

public enum DataFreshness: String, Codable, Hashable, Sendable {
    case fresh
    case aging
    case stale
    case unknown
}

public struct FreshnessPolicy: Codable, Hashable, Sendable {
    public let freshThrough: TimeInterval
    public let agingThrough: TimeInterval

    public init(freshThrough: TimeInterval, agingThrough: TimeInterval) {
        precondition(freshThrough >= 0 && agingThrough >= freshThrough)
        self.freshThrough = freshThrough
        self.agingThrough = agingThrough
    }

    /// ASSUMED conservative initial values. Recalibrate after observing authenticated upstream cadence.
    public static let conservativeDefault = FreshnessPolicy(freshThrough: 30, agingThrough: 120)

    public func classify(observedAt: Date?, relativeTo now: Date) -> DataFreshness {
        guard let observedAt else { return .unknown }
        let age = now.timeIntervalSince(observedAt)
        guard age >= 0 else { return .unknown }
        if age <= freshThrough { return .fresh }
        if age <= agingThrough { return .aging }
        return .stale
    }
}
