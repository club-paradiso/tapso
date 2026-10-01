import Foundation

// Wire models for the TAPSO transit API (`docs/PRODUCTION_TRANSIT_API.md`).
//
// Field names are the server's own. Enumerations the server may extend decode
// unknown values as `.unknown` instead of failing the whole response.
//
// Deliberately absent: the session's `candidates` ranking and its
// `shadowSelection`. Both are matcher output. At `READY_FOR_SHADOW`, the
// readiness release gate `matcher-passive-safety-v4` has awarded, riders see
// nothing from the matcher and only an explicit rider confirmation selects a
// bus (`services/api/src/matcherSafetyGate.ts`). The client does not decode
// what it may not show. Raising that takes new evidence and a reviewed change.

/// One official route ID: a route number in one direction (`GET /v1/routes`).
public struct LiveRoute: Codable, Hashable, Sendable, Identifiable {
    public let routeId: String
    public let routeNumber: String
    public let startStopName: String?
    public let endStopName: String?
    public let routeType: String?

    public var id: String { routeId }

    public init(routeId: String, routeNumber: String, startStopName: String? = nil, endStopName: String? = nil, routeType: String? = nil) {
        self.routeId = routeId
        self.routeNumber = routeNumber
        self.startStopName = startStopName
        self.endStopName = endStopName
        self.routeType = routeType
    }
}

/// A stop on one route ID, in TAGO `nodeord` order (`GET /v1/stops`).
public struct LiveStop: Codable, Hashable, Sendable, Identifiable {
    public let stopId: String
    public let name: String
    public let sequence: Int
    public let directionCode: String?
    public let latitude: Double?
    public let longitude: Double?

    public var id: Int { sequence }

    public init(stopId: String, name: String, sequence: Int, directionCode: String? = nil, latitude: Double? = nil, longitude: Double? = nil) {
        self.stopId = stopId
        self.name = name
        self.sequence = sequence
        self.directionCode = directionCode
        self.latitude = latitude
        self.longitude = longitude
    }
}

/// A route's stops and the server's classification of its shape.
public struct LiveStopList: Decodable, Hashable, Sendable {
    public let items: [LiveStop]
    /// `meta.topology.kind` (`linear`, `loop`, ...). Absent or unknown means linear, the choice that refuses wrap-around.
    public let topology: String?

    private enum CodingKeys: String, CodingKey { case items, meta }
    private enum MetaKeys: String, CodingKey { case topology }
    private enum TopologyKeys: String, CodingKey { case kind }

    public init(items: [LiveStop], topology: String? = nil) {
        self.items = items
        self.topology = topology
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        items = try container.decode([LiveStop].self, forKey: .items)
        let meta = try? container.nestedContainer(keyedBy: MetaKeys.self, forKey: .meta)
        let shape = try? meta?.nestedContainer(keyedBy: TopologyKeys.self, forKey: .topology)
        topology = try? shape?.decodeIfPresent(String.self, forKey: .kind)
    }
}

/// One raw vehicle position from the provider (`GET /v1/vehicles`). Not matcher output.
public struct LiveVehicle: Codable, Hashable, Sendable {
    public let vehicleId: String
    public let routeId: String
    public let stopId: String?
    public let stopName: String?
    public let stopSequence: Int?
    /// When TAPSO's server read the snapshot; never a provider observation time.
    public let receivedAt: String?

    public init(vehicleId: String, routeId: String, stopId: String? = nil, stopName: String? = nil, stopSequence: Int? = nil, receivedAt: String? = nil) {
        self.vehicleId = vehicleId
        self.routeId = routeId
        self.stopId = stopId
        self.stopName = stopName
        self.stopSequence = stopSequence
        self.receivedAt = receivedAt
    }
}

struct LiveItems<Item: Decodable>: Decodable {
    let items: [Item]
}

/// Where a journey session stands, as the server reports it.
public enum LiveSessionState: Hashable, Sendable, Codable {
    case awaitingMatch
    case confirmationRequired
    case tracking
    case degraded
    case arrived
    case passedDestination
    case lost
    case unknown(String)

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        switch raw {
        case "awaiting_match": self = .awaitingMatch
        case "confirmation_required": self = .confirmationRequired
        case "tracking": self = .tracking
        case "degraded": self = .degraded
        case "arrived": self = .arrived
        case "passed_destination": self = .passedDestination
        case "lost": self = .lost
        default: self = .unknown(raw)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .awaitingMatch: try container.encode("awaiting_match")
        case .confirmationRequired: try container.encode("confirmation_required")
        case .tracking: try container.encode("tracking")
        case .degraded: try container.encode("degraded")
        case .arrived: try container.encode("arrived")
        case .passedDestination: try container.encode("passed_destination")
        case .lost: try container.encode("lost")
        case .unknown(let raw): try container.encode(raw)
        }
    }
}

