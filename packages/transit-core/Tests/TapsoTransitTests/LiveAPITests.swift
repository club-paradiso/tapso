import Foundation
import XCTest
@testable import TapsoTransit

/// A server played from a script: each request takes the next answer.
final class ScriptedTransport: LiveHTTPTransport, @unchecked Sendable {
    enum Step {
        case answer(LiveHTTPResponse)
        case fail(LiveAPIError)
    }

    private let lock = NSLock()
    private var steps: [Step]
    private(set) var requests: [LiveHTTPRequest] = []

    init(_ steps: [Step]) {
        self.steps = steps
    }

    func send(_ request: LiveHTTPRequest) async throws -> LiveHTTPResponse {
        let step: Step = lock.withLock {
            requests.append(request)
            return steps.isEmpty ? .fail(.network) : steps.removeFirst()
        }
        switch step {
        case .answer(let response): return response
        case .fail(let error): throw error
        }
    }

    var sent: [LiveHTTPRequest] { lock.withLock { requests } }
}

/// Exchanges recorded from the real request handler (`services/api/scripts/contractFixtures.ts`). SYNTHETIC data.
enum Contract {
    struct Exchange: Decodable {
        let synthetic: Bool
        let request: String
        let status: Int
    }

    static let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // TapsoTransitTests
        .deletingLastPathComponent() // Tests
        .deletingLastPathComponent() // transit-core
        .deletingLastPathComponent() // packages
        .deletingLastPathComponent() // repository
        .appendingPathComponent("fixtures/transit/api-contract")

    /// The recorded answer as the transport would deliver it.
    static func response(_ name: String) throws -> LiveHTTPResponse {
        let data = try Data(contentsOf: directory.appendingPathComponent("\(name).json"))
        let exchange = try JSONDecoder().decode(Exchange.self, from: data)
        XCTAssertTrue(exchange.synthetic, "\(name) must be labelled synthetic")
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let body: Data
        if let payload = object?["body"], !(payload is NSNull) {
            body = try JSONSerialization.data(withJSONObject: payload)
        } else {
            body = Data()
        }
        return LiveHTTPResponse(status: exchange.status, body: body)
    }

    static func session(_ name: String) throws -> LiveSession {
        try JSONDecoder().decode(LiveSession.self, from: response(name).body)
    }
}

private let api = LiveEnvironment(baseURL: URL(string: "https://api.example.test")!)!

private func client(_ transport: ScriptedTransport, retry: LiveRetryPolicy = .standard, slept: SleepLog = SleepLog()) -> LiveAPIClient {
    LiveAPIClient(environment: api, transport: transport, retry: retry, sleep: { duration in slept.record(duration) })
}

final class SleepLog: @unchecked Sendable {
    private let lock = NSLock()
    private var log: [Duration] = []
    func record(_ duration: Duration) { lock.withLock { log.append(duration) } }
    var durations: [Duration] { lock.withLock { log } }
}

final class LiveContractTests: XCTestCase {
    func testEveryRecordedExchangeDecodes() throws {
        let routes = try JSONDecoder().decode(LiveItems<LiveRoute>.self, from: Contract.response("routes").body).items
        XCTAssertEqual(routes.map(\.routeId), ["JEB405136521", "JEB405136522"])
        XCTAssertEqual(routes.first?.endStopName, "국립제주박물관")

        let stops = try JSONDecoder().decode(LiveStopList.self, from: Contract.response("stops").body)
        XCTAssertEqual(stops.items.count, 10)
        XCTAssertEqual(stops.items[8].name, "제주시청(아라방면)")
        XCTAssertEqual(stops.topology, "linear")

        let vehicles = try JSONDecoder().decode(LiveItems<LiveVehicle>.self, from: Contract.response("vehicles").body).items
        XCTAssertEqual(vehicles.count, 2)
        XCTAssertNotNil(vehicles.first?.stopSequence)

        for name in ["session-created", "session-confirmed", "session-tracking", "session-approaching", "session-next-stop", "session-arrived", "session-vehicle-missing", "session-provider-failed"] {
            XCTAssertNoThrow(try Contract.session(name), name)
        }
    }

