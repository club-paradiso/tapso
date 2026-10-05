import Foundation

/// "탑서가 먼저 말을 건다" at saved stops (`docs/exec-plans/AUTO_START.md`, M3).
///
/// The rider opts a saved journey in; when the phone enters a small circle
/// around that journey's boarding stop, TAPSO reads where the route's buses
/// are and asks "365번이 2정거장 전이에요 · 탈 거예요?". The circle and the
/// phone's location stay on the phone: the only network read is the route's
/// vehicle snapshot, the same read every ride makes.
public enum StopNudge {
    /// Monitored stops at once. iOS allows 20 conditions per app (`CLMonitor`);
    /// TAPSO keeps half free for later features.
    public static let maximumStops = 10
    /// Starting radius, to tune on a device (AUTO_START C3).
    public static let radiusMeters: Double = 150
    /// Buses further than this are not "coming": a long route can hold a bus
    /// 30 stops back that is no use to a rider at the stop now.
    public static let horizonStops = 12

    /// Stops between the nearest bus that has not yet passed the boarding stop
    /// and the stop itself (`0` = at the stop). `nil` when no bus is within
    /// `horizonStops`, or none reports a stop sequence.
    public static func nearestStopsAway(boardingSequence: Int, vehicleSequences: [Int?]) -> Int? {
        vehicleSequences
            .compactMap { $0 }
            .map { boardingSequence - $0 }
            .filter { $0 >= 0 && $0 <= horizonStops }
            .min()
    }

    /// What the notification says, as localization keys and their count.
    public enum Message: Equatable, Sendable {
        /// "365번이 2정거장 전이에요" — `count` stops away.
        case approaching(routeNumber: String, stopsAway: Int)
        /// "365번이 정류장에 와 있어요" — at the stop now; the next one may be the one to take.
        case atStop(routeNumber: String)
        /// "365번 위치는 아직 몰라요" — no bus near; still ask.
        case unknown(routeNumber: String)

        public init(routeNumber: String, stopsAway: Int?) {
            switch stopsAway {
            case .none: self = .unknown(routeNumber: routeNumber)
            case .some(0): self = .atStop(routeNumber: routeNumber)
            case let .some(count): self = .approaching(routeNumber: routeNumber, stopsAway: count)
            }
        }
    }
}

/// The rider's opt-ins and today's "오늘은 아니에요". Stored on the phone only.
public struct StopNudgeSettings: Codable, Equatable, Sendable {
    public struct Stop: Codable, Equatable, Sendable {
        public let journeyID: String
        public let latitude: Double
        public let longitude: Double

        public init(journeyID: String, latitude: Double, longitude: Double) {
            self.journeyID = journeyID
            self.latitude = latitude
            self.longitude = longitude
        }
    }

    public private(set) var stops: [Stop] = []
    /// Journey id → the moment its silence ends.
    public private(set) var snoozedUntil: [String: Date] = [:]

    public init() {}

    public func isEnabled(_ journeyID: String) -> Bool {
        stops.contains { $0.journeyID == journeyID }
    }

    /// Adds or refreshes a stop. Returns `false`, changing nothing, when a new
    /// stop would exceed `StopNudge.maximumStops`.
    @discardableResult
    public mutating func enable(_ stop: Stop) -> Bool {
        if let index = stops.firstIndex(where: { $0.journeyID == stop.journeyID }) {
            stops[index] = stop
            return true
        }
        guard stops.count < StopNudge.maximumStops else { return false }
        stops.append(stop)
        return true
    }

    public mutating func disable(_ journeyID: String) {
        stops.removeAll { $0.journeyID == journeyID }
        snoozedUntil[journeyID] = nil
    }

    /// "오늘은 아니에요": silent until the start of the next day.
    public mutating func snoozeForToday(_ journeyID: String, now: Date, calendar: Calendar = .current) {
        let startOfToday = calendar.startOfDay(for: now)
        snoozedUntil[journeyID] = calendar.date(byAdding: .day, value: 1, to: startOfToday)
    }

    public func isSnoozed(_ journeyID: String, now: Date) -> Bool {
        guard let until = snoozedUntil[journeyID] else { return false }
        return now < until
    }
}
