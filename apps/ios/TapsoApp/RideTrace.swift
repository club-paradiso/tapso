import Foundation
import TapsoTransit

#if DEBUG
/// A privacy-safe field trace of a live ride, kept only in Debug builds
/// (`TAPSO_V1_RELEASE_CLOSURE.md`, workstream L). The tester never transcribes
/// logs: every poll, guidance change, lifecycle change and Live Activity
/// update is recorded automatically and exported as text from the ride
/// screen's diagnostics sheet.
///
/// What it never holds: coordinates, the full plate (only the masked form the
/// ride shows), push tokens, session ids, or the rider's identity.
struct RideTraceEvent: Codable, Hashable, Sendable {
    let at: Date
    /// `TapsoBuild.identity().line` when the app has it; the short Git SHA is what matters.
    let build: String
    /// `poll`, `poll_failed`, `guidance`, `milestone`, `lifecycle`, `live_activity`, `hybrid`, `recheck`.
    let event: String
    let route: String
    let variant: String
    /// Masked plate, e.g. `••3913`.
    let vehicle: String
    let providerSequence: Int?
    let sessionState: String?
    /// `reliability.trust` from the server, when present.
    let serverTrust: String?
    let moment: String
    let trust: String
    let remainingStops: Int
    let hybridState: String?
    /// Horizontal accuracy rounded down to 10 m, when a device sample exists.
    let gpsAccuracyBucket: Int?
    /// `foreground` or `background`.
    let lifecycle: String
    let milestone: String?
    let detail: String?

    var line: String {
        let stamp = at.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
        var fields = [
            stamp, event, "build=\(build)", "route=\(route)", "variant=\(variant)", "vehicle=\(vehicle)",
            "seq=\(providerSequence.map(String.init) ?? "-")", "session=\(sessionState ?? "-")", "serverTrust=\(serverTrust ?? "-")",
            "moment=\(moment)", "trust=\(trust)", "remaining=\(remainingStops)", "hybrid=\(hybridState ?? "-")",
            "gps10m=\(gpsAccuracyBucket.map(String.init) ?? "-")", "lifecycle=\(lifecycle)",
        ]
        if let milestone { fields.append("milestone=\(milestone)") }
        if let detail { fields.append("detail=\(detail)") }
        return fields.joined(separator: " ")
    }
}

/// The ride's trace: a bounded ring, newest last.
struct RideTrace: Sendable {
    static let capacity = 600
    private(set) var events: [RideTraceEvent] = []

    mutating func record(_ event: RideTraceEvent) {
        events.append(event)
        if events.count > Self.capacity { events.removeFirst(events.count - Self.capacity) }
    }

    mutating func reset() { events = [] }

    /// One line per event, ready to share. The header names the build so a pasted trace is never anonymous.
    var text: String {
        let header = "TAPSO ride trace · \(events.first?.build ?? TapsoBuild.identity().line) · \(events.count) events"
        return ([header] + events.map(\.line)).joined(separator: "\n")
    }
}
#endif
