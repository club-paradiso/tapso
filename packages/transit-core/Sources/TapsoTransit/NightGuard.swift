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
