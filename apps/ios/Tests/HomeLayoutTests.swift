import TapsoTransit
import XCTest
@testable import Tapso

/// Home is destination-first for every rider; a repeat ride stays one tap
/// (`LIVE_RIDE_RELIABILITY_HOME_V3.md` §10).
final class HomeLayoutTests: XCTestCase {
    private func journey(_ route: String, _ destination: String) -> SavedJourney {
        SavedJourney(
            routeID: RouteID(rawValue: "SYN-\(route)"),
            routeNumber: route,
            headsign: "합성 종점",
            boardingStopID: StopID(rawValue: "SYN-B"),
            boardingStopName: "합성 정류장",
            destinationStopID: StopID(rawValue: "SYN-\(destination)"),
            destinationStopName: destination,
            lastRiddenAt: Date(timeIntervalSince1970: 0)
        )
    }

    func testAFirstRideExplainsThenSearches() {
        let sections = HomeLayout.sections(for: JourneyLibrary(), showsDemo: false)
        XCTAssertEqual(sections.first, .intro, "the intro card carries the search field")
        XCTAssertFalse(sections.contains(.rideAgain))
        XCTAssertFalse(sections.contains(.sample), "no sample ride in a release build")
        XCTAssertEqual(sections.last, .privacy)
    }

    func testAReturningRiderIsAskedWhereTheyAreGettingOffFirst() throws {
        var library = JourneyLibrary()
        library.recordRide(journey("365", "합성 도착 A"), at: Date(timeIntervalSince1970: 100))
        let sections = HomeLayout.sections(for: library, showsDemo: true)
        XCTAssertEqual(sections.first, .destination, "destination search is the primary action, above the fold")
        let destination = try XCTUnwrap(sections.firstIndex(of: .destination))
        let rideAgain = try XCTUnwrap(sections.firstIndex(of: .rideAgain))
        let otherWays = try XCTUnwrap(sections.firstIndex(of: .otherWays))
        XCTAssertLessThan(destination, rideAgain, "the last ride is a shortcut below the question")
        XCTAssertLessThan(rideAgain, otherWays)
        XCTAssertFalse(sections.contains(.sample), "a returning rider never sees the sample")
    }

    func testTheLastRideLeadsTheRideAgainRowsAndIsNotRepeated() {
        let a = journey("365", "합성 도착 A")
        let b = journey("202", "합성 도착 B")
        let c = journey("315", "합성 도착 C")
        var library = JourneyLibrary()
        library.recordRide(b, at: Date(timeIntervalSince1970: 100))
        library.recordRide(c, at: Date(timeIntervalSince1970: 150))
        library.recordRide(a, at: Date(timeIntervalSince1970: 200))
        _ = library.toggleFavorite(id: a.id)
        _ = library.toggleFavorite(id: b.id)
        let rows = HomeLayout.rideAgainJourneys(in: library)
        XCTAssertEqual(rows.first?.id, a.id, "the latest ride first")
        XCTAssertEqual(rows.map(\.id), [a.id, b.id], "favourites follow, the latest not twice; a plain older ride is not listed")
    }

    func testManyFavouritesDoNotPushTheSearchDown() {
        var library = JourneyLibrary()
        for index in 0..<12 {
            let saved = journey("\(100 + index)", "합성 도착 \(index)")
            library.recordRide(saved, at: Date(timeIntervalSince1970: Double(index)))
            _ = library.toggleFavorite(id: saved.id)
        }
        XCTAssertEqual(HomeLayout.sections(for: library, showsDemo: false).first, .destination)
    }

    @MainActor
    func testRepeatingTheLastRideIsStillOneTapToTheBusCheck() async throws {
        let model = TapsoAppModel(store: JourneyStore(defaults: UserDefaults(suiteName: "tapso.tests.\(UUID().uuidString)")!), liveActivity: nil)
        model.speed = .manual
        model.startDemo()
        await model.confirmVehicle(try XCTUnwrap(model.vehicleCheck.proposals.first))
        await model.finishRide()
        model.dismissOutcome()
        let latest = try XCTUnwrap(HomeLayout.rideAgainJourneys(in: model.library).first)
        model.rideAgain(latest)
        XCTAssertEqual(model.path, [.vehicleCheck])
    }
}
