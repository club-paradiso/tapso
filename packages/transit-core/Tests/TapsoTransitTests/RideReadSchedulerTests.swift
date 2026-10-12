import XCTest
@testable import TapsoTransit

/// The live ride's read scheduling (`LIVE_RIDE_RELIABILITY_HOME_V3.md` §2.1): start-to-start
/// cadence, one read at a time, one pending refresh, immediate return-to-app refresh.
final class RideReadSchedulerTests: XCTestCase {
    /// Drives the scheduler the way the app's loop does, with reads of a fixed length.
    private func simulate(interval: Double, requestDuration: Double, reads: Int) -> [Double] {
        var scheduler = RideReadScheduler()
        var now = 0.0
        var starts: [Double] = []
        for _ in 0..<reads {
            now += scheduler.delay(now: now, interval: interval)
            _ = scheduler.begin(now: now)
            starts.append(now)
            now += requestDuration
            scheduler.finish()
        }
        return starts
    }

    func testCadenceIsMeasuredFromStartToStart() {
        let starts = simulate(interval: 15, requestDuration: 3, reads: 5)
        let gaps = zip(starts.dropFirst(), starts).map { $0 - $1 }
        XCTAssertEqual(gaps, [15, 15, 15, 15], "a 3 s answer does not stretch a 15 s cadence to 18 s")
    }

    func testAReadLongerThanTheIntervalIsFollowedAtOnceButNeverOverlapped() {
        let starts = simulate(interval: 10, requestDuration: 14, reads: 3)
        XCTAssertEqual(starts, [0, 14, 28], "the next read waits for the previous one, then starts without a further sleep")
    }

    func testTheFirstReadIsImmediate() {
        XCTAssertEqual(RideReadScheduler().delay(now: 100, interval: 15), 0)
    }

    func testForegroundRefreshDoesNotWaitOutTheOldSleep() {
        var scheduler = RideReadScheduler()
        _ = scheduler.begin(now: 0)
        scheduler.finish()
        XCTAssertEqual(scheduler.delay(now: 4, interval: 15), 11)
        XCTAssertEqual(scheduler.request(.foreground), .scheduled)
        XCTAssertEqual(scheduler.delay(now: 4, interval: 15), 0, "back in the app: read now")
        XCTAssertEqual(scheduler.begin(now: 4).trigger, .foreground)
    }

    func testRapidActiveInactiveFlappingCannotBurst() {
        var scheduler = RideReadScheduler()
        _ = scheduler.begin(now: 0)
        scheduler.finish()
        scheduler.request(.foreground)
        XCTAssertEqual(scheduler.delay(now: 0.5, interval: 15), 1.5, "never closer than the minimum gap")
        XCTAssertEqual(scheduler.request(.foreground), .coalesced)
        XCTAssertEqual(scheduler.request(.foreground), .coalesced)
        _ = scheduler.begin(now: 2)
        scheduler.finish()
        XCTAssertNil(scheduler.pending, "the flapping cost exactly one extra read")
    }

    func testTapSpamDuringAReadCollapsesIntoOnePendingRefresh() {
        var scheduler = RideReadScheduler()
        _ = scheduler.begin(now: 0)
        XCTAssertEqual(scheduler.request(.manual), .queued, "accepted, runs after the read in flight")
        for _ in 0..<20 { XCTAssertEqual(scheduler.request(.manual), .coalesced) }
        scheduler.finish()
        XCTAssertEqual(scheduler.delay(now: 3, interval: 15), 0, "the queued refresh runs as soon as the read ends")
        XCTAssertEqual(scheduler.begin(now: 3).trigger, .manual)
        scheduler.finish()
        XCTAssertNil(scheduler.pending)
        XCTAssertEqual(scheduler.delay(now: 3, interval: 15), 15, "and then the cadence resumes")
    }

    func testAManualRefreshWithNothingInFlightRunsNow() {
        var scheduler = RideReadScheduler()
        _ = scheduler.begin(now: 0)
        scheduler.finish()
        XCTAssertEqual(scheduler.request(.manual), .scheduled)
        XCTAssertEqual(scheduler.delay(now: 9, interval: 15), 0)
    }

    func testGenerationsIncreasePerRead() {
        var scheduler = RideReadScheduler()
        let first = scheduler.begin(now: 0).generation
        scheduler.finish()
        let second = scheduler.begin(now: 15).generation
        XCTAssertLessThan(first, second)
    }

