import XCTest
import TapsoTransit
@testable import Tapso

/// The Debug field trace (`RideTrace`): bounded, exportable, and never carrying what it must not.
final class RideTraceTests: XCTestCase {
    private func event(_ index: Int, event: String = "poll") -> RideTraceEvent {
        RideTraceEvent(
            at: Date(timeIntervalSince1970: 1_800_000_000 + Double(index)),
            build: "TAPSO 0.1.0 · Build 1 · a8f5940 · DEBUG",
            event: event,
            route: "3001",
            variant: "JEB405900101",
            vehicle: "••3913",
            providerSequence: 12 + index,
            sessionState: "tracking",
            serverTrust: "live",
            moment: "riding",
            trust: "live",
            remainingStops: 8 - min(index, 7),
            hybridState: nil,
            gpsAccuracyBucket: 10,
            lifecycle: "foreground",
            milestone: nil,
            detail: nil
        )
    }

    func testTraceIsBoundedAndNewestLast() {
        var trace = RideTrace()
        for index in 0..<(RideTrace.capacity + 50) { trace.record(event(index)) }
        XCTAssertEqual(trace.events.count, RideTrace.capacity)
        XCTAssertEqual(trace.events.last?.providerSequence, 12 + RideTrace.capacity + 49)
        trace.reset()
        XCTAssertTrue(trace.events.isEmpty)
    }

    func testExportNamesTheBuildAndMasksTheVehicle() {
        var trace = RideTrace()
        trace.record(event(0))
        trace.record(RideTraceEvent(at: Date(timeIntervalSince1970: 1_800_000_010), build: "TAPSO 0.1.0 · Build 1 · a8f5940 · DEBUG", event: "milestone", route: "3001", variant: "JEB405900101", vehicle: "••3913", providerSequence: 30, sessionState: "tracking", serverTrust: "live", moment: "prepare", trust: "live", remainingStops: 2, hybridState: nil, gpsAccuracyBucket: nil, lifecycle: "background", milestone: "prepare", detail: nil))
        let text = trace.text
        XCTAssertTrue(text.hasPrefix("TAPSO ride trace · TAPSO 0.1.0 · Build 1 · a8f5940 · DEBUG · 2 events"))
        XCTAssertTrue(text.contains("vehicle=••3913"))
        XCTAssertTrue(text.contains("milestone=prepare"))
        XCTAssertTrue(text.contains("lifecycle=background"))
        XCTAssertTrue(text.contains("serverTrust=live"))
        XCTAssertFalse(text.contains("latitude"), "no coordinates in a trace")
        XCTAssertEqual(text.components(separatedBy: "\n").count, 3)
    }
}
