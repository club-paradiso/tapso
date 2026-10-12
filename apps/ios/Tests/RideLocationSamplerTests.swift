import CoreLocation
import XCTest
import TapsoTransit
@testable import Tapso

/// `RideLocationSampler` driven through `LocationManaging`: every path stops updates and resumes
/// the caller exactly once. SYNTHETIC fixes, not recordings of any rider.
@MainActor
final class RideLocationSamplerTests: XCTestCase {
    func testTheSamplerConfiguresItsManager() {
        let fake = FakeLocationManager()
        let sampler = RideLocationSampler(manager: fake, sleep: ManualClock().sleep)
        XCTAssertTrue(fake.delegate === sampler)
        XCTAssertEqual(fake.activityType, .automotiveNavigation)
        XCTAssertFalse(fake.pausesLocationUpdatesAutomatically)
        XCTAssertEqual(fake.distanceFilter, kCLDistanceFilterNone)
    }

    func testAGoodEnoughFixEndsTheWindowAndStopsOnce() async {
        let (sampler, fake, clock) = make()
        defer { clock.fire() }
        let window = Task { await sampler.sample(.normal) }
        await waitForStart(fake)
        sampler.receive([Self.fix(accuracy: 9)])
        let outcome = await window.value
        XCTAssertEqual(outcome.sample?.accuracy, 9)
        XCTAssertEqual(fake.desiredAccuracy, kCLLocationAccuracyNearestTenMeters)
        clock.fire()
        await settle()
        XCTAssertEqual(fake.startCount, 1)
        XCTAssertEqual(fake.stopCount, 1, "the deadline firing later does not finish twice")
    }

    func testNoFixEndsAtTheDeadlineWithNoAcceptableFix() async {
        let (sampler, fake, clock) = make()
        defer { clock.fire() }
        let window = Task { await sampler.sample(.normal) }
        await waitForStart(fake)
        sampler.receive([Self.fix(accuracy: 65)]) // worse than the engine accepts
        await clock.passDeadline()
        let outcome = await window.value
        XCTAssertEqual(outcome, .unavailable(.noAcceptableFix))
        XCTAssertEqual(fake.stopCount, 1)
        // Pinned: a window that ran and found nothing keeps its spacing slot.
        let next = await sampler.sample(.normal)
        XCTAssertEqual(next, .unavailable(.throttled))
        XCTAssertEqual(fake.startCount, 1)
    }

    func testStopMidWindowResumesExactlyOnceAndGivesTheSlotBack() async {
        let (sampler, fake, clock) = make()
        defer { clock.fire() }
        let window = Task { await sampler.sample(.normal) }
        await waitForStart(fake)
        sampler.stop() // the ride left the foreground
        let outcome = await window.value
        XCTAssertEqual(outcome, .unavailable(.cancelled))
        XCTAssertEqual(fake.stopCount, 1)
        // Late callbacks after the window ended change nothing.
        clock.fire()
        sampler.receive([Self.fix(accuracy: 9)])
        await settle()
        XCTAssertEqual(fake.stopCount, 1)
        // Back in the foreground within the 30 s spacing: it samples at once.
        let again = Task { await sampler.sample(.normal) }
        await waitForStart(fake, count: 2)
        XCTAssertEqual(fake.startCount, 2)
        sampler.receive([Self.fix(accuracy: 12)])
        let second = await again.value
        XCTAssertEqual(second.sample?.accuracy, 12)
    }

    func testAFailedWindowStopsAndReportsFailure() async {
        let (sampler, fake, clock) = make()
        defer { clock.fire() }
        let window = Task { await sampler.sample(.recovery) }
        await waitForStart(fake)
        sampler.fail(CLError(.denied))
        let outcome = await window.value
        XCTAssertEqual(outcome, .unavailable(.failed))
        XCTAssertEqual(fake.stopCount, 1)
    }

    func testLocationUnknownKeepsListening() async {
        let (sampler, fake, clock) = make()
        defer { clock.fire() }
        let window = Task { await sampler.sample(.recovery) }
        await waitForStart(fake)
        sampler.fail(CLError(.locationUnknown))
        await settle()
        XCTAssertEqual(fake.stopCount, 0, "a transient error does not end the window")
        sampler.receive([Self.fix(accuracy: 15)])
        let outcome = await window.value
        XCTAssertEqual(outcome.sample?.accuracy, 15)
        XCTAssertEqual(fake.stopCount, 1)
    }

    func testASecondSampleWhileOneRunsIsBusy() async {
        let (sampler, fake, clock) = make()
        defer { clock.fire() }
        let window = Task { await sampler.sample(.normal) }
        await waitForStart(fake)
        let second = await sampler.sample(.recovery)
        XCTAssertEqual(second, .unavailable(.busy))
        XCTAssertEqual(fake.startCount, 1)
        sampler.stop()
        _ = await window.value
        XCTAssertEqual(fake.stopCount, 1)
    }

