import Foundation

/// What went wrong talking to the transit API, in terms the app can act on.
public enum LiveAPIError: Error, Hashable, Sendable {
    /// No connection at all (airplane mode, no signal).
    case offline
    /// The request took longer than the client allows.
    case timeout
    /// The request was cancelled by its caller.
    case cancelled
    /// The connection failed in a way that may pass (reset, DNS hiccup).
    case network
    /// `429`; `retryAfter` in seconds when the server said.
    case rateLimited(retryAfter: Int?)
    /// `503 SESSIONS_UNAVAILABLE`: this deployment does not serve ride sessions.
    case sessionsUnavailable
    /// TAGO is not configured or answered unusably (`503 BLOCKED_BY_CREDENTIALS`, `502 PROVIDER_RESPONSE_INVALID`).
    case providerUnavailable
    /// `404 SESSION_NOT_FOUND`: the session ended or never existed.
    case sessionNotFound
    /// `410 SESSION_EXPIRED`
    case sessionExpired
    /// `400`: the request was wrong; retrying it cannot help.
    case invalidRequest(code: String)
    /// Any other server failure.
    case server(status: Int, code: String?)
    /// The answer could not be read as the contract says.
    case decoding

    /// Whether repeating the same idempotent request may succeed.
    public var isTransient: Bool {
        switch self {
        case .timeout, .network, .rateLimited:
            return true
        case .server(let status, _):
            return status >= 500 && status != 501
        case .providerUnavailable, .offline, .cancelled, .sessionsUnavailable, .sessionNotFound, .sessionExpired, .invalidRequest, .decoding:
            return false
        }
    }
}

/// One HTTP exchange, transport-neutral so tests can script the server.
public struct LiveHTTPRequest: Hashable, Sendable {
    public let method: String
    public let url: URL
    public let body: Data?
    public let timeout: TimeInterval

    public init(method: String, url: URL, body: Data? = nil, timeout: TimeInterval) {
        self.method = method
        self.url = url
        self.body = body
        self.timeout = timeout
    }
}

public struct LiveHTTPResponse: Hashable, Sendable {
    public let status: Int
    public let headers: [String: String]
    public let body: Data

    public init(status: Int, headers: [String: String] = [:], body: Data = Data()) {
        self.status = status
        self.headers = headers
        self.body = body
    }

    func header(_ name: String) -> String? {
        headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
    }
}

/// Sends one request. Throws `LiveAPIError` for failures below HTTP (offline, timeout, cancelled, network).
public protocol LiveHTTPTransport: Sendable {
    func send(_ request: LiveHTTPRequest) async throws -> LiveHTTPResponse
}

/// Bounded retries for idempotent requests only (`GET`, `DELETE`).
public struct LiveRetryPolicy: Hashable, Sendable {
    public let maxAttempts: Int
    public let baseDelay: Duration
    public let maxDelay: Duration

    public init(maxAttempts: Int, baseDelay: Duration, maxDelay: Duration) {
        precondition(maxAttempts >= 1)
        self.maxAttempts = maxAttempts
        self.baseDelay = baseDelay
        self.maxDelay = maxDelay
    }

    /// Three attempts, 0.5 s then 1 s apart; a server's `retry-after` is honoured up to 4 s.
    public static let standard = LiveRetryPolicy(maxAttempts: 3, baseDelay: .milliseconds(500), maxDelay: .seconds(4))
    public static let none = LiveRetryPolicy(maxAttempts: 1, baseDelay: .zero, maxDelay: .zero)

    /// The wait before attempt `attempt + 1`, or `nil` when the error must not be retried after `attempt`.
    public func delay(after attempt: Int, error: LiveAPIError) -> Duration? {
        guard attempt < maxAttempts, error.isTransient else { return nil }
        if case .rateLimited(let retryAfter?) = error {
            let requested = Duration.seconds(retryAfter)
            return requested <= maxDelay ? requested : nil
        }
        var delay = baseDelay
        for _ in 1..<attempt { delay = delay * 2 }
        return min(delay, maxDelay)
    }
}

/// The typed client for the TAPSO transit API. The server is authoritative for
/// matching; this client only reads, creates, confirms and ends.
public struct LiveAPIClient: Sendable {
    public let environment: LiveEnvironment
    private let transport: any LiveHTTPTransport
    private let retry: LiveRetryPolicy
    private let sleep: @Sendable (Duration) async throws -> Void
    private let requestTimeout: TimeInterval

    public init(
        environment: LiveEnvironment,
        transport: any LiveHTTPTransport,
        retry: LiveRetryPolicy = .standard,
        requestTimeout: TimeInterval = 12,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.environment = environment
        self.transport = transport
        self.retry = retry
        self.requestTimeout = requestTimeout
        self.sleep = sleep
    }

    /// Official route IDs for a route number: one per direction or variant, never collapsed.
    public func routes(cityCode: String, routeNumber: String) async throws -> [LiveRoute] {
        let url = try environment.url("/v1/routes", query: ["cityCode": cityCode, "routeNo": routeNumber])
        let list: LiveItems<LiveRoute> = try await get(url)
        return list.items
    }