    func testTheClientDecodesNoMatcherOutput() throws {
        // At READY_FOR_SHADOW riders see nothing from the matcher: the server's
        // ranking and its would-be pick are not even decoded.
        let session = try Contract.session("session-created")
        let fields = Set(Mirror(reflecting: session).children.compactMap(\.label))
        XCTAssertFalse(fields.contains("candidates"))
        XCTAssertFalse(fields.contains("shadowSelection"))
        let raw = try JSONSerialization.jsonObject(with: Contract.response("session-created").body) as? [String: Any]
        XCTAssertNotNil(raw?["candidates"], "the server does publish its ranking; the client chooses not to read it")
    }

    func testRecordedSessionsDriveTheRideMomentsInOrder() throws {
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        var ride = LiveRide(session: try Contract.session("session-created"), at: now)
        XCTAssertEqual(ride.stage, .choosingVehicle)
        XCTAssertNil(ride.signal(now: now, isOffline: false), "no ride before the rider confirms a bus")

        let expectations: [(String, RideMoment)] = [
            ("session-confirmed", .checking),      // cadence not yet established
            ("session-tracking", .riding),
            ("session-approaching", .prepare),
            ("session-next-stop", .nextStop),
            ("session-arrived", .arrived),
            ("session-vehicle-missing", .vehicleLost),
            ("session-provider-failed", .delayed),
        ]
        for (name, moment) in expectations {
            ride.apply(try Contract.session(name), at: now)
            XCTAssertEqual(ride.stage, .riding, name)
            XCTAssertEqual(ride.guidance(now: now, isOffline: false)?.moment, moment, name)
        }
    }

    func testRecordedErrorsMapToWhatTheRiderIsTold() throws {
        let cases: [(String, LiveAPIError, LiveIssue)] = [
            ("error-session-not-found", .sessionNotFound, .sessionEnded),
            ("error-sessions-unavailable", .sessionsUnavailable, .serviceUnavailable),
            ("error-provider-unavailable", .providerUnavailable, .providerUnavailable),
            ("error-invalid-input", .invalidRequest(code: "INVALID_INPUT"), .setupInvalid),
        ]
        for (name, error, issue) in cases {
            let mapped = LiveAPIClient.error(for: try Contract.response(name))
            XCTAssertEqual(mapped, error, name)
            XCTAssertEqual(LiveIssue(mapped), issue, name)
        }
    }
}

