import CoreLocation
import Foundation
import Observation
import TapsoTransit
import UserNotifications

/// "탑서가 먼저 말을 건다" at saved stops (`docs/exec-plans/AUTO_START.md`, M3).
///
/// Off by default; the rider opts a saved live journey in. One `CLMonitor`
/// circle per opted-in boarding stop, at most `StopNudge.maximumStops`. Entering
/// a circle reads the route's vehicle snapshot and posts a notification with
/// 탈게요 (opens the vehicle check for that journey) and 오늘은 아니에요
/// (silent until tomorrow). Whether the phone is near a stop is decided on the
/// phone; no coordinate is sent anywhere. With Always permission iOS relaunches
/// a terminated app for the event (AUTO_START C1, C2); with When In Use the
/// nudge works only while TAPSO runs, which the settings screen says.
@Observable
@MainActor
final class StopNudgeController: NSObject {
    static let shared = StopNudgeController()

    nonisolated static let monitorName = "tapso.stopNudges"
    nonisolated static let categoryID = "tapso.stopNudge"
    nonisolated static let rideActionID = "tapso.stopNudge.ride"
    nonisolated static let notTodayActionID = "tapso.stopNudge.notToday"
    nonisolated static let journeyKey = "journeyID"

    enum EnableFailure: Equatable {
        case notLive
        case limitReached
        case locationDenied
        case stopUnknown
        case network
    }

    private(set) var settings: StopNudgeSettings
    private(set) var authorization: CLAuthorizationStatus
    var lastFailure: EnableFailure?

    private let store: JourneyStore
    private let api: TapsoAPIClient
    private let locationManager = CLLocationManager()
    private var monitor: CLMonitor?
    private var eventTask: Task<Void, Never>?
    private var authorizationWaiters: [CheckedContinuation<CLAuthorizationStatus, Never>] = []

    init(store: JourneyStore = JourneyStore(), api: TapsoAPIClient = TapsoAPIClient()) {
        self.store = store
        self.api = api
        settings = store.loadStopNudges()
        authorization = locationManager.authorizationStatus
        super.init()
        locationManager.delegate = self
    }

    /// From app launch, including a relaunch for a monitor event: register the
    /// notification actions and resume the monitor when anything is opted in.
    func start() {
        let ride = UNNotificationAction(identifier: Self.rideActionID, title: RideText.string("stopNudge.action.ride"), options: [.foreground])
        let notToday = UNNotificationAction(identifier: Self.notTodayActionID, title: RideText.string("stopNudge.action.notToday"), options: [])
        let category = UNNotificationCategory(identifier: Self.categoryID, actions: [ride, notToday], intentIdentifiers: [])
        UNUserNotificationCenter.current().setNotificationCategories([category])
        UNUserNotificationCenter.current().delegate = self
        if !settings.stops.isEmpty {
            Task { await resync() }
        }
    }

    // MARK: Opt in and out

    /// Asks for notification and location permission, finds the boarding stop's
    /// coordinates on the route's current stop list, then monitors it.
    func enable(_ journey: SavedJourney) async {
        lastFailure = nil
        guard journey.isLive, let cityCode = journey.cityCode, let boardingSequence = journey.boardingSequence else {
            lastFailure = .notLive
            return
        }
        guard settings.isEnabled(journey.id) || settings.stops.count < StopNudge.maximumStops else {
            lastFailure = .limitReached
            return
        }
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        let status = await requestLocationAuthorization()
        guard status == .authorizedAlways || status == .authorizedWhenInUse else {
            lastFailure = .locationDenied
            return
        }
        let stop: TransitAPIStop
        do {
            let list = try await api.stops(routeID: journey.routeID.rawValue, cityCode: cityCode)
            guard let found = list.items.first(where: { $0.sequence == boardingSequence && $0.stopId == journey.boardingStopID.rawValue }) else {
                lastFailure = .stopUnknown
                return
            }
            stop = found
        } catch {
            lastFailure = .network
            return
        }
        guard let latitude = stop.latitude, let longitude = stop.longitude else {
            lastFailure = .stopUnknown
            return
        }
        settings.enable(.init(journeyID: journey.id, latitude: latitude, longitude: longitude))
        store.saveStopNudges(settings)
        await resync()
    }

    func disable(_ journeyID: String) async {
        settings.disable(journeyID)
        store.saveStopNudges(settings)
        await resync()
    }

    // MARK: Monitor

