import Foundation
import TapsoTransit
import XCTest
@testable import Tapso

/// The app's one network client and the live ride flow it drives, against a
/// stubbed transport. Payloads are SYNTHETIC and shaped like the server's own
/// (`fixtures/journey/session-views-v1.json`, generated from the coordinator).
/// No request leaves the test process.
@MainActor
final class TapsoAPIClientTests: XCTestCase {
    // Every test starts with `StubURLProtocol.respond` or `.fail`, which also clears what earlier tests recorded.

    // MARK: Client

    func testRoutesAsksTheTapsoAPIForEveryVariantOfANumber() async throws {
        StubURLProtocol.respond { _ in (200, Payload.routes) }
        let routes = try await makeClient().routes(number: "202")
        XCTAssertEqual(routes.map(\.routeId), ["SYN-202-W", "SYN-202-E"])
        let request = try XCTUnwrap(StubURLProtocol.recorded.first)
        XCTAssertEqual(request.url?.host, "tapso-api.vercel.app")
        XCTAssertEqual(request.url?.path, "/v1/routes")
        let query = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(query.first { $0.name == "cityCode" }?.value, "39")
        XCTAssertEqual(query.first { $0.name == "routeNo" }?.value, "202")
    }

    func testCreatingASessionDeclaresAWaitingRiderAndNoVehicle() async throws {
        StubURLProtocol.respond { _ in (201, Payload.session(state: "confirmation_required")) }
        let snapshot = try await makeClient().createSession(routeID: "SYN-202-W", cityCode: "39", boardingSequence: 4, destinationSequence: 10)
        XCTAssertEqual(snapshot.sessionState, .confirmationRequired)
        let request = try XCTUnwrap(StubURLProtocol.recorded.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/v1/sessions")
        let body = try XCTUnwrap(StubURLProtocol.bodies.first)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["riderState"] as? String, "waiting_at_stop")
        XCTAssertEqual(json["boardingStopSequence"] as? Int, 4)
        XCTAssertEqual(json["destinationStopSequence"] as? Int, 10)
        XCTAssertNil(json["vehicleId"], "a session never starts with a chosen bus")
    }

