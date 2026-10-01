import XCTest
@testable import TapsoTransit

final class RideSetupTests: XCTestCase {
    private let now = DemoFixtures.referenceDate

    // MARK: Vehicle check

    func testTwoBusesAreAlwaysARiderQuestionNeverAPick() {
        let proposals = DemoCatalog.proposals(for: .similarBuses, route: DemoCatalog.outbound)
        let check = VehicleCheck.evaluate(proposals: proposals.reversed(), hasSearched: true)
        XCTAssertEqual(check.stage, .similarBuses)
        XCTAssertEqual(check.proposals.map(\.stopsAway), [0, 1], "nearest bus first")
    }

    func testOneBusIsProposedNotSelected() {
        let check = VehicleCheck.evaluate(
            proposals: DemoCatalog.proposals(for: .smooth, route: DemoCatalog.outbound),
            hasSearched: true
        )
        XCTAssertEqual(check.stage, .proposed)
        XCTAssertEqual(check.headlineKey, "check.proposed.headline")
    }

    func testNoBusIsSearchingThenNotFoundYet() {
        XCTAssertEqual(VehicleCheck.evaluate(proposals: [], hasSearched: false).stage, .searching)
        XCTAssertEqual(VehicleCheck.evaluate(proposals: [], hasSearched: true).stage, .notFoundYet)
    }

    func testConfirmationKeepsOnlyTheRidersBus() {
        let proposals = DemoCatalog.proposals(for: .similarBuses, route: DemoCatalog.outbound)
        let check = VehicleCheck.evaluate(proposals: proposals, hasSearched: true, confirmed: proposals[1].vehicleID)
        XCTAssertEqual(check.stage, .confirmed)
        XCTAssertEqual(check.proposals, [proposals[1]])
    }

    func testConfirmingABusThatWasNotProposedConfirmsNothing() {
        let proposals = DemoCatalog.proposals(for: .smooth, route: DemoCatalog.outbound)
        XCTAssertEqual(VehicleCheck.evaluate(proposals: proposals, hasSearched: true, confirmed: "other").stage, .proposed)
    }

    func testPlatesAreMaskedToTheLastFourDigits() {
        XCTAssertEqual(VehiclePlate.masked("제주70자1234"), "••1234")
        XCTAssertEqual(VehiclePlate.masked("demo-bus"), "••••")
        XCTAssertTrue(DemoCatalog.proposals(for: .smooth, route: DemoCatalog.outbound).allSatisfy { $0.maskedPlate.hasPrefix("••") })
    }

    // MARK: Destination-first catalogue

    func testSearchIgnoresSpacingAndMiddleDots() {
        XCTAssertEqual(DemoCatalog.searchDestinations("출입국 외국인청"), ["제주시청(아라방면)"])
        XCTAssertEqual(DemoCatalog.searchDestinations("박물관"), ["국립제주박물관"])
        XCTAssertTrue(DemoCatalog.searchDestinations("   ").isEmpty)
    }

    func testPrefixMatchesRankFirst() {
        let results = DemoCatalog.searchDestinations("제주")
        XCTAssertEqual(results.first.map { StopNameMatcher.normalized($0).hasPrefix("제주") }, true)
    }

    func testDestinationResolvesToRouteDirectionsThatReachIt() {
        let options = DemoCatalog.routeOptions(toDestinationNamed: "관덕정")
        XCTAssertEqual(Set(options.map(\.route.id)), [DemoCatalog.outbound.id, DemoCatalog.inbound.id])
        for option in options {
            let destination = option.route.routeStop(id: option.destination.id)!.sequence
            XCTAssertTrue(option.boardingStops.allSatisfy { option.route.routeStop(id: $0.id)!.sequence < destination })
        }
    }

    func testFirstStopOfADirectionCannotBeItsDestination() {
        let options = DemoCatalog.routeOptions(toDestinationNamed: "제주버스터미널")
        XCTAssertEqual(options.map(\.route.id), [DemoCatalog.inbound.id])
    }

    // MARK: Demo scripts

    func testSmoothScriptWalksEveryActionMomentInOrder() {
        let moments = playMoments(scenario: .smooth)
        XCTAssertEqual(Array(moments.suffix(3)), [.prepare, .nextStop, .arrived])
        XCTAssertTrue(moments.dropLast(3).allSatisfy { $0 == .riding })
    }

