import Foundation
import XCTest
import TapsoTransit
@testable import Tapso

// The live ride, end to end against the API contract: every server answer
// below is a committed fixture the real request handler produced with a
// SYNTHETIC provider (`fixtures/transit/api-contract`, invented plates). No
// network, no UIKit: the transport is scripted, the clock is a variable, and
// the Live Activity is a recorder.

private enum ContractFixture {
    static func directory() -> URL {
        if let override = ProcessInfo.processInfo.environment["TAPSO_CONTRACT_DIR"], !override.isEmpty {
            return URL(fileURLWithPath: override)
        }
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // ios
            .deletingLastPathComponent()  // apps
            .deletingLastPathComponent()  // repository root
            .appendingPathComponent("fixtures/transit/api-contract")
    }

    /// The fixture's response, optionally with another status (a refresh answering 200 with a created session).
    static func response(_ name: String, status: Int? = nil) throws -> LiveHTTPResponse {
        let data = try Data(contentsOf: directory().appendingPathComponent("\(name).json"))
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["synthetic"] as? Bool, true, "\(name) must be labelled synthetic")
        let body = object["body"].flatMap { $0 is NSNull ? nil : $0 }
        let bytes = try body.map { try JSONSerialization.data(withJSONObject: $0) } ?? Data()
        return LiveHTTPResponse(status: status ?? (object["status"] as? Int ?? 0), body: bytes)
    }
}

/// Answers each request with the next scripted outcome for its method and path.
private final class ScriptedServer: LiveHTTPTransport, @unchecked Sendable {
    enum Outcome {
        case respond(LiveHTTPResponse)
        case fail(LiveAPIError)
    }

    private let lock = NSLock()
    private var scripts: [String: [Outcome]] = [:]
    private var log: [LiveHTTPRequest] = []

    func on(_ method: String, _ path: String, _ outcomes: Outcome...) {
        lock.lock()
        scripts["\(method) \(path)", default: []].append(contentsOf: outcomes)
        lock.unlock()
    }

    var requests: [LiveHTTPRequest] {
        lock.lock()
        defer { lock.unlock() }
        return log
    }

    func requests(_ method: String, _ path: String) -> [LiveHTTPRequest] {
        requests.filter { $0.method == method && $0.url.path == path }
    }

    func send(_ request: LiveHTTPRequest) async throws -> LiveHTTPResponse {
        let key = "\(request.method) \(request.url.path)"
        let outcome: Outcome? = {
            lock.lock()
            defer { lock.unlock() }
            log.append(request)
            guard var queue = scripts[key], !queue.isEmpty else { return nil }
            let next = queue.removeFirst()
            scripts[key] = queue
            return next
        }()
        switch outcome {
        case .respond(let response)?: return response
        case .fail(let error)?: throw error
        case nil: throw LiveAPIError.server(status: 599, code: "UNSCRIPTED \(key)")
        }
    }
}

@MainActor
private final class RecordingSurfaces: LiveRideSurfaces {
    var started: [(LiveRideContent, Bool)] = []
    var updates: [(LiveRideContent, RideMilestone?)] = []
    var ended: [(LiveRideContent, Bool)] = []
    var announced: [RideMoment] = []
    var refuseStart = false

    func start(_ content: LiveRideContent, resuming: Bool) async throws {
        if refuseStart { throw CancellationError() }
        started.append((content, resuming))
    }

    func update(_ content: LiveRideContent, alerting milestone: RideMilestone?) async {
        updates.append((content, milestone))
    }

    func end(_ content: LiveRideContent, immediately: Bool) async {
        ended.append((content, immediately))
    }

    func announce(_ guidance: RideGuidance, haptic: Bool) {
        announced.append(guidance.moment)
    }

    var alerts: [RideMilestone] { updates.compactMap(\.1) }
}

@MainActor
private final class MemoryRecordStore: LiveRideRecordStore {
    var record: LiveRideRecord?
    func load() -> LiveRideRecord? { record }
    func save(_ record: LiveRideRecord?) { self.record = record }
}

@MainActor
final class LiveRideModelTests: XCTestCase {
    private let sessionPath = "/v1/sessions/synthetic-session-1"
    // XCTest makes a fresh instance for each test, so each test gets its own.
    private lazy var server = ScriptedServer()
    private lazy var surfaces = RecordingSurfaces()
    private lazy var store = MemoryRecordStore()
    private var now = Date(timeIntervalSince1970: 1_790_841_600)

    private func makeModel() -> LiveRideModel {
        LiveRideModel(
            client: LiveAPIClient(environment: .production, transport: server, retry: .none),
            surfaces: surfaces,
            store: store,
            clock: { [unowned self] in self.now },
            pause: { _ in },
            autoPoll: false
        )
    }

    private func respond(_ name: String, status: Int? = nil) throws -> ScriptedServer.Outcome {
        .respond(try ContractFixture.response(name, status: status))
    }

