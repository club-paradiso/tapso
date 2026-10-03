import Foundation
import XCTest
@testable import TapsoTransit

/// SYNTHETIC straight route, not Jeju geometry or real passenger recordings.
final class HybridPositionEngineTests: XCTestCase {
    let start = Date(timeIntervalSince1970: 1_800_000_000)

    var route: TransitRoute {
        TransitRoute(id: "synthetic", number: "TEST", direction: .outbound, originName: "A", destinationName: "J",
                     stops: (1...10).map { index in
            RouteStop(stop: Stop(id: StopID(rawValue: "s\(index)"), name: "S\(index)",
                                coordinate: Coordinate(latitude: 33 + Double(index - 1) * 0.001, longitude: 126)), sequence: index)
        })
    }

    func engine(verified: Bool = false, surveyed: Bool = true) -> HybridPositionEngine {
        HybridPositionEngine(vehicleID: "bus", route: route, destinationSequence: 8, surveyed: surveyed,
                             geometry: verified ? RideRouteGeometry(points: route.stops.map { $0.stop.coordinate }, verifiedRoadShape: true) : nil)
    }

    func sample(_ seconds: Double, latitude: Double = 33, longitude: Double = 126, accuracy: Double = 10, speed: Double? = 8, course: Double? = 0) -> DevicePositionSample {
        DevicePositionSample(coordinate: Coordinate(latitude: latitude, longitude: longitude), timestamp: start.addingTimeInterval(seconds), accuracy: accuracy, speed: speed, course: course)
    }

    @discardableResult
    func seed(_ engine: inout HybridPositionEngine, sequence: Int = 1, gps: DevicePositionSample? = nil) -> HybridRidePosition {
        engine.evaluate(official: RideSignal(phase: sequence == 6 ? .approachingDestination : .active, remainingStops: 8 - sequence, freshness: .fresh), sequence: sequence,
                        evidenceAt: start, selectedVehicleID: "bus", device: gps, now: start)
    }

    func delayed(_ engine: inout HybridPositionEngine, at seconds: Double, gps: DevicePositionSample?) -> HybridRidePosition {
        engine.evaluate(official: RideSignal(phase: .active, remainingStops: 7, freshness: .aging), sequence: 1,
                        evidenceAt: start, selectedVehicleID: "bus", device: gps, now: start.addingTimeInterval(seconds))
    }

    func testPerfectOfficialFeedWithoutGPS() {
        var value = engine()
        let result = seed(&value)
        XCTAssertEqual(result.state, .live)
        XCTAssertEqual(result.remainingStops, 7)
        XCTAssertEqual(result.signal(at: start).freshness, .fresh)
    }

    func testThirtySecondReceiptIsStillBoundedLive() {
        var value = engine()
        let result = value.evaluate(official: RideSignal(phase: .active, remainingStops: 7, freshness: .fresh), sequence: 1,
                                    evidenceAt: start, selectedVehicleID: "bus", device: nil, now: start.addingTimeInterval(30))
        XCTAssertEqual(result.state, .live)
    }

    func testTwoMinuteStallWithAccurateGPSIsPredictionWithoutWarningOrAlert() {
        var value = engine()
        seed(&value)
        let result = delayed(&value, at: 120, gps: sample(120, latitude: 33.001))
        XCTAssertEqual(result.state, .predicted)
        XCTAssertEqual(RideGuidancePolicy.guidance(for: result.signal(at: start.addingTimeInterval(120))).moment, .riding)
        XCTAssertNil(RideGuidancePolicy.guidance(for: result.signal(at: start.addingTimeInterval(120))).milestone)
    }

    func testFiveMinuteStallCannotClaimVehicleAssociation() {
        var value = engine()
        seed(&value)
        XCTAssertEqual(delayed(&value, at: 300, gps: sample(300)).state, .lost)
    }

    func testFeedUnavailableCanUseRecentlyAssociatedDevice() {
        var value = engine()
        seed(&value)
        let result = value.evaluate(official: nil, sequence: nil, evidenceAt: nil, selectedVehicleID: "bus", device: sample(40), now: start.addingTimeInterval(40))
        XCTAssertEqual(result.state, .predicted)
    }

