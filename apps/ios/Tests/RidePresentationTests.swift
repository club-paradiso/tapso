import XCTest
import TapsoTransit
@testable import Tapso

/// Product V2: one ride model behind the app, Lock Screen and Dynamic Island.
@MainActor
final class RidePresentationTests: XCTestCase {
    // MARK: Localization

    func testEveryGuidanceAndCheckKeyIsTranslatedInKoreanAndEnglish() throws {
        let keys = RideGuidancePolicy.allCopyKeys
            + VehicleCheck.allCopyKeys
            + [RideMilestone.prepare, .nextStop, .arrived].flatMap { ["alert.\($0.rawValue).title", "alert.\($0.rawValue).body"] }
        for language in ["ko", "en"] {
            let path = try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj"), "\(language).lproj is bundled")
            let bundle = try XCTUnwrap(Bundle(path: path))
            for key in keys {
                let value = bundle.localizedString(forKey: key, value: "\u{0}", table: nil)
                XCTAssertNotEqual(value, "\u{0}", "\(language) is missing \(key)")
                XCTAssertFalse(value.isEmpty, "\(language) \(key) is empty")
            }
        }
    }

    func testCopyNeverShowsEngineeringLanguage() throws {
        let banned = ["READY_", "CA-", "BA-", "matcher", "directed-route", "confidence", "%)", "확신", "매칭"]
        for language in ["ko", "en"] {
            let path = try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj"))
            let bundle = try XCTUnwrap(Bundle(path: path))
            for key in RideGuidancePolicy.allCopyKeys + VehicleCheck.allCopyKeys {
                let value = bundle.localizedString(forKey: key, value: nil, table: nil)
                for word in banned {
                    XCTAssertFalse(value.localizedCaseInsensitiveContains(word), "\(language) \(key): \(value)")
                }
            }
        }
    }

    // MARK: One truth for every surface

    func testContentStateCarriesTheSameGuidanceAsTheApp() {
        let state = makeState(.arrived, 0, passed: true)
        XCTAssertEqual(state.guidance.moment, .passedDestination)
        XCTAssertEqual(TapsoLiveActivityPolicy.displayPhase(for: state), .passedDestination)
        XCTAssertNil(TapsoLiveActivityPolicy.milestone(for: state), "passing the stop is not an arrival alert")
    }

    func testOfflineAndLostAreDistinctQuietStatesOnTheIsland() {
        let offline = makeState(.active, 4, offline: true)
        let lost = makeState(.vehicleTemporarilyLost, 4)
        XCTAssertEqual(TapsoLiveActivityPolicy.displayPhase(for: offline), .offline)
        XCTAssertEqual(TapsoLiveActivityPolicy.displayPhase(for: lost), .vehicleLost)
        XCTAssertNil(TapsoLiveActivityPolicy.milestone(for: offline))
        XCTAssertNil(TapsoLiveActivityPolicy.milestone(for: lost))
        XCTAssertNotNil(TapsoLiveActivityPolicy.staleDate(for: lost))
    }

    func testAStaleActivityNeverShowsAFreshMilestone() {
        let next = makeState(.nextStopIsDestination, 1)
        XCTAssertEqual(guidanceAccountingForStaleness(next, isStale: false).moment, .nextStop)
        XCTAssertEqual(guidanceAccountingForStaleness(next, isStale: true).moment, .delayed)
        XCTAssertNil(guidanceAccountingForStaleness(next, isStale: true).milestone)
    }

    func testPayloadWithVehicleAndNewFieldsStaysUnderActivityKitLimit() throws {
        struct Payload: Encodable {
            let attributes: TapsoActivityAttributes
            let state: TapsoActivityAttributes.ContentState
        }
        let payload = Payload(
            attributes: TapsoActivityAttributes(
                routeNumber: "365",
                routeID: "demo-route-365-outbound",
                boardingStopName: "제주버스터미널",
                destinationName: "제주출입국·외국인청",
                totalStops: 8,
                vehiclePlate: "••0001"
            ),
            state: makeState(.nextStopIsDestination, 1, passed: false, offline: false)
        )
        XCTAssertLessThan(try JSONEncoder().encode(payload).count, 4_096)
    }

    func testOlderPayloadWithoutV2FieldsStillDecodes() throws {
        let legacy = #"{"phase":"active","currentStopName":"관덕정","nextStopName":"중앙로","remainingStops":4,"freshness":"fresh","updatedAt":0}"#
        let state = try JSONDecoder().decode(TapsoActivityAttributes.ContentState.self, from: Data(legacy.utf8))
        XCTAssertNil(state.destinationPassed)
        XCTAssertEqual(state.guidance.moment, .riding)
    }

    // MARK: Model flow

    func testSampleRideProposesAndWaitsForTheRidersConfirmation() {
        let model = makeModel()
        model.startDemo()
        XCTAssertEqual(model.path, [.vehicleCheck])
        XCTAssertEqual(model.vehicleCheck.stage, .proposed)
        XCTAssertFalse(model.hasActiveRide, "no bus is selected without the rider")
    }

    func testDestinationFirstSkipsTheRouteStepWhenOnlyOneDirectionReachesIt() {
        let model = makeModel()
        model.openSearch()
        model.chooseDestination(named: "제주버스터미널")
        guard case .boarding = model.path.last else {
            return XCTFail("one route direction: straight to the boarding stop, got \(model.path)")
        }
    }

    func testDestinationFirstAsksForTheRouteWhenTwoDirectionsReachIt() {
        let model = makeModel()
        model.openSearch()
        model.chooseDestination(named: "관덕정")
        XCTAssertEqual(model.path.last, .routes(destinationName: "관덕정"))
    }

