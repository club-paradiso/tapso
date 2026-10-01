import Foundation
import Observation
import TapsoTransit

// A live ride on real Jeju buses, through the TAPSO transit API.
//
// Route number → direction → where to get off → where to get on → the server
// opens a journey session and tracks the route's buses → the rider picks the
// bus they boarded by its plate → the server tracks that bus → stops count
// down to the destination → the rider ends the ride. The server is the only
// authority on matching: at READY_FOR_SHADOW riders see nothing from the
// matcher, so the client lists raw positions and the rider's tap is what
// selects a bus. `LiveRide` (transit-core) decides what each answer means;
// this model only sequences requests and hands the result to the screens and
// the Live Activity.
//
// Deliberately no UIKit, SwiftUI or ActivityKit here: the Live Activity and
// feedback sit behind `LiveRideSurfaces`, so the whole model also builds and
// runs its tests outside Xcode.

/// A step of live setup, pushed onto the live flow's navigation stack.
enum LiveSetupStep: Hashable {
    case direction
    case destination
    case boarding
}

/// What the Live Activity shows for a live ride, as plain values.
struct LiveRideContent: Hashable, Sendable {
    let routeNumber: String
    let routeID: String
    let boardingStopName: String
    let destinationName: String
    let totalStops: Int
    /// Masked, as painted on the bus: `••1234`.
    let vehiclePlate: String?
    let phase: JourneyState
    let currentStopName: String
    let nextStopName: String?
    let remainingStops: Int
    let freshness: DataFreshness
    let updatedAt: Date
    let destinationPassed: Bool
    let isOffline: Bool
}

/// The Live Activity and feedback, as the live model uses them. The app wires
/// ActivityKit and UIKit behind it; tests record the calls.
@MainActor
protocol LiveRideSurfaces: AnyObject {
    /// Starts the Live Activity, or takes over the one a relaunched app left
    /// (`resuming`). Throws when it cannot start (switched off in Settings).
    func start(_ content: LiveRideContent, resuming: Bool) async throws
    /// Updates it, alerting only for `milestone`, which signals at most once per ride.
    func update(_ content: LiveRideContent, alerting milestone: RideMilestone?) async
    func end(_ content: LiveRideContent, immediately: Bool) async
    /// A new moment: VoiceOver hears it; `haptic` is false for a milestone already signalled.
    func announce(_ guidance: RideGuidance, haptic: Bool)
}

/// What a live ride needs to come back after the app is relaunched.
struct LiveRideRecord: Codable, Hashable, Sendable {
    let route: LiveRoute
    let stops: [LiveStop]
    let boarding: LiveStop
    let destination: LiveStop
    /// The server's last answer and when it came; a resumed ride is aged from it.
    var session: LiveSession
    var lastSuccessAt: Date
    var plate: String?
    var alertedMilestones: Set<RideMilestone>
    let startedAt: Date
}

@MainActor
protocol LiveRideRecordStore: AnyObject {
    func load() -> LiveRideRecord?
    func save(_ record: LiveRideRecord?)
}

