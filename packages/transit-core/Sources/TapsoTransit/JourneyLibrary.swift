import Foundation

/// A ride the rider has taken or saved, enough to start it again in one tap.
public struct SavedJourney: Codable, Hashable, Identifiable, Sendable {
    public var id: String {
        [routeID.rawValue, boardingStopID.rawValue, destinationStopID.rawValue].joined(separator: "|")
    }

    public let routeID: RouteID
    public let routeNumber: String
    /// The direction as riders say it: the route's last stop.
    public let headsign: String
    public let boardingStopID: StopID
    public let boardingStopName: String
    public let destinationStopID: StopID
    public let destinationStopName: String
    public var isFavorite: Bool
    public var rideCount: Int
    public var lastRiddenAt: Date
    /// TAGO city code of a live ride; `nil` for a demo ride. Optional so earlier libraries still decode.
    public var cityCode: String?
    /// Provider sequences of a live ride. Stop ids repeat round a loop; sequences do not.
    public var boardingSequence: Int?
    public var destinationSequence: Int?

    /// A live ride is started again from the server's current stop list, never from a stored one.
    public var isLive: Bool { cityCode != nil }

    public init(
        routeID: RouteID,
        routeNumber: String,
        headsign: String,
        boardingStopID: StopID,
        boardingStopName: String,
        destinationStopID: StopID,
        destinationStopName: String,
        isFavorite: Bool = false,
        rideCount: Int = 0,
        lastRiddenAt: Date,
        cityCode: String? = nil,
        boardingSequence: Int? = nil,
        destinationSequence: Int? = nil
    ) {
        self.routeID = routeID
        self.routeNumber = routeNumber
        self.headsign = headsign
        self.boardingStopID = boardingStopID
        self.boardingStopName = boardingStopName
        self.destinationStopID = destinationStopID
        self.destinationStopName = destinationStopName
        self.isFavorite = isFavorite
        self.rideCount = rideCount
        self.lastRiddenAt = lastRiddenAt
        self.cityCode = cityCode
        self.boardingSequence = boardingSequence
        self.destinationSequence = destinationSequence
    }

    public init(route: TransitRoute, boarding: Stop, destination: Stop, at date: Date) {
        self.init(
            routeID: route.id,
            routeNumber: route.number,
            headsign: route.destinationName,
            boardingStopID: boarding.id,
            boardingStopName: boarding.name,
            destinationStopID: destination.id,
            destinationStopName: destination.name,
            lastRiddenAt: date
        )
    }

    /// A live ride, remembered by provider sequence as well as stop id.
    public init(liveRoute route: TransitRoute, cityCode: String, boarding: RouteStop, destination: RouteStop, at date: Date) {
        self.init(
            routeID: route.id,
            routeNumber: route.number,
            headsign: route.destinationName,
            boardingStopID: boarding.stop.id,
            boardingStopName: boarding.stop.name,
            destinationStopID: destination.stop.id,
            destinationStopName: destination.stop.name,
            lastRiddenAt: date,
            cityCode: cityCode,
            boardingSequence: boarding.sequence,
            destinationSequence: destination.sequence
        )
    }

    public var plan: RidePlan {
        RidePlan(
            routeID: routeID,
            direction: .unknown,
            boardingStopID: boardingStopID,
            destinationStopID: destinationStopID
        )
    }
}

/// Recent and favourite rides, kept on the device only.
///
/// Pure value logic so ordering and limits are testable; the app persists it.
public struct JourneyLibrary: Codable, Hashable, Sendable {
    public static let recentLimit = 3
    public static let destinationLimit = 6
    /// Non-favourite history beyond this is forgotten, oldest first.
    public static let historyLimit = 12

    public private(set) var journeys: [SavedJourney]

    public init(journeys: [SavedJourney] = []) {
        self.journeys = journeys
    }

    /// Most recent first. Favourites appear here too when they were ridden recently.
    public var recents: [SavedJourney] {
        Array(journeys.filter { $0.rideCount > 0 }.sorted(by: Self.newestFirst).prefix(Self.recentLimit))
    }

    /// Most ridden first, then most recent.
    public var favorites: [SavedJourney] {
        journeys.filter(\.isFavorite).sorted {
            $0.rideCount != $1.rideCount ? $0.rideCount > $1.rideCount : Self.newestFirst($0, $1)
        }
    }

    /// Where the rider recently got off, newest first, one entry per stop name.
    public var recentDestinationNames: [String] {
        var seen = Set<String>()
        return journeys.sorted(by: Self.newestFirst).compactMap { journey in
            seen.insert(journey.destinationStopName).inserted ? journey.destinationStopName : nil
        }
        .prefix(Self.destinationLimit)
        .map { $0 }
    }

    public var lastRide: SavedJourney? {
        journeys.filter { $0.rideCount > 0 }.max { $0.lastRiddenAt < $1.lastRiddenAt }
    }

    public func journey(id: String) -> SavedJourney? {
        journeys.first { $0.id == id }
    }

    /// Records a started ride. The same route, boarding and destination is one entry.
    public mutating func recordRide(_ journey: SavedJourney, at date: Date) {
        if let index = journeys.firstIndex(where: { $0.id == journey.id }) {
            journeys[index].rideCount += 1
            journeys[index].lastRiddenAt = date
        } else {
            var added = journey
            added.rideCount = 1
            added.lastRiddenAt = date
            journeys.append(added)
        }
        trimHistory()
    }

    @discardableResult
    public mutating func toggleFavorite(id: String) -> Bool {
        guard let index = journeys.firstIndex(where: { $0.id == id }) else { return false }
        journeys[index].isFavorite.toggle()
        // Read before trimming: an un-favourited journey past the history limit is removed.
        let isFavorite = journeys[index].isFavorite
        trimHistory()
        return isFavorite
    }

    public mutating func remove(id: String) {
        journeys.removeAll { $0.id == id }
    }

    private mutating func trimHistory() {
        let history = journeys.filter { !$0.isFavorite }.sorted(by: Self.newestFirst)
        guard history.count > Self.historyLimit else { return }
        let forgotten = Set(history.dropFirst(Self.historyLimit).map(\.id))
        journeys.removeAll { forgotten.contains($0.id) }
    }

    private static func newestFirst(_ lhs: SavedJourney, _ rhs: SavedJourney) -> Bool {
        lhs.lastRiddenAt != rhs.lastRiddenAt ? lhs.lastRiddenAt > rhs.lastRiddenAt : lhs.id < rhs.id
    }
}
