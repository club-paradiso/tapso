import Foundation
import TapsoTransit

/// TAPSO's real routes for a screenshot import, from TAPSO's own transit API.
///
/// Only a bus number leaves the phone (`/v1/routes?routeNo=`, then `/v1/stops`
/// for each variant), the same two reads the manual live setup makes. The
/// variants are kept as the stop pickers need them, so a confirmed import
/// continues into the existing live flow without another request.
actor LiveRouteImportCatalog: RouteImportCandidateSource {
    private let api: TapsoAPIClient
    private var loaded: [String: LiveRouteStops] = [:]

    init(api: TapsoAPIClient = TapsoAPIClient()) {
        self.api = api
    }

    func variants(forRouteNumber number: String) async throws -> [TransitRoute] {
        let routes = try await api.routes(number: number)
        let api = self.api
        let fetched = await withTaskGroup(of: LiveRouteStops?.self, returning: [LiveRouteStops].self) { group in
            for route in routes {
                group.addTask {
                    guard let list = try? await api.stops(routeID: route.routeId) else { return nil }
                    let built = TransitRoute.live(route, stops: list.items)
                    return LiveRouteStops(
                        apiRoute: route,
                        route: built.route,
                        coordinatesAreSurveyed: built.coordinatesAreSurveyed,
                        topology: list.meta?.topology?.kind ?? "linear"
                    )
                }
            }
            var all: [LiveRouteStops] = []
            for await item in group {
                if let item { all.append(item) }
            }
            return all
        }
        // Every variant failing is a failed lookup, not "TAPSO does not serve this number".
        if fetched.isEmpty && !routes.isEmpty { throw TransitAPIFailure.server }
        for item in fetched { loaded[item.apiRoute.routeId] = item }
        return fetched.map(\.route)
    }

    /// The variant exactly as `variants(forRouteNumber:)` returned it.
    func liveStops(for routeID: String) -> LiveRouteStops? {
        loaded[routeID]
    }

    /// Seeds a variant without a request (tests).
    func remember(_ stops: LiveRouteStops) {
        loaded[stops.apiRoute.routeId] = stops
    }
}
