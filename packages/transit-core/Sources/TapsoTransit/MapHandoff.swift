import Foundation

/// Hands the walk after the bus to a map app, and nothing more.
///
/// Only URL shapes from each vendor's published scheme guide are built here;
/// see `docs/product/MAP_APP_HANDOFF_V2.md` for the sources and their labels.
/// A route pinned to a bus number or boarding stop is not documented by
/// either vendor, so TAPSO never tries to build one.
public enum MapApp: String, CaseIterable, Codable, Hashable, Sendable {
    case naverMap
    case kakaoMap

    public var scheme: String {
        switch self {
        case .naverMap: "nmap"
        case .kakaoMap: "kakaomap"
        }
    }
}

public struct MapHandoffRequest: Hashable, Sendable {
    public let app: MapApp
    public let urlString: String
}

public enum MapHandoff {
    /// Identifies TAPSO to NAVER Map, whose scheme requires an `appname` on every call.
    public static let appName = "com.lucanomics.tapso"

    /// A walking hand-off to `stop`, or `nil` when no honest one exists.
    ///
    /// - Parameter coordinatesAreSurveyed: `false` for synthetic stops. A walking
    ///   route to invented coordinates would send the rider somewhere wrong, so
    ///   only a name search is offered for them, and only where the vendor
    ///   documents one.
    public static func walkingRequest(
        to stop: Stop,
        in app: MapApp,
        coordinatesAreSurveyed: Bool
    ) -> MapHandoffRequest? {
        switch (app, coordinatesAreSurveyed) {
        case (.naverMap, true):
            return request(app, path: "route/walk", [
                ("dlat", format(stop.coordinate.latitude)),
                ("dlng", format(stop.coordinate.longitude)),
                ("dname", stop.name),
                ("appname", appName)
            ])
        case (.naverMap, false):
            return request(app, path: "search", [("query", stop.name), ("appname", appName)])
        case (.kakaoMap, true):
            return request(app, path: "route", [
                ("ep", "\(format(stop.coordinate.latitude)),\(format(stop.coordinate.longitude))"),
                ("by", "FOOT")
            ])
        case (.kakaoMap, false):
            // KakaoMap's guide documents its keyword search only for the web, not the app scheme.
            return nil
        }
    }

    private static func request(_ app: MapApp, path: String, _ items: [(String, String)]) -> MapHandoffRequest {
        var components = URLComponents()
        components.scheme = app.scheme
        components.host = path.split(separator: "/").first.map(String.init)
        let rest = path.split(separator: "/").dropFirst().joined(separator: "/")
        components.path = rest.isEmpty ? "" : "/" + rest
        components.queryItems = items.map { URLQueryItem(name: $0.0, value: $0.1) }
        return MapHandoffRequest(app: app, urlString: components.string ?? "")
    }

    private static func format(_ degrees: Double) -> String {
        String(format: "%.6f", degrees)
    }
}
