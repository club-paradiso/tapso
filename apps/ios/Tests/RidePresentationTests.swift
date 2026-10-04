import SwiftUI
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

    // MARK: One root condition, one message

    /// A transient failure (a slow answer, a provider hiccup) ages the ride into its own calm
    /// banner; the failure notice is not stacked on top of it. Only a failure the ride cannot
    /// recover from, or one that left the guidance healthy, gets its own notice.
    func testATransientFailureIsNotSaidTwice() {
        XCTAssertFalse(RideView.showsFailureNotice(.timedOut, trust: .rechecking))
        XCTAssertFalse(RideView.showsFailureNotice(.providerTimeout, trust: .rechecking))
        XCTAssertFalse(RideView.showsFailureNotice(.server, trust: .unavailable))
        XCTAssertTrue(RideView.showsFailureNotice(.timedOut, trust: .live), "a timeout that did not age the ride is still worth one line")
        XCTAssertTrue(RideView.showsFailureNotice(.sessionExpired, trust: .rechecking), "the ride cannot recover: say so")
        XCTAssertTrue(RideView.showsFailureNotice(.sessionNotFound, trust: nil))
    }

    /// Every moment carries exactly one trust word, and healthy moments carry no warning.
    func testEveryMomentHasOneTrustWord() {
        for moment in RideMoment.allCases {
            let guidance = RideGuidancePolicy.guidance(for: signal(for: moment))
            switch guidance.trust {
            case .live, .estimated:
                XCTAssertFalse([.delayed, .checking, .vehicleLost, .offline].contains(moment), "\(moment)")
            case .rechecking:
                XCTAssertTrue([.delayed, .checking].contains(moment), "\(moment)")
                XCTAssertNil(guidance.milestone, "\(moment) never alerts")
            case .unavailable:
                XCTAssertTrue([.vehicleLost, .offline].contains(moment), "\(moment)")
                XCTAssertNil(guidance.milestone, "\(moment) never alerts")
            }
        }
        XCTAssertEqual(RideGuidancePolicy.guidance(for: RideSignal(phase: .active, remainingStops: 5, freshness: .fresh, isEstimated: true)).trust, .estimated)
    }

    /// The timeout copy describes the phone's wait, never a server fault it cannot see:
    /// the 3001 / 3913 ride showed "탑서 서버가 늦게 답하고 있어요" over HTTP 200 answers.
    func testTimeoutCopyBlamesNoServer() throws {
        for language in ["ko", "en"] {
            let path = try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj"))
            let bundle = try XCTUnwrap(Bundle(path: path))
            for key in ["live.error.timedOut.title", "live.error.timedOut.body"] {
                let value = bundle.localizedString(forKey: key, value: nil, table: nil)
                for word in ["서버", "server", "Server"] {
                    XCTAssertFalse(value.contains(word), "\(language) \(key): \(value)")
                }
            }
        }
    }

    private func signal(for moment: RideMoment) -> RideSignal {
        switch moment {
        case .riding: RideSignal(phase: .active, remainingStops: 5, freshness: .fresh)
        case .prepare: RideSignal(phase: .approachingDestination, remainingStops: 2, freshness: .fresh)
        case .nextStop: RideSignal(phase: .nextStopIsDestination, remainingStops: 1, freshness: .fresh)
        case .arrived: RideSignal(phase: .arrived, remainingStops: 0, freshness: .fresh)
        case .passedDestination: RideSignal(phase: .arrived, remainingStops: 0, freshness: .fresh, destinationPassed: true)
        case .delayed: RideSignal(phase: .active, remainingStops: 4, freshness: .aging)
        case .vehicleLost: RideSignal(phase: .vehicleTemporarilyLost, remainingStops: 4, freshness: .stale)
        case .offline: RideSignal(phase: .active, remainingStops: 4, freshness: .fresh, isOffline: true)
        case .checking: RideSignal(phase: .vehicleRecovery, remainingStops: -1, freshness: .unknown)
        case .ended: RideSignal(phase: .completed, remainingStops: 0, freshness: .fresh)
        }
    }

    // MARK: Dynamic Island Coexistence V3

    /// Minimal says "bus ride + count" at every count the gate names, and 2 / 1 / arrival are
    /// three different objects (symbol and shape), never one colour change.
    func testMinimalIslandCarriesIdentityAndCountAndDistinctDecisions() {
        // Riding needs three or more stops; 2 and 1 are the prepare and next-stop decisions below.
        for count in [3, 8, 12, 18] {
            let riding = IslandMinimalStyle.style(for: makeState(.active, count).guidance, remainingStops: count)
            XCTAssertEqual(riding.symbol, "bus.fill", "count \(count)")
            XCTAssertEqual(riding.count, String(count))
            XCTAssertEqual(riding.shape, .plain)
        }
        let prepare = IslandMinimalStyle.style(for: makeState(.approachingDestination, 2).guidance, remainingStops: 2)
        let next = IslandMinimalStyle.style(for: makeState(.nextStopIsDestination, 1).guidance, remainingStops: 1)
        let arrival = IslandMinimalStyle.style(for: makeState(.arrived, 0).guidance, remainingStops: 0)
        XCTAssertEqual(prepare.shape, .ring); XCTAssertEqual(prepare.count, "2"); XCTAssertEqual(prepare.symbol, "figure.stand")
        XCTAssertEqual(next.shape, .filled); XCTAssertEqual(next.count, "1"); XCTAssertEqual(next.symbol, "bell.fill")
        XCTAssertEqual(arrival.shape, .filled); XCTAssertNil(arrival.count, "arrival shows no number"); XCTAssertEqual(arrival.symbol, "figure.walk")
        XCTAssertEqual(Set([prepare.symbol, next.symbol, arrival.symbol]).count, 3, "three decisions, three symbols")
        XCTAssertNotEqual(prepare.shape, next.shape)

        let estimated = IslandMinimalStyle.style(for: makeState(.active, 8, estimated: true).guidance, remainingStops: 8)
        XCTAssertEqual(estimated.count, "~8", "an estimate is marked, not disguised")
        let rechecking = IslandMinimalStyle.style(for: makeState(.active, 8, freshness: .aging).guidance, remainingStops: 8)
        XCTAssertEqual(rechecking.count, "8"); XCTAssertTrue(rechecking.dimmed); XCTAssertEqual(rechecking.symbol, "arrow.clockwise")
        let lost = IslandMinimalStyle.style(for: makeState(.vehicleTemporarilyLost, 8).guidance, remainingStops: 8)
        XCTAssertNil(lost.count, "a lost bus shows no count to act on")
    }

    /// VoiceOver on the minimal island reads the bus and the count from real data, never the glyphs.
    func testMinimalIslandVoiceOverNamesTheBusAndTheCount() {
        let attributes = TapsoActivityAttributes(routeNumber: "3001", routeID: "JEB405900101", boardingStopName: "제주국제공항", destinationName: "제주시청", totalStops: 20, vehiclePlate: "••3913")
        let riding = makeState(.active, 8)
        let label = minimalAccessibilityLabel(attributes, riding, riding.guidance)
        XCTAssertEqual(label, String(format: RideText.string("a11y.minimal.count"), "3001", 8))
        XCTAssertTrue(label.contains("3001") && label.contains("8"))
        for word in ["bus.fill", "figure", "bell"] { XCTAssertFalse(label.contains(word)) }
        let next = makeState(.nextStopIsDestination, 1)
        XCTAssertEqual(minimalAccessibilityLabel(attributes, next, next.guidance), String(format: RideText.string("a11y.minimal.state"), "3001", RideText.string("ride.nextStop.headline")))
        let estimated = makeState(.active, 8, estimated: true)
        XCTAssertEqual(minimalAccessibilityLabel(attributes, estimated, estimated.guidance), String(format: RideText.string("a11y.minimal.estimated"), "3001", 8))
    }

    // MARK: One truth for every surface

    func testContentStateCarriesTheSameGuidanceAsTheApp() {
        let state = makeState(.arrived, 0, passed: true)
        XCTAssertEqual(state.guidance.moment, .passedDestination)
        XCTAssertEqual(TapsoLiveActivityPolicy.displayPhase(for: state), .passedDestination)
        XCTAssertNil(TapsoLiveActivityPolicy.milestone(for: state), "passing the stop is not an arrival alert")
    }

    func testPastTheStopEverySurfaceNamesTheExitWhenTheRideKnowsIt() {
        let passed = makeState(.arrived, 0, passed: true, next: "국립제주박물관")
        XCTAssertEqual(
            RideText.detail(passed.guidance, exitStopName: passed.nextStopName),
            String(format: RideText.string("rescue.exitAt"), "국립제주박물관")
        )
        let unknown = makeState(.arrived, 0, passed: true, next: nil)
        XCTAssertEqual(RideText.detail(unknown.guidance, exitStopName: unknown.nextStopName), RideText.string("ride.passedDestination.detail"))
        let riding = makeState(.active, 4)
        XCTAssertEqual(
            RideText.detail(riding.guidance, exitStopName: riding.nextStopName),
            RideText.string(riding.guidance.copy.detail),
            "before the stop, the next stop never replaces the moment's detail"
        )
        let stale = guidanceAccountingForStaleness(passed, isStale: true)
        XCTAssertEqual(RideText.detail(stale, exitStopName: passed.nextStopName), RideText.string(stale.copy.detail), "aged data names no exit")
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
                destinationName: "제주시청(아라방면)",
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

    func testConfirmedRideWalksToArrivalAndIsRememberedForOneTapRepeat() async throws {
        let model = makeModel()
        model.startDemo()
        let proposal = try XCTUnwrap(model.vehicleCheck.proposals.first)
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

    func testHybridRestoreDoesNotMakeAnOldOfficialMilestoneFresh() async throws {
        let defaults = UserDefaults(suiteName: "tapso.tests.\(UUID().uuidString)")!
        let first = makeModel(defaults: defaults)
        first.startDemo()
        await first.confirmVehicle(first.vehicleCheck.proposals[0])
        let store = JourneyStore(defaults: defaults)
        var saved = try XCTUnwrap(store.loadActiveRide())
        let route = try XCTUnwrap(saved.draft.route)
        let destination = try XCTUnwrap(saved.draft.destinationRouteStop?.sequence)
        let signal = RideSignal(phase: .nextStopIsDestination, remainingStops: 1, freshness: .fresh)
        let now = Date()
        var engine = HybridPositionEngine(vehicleID: "synthetic-bus", route: route,
                                          destinationSequence: destination, surveyed: false)
        saved.live = LiveRideState(sessionID: "synthetic-session", vehicleID: "synthetic-bus", signal: signal,
                                   currentStopSequence: destination - 1, endedByServer: false)
        saved.hybridPosition = engine.evaluate(official: signal, sequence: destination - 1,
                                              evidenceAt: now, selectedVehicleID: "synthetic-bus", device: nil, now: now)
        saved.lastObservedAt = now
        store.saveActiveRide(saved)
        let restored = makeModel(defaults: defaults)
        XCTAssertEqual(restored.guidance?.moment, .checking)
        XCTAssertNil(restored.guidance?.milestone, "process restart cannot recreate GPS continuity or renew official evidence")
        XCTAssertNil(restored.activeRide?.hybridPosition)
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

    // MARK: Contrast

    /// WCAG 2.x contrast of the Lock Screen's text on its surface, for every moment in light and dark
    /// appearance, from the tokens as drawn: a dimmed colour is composited over the surface in sRGB.
    /// Text needs 4.5:1; the 40 pt count numeral, large text, needs 3:1.
    func testLockScreenTextReadsOnEverySurface() throws {
        for style in [UIUserInterfaceStyle.light, .dark] {
            let traits = UITraitCollection(userInterfaceStyle: style)
            for moment in RideMoment.allCases {
                let name = "\(moment) in \(style == .dark ? "dark" : "light") appearance"
                let surface = try srgb(RideSurfacePalette.background(for: moment), traits)
                let text = try srgb(RideSurfacePalette.primaryText(for: moment), traits)
                XCTAssertGreaterThanOrEqual(contrast(text, on: surface), 4.5, "\(name): headline")
                let secondary = composite(text, opacity: RideSurfacePalette.secondaryOpacity(for: moment), over: surface)
                XCTAssertGreaterThanOrEqual(contrast(secondary, on: surface), 4.5, "\(name): destination and detail")

                let count = RideGuidancePolicy.countPresentation(for: moment)
                guard count != .hidden else { continue }
                let accent = try srgb(RideSurfacePalette.accent(for: moment), traits)
                let numeral = composite(accent, opacity: count == .lastKnown ? RemainingOrSymbol.lastKnownOpacity : 1, over: surface)
                XCTAssertGreaterThanOrEqual(contrast(numeral, on: surface), 3, "\(name): count")
                let label = composite(accent, opacity: RideSurfacePalette.countLabelOpacity, over: surface)
                XCTAssertGreaterThanOrEqual(contrast(label, on: surface), 4.5, "\(name): count label")
            }
        }
    }

    // MARK: Helpers

    /// A token's sRGB components in an appearance. Tokens are opaque; dimming is applied by `composite`.
    private func srgb(_ color: Color, _ traits: UITraitCollection) throws -> [Double] {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        let resolved = UIColor(color).resolvedColor(with: traits)
        XCTAssertTrue(resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha), "\(resolved) has RGB components")
        XCTAssertEqual(Double(alpha), 1, accuracy: 0.001, "\(resolved) is opaque")
        return [red, green, blue].map { Double($0) }
    }

    private func composite(_ color: [Double], opacity: Double, over surface: [Double]) -> [Double] {
        zip(color, surface).map { opacity * $0 + (1 - opacity) * $1 }
    }

    private func contrast(_ first: [Double], on second: [Double]) -> Double {
        func luminance(_ components: [Double]) -> Double {
            let linear = components.map { $0 <= 0.04045 ? $0 / 12.92 : pow(($0 + 0.055) / 1.055, 2.4) }
            return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
        }
        let (a, b) = (luminance(first), luminance(second))
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

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
        offline: Bool = false,
        next: String? = "제주여자상업고등학교",
        freshness: DataFreshness = .fresh,
        estimated: Bool = false
    ) -> TapsoActivityAttributes.ContentState {
        TapsoActivityAttributes.ContentState(
            phase: phase,
            currentStopName: "동문로터리",
            nextStopName: next,
            remainingStops: remaining,
            freshness: freshness,
            updatedAt: Date(timeIntervalSince1970: 1_800_000_000),
            destinationPassed: passed,
            isOffline: offline,
            isEstimated: estimated
        )
    }
}