final class LiveAPIClientTests: XCTestCase {
    func testReadsRetryTransientFailuresWithBoundedBackoff() async throws {
        let transport = ScriptedTransport([
            .fail(.timeout),
            .answer(LiveHTTPResponse(status: 500, body: Data(#"{"error":"INTERNAL_ERROR","message":"internal error"}"#.utf8))),
            .answer(try Contract.response("routes")),
        ])
        let slept = SleepLog()
        let routes = try await client(transport, slept: slept).routes(cityCode: "39", routeNumber: "365")
        XCTAssertEqual(routes.count, 2)
        XCTAssertEqual(transport.sent.count, 3)
        XCTAssertEqual(slept.durations, [.milliseconds(500), .seconds(1)])
    }

    func testReadsGiveUpAfterTheLastAttempt() async {
        let transport = ScriptedTransport([.fail(.network), .fail(.network), .fail(.network), .fail(.network)])
        do {
            _ = try await client(transport).routes(cityCode: "39", routeNumber: "365")
            XCTFail("expected a failure")
        } catch {
            XCTAssertEqual(error as? LiveAPIError, .network)
        }
        XCTAssertEqual(transport.sent.count, 3)
    }

    func testCreatingAndConfirmingAreNeverRetried() async throws {
        let transport = ScriptedTransport([.fail(.timeout), .fail(.timeout)])
        let api = client(transport)
        let request = LiveSessionRequest(routeId: "JEB405136521", cityCode: "39", boardingStopSequence: 1, destinationStopSequence: 9)
        await XCTAssertThrowsLive(try await api.createSession(request), .timeout)
        await XCTAssertThrowsLive(try await api.confirm(sessionId: "synthetic-session-1", vehicleId: "x"), .timeout)
        XCTAssertEqual(transport.sent.count, 2)
        XCTAssertEqual(transport.sent.map(\.method), ["POST", "POST"])
    }

    func testRateLimitHonoursRetryAfterOnlyWithinTheCap() async throws {
        let transport = ScriptedTransport([
            .answer(LiveHTTPResponse(status: 429, headers: ["Retry-After": "2"], body: Data(#"{"error":"RATE_LIMITED"}"#.utf8))),
            .answer(try Contract.response("stops")),
        ])
        let slept = SleepLog()
        _ = try await client(transport, slept: slept).stops(routeId: "JEB405136521", cityCode: "39")
        XCTAssertEqual(slept.durations, [.seconds(2)])

        let tooLong = ScriptedTransport([
            .answer(LiveHTTPResponse(status: 429, headers: ["retry-after": "30"], body: Data(#"{"error":"RATE_LIMITED"}"#.utf8))),
        ])
        await XCTAssertThrowsLive(try await client(tooLong).stops(routeId: "JEB405136521", cityCode: "39"), .rateLimited(retryAfter: 30))
        XCTAssertEqual(tooLong.sent.count, 1)
    }

    func testSessionLifecycleRequestsMatchTheContract() async throws {
        let transport = ScriptedTransport([
            .answer(try Contract.response("session-created")),
            .answer(try Contract.response("session-confirmed")),
            .answer(try Contract.response("session-tracking")),
            .answer(try Contract.response("session-ended")),
        ])
        let api = client(transport)
        let created = try await api.createSession(LiveSessionRequest(routeId: "JEB405136521", cityCode: "39", boardingStopSequence: 1, destinationStopSequence: 9))
        let confirmed = try await api.confirm(sessionId: created.id, vehicleId: "제주70자0001")
        XCTAssertEqual(confirmed.selectedVehicleId, "제주70자0001")
        _ = try await api.session(id: created.id)
        try await api.endSession(id: created.id)

        let sent = transport.sent
        XCTAssertEqual(sent.map(\.method), ["POST", "POST", "GET", "DELETE"])
        XCTAssertEqual(sent.map { $0.url.path }, ["/v1/sessions", "/v1/sessions/synthetic-session-1/confirm", "/v1/sessions/synthetic-session-1", "/v1/sessions/synthetic-session-1"])
        let body = try XCTUnwrap(sent[0].body.flatMap { try JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        XCTAssertEqual(body["riderState"] as? String, "waiting_at_stop")
        XCTAssertEqual(body["boardingStopSequence"] as? Int, 1)
        let confirm = try XCTUnwrap(sent[1].body.flatMap { try JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        XCTAssertEqual(confirm as? [String: String], ["vehicleId": "제주70자0001"])
    }

    func testEndingARideThatIsAlreadyGoneCountsAsEnded() async throws {
        let transport = ScriptedTransport([.answer(try Contract.response("error-session-not-found"))])
        try await client(transport).endSession(id: "synthetic-session-1")
    }

    func testSessionIdsAndBaseURLsAreValidatedBeforeAnyRequest() async {
        let transport = ScriptedTransport([])
        await XCTAssertThrowsLive(try await client(transport).session(id: "../health"), .invalidRequest(code: "SESSION_ID"))
        await XCTAssertThrowsLive(try await client(transport).session(id: "세션"), .invalidRequest(code: "SESSION_ID"))
        XCTAssertTrue(transport.sent.isEmpty)

        XCTAssertNil(LiveEnvironment(baseURL: URL(string: "http://tapso-api.vercel.app")!), "plain HTTP only for a local server")
        XCTAssertNotNil(LiveEnvironment(baseURL: URL(string: "http://127.0.0.1:8787")!))
        XCTAssertNil(LiveEnvironment(baseURL: URL(string: "https://user:pass@api.example.test")!))
        XCTAssertEqual(LiveEnvironment.production.baseURL.host, "tapso-api.vercel.app")
        XCTAssertEqual(
            try LiveEnvironment.production.url("/v1/stops", query: ["routeId": "A", "cityCode": "39"]).absoluteString,
            "https://tapso-api.vercel.app/v1/stops?cityCode=39&routeId=A"
        )
    }

    func testCancellationStopsWithoutRetrying() async {
        let transport = ScriptedTransport([.fail(.cancelled), .answer(LiveHTTPResponse(status: 200))])
        await XCTAssertThrowsLive(try await client(transport).routes(cityCode: "39", routeNumber: "365"), .cancelled)
        XCTAssertEqual(transport.sent.count, 1)
    }

    func testUndecodableAnswersAreReportedAsSuch() async {
        let transport = ScriptedTransport([.answer(LiveHTTPResponse(status: 200, body: Data("<html>".utf8)))])
        await XCTAssertThrowsLive(try await client(transport).routes(cityCode: "39", routeNumber: "365"), .decoding)
    }
}

final class LiveRideTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_790_000_000)

    private func riding() throws -> LiveRide {
        var ride = LiveRide(session: try Contract.session("session-created"), at: start)
        ride.apply(try Contract.session("session-tracking"), at: start)
        return ride
    }

    func testSilenceFromTheServerTurnsTheRideDelayedThenStale() throws {
        let ride = try riding()
        XCTAssertEqual(ride.guidance(now: start.addingTimeInterval(40), isOffline: false)?.moment, .riding)
        XCTAssertEqual(ride.guidance(now: start.addingTimeInterval(60), isOffline: false)?.moment, .delayed)
        XCTAssertEqual(ride.guidance(now: start.addingTimeInterval(121), isOffline: false)?.moment, .delayed)
        XCTAssertEqual(ride.guidance(now: start.addingTimeInterval(60), isOffline: false)?.count, .lastKnown)
    }

    func testOfflineIsItsOwnMomentAndRecoveryClearsIt() throws {
        var ride = try riding()
        ride.apply(.offline, at: start.addingTimeInterval(15))
        XCTAssertEqual(ride.issue, .offline)
        XCTAssertEqual(ride.guidance(now: start.addingTimeInterval(15), isOffline: false)?.moment, .offline)
        ride.apply(try Contract.session("session-tracking"), at: start.addingTimeInterval(30))
        XCTAssertNil(ride.issue)
        XCTAssertEqual(ride.guidance(now: start.addingTimeInterval(30), isOffline: false)?.moment, .riding)
    }

    func testAnExpiredOrMissingSessionEndsTheRide() throws {
        var ride = try riding()
        ride.apply(.sessionExpired, at: start)
        XCTAssertEqual(ride.stage, .ended(.sessionEnded))
        XCTAssertEqual(ride.issue, .sessionEnded)
        XCTAssertNil(ride.signal(now: start, isOffline: false))
        ride.apply(try Contract.session("session-tracking"), at: start)
        XCTAssertEqual(ride.stage, .ended(.sessionEnded), "an ended ride is not revived by a late answer")
    }

    func testEachMilestoneAlertsOnce() throws {
        var ride = try riding()
        XCTAssertNil(ride.takeMilestone(now: start, isOffline: false))
        ride.apply(try Contract.session("session-approaching"), at: start)
        XCTAssertEqual(ride.takeMilestone(now: start, isOffline: false), .prepare)
        XCTAssertNil(ride.takeMilestone(now: start, isOffline: false))
        ride.apply(try Contract.session("session-provider-failed"), at: start)
        XCTAssertNil(ride.takeMilestone(now: start, isOffline: false), "late data never alerts")
        ride.apply(try Contract.session("session-approaching"), at: start)
        XCTAssertNil(ride.takeMilestone(now: start, isOffline: false), "the same milestone does not alert twice")
        ride.apply(try Contract.session("session-next-stop"), at: start)
        XCTAssertEqual(ride.takeMilestone(now: start, isOffline: false), .nextStop)
        ride.apply(try Contract.session("session-arrived"), at: start)
        XCTAssertEqual(ride.takeMilestone(now: start, isOffline: false), .arrived)
    }

    func testPollingBacksOffWhileFailingAndRecovers() throws {
        var ride = try riding()
        XCTAssertEqual(ride.nextPollDelay, .seconds(15))
        ride.apply(.timeout, at: start)
        XCTAssertEqual(ride.nextPollDelay, .seconds(30))
        ride.apply(.timeout, at: start)
        ride.apply(.timeout, at: start)
        ride.apply(.timeout, at: start)
        XCTAssertEqual(ride.nextPollDelay, .seconds(90))
        ride.apply(.rateLimited(retryAfter: nil), at: start)
        XCTAssertEqual(ride.nextPollDelay, .seconds(60))
        ride.apply(try Contract.session("session-tracking"), at: start)
        XCTAssertEqual(ride.nextPollDelay, .seconds(15))
        let choosing = LiveRide(session: try Contract.session("session-created"), at: start)
        XCTAssertEqual(choosing.nextPollDelay, .seconds(20))
    }

    func testCancelledRequestsChangeNothing() throws {
        var ride = try riding()
        ride.apply(.cancelled, at: start)
        XCTAssertNil(ride.issue)
        XCTAssertEqual(ride.consecutiveFailures, 0)
    }

    func testAnswersForAnotherSessionAreIgnored() throws {
        var ride = try riding()
        let other = LiveSession(
            id: "another",
            routeId: "JEB405136521",
            cityCode: "39",
            boardingStop: LiveStop(stopId: "S1", name: "a", sequence: 1),
            destinationStop: LiveStop(stopId: "S9", name: "b", sequence: 9),
            selectedVehicleId: "x",
            state: .arrived,
            progress: LiveProgress(currentStopSequence: 9, remainingStops: 0, phase: .arrived, source: "provider_stop_sequence")
        )
        ride.apply(other, at: start)
        XCTAssertEqual(ride.session.id, "synthetic-session-1")
    }
}

final class LiveVehicleBoardTests: XCTestCase {
    private func vehicle(_ id: String, _ sequence: Int?) -> LiveVehicle {
        LiveVehicle(vehicleId: id, routeId: "R", stopSequence: sequence)
    }

    func testBusesNearTheStopAreListedNearestFirstFromRawPositions() {
        let choices = LiveVehicleBoard.choices(
            vehicles: [vehicle("제주70자0932", 7), vehicle("제주70자0001", 10), vehicle("제주70자0417", 11), vehicle("제주70자9999", 2), vehicle("제주70자5555", nil)],
            boardingSequence: 10
        )
        XCTAssertEqual(choices.map(\.vehicleId), ["제주70자0001", "제주70자0932", "제주70자0417"])
        XCTAssertEqual(choices.map(\.stopsAway), [0, 3, -1])
        XCTAssertEqual(choices.map(\.maskedPlate), ["••0001", "••0932", "••0417"])
    }

    func testABusSeenTwiceIsListedOnceAtItsNearerPlace() {
        let choices = LiveVehicleBoard.choices(vehicles: [vehicle("A1234", 6), vehicle("A1234", 8)], boardingSequence: 9)
        XCTAssertEqual(choices.map(\.stopsAway), [1])
    }

    func testNoBusNearbyIsAnEmptyListNotAGuess() {
        XCTAssertTrue(LiveVehicleBoard.choices(vehicles: [vehicle("A1234", 1)], boardingSequence: 20).isEmpty)
        XCTAssertTrue(LiveVehicleBoard.choices(vehicles: [], boardingSequence: 3).isEmpty)
    }
}

func XCTAssertThrowsLive<T>(
    _ expression: @autoclosure () async throws -> T,
    _ expected: LiveAPIError,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        _ = try await expression()
        XCTFail("expected \(expected)", file: file, line: line)
    } catch {
        XCTAssertEqual(error as? LiveAPIError, expected, file: file, line: line)
    }
}