    func testARestartedLoopKeepsOrderingAnswers() {
        var first = RideReadScheduler()
        for second in 0..<7 {
            _ = first.begin(now: Double(second) * 15)
            first.finish()
        }
        let shown = RideEvidenceOrder.Stamp(generation: first.generation, evidenceAt: nil)
        var restarted = RideReadScheduler(continuingFrom: first.generation)
        let next = restarted.begin(now: 200).generation
        XCTAssertTrue(RideEvidenceOrder.accepts(.init(generation: next, evidenceAt: nil), over: shown),
                      "a fresh answer after a restart is never mistaken for an old one")
    }

    // MARK: Ordering

    func testAnOlderReadCompletingLastCannotRollTheCountBack() {
        let t = Date(timeIntervalSince1970: 1_800_000_000)
        // Read A began first; read B began later and answered first with 10 stops left.
        let a = RideEvidenceOrder.Stamp(generation: 1, evidenceAt: t)
        let b = RideEvidenceOrder.Stamp(generation: 2, evidenceAt: t.addingTimeInterval(9))
        XCTAssertTrue(RideEvidenceOrder.accepts(b, over: nil))
        XCTAssertFalse(RideEvidenceOrder.accepts(a, over: b), "A's 12 stops arrive last and are dropped: the ride stays at 10")
    }

    func testOlderEvidenceFromALaterReadIsRefused() {
        let t = Date(timeIntervalSince1970: 1_800_000_000)
        let shown = RideEvidenceOrder.Stamp(generation: 4, evidenceAt: t)
        let replay = RideEvidenceOrder.Stamp(generation: 5, evidenceAt: t.addingTimeInterval(-20))
        XCTAssertFalse(RideEvidenceOrder.accepts(replay, over: shown))
    }

    func testEqualOrNewerEvidenceAndEvidenceFreeAnswersAreAccepted() {
        let t = Date(timeIntervalSince1970: 1_800_000_000)
        let shown = RideEvidenceOrder.Stamp(generation: 4, evidenceAt: t)
        XCTAssertTrue(RideEvidenceOrder.accepts(.init(generation: 5, evidenceAt: t), over: shown), "same evidence re-read: state changes such as lost still apply")
        XCTAssertTrue(RideEvidenceOrder.accepts(.init(generation: 5, evidenceAt: nil), over: shown))
        XCTAssertTrue(RideEvidenceOrder.accepts(.init(generation: 5, evidenceAt: t.addingTimeInterval(1)), over: shown))
    }

    // MARK: Evidence clock

    func testEvidenceAgeComesFromTheServersOwnClock() {
        let received = Date(timeIntervalSince1970: 1_800_000_100)
        // The server's clock is 90 s ahead of the phone's; the row was received 6 s before evaluation.
        let serverNow = received.addingTimeInterval(90)
        let evidence = RideEvidenceClock.evidenceAt(serverEvidenceAt: serverNow.addingTimeInterval(-6), serverEvaluatedAt: serverNow, receivedAt: received)
        XCTAssertEqual(evidence, received.addingTimeInterval(-6))
    }

    func testReevaluatingOldEvidenceDoesNotMakeItNew() {
        let received = Date(timeIntervalSince1970: 1_800_000_100)
        let evidence = RideEvidenceClock.evidenceAt(serverEvidenceAt: received.addingTimeInterval(-80), serverEvaluatedAt: received, receivedAt: received)
        XCTAssertEqual(evidence, received.addingTimeInterval(-80), "a retained 80 s old row stays 80 s old")
        XCTAssertNil(RideEvidenceClock.evidenceAt(serverEvidenceAt: nil, serverEvaluatedAt: received, receivedAt: received))
    }

    // MARK: Failures

    func testOnlyAGoneSessionEndsTheRideAtOnce() {
        for failure in [TransitAPIFailure.sessionNotFound, .sessionExpired, .rejected] {
            XCTAssertEqual(RideReadFailurePolicy.action(for: failure, consecutiveFailures: 1), .endSession, failure.name)
        }
        for failure in [TransitAPIFailure.offline, .timedOut, .providerTimeout, .providerUnavailable, .server, .rateLimited, .unexpectedResponse] {
            XCTAssertEqual(RideReadFailurePolicy.action(for: failure, consecutiveFailures: 50), .retry, failure.name)
        }
    }

    func testASessionStoreHiccupIsRetriedBeforeTheRideGivesUp() {
        for count in 1..<RideReadFailurePolicy.unavailableRetryLimit {
            XCTAssertEqual(RideReadFailurePolicy.action(for: .sessionsUnavailable, consecutiveFailures: count), .retry, "\(count)")
        }
        XCTAssertEqual(RideReadFailurePolicy.action(for: .sessionsUnavailable, consecutiveFailures: RideReadFailurePolicy.unavailableRetryLimit), .endSession)
    }
}