    func testInaccurateGPSFailsClosedDuringStall() {
        var value = engine()
        seed(&value)
        XCTAssertEqual(delayed(&value, at: 40, gps: sample(40, accuracy: 500)).state, .lost)
    }

    func testNoGPSFailsClosedDuringStall() {
        var value = engine()
        seed(&value)
        XCTAssertEqual(delayed(&value, at: 40, gps: nil).state, .lost)
    }

    func testNoOfficialIdentityCannotBeEstablishedByGPS() {
        var value = engine()
        XCTAssertEqual(delayed(&value, at: 40, gps: sample(40)).state, .lost)
    }

    func testTemporaryNetworkLossDoesNotOverrideUsableEstimate() {
        var value = engine()
        seed(&value)
        let offline = RideSignal(phase: .active, remainingStops: 7, freshness: .aging, isOffline: true)
        let result = value.evaluate(official: offline, sequence: 1, evidenceAt: start, selectedVehicleID: "bus", device: sample(45), now: start.addingTimeInterval(45))
        XCTAssertEqual(result.state, .predicted)
        XCTAssertFalse(result.signal(at: start.addingTimeInterval(45)).isOffline)
    }

    func testWrongOrWithdrawnVehicleIdentityFailsClosed() {
        for identity: String? in ["wrong", nil] {
            var value = engine()
            seed(&value)
            let result = value.evaluate(official: nil, sequence: 1, evidenceAt: start, selectedVehicleID: identity, device: sample(40), now: start.addingTimeInterval(40))
            XCTAssertEqual(result.state, .lost)
        }
    }

    func testRouteDeviationRejectsEvenFreshOfficialFeed() {
        var value = engine()
        let result = seed(&value, gps: sample(0, longitude: 126.01))
        XCTAssertEqual(result.state, .lost)
        XCTAssertEqual(result.reason, "route_deviation")
    }

    func testNoisyGPSJumpAheadCannotSkipStops() {
        var value = engine(verified: true)
        seed(&value, gps: sample(0))
        let result = delayed(&value, at: 1, gps: sample(1, latitude: 33.007))
        XCTAssertEqual(result.state, .lost)
        XCTAssertEqual(result.currentStopSequence, 1)
    }

    func testBackwardGPSDoesNotMoveTripBackward() {
        var value = engine(verified: true)
        seed(&value, sequence: 3, gps: sample(0, latitude: 33.002))
        let result = delayed(&value, at: 15, gps: sample(15, latitude: 33.0001))
        XCTAssertEqual(result.currentStopSequence, 3)
        XCTAssertNotEqual(result.state, .fused)
    }

    func testBackgroundExpiryAndResumeCannotRenewEvidence() {
        var value = engine()
        let live = seed(&value)
        XCTAssertEqual(RideGuidancePolicy.moment(for: live.signal(at: start.addingTimeInterval(31))), .checking)
        XCTAssertEqual(delayed(&value, at: 240, gps: sample(0)).state, .lost)
    }

    func testVerifiedGeometryRequiresMultipleSamplesThenFuses() {
        var value = engine(verified: true)
        seed(&value, gps: sample(0))
        let result = delayed(&value, at: 15, gps: sample(15, latitude: 33.0005))
        XCTAssertEqual(result.state, .fused)
        XCTAssertEqual(result.remainingStops, 7)
    }

    func testStopPassageRequiresProximityThenForwardEvidence() {
        var value = engine(verified: true)
        seed(&value, gps: sample(0))
        XCTAssertEqual(delayed(&value, at: 15, gps: sample(15, latitude: 33.001)).currentStopSequence, 1)
        XCTAssertEqual(delayed(&value, at: 25, gps: sample(25, latitude: 33.0015)).currentStopSequence, 2)
    }

