import Foundation
import XCTest
@testable import TapsoTransit

/// SYNTHETIC catalog and crosswalk rows. The ids follow TAGO's and Jeju BIS's
/// shapes so the rules can be exercised; none is a claim that a stop exists or
/// that any mapping was verified.
final class BoardingAnchorTests: XCTestCase {
    let east = Coordinate(latitude: 33.4996, longitude: 126.5312)
    let west = Coordinate(latitude: 33.4997, longitude: 126.5309)

    func entry(_ tago: String, _ bis: String, _ status: StopCrosswalkStatus = .verifiedExact, name: String = "시청[동]",
               at coordinate: Coordinate? = Coordinate(latitude: 33.4996, longitude: 126.5312)) -> JejuStopCrosswalk.Entry {
        JejuStopCrosswalk.Entry(tagoStopID: tago, bisStationID: JejuBISStationID(bis)!, status: status, name: name,
                                latitude: coordinate?.latitude, longitude: coordinate?.longitude, verifiedOn: "2026-10-06")
    }

    func crosswalk(_ entries: [JejuStopCrosswalk.Entry]) -> JejuStopCrosswalk {
        JejuStopCrosswalk(catalogVersion: "synthetic", generatedAt: "2026-10-06T00:00:00Z", entries: entries)
    }

    func anchor(_ table: JejuStopCrosswalk, id: String = "JEB405000315", name: String = "시청[동]", at coordinate: Coordinate? = Coordinate(latitude: 33.4996, longitude: 126.5312)) -> BoardingAnchor {
        BoardingAnchor(tagoStopID: id, routeID: "JEB405999901", routeNumber: "999", sequence: 7, stopName: name,
                       coordinate: coordinate, provenance: .liveStopList, crosswalk: table)
    }

    // MARK: crosswalk

    func testExactVerifiedMappingYieldsTheStation() {
        let value = anchor(crosswalk([entry("JEB405000315", "405000315")]))
        XCTAssertEqual(value.bisStation?.rawValue, "405000315")
    }

    func testMissingMappingYieldsNothing() {
        XCTAssertNil(anchor(.empty).bisStation, "the shipped table is empty until the audit runs")
        XCTAssertNil(anchor(crosswalk([entry("JEB405000999", "405000999")])).bisStation)
    }

    func testOnlyExactVerificationIsUsedAtRuntime() {
        for status in StopCrosswalkStatus.allCases where status != .verifiedExact {
            XCTAssertNil(anchor(crosswalk([entry("JEB405000315", "405000315", status)])).bisStation, status.rawValue)
            XCTAssertFalse(status.permitsRuntimeUse)
        }
    }

    func testRenamedStopFailsClosed() {
        let table = crosswalk([entry("JEB405000315", "405000315", name: "시청[동]")])
        XCTAssertNil(anchor(table, name: "제주시청[동]").bisStation)
    }

    func testMovedStopFailsClosed() {
        let table = crosswalk([entry("JEB405000315", "405000315")])
        XCTAssertNil(anchor(table, at: Coordinate(latitude: 33.5005, longitude: 126.5312)).bisStation, "~100 m away")
        XCTAssertNil(anchor(table, at: nil).bisStation, "no coordinate to compare")
        let unlocated = crosswalk([entry("JEB405000315", "405000315", at: nil)])
        XCTAssertNil(anchor(unlocated).bisStation)
    }

    func testOppositeSidePoleNeverBorrowsItsSiblingsStation() {
        // Two poles, one name, opposite sides of the road. Only the east pole was verified.
        let table = crosswalk([entry("JEB405000315", "405000315", name: "시청[동]", at: east)])
        let westPole = anchor(table, id: "JEB405000316", name: "시청[서]", at: west)
        XCTAssertNil(westPole.bisStation)
        XCTAssertEqual(westPole.placeName, "시청")
        XCTAssertEqual(westPole.directionMarker, "서")
    }

    func testDuplicateRowsForOneStopFailClosed() {
        let table = crosswalk([entry("JEB405000315", "405000315"), entry("JEB405000315", "405000316")])
        XCTAssertNil(anchor(table).bisStation)
    }

    func testStrippingJEBIsNotAssumed() {
        // A table row may verify a station id that is NOT the stripped TAGO id (the audit found it so);
        // and a stop with no row gets nothing even though its stripped form looks valid.
        let table = crosswalk([entry("JEB405000315", "405000777")])
        XCTAssertEqual(anchor(table).bisStation?.rawValue, "405000777")
        XCTAssertNil(anchor(table, id: "JEB405000316", name: "시청[서]", at: west).bisStation)
    }

