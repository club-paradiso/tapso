import Foundation
import TapsoTransit
import XCTest
@testable import Tapso

/// A place shared from a map app, through the app: read on the device, collected
/// once from the share extension, never interrupting a ride, and the walk after
/// the bus handed back toward that place. Every payload is SYNTHETIC, in the
/// shapes `docs/product/MAP_HANDOFF_V3.md` documents; none contains a web link.
@MainActor
final class MapHandoffFlowTests: XCTestCase {
    private let kakaoText = "[카카오맵] 합성 카페\n제주특별자치도 제주시 합성로 12\n33.4996, 126.5312"

    func testPastedShareTextBecomesAPlaceReadOnTheDevice() throws {
        let model = makeModel()
        model.openMapImport()
        model.importSharedText(kakaoText)
        let place = try XCTUnwrap(model.sharedPlace)
        XCTAssertEqual(place.source, .kakaoMap)
        XCTAssertEqual(place.name, "합성 카페")
        XCTAssertEqual(place.address, "제주특별자치도 제주시 합성로 12")
        XCTAssertEqual(place.isInJeju, true)
        XCTAssertFalse(model.sharedPlaceUnreadable)
        XCTAssertEqual(model.handoffPlace, place, "the import screen is on the path")

        model.importSharedText("   ")
        XCTAssertNil(model.sharedPlace, "a new paste replaces the old place")
        XCTAssertTrue(model.sharedPlaceUnreadable)
    }

    func testAPlaceFromTheShareExtensionIsCollectedOnceAndOpensImport() throws {
        let model = makeModel()
        let inbox = try makeInbox()
        let place = SharedPlace(source: .naverMap, name: "합성 오름", coordinate: Coordinate(latitude: 33.45, longitude: 126.70))
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        inbox.put(place, at: now)

        model.collectHandoff(from: inbox, now: now.addingTimeInterval(30))
        XCTAssertEqual(model.sharedPlace, place)
        XCTAssertEqual(model.path, [.mapImport])

        model.path = []
        model.collectHandoff(from: inbox, now: now.addingTimeInterval(60))
        XCTAssertEqual(model.path, [], "the inbox hands a place over once")

        model.collectHandoff(from: nil, now: now)
        XCTAssertEqual(model.sharedPlace, place, "no App Group: nothing collected, nothing lost")
    }

    func testDuringARideASharedPlaceWaitsInsteadOfInterrupting() async throws {
        let model = makeModel()
        model.startDemo()
        await model.confirmVehicle(try XCTUnwrap(model.vehicleCheck.proposals.first))
        XCTAssertTrue(model.hasActiveRide)

        let place = SharedPlace(source: .appleMaps, name: "합성 해변", coordinate: Coordinate(latitude: 33.39, longitude: 126.24))
        model.receiveSharedPlace(place)
        XCTAssertEqual(model.path, [], "the ride keeps the screen")
        XCTAssertEqual(model.sharedPlace, place, "the place waits on Home's map card")
        XCTAssertNil(model.activeRide?.draft.finalPlace, "a ride already under way never changes destination")
        await model.cancelRide()
    }

    func testADemoRideFromASharedPlaceHandsTheWalkToThatPlace() async throws {
        let model = makeModel()
        model.openMapImport()
        model.importSharedText("[카카오맵] 제주시청(아라방면) 앞 합성 서점\n33.4996, 126.5312")
        let place = try XCTUnwrap(model.sharedPlace)
        let destinationName = try XCTUnwrap(model.stopNames(inSharedText: place.searchText).first)
        XCTAssertEqual(destinationName, "제주시청(아라방면)")

        let option = try XCTUnwrap(DemoCatalog.routeOptions(toDestinationNamed: destinationName).first)
        let boarding = try XCTUnwrap(option.boardingStops.first)
        model.chooseBoarding(boarding, routeID: option.route.id, destinationStopID: option.destination.id)
        XCTAssertEqual(model.draft?.finalPlace, place)
        XCTAssertEqual(model.draft?.journeySegments.map(\.kind), [.ride, .walk])
        let segments = try XCTUnwrap(model.draft?.journeySegments)
        XCTAssertEqual(JourneyContract.validate(segments), .success(JourneyShape(rideCount: 1, transferCount: 0)))

        try await waitUntil { model.vehicleCheck.stage == .proposed }
        await model.confirmVehicle(try XCTUnwrap(model.vehicleCheck.proposals.first))
        XCTAssertNil(model.sharedPlace, "the ride carries the place now; Home no longer offers it")
        XCTAssertEqual(model.activeRide?.draft.finalPlace, place)

        await model.finishRide()
        let outcome = try XCTUnwrap(model.outcome)
        XCTAssertEqual(outcome.place, place)
        // The place's coordinate came from the rider's map app, so the walk can go there even in
        // the demo, whose own stop coordinates are synthetic and never offered to KakaoMap.
        let kakao = try XCTUnwrap(model.mapRequest(for: .kakaoMap, outcome: outcome))
        XCTAssertEqual(kakao.urlString, "kakaomap://route?ep=33.499600,126.531200&by=FOOT")
        XCTAssertNil(model.mapRequest(for: .kakaoMap, to: outcome.destination))
        XCTAssertEqual(model.appleMapsTarget(for: outcome)?.coordinate, place.coordinate)
        XCTAssertEqual(model.appleMapsTarget(for: outcome)?.name, place.name)
    }

