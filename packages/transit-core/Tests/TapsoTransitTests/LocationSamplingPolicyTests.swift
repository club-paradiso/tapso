import Foundation
import XCTest
@testable import TapsoTransit

/// SYNTHETIC fixes, not recordings of any rider.
final class LocationSamplingPolicyTests: XCTestCase {
    let start = Date(timeIntervalSince1970: 1_800_000_000)

    func fix(_ seconds: Double, accuracy: Double, latitude: Double = 33.5) -> DevicePositionSample {
        DevicePositionSample(coordinate: Coordinate(latitude: latitude, longitude: 126.5), timestamp: start.addingTimeInterval(seconds), accuracy: accuracy, speed: 5, course: 10)
    }

    func selector(_ mode: LocationSamplingMode = .normal) -> LocationFixSelector {
        LocationFixSelector(policy: .policy(for: mode), startedAt: start)
    }

    func testV1MismatchIsGone_RideModesNeverAcceptWhatTheEngineRefuses() {
        for mode in LocationSamplingMode.allCases where mode.isRide {
            let policy = LocationSamplingPolicy.policy(for: mode)
            XCTAssertLessThanOrEqual(policy.requestedAccuracy, policy.goodEnoughAccuracy, "\(mode)")
            XCTAssertLessThanOrEqual(policy.goodEnoughAccuracy, policy.acceptableAccuracy, "\(mode)")
            XCTAssertLessThanOrEqual(policy.acceptableAccuracy, HybridPositionEngine.maximumDeviceAccuracy, "\(mode)")
            XCTAssertLessThanOrEqual(policy.window, 6, "bounded window, never continuous: \(mode)")
        }
    }

    func testStaleCachedFixIsRejected() {
        var value = selector()
        // A cached fix 25 s old arrives instantly at the start of the window.
        XCTAssertEqual(value.offer(fix(-25, accuracy: 5), now: start), .keepListening)
        XCTAssertNil(value.best)
        XCTAssertEqual(value.rejections[.stale], 1)
        XCTAssertEqual(value.result(at: start.addingTimeInterval(4)), .unavailable(.noAcceptableFix))
    }

    func testPoorFirstFixFollowedByGoodFixChoosesTheGoodFix() {
        var value = selector(.boarding)
        XCTAssertEqual(value.offer(fix(0.5, accuracy: 65), now: start.addingTimeInterval(0.5)), .keepListening, "65 m is what V1's 100 m request returned and the engine refused")
        XCTAssertEqual(value.offer(fix(1.5, accuracy: 35), now: start.addingTimeInterval(1.5)), .keepListening)
        XCTAssertEqual(value.offer(fix(3, accuracy: 9), now: start.addingTimeInterval(3)), .finish, "good enough ends the window early")
        XCTAssertEqual(value.result(at: start.addingTimeInterval(3)).sample?.accuracy, 9)
    }

    func testTimeoutReturnsTheBestAcceptableFix() {
        var value = selector(.recovery)
        _ = value.offer(fix(1, accuracy: 45), now: start.addingTimeInterval(1))
        _ = value.offer(fix(2, accuracy: 30), now: start.addingTimeInterval(2))
        _ = value.offer(fix(3, accuracy: 48), now: start.addingTimeInterval(3))
        XCTAssertEqual(value.offer(fix(6, accuracy: 40), now: start.addingTimeInterval(6)), .finish, "deadline")
        XCTAssertEqual(value.result(at: start.addingTimeInterval(6)).sample?.accuracy, 30)
    }

    func testNoAcceptableFixReturnsNothing() {
        var value = selector(.destinationNear)
        _ = value.offer(fix(1, accuracy: 120), now: start.addingTimeInterval(1))
        _ = value.offer(fix(2, accuracy: 65), now: start.addingTimeInterval(2))
        XCTAssertEqual(value.result(at: start.addingTimeInterval(6)), .unavailable(.noAcceptableFix))
        XCTAssertEqual(value.rejections[.tooInaccurate], 2)
    }

    func testReducedAccuracyFixIsNeverRideEvidence() {
        // Under reduced accuracy Apple delivers approximate fixes kilometres wide.
        var value = selector(.normal)
        _ = value.offer(fix(1, accuracy: 3_000), now: start.addingTimeInterval(1))
        XCTAssertNil(value.result(at: start.addingTimeInterval(4)).sample)
        XCTAssertFalse(LocationPermission.reducedAccuracy.allowsPreciseRideEvidence)
        XCTAssertTrue(LocationPermission.fullAccuracy.allowsPreciseRideEvidence)
        for permission in [LocationPermission.notDetermined, .denied, .restricted] {
            XCTAssertFalse(permission.allowsPreciseRideEvidence)
        }
    }

