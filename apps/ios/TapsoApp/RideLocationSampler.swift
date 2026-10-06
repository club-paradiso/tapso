import CoreLocation
import Foundation
import TapsoTransit

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
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<LocationSampleOutcome, Never>?
    private var selector: LocationFixSelector?
    private var deadline: Task<Void, Never>?
    private var throttle = LocationSampleThrottle()
    private var generation = 0

    override init() {
        super.init()
        manager.delegate = self
        manager.activityType = .automotiveNavigation
        // The window is already bounded; an automatic pause would only end it early without a fix.
        manager.pausesLocationUpdatesAutomatically = false
        manager.distanceFilter = kCLDistanceFilterNone
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
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            deadline = Task { [weak self] in
                try? await Task.sleep(for: .seconds(policy.window))
                guard !Task.isCancelled, let self, self.generation == current else { return }
                self.finish(nil)
            }
            manager.startUpdatingLocation()
        }
    }

    /// Ends any window in progress (the ride left the foreground or ended).
    func stop() { finish(.failed) }

    /// A new ride starts with no spacing carried over from the last one.
    func resetThrottle() { throttle.reset() }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
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

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // `locationUnknown` is transient: Core Location keeps trying inside the window.
        if (error as? CLError)?.code == .locationUnknown { return }
        finish(.failed)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
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