/// Distance to the destination, as the server derives it from the rider's bus.
public enum LiveProgressPhase: Hashable, Sendable, Codable {
    case active
    case approaching
    case nextStop
    case arrived
    case passedDestination
    case unknown(String)

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        switch raw {
        case "active": self = .active
        case "approaching": self = .approaching
        case "next_stop": self = .nextStop
        case "arrived": self = .arrived
        case "passed_destination": self = .passedDestination
        default: self = .unknown(raw)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .active: try container.encode("active")
        case .approaching: try container.encode("approaching")
        case .nextStop: try container.encode("next_stop")
        case .arrived: try container.encode("arrived")
        case .passedDestination: try container.encode("passed_destination")
        case .unknown(let raw): try container.encode(raw)
        }
    }
}

public struct LiveProgress: Codable, Hashable, Sendable {
    public let currentStopSequence: Int
    public let currentStopId: String?
    public let remainingStops: Int
    public let phase: LiveProgressPhase
    /// `provider_stop_sequence`, `near_stop_estimate` or `retained_last_known`.
    public let source: String

    public init(currentStopSequence: Int, currentStopId: String? = nil, remainingStops: Int, phase: LiveProgressPhase, source: String) {
        self.currentStopSequence = currentStopSequence
        self.currentStopId = currentStopId
        self.remainingStops = remainingStops
        self.phase = phase
        self.source = source
    }
}

/// Server-observed cadence of one vehicle's provider data (`server_observed_cadence_v1`).
public struct LiveCadence: Codable, Hashable, Sendable {
    public let state: String
    public let reason: String?

    public init(state: String, reason: String? = nil) {
        self.state = state
        self.reason = reason
    }

    /// `fresh`, `aging`, `stale`; anything else (including `unknown`) fails closed.
    public var freshness: DataFreshness {
        DataFreshness(rawValue: state) ?? .unknown
    }
}

public struct LiveProviderRead: Codable, Hashable, Sendable {
    public let state: String
    public let consecutiveFailures: Int
}

/// A journey session as the server reports it (`POST /v1/sessions`, `GET /v1/sessions/:id`).
public struct LiveSession: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let routeId: String
    public let cityCode: String
    public let boardingStop: LiveStop
    public let destinationStop: LiveStop
    public let riderState: String
    /// Set only by the rider's explicit confirmation while matching is in shadow mode.
    public let selectedVehicleId: String?
    public let selectionMode: String?
    public let state: LiveSessionState
    public let progress: LiveProgress?
    public let explanation: String
    /// `shadow` unless automatic selection was granted by the readiness gate.
    public let matchingMode: String
    public let sourceFreshness: [String: LiveCadence]?
    public let providerRead: LiveProviderRead?
    public let createdAt: String
    public let updatedAt: String
    public let expiresAt: String

    public init(
        id: String,
        routeId: String,
        cityCode: String,
        boardingStop: LiveStop,
        destinationStop: LiveStop,
        riderState: String = "waiting_at_stop",
        selectedVehicleId: String? = nil,
        selectionMode: String? = nil,
        state: LiveSessionState,
        progress: LiveProgress? = nil,
        explanation: String = "",
        matchingMode: String = "shadow",
        sourceFreshness: [String: LiveCadence]? = nil,
        providerRead: LiveProviderRead? = nil,
        createdAt: String = "",
        updatedAt: String = "",
        expiresAt: String = ""
    ) {
        self.id = id
        self.routeId = routeId
        self.cityCode = cityCode
        self.boardingStop = boardingStop
        self.destinationStop = destinationStop
        self.riderState = riderState
        self.selectedVehicleId = selectedVehicleId
        self.selectionMode = selectionMode
        self.state = state
        self.progress = progress
        self.explanation = explanation
        self.matchingMode = matchingMode
        self.sourceFreshness = sourceFreshness
        self.providerRead = providerRead
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.expiresAt = expiresAt
    }

    /// The cadence of the rider's own bus, when one is selected.
    public var selectedCadence: LiveCadence? {
        selectedVehicleId.flatMap { sourceFreshness?[$0] }
    }
}

/// `POST /v1/sessions` body. The rider is waiting at the boarding stop unless they say otherwise.
public struct LiveSessionRequest: Encodable, Hashable, Sendable {
    public let routeId: String
    public let cityCode: String
    public let boardingStopSequence: Int
    public let destinationStopSequence: Int
    public let directionCode: String?
    public let riderState: String

    public init(routeId: String, cityCode: String, boardingStopSequence: Int, destinationStopSequence: Int, directionCode: String? = nil, riderState: String = "waiting_at_stop") {
        self.routeId = routeId
        self.cityCode = cityCode
        self.boardingStopSequence = boardingStopSequence
        self.destinationStopSequence = destinationStopSequence
        self.directionCode = directionCode
        self.riderState = riderState
    }
}

struct LiveConfirmRequest: Encodable {
    let vehicleId: String
}

/// `{"error": "<CODE>", "message": "<safe text>"}`
struct LiveErrorBody: Decodable {
    let error: String
    let message: String?
}
