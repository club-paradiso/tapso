import Foundation

// `GET /v1/night-guard?routeNo=` (docs/PRODUCTION_TRANSIT_API.md): the official
// timetable read by the server for this instant, across midnight. Schedule
// only: the server never says a bus is operating (`claimsOperating` is always
// false), and neither does this file. It decodes the answer and keeps only
// the entries a timetable could answer for (`OFFICIAL_DATED`); everything else
// is left to the timetable card, which already shows the dated tables.

public struct TransitAPINightGuardResponse: Codable, Hashable, Sendable {
    public let item: TransitAPINightGuard
}

public struct TransitAPINightGuard: Codable, Hashable, Sendable {
    public let routeNo: String
    /// `OFFICIAL_DATED`.
    public let label: String
    public let evaluatedAt: String
    public let localDate: String
    public let localTime: String
    /// The download date of the official files.
    public let asOf: String
    public let freshness: String
    public let validUntil: String?
    public let entries: [Entry]

    public struct ScheduledTime: Codable, Hashable, Sendable {
        /// `HH:MM` as published; 24:00 and later is the next day.
        public let table: String
        public let clock: String
        public let date: String
        /// Where the time was read: the trip's start, or a named timepoint.
        public let at: String
        public let minutesFromNow: Int
    }

    public struct Entry: Codable, Hashable, Sendable {
        public let direction: String
        public let serviceDate: String
        public let dayType: String
        public let dayLabel: String?
        /// `scheduled_departures_remain`, `before_first_departure`, `last_scheduled_departed`, `uncertain` or `unknown`.
        public let status: String
        /// `OFFICIAL_DATED`, `CONFLICTED` or `UNKNOWN`.
        public let evidence: String
        public let next: ScheduledTime?
        public let last: ScheduledTime?
        public let reasons: [String]
        public let claimsOperating: Bool
    }
}

/// One line per direction the timetable can answer for tonight.
public struct NightGuardLine: Hashable, Sendable {
    public enum Kind: Hashable, Sendable {
        /// A later departure is published. Scheduled, not observed.
        case departuresRemain(TransitAPINightGuard.ScheduledTime)
        /// The day's first departure is still ahead.
        case beforeFirst(TransitAPINightGuard.ScheduledTime)
        /// Every published departure's time has passed; the bus may be late or still on its way.
        case lastDeparted(TransitAPINightGuard.ScheduledTime)
        /// The table answers, but not plainly (conditional trips, an uncertain day, two tables).
        case uncertain
    }

    public let direction: String
    public let kind: Kind

    /// Lines for the entries the server answered from an official table. A
    /// conflicting, stale, undated or not-yet-effective table gives no line, and
    /// an entry that claims a bus is operating (never sent) is dropped.
    public static func lines(_ view: TransitAPINightGuard) -> [NightGuardLine] {
        guard view.label == "OFFICIAL_DATED" else { return [] }
        return view.entries.compactMap { (entry: TransitAPINightGuard.Entry) -> NightGuardLine? in
            guard entry.evidence == "OFFICIAL_DATED", !entry.claimsOperating else { return nil }
            switch entry.status {
            case "scheduled_departures_remain":
                return entry.next.map { NightGuardLine(direction: entry.direction, kind: .departuresRemain($0)) }
            case "before_first_departure":
                return entry.next.map { NightGuardLine(direction: entry.direction, kind: .beforeFirst($0)) }
            case "last_scheduled_departed":
                return entry.last.map { NightGuardLine(direction: entry.direction, kind: .lastDeparted($0)) }
            case "uncertain":
                return NightGuardLine(direction: entry.direction, kind: .uncertain)
            default:
                return nil
            }
        }
    }
}

// MARK: - Freshness and display policy (kept out of SwiftUI; AGENTS.md)

extension TransitAPINightGuard {
    /// Seconds between reads when the answer gives no `validUntil`, or when a
    /// read failed: the server caches an answer for at most a minute.
    public static let refreshFallbackSeconds: TimeInterval = 60
    /// Never read again sooner than this after a read, so an answer that arrives
    /// already at (or past) its `validUntil`, for example from a shared cache at
    /// the boundary, cannot make the app re-read in a tight loop.
    public static let refreshFloorSeconds: TimeInterval = 5

    /// The answer holds until `validUntil` (the next minute its status can
    /// change). Past it, or when `validUntil` does not parse, it is not shown.
    /// No `validUntil` at all: the server bounds the answer to a minute, so the
    /// caller's own refresh decides.
    public func isCurrent(at now: Date) -> Bool {
        guard let validUntil else { return true }
        guard let until = NightGuardInstant.parse(validUntil) else { return false }
        return now < until
    }

    /// When to read again: at `validUntil`, never later than the fallback after
    /// the read, and never sooner than the floor. A `validUntil` that does not
    /// parse means as soon as the floor allows.
    public func refreshDate(readAt: Date) -> Date {
        let floor = readAt.addingTimeInterval(Self.refreshFloorSeconds)
        let fallback = readAt.addingTimeInterval(Self.refreshFallbackSeconds)
        guard let validUntil else { return fallback }
        guard let until = NightGuardInstant.parse(validUntil) else { return floor }
        return max(floor, min(until, fallback))
    }
}

extension TransitAPINightGuard.ScheduledTime {
    /// Calendar days from the evaluation's local date to the date this time
    /// falls on: 0 the same day, 1 the next, -1 the day before. `nil` when
    /// either date is not `YYYY-MM-DD`.
    public func dayOffset(from localDate: String) -> Int? {
        guard let from = NightGuardInstant.day(localDate), let to = NightGuardInstant.day(date) else { return nil }
        return NightGuardInstant.calendar.dateComponents([.day], from: from, to: to).day
    }

    /// The wall clock to show, read against the evaluation date rather than the
    /// table: after midnight yesterday's "24:10" is today's 00:10, not "next
    /// day". Only a time on the following calendar day is marked as next day.
    /// An earlier day (a last departure before midnight, read after it) shows
    /// its plain clock: it is in the past either way. Without a usable date the
    /// table's own reading is kept.
    public func displayClock(relativeTo localDate: String) -> (text: String, nextDay: Bool) {
        guard let offset = dayOffset(from: localDate) else { return TimetableClock.display(table) }
        return (TimetableClock.display(clock).text, offset >= 1)
    }
}

enum NightGuardInstant {
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    static func parse(_ text: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: text) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: text)
    }

    static func day(_ text: String) -> Date? {
        let parts = text.split(separator: "-")
        guard parts.count == 3, let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else { return nil }
        return calendar.date(from: DateComponents(year: year, month: month, day: day))
    }
}
