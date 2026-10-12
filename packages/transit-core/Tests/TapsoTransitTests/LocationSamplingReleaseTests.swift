import Foundation
import XCTest
@testable import TapsoTransit

/// Release validation of the sampling policy (`BOARDING_ANCHOR_POSITION_V2.md` §5): the documented
/// numbers, inclusive boundaries, the throttle's clock, and which device fix a ride may keep.
/// SYNTHETIC fixes, not recordings of any rider.
extension LocationSamplingPolicyTests {
    /// Pins the §5 table. Every number is an ASSUMPTION awaiting device calibration: changing one
    /// here must change the document in the same pull request.
    func testDocumentedThresholdsPerMode() {
        struct Row: Equatable {
            let request, goodEnough, acceptable, window, maxAge, spacing: Double
        }
        let documented: [LocationSamplingMode: Row] = [
            .nearbyStops: Row(request: 10, goodEnough: 30, acceptable: 150, window: 5, maxAge: 30, spacing: 0),
            .normal: Row(request: 10, goodEnough: 20, acceptable: 50, window: 4, maxAge: 10, spacing: 30),
            .boarding: Row(request: 10, goodEnough: 15, acceptable: 50, window: 6, maxAge: 10, spacing: 20),
            .destinationNear: Row(request: 10, goodEnough: 15, acceptable: 50, window: 6, maxAge: 10, spacing: 10),
            .recovery: Row(request: 10, goodEnough: 20, acceptable: 50, window: 6, maxAge: 10, spacing: 10),
        ]
        XCTAssertEqual(Set(documented.keys), Set(LocationSamplingMode.allCases))
        for (mode, row) in documented {
            let policy = LocationSamplingPolicy.policy(for: mode)
            let actual = Row(request: policy.requestedAccuracy, goodEnough: policy.goodEnoughAccuracy,
                             acceptable: policy.acceptableAccuracy, window: policy.window,
                             maxAge: policy.maximumFixAge, spacing: policy.minimumInterval)
            XCTAssertEqual(actual, row, "\(mode) no longer matches BOARDING_ANCHOR_POSITION_V2.md §5")
        }
    }

    func testBoundaryAccuracyAndAgeAreInclusive() {
        // Exactly the acceptable accuracy at exactly the maximum age is kept.
        var edge = selector(.normal)
        // (Offered at the window's deadline, so the selector also finishes.)
        XCTAssertEqual(edge.offer(fix(0, accuracy: 50), now: start.addingTimeInterval(10)), .finish)
        XCTAssertEqual(edge.best?.accuracy, 50)
        XCTAssertEqual(edge.result(at: start.addingTimeInterval(10)).sample?.accuracy, 50)

        var coarse = selector(.normal)
        _ = coarse.offer(fix(0, accuracy: 50.01), now: start)
        XCTAssertEqual(coarse.rejections[.tooInaccurate], 1)

        var old = selector(.normal)
        _ = old.offer(fix(0, accuracy: 10), now: start.addingTimeInterval(10.01))
        XCTAssertEqual(old.rejections[.stale], 1)

        // A fix stamped up to 2 s ahead of the phone's clock is tolerated; beyond that it is not.
        var ahead = selector(.normal)
        _ = ahead.offer(fix(2, accuracy: 30), now: start)
        XCTAssertEqual(ahead.best?.accuracy, 30)
        var future = selector(.normal)
        _ = future.offer(fix(2.01, accuracy: 30), now: start)
        XCTAssertEqual(future.rejections[.future], 1)
    }

    func testThrottleSpacingIsMeasuredFromWindowStart() {
        var throttle = LocationSampleThrottle()
        let normal = LocationSamplingPolicy.policy(for: .normal)
        XCTAssertTrue(throttle.begin(normal, now: start))
        XCTAssertFalse(throttle.begin(normal, now: start.addingTimeInterval(29.9)))
        XCTAssertTrue(throttle.begin(normal, now: start.addingTimeInterval(30)))
    }

