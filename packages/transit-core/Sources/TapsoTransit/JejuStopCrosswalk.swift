import Foundation

// TAGO stop id ↔ 제주버스정보시스템 (Jeju BIS) station id
// (`docs/validation/JEJU_BIS_TAGO_STOP_CROSSWALK.md`).
//
// TAGO names Jeju stops like `JEB405000315`; the passenger pages of
// bus.jeju.go.kr use station ids like `405000315`. Stripping `JEB` looks right
// and is NOT assumed: a station id is used only when the offline audit
// (`scripts/crosswalk/jeju-stop-crosswalk.ts`) recorded the stripped
// candidate as `VERIFIED_EXACT` against the official passenger page — same
// name with its direction marker, coordinates within tolerance. Nothing here
// derives an id at runtime, and an empty table (the state until that audit
// has run against the live site) means no station id for any stop.

public enum StopCrosswalkStatus: String, Codable, Hashable, Sendable, CaseIterable {
    /// The candidate station's official page names this exact pole (direction marker included) at these coordinates.
    case verifiedExact = "VERIFIED_EXACT"
    /// Same place and coordinates, but the official name differs in form (e.g. no direction marker). Not used at runtime.
    case verifiedByNameCoordinate = "VERIFIED_BY_NAME_COORDINATE"
    /// Evidence cannot single out this pole (e.g. a sibling pole with the same name nearby, or no coordinates to compare).
    case ambiguous = "AMBIGUOUS"
    /// The candidate id has no official station page, or the stop id does not have the expected form.
    case missing = "MISSING"
    /// The candidate id resolves to a different stop: the `JEB`-stripping assumption is wrong here.
    case conflict = "CONFLICT"

    /// Only an exact verification may drive a passenger-facing handoff.
    public var permitsRuntimeUse: Bool { self == .verifiedExact }
}

/// A 제주버스정보시스템 station id. Digits only, in the observed Jeju range, so it
/// can never carry a path or query fragment into a URL.
public struct JejuBISStationID: Hashable, Codable, Sendable, CustomStringConvertible {
    public let rawValue: String

    public init?(_ rawValue: String) {
        guard rawValue.count == 9, rawValue.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
              rawValue.hasPrefix("405") || rawValue.hasPrefix("406") else { return nil }
        self.rawValue = rawValue
    }

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        guard let value = JejuBISStationID(raw) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "not a Jeju BIS station id"))
        }
        self = value
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    public var description: String { rawValue }
}

public struct JejuStopCrosswalk: Codable, Hashable, Sendable {
    public static let schemaVersion = "tapso-jeju-stop-crosswalk-v1"
    /// How far the current catalog pole may sit from where it was verified.
    public static let coordinateTolerance = 30.0

    public struct Entry: Codable, Hashable, Sendable {
        public let tagoStopID: String
        public let bisStationID: JejuBISStationID
        public let status: StopCrosswalkStatus
        /// The catalog name at verification, direction marker included.
        public let name: String
        public let latitude: Double?
        public let longitude: Double?
        /// `YYYY-MM-DD` of the official page read.
        public let verifiedOn: String

        public init(tagoStopID: String, bisStationID: JejuBISStationID, status: StopCrosswalkStatus, name: String,
                    latitude: Double?, longitude: Double?, verifiedOn: String) {
            self.tagoStopID = tagoStopID
            self.bisStationID = bisStationID
            self.status = status
            self.name = name
            self.latitude = latitude
            self.longitude = longitude
            self.verifiedOn = verifiedOn
        }
    }

    public let schemaVersion: String
    /// The catalog version the audit read.
    public let catalogVersion: String
    public let generatedAt: String
    public let entries: [Entry]

    public init(schemaVersion: String = JejuStopCrosswalk.schemaVersion, catalogVersion: String, generatedAt: String, entries: [Entry]) {
        self.schemaVersion = schemaVersion
        self.catalogVersion = catalogVersion
        self.generatedAt = generatedAt
        self.entries = entries
    }

    /// No verified entries: no stop gets a station id. The shipped state until
    /// the audit has run against the official site and its result is reviewed.
    public static let empty = JejuStopCrosswalk(catalogVersion: "none", generatedAt: "none", entries: [])

    /// The verified station for this exact pole, or `nil`. Fails closed when the
    /// entry is not `VERIFIED_EXACT`, when the stop was renamed since, when it
    /// moved more than `coordinateTolerance`, when coordinates cannot be
    /// compared, or when the table holds two rows for one stop.
    public func verifiedStation(tagoStopID: String, name: String, coordinate: Coordinate?) -> JejuBISStationID? {
        let rows = entries.filter { $0.tagoStopID == tagoStopID }
        guard schemaVersion == Self.schemaVersion, rows.count == 1, let row = rows.first,
              row.status.permitsRuntimeUse, row.name == name,
              let latitude = row.latitude, let longitude = row.longitude, let coordinate,
              coordinate.distance(to: Coordinate(latitude: latitude, longitude: longitude)) <= Self.coordinateTolerance
        else { return nil }
        return row.bisStationID
    }
}