    func testDelayedScriptGoesQuietThenRecovers() {
        let moments = playMoments(scenario: .delayedData)
        XCTAssertTrue(moments.contains(.delayed))
        XCTAssertEqual(moments.last, .arrived)
    }

    func testLostScriptKeepsTrackingAndRecovers() {
        let moments = playMoments(scenario: .vehicleLost)
        XCTAssertTrue(moments.contains(.vehicleLost))
        XCTAssertEqual(moments.last, .arrived)
    }

    func testOfflineScriptShowsOfflineWithoutAlerts() {
        let moments = playMoments(scenario: .offline)
        XCTAssertTrue(moments.contains(.offline))
        XCTAssertEqual(moments.last, .arrived)
    }

    func testPassedScriptEndsInPassedDestinationWithoutArrivalAlert() {
        let moments = playMoments(scenario: .passedDestination)
        XCTAssertEqual(moments.last, .passedDestination)
        XCTAssertFalse(moments.contains(.arrived))
    }

    func testScriptOnInvalidOrderIsEmpty() {
        XCTAssertTrue(DemoRideScript.beats(
            route: DemoCatalog.outbound, boarding: "demo-stop-5", destination: "demo-stop-2", scenario: .smooth
        ).isEmpty)
    }

    /// Plays a script through `RideSession`, the same path a real observation takes.
    private func playMoments(scenario: DemoRideScenario) -> [RideMoment] {
        let route = DemoCatalog.outbound
        let plan = DemoFixtures.plan
        let vehicle: VehicleIdentifier = "demo-bus-365-A"
        var session = RideSession(plan: plan, startedAt: now, matchedVehicleID: vehicle, state: .active)
        var clock = now
        var offline = false
        var moments: [RideMoment] = []
        for beat in DemoRideScript.beats(route: route, boarding: plan.boardingStopID, destination: plan.destinationStopID, scenario: scenario) {
            var freshness: DataFreshness?
            switch beat {
            case let .observe(sequence):
                clock = clock.addingTimeInterval(20)
                let observation = DemoCatalog.observation(route: route, vehicleID: vehicle, stopSequence: sequence, at: clock)!
                XCTAssertEqual(session.apply(observation: observation, route: route, now: clock).isApplied, true)
            case let .silence(seconds):
                clock = clock.addingTimeInterval(seconds)
                freshness = FreshnessPolicy.conservativeDefault.classify(observedAt: session.latestObservation?.timestamp, relativeTo: clock)
            case .vehicleMissing:
                session.markVehicleLost()
            case let .connectivity(online):
                offline = !online
            }
            moments.append(RideGuidancePolicy.moment(for: RideSignal(session: session, freshness: freshness, isOffline: offline)))
        }
        return moments
    }

    // MARK: Library

    func testRecordingTheSameRideTwiceIsOneEntryCountedTwice() {
        var library = JourneyLibrary()
        let journey = sampleJourney(destination: 8)
        library.recordRide(journey, at: now)
        library.recordRide(journey, at: now.addingTimeInterval(60))
        XCTAssertEqual(library.journeys.count, 1)
        XCTAssertEqual(library.journeys[0].rideCount, 2)
        XCTAssertEqual(library.lastRide?.lastRiddenAt, now.addingTimeInterval(60))
    }

    func testRecentsAreNewestFirstAndCapped() {
        var library = JourneyLibrary()
        for index in 1...5 {
            library.recordRide(sampleJourney(destination: index), at: now.addingTimeInterval(Double(index)))
        }
        XCTAssertEqual(library.recents.count, JourneyLibrary.recentLimit)
        XCTAssertEqual(library.recents.first?.destinationStopID, "demo-stop-5")
        XCTAssertEqual(library.recentDestinationNames.first, DemoCatalog.outbound.stops[5].stop.name)
    }