    /// Route 365 → its first direction → 제주시청(아라방면) → 제주버스터미널, session open.
    private func openSession(_ model: LiveRideModel) async throws {
        server.on("GET", "/v1/routes", try respond("routes"))
        server.on("GET", "/v1/stops", try respond("stops"))
        server.on("POST", "/v1/sessions", try respond("session-created"))
        model.open()
        model.routeQuery = " 365 "
        await model.searchRoutes()
        XCTAssertEqual(model.directions.count, 2, "both directions offered, none chosen for the rider")
        XCTAssertEqual(model.path, [.direction])
        await model.chooseRoute(model.directions[0])
        XCTAssertEqual(model.path, [.direction, .destination])
        let destination = try XCTUnwrap(model.destinationOptions.first { $0.name == "제주시청(아라방면)" })
        model.chooseDestination(destination)
        XCTAssertEqual(model.boardingOptions.map(\.sequence), Array(1...8), "only stops before the destination")
        await model.chooseBoarding(model.boardingOptions[0])
        XCTAssertNil(model.setupIssue)
        XCTAssertEqual(model.ride?.stage, .choosingVehicle)
    }

    private func confirmRiderBus(_ model: LiveRideModel) async throws {
        server.on("GET", sessionPath, try respond("session-created", status: 200))
        server.on("GET", "/v1/vehicles", try respond("vehicles"))
        await model.poll()
        let choice = try XCTUnwrap(model.choices.first)
        server.on("POST", sessionPath + "/confirm", try respond("session-confirmed"))
        await model.confirm(choice)
    }

    func testSetupToArrivalWithEachMilestoneSignalledOnce() async throws {
        let model = makeModel()
        try await openSession(model)
        let created = try XCTUnwrap(server.requests("POST", "/v1/sessions").first?.body)
        let request = try XCTUnwrap(JSONSerialization.jsonObject(with: created) as? [String: Any])
        XCTAssertEqual(request["boardingStopSequence"] as? Int, 1)
        XCTAssertEqual(request["destinationStopSequence"] as? Int, 9)
        XCTAssertEqual(request["cityCode"] as? String, "39")

        try await confirmRiderBus(model)
        XCTAssertEqual(model.ride?.stage, .riding)
        XCTAssertEqual(model.plate, "••0001")
        XCTAssertEqual(surfaces.started.count, 1)
        XCTAssertEqual(surfaces.started.first?.0.vehiclePlate, "••0001")
        XCTAssertEqual(surfaces.started.first?.1, false)
        XCTAssertEqual(model.guidance?.moment, .checking, "no cadence yet: nothing to count on")

        for (name, moment) in [
            ("session-tracking", RideMoment.riding),
            ("session-approaching", .prepare),
            ("session-approaching", .prepare),
            ("session-next-stop", .nextStop),
            ("session-arrived", .arrived),
        ] {
            now += 10
            server.on("GET", sessionPath, try respond(name))
            await model.poll()
            XCTAssertEqual(model.guidance?.moment, moment, name)
        }
        XCTAssertEqual(surfaces.alerts, [.prepare, .nextStop, .arrived], "each milestone alerts once")
        XCTAssertEqual(model.remainingStops, 0)

        server.on("DELETE", sessionPath, try respond("session-ended"))
        await model.finish()
        XCTAssertEqual(model.ride?.stage, .ended(.finished))
        XCTAssertEqual(surfaces.ended.last?.0.phase, .completed)
        XCTAssertEqual(surfaces.ended.last?.1, false)
        XCTAssertEqual(server.requests("DELETE", sessionPath).count, 1)
        XCTAssertNil(store.record)
    }

    func testNothingIsSelectedWithoutTheRider() async throws {
        let model = makeModel()
        try await openSession(model)
        for _ in 0..<3 {
            server.on("GET", sessionPath, try respond("session-created", status: 200))
            server.on("GET", "/v1/vehicles", try respond("vehicles"))
            await model.poll()
        }
        XCTAssertEqual(model.choices.map(\.maskedPlate), ["••0001"], "a raw position at the stop, not a pick")
        XCTAssertEqual(model.choices.first?.stopsAway, 0)
        XCTAssertEqual(model.ride?.stage, .choosingVehicle)
        XCTAssertTrue(server.requests.allSatisfy { !$0.url.path.hasSuffix("/confirm") })
        XCTAssertTrue(surfaces.started.isEmpty)
    }

    func testDeploymentWithoutSessionsSaysSoAndStartsNothing() async throws {
        let model = makeModel()
        server.on("GET", "/v1/routes", try respond("routes"))
        server.on("GET", "/v1/stops", try respond("stops"))
        server.on("POST", "/v1/sessions", try respond("error-sessions-unavailable"))
        model.open()
        model.routeQuery = "365"
        await model.searchRoutes()
        await model.chooseRoute(model.directions[0])
        model.chooseDestination(model.destinationOptions[7])
        await model.chooseBoarding(model.boardingOptions[0])
        XCTAssertEqual(model.setupIssue, .serviceUnavailable)
        XCTAssertNil(model.ride)
        XCTAssertNil(store.record)
    }