    func testEveryServerFailureKeepsItsMeaning() async {
        let cases: [(Int, String, TransitAPIFailure)] = [
            (503, #"{"error":"SESSIONS_UNAVAILABLE","message":"x"}"#, .sessionsUnavailable),
            (504, #"{"error":"PROVIDER_TIMEOUT","message":"x"}"#, .providerTimeout),
            (502, #"{"error":"PROVIDER_UNAVAILABLE","message":"x"}"#, .providerUnavailable),
            (502, #"{"error":"PROVIDER_RESPONSE_INVALID","message":"x"}"#, .providerInvalid),
            (500, #"{"error":"INTERNAL_ERROR","message":"internal error"}"#, .server),
            (410, #"{"error":"SESSION_EXPIRED","message":"x"}"#, .sessionExpired),
            (200, "not json", .unexpectedResponse),
        ]
        for (status, body, expected) in cases {
            StubURLProtocol.respond { _ in (status, Data(body.utf8)) }
            do {
                _ = try await makeClient().session(id: "syn-session")
                XCTFail("\(status) \(body) did not throw")
            } catch {
                XCTAssertEqual(error as? TransitAPIFailure, expected, "\(status) \(body)")
            }
        }
    }

    func testNoConnectionIsOfflineNotAServerFault() async {
        StubURLProtocol.fail(with: URLError(.notConnectedToInternet))
        do {
            _ = try await makeClient().routes(number: "202")
            XCTFail("expected a failure")
        } catch {
            XCTAssertEqual(error as? TransitAPIFailure, .offline)
        }
    }

    func testEndingASessionIsADelete() async throws {
        StubURLProtocol.respond { _ in (204, Data()) }
        try await makeClient().endSession(id: "syn-session")
        XCTAssertEqual(StubURLProtocol.recorded.first?.httpMethod, "DELETE")
        XCTAssertEqual(StubURLProtocol.recorded.first?.url?.path, "/v1/sessions/syn-session")
    }

    // MARK: Live ride flow

    /// Route number → variant → stops → server session → the rider's confirmation → ride → end.
    func testALiveRideIsConfirmedByTheRiderTrackedByTheServerAndEnded() async throws {
        StubURLProtocol.respond { request in
            switch (request.httpMethod ?? "GET", request.url?.path ?? "") {
            case ("GET", "/v1/routes"): (200, Payload.routes)
            case ("GET", "/v1/stops"): (200, Payload.stops)
            case ("POST", "/v1/sessions"): (201, Payload.session(state: "confirmation_required"))
            case ("POST", "/v1/sessions/syn-session/confirm"): (200, Payload.session(state: "tracking", selected: true))
            case ("GET", "/v1/sessions/syn-session"): (200, Payload.session(state: "tracking", selected: true))
            case ("DELETE", "/v1/sessions/syn-session"): (204, Data())
            default: (404, Data(#"{"error":"NOT_FOUND","message":"no such endpoint"}"#.utf8))
            }
        }
        let model = makeModel()
        model.openLiveSearch()
        await model.searchLiveRoutes(number: "202")
        guard case let .results(_, routes) = model.liveRouteSearch, let route = routes.first else {
            return XCTFail("no routes: \(model.liveRouteSearch)")
        }
        await model.chooseLiveRoute(route)
        guard case let .loaded(stops) = model.liveStops else { return XCTFail("no stops: \(model.liveStops)") }
        XCTAssertTrue(stops.coordinatesAreSurveyed)
        let boarding = try XCTUnwrap(stops.route.routeStop(sequence: 4))
        let destination = try XCTUnwrap(stops.route.routeStop(sequence: 10))
        model.chooseLiveStops(boarding: boarding, destination: destination, on: stops)
        XCTAssertEqual(model.path.last, .vehicleCheck)
        XCTAssertTrue(model.draft?.isLive ?? false)

        try await waitUntil { model.vehicleCheck.stage == .proposed }
        XCTAssertEqual(model.vehicleCheck.proposals.map(\.maskedPlate), ["••0412"])
        XCTAssertNil(model.activeRide, "nothing is selected before the rider taps")

        await model.confirmVehicle(try XCTUnwrap(model.vehicleCheck.proposals.first))
        XCTAssertTrue(model.isLiveRide)
        XCTAssertEqual(model.guidance?.moment, .riding)
        XCTAssertEqual(model.remainingStops, 5)
        XCTAssertEqual(model.currentStopName, "합성 정류장 5")
        XCTAssertEqual(model.library.recents.first?.isLive, true)
        let confirm = try XCTUnwrap(StubURLProtocol.bodies.last)
        let confirmJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: confirm) as? [String: Any])
        XCTAssertEqual(confirmJSON["vehicleId"] as? String, "SYN70가0412")

        await model.cancelRide()
        XCTAssertFalse(model.hasActiveRide)
        try await waitUntil { StubURLProtocol.recorded.contains { $0.httpMethod == "DELETE" } }
    }

    func testSessionsSwitchedOffOnTheServerAreSaidPlainlyAndNothingIsInvented() async throws {
        StubURLProtocol.respond { request in
            request.httpMethod == "POST"
                ? (503, Data(#"{"error":"SESSIONS_UNAVAILABLE","message":"journey sessions are disabled"}"#.utf8))
                : (200, Payload.stops)
        }
        let model = makeModel()
        let api = TransitAPIRoute(routeId: "SYN-202-W", routeNumber: "202", startStopName: "합성 정류장 1", endStopName: "합성 정류장 12")
        await model.chooseLiveRoute(api)
        guard case let .loaded(stops) = model.liveStops else { return XCTFail("no stops") }
        model.chooseLiveStops(
            boarding: try XCTUnwrap(stops.route.routeStop(sequence: 4)),
            destination: try XCTUnwrap(stops.route.routeStop(sequence: 10)),
            on: stops
        )
        try await waitUntil { model.liveFailure != nil }
        XCTAssertEqual(model.liveFailure, .sessionsUnavailable)
        XCTAssertTrue(model.vehicleCheck.proposals.isEmpty, "no bus is proposed without a server session")
        XCTAssertNil(model.activeRide)
    }

    func testALiveRideFromASharedPlaceSuggestsItsNearestStopAndWalksThere() async throws {
        StubURLProtocol.respond { request in
            switch (request.httpMethod ?? "GET", request.url?.path ?? "") {
            case ("GET", "/v1/routes"): (200, Payload.routes)
            case ("GET", "/v1/stops"): (200, Payload.stops)
            case ("POST", "/v1/sessions"): (201, Payload.session(state: "confirmation_required"))
            case ("POST", "/v1/sessions/syn-session/confirm"): (200, Payload.session(state: "tracking", selected: true))
            case ("GET", "/v1/sessions/syn-session"): (200, Payload.session(state: "tracking", selected: true))
            case ("DELETE", "/v1/sessions/syn-session"): (204, Data())
            default: (404, Data(#"{"error":"NOT_FOUND","message":"no such endpoint"}"#.utf8))
            }
        }
        let model = makeModel()
        model.openMapImport()
        // Synthetic share text, a few metres from synthetic stop 10.
        model.importSharedText("[네이버 지도] 합성 카페\n33.4701, 126.3201")
        let place = try XCTUnwrap(model.sharedPlace)
        model.continueWithLiveRoute()
        XCTAssertEqual(model.path, [.mapImport, .liveRoutes])
        XCTAssertEqual(model.handoffPlace, place)
        XCTAssertEqual(StubURLProtocol.recorded.count, 0, "reading the shared place made no request")

        await model.searchLiveRoutes(number: "202")
        guard case let .results(_, routes) = model.liveRouteSearch, let route = routes.first else {
            return XCTFail("no routes: \(model.liveRouteSearch)")
        }
        await model.chooseLiveRoute(route)
        guard case let .loaded(stops) = model.liveStops else { return XCTFail("no stops: \(model.liveStops)") }
        let boarding = try XCTUnwrap(stops.route.routeStop(sequence: 4))
        // What the destination step shows: the stops after boarding nearest the place.
        let match = HandoffStopSuggester.match(
            for: place,
            among: stops.route.stops.filter { $0.sequence > boarding.sequence },
            coordinatesAreSurveyed: stops.coordinatesAreSurveyed
        )
        guard case let .nearby(suggestions) = match else { return XCTFail("expected nearby stops, got \(match)") }
        XCTAssertEqual(suggestions.map(\.routeStop.sequence), [10, 11, 9])
        XCTAssertEqual(suggestions.first?.straightLineMeters, 10)
        XCTAssertFalse(
            StubURLProtocol.recorded.contains { ($0.url?.absoluteString.removingPercentEncoding ?? "").contains("합성 카페") },
            "the shared place never reaches the server"
        )

        let destination = try XCTUnwrap(suggestions.first?.routeStop)
        model.chooseLiveStops(boarding: boarding, destination: destination, on: stops)
        XCTAssertEqual(model.draft?.finalPlace, place)
        try await waitUntil { model.vehicleCheck.stage == .proposed }
        await model.confirmVehicle(try XCTUnwrap(model.vehicleCheck.proposals.first))
        XCTAssertEqual(model.activeRide?.draft.finalPlace, place)

        await model.finishRide()
        let outcome = try XCTUnwrap(model.outcome)
        let naver = try XCTUnwrap(URLComponents(string: try XCTUnwrap(model.mapRequest(for: .naverMap, outcome: outcome)).urlString))
        XCTAssertEqual(naver.host, "route")
        XCTAssertEqual(naver.path, "/walk")
        XCTAssertEqual(naver.queryItems?.first { $0.name == "dname" }?.value, "합성 카페")
        XCTAssertEqual(naver.queryItems?.first { $0.name == "dlat" }?.value, "33.470100")
        XCTAssertEqual(model.appleMapsTarget(for: outcome)?.coordinate, place.coordinate)
        for body in StubURLProtocol.bodies {
            XCTAssertFalse(String(decoding: body, as: UTF8.self).contains("합성 카페"), "the shared place stays on the device")
        }
        try await waitUntil { StubURLProtocol.recorded.contains { $0.httpMethod == "DELETE" } }
    }

    func testRouteInfoReadsOneVariantsPublishedServiceDay() async throws {
        StubURLProtocol.respond { _ in (200, Payload.routeInfo(routeID: "SYN-202-W", last: "22:30")) }
        let hours = try await makeClient().routeInfo(routeID: "SYN-202-W")
        XCTAssertEqual(hours.lastDeparture, "22:30")
        XCTAssertEqual(hours.firstDeparture, "06:00")
        XCTAssertEqual(hours.headwayMinutes.weekday, 30)
        let request = try XCTUnwrap(StubURLProtocol.recorded.first)
        XCTAssertEqual(request.url?.path, "/v1/route-info")
        let query = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(query.first { $0.name == "routeId" }?.value, "SYN-202-W")
        XCTAssertEqual(query.first { $0.name == "cityCode" }?.value, "39")
    }

    func testAfterALiveRideTheWayBackShowsTodaysLastBusOfEachVariant() async throws {
        StubURLProtocol.respond { request in
            let routeID = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "routeId" }?.value ?? ""
            switch (request.url?.path ?? "", routeID) {
            case ("/v1/routes", _): return (200, Payload.routes)
            case ("/v1/route-info", "SYN-202-W"): return (200, Payload.routeInfo(routeID: "SYN-202-W", last: "22:30"))
            default: return (404, Data(#"{"error":"NOT_FOUND","message":"the provider has no route with that routeId"}"#.utf8))
            }
        }
        let model = makeModel()
        let outcome = RideOutcome(
            moment: .arrived,
            routeNumber: "202",
            destination: Stop(id: "SYN-STOP-10", name: "합성 정류장 10", coordinate: Coordinate(latitude: 33.47, longitude: 126.32)),
            cityCode: "39",
            routeID: "SYN-202-W"
        )
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = LastBus.timeZone
        let evening = calendar.date(from: DateComponents(year: 2026, month: 10, day: 1, hour: 21, minute: 30))!

        await model.loadReturnService(for: outcome, now: evening)
        guard case let .loaded(rows) = model.returnService else { return XCTFail("not loaded: \(model.returnService)") }
        XCTAssertEqual(rows.map(\.route.routeId), ["SYN-202-W", "SYN-202-E"])
        XCTAssertEqual(rows.map(\.ridden), [true, false])
        XCTAssertEqual(rows[0].advice.level, .leaveBy)
        XCTAssertEqual(rows[0].advice.beAtStopBy, "22:20")
        XCTAssertEqual(rows[1].advice.level, .unknown, "no published service day is unknown, never safe")

        let demo = RideOutcome(moment: .arrived, routeNumber: "365", destination: outcome.destination)
        model.dismissOutcome()
        StubURLProtocol.respond { _ in (500, Data()) }
        await model.loadReturnService(for: demo)
        XCTAssertEqual(model.returnService, .idle, "the synthetic demo has no way back to read")
        XCTAssertTrue(StubURLProtocol.recorded.isEmpty)
    }

    // MARK: Helpers

    private func makeClient() -> TapsoAPIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return TapsoAPIClient(session: URLSession(configuration: configuration))
    }

    private func makeModel() -> TapsoAppModel {
        TapsoAppModel(
            store: JourneyStore(defaults: UserDefaults(suiteName: "tapso.tests.\(UUID().uuidString)")!),
            liveActivity: nil,
            api: makeClient()
        )
    }

    private func waitUntil(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTFail("condition not met within 5 s", file: file, line: line)
    }
}

/// SYNTHETIC payloads in the server's shapes.
private enum Payload {
    static let routes = Data(#"""
    {"items":[
      {"routeId":"SYN-202-W","routeNumber":"202","startStopName":"합성 정류장 1","endStopName":"합성 정류장 12"},
      {"routeId":"SYN-202-E","routeNumber":"202","startStopName":"합성 정류장 12","endStopName":"합성 정류장 1"}
    ],"meta":{"provider":"synthetic","cityCode":"39","routeNo":"202","count":2,"variantsPreserved":true}}
    """#.utf8)

    static let stops: Data = {
        let items = (1...12).map { index in
            #"{"stopId":"SYN-STOP-\#(index)","name":"합성 정류장 \#(index)","sequence":\#(index),"latitude":\#(33.45 + Double(index) * 0.002),"longitude":\#(126.3 + Double(index) * 0.002)}"#
        }
        return Data(#"{"items":[\#(items.joined(separator: ","))],"meta":{"topology":{"kind":"linear"}}}"#.utf8)
    }()

    static func routeInfo(routeID: String, last: String) -> Data {
        Data(#"""
        {"item":{"routeId":"\#(routeID)","routeNumber":"202","startStopName":"합성 정류장 1","endStopName":"합성 정류장 12","firstDeparture":"06:00","lastDeparture":"\#(last)","headwayMinutes":{"weekday":30}},"meta":{"provider":"synthetic","timeReference":"starting_stop_departure"}}
        """#.utf8)
    }

    static func session(state: String, selected: Bool = false) -> Data {
        let stop = { (sequence: Int) in
            #"{"stopId":"SYN-STOP-\#(sequence)","name":"합성 정류장 \#(sequence)","sequence":\#(sequence)}"#
        }
        let candidates = selected ? "" : #","candidates":[{"vehicleId":"SYN70가0412","score":0,"evidence":[],"rejectedReasons":[],"stopOffset":-2,"zone":"approaching"}]"#
        let selection = selected ? #","selectedVehicleId":"SYN70가0412","selectionMode":"explicit""# : ""
        let progress = selected
            ? #","progress":{"currentStopSequence":5,"currentStopId":"SYN-STOP-5","remainingStops":5,"phase":"active","source":"provider_stop_sequence","observedAt":"1970-01-01T00:00:00.000Z"}"#
            : ""
        return Data(#"""
        {"id":"syn-session","routeId":"SYN-202-W","cityCode":"39","boardingStop":\#(stop(4)),"destinationStop":\#(stop(10)),"riderState":"waiting_at_stop","matchConfidence":"unknown","state":"\#(state)","explanation":"synthetic","matchingMode":"shadow"\#(selection)\#(progress)\#(candidates),"createdAt":"2026-10-01T06:00:00.000Z","updatedAt":"2026-10-01T06:00:10.000Z","expiresAt":"2026-10-01T10:00:00.000Z"}
        """#.utf8)
    }
}

/// Answers every request in-process; nothing reaches the network.
final class StubURLProtocol: URLProtocol {
    nonisolated(unsafe) private static var handler: (@Sendable (URLRequest) -> (Int, Data))?
    nonisolated(unsafe) private static var failure: URLError?
    nonisolated(unsafe) private(set) static var recorded: [URLRequest] = []
    nonisolated(unsafe) private(set) static var bodies: [Data] = []
    private static let lock = NSLock()

    /// Answers every request with `handler`, forgetting what earlier tests recorded.
    /// The handler runs on URLSession's loading thread, never the main actor, so it is
    /// `@Sendable` and cannot inherit the calling test's main-actor isolation.
    static func respond(_ handler: @escaping @Sendable (URLRequest) -> (Int, Data)) {
        lock.withLock {
            self.handler = handler
            failure = nil
            recorded = []
            bodies = []
        }
    }

    /// Fails every request with `error`, forgetting what earlier tests recorded.
    static func fail(with error: URLError) {
        lock.withLock {
            handler = nil
            failure = error
            recorded = []
            bodies = []
        }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let body = Self.readBody(of: request)
        let (handler, failure) = Self.lock.withLock { () -> ((@Sendable (URLRequest) -> (Int, Data))?, URLError?) in
            Self.recorded.append(request)
            if let body { Self.bodies.append(body) }
            return (Self.handler, Self.failure)
        }
        if let failure {
            client?.urlProtocol(self, didFailWithError: failure)
            return
        }
        guard let handler, let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }
        let (status, data) = handler(request)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    /// URLSession hands a protocol the body as a stream, not as `httpBody`.
    private static func readBody(of request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
