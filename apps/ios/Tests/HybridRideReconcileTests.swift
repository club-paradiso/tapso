import CoreLocation
import XCTest
import TapsoTransit
@testable import Tapso

/// A hybrid live ride's reconcile in the app model, with the server stubbed (`StubURLProtocol`)
/// and Core Location faked (`FakeLocationManager`). SYNTHETIC session, vehicle and fixes.
@MainActor
final class HybridRideReconcileTests: XCTestCase {
    override func setUp() async throws {
        StubURLProtocol.beginTest()
    }

    private struct Ride {
        let model: TapsoAppModel
        let sampler: RideLocationSampler
        let fake: FakeLocationManager
        let clock: ManualClock
        let route: TransitRoute
        let boarding: Int
        let destination: Int
    }

    func testABackgroundRideStillReadsOfficialProgressWithoutSampling() async throws {
        let ride = try await makeHybridRide(readsInBackground: true) // `RideKeepAlive` running
        defer { ride.clock.fire() }
        StubURLProtocol.respond { [body = session(ride, sequence: ride.boarding + 1, evidenceAt: Date())] _ in (200, body) }
        await ride.model.rideSceneChanged(isActive: false) // locked
        await ride.model.recheckRidePosition() // returns once a read that began after it has ended

        XCTAssertTrue(StubURLProtocol.recorded.contains { $0.url?.path == "/v1/sessions/synthetic-session" },
                      "the background read happens")
        XCTAssertEqual(ride.fake.startCount, 0, "no location window in the background")
        XCTAssertEqual(ride.fake.permissionRequests, 0, "no prompt in the background")
        let position = try XCTUnwrap(ride.model.activeRide?.hybridPosition)
        XCTAssertEqual(position.state, .live)
        XCTAssertEqual(position.reason, "consistent_official")
        XCTAssertEqual(position.currentStopSequence, ride.boarding + 1)
        #if DEBUG
        let line = try XCTUnwrap(ride.model.hybridDiagnosticLines.last)
        XCTAssertTrue(line.contains("sample=background"), line)
        XCTAssertTrue(line.contains("accuracy10m=-1"), "evaluated with no device evidence: \(line)")
        #endif
    }

    func testAFixFromBeforeTheSceneWentInactiveIsNotRetained() async throws {
        let ride = try await makeHybridRide()
        defer { ride.clock.fire() }
        // The server answers only once the test lets it, so the scene can change in between.
        let gate = DispatchSemaphore(value: 0)
        StubURLProtocol.respond { [body = session(ride, sequence: ride.boarding + 1, evidenceAt: Date())] _ in
            gate.wait()
            return (200, body)
        }
        await ride.model.rideSceneChanged(isActive: true) // asks the ride's loop for a read now
        try await waitUntil { ride.fake.startCount > 0 }
        XCTAssertEqual(ride.fake.startCount, 1, "the foreground reconcile samples")
        ride.sampler.receive([RideLocationSamplerTests.fix(accuracy: 9)]) // the fix arrives first
        await ride.model.rideSceneChanged(isActive: false) // then the rider locks the phone
        gate.signal() // and only then does the official read return
        try await waitUntil { ride.model.activeRide?.hybridPosition != nil }

        let position = try XCTUnwrap(ride.model.activeRide?.hybridPosition)
        XCTAssertEqual(position.state, .live, "official progress still applies")
        #if DEBUG
        let line = try XCTUnwrap(ride.model.hybridDiagnosticLines.last)
        XCTAssertTrue(line.contains("sample=fix"), line)
        XCTAssertTrue(line.contains("accuracy10m=-1"), "the foreground fix is dropped once the scene is inactive: \(line)")
        #endif
    }

    func testALostResultNamesOnlyTheAcceptedStopOnAnySurface() async throws {
        let ride = try await makeHybridRide(status: .denied)
        defer { ride.clock.fire() }
        let ahead = ride.boarding + 2
        let behind = ride.boarding + 1
        StubURLProtocol.respond { [body = session(ride, sequence: ahead, evidenceAt: Date())] _ in (200, body) }
        await ride.model.recheckRidePosition()
        XCTAssertEqual(ride.model.activeRide?.hybridPosition?.currentStopSequence, ahead)
        XCTAssertEqual(ride.model.currentStopName, name(ride, ahead))

        // A newer official read one stop back: the engine flags it and keeps its own count.
        try await Task.sleep(for: .milliseconds(5))
        StubURLProtocol.respond { [body = session(ride, sequence: behind, evidenceAt: Date())] _ in (200, body) }
        await ride.model.recheckRidePosition()
        let position = try XCTUnwrap(ride.model.activeRide?.hybridPosition)
        XCTAssertEqual(position.state, .lost)
        XCTAssertEqual(position.reason, "official_backward_conflict")
        XCTAssertEqual(position.currentStopSequence, ahead, "the engine still holds the count it had")

        // Every surface names the official stop the engine accepted, not the read it refused.
        XCTAssertEqual(ride.model.activeRide?.live?.currentStopSequence, behind, "the refused read is still recorded")
        XCTAssertEqual(ride.model.currentStopName, name(ride, ahead))
        XCTAssertEqual(ride.model.upcomingStopNames.first, name(ride, ahead + 1))
        let state = try XCTUnwrap(ride.model.contentState())
        XCTAssertEqual(state.currentStopName, name(ride, ahead))
        XCTAssertEqual(state.nextStopName, name(ride, ahead + 1))

        // A denied rider is never prompted and never sampled; the ride runs on official progress.
        XCTAssertEqual(ride.fake.startCount, 0)
        XCTAssertEqual(ride.fake.permissionRequests, 0)
        XCTAssertEqual(ride.model.ridePrecision, .denied)
    }

