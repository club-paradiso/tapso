import Foundation

// The rider's exact boarding pole on an exact route variant
// (`BOARDING_ANCHOR_POSITION_V2.md` §3). One value read by ride setup, the
// official accessibility boarding handoff, "내 근처", the hybrid engine's
// boarding rules and diagnostics, always derived from the catalog or the live
// stop list rather than stored separately, so it cannot drift from them.

public struct BoardingAnchor: Hashable, Sendable {
    public enum Provenance: String, Codable, Hashable, Sendable {
        /// From the on-device catalog (`TripOption`).
        case catalog
        /// From the live stop list the ride was set up on.
        case liveStopList
    }

    /// TAGO `nodeid`, e.g. `JEB405000315`.
    public let tagoStopID: String
    public let routeID: String
    public let routeNumber: String
    /// Provider sequence of the pole on this variant (a loop can pass a name twice; the sequence cannot).
    public let sequence: Int
    /// Provider name, direction marker included ("시청[동]").
    public let stopName: String
    /// `nil` when the coordinate is unknown or not surveyed.
    public let coordinate: Coordinate?
    /// Present only for a `VERIFIED_EXACT` crosswalk row matching this pole now.
    public let bisStation: JejuBISStationID?
    public let provenance: Provenance

    public init(tagoStopID: String, routeID: String, routeNumber: String, sequence: Int, stopName: String,
                coordinate: Coordinate?, provenance: Provenance, crosswalk: JejuStopCrosswalk) {
        self.tagoStopID = tagoStopID
        self.routeID = routeID
        self.routeNumber = routeNumber
        self.sequence = sequence
        self.stopName = stopName
        self.coordinate = coordinate.flatMap { RideMapMatcher.valid($0) ? $0 : nil }
        self.provenance = provenance
        bisStation = crosswalk.verifiedStation(tagoStopID: tagoStopID, name: stopName, coordinate: self.coordinate)
    }

    /// The name without its direction marker, as places are searched.
    public var placeName: String { DestinationSearchIndex.placeName(stopName) }

    /// "동", "서", "남" or "북" when the provider name carries one.
    public var directionMarker: String? {
        guard let open = stopName.lastIndex(of: "["), stopName.hasSuffix("]") else { return nil }
        let marker = String(stopName[stopName.index(after: open)..<stopName.index(before: stopName.endIndex)])
        return ["동", "서", "남", "북"].contains(marker) ? marker : nil
    }

    /// Diagnostics without identifiers: whether each anchor property is known.
    public var diagnosticSummary: String {
        "anchor provenance=\(provenance.rawValue) coordinate=\(coordinate == nil ? "none" : "surveyed") bis=\(bisStation == nil ? "unverified" : "verified")"
    }
}

extension TripOption {
    /// The boarding pole of this trip, from the catalog it was found in.
    public func boardingAnchor(in catalog: JejuTransitCatalog, crosswalk: JejuStopCrosswalk) -> BoardingAnchor {
        let stop = catalog.stops[route.stops[boardingPosition]]
        return BoardingAnchor(
            tagoStopID: boardingStopID, routeID: route.routeId, routeNumber: route.routeNo, sequence: boardingSequence,
            stopName: boardingName,
            coordinate: stop.lat.flatMap { lat in stop.lng.map { Coordinate(latitude: lat, longitude: $0) } },
            provenance: .catalog, crosswalk: crosswalk
        )
    }
}

/// The official 제주버스 "교통약자 승차예약" page for one station.
///
/// It is an accessibility boarding-support request the rider makes on the
/// official site, not a seat booking and not something TAPSO performs or can
/// confirm. TAPSO only opens the passenger-facing page; it never calls the
/// site's own data requests (`DATA_SOURCES.md`: no undocumented BIS endpoint
/// is a TAPSO product API). The route is carried for the card's copy only:
/// the page is station-scoped and the rider picks the route there.
public struct JejuAccessibilityBoardingHandoff: Hashable, Sendable {
    public static let host = "bus.jeju.go.kr"

    public let url: URL
    public let station: JejuBISStationID
    public let stopName: String
    public let routeNumber: String

    /// `nil` unless the anchor's station id is verified. No URL is ever built from an unverified id.
    public init?(anchor: BoardingAnchor) {
        guard let station = anchor.bisStation else { return nil }
        var components = URLComponents()
        components.scheme = "https"
        components.host = Self.host
        components.path = "/mobile/station/detailStation/\(station.rawValue)"
        components.queryItems = [URLQueryItem(name: "type", value: "station"), URLQueryItem(name: "mode", value: "ridebooking")]
        guard let url = components.url else { return nil }
        self.url = url
        self.station = station
        stopName = anchor.stopName
        routeNumber = anchor.routeNumber
    }
}
