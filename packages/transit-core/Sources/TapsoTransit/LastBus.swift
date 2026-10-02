import Foundation

/// Which published headway applies today.
public enum ServiceDay: String, Codable, Hashable, Sendable {
    case weekday
    case saturday
    case sunday
}

/// The last bus of one route variant today, read through the Safe Return engine.
///
/// TAGO publishes the last departure from the route's starting stop (기점). A bus
/// passes every later stop after it leaves there, so "be at your stop by the last
/// departure, with Safe Return's margin" is a conservative rule. TAPSO never
/// claims when the bus passes the rider's stop, and never builds a timetable out
/// of a published average headway (`docs/product/JEJU_SAFETY_LAYER_V3.md`).
public struct LastBusAdvice: Hashable, Sendable {
    /// `notRecommended` here means the last bus has left, or leaves the starting stop within the margin.
    public let level: SafeReturnLevel
    public let reasons: [SafeReturnReason]
    /// `HH:MM`, the published last departure from the starting stop.
    public let lastDeparture: String?
    /// `HH:MM`: be at the stop by then.
    public let beAtStopBy: String?
    /// Today's published average minutes between buses.
    public let headwayMinutes: Int?
    public let day: ServiceDay
    /// The instant of `beAtStopBy`, which may fall after midnight: what a countdown runs to.
    public let beAtStopByDate: Date?

    public init(
        level: SafeReturnLevel,
        reasons: [SafeReturnReason],
        lastDeparture: String?,
        beAtStopBy: String?,
        headwayMinutes: Int?,
        day: ServiceDay,
        beAtStopByDate: Date? = nil
    ) {
        self.level = level
        self.reasons = reasons
        self.lastDeparture = lastDeparture
        self.beAtStopBy = beAtStopBy
        self.headwayMinutes = headwayMinutes
        self.day = day
        self.beAtStopByDate = beAtStopByDate
    }

    /// The last bus has already left its starting stop today.
    public var isGone: Bool { reasons.contains(.noReturnService) }
}

public enum LastBus {
    /// TAGO's times are Korean local time, wherever the phone thinks it is.
    public static let timeZone = TimeZone(identifier: "Asia/Seoul")!

    public static func advice(for hours: TransitAPIRouteServiceHours?, now: Date, policy: SafeReturnPolicy = .standard) -> LastBusAdvice {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.weekday, .hour, .minute], from: now)
        let day: ServiceDay = switch parts.weekday ?? 0 {
        case 7: .saturday
        case 1: .sunday
        default: .weekday
        }
        let headway: Int? = switch day {
        case .weekday: hours?.headwayMinutes.weekday
        case .saturday: hours?.headwayMinutes.saturday
        case .sunday: hours?.headwayMinutes.sunday
        }
        guard let hours, let lastClock = minutes(hours.lastDeparture) else {
            return LastBusAdvice(level: .unknown, reasons: [.returnUnknown], lastDeparture: hours?.lastDeparture, beAtStopBy: nil, headwayMinutes: headway, day: day)
        }

        var current = Double((parts.hour ?? 0) * 60 + (parts.minute ?? 0))
        var last = Double(lastClock)
        // A last departure earlier in the day than the first one runs past midnight.
        if let first = minutes(hours.firstDeparture), lastClock < first {
            last += 1_440
            if current < Double(first) { current += 1_440 }
        }
        let status = SafeReturn.evaluate(
            SafeReturnInput(arrival: 0, minimumStay: 0, departures: [last - current], quality: .scheduled),
            policy: policy
        )
        // The clock minute `current` stands for, so the instant and the `HH:MM` agree.
        let minuteStart = Date(timeIntervalSinceReferenceDate: (now.timeIntervalSinceReferenceDate / 60).rounded(.down) * 60)
        return LastBusAdvice(
            level: status.level,
            reasons: status.reasons,
            lastDeparture: hours.lastDeparture,
            beAtStopBy: status.leaveBy.map { clock(current + $0) },
            headwayMinutes: headway,
            day: day,
            beAtStopByDate: status.leaveBy.map { minuteStart.addingTimeInterval($0 * 60) }
        )
    }

    /// `HH:MM` → minutes after midnight, or `nil`.
    static func minutes(_ text: String?) -> Int? {
        guard let text else { return nil }
        let parts = text.split(separator: ":")
        guard parts.count == 2, let hours = Int(parts[0]), let minutes = Int(parts[1]),
              (0...23).contains(hours), (0...59).contains(minutes) else { return nil }
        return hours * 60 + minutes
    }

    static func clock(_ minutes: Double) -> String {
        let total = ((Int(minutes.rounded(.down)) % 1_440) + 1_440) % 1_440
        return String(format: "%02ld:%02ld", total / 60, total % 60)
    }
}
