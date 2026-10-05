import CoreLocation
import Foundation

/// "앱을 닫아도 계속 갱신" (`docs/KNOWN_ISSUES.md`, the Lock Screen freeze without
/// APNs). Opt-in and only during a live ride whose activity has no push: a
/// running location service keeps TAPSO from being suspended, so the ride's
/// own polling goes on and updates the Lock Screen and the Dynamic Island.
///
/// The location itself is never used or sent: the delegate drops every fix,
/// and the accuracy asked for is the coarsest iOS offers (cell and Wi-Fi), the
/// cheapest that keeps the app running. iOS shows its blue location indicator
/// while it runs. When a push token is registered (paid Apple team, APNs) the
/// ride stops this and the server pushes instead (owner decision, 2026-10-06).
@MainActor
final class RideKeepAlive: NSObject {
    static let preferenceKey = "tapso.rideKeepAlive.v1"

    private let manager = CLLocationManager()
    private let defaults: UserDefaults
    private var startWhenAuthorized = false
    private(set) var isRunning = false
    /// Called when a start waiting for permission is denied.
    var onDenied: (() -> Void)?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
        manager.distanceFilter = 500
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .otherNavigation
    }

    /// The rider's choice, remembered for the next ride.
    var isEnabled: Bool {
        get { defaults.bool(forKey: Self.preferenceKey) }
        set { defaults.set(newValue, forKey: Self.preferenceKey) }
    }

    /// Starts from the foreground (iOS allows a background location service to
    /// begin only there). Asks for When In Use first when it is undecided.
    func start() {
        guard !isRunning else { return }
        switch manager.authorizationStatus {
        case .notDetermined:
            startWhenAuthorized = true
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
            manager.startUpdatingLocation()
            isRunning = true
        default:
            onDenied?()
        }
    }

    func stop() {
        startWhenAuthorized = false
        guard isRunning else { return }
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        isRunning = false
    }
}

extension RideKeepAlive: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        // Dropped on purpose: the service runs to keep the ride's polling alive, not to locate the rider.
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            guard self.startWhenAuthorized else { return }
            switch self.manager.authorizationStatus {
            case .notDetermined:
                return
            case .authorizedWhenInUse, .authorizedAlways:
                self.startWhenAuthorized = false
                self.start()
            default:
                self.startWhenAuthorized = false
                self.onDenied?()
            }
        }
    }
}
