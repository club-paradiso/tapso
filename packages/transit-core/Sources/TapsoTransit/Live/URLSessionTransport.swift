import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The production transport: one ephemeral `URLSession`, no cookies, no cache,
/// no credential storage. The server's own cache headers decide freshness.
public struct URLSessionTransport: LiveHTTPTransport {
    private let session: URLSession

    public init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        session = URLSession(configuration: configuration)
    }

    public func send(_ request: LiveHTTPRequest) async throws -> LiveHTTPResponse {
        var urlRequest = URLRequest(url: request.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: request.timeout)
        urlRequest.httpMethod = request.method
        urlRequest.setValue("application/json", forHTTPHeaderField: "accept")
        if let body = request.body {
            urlRequest.httpBody = body
            urlRequest.setValue("application/json", forHTTPHeaderField: "content-type")
        }
        do {
            let (data, response) = try await session.data(for: urlRequest)
            guard let http = response as? HTTPURLResponse else { throw LiveAPIError.network }
            var headers: [String: String] = [:]
            for (key, value) in http.allHeaderFields {
                if let key = key as? String, let value = value as? String { headers[key.lowercased()] = value }
            }
            return LiveHTTPResponse(status: http.statusCode, headers: headers, body: data)
        } catch let error as LiveAPIError {
            throw error
        } catch is CancellationError {
            throw LiveAPIError.cancelled
        } catch let error as URLError {
            throw Self.classify(error)
        } catch {
            throw LiveAPIError.network
        }
    }

    static func classify(_ error: URLError) -> LiveAPIError {
        switch error.code {
        case .cancelled: return .cancelled
        case .timedOut: return .timeout
        case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff: return .offline
        default: return .network
        }
    }
}

extension LiveAPIClient {
    /// The client over the real network. The only way the app reaches the transit API.
    public static func live(environment: LiveEnvironment) -> LiveAPIClient {
        LiveAPIClient(environment: environment, transport: URLSessionTransport())
    }
}
