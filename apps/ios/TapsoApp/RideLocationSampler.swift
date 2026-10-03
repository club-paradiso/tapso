import CoreLocation
import Foundation
import TapsoTransit

/// Foreground one-shot sampling. Never enables background GPS or Always permission.
@MainActor
final class RideLocationSampler: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<DevicePositionSample?, Never>?
    private var timeout: Task<Void, Never>?
    private var lastRequestAt: Date?
    private var generation = 0

    override init() {
        super.init()
        manager.delegate = self
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = true
    }

    func sample(urgent: Bool, requestPermission: Bool = false) async -> DevicePositionSample? {
        guard continuation == nil else { return nil }
        if manager.authorizationStatus == .notDetermined {
            if requestPermission { manager.requestWhenInUseAuthorization() }
            return nil
        }
        guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else { return nil }
        let now = Date()
        if let lastRequestAt, now.timeIntervalSince(lastRequestAt) < (urgent ? 10 : 60) { return nil }
        lastRequestAt = now
        generation += 1
        let currentGeneration = generation
        manager.desiredAccuracy = urgent ? kCLLocationAccuracyNearestTenMeters : kCLLocationAccuracyHundredMeters
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            timeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(6))
                guard !Task.isCancelled, let self, self.generation == currentGeneration else { return }
                self.complete(nil)
            }
            manager.requestLocation()
        }
    }

    func stop() { complete(nil) }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.max(by: { $0.timestamp < $1.timestamp }) else { complete(nil); return }
        complete(DevicePositionSample(
            coordinate: Coordinate(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude),
            timestamp: location.timestamp, accuracy: location.horizontalAccuracy,
            speed: location.speed >= 0 ? location.speed : nil,
            course: location.course >= 0 ? location.course : nil
        ))
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { complete(nil) }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted { complete(nil) }
    }

    private func complete(_ sample: DevicePositionSample?) {
        timeout?.cancel()
        timeout = nil
        manager.stopUpdatingLocation()
        let pending = continuation
        continuation = nil
        pending?.resume(returning: sample)
    }
}
