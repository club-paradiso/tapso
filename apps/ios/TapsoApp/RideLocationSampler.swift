import CoreLocation
import Foundation
import TapsoTransit

/// The slice of `CLLocationManager` the sampler uses, so tests can drive it without Core Location.
@MainActor
protocol LocationManaging: AnyObject {
    var delegate: (any CLLocationManagerDelegate)? { get set }
    var authorizationStatus: CLAuthorizationStatus { get }
    var accuracyAuthorization: CLAccuracyAuthorization { get }
    var desiredAccuracy: CLLocationAccuracy { get set }
    var activityType: CLActivityType { get set }
    var pausesLocationUpdatesAutomatically: Bool { get set }
    var distanceFilter: CLLocationDistance { get set }
    func requestWhenInUseAuthorization()
    func startUpdatingLocation()
    func stopUpdatingLocation()
}

extension CLLocationManager: LocationManaging {}

/// Foreground, bounded sampling. Never enables background GPS or Always permission.
///
/// Policy lives in `LocationSamplingPolicy` / `LocationFixSelector` (transit-core,
/// unit tested); this class only forwards Core Location fixes and the clock.
/// Standard updates run for at most the mode's window (4–6 s) and stop as soon
/// as a good-enough fix arrives: `requestLocation()` was not used because it
/// reports a single fix and, per Apple, settles for a less accurate one when the
/// requested accuracy takes too long. Fixes stay in memory and are never logged.
///
/// `RideKeepAlive` owns a separate manager whose fixes are dropped unread; it
/// keeps polling alive in the background and is never ride evidence. This
/// sampler runs only while the ride is in the foreground
/// (`BOARDING_ANCHOR_POSITION_V2.md` §9).
@MainActor
final class RideLocationSampler: NSObject, @preconcurrency CLLocationManagerDelegate {
    /// Waits out one window. Tests pass a clock they release by hand.
    typealias Sleep = @MainActor @Sendable (TimeInterval) async -> Void

    private let manager: any LocationManaging
    private let sleep: Sleep
    private var continuation: CheckedContinuation<LocationSampleOutcome, Never>?
    private var selector: LocationFixSelector?
    private var deadline: Task<Void, Never>?
    private var throttle = LocationSampleThrottle()
    private var generation = 0

    /// `nil` arguments: a real `CLLocationManager` and the task clock. (Not default arguments:
    /// Xcode 16.4's SILGen crashes on an existential default.)
    init(manager: (any LocationManaging)? = nil, sleep: Sleep? = nil) {
        self.manager = manager ?? CLLocationManager()
        self.sleep = sleep ?? { seconds in try? await Task.sleep(for: .seconds(seconds)) }
        super.init()
        self.manager.delegate = self
        self.manager.activityType = .automotiveNavigation
        // The window is already bounded; an automatic pause would only end it early without a fix.
        self.manager.pausesLocationUpdatesAutomatically = false
        self.manager.distanceFilter = kCLDistanceFilterNone
    }

    /// What the rider has granted, including Precise Location (`accuracyAuthorization`).
    var permission: LocationPermission {
        switch manager.authorizationStatus {
        case .notDetermined: .notDetermined
        case .denied: .denied
        case .restricted: .restricted
        case .authorizedWhenInUse, .authorizedAlways:
            manager.accuracyAuthorization == .fullAccuracy ? .fullAccuracy : .reducedAccuracy
        @unknown default: .denied
        }
    }

    func sample(_ mode: LocationSamplingMode, requestPermission: Bool = false) async -> LocationSampleOutcome {
        guard continuation == nil else { return .unavailable(.busy) }
        switch permission {
        case .notDetermined:
            if requestPermission { manager.requestWhenInUseAuthorization() }
            return .unavailable(.permissionNotDetermined)
        case .denied: return .unavailable(.denied)
        case .restricted: return .unavailable(.restricted)
        // Apple ignores desiredAccuracy under reduced accuracy; such a fix can
        // neither place a rider at a pole nor corroborate a bus. Say so honestly.
        case .reducedAccuracy: return .unavailable(.reducedAccuracy)
        case .fullAccuracy: break
        }
        let policy = LocationSamplingPolicy.policy(for: mode)
        let now = Date()
        guard throttle.begin(policy, now: now) else { return .unavailable(.throttled) }
        generation += 1
        let current = generation
        selector = LocationFixSelector(policy: policy, startedAt: now)
        manager.desiredAccuracy = Self.coreLocationAccuracy(metres: policy.requestedAccuracy)
        let sleep = self.sleep
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            deadline = Task { [weak self] in
                await sleep(policy.window)
                guard !Task.isCancelled, let self, self.generation == current else { return }
                self.finish(nil)
            }
            manager.startUpdatingLocation()
        }
    }

    /// Ends any window in progress (the ride left the foreground or ended). The window gives its
    /// spacing slot back: it never had the chance to deliver (`LocationSampleThrottle.release`).
    func stop() { finish(.cancelled) }

    /// A new ride starts with no spacing carried over from the last one.
    func resetThrottle() { throttle.reset() }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        receive(locations)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        fail(error)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorizationChanged()
    }

    // The delegate callbacks' bodies, which tests call with a fake manager.

    func receive(_ locations: [CLLocation]) {
        guard var selector else { return }
        let now = Date()
        var decision = LocationFixSelector.Decision.keepListening
        for location in locations {
            decision = selector.offer(DevicePositionSample(
                coordinate: Coordinate(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude),
                timestamp: location.timestamp, accuracy: location.horizontalAccuracy,
                speed: location.speed >= 0 ? location.speed : nil,
                course: location.course >= 0 ? location.course : nil
            ), now: now)
            if decision == .finish { break }
        }
        self.selector = selector
        if decision == .finish { finish(nil) }
    }

    func fail(_ error: Error) {
        // `locationUnknown` is transient: Core Location keeps trying inside the window.
        if (error as? CLError)?.code == .locationUnknown { return }
        finish(.failed)
    }

    func authorizationChanged() {
        guard continuation != nil else { return }
        switch permission {
        case .fullAccuracy: return
        case .reducedAccuracy: finish(.reducedAccuracy)
        case .denied: finish(.denied)
        case .restricted: finish(.restricted)
        case .notDetermined: finish(.permissionNotDetermined)
        }
    }

    /// `nil` reason: the selector decides (best acceptable fix, or none).
    private func finish(_ reason: LocationUnavailableReason?) {
        deadline?.cancel()
        deadline = nil
        manager.stopUpdatingLocation()
        if let reason, reason.releasesThrottleSlot, let selector {
            throttle.release(selector.policy, startedAt: selector.startedAt)
        }
        let outcome: LocationSampleOutcome
        if let reason {
            outcome = .unavailable(reason)
        } else if let selector {
            outcome = selector.result(at: Date())
        } else {
            outcome = .unavailable(.noAcceptableFix)
        }
        selector = nil
        let pending = continuation
        continuation = nil
        pending?.resume(returning: outcome)
    }

    private static func coreLocationAccuracy(metres: Double) -> CLLocationAccuracy {
        if metres <= 5 { return kCLLocationAccuracyBest }
        if metres <= 10 { return kCLLocationAccuracyNearestTenMeters }
        return kCLLocationAccuracyHundredMeters
    }
}
