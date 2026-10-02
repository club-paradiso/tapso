import Foundation

// Wire types for TAPSO's own transit API (`docs/PRODUCTION_TRANSIT_API.md`).
//
// Decoding only: the core makes no request. The app's single network client
// (`apps/ios/TapsoApp/TapsoAPIClient.swift`) fetches these, and every vehicle
// decision in them was made by the server's directed matcher or by the
// rider's own confirmation. Nothing here feeds the demo-only
// `VehicleMatchingEngine` (`services/api/test/crossLanguageAuthority.test.ts`).

/// One official route variant, as `GET /v1/routes` lists it. A route number is
/// several of these, one per direction and branch.
public struct TransitAPIRoute: Codable, Hashable, Sendable, Identifiable {
    public var id: String { routeId }
    public let routeId: String
    public let routeNumber: String
    public let startStopName: String?
    public let endStopName: String?
    public let routeType: String?

    public init(routeId: String, routeNumber: String, startStopName: String?, endStopName: String?, routeType: String? = nil) {
        self.routeId = routeId
        self.routeNumber = routeNumber
        self.startStopName = startStopName
        self.endStopName = endStopName
        self.routeType = routeType
    }
}

/// One stop of a route variant, in provider order (`sequence` is TAGO `nodeord`).
public struct TransitAPIStop: Codable, Hashable, Sendable, Identifiable {
    public var id: Int { sequence }
    public let stopId: String
    public let name: String
    public let sequence: Int
    public let directionCode: String?
    public let latitude: Double?
    public let longitude: Double?

    public init(stopId: String, name: String, sequence: Int, directionCode: String? = nil, latitude: Double? = nil, longitude: Double? = nil) {
        self.stopId = stopId
        self.name = name
        self.sequence = sequence
        self.directionCode = directionCode
        self.latitude = latitude
        self.longitude = longitude
    }
}

public struct TransitAPIRouteList: Codable, Hashable, Sendable {
    public let items: [TransitAPIRoute]
}

public struct TransitAPIStopList: Codable, Hashable, Sendable {
    public let items: [TransitAPIStop]
    public let meta: Meta?

    public struct Meta: Codable, Hashable, Sendable {
        public let topology: Topology?
    }

    /// `linear`, `loop` or `repeating`; a client that cannot read it assumes `linear`.
    public struct Topology: Codable, Hashable, Sendable {
        public let kind: String
    }
}

/// `GET /v1/route-info`: a route's published service day (TAGO `getRouteInfoIem`).
/// The times are departures from the route's starting stop (기점), never from any
/// other stop; headways are published averages, never a timetable.
public struct TransitAPIRouteServiceHours: Codable, Hashable, Sendable {
    public struct Headways: Codable, Hashable, Sendable {
        public let weekday: Int?
        public let saturday: Int?
        public let sunday: Int?

        public init(weekday: Int? = nil, saturday: Int? = nil, sunday: Int? = nil) {
            self.weekday = weekday
            self.saturday = saturday
            self.sunday = sunday
        }
    }

    public let routeId: String
    public let routeNumber: String?
    public let startStopName: String?
    public let endStopName: String?
    /// `HH:MM`, Korean time.
    public let firstDeparture: String?
    public let lastDeparture: String?
    public let headwayMinutes: Headways

    public init(
        routeId: String,
        routeNumber: String? = nil,
        startStopName: String? = nil,
        endStopName: String? = nil,
        firstDeparture: String? = nil,
        lastDeparture: String? = nil,
        headwayMinutes: Headways = Headways()
    ) {
        self.routeId = routeId
        self.routeNumber = routeNumber
        self.startStopName = startStopName
        self.endStopName = endStopName
        self.firstDeparture = firstDeparture
        self.lastDeparture = lastDeparture
        self.headwayMinutes = headwayMinutes
    }
}

public struct TransitAPIRouteInfo: Codable, Hashable, Sendable {
    public let item: TransitAPIRouteServiceHours
}

/// `{"error": "<CODE>", "message": "..."}`
public struct TransitAPIErrorBody: Codable, Hashable, Sendable {
    public let error: String
    public let message: String?
}

/// The server's view of a journey session (`JourneySessionView`), the fields the app reads.
public struct JourneySessionSnapshot: Codable, Hashable, Sendable {
    public let id: String
    public let routeId: String
    public let cityCode: String
    public let boardingStop: TransitAPIStop
    public let destinationStop: TransitAPIStop
    public let riderState: String?
    /// Set only by the rider's confirmation while matching is in shadow mode.
    public let selectedVehicleId: String?
    public let selectionMode: String?
    public let state: String
    public let progress: Progress?
    public let candidates: [Candidate]?
    /// How the rider may be asked which bus is theirs (issue #80). The server
    /// derives it from the demonstrated matcher readiness; absent means a
    /// server from before it existed, read as `riderIdentifies`.
    public let vehicleChoice: VehicleChoice?
    public let explanation: String?
    public let matchingMode: String?
    public let providerRead: ProviderRead?
    public let updatedAt: String?
    public let expiresAt: String?

    public struct Progress: Codable, Hashable, Sendable {
        public let currentStopSequence: Int
        public let currentStopId: String?
        public let remainingStops: Int
        /// `active`, `approaching`, `next_stop`, `arrived` or `passed_destination`.
        public let phase: String
        /// `provider_stop_sequence`, `near_stop_estimate` or `retained_last_known`.
        public let source: String
    }

    public struct Candidate: Codable, Hashable, Sendable {
        public let vehicleId: String
        /// Candidate stop sequence minus the boarding stop's; positive is past the stop.
        public let stopOffset: Int?
        public let zone: String?
        public let rejectedReasons: [String]?
    }