    func testConfirmedRideWalksToArrivalAndIsRememberedForOneTapRepeat() async {
        let model = makeModel()
        model.startDemo()
        let proposal = try! XCTUnwrap(model.vehicleCheck.proposals.first)
        await model.confirmVehicle(proposal)
        XCTAssertEqual(model.guidance?.moment, .riding)
        XCTAssertEqual(model.guidance?.vehicle, .confirmed)
        XCTAssertEqual(model.library.recents.count, 1)

        var moments: [RideMoment] = []
        while model.canAdvanceDemo {
            await model.advanceDemo()
            moments.append(model.guidance!.moment)
        }
        XCTAssertEqual(Array(moments.suffix(3)), [.prepare, .nextStop, .arrived])
        XCTAssertEqual(model.activeRide?.alertedMilestones, [.prepare, .nextStop, .arrived])

        await model.finishRide()
        XCTAssertFalse(model.hasActiveRide)
        XCTAssertEqual(model.outcome?.moment, .arrived)

        model.dismissOutcome()
        model.rideAgain(model.library.recents[0])
        XCTAssertEqual(model.path, [.vehicleCheck], "a repeat ride goes straight to the bus check")
    }

    func testRelaunchResumesTheRideInProgress() async {
        let defaults = UserDefaults(suiteName: "tapso.tests.\(UUID().uuidString)")!
        let first = makeModel(defaults: defaults)
        first.startDemo()
        await first.confirmVehicle(first.vehicleCheck.proposals[0])
        await first.advanceDemo()
        let remaining = first.remainingStops

        let relaunched = makeModel(defaults: defaults)
        XCTAssertTrue(relaunched.hasActiveRide)
        XCTAssertTrue(relaunched.resumedAfterRelaunch)
        XCTAssertEqual(relaunched.remainingStops, remaining)
    }

    func testARestoredRideIsReagedAgainstTheWallClockAndKeepsItsSignalledMilestones() async throws {
        let defaults = UserDefaults(suiteName: "tapso.tests.\(UUID().uuidString)")!
        let first = makeModel(defaults: defaults)
        first.startDemo()
        await first.confirmVehicle(first.vehicleCheck.proposals[0])
        while first.guidance?.moment != .nextStop, first.canAdvanceDemo {
            await first.advanceDemo()
        }
        XCTAssertEqual(first.guidance?.moment, .nextStop)

        // Reopened ten minutes after the last observation reached the phone.
        let store = JourneyStore(defaults: defaults)
        var saved = try XCTUnwrap(store.loadActiveRide())
        saved.lastObservedAt = Date().addingTimeInterval(-600)
        store.saveActiveRide(saved)

        let relaunched = makeModel(defaults: defaults)
        XCTAssertEqual(relaunched.guidance?.moment, .delayed, "old data is never a fresh next-stop")
        XCTAssertNil(relaunched.guidance?.milestone)
        XCTAssertEqual(relaunched.activeRide?.alertedMilestones, [.prepare, .nextStop])
    }

    func testConfirmingTwiceStartsOneRide() async {
        let model = makeModel()
        model.startDemo()
        let proposal = model.vehicleCheck.proposals[0]
        await model.confirmVehicle(proposal)
        let session = model.activeRide?.session.id
        await model.confirmVehicle(proposal)
        XCTAssertEqual(model.activeRide?.session.id, session)
    }

    func testTheSampleRideKeepsTheScenarioChosenInDemoSettings() {
        let model = makeModel()
        model.scenario = .delayedData
        model.startDemo()
        XCTAssertEqual(model.scenario, .delayedData)
    }

    func testEnglishCountsUseTheSingularForOne() {
        XCTAssertEqual(RideText.countKey("count.unit", 1), "count.unit.one")
        XCTAssertEqual(RideText.countKey("count.unit", 2), "count.unit")
    }

    func testRejectingTheOnlyBusKeepsWatchingInsteadOfSwitching() {
        let model = makeModel()
        model.startDemo()
        let proposal = model.vehicleCheck.proposals[0]
        model.rejectProposal(proposal)
        XCTAssertEqual(model.vehicleCheck.stage, .notFoundYet)
        XCTAssertFalse(model.hasActiveRide)
    }

    func testSharedMapTextFindsAStopWithoutANetworkRequest() {
        let model = makeModel()
        XCTAssertEqual(model.stopNames(inSharedText: "[네이버 지도]\n관덕정\nnaver.me/abc").first, "관덕정")
        XCTAssertTrue(model.stopNames(inSharedText: "kko.to/xyz").isEmpty)
    }

    func testSyntheticStopsOfferOnlyADocumentedNameSearch() {
        let model = makeModel()
        let stop = DemoCatalog.outbound.stops[8].stop
        XCTAssertEqual(model.mapRequest(for: .naverMap, to: stop)?.urlString.hasPrefix("nmap://search?"), true)
        XCTAssertNil(model.mapRequest(for: .kakaoMap, to: stop))
    }

    // MARK: Helpers

    private func makeModel(defaults: UserDefaults? = nil) -> TapsoAppModel {
        let model = TapsoAppModel(
            store: JourneyStore(defaults: defaults ?? UserDefaults(suiteName: "tapso.tests.\(UUID().uuidString)")!),
            liveActivity: nil
        )
        model.speed = .manual
        return model
    }

    private func makeState(
        _ phase: JourneyState,
        _ remaining: Int,
        passed: Bool = false,
        offline: Bool = false
    ) -> TapsoActivityAttributes.ContentState {
        TapsoActivityAttributes.ContentState(
            phase: phase,
            currentStopName: "동문로터리",
            nextStopName: "제주여자상업고등학교",
            remainingStops: remaining,
            freshness: .fresh,
            updatedAt: Date(timeIntervalSince1970: 1_800_000_000),
            destinationPassed: passed,
            isOffline: offline
        )
    }
}