    func testInvalidAccuracyCoordinateAndFutureFixesAreRejected() {
        var value = selector()
        _ = value.offer(fix(1, accuracy: -1), now: start.addingTimeInterval(1))
        _ = value.offer(fix(1, accuracy: .nan), now: start.addingTimeInterval(1))
        _ = value.offer(fix(1, accuracy: 5, latitude: .infinity), now: start.addingTimeInterval(1))
        _ = value.offer(fix(30, accuracy: 5), now: start.addingTimeInterval(1))
        XCTAssertNil(value.best)
        XCTAssertEqual(value.rejections[.invalidAccuracy], 2)
        XCTAssertEqual(value.rejections[.invalidCoordinate], 1)
        XCTAssertEqual(value.rejections[.future], 1)
    }

    func testAKeptFixThatAgesPastTheLimitIsNotReturned() {
        var value = selector()
        _ = value.offer(fix(-9, accuracy: 30), now: start)
        XCTAssertNotNil(value.best)
        XCTAssertEqual(value.result(at: start.addingTimeInterval(4)), .unavailable(.noAcceptableFix))
    }

    func testEqualAccuracyPrefersTheNewerFix() {
        var value = selector()
        _ = value.offer(fix(1, accuracy: 30), now: start.addingTimeInterval(1))
        _ = value.offer(fix(2, accuracy: 30), now: start.addingTimeInterval(2))
        XCTAssertEqual(value.best?.timestamp, start.addingTimeInterval(2))
    }

    func testNearbyStopsToleratesCoarserFixesButStillBounded() {
        var value = selector(.nearbyStops)
        _ = value.offer(fix(1, accuracy: 120), now: start.addingTimeInterval(1))
        XCTAssertEqual(value.result(at: start.addingTimeInterval(5)).sample?.accuracy, 120)
        var coarse = selector(.nearbyStops)
        _ = coarse.offer(fix(1, accuracy: 900), now: start.addingTimeInterval(1))
        XCTAssertNil(coarse.result(at: start.addingTimeInterval(5)).sample)
    }

    func testRideModeSelection() {
        func mode(_ remaining: Int, _ state: HybridTrackingState?, manual: Bool = false, official: Int? = 5, boarding: Int? = 3) -> LocationSamplingMode {
            LocationSamplingPolicy.rideMode(remainingStops: remaining, hybridState: state, manual: manual, officialSequence: official, boardingSequence: boarding)
        }
        XCTAssertEqual(mode(8, .live), .normal)
        XCTAssertEqual(mode(3, .live), .destinationNear)
        XCTAssertEqual(mode(0, .predicted), .destinationNear)
        XCTAssertEqual(mode(8, .predicted), .recovery)
        XCTAssertEqual(mode(8, .lost), .recovery)
        XCTAssertEqual(mode(8, nil), .recovery, "nothing evaluated yet")
        XCTAssertEqual(mode(8, .live, manual: true), .recovery)
        XCTAssertEqual(mode(8, .live, official: 2), .boarding)
        XCTAssertEqual(mode(8, .live, official: 3), .boarding)
        XCTAssertEqual(mode(8, .live, official: nil), .boarding)
        XCTAssertEqual(mode(8, .live, boarding: nil), .normal)
    }

    func testThrottleSharesOneClockAcrossRideModesAndKeepsNearbySeparate() {
        var throttle = LocationSampleThrottle()
        XCTAssertTrue(throttle.begin(.policy(for: .normal), now: start))
        XCTAssertFalse(throttle.begin(.policy(for: .normal), now: start.addingTimeInterval(20)))
        XCTAssertFalse(throttle.begin(.policy(for: .recovery), now: start.addingTimeInterval(5)), "switching mode cannot double the rate")
        XCTAssertTrue(throttle.begin(.policy(for: .recovery), now: start.addingTimeInterval(10)))
        XCTAssertTrue(throttle.begin(.policy(for: .nearbyStops), now: start.addingTimeInterval(10)), "내 근처 is never blocked by a ride")
        XCTAssertTrue(throttle.begin(.policy(for: .nearbyStops), now: start.addingTimeInterval(11)))
        XCTAssertTrue(throttle.begin(.policy(for: .destinationNear), now: start.addingTimeInterval(20)))
        throttle.reset()
        XCTAssertTrue(throttle.begin(.policy(for: .normal), now: start.addingTimeInterval(21)))
    }
}