    func testProviderOutageAndOfflineAreToldApart() async throws {
        let model = makeModel()
        model.open()
        model.routeQuery = "365"
        server.on("GET", "/v1/routes", try respond("error-provider-unavailable"), .fail(.offline))
        await model.searchRoutes()
        XCTAssertEqual(model.setupIssue, .providerUnavailable)
        await model.searchRoutes()
        XCTAssertEqual(model.setupIssue, .offline)
        model.routeQuery = "365; DROP"
        await model.searchRoutes()
        XCTAssertEqual(model.setupIssue, .setupInvalid, "not a route number: never sent")
        XCTAssertEqual(server.requests("GET", "/v1/routes").count, 2)
    }

    func testOfflineRideRecoversAndSilenceReadsAsDelayed() async throws {
        let model = makeModel()
        try await openSession(model)
        try await confirmRiderBus(model)
        for _ in 0..<2 {
            now += 10
            server.on("GET", sessionPath, try respond("session-tracking"))
            await model.poll()
        }
        XCTAssertEqual(model.guidance?.moment, .riding)

        now += 15
        server.on("GET", sessionPath, .fail(.offline))
        await model.poll()
        XCTAssertEqual(model.guidance?.moment, .offline)
        XCTAssertNil(surfaces.alerts.first, "offline never alerts")

        now += 15
        server.on("GET", sessionPath, try respond("session-tracking"))
        await model.poll()
        XCTAssertEqual(model.guidance?.moment, .riding)

        // The server goes quiet: the app's own link ages the ride, poll or not.
        now += 60
        await model.tick()
        XCTAssertEqual(model.guidance?.moment, .delayed)
        XCTAssertEqual(surfaces.updates.last?.0.phase, model.ride?.signal(now: now, isOffline: false)?.phase)
    }

    func testExpiredSessionEndsTheRideAndClearsTheActivity() async throws {
        let model = makeModel()
        try await openSession(model)
        try await confirmRiderBus(model)
        server.on("GET", sessionPath, try respond("error-session-not-found"))
        await model.poll()
        XCTAssertEqual(model.ride?.stage, .ended(.sessionEnded))
        XCTAssertEqual(surfaces.ended.last?.1, true, "ended at once")
        XCTAssertNil(store.record)
    }

    func testFailedConfirmationKeepsTheRiderChoosing() async throws {
        let model = makeModel()
        try await openSession(model)
        server.on("GET", sessionPath, try respond("session-created", status: 200))
        server.on("GET", "/v1/vehicles", try respond("vehicles"))
        await model.poll()
        server.on("POST", sessionPath + "/confirm", .fail(.server(status: 500, code: "INTERNAL_ERROR")))
        await model.confirm(try XCTUnwrap(model.choices.first))
        XCTAssertEqual(model.confirmIssue, .serverError)
        XCTAssertEqual(model.ride?.stage, .choosingVehicle)
        XCTAssertTrue(surfaces.started.isEmpty)
        XCTAssertEqual(server.requests("POST", sessionPath + "/confirm").count, 1, "a confirmation is never retried for the rider")
    }

    func testLeavingBeforeChoosingEndsTheSession() async throws {
        let model = makeModel()
        try await openSession(model)
        server.on("DELETE", sessionPath, try respond("session-ended"))
        await model.close()
        XCTAssertNil(model.ride)
        XCTAssertFalse(model.isPresented)
        XCTAssertEqual(server.requests("DELETE", sessionPath).count, 1)
        XCTAssertNil(store.record)
    }

    func testRelaunchResumesWithoutRepeatingAlerts() async throws {
        let first = makeModel()
        try await openSession(first)
        try await confirmRiderBus(first)
        for name in ["session-tracking", "session-approaching"] {
            now += 10
            server.on("GET", sessionPath, try respond(name))
            await first.poll()
        }
        XCTAssertEqual(surfaces.alerts, [.prepare])
        XCTAssertEqual(store.record?.alertedMilestones, [.prepare])

        // A new process: same store, new model.
        let previous = surfaces.alerts.count
        let resumed = makeModel()
        now += 10
        server.on("GET", sessionPath, try respond("session-approaching"))
        await resumed.resumeIfNeeded()
        XCTAssertTrue(resumed.isPresented)
        XCTAssertTrue(resumed.resumed)
        XCTAssertEqual(resumed.ride?.stage, .riding)
        XCTAssertEqual(resumed.guidance?.moment, .prepare)
        XCTAssertEqual(surfaces.started.last?.1, true, "takes over the activity a relaunch left")
        XCTAssertEqual(surfaces.alerts.count, previous, "prepare does not alert twice")
    }

    func testLiveActivitySwitchedOffIsReportedNotFatal() async throws {
        let model = makeModel()
        surfaces.refuseStart = true
        try await openSession(model)
        try await confirmRiderBus(model)
        XCTAssertEqual(model.ride?.stage, .riding)
        XCTAssertTrue(model.liveActivityUnavailable)
    }
}