    /// A route ID's stops in order.
    public func stops(routeId: String, cityCode: String) async throws -> LiveStopList {
        let url = try environment.url("/v1/stops", query: ["routeId": routeId, "cityCode": cityCode])
        let list: LiveStopList = try await get(url)
        return LiveStopList(items: list.items.sorted { $0.sequence < $1.sequence }, topology: list.topology)
    }

    /// Raw vehicle positions on a route ID (cached by the server for 20 s).
    public func vehicles(routeId: String, cityCode: String) async throws -> [LiveVehicle] {
        let url = try environment.url("/v1/vehicles", query: ["routeId": routeId, "cityCode": cityCode])
        let list: LiveItems<LiveVehicle> = try await get(url)
        return list.items
    }

    /// Starts a ride session. Not retried: a repeat could open a second session.
    public func createSession(_ request: LiveSessionRequest) async throws -> LiveSession {
        let url = try environment.url("/v1/sessions")
        return try await send("POST", url, body: try encode(request), retrying: false)
    }

    /// Refreshes a session: the server re-reads the provider and recomputes progress.
    public func session(id: String) async throws -> LiveSession {
        let url = try environment.url("/v1/sessions/\(try Self.pathSegment(id))")
        return try await get(url)
    }

    /// The rider's own choice of bus. Not retried; confirming again is the rider's call.
    public func confirm(sessionId: String, vehicleId: String) async throws -> LiveSession {
        let url = try environment.url("/v1/sessions/\(try Self.pathSegment(sessionId))/confirm")
        return try await send("POST", url, body: try encode(LiveConfirmRequest(vehicleId: vehicleId)), retrying: false)
    }

    /// Ends a ride. Ending one that is already gone counts as ended.
    public func endSession(id: String) async throws {
        let url = try environment.url("/v1/sessions/\(try Self.pathSegment(id))")
        do {
            _ = try await exchange(LiveHTTPRequest(method: "DELETE", url: url, timeout: requestTimeout), retrying: true)
        } catch LiveAPIError.sessionNotFound {
            return
        } catch LiveAPIError.sessionExpired {
            return
        }
    }

    // MARK: Plumbing

    private func get<T: Decodable>(_ url: URL) async throws -> T {
        try await send("GET", url, body: nil, retrying: true)
    }

    private func send<T: Decodable>(_ method: String, _ url: URL, body: Data?, retrying: Bool) async throws -> T {
        let response = try await exchange(LiveHTTPRequest(method: method, url: url, body: body, timeout: requestTimeout), retrying: retrying)
        do {
            return try JSONDecoder().decode(T.self, from: response.body)
        } catch {
            throw LiveAPIError.decoding
        }
    }

    private func exchange(_ request: LiveHTTPRequest, retrying: Bool) async throws -> LiveHTTPResponse {
        var attempt = 1
        while true {
            do {
                try Task.checkCancellation()
                let response = try await transport.send(request)
                if (200..<300).contains(response.status) { return response }
                throw Self.error(for: response)
            } catch let error as LiveAPIError {
                guard retrying, let delay = retry.delay(after: attempt, error: error) else { throw error }
                do {
                    try await sleep(delay)
                } catch {
                    throw LiveAPIError.cancelled
                }
                attempt += 1
            } catch is CancellationError {
                throw LiveAPIError.cancelled
            } catch {
                throw LiveAPIError.network
            }
        }
    }

    static func error(for response: LiveHTTPResponse) -> LiveAPIError {
        let code = (try? JSONDecoder().decode(LiveErrorBody.self, from: response.body))?.error
        switch (response.status, code) {
        case (429, _):
            return .rateLimited(retryAfter: response.header("retry-after").flatMap { Int($0) })
        case (503, "SESSIONS_UNAVAILABLE"):
            return .sessionsUnavailable
        case (503, "BLOCKED_BY_CREDENTIALS"), (502, "PROVIDER_RESPONSE_INVALID"):
            return .providerUnavailable
        case (404, "SESSION_NOT_FOUND"):
            return .sessionNotFound
        case (410, _):
            return .sessionExpired
        case (400, let code):
            return .invalidRequest(code: code ?? "INVALID_INPUT")
        default:
            return .server(status: response.status, code: code)
        }
    }

    private func encode<T: Encodable>(_ value: T) throws -> Data {
        do {
            return try JSONEncoder().encode(value)
        } catch {
            throw LiveAPIError.invalidRequest(code: "ENCODING")
        }
    }

    /// Session ids are server-generated; anything that is not a plain token is refused before it reaches a URL.
    /// The server's own session id pattern: `[A-Za-z0-9_-]{1,64}`.
    static func pathSegment(_ value: String) throws -> String {
        let valid = !value.isEmpty && value.utf8.count <= 64 && value.utf8.allSatisfy { byte in
            (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A) || byte == 0x2D || byte == 0x5F
        }
        guard valid else { throw LiveAPIError.invalidRequest(code: "SESSION_ID") }
        return value
    }
}