/// The record in `UserDefaults`, removed when the ride ends.
final class DefaultsLiveRideRecordStore: LiveRideRecordStore {
    private let defaults: UserDefaults
    private let key = "tapso.liveRide.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> LiveRideRecord? {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(LiveRideRecord.self, from: $0) }
    }

    func save(_ record: LiveRideRecord?) {
        if let record, let data = try? JSONEncoder().encode(record) {
            defaults.set(data, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
    }
}

@Observable
@MainActor
final class LiveRideModel {
    /// TAGO's city code for Jeju.
    nonisolated static let cityCode = "39"
    /// A session lives four hours on the server; a record older than that is not resumed.
    nonisolated static let resumeLimit: TimeInterval = 4 * 3_600

    var isPresented = false
    var path: [LiveSetupStep] = []
    var routeQuery = ""

    // Setup
    private(set) var routes: [LiveRoute] = []
    /// The number last searched, once its answer is in.
    private(set) var searchedNumber: String?
    private(set) var route: LiveRoute?
    private(set) var stops: [LiveStop] = []
    private(set) var destination: LiveStop?
    private(set) var boarding: LiveStop?
    private(set) var isLoading = false
    /// Why the last setup request failed, until the next one.
    private(set) var setupIssue: LiveIssue?

    // Ride
    private(set) var ride: LiveRide?
    private(set) var choices: [LiveVehicleChoice] = []
    private(set) var hasLookedForBuses = false
    private(set) var confirmingVehicleId: String?
    /// Why the rider's confirmation did not go through.
    private(set) var confirmIssue: LiveIssue?
    private(set) var plate: String?
    private(set) var resumed = false
    private(set) var liveActivityUnavailable = false
    private(set) var now: Date

    @ObservationIgnored private let client: LiveAPIClient
    @ObservationIgnored private let surfaces: (any LiveRideSurfaces)?
    @ObservationIgnored private let store: (any LiveRideRecordStore)?
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private let pause: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private let autoPoll: Bool
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private var startedAt: Date?
    @ObservationIgnored private var lastMoment: RideMoment?

    /// - Parameter autoPoll: `false` in tests, which call `poll()` and `tick()` themselves.
    init(
        client: LiveAPIClient,
        surfaces: (any LiveRideSurfaces)? = nil,
        store: (any LiveRideRecordStore)? = nil,
        clock: @escaping () -> Date = { Date() },
        pause: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        autoPoll: Bool = true
    ) {
        self.client = client
        self.surfaces = surfaces
        self.store = store
        self.clock = clock
        self.pause = pause
        self.autoPoll = autoPoll
        now = clock()
    }

    // MARK: Derived

    var hasRide: Bool { ride != nil }

    var guidance: RideGuidance? { ride?.guidance(now: now, isOffline: false) }

    var directions: [LiveRoute] {
        searchedNumber.map { LiveSetup.directions(routes, for: $0) } ?? routes
    }

    var destinationOptions: [LiveStop] { LiveSetup.destinations(stops) }

    var boardingOptions: [LiveStop] {
        destination.map { LiveSetup.boardingStops(stops, destination: $0) } ?? []
    }

    var routeNumber: String { route?.routeNumber ?? "" }
    var destinationName: String { destination?.name ?? "" }
    var boardingName: String { boarding?.name ?? "" }

    var totalStops: Int {
        max(1, (destination?.sequence ?? 1) - (boarding?.sequence ?? 0))
    }

    var remainingStops: Int {
        max(0, ride?.signal(now: now, isOffline: false)?.remainingStops ?? totalStops)
    }

    /// Where the rider's bus is, by name; the boarding stop until the server places it.
    var currentStopName: String {
        guard let sequence = ride?.session.progress?.currentStopSequence,
              let stop = LiveSetup.stop(stops, at: sequence)
        else { return boardingName }
        return stop.name
    }

    /// Stops still ahead, next first, ending at the destination.
    var upcomingStopNames: [String] {
        guard let destination else { return [] }
        let current = ride?.session.progress?.currentStopSequence ?? boarding?.sequence ?? destination.sequence
        return LiveSetup.upcomingNames(stops, after: current, through: destination.sequence)
    }

    /// The Live Activity's content now; `phase` overrides the ride's (ended, cancelled).
    func content(phase override: JourneyState? = nil) -> LiveRideContent? {
        guard let ride, let route, let boarding, let destination else { return nil }
        let signal = ride.signal(now: now, isOffline: false)
        return LiveRideContent(
            routeNumber: route.routeNumber,
            routeID: route.routeId,
            boardingStopName: boarding.name,
            destinationName: destination.name,
            totalStops: totalStops,
            vehiclePlate: plate,
            phase: override ?? signal?.phase ?? .vehicleRecovery,
            currentStopName: currentStopName,
            nextStopName: upcomingStopNames.first,
            remainingStops: signal?.remainingStops ?? totalStops,
            freshness: signal?.freshness ?? .unknown,
            updatedAt: ride.lastSuccessAt,
            destinationPassed: signal?.destinationPassed ?? false,
            isOffline: signal?.isOffline ?? false
        )
    }

    // MARK: Opening and closing

    func open() {
        guard ride == nil else {
            isPresented = true
            return
        }
        resetSetup()
        isPresented = true
    }

    /// Leaves setup. A session opened for it is ended on the server.
    func close() async {
        let unconfirmed = ride.flatMap { $0.stage == .choosingVehicle ? $0.session.id : nil }
        stopPolling()
        ride = nil
        store?.save(nil)
        resetSetup()
        isPresented = false
        if let unconfirmed {
            try? await client.endSession(id: unconfirmed)
        }
    }

    /// After the end screen: back to Home, ready for the next ride.
    func dismissEnded() {
        stopPolling()
        ride = nil
        resetSetup()
        isPresented = false
    }

    // MARK: Setup

    func searchRoutes() async {
        guard let number = LiveSetup.routeNumber(routeQuery) else {
            setupIssue = .setupInvalid
            return
        }
        guard let found = await load({ [client] in try await client.routes(cityCode: Self.cityCode, routeNumber: number) }) else { return }
        routes = found
        searchedNumber = number
        route = nil
        destination = nil
        boarding = nil
        if found.count == 1, let only = found.first {
            await chooseRoute(only)
        } else if !found.isEmpty {
            path = [.direction]
        }
    }

    func chooseRoute(_ chosen: LiveRoute) async {
        guard let list = await load({ [client] in try await client.stops(routeId: chosen.routeId, cityCode: Self.cityCode) }) else { return }
        route = chosen
        stops = list.items
        destination = nil
        boarding = nil
        path = routes.count > 1 ? [.direction, .destination] : [.destination]
    }

    func chooseDestination(_ stop: LiveStop) {
        destination = stop
        boarding = nil
        setupIssue = nil
        path.append(.boarding)
    }

    /// Opens the journey session. Not retried by the client: a repeat could open a second one.
    func chooseBoarding(_ stop: LiveStop) async {
        guard ride == nil, let route, let destination, stop.sequence < destination.sequence else { return }
        let request = LiveSessionRequest(
            routeId: route.routeId,
            cityCode: Self.cityCode,
            boardingStopSequence: stop.sequence,
            destinationStopSequence: destination.sequence
        )
        boarding = stop
        guard let session = await load({ [client] in try await client.createSession(request) }) else { return }
        let at = clock()
        now = at
        startedAt = at
        ride = LiveRide(session: session, at: at)
        choices = []
        hasLookedForBuses = false
        confirmIssue = nil
        plate = nil
        lastMoment = nil
        path = []
        persist()
        startPolling(immediately: true)
    }

    // MARK: Vehicle

    /// The rider's own choice. Nothing else ever selects a bus.
    func confirm(_ choice: LiveVehicleChoice) async {
        guard let current = ride, current.stage == .choosingVehicle, confirmingVehicleId == nil else { return }
        confirmingVehicleId = choice.vehicleId
        confirmIssue = nil
        defer { confirmingVehicleId = nil }
        do {
            let session = try await client.confirm(sessionId: current.session.id, vehicleId: choice.vehicleId)
            now = clock()
            ride?.apply(session, at: now)
            guard ride?.stage == .riding else { return }
            plate = choice.maskedPlate
            // The rider is looking at the screen: whatever it opens on counts as signalled.
            _ = ride?.takeMilestone(now: now, isOffline: false)
            lastMoment = guidance?.moment
            persist()
            await startActivity(resuming: false)
            startPolling(immediately: false)
        } catch let error as LiveAPIError {
            guard error != .cancelled else { return }
            confirmIssue = LiveIssue(error)
            ride?.apply(error, at: clock())
            await rideEndedIfNeeded()
        } catch {
            confirmIssue = .serverError
        }
    }

    // MARK: Ride

    /// One round of asking the server: the session, and while the rider is
    /// choosing, the route's raw positions too.
    func poll() async {
        guard let current = ride, !current.isEnded else { return }
        do {
            let session = try await client.session(id: current.session.id)
            now = clock()
            ride?.apply(session, at: now)
        } catch let error as LiveAPIError {
            now = clock()
            ride?.apply(error, at: now)
        } catch {
            now = clock()
            ride?.apply(.network, at: now)
        }
        if ride?.stage == .choosingVehicle, let boarding {
            do {
                let vehicles = try await client.vehicles(routeId: current.session.routeId, cityCode: current.session.cityCode)
                choices = LiveVehicleBoard.choices(vehicles: vehicles, boardingSequence: boarding.sequence)
            } catch {
                // The session refresh above already counts the failure and says why.
            }
            hasLookedForBuses = true
        }
        persist()
        await rideDidChange()
    }

    /// Re-reads the clock, so a silent server ages the ride on screen.
    func tick() async {
        now = clock()
        guard let moment = guidance?.moment, moment != lastMoment else { return }
        await rideDidChange()
    }

    /// The rider got off (or ended a ride that went past their stop).
    func finish() async {
        await end(phase: .completed, immediately: false)
    }

    /// The rider stopped the ride before it was over.
    func cancelRide() async {
        await end(phase: .cancelled, immediately: true)
    }

    /// Picks a ride back up after the app was relaunched.
    func resumeIfNeeded() async {
        guard ride == nil, let record = store?.load() else { return }
        guard clock().timeIntervalSince(record.startedAt) < Self.resumeLimit else {
            store?.save(nil)
            return
        }
        route = record.route
        stops = record.stops
        boarding = record.boarding
        destination = record.destination
        plate = record.plate
        startedAt = record.startedAt
        var restored = LiveRide(session: record.session, at: record.lastSuccessAt)
        restored.markAlerted(record.alertedMilestones)
        ride = restored
        now = clock()
        resumed = true
        isPresented = true
        lastMoment = guidance?.moment
        await poll()
        guard let ride, !ride.isEnded else { return }
        if ride.stage == .riding {
            await startActivity(resuming: true)
        }
        startPolling(immediately: false)
    }

    func dismissResumeNotice() {
        resumed = false
    }

    // MARK: Private

    private func resetSetup() {
        path = []
        routeQuery = ""
        routes = []
        searchedNumber = nil
        route = nil
        stops = []
        destination = nil
        boarding = nil
        isLoading = false
        setupIssue = nil
        choices = []
        hasLookedForBuses = false
        confirmIssue = nil
        plate = nil
        resumed = false
        liveActivityUnavailable = false
        startedAt = nil
        lastMoment = nil
    }

    /// Runs a setup request with the loading flag and the issue it may raise.
    private func load<Value: Sendable>(_ request: @escaping @Sendable () async throws -> Value) async -> Value? {
        isLoading = true
        setupIssue = nil
        defer { isLoading = false }
        do {
            return try await request()
        } catch let error as LiveAPIError {
            if error != .cancelled { setupIssue = LiveIssue(error) }
            return nil
        } catch {
            setupIssue = .serverError
            return nil
        }
    }

    private func rideDidChange() async {
        if await rideEndedIfNeeded() { return }
        guard var current = ride, let guidance = current.guidance(now: now, isOffline: false) else { return }
        let milestone = current.takeMilestone(now: now, isOffline: false)
        if milestone != nil {
            ride = current
            persist()
        }
        if guidance.moment != lastMoment {
            lastMoment = guidance.moment
            surfaces?.announce(guidance, haptic: guidance.milestone == nil || milestone != nil)
        }
        if let content = content() {
            await surfaces?.update(content, alerting: milestone)
        }
    }

    /// When the server no longer has the session: stop, and clear the Live Activity.
    @discardableResult
    private func rideEndedIfNeeded() async -> Bool {
        guard let current = ride, current.stage == .ended(.sessionEnded) else { return false }
        stopPolling()
        store?.save(nil)
        if let content = content(phase: .cancelled) {
            await surfaces?.end(content, immediately: true)
        }
        return true
    }

    private func end(phase: JourneyState, immediately: Bool) async {
        guard var current = ride, !current.isEnded else { return }
        stopPolling()
        let final = content(phase: phase)
        current.finish()
        ride = current
        store?.save(nil)
        if let final, current.session.selectedVehicleId != nil {
            await surfaces?.end(final, immediately: immediately)
        }
        // Best effort: a session that cannot be ended now expires on its own.
        try? await client.endSession(id: current.session.id)
    }

    private func startActivity(resuming: Bool) async {
        guard let surfaces, let content = content() else { return }
        do {
            try await surfaces.start(content, resuming: resuming)
            liveActivityUnavailable = false
        } catch {
            liveActivityUnavailable = true
        }
    }

    private func persist() {
        guard let store, let ride, let route, let boarding, let destination else { return }
        if ride.isEnded {
            store.save(nil)
            return
        }
        store.save(LiveRideRecord(
            route: route,
            stops: stops,
            boarding: boarding,
            destination: destination,
            session: ride.session,
            lastSuccessAt: ride.lastSuccessAt,
            plate: plate,
            alertedMilestones: ride.alertedMilestones,
            startedAt: startedAt ?? ride.lastSuccessAt
        ))
    }

    /// - Parameter immediately: ask at once (a new session has no positions
    ///   yet) rather than after the first interval.
    private func startPolling(immediately: Bool) {
        stopPolling()
        guard autoPoll else { return }
        let pause = self.pause
        loop = Task { [weak self] in
            var first = immediately
            while !Task.isCancelled {
                if !first {
                    guard let delay = self?.ride?.nextPollDelay else { return }
                    do { try await pause(delay) } catch { return }
                }
                first = false
                guard let self, let ride = self.ride, !ride.isEnded else { return }
                await self.poll()
            }
        }
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                do { try await pause(.seconds(5)) } catch { return }
                guard let self, self.ride?.isEnded == false else { return }
                await self.tick()
            }
        }
    }

    private func stopPolling() {
        loop?.cancel()
        ticker?.cancel()
        loop = nil
        ticker = nil
    }
}