    private func resync() async {
        let monitor: CLMonitor
        if let existing = self.monitor {
            monitor = existing
        } else {
            monitor = await CLMonitor(Self.monitorName)
            self.monitor = monitor
            eventTask = Task { [weak self] in
                do {
                    for try await event in await monitor.events where event.state == .satisfied {
                        await self?.handleEntry(journeyID: event.identifier)
                    }
                } catch {
                    // The stream ends only when the monitor is torn down; the next launch rebuilds it.
                }
            }
        }
        let wanted = Set(settings.stops.map(\.journeyID))
        for identifier in await monitor.identifiers where !wanted.contains(identifier) {
            await monitor.remove(identifier)
        }
        let present = Set(await monitor.identifiers)
        for stop in settings.stops where !present.contains(stop.journeyID) {
            let condition = CLMonitor.CircularGeographicCondition(
                center: CLLocationCoordinate2D(latitude: stop.latitude, longitude: stop.longitude),
                radius: StopNudge.radiusMeters
            )
            await monitor.add(condition, identifier: stop.journeyID, assuming: .unsatisfied)
        }
    }

    private func handleEntry(journeyID: String) async {
        settings = store.loadStopNudges()
        let now = Date()
        guard settings.isEnabled(journeyID), !settings.isSnoozed(journeyID, now: now),
              let journey = store.loadLibrary().journey(id: journeyID),
              let cityCode = journey.cityCode, let boardingSequence = journey.boardingSequence
        else { return }
        let sequences = (try? await api.vehicleStopSequences(routeID: journey.routeID.rawValue, cityCode: cityCode)) ?? []
        let message = StopNudge.Message(
            routeNumber: journey.routeNumber,
            stopsAway: StopNudge.nearestStopsAway(boardingSequence: boardingSequence, vehicleSequences: sequences)
        )
        let content = UNMutableNotificationContent()
        content.title = String(format: RideText.string("stopNudge.title"), journey.boardingStopName)
        content.body = StopNudgeText.body(message)
        content.sound = .default
        content.categoryIdentifier = Self.categoryID
        content.userInfo = [Self.journeyKey: journeyID]
        content.threadIdentifier = Self.categoryID
        let request = UNNotificationRequest(identifier: "\(Self.categoryID).\(journeyID)", content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }

    // MARK: Location permission

    /// When In Use first; then Always, which Apple allows to be asked once (AUTO_START C12).
    private func requestLocationAuthorization() async -> CLAuthorizationStatus {
        if authorization == .notDetermined {
            authorization = await waitForAuthorization { locationManager.requestWhenInUseAuthorization() }
        }
        if authorization == .authorizedWhenInUse {
            authorization = await waitForAuthorization(timeout: .seconds(8)) { locationManager.requestAlwaysAuthorization() }
        }
        return authorization
    }

    /// Asks, then waits for the delegate's answer. An Always upgrade may never
    /// prompt (Apple shows it once, sometimes later), so it gives up after a while.
    private func waitForAuthorization(timeout: Duration = .seconds(60), _ ask: () -> Void) async -> CLAuthorizationStatus {
        await withCheckedContinuation { continuation in
            authorizationWaiters.append(continuation)
            ask()
            Task { [weak self] in
                try? await Task.sleep(for: timeout)
                self?.resumeWaiters()
            }
        }
    }

    private func resumeWaiters() {
        let waiters = authorizationWaiters
        authorizationWaiters = []
        let status = locationManager.authorizationStatus
        for waiter in waiters { waiter.resume(returning: status) }
    }
}

extension StopNudgeController: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            self.authorization = self.locationManager.authorizationStatus
            // The first callback reports the current state before any answer.
            if self.authorization != .notDetermined {
                self.resumeWaiters()
            }
        }
    }
}

extension StopNudgeController: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let action = response.actionIdentifier
        let journeyID = response.notification.request.content.userInfo[Self.journeyKey] as? String
        await MainActor.run {
            guard let journeyID else { return }
            switch action {
            case Self.notTodayActionID:
                self.settings.snoozeForToday(journeyID, now: Date())
                self.store.saveStopNudges(self.settings)
            case Self.rideActionID, UNNotificationDefaultActionIdentifier:
                ShortcutInbox.shared.requestedJourneyID = journeyID
                ShortcutInbox.shared.rideAgainRequests += 1
            default:
                break
            }
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

/// The notification's words for a `StopNudge.Message`.
enum StopNudgeText {
    static func body(_ message: StopNudge.Message) -> String {
        switch message {
        case let .approaching(route, count):
            String(format: RideText.string("stopNudge.body.approaching"), route, count)
        case let .atStop(route):
            String(format: RideText.string("stopNudge.body.atStop"), route)
        case let .unknown(route):
            String(format: RideText.string("stopNudge.body.unknown"), route)
        }
    }
}