    public struct VehicleChoice: Codable, Hashable, Sendable {
        /// `rider_identifies` or `matcher_suggestion`. Anything else fails closed to `rider_identifies`.
        public let presentation: String
        public let readiness: String?
        /// Raw positions from the latest provider read, nearest the stop first.
        public let vehicles: [Vehicle]

        public struct Vehicle: Codable, Hashable, Sendable {
            public let vehicleId: String
            /// Stops still to travel to the boarding stop; `0` is at the stop.
            public let stopsAway: Int?
            /// Stops past the boarding stop, for a bus the rider may already be on.
            public let stopsPast: Int?
        }

        /// Only an explicit `matcher_suggestion` lets the matcher's list read as a suggestion.
        public var allowsMatcherSuggestion: Bool { presentation == "matcher_suggestion" }
    }

    public struct ProviderRead: Codable, Hashable, Sendable {
        public let state: String
        public let consecutiveFailures: Int
    }

    public var sessionState: LiveSessionState { LiveSessionState(rawValue: state) ?? .unrecognized }
}

/// `JourneySessionState` on the server. An unknown value fails closed.
public enum LiveSessionState: String, Codable, Hashable, Sendable {
    case awaitingMatch = "awaiting_match"
    case confirmationRequired = "confirmation_required"
    case tracking
    case degraded
    case arrived
    case passedDestination = "passed_destination"
    case lost
    case unrecognized
}

/// Why a request to the transit API did not produce an answer.
///
/// Each case is a different situation for a rider, and the copy says which:
/// a slow bus feed is not a broken TAPSO, and neither is "no bus".
public enum TransitAPIFailure: Error, Hashable, Sendable {
    /// The phone has no connection.
    case offline
    /// TAPSO did not answer in time.
    case timedOut
    /// The bus feed did not answer TAPSO in time (`PROVIDER_TIMEOUT`).
    case providerTimeout
    /// The bus feed could not be reached (`PROVIDER_UNAVAILABLE`).
    case providerUnavailable
    /// The bus feed sent something unusable (`PROVIDER_RESPONSE_INVALID`).
    case providerInvalid
    /// Live rides are not enabled on the server yet (`SESSIONS_UNAVAILABLE`, `SESSION_STORE_UNAVAILABLE`).
    case sessionsUnavailable
    /// The server has no transit credential (`BLOCKED_BY_CREDENTIALS`).
    case serviceUnavailable
    case sessionNotFound
    case sessionExpired
    case rateLimited
    /// The server refused the request as written (`INVALID_INPUT`), e.g. a bus no longer in the snapshot.
    case rejected
    /// TAPSO itself failed (`INTERNAL_ERROR` or an unmapped status).
    case server
    /// The answer could not be read.
    case unexpectedResponse

    /// Classifies an HTTP answer by the server's error code first, its status second.
    public static func classify(status: Int, code: String?) -> TransitAPIFailure {
        switch code {
        case "PROVIDER_TIMEOUT": return .providerTimeout
        case "PROVIDER_UNAVAILABLE": return .providerUnavailable
        case "PROVIDER_RESPONSE_INVALID": return .providerInvalid
        case "SESSIONS_UNAVAILABLE", "SESSION_STORE_UNAVAILABLE": return .sessionsUnavailable
        case "BLOCKED_BY_CREDENTIALS": return .serviceUnavailable
        case "SESSION_NOT_FOUND": return .sessionNotFound
        case "SESSION_EXPIRED": return .sessionExpired
        case "RATE_LIMITED": return .rateLimited
        case "INVALID_INPUT", "PAYLOAD_TOO_LARGE", "METHOD_NOT_ALLOWED", "NOT_FOUND": return .rejected
        default: break
        }
        switch status {
        case 400, 404, 405, 413: return .rejected
        case 410: return .sessionExpired
        case 429: return .rateLimited
        case 504: return .providerTimeout
        default: return .server
        }
    }

    /// Classifies a transport failure.
    public static func classify(_ error: URLError) -> TransitAPIFailure {
        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
            return .offline
        case .timedOut:
            return .timedOut
        default:
            return .server
        }
    }

    /// Worth trying again shortly without asking the rider to do anything.
    public var isTransient: Bool {
        switch self {
        case .offline, .timedOut, .providerTimeout, .providerUnavailable, .providerInvalid, .rateLimited, .server, .unexpectedResponse:
            true
        case .sessionsUnavailable, .serviceUnavailable, .sessionNotFound, .sessionExpired, .rejected:
            false
        }
    }

    /// Localization key for the rider-facing explanation: `live.error.<case>`.
    public var copyKey: String { "live.error.\(name)" }

    public var name: String {
        switch self {
        case .offline: "offline"
        case .timedOut: "timedOut"
        case .providerTimeout: "providerTimeout"
        case .providerUnavailable: "providerUnavailable"
        case .providerInvalid: "providerInvalid"
        case .sessionsUnavailable: "sessionsUnavailable"
        case .serviceUnavailable: "serviceUnavailable"
        case .sessionNotFound: "sessionNotFound"
        case .sessionExpired: "sessionExpired"
        case .rateLimited: "rateLimited"
        case .rejected: "rejected"
        case .server: "server"
        case .unexpectedResponse: "unexpectedResponse"
        }
    }

    public static let allCases: [TransitAPIFailure] = [
        .offline, .timedOut, .providerTimeout, .providerUnavailable, .providerInvalid, .sessionsUnavailable,
        .serviceUnavailable, .sessionNotFound, .sessionExpired, .rateLimited, .rejected, .server, .unexpectedResponse,
    ]
}
