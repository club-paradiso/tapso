import Foundation

// `GET /v1/timetables?routeNo=` (docs/PRODUCTION_TRANSIT_API.md): Jeju's
// official timetables, imported from bus.jeju.go.kr on a stated date and read
// by the server for one calendar day. Official, but dated: never live, never
// interpolated between timepoints. The server already decided which service
// applies to the day; this file only decodes it and turns it into what the
// rider reads, without adding a claim the server did not make.

public struct TransitAPITimetableResponse: Codable, Hashable, Sendable {
    public let item: TransitAPITimetable
}

public struct TransitAPITimetable: Codable, Hashable, Sendable {
    /// `available`, `source_conflict`, `no_timetable` or `not_published`.
    public let routeNo: String
    public let status: String
    /// `OFFICIAL_DATED`.
    public let label: String
    /// `YYYY-MM-DD`: the day the official files were downloaded.
    public let asOf: String
    /// `fresh`, `aging`, `stale` or `unknown`, counted from `asOf`.
    public let freshness: String
    public let date: String
    public let serviceDay: ServiceDay
    public let today: [Today]
    public let services: [Service]

    public struct ServiceDay: Codable, Hashable, Sendable {
        public let date: String
        public let weekday: String
        public let publicHoliday: Holiday?
        public let calendarCovered: Bool

        public struct Holiday: Codable, Hashable, Sendable {
            public let name: String
        }
    }

    public struct TripEnd: Codable, Hashable, Sendable {
        /// `HH:MM`; 24:00 and later is after midnight.
        public let time: String
        public let from: String

        public init(time: String, from: String) {
            self.time = time
            self.from = from
        }
    }

    public struct Today: Codable, Hashable, Sendable {
        public let direction: String
        public let first: TripEnd?
        public let last: TripEnd?
        public let dayLabel: String?
        public let applicability: String
    }

    public struct Trip: Codable, Hashable, Sendable {
        public let routeNumber: String?
        public let times: [String?]
        public let firstTime: String?
        public let conditions: [String]?
        public let note: String?
    }

    public struct LaterConditional: Codable, Hashable, Sendable {
        public let time: String
        public let from: String
        public let conditions: [String]
    }

    public struct Service: Codable, Hashable, Sendable {
        public let direction: String
        public let dayType: String
        public let dayLabel: String?
        public let serviceLabels: [String]?
        /// `applies`, `does_not_apply`, `uncertain` or `unstated`.
        public let applicability: String
        public let effectiveFrom: String?
        public let inEffect: Bool
        /// `ok` or `source_conflict`: a conflicting table comes with no trips.
        public let status: String
        public let conflicts: [String]?
        public let note: String?
        public let timepoints: [String]
        public let trips: [Trip]
        public let first: TripEnd?
        public let last: TripEnd?
        public let laterConditional: [LaterConditional]
        public let hasConditionalTrips: Bool
    }
}

/// What the rider reads about a route's official timetable, from the server's view.
public struct TimetableSummary: Hashable, Sendable {
    public enum Kind: Hashable, Sendable {
        /// Today's first and last buses, per direction, from a service whose own label covers today.
        case today
        /// The published tables state no day type: their first and last, never called "today".
        case undated
        /// Tables exist for other days only; nothing is claimed for today.
        case otherDays
        /// Every table for this route contradicts itself and is withheld.
        case withheld
        /// The official source has no usable timetable for this route.
        case unavailable
    }

    public struct Line: Hashable, Sendable {
        public let direction: String
        public let first: TransitAPITimetable.TripEnd?
        public let last: TransitAPITimetable.TripEnd?
        /// The table's own words for its day ("평일", "토,공휴일"), when it states one.
        public let dayLabel: String?
        /// Trips with conditions (season, market day, on demand) leave after `last`.
        public let hasLaterConditional: Bool
    }

    public let kind: Kind
    public let lines: [Line]
    /// The download date, always shown: a dated table is not live.
    public let asOf: String
    /// Older than TAPSO will vouch for as current: shown as a dated record only.
    public let isStale: Bool
    public let holidayName: String?

    public static func make(_ view: TransitAPITimetable) -> TimetableSummary {
        let stale = view.freshness != "fresh" && view.freshness != "aging"
        let holiday = view.serviceDay.publicHoliday?.name
        func done(_ kind: Kind, _ lines: [Line]) -> TimetableSummary {
            TimetableSummary(kind: kind, lines: lines, asOf: view.asOf, isStale: stale, holidayName: holiday)
        }
        guard view.status == "available" else {
            return done(view.status == "source_conflict" ? .withheld : .unavailable, [])
        }
        let usable = view.services.filter { $0.status == "ok" && ($0.first != nil || $0.last != nil) }
        func line(_ service: TransitAPITimetable.Service) -> Line {
            Line(direction: service.direction, first: service.first, last: service.last, dayLabel: service.dayLabel, hasLaterConditional: !service.laterConditional.isEmpty)
        }
        if !stale, !view.today.isEmpty {
            let lines = view.today.map { entry in
                Line(
                    direction: entry.direction,
                    first: entry.first,
                    last: entry.last,
                    dayLabel: entry.dayLabel,
                    hasLaterConditional: usable.contains { $0.direction == entry.direction && $0.dayLabel == entry.dayLabel && !$0.laterConditional.isEmpty }
                )
            }
            return done(.today, lines)
        }
        let undated = usable.filter { $0.applicability == "unstated" }
        if !undated.isEmpty { return done(.undated, undated.map(line)) }
        if !usable.isEmpty { return done(.otherDays, usable.map(line)) }
        return done(view.services.isEmpty ? .unavailable : .withheld, [])
    }
}

/// Clock text for a timetable time: "24:05" is "00:05" on the next day.
public enum TimetableClock {
    public static func display(_ time: String) -> (text: String, nextDay: Bool) {
        let parts = time.split(separator: ":")
        guard parts.count == 2, let hours = Int(parts[0]), let minutes = Int(parts[1]) else { return (time, false) }
        return (String(format: "%02d:%02d", hours % 24, minutes), hours >= 24)
    }
}
