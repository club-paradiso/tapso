import Foundation

/// The rider's way into a live ride: route number, direction, where to get
/// off, where to get on. The transit API serves stops by route, not routes by
/// stop, so a live ride starts from the number on the bus rather than from a
/// destination search (`docs/PRODUCTION_TRANSIT_API.md`). Pure, so every
/// choice the setup screens offer is a deterministic test.
public enum LiveSetup {
    /// A route number as typed, without spaces. `nil` when it cannot be one:
    /// empty, longer than 12 characters, or holding anything but letters,
    /// digits and `-`. Nothing else ever reaches a query.
    public static func routeNumber(_ typed: String) -> String? {
        let compact = typed.filter { !$0.isWhitespace }
        guard (1...12).contains(compact.count),
              compact.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" })
        else { return nil }
        return compact
    }

    /// The route IDs found for a number: exact matches first, each group in
    /// the server's order. A search may also return longer numbers that start
    /// the same way; they stay, after the exact ones, so nothing is hidden.
    public static func directions(_ routes: [LiveRoute], for number: String) -> [LiveRoute] {
        routes.filter { $0.routeNumber == number } + routes.filter { $0.routeNumber != number }
    }

    /// Where the rider can get off: every stop after the first, in route order.
    public static func destinations(_ stops: [LiveStop]) -> [LiveStop] {
        Array(ordered(stops).dropFirst())
    }

    /// Where the rider can get on for a destination: the stops before it, in
    /// route order. Never one after it: round a loop that would need a
    /// wrap-around this client does not assume.
    public static func boardingStops(_ stops: [LiveStop], destination: LiveStop) -> [LiveStop] {
        ordered(stops).filter { $0.sequence < destination.sequence }
    }

    /// Stops still to come after `current`, through the destination, nearest first.
    public static func upcomingNames(_ stops: [LiveStop], after current: Int, through destination: Int) -> [String] {
        ordered(stops).filter { $0.sequence > current && $0.sequence <= destination }.map(\.name)
    }

    /// The stop at a sequence, if the route has one there.
    public static func stop(_ stops: [LiveStop], at sequence: Int) -> LiveStop? {
        stops.first { $0.sequence == sequence }
    }

    /// Stops whose name holds the query, ignoring case, spaces and the
    /// punctuation stop names carry (`제주시청(아라방면)` matches `시청 아라`).
    public static func filter(_ stops: [LiveStop], query: String) -> [LiveStop] {
        let needle = folded(query)
        guard !needle.isEmpty else { return stops }
        return stops.filter { folded($0.name).contains(needle) }
    }

    private static func ordered(_ stops: [LiveStop]) -> [LiveStop] {
        stops.sorted { $0.sequence < $1.sequence }
    }

    private static func folded(_ text: String) -> String {
        String(text.lowercased().filter { $0.isLetter || $0.isNumber })
    }
}

extension LiveEnvironment {
    /// The environment a build is configured for: the production deployment
    /// unless a valid base URL is given (a staging server, or the local
    /// development server). A value that is not a valid base URL is ignored
    /// rather than half-used.
    public static func configured(_ value: String?) -> LiveEnvironment {
        guard let value = value?.trimmingCharacters(in: .whitespaces), !value.isEmpty,
              let url = URL(string: value), let environment = LiveEnvironment(baseURL: url)
        else { return .production }
        return environment
    }
}
