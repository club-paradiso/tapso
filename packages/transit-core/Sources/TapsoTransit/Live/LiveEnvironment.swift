import Foundation

/// Where the transit API lives. One configurable base URL, as the contract
/// requires (`docs/PRODUCTION_TRANSIT_API.md` › Base URL contract): never a
/// per-deployment preview host. The client holds no credential of any kind;
/// the provider key exists only on the server.
public struct LiveEnvironment: Hashable, Sendable {
    public let baseURL: URL

    /// The canonical production deployment.
    public static let production = LiveEnvironment(validated: URL(string: "https://tapso-api.vercel.app")!)

    /// Accepts `https` anywhere and plain `http` only for the local development server.
    public init?(baseURL: URL) {
        guard let scheme = baseURL.scheme?.lowercased(), let host = baseURL.host?.lowercased() else { return nil }
        let local = host == "127.0.0.1" || host == "localhost"
        guard scheme == "https" || (scheme == "http" && local) else { return nil }
        guard baseURL.query == nil, baseURL.fragment == nil, baseURL.user == nil, baseURL.password == nil else { return nil }
        self.init(validated: baseURL)
    }

    private init(validated: URL) {
        baseURL = validated
    }

    /// The URL for an API path, with query items encoded.
    public func url(_ path: String, query: [String: String] = [:]) throws -> URL {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw LiveAPIError.invalidRequest(code: "BASE_URL")
        }
        let basePath = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = basePath + path
        if !query.isEmpty {
            components.queryItems = query.keys.sorted().map { URLQueryItem(name: $0, value: query[$0]) }
        }
        guard let url = components.url else { throw LiveAPIError.invalidRequest(code: "URL") }
        return url
    }
}
