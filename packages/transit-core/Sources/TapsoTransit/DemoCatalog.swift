import Foundation

/// SYNTHETIC. The route catalogue and bus behaviour the app plays while it has
/// no data path.
///
/// Both directions reuse the stop names of `DemoFixtures.route`; stop order,
/// coordinates, identifiers, plates and timings are invented. The app makes no
/// network request (`services/api/test/crossLanguageAuthority.test.ts`), so
/// every setup screen, proposal and ride here is a rehearsal of the product
/// flow, not a claim about Jeju buses.
public enum DemoCatalog {
    public static let outbound: TransitRoute = DemoFixtures.route

    public static let inbound: TransitRoute = {
        let reversed = Array(DemoFixtures.route.stops.reversed())
        let stops = reversed.enumerated().map { index, routeStop in
            RouteStop(
                stop: Stop(
                    id: StopID(rawValue: "demo-stop-in-\(index)"),
                    name: routeStop.stop.name,
                    coordinate: routeStop.stop.coordinate
                ),
                sequence: index
            )
        }
        return TransitRoute(
            id: "demo-route-365-inbound",
            number: "365",
            direction: .inbound,
            variantID: "demo-main",
            originName: stops.first!.stop.name,
            destinationName: stops.last!.stop.name,
            stops: stops
        )
    }()

    public static let routes: [TransitRoute] = [outbound, inbound]

    public static func route(id: RouteID) -> TransitRoute? {
        routes.first { $0.id == id }
    }

    /// Every stop name riders can search for, in route order of the outbound direction.
    public static var destinationNames: [String] {
        var seen = Set<String>()
        return routes.flatMap(\.stops).compactMap { seen.insert($0.stop.name).inserted ? $0.stop.name : nil }
    }

    /// Stop names matching a query, ignoring spaces and punctuation such as `·`.
    public static func searchDestinations(_ query: String) -> [String] {
        let needle = StopNameMatcher.normalized(query)
        guard !needle.isEmpty else { return [] }
        return destinationNames
            .filter { StopNameMatcher.normalized($0).contains(needle) }
            .sorted { lhs, rhs in
                let lhsPrefix = StopNameMatcher.normalized(lhs).hasPrefix(needle)
                let rhsPrefix = StopNameMatcher.normalized(rhs).hasPrefix(needle)
                return lhsPrefix != rhsPrefix ? lhsPrefix : false
            }
    }

    /// One way to reach a destination: a route direction and the stop to get off at.
    public struct RouteOption: Hashable, Identifiable, Sendable {
        public var id: RouteID { route.id }
        public let route: TransitRoute
        public let destination: Stop
        /// Stops a rider can board at, nearest to the destination last.
        public let boardingStops: [Stop]
    }

    /// Route directions that reach the destination from at least one earlier stop.
    public static func routeOptions(toDestinationNamed name: String) -> [RouteOption] {
        routes.compactMap { route in
            guard let destination = route.stops.first(where: { $0.stop.name == name }) else { return nil }
            let boarding = route.stops.filter { $0.sequence < destination.sequence }.map(\.stop)
            guard !boarding.isEmpty else { return nil }
            return RouteOption(route: route, destination: destination.stop, boardingStops: boarding)
        }
    }

    /// SYNTHETIC plate for a demo bus. Never a real vehicle number.
    public static func plate(for vehicleID: VehicleIdentifier) -> String {
        let digits = vehicleID.rawValue.unicodeScalars.reduce(0) { ($0 * 31 + Int($1.value)) % 10_000 }
        return "제주70자" + String(format: "%04d", digits)
    }

    /// Buses a demo scenario offers at the boarding stop.
    public static func proposals(for scenario: DemoRideScenario, route: TransitRoute) -> [VehicleProposal] {
        let lead = VehicleIdentifier(rawValue: "demo-bus-\(route.number)-A")
        let follower = VehicleIdentifier(rawValue: "demo-bus-\(route.number)-B")
        switch scenario {
        case .similarBuses:
            return [
                VehicleProposal(vehicleID: lead, plate: plate(for: lead), stopsAway: 0),
                VehicleProposal(vehicleID: follower, plate: plate(for: follower), stopsAway: 1)
            ]
        case .noBusYet:
            return []
        default:
            return [VehicleProposal(vehicleID: lead, plate: plate(for: lead), stopsAway: 0)]
        }
    }