    func testARefusedReadAheadMovesNoSurface() async throws {
        let ride = try await makeHybridRide(status: .denied)
        defer { ride.clock.fire() }
        let accepted = ride.boarding + 1
        StubURLProtocol.respond { [body = session(ride, sequence: accepted, evidenceAt: Date())] _ in (200, body) }
        await ride.model.recheckRidePosition()
        XCTAssertEqual(ride.model.activeRide?.hybridPosition?.state, .live)

        // Four stops ahead a few milliseconds later, and then the same read for another bus.
        let ahead = ride.boarding + 5
        for (vehicle, reason) in [("synthetic-bus", "official_implausible_jump"), ("synthetic-other-bus", "vehicle_identity_conflict")] {
            try await Task.sleep(for: .milliseconds(5))
            StubURLProtocol.respond { [body = session(ride, sequence: ahead, evidenceAt: Date(), vehicle: vehicle)] _ in (200, body) }
            await ride.model.recheckRidePosition()
            let position = try XCTUnwrap(ride.model.activeRide?.hybridPosition)
            XCTAssertEqual(position.state, .lost, reason)
            XCTAssertEqual(position.reason, reason)
            XCTAssertEqual(ride.model.activeRide?.live?.currentStopSequence, ahead, "the refused read is recorded: \(reason)")

            XCTAssertEqual(ride.model.currentStopName, name(ride, accepted), reason)
            XCTAssertEqual(ride.model.upcomingStopNames.first, name(ride, accepted + 1), reason)
            let state = try XCTUnwrap(ride.model.contentState())
            XCTAssertEqual(state.currentStopName, name(ride, accepted), reason)
            XCTAssertEqual(state.nextStopName, name(ride, accepted + 1), reason)
        }
    }

    // MARK: Helpers

    /// A hybrid live ride on the synthetic demo route, saved and reopened with the fakes.
    private func makeHybridRide(status: CLAuthorizationStatus = .authorizedWhenInUse, readsInBackground: Bool = false) async throws -> Ride {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "tapso.tests.\(UUID().uuidString)"))
        let demo = TapsoAppModel(store: JourneyStore(defaults: defaults), liveActivity: nil)
        demo.speed = .manual
        demo.startDemo()
        await demo.confirmVehicle(try XCTUnwrap(demo.vehicleCheck.proposals.first))

        let store = JourneyStore(defaults: defaults)
        let saved = try XCTUnwrap(store.loadActiveRide())
        let route = try XCTUnwrap(saved.draft.route)
        let boarding = try XCTUnwrap(saved.draft.boardingRouteStop)
        let destination = try XCTUnwrap(saved.draft.destinationRouteStop)
        XCTAssertGreaterThanOrEqual(destination.sequence - boarding.sequence, 5, "room for the stops these tests use")
        let draft = RideDraft(live: route, cityCode: "39", boarding: boarding, destination: destination, coordinatesAreSurveyed: false)
        let live = LiveRideState(
            sessionID: "synthetic-session", vehicleID: "synthetic-bus",
            signal: RideSignal(phase: .active, remainingStops: destination.sequence - boarding.sequence, freshness: .fresh),
            currentStopSequence: boarding.sequence, endedByServer: false, hybridTracking: true)
        store.saveActiveRide(ActiveRide(
            session: saved.session, draft: draft, plate: saved.plate, scenario: saved.scenario,
            beatIndex: saved.beatIndex, clock: saved.clock, isOffline: false, lastObservedAt: Date(), live: live))

        let fake = FakeLocationManager()
        fake.authorizationStatus = status
        let clock = ManualClock()
        let sampler = RideLocationSampler(manager: fake, sleep: clock.sleep)
        let model = TapsoAppModel(store: store, liveActivity: nil, api: .stubbed(), locationSampler: sampler,
                                  readsInBackground: { readsInBackground })
        XCTAssertTrue(model.hybridTrackingEnabled)
        XCTAssertTrue(model.isLiveRide)
        return Ride(model: model, sampler: sampler, fake: fake, clock: clock, route: route,
                    boarding: boarding.sequence, destination: destination.sequence)
    }

    /// The ride's reads run on its own loop; waits (up to 5 s) for what one produces.
    private func waitUntil(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTFail("condition not met within 5 s", file: file, line: line)
    }

    private func name(_ ride: Ride, _ sequence: Int) -> String? {
        ride.route.routeStop(sequence: sequence)?.stop.name
    }

    /// The server's session view of this ride, tracking the rider's confirmed bus.
    private func session(_ ride: Ride, sequence: Int, evidenceAt: Date, vehicle: String = "synthetic-bus") -> Data {
        func stop(_ sequence: Int) -> [String: Any] {
            let routeStop = ride.route.routeStop(sequence: sequence)
            return ["stopId": routeStop?.stop.id.rawValue ?? "synthetic-stop", "name": routeStop?.stop.name ?? "", "sequence": sequence]
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let body: [String: Any] = [
            "id": "synthetic-session",
            "routeId": ride.route.id.rawValue,
            "cityCode": "39",
            "boardingStop": stop(ride.boarding),
            "destinationStop": stop(ride.destination),
            "state": "tracking",
            "selectedVehicleId": vehicle,
            "selectionMode": "explicit",
            "progress": [
                "currentStopSequence": sequence,
                "remainingStops": ride.destination - sequence,
                "phase": "active",
                "source": "provider_stop_sequence",
                "evidenceAt": formatter.string(from: evidenceAt),
            ] as [String: Any],
        ]
        return (try? JSONSerialization.data(withJSONObject: body)) ?? Data()
    }
}