    func testFavoritesSurviveHistoryTrimming() {
        var library = JourneyLibrary()
        let favorite = sampleJourney(destination: 1)
        library.recordRide(favorite, at: now)
        XCTAssertTrue(library.toggleFavorite(id: favorite.id))
        for index in 0..<(JourneyLibrary.historyLimit + 3) {
            var other = sampleJourney(destination: 2 + index % 7)
            other = SavedJourney(
                routeID: other.routeID, routeNumber: other.routeNumber, headsign: other.headsign,
                boardingStopID: StopID(rawValue: "synthetic-boarding-\(index)"), boardingStopName: "합성 \(index)",
                destinationStopID: other.destinationStopID, destinationStopName: other.destinationStopName,
                lastRiddenAt: now
            )
            library.recordRide(other, at: now.addingTimeInterval(Double(index + 1)))
        }
        XCTAssertNotNil(library.journey(id: favorite.id))
        XCTAssertEqual(library.favorites.map(\.id), [favorite.id])
        XCTAssertEqual(library.journeys.filter { !$0.isFavorite }.count, JourneyLibrary.historyLimit)

        // Un-favouriting the oldest journey with history full forgets it; the result is read before trimming.
        XCTAssertFalse(library.toggleFavorite(id: favorite.id))
        XCTAssertNil(library.journey(id: favorite.id))
        XCTAssertEqual(library.journeys.count, JourneyLibrary.historyLimit)
    }

    func testLibraryRoundTripsThroughJSON() throws {
        var library = JourneyLibrary()
        library.recordRide(sampleJourney(destination: 8), at: now)
        let data = try JSONEncoder().encode(library)
        XCTAssertEqual(try JSONDecoder().decode(JourneyLibrary.self, from: data), library)
    }

    private func sampleJourney(destination: Int) -> SavedJourney {
        let route = DemoCatalog.outbound
        return SavedJourney(route: route, boarding: route.stops[0].stop, destination: route.stops[destination].stop, at: now)
    }

    // MARK: Map hand-off

    func testSharedTextFindsTheMostSpecificStopName() {
        let shared = "[카카오맵] 제주시청(아라방면)\n제주특별자치도 제주시 ...\nkko.to/abc"
        XCTAssertEqual(StopNameMatcher.matches(in: shared, among: DemoCatalog.destinationNames).first, "제주시청(아라방면)")
    }

    func testALinkAloneFindsNothing() {
        XCTAssertTrue(StopNameMatcher.matches(in: "naver.me/xYz12", among: DemoCatalog.destinationNames).isEmpty)
    }

    func testSyntheticStopsGetANameSearchNeverAWalkingRoute() throws {
        let stop = DemoCatalog.outbound.stops[8].stop
        let naver = try XCTUnwrap(MapHandoff.walkingRequest(to: stop, in: .naverMap, coordinatesAreSurveyed: false))
        let components = try XCTUnwrap(URLComponents(string: naver.urlString))
        XCTAssertEqual(components.scheme, "nmap")
        XCTAssertEqual(components.host, "search")
        XCTAssertEqual(components.queryItems?.first { $0.name == "query" }?.value, stop.name)
        XCTAssertEqual(components.queryItems?.first { $0.name == "appname" }?.value, MapHandoff.appName)
        XCTAssertNil(MapHandoff.walkingRequest(to: stop, in: .kakaoMap, coordinatesAreSurveyed: false))
    }

    func testSurveyedStopsGetADocumentedWalkingRoute() throws {
        let stop = Stop(id: "surveyed", name: "정류장", coordinate: Coordinate(latitude: 33.5, longitude: 126.5))
        let naver = try XCTUnwrap(URLComponents(string: MapHandoff.walkingRequest(to: stop, in: .naverMap, coordinatesAreSurveyed: true)!.urlString))
        XCTAssertEqual(naver.host, "route")
        XCTAssertEqual(naver.path, "/walk")
        XCTAssertEqual(naver.queryItems?.first { $0.name == "dlat" }?.value, "33.500000")
        let kakao = try XCTUnwrap(URLComponents(string: MapHandoff.walkingRequest(to: stop, in: .kakaoMap, coordinatesAreSurveyed: true)!.urlString))
        XCTAssertEqual(kakao.scheme, "kakaomap")
        XCTAssertEqual(kakao.queryItems?.first { $0.name == "by" }?.value, "FOOT")
    }
}

private extension RideSessionUpdate {
    var isApplied: Bool {
        if case .applied = self { return true }
        return false
    }
}