    func testOfficialReturnsAfterPrediction() {
        var value = engine()
        seed(&value)
        XCTAssertEqual(delayed(&value, at: 40, gps: sample(40)).state, .predicted)
        let now = start.addingTimeInterval(60)
        let result = value.evaluate(official: RideSignal(phase: .active, remainingStops: 6, freshness: .fresh), sequence: 2,
                                    evidenceAt: now, selectedVehicleID: "bus", device: nil, now: now)
        XCTAssertEqual(result.state, .live)
        XCTAssertEqual(result.remainingStops, 6)
    }

    func testOfficialDeviceConflictIsVisible() {
        var value = engine()
        // Extend the route shape; a device on the shape but far from the official stop is conflicting.
        let longRoute = TransitRoute(id: "long", number: "TEST", direction: .outbound, originName: "A", destinationName: "B",
                                    stops: [RouteStop(stop: Stop(id: "a", name: "A", coordinate: Coordinate(latitude: 33, longitude: 126)), sequence: 1),
                                            RouteStop(stop: Stop(id: "b", name: "B", coordinate: Coordinate(latitude: 33.02, longitude: 126)), sequence: 2),
                                            RouteStop(stop: Stop(id: "c", name: "C", coordinate: Coordinate(latitude: 33.04, longitude: 126)), sequence: 3)])
        value = HybridPositionEngine(vehicleID: "bus", route: longRoute, destinationSequence: 3, surveyed: true)
        let result = value.evaluate(official: RideSignal(phase: .approachingDestination, remainingStops: 2, freshness: .fresh), sequence: 1,
                                    evidenceAt: start, selectedVehicleID: "bus", device: sample(0, latitude: 33.04), now: start)
        XCTAssertEqual(result.state, .lost)
        XCTAssertEqual(result.reason, "official_device_conflict")
    }

    func testNearDestinationApproximateGeometryCannotAlert() {
        var value = engine()
        seed(&value, sequence: 6)
        let result = delayed(&value, at: 40, gps: sample(40, latitude: 33.005))
        XCTAssertEqual(result.state, .lost)
        XCTAssertNil(RideGuidancePolicy.guidance(for: result.signal(at: start.addingTimeInterval(40))).milestone)
    }

    func testFinalStopNeedsOfficialConfirmation() {
        var value = engine()
        let now = start.addingTimeInterval(90)
        let result = value.evaluate(official: RideSignal(phase: .arrived, remainingStops: 0, freshness: .fresh), sequence: 8,
                                    evidenceAt: now, selectedVehicleID: "bus", device: nil, now: now)
        XCTAssertEqual(result.state, .live)
        XCTAssertEqual(RideGuidancePolicy.moment(for: result.signal(at: now)), .arrived)
    }

    func testDuplicateDeviceSampleDoesNotAdvancePassage() {
        var value = engine(verified: true)
        seed(&value, gps: sample(0))
        let first = delayed(&value, at: 15, gps: sample(15, latitude: 33.001))
        let second = delayed(&value, at: 16, gps: sample(15, latitude: 33.001))
        XCTAssertEqual(first.currentStopSequence, second.currentStopSequence)
    }

    func testUnsureCoordinatesAndAmbiguousLoopsCannotFuse() {
        var value = engine(surveyed: false)
        seed(&value)
        XCTAssertEqual(delayed(&value, at: 40, gps: sample(40)).state, .lost)
        let a = Coordinate(latitude: 33, longitude: 126)
        let b = Coordinate(latitude: 33.005, longitude: 126)
        XCTAssertNil(RideMapMatcher.project(a, onto: [a, b, a]))
    }

    func testInvalidSpeedCourseAgeAndCoordinatesFailClosed() {
        for gps in [sample(40, speed: 100), sample(40, course: 180), sample(0), sample(40, latitude: .nan), sample(40, accuracy: -1)] {
            var value = engine()
            seed(&value)
            XCTAssertEqual(delayed(&value, at: 40, gps: gps).state, .lost)
        }
    }

    func testSegmentMedianNeedsEnoughCleanSamples() {
        XCTAssertNil(SegmentTimingEstimate(samples: [30, 40, 50, 60]).medianSeconds)
        XCTAssertEqual(SegmentTimingEstimate(samples: [30, 35, 40, 50, 900, .nan, -1]).medianSeconds, 40)
    }
}