    func testThrottleAllowsSampleWhenClockMovesBackward() {
        // Pinned current behaviour: a phone clock set back cannot lock sampling out for the gap.
        var throttle = LocationSampleThrottle()
        let normal = LocationSamplingPolicy.policy(for: .normal)
        XCTAssertTrue(throttle.begin(normal, now: start.addingTimeInterval(30)))
        XCTAssertTrue(throttle.begin(normal, now: start))
        XCTAssertFalse(throttle.begin(normal, now: start.addingTimeInterval(10)), "the clock now runs from the earlier start")
    }

    func testOnlyACancelledWindowGivesItsSlotBack() {
        let normal = LocationSamplingPolicy.policy(for: .normal)
        // The ride left the foreground mid-window: returning may sample at once.
        var cancelled = LocationSampleThrottle()
        XCTAssertTrue(cancelled.begin(normal, now: start))
        XCTAssertTrue(cancelled.begin(normal, now: start.addingTimeInterval(30)))
        cancelled.release(normal, startedAt: start.addingTimeInterval(30))
        XCTAssertTrue(cancelled.begin(normal, now: start.addingTimeInterval(31)), "the spacing runs from the window before it")
        XCTAssertFalse(cancelled.begin(normal, now: start.addingTimeInterval(32)), "a new window takes the slot again")

        // A release that is not for the latest window changes nothing.
        var stale = LocationSampleThrottle()
        XCTAssertTrue(stale.begin(normal, now: start))
        XCTAssertTrue(stale.begin(normal, now: start.addingTimeInterval(30)))
        stale.release(normal, startedAt: start)
        XCTAssertFalse(stale.begin(normal, now: start.addingTimeInterval(31)))

        // Releasing "내 근처" never touches the shared ride clock.
        var separate = LocationSampleThrottle()
        let nearby = LocationSamplingPolicy.policy(for: .nearbyStops)
        XCTAssertTrue(separate.begin(normal, now: start))
        XCTAssertTrue(separate.begin(nearby, now: start.addingTimeInterval(1)))
        separate.release(nearby, startedAt: start.addingTimeInterval(1))
        XCTAssertFalse(separate.begin(.policy(for: .recovery), now: start.addingTimeInterval(5)))

        // Which outcomes release: only the app's own cancellation.
        let releasing = [LocationUnavailableReason.permissionNotDetermined, .denied, .restricted, .reducedAccuracy,
                         .throttled, .busy, .noAcceptableFix, .failed, .cancelled].filter(\.releasesThrottleSlot)
        XCTAssertEqual(releasing, [.cancelled], "a window that ran and found nothing keeps its slot")
    }

    // MARK: RideDeviceEvidencePolicy

    func testOnlyAForegroundRideSamples() {
        XCTAssertTrue(RideDeviceEvidencePolicy.maySample(foreground: true))
        XCTAssertFalse(RideDeviceEvidencePolicy.maySample(foreground: false), "the background reads official progress only")
    }

    func testRetainedFixFollowsForegroundPermissionAndOutcome() {
        let previous = fix(0, accuracy: 20)
        let fresh = fix(5, accuracy: 9)
        func retained(_ previous: DevicePositionSample?, _ outcome: LocationSampleOutcome?,
                      _ permission: LocationPermission = .fullAccuracy, foreground: Bool = true) -> DevicePositionSample? {
            RideDeviceEvidencePolicy.retained(previous: previous, outcome: outcome, permission: permission, foreground: foreground)
        }
        XCTAssertEqual(retained(previous, .fix(fresh)), fresh, "a new fix replaces the old one")
        XCTAssertEqual(retained(previous, .unavailable(.throttled)), previous, "no new fix keeps the engine-aged old one")
        XCTAssertEqual(retained(previous, nil), previous)
        // The scene went inactive while the reconcile awaited: even a fix taken in the foreground is dropped.
        XCTAssertNil(retained(previous, .fix(fresh), foreground: false))
        XCTAssertNil(retained(nil, nil, foreground: false))
        // Without Precise Location nothing is ride evidence, new or old.
        for permission in [LocationPermission.reducedAccuracy, .denied, .restricted, .notDetermined] {
            XCTAssertNil(retained(previous, .fix(fresh), permission), "\(permission)")
        }
    }
}