    func testWithoutPermissionUpdatesNeverStartAndThePromptIsOnlyOnRequest() async {
        let cases: [(CLAuthorizationStatus, LocationUnavailableReason)] = [
            (.denied, .denied), (.restricted, .restricted), (.notDetermined, .permissionNotDetermined),
        ]
        for (status, reason) in cases {
            let (sampler, fake, clock) = make(status: status)
            defer { clock.fire() }
            let quiet = await sampler.sample(.normal)
            XCTAssertEqual(quiet, .unavailable(reason), "\(status.rawValue)")
            XCTAssertEqual(fake.permissionRequests, 0, "never prompts unasked: \(status.rawValue)")
            let asked = await sampler.sample(.normal, requestPermission: true)
            XCTAssertEqual(asked, .unavailable(reason), "\(status.rawValue)")
            XCTAssertEqual(fake.permissionRequests, status == .notDetermined ? 1 : 0, "\(status.rawValue)")
            XCTAssertEqual(fake.startCount, 0, "\(status.rawValue)")
        }
    }

    func testReducedAccuracyNeverStartsAWindow() async {
        let (sampler, fake, clock) = make(accuracy: .reducedAccuracy)
        defer { clock.fire() }
        XCTAssertEqual(sampler.permission, .reducedAccuracy)
        let outcome = await sampler.sample(.normal, requestPermission: true)
        XCTAssertEqual(outcome, .unavailable(.reducedAccuracy))
        XCTAssertEqual(fake.startCount, 0)
        XCTAssertEqual(fake.permissionRequests, 0)
    }

    func testReducedAccuracyMidWindowEndsIt() async {
        let (sampler, fake, clock) = make()
        defer { clock.fire() }
        let window = Task { await sampler.sample(.boarding) }
        await waitForStart(fake)
        sampler.receive([Self.fix(accuracy: 30)]) // acceptable, not good enough: still listening
        fake.accuracyAuthorization = .reducedAccuracy
        sampler.authorizationChanged()
        let outcome = await window.value
        XCTAssertEqual(outcome, .unavailable(.reducedAccuracy), "the kept precise fix is not handed back")
        XCTAssertEqual(fake.stopCount, 1)
    }

    // MARK: Helpers

    private func make(status: CLAuthorizationStatus = .authorizedWhenInUse,
                      accuracy: CLAccuracyAuthorization = .fullAccuracy) -> (RideLocationSampler, FakeLocationManager, ManualClock) {
        let fake = FakeLocationManager()
        fake.authorizationStatus = status
        fake.accuracyAuthorization = accuracy
        let clock = ManualClock()
        return (RideLocationSampler(manager: fake, sleep: clock.sleep), fake, clock)
    }

    private func waitForStart(_ fake: FakeLocationManager, count: Int = 1, file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<200 where fake.startCount < count {
            await Task.yield()
        }
        XCTAssertEqual(fake.startCount, count, "the window did not start", file: file, line: line)
    }

    private func settle() async {
        for _ in 0..<20 { await Task.yield() }
    }

    /// A SYNTHETIC fix, timestamped now.
    static func fix(accuracy: Double) -> CLLocation {
        CLLocation(coordinate: CLLocationCoordinate2D(latitude: 33.5, longitude: 126.5), altitude: 0,
                   horizontalAccuracy: accuracy, verticalAccuracy: 5, course: 10, speed: 5, timestamp: Date())
    }
}

/// Counts what the sampler asks of Core Location; delivers nothing on its own.
@MainActor
final class FakeLocationManager: LocationManaging {
    weak var delegate: (any CLLocationManagerDelegate)?
    var authorizationStatus: CLAuthorizationStatus = .authorizedWhenInUse
    var accuracyAuthorization: CLAccuracyAuthorization = .fullAccuracy
    var desiredAccuracy: CLLocationAccuracy = kCLLocationAccuracyBest
    var activityType: CLActivityType = .other
    var pausesLocationUpdatesAutomatically = true
    var distanceFilter: CLLocationDistance = 100
    private(set) var startCount = 0
    private(set) var stopCount = 0
    private(set) var permissionRequests = 0

    func requestWhenInUseAuthorization() { permissionRequests += 1 }
    func startUpdatingLocation() { startCount += 1 }
    func stopUpdatingLocation() { stopCount += 1 }
}

/// A window deadline that passes only when the test says so.
@MainActor
final class ManualClock {
    private var waiting: [CheckedContinuation<Void, Never>] = []

    var sleep: RideLocationSampler.Sleep {
        { [self] _ in await withCheckedContinuation { self.waiting.append($0) } }
    }

    /// Waits until a window's deadline task is asleep, then lets it pass. (The deadline task may not
    /// have started sleeping yet when the window's updates start.)
    func passDeadline() async {
        for _ in 0..<200 where waiting.isEmpty { await Task.yield() }
        XCTAssertFalse(waiting.isEmpty, "no window deadline was waiting")
        fire()
    }

    /// Lets every pending window deadline pass.
    func fire() {
        let pending = waiting
        waiting = []
        pending.forEach { $0.resume() }
    }
}