    /// One observation of a demo bus at a stop of `route`.
    public static func observation(
        route: TransitRoute,
        vehicleID: VehicleIdentifier,
        stopSequence: Int,
        at date: Date
    ) -> VehicleObservation? {
        guard let routeStop = route.stops.first(where: { $0.sequence == stopSequence }) else { return nil }
        return VehicleObservation(
            vehicleID: vehicleID,
            routeID: route.id,
            routeVariantID: route.variantID,
            direction: route.direction,
            timestamp: date,
            coordinate: routeStop.stop.coordinate,
            headingDegrees: route.expectedBearing(at: routeStop.stop.id),
            speedKilometersPerHour: 0,
            confirmedStopID: routeStop.stop.id,
            event: .arrivedAtStop
        )
    }
}

/// SYNTHETIC ride scripts that walk the product through every ride moment.
public enum DemoRideScenario: String, CaseIterable, Codable, Hashable, Sendable {
    /// Board, ride, prepare, next stop, arrive.
    case smooth
    /// Two buses fit at boarding; the rider picks one.
    case similarBuses
    /// No bus is proposed until the rider waits.
    case noBusYet
    /// Live data ages and goes stale mid-ride, then recovers.
    case delayedData
    /// The bus drops out of the feed mid-ride, then returns.
    case vehicleLost
    /// The phone loses its connection mid-ride.
    case offline
    /// The bus is next seen one stop past the destination.
    case passedDestination
}

/// One scripted beat of a demo ride. The app applies it through the same
/// `RideSession` path a real observation would take.
public enum DemoRideBeat: Hashable, Sendable {
    /// A fresh observation at this stop sequence.
    case observe(stopSequence: Int)
    /// No new observation; this many seconds pass.
    case silence(seconds: TimeInterval)
    /// The bus is missing from the feed.
    case vehicleMissing
    /// The phone goes offline or comes back.
    case connectivity(online: Bool)
}

public enum DemoRideScript {
    /// Beats from the boarding stop to the destination (or one past, when the scenario passes it).
    public static func beats(
        route: TransitRoute,
        boarding: StopID,
        destination: StopID,
        scenario: DemoRideScenario
    ) -> [DemoRideBeat] {
        guard
            let from = route.routeStop(id: boarding)?.sequence,
            let to = route.routeStop(id: destination)?.sequence,
            from < to
        else { return [] }

        var beats: [DemoRideBeat] = []
        for sequence in from...to {
            let remaining = to - sequence
            if scenario == .passedDestination, remaining == 0 {
                // The feed skips the destination: next seen one stop beyond it, if the route goes on.
                if route.stops.contains(where: { $0.sequence == to + 1 }) {
                    beats.append(.observe(stopSequence: to + 1))
                    return beats
                }
            }
            beats.append(.observe(stopSequence: sequence))
            let interruptionAt = min(4, max(3, to - from - 1))
            guard remaining == interruptionAt, sequence != from else { continue }
            switch scenario {
            case .delayedData:
                beats.append(.silence(seconds: 60))
                beats.append(.silence(seconds: 150))
            case .vehicleLost:
                beats.append(.vehicleMissing)
            case .offline:
                beats.append(.connectivity(online: false))
                beats.append(.connectivity(online: true))
            default:
                break
            }
        }
        return beats
    }
}

/// Finds stop names inside text shared from another app, without any network request.
///
/// A map app's share sheet sends a place name and a short link. The link would
/// need a request to resolve, so TAPSO reads only the words, and the rider
/// confirms what it found.
public enum StopNameMatcher {
    public static func normalized(_ text: String) -> String {
        let removable = CharacterSet.whitespacesAndNewlines
            .union(.punctuationCharacters)
            .union(.symbols)
            .union(CharacterSet(charactersIn: "·•ㆍ"))
        return String(text.lowercased().unicodeScalars.filter { !removable.contains($0) })
    }

    /// Stop names that appear in `text`, longest first so the most specific wins.
    public static func matches(in text: String, among names: [String]) -> [String] {
        let haystack = normalized(text)
        guard !haystack.isEmpty else { return [] }
        return names
            .filter { name in
                let needle = normalized(name)
                return needle.count >= 2 && haystack.contains(needle)
            }
            .sorted { normalized($0).count > normalized($1).count }
    }
}