    func testStationIDsAreDigitsInTheJejuRangeOnly() {
        XCTAssertNotNil(JejuBISStationID("405000315"))
        XCTAssertNotNil(JejuBISStationID("406002178"))
        for invalid in ["JEB405000315", "40500031", "4050003150", "305000315", "40500031a", "405000315/..", "405000315?x=1", "４０５０００３１５", ""] {
            XCTAssertNil(JejuBISStationID(invalid), invalid)
        }
    }

    func testCrosswalkRejectsAMalformedStationIdOnDecode() {
        let json = #"{"schemaVersion":"tapso-jeju-stop-crosswalk-v1","catalogVersion":"x","generatedAt":"x","entries":[{"tagoStopID":"JEB405000315","bisStationID":"405000315/../x","status":"VERIFIED_EXACT","name":"시청[동]","latitude":33.4996,"longitude":126.5312,"verifiedOn":"2026-10-06"}]}"#
        XCTAssertThrowsError(try JSONDecoder().decode(JejuStopCrosswalk.self, from: Data(json.utf8)))
    }

    func testUnknownSchemaVersionFailsClosed() {
        let table = JejuStopCrosswalk(schemaVersion: "v0", catalogVersion: "x", generatedAt: "x", entries: [entry("JEB405000315", "405000315")])
        XCTAssertNil(anchor(table).bisStation)
    }

    // MARK: reservation handoff

    func testVerifiedStopGeneratesTheOfficialPassengerURL() throws {
        let handoff = try XCTUnwrap(JejuAccessibilityBoardingHandoff(anchor: anchor(crosswalk([entry("JEB405000315", "405000315")]))))
        XCTAssertEqual(handoff.url.absoluteString, "https://bus.jeju.go.kr/mobile/station/detailStation/405000315?type=station&mode=ridebooking")
        XCTAssertEqual(handoff.url.host, "bus.jeju.go.kr")
        XCTAssertEqual(handoff.url.scheme, "https")
        XCTAssertEqual(handoff.stopName, "시청[동]")
        XCTAssertEqual(handoff.routeNumber, "999")
        XCTAssertEqual(handoff.station.rawValue, "405000315")
    }

    func testUnverifiedMappingProducesNoHandoff() {
        XCTAssertNil(JejuAccessibilityBoardingHandoff(anchor: anchor(.empty)))
        XCTAssertNil(JejuAccessibilityBoardingHandoff(anchor: anchor(crosswalk([entry("JEB405000315", "405000315", .ambiguous)]))))
    }

    func testHandoffNeverCallsAnUndocumentedDataEndpoint() throws {
        let handoff = try XCTUnwrap(JejuAccessibilityBoardingHandoff(anchor: anchor(crosswalk([entry("JEB405000315", "405000315")]))))
        XCTAssertTrue(handoff.url.path.hasPrefix("/mobile/station/detailStation/"))
        XCTAssertFalse(handoff.url.absoluteString.contains("reservation"))
        XCTAssertFalse(handoff.url.absoluteString.contains("/data/"))
    }

    // MARK: anchor from the catalog

    func testTripOptionAnchorCarriesTheExactPoleAndVariant() throws {
        let catalog = JejuTransitCatalog(catalogVersion: "synthetic", generatedAt: "2026-10-06", stops: [
            .init(id: "JEB405000100", name: "출발", lat: 33.49, lng: 126.52),
            .init(id: "JEB405000315", name: "시청[동]", lat: east.latitude, lng: east.longitude),
            .init(id: "JEB405000316", name: "시청[서]", lat: west.latitude, lng: west.longitude),
            .init(id: "JEB405000400", name: "도착", lat: 33.51, lng: 126.54),
        ], routes: [
            .init(routeId: "JEB405999901", routeNo: "999", stops: [0, 1, 3]),
            .init(routeId: "JEB405999902", routeNo: "999", stops: [3, 2, 0]),
        ])
        let index = DestinationSearchIndex(catalog: catalog)
        let destination = try XCTUnwrap(index.search("도착").first)
        let place = try XCTUnwrap(index.boardingPlaces(toward: destination).first { $0.name == "시청" })
        let trip = try XCTUnwrap(index.trips(from: place, to: destination).first)
        let value = trip.boardingAnchor(in: catalog, crosswalk: crosswalk([entry("JEB405000315", "405000315", at: east)]))
        XCTAssertEqual(value.tagoStopID, "JEB405000315", "the east pole: the only one this variant serves toward the destination")
        XCTAssertEqual(value.routeID, "JEB405999901")
        XCTAssertEqual(value.sequence, 2)
        XCTAssertEqual(value.provenance, .catalog)
        XCTAssertEqual(value.bisStation?.rawValue, "405000315")
        XCTAssertFalse(value.diagnosticSummary.contains("JEB"), "diagnostics carry no identifiers")
    }
}
