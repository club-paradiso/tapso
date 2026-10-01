import Foundation
import TapsoTransit

/// TAPSO's one network client.
///
/// It talks only to TAPSO's own transit API — never to the government feed,
/// whose credential stays on the server — and it only carries what the server
/// decided: route variants, stop lists, and journey sessions in which a bus is
/// selected by the rider's confirmation (`docs/PRODUCTION_TRANSIT_API.md`).
/// Nothing it returns reaches the demo-only `VehicleMatchingEngine`;
/// `services/api/test/crossLanguageAuthority.test.ts` keeps every network API
/// in this file and keeps the Swift matcher's types out of it.
struct TapsoAPIClient: Sendable {
    /// The canonical production API. Public by design; it holds no secret.
    static let productionBaseURL = URL(string: "https://tapso-api.vercel.app")!
    /// Jeju, as TAGO numbers it (`GET /v1/cities`).
    static let jejuCityCode = "39"
    /// The server retries a slow feed once within its own 8-second deadline per try.
    static let requestTimeout: TimeInterval = 20

    let baseURL: URL
    let session: URLSession

    init(baseURL: URL = TapsoAPIClient.productionBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    // MARK: Reads

    /// Every official variant of a route number: one per direction and branch.
    func routes(number: String, cityCode: String = TapsoAPIClient.jejuCityCode) async throws -> [TransitAPIRoute] {
        let request = makeRequest(path: "/v1/routes", query: [("cityCode", cityCode), ("routeNo", number)])
        return try await send(request, as: TransitAPIRouteList.self).items
    }

    /// The ordered stops of one variant.
    func stops(routeID: String, cityCode: String = TapsoAPIClient.jejuCityCode) async throws -> TransitAPIStopList {
        let request = makeRequest(path: "/v1/stops", query: [("routeId", routeID), ("cityCode", cityCode)])
        return try await send(request, as: TransitAPIStopList.self)
    }

    // MARK: Journey sessions

    /// Starts a session for a rider waiting at the boarding stop.
    func createSession(
        routeID: String,
        cityCode: String,
        boardingSequence: Int,
        destinationSequence: Int
    ) async throws -> JourneySessionSnapshot {
        let body = SessionRequest(
            routeId: routeID,
            cityCode: cityCode,
            boardingStopSequence: boardingSequence,
            destinationStopSequence: destinationSequence,
            riderState: "waiting_at_stop"
        )
        let request = try makeRequest(path: "/v1/sessions", method: "POST", body: body)
        return try await send(request, as: JourneySessionSnapshot.self)
    }

    /// Reads the session; the server polls the bus feed for it.
    func session(id: String) async throws -> JourneySessionSnapshot {
        try await send(makeRequest(path: "/v1/sessions/\(escaped(id))"), as: JourneySessionSnapshot.self)
    }

    /// The rider's tap: this is what selects a bus.
    func confirm(sessionID: String, vehicleID: String) async throws -> JourneySessionSnapshot {
        let request = try makeRequest(
            path: "/v1/sessions/\(escaped(sessionID))/confirm",
            method: "POST",
            body: ConfirmRequest(vehicleId: vehicleID)
        )
        return try await send(request, as: JourneySessionSnapshot.self)
    }

    /// Ends the ride on the server, so it stops costing a feed read.
    func endSession(id: String) async throws {
        let (data, response) = try await perform(makeRequest(path: "/v1/sessions/\(escaped(id))", method: "DELETE"))
        try check(data, response)
    }

    // MARK: Private

    private struct SessionRequest: Encodable {
        let routeId: String
        let cityCode: String
        let boardingStopSequence: Int
        let destinationStopSequence: Int
        let riderState: String
    }

    private struct ConfirmRequest: Encodable {
        let vehicleId: String
    }

    private func makeRequest(path: String, method: String = "GET", query: [(String, String)] = []) -> URLRequest {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        components.percentEncodedPath = path
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.0, value: $0.1) }
        }
        var request = URLRequest(url: components.url ?? baseURL, timeoutInterval: Self.requestTimeout)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }

    private func makeRequest(path: String, method: String, body: some Encodable) throws -> URLRequest {
        var request = makeRequest(path: path, method: method)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try JSONEncoder().encode(body)
        } catch {
            throw TransitAPIFailure.rejected
        }
        return request
    }

    private func escaped(_ segment: String) -> String {
        segment.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? segment
    }

    private func send<Value: Decodable>(_ request: URLRequest, as type: Value.Type) async throws -> Value {
        let (data, response) = try await perform(request)
        try check(data, response)
        do {
            return try JSONDecoder().decode(Value.self, from: data)
        } catch {
            throw TransitAPIFailure.unexpectedResponse
        }
    }

    private func perform(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw TransitAPIFailure.classify(error)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw TransitAPIFailure.server
        }
    }

    private func check(_ data: Data, _ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw TransitAPIFailure.unexpectedResponse }
        guard !(200..<300).contains(http.statusCode) else { return }
        let body = try? JSONDecoder().decode(TransitAPIErrorBody.self, from: data)
        throw TransitAPIFailure.classify(status: http.statusCode, code: body?.error)
    }
}
