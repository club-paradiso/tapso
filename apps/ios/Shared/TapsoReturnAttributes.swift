import ActivityKit
import Foundation

/// "돌아갈 시간": a countdown on the Lock Screen and in the Dynamic Island to the time
/// the rider should be at the stop for the last bus of one route variant (`LastBus`).
///
/// The rider starts it from the end screen. Everything it shows is fixed when it starts,
/// and the system runs the countdown (`Text(timerInterval:)`), so it needs no update and
/// no push and keeps counting with the app closed. It reminds the rider of a published
/// departure from the starting stop, minus Safe Return's margin; it never predicts when a
/// bus passes the rider's stop.
public struct TapsoReturnAttributes: ActivityAttributes, Sendable {
    public struct ContentState: Codable, Hashable, Sendable {
        /// When the countdown started: the timer's lower bound.
        public let startedAt: Date
        /// Be at the stop by then (`LastBusAdvice.beAtStopByDate`); also the stale date.
        public let beAtStopBy: Date

        public init(startedAt: Date, beAtStopBy: Date) {
            self.startedAt = startedAt
            self.beAtStopBy = beAtStopBy
        }

        /// A range the timer can always take, even from a state written by hand.
        public var countdown: ClosedRange<Date> {
            min(startedAt, beAtStopBy)...beAtStopBy
        }
    }

    public let routeID: String
    public let routeNumber: String
    public let startStopName: String
    public let endStopName: String
    /// `HH:MM` of `beAtStopBy` in Jeju time, as the end screen showed it.
    public let beAtStopByText: String
    /// `HH:MM`, the published last departure from the starting stop (기점).
    public let lastDeparture: String

    public init(
        routeID: String,
        routeNumber: String,
        startStopName: String,
        endStopName: String,
        beAtStopByText: String,
        lastDeparture: String
    ) {
        self.routeID = routeID
        self.routeNumber = routeNumber
        self.startStopName = startStopName
        self.endStopName = endStopName
        self.beAtStopByText = beAtStopByText
        self.lastDeparture = lastDeparture
    }
}