    func testAPlaceOutsideJejuOrOnlyALinkNeverReachesARide() async throws {
        let model = makeModel()
        model.openMapImport()
        model.importSharedText("[카카오맵] 제주시청(아라방면) 합성 지점\n37.5665, 126.9780")
        XCTAssertEqual(model.sharedPlace?.isInJeju, false)

        let option = try XCTUnwrap(DemoCatalog.routeOptions(toDestinationNamed: "제주시청(아라방면)").first)
        model.chooseBoarding(try XCTUnwrap(option.boardingStops.first), routeID: option.route.id, destinationStopID: option.destination.id)
        XCTAssertNil(model.draft?.finalPlace, "TAPSO is Jeju-only: a place outside Jeju is never a destination")
        XCTAssertEqual(model.draft?.journeySegments.map(\.kind), [.ride])
        model.cancelSetup()

        let link = SharedPlace(source: .naverMap, unresolvedLink: "nmap://place?id=SynThetic")
        XCTAssertTrue(link.isLinkOnly)
        XCTAssertNil(MapHandoff.walkingRequest(to: link, in: .naverMap))
    }

    func testANewSetupFromHomeNeverInheritsTheSharedPlace() throws {
        let model = makeModel()
        model.openMapImport()
        model.importSharedText(kakaoText)
        model.openSearch()
        XCTAssertNil(model.handoffPlace, "only a setup that starts from the import screen uses the place")
        XCTAssertNotNil(model.sharedPlace, "it still waits on Home")

        let option = try XCTUnwrap(DemoCatalog.routeOptions(toDestinationNamed: "제주시청(아라방면)").first)
        model.chooseBoarding(try XCTUnwrap(option.boardingStops.first), routeID: option.route.id, destinationStopID: option.destination.id)
        XCTAssertNil(model.draft?.finalPlace)
        model.cancelSetup()

        model.dismissSharedPlace()
        XCTAssertNil(model.sharedPlace)
    }

    func testPastTheStopTheDemoNamesTheNextStopAndMeasuresNothingSynthetic() async throws {
        let model = makeModel()
        model.scenario = .passedDestination
        model.startDemo()
        await model.confirmVehicle(try XCTUnwrap(model.vehicleCheck.proposals.first))
        XCTAssertNil(model.passedStopAdvice, "no rescue while the ride is on course")
        await advanceUntilPassed(model)
        XCTAssertEqual(model.guidance?.moment, .passedDestination)

        let advice = try XCTUnwrap(model.passedStopAdvice)
        // The demo's bus is next seen at the end of the line, where everyone gets off.
        XCTAssertEqual(advice.exitStop?.stop.name, "국립제주박물관")
        XCTAssertEqual(model.contentState()?.nextStopName, "국립제주박물관", "the Lock Screen names the exit, not a stop before the destination")
        XCTAssertNil(advice.straightLineMeters, "demo coordinates are synthetic: no walk is measured")
        XCTAssertEqual(advice.plan.options.map(\.action), [.openMapApp])
        XCTAssertNil(model.rescueMapRequest(for: .kakaoMap), "KakaoMap gets a real coordinate or nothing")
        XCTAssertNotNil(model.rescueMapRequest(for: .naverMap), "NAVER Map can still search the stop by name")
        await model.cancelRide()
    }

    func testPastTheStopTheWayBackGoesTowardTheSharedPlace() async throws {
        let model = makeModel()
        model.openMapImport()
        model.importSharedText("[카카오맵] 제주시청(아라방면) 앞 합성 서점\n33.4996, 126.5312")
        let place = try XCTUnwrap(model.sharedPlace)
        let option = try XCTUnwrap(DemoCatalog.routeOptions(toDestinationNamed: "제주시청(아라방면)").first)
        model.scenario = .passedDestination
        model.chooseBoarding(try XCTUnwrap(option.boardingStops.first), routeID: option.route.id, destinationStopID: option.destination.id)
        try await waitUntil { model.vehicleCheck.stage == .proposed }
        await model.confirmVehicle(try XCTUnwrap(model.vehicleCheck.proposals.first))
        XCTAssertEqual(model.activeRide?.draft.finalPlace, place)
        await advanceUntilPassed(model)
        XCTAssertEqual(model.guidance?.moment, .passedDestination)

        // The place's coordinate came from the rider's map app; the stops' are synthetic.
        let kakao = try XCTUnwrap(model.rescueMapRequest(for: .kakaoMap))
        XCTAssertEqual(kakao.urlString, "kakaomap://route?ep=33.499600,126.531200&by=FOOT")
        XCTAssertNil(model.passedStopAdvice?.straightLineMeters, "the walk back to the stop is still unmeasured")
        await model.cancelRide()
    }

    // MARK: Helpers

    private func makeModel() -> TapsoAppModel {
        let model = TapsoAppModel(
            store: JourneyStore(defaults: UserDefaults(suiteName: "tapso.tests.\(UUID().uuidString)")!),
            liveActivity: nil
        )
        model.speed = .manual
        return model
    }

    private func advanceUntilPassed(_ model: TapsoAppModel) async {
        while model.guidance?.moment != .passedDestination, model.canAdvanceDemo {
            await model.advanceDemo()
        }
    }

    private func makeInbox() throws -> HandoffInbox {
        HandoffInbox(defaults: try XCTUnwrap(UserDefaults(suiteName: "tapso.tests.handoff.\(UUID().uuidString)")))
    }

    private func waitUntil(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTFail("condition not met within 5 s", file: file, line: line)
    }
}
