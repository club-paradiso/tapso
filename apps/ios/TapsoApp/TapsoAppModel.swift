import Foundation
import Observation
import TapsoTransit
import UIKit

enum DemoSpeed: String, CaseIterable, Identifiable, Codable {
    case one = "1×"
    case five = "5×"
    case manual = "Step"

    var id: Self { self }

    var interval: Duration? {
        switch self {
        case .one: .seconds(4)
        case .five: .milliseconds(800)
        case .manual: nil
        }
    }
}

/// A step of destination-first setup, pushed onto Home's navigation stack.
enum SetupStep: Hashable {
    case search
    case routes(destinationName: String)
    case boarding(routeID: RouteID, destinationStopID: StopID)
    case mapImport
    case vehicleCheck
}

/// The ride being set up: where to get off, which bus, where to board.
struct RideDraft: Codable, Hashable {
    let routeID: RouteID
    let boardingStopID: StopID
    let destinationStopID: StopID

    init(routeID: RouteID, boardingStopID: StopID, destinationStopID: StopID) {
        self.routeID = routeID
        self.boardingStopID = boardingStopID
        self.destinationStopID = destinationStopID
    }

    init(_ journey: SavedJourney) {
        self.init(routeID: journey.routeID, boardingStopID: journey.boardingStopID, destinationStopID: journey.destinationStopID)
    }

    var route: TransitRoute? { DemoCatalog.route(id: routeID) }
    var boarding: Stop? { route?.routeStop(id: boardingStopID)?.stop }
    var destination: Stop? { route?.routeStop(id: destinationStopID)?.stop }

    var plan: RidePlan {
        RidePlan(
            routeID: routeID,
            direction: route?.direction ?? .unknown,
            boardingStopID: boardingStopID,
            destinationStopID: destinationStopID
        )
    }

    /// Stops from boarding to destination.
    var totalStops: Int {
        guard
            let route,
            let from = route.routeStop(id: boardingStopID)?.sequence,
            let to = route.routeStop(id: destinationStopID)?.sequence
        else { return 1 }
        return max(1, to - from)
    }
}

/// A ride in progress. Persisted so a relaunch resumes it instead of losing it.
struct ActiveRide: Codable, Hashable {
    var session: RideSession
    let draft: RideDraft
    let plate: String
    let scenario: DemoRideScenario
    var beatIndex: Int
    /// The demo's own clock. Observations are stamped with it.
    var clock: Date
    var isOffline: Bool
    /// Freshness re-read after silence, until the next observation.
    var freshnessOverride: DataFreshness?
    /// Wall-clock time the last observation reached the app. The Live Activity's
    /// stale date and relaunch ageing use it; the demo clock runs faster than real time.
    var lastObservedAt: Date?
    /// Milestones already signalled this ride, so each alerts and buzzes at most once,
    /// across relaunches and through delayed/lost/offline interruptions.
    var alertedMilestones: Set<RideMilestone>?

    /// When the ride's data last reached the app, in real time.
    var lastUpdateAt: Date { lastObservedAt ?? session.startedAt }

    var beats: [DemoRideBeat] {
        guard let route = draft.route else { return [] }
        return DemoRideScript.beats(
            route: route,
            boarding: draft.boardingStopID,
            destination: draft.destinationStopID,
            scenario: scenario
        )
    }

    var hasMoreBeats: Bool { beatIndex + 1 < beats.count }

    var signal: RideSignal {
        RideSignal(session: session, freshness: freshnessOverride, isOffline: isOffline)
    }

    var guidance: RideGuidance { RideGuidancePolicy.guidance(for: signal) }
}

/// How the last ride ended, for the end screen.
struct RideOutcome: Hashable {
    let moment: RideMoment
    let routeNumber: String
    let destination: Stop
}

@Observable
@MainActor
final class TapsoAppModel {
    var path: [SetupStep] = []
    var scenario: DemoRideScenario = .smooth
    var speed: DemoSpeed = .one
    var isDemoPanelPresented = false

    private(set) var library: JourneyLibrary
    private(set) var draft: RideDraft?
    private(set) var vehicleCheck = VehicleCheck.evaluate(proposals: [], hasSearched: false)
    private(set) var activeRide: ActiveRide?
    private(set) var outcome: RideOutcome?
    private(set) var resumedAfterRelaunch = false
    private(set) var liveActivityUnavailable = false
    private(set) var mapHandoffFailed: MapApp?

    @ObservationIgnored private let store: JourneyStore
    @ObservationIgnored private let liveActivity: LiveActivityClient?
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var playbackTask: Task<Void, Never>?
    @ObservationIgnored private var rejectedVehicles: Set<VehicleIdentifier> = []
    @ObservationIgnored private var lastMoment: RideMoment?

    init(store: JourneyStore = JourneyStore(), liveActivity: LiveActivityClient? = LiveActivityClient()) {
        self.store = store
        self.liveActivity = liveActivity
        library = store.loadLibrary()
        if var saved = store.loadActiveRide(), Date().timeIntervalSince(saved.lastUpdateAt) < 8 * 3_600 {
            // Re-age restored data against the wall clock: a ride saved at the next stop and
            // reopened later is shown as delayed (or checking), never as a fresh milestone.
            let age = FreshnessPolicy.conservativeDefault.classify(observedAt: saved.lastObservedAt, relativeTo: Date())
            if age != .fresh {
                saved.freshnessOverride = age
            }
            activeRide = saved
            resumedAfterRelaunch = true
            lastMoment = saved.guidance.moment
        } else {
            store.saveActiveRide(nil)
        }
    }

    // MARK: Derived ride state

    var hasActiveRide: Bool { activeRide != nil }
    var guidance: RideGuidance? { activeRide?.guidance }
    var remainingStops: Int { max(0, activeRide?.signal.remainingStops ?? 0) }
    var totalStops: Int { activeRide?.draft.totalStops ?? 1 }
    var routeNumber: String { activeRide?.draft.route?.number ?? draft?.route?.number ?? "" }
    var destinationName: String { (activeRide?.draft ?? draft)?.destination?.name ?? "" }
    var vehiclePlate: String? { activeRide?.plate }
    var canAdvanceDemo: Bool { activeRide?.hasMoreBeats ?? false }

    var currentStopName: String {
        activeRide?.session.latestProgress?.currentStop.stop.name ?? activeRide?.draft.boarding?.name ?? ""
    }

    /// Stops still ahead, next first, ending at the destination.
    var upcomingStopNames: [String] {
        guard
            let ride = activeRide,
            let route = ride.draft.route,
            let destination = route.routeStop(id: ride.draft.destinationStopID)?.sequence
        else { return [] }
        let current = ride.session.latestProgress?.currentStop.sequence
            ?? route.routeStop(id: ride.draft.boardingStopID)?.sequence
            ?? destination
        return route.stops
            .filter { $0.sequence > current && $0.sequence <= destination }
            .map(\.stop.name)
    }

    // MARK: Destination-first setup

    func openSearch() {
        path = [.search]
    }

    func openMapImport() {
        path = [.mapImport]
    }

    func chooseDestination(named name: String) {
        let options = DemoCatalog.routeOptions(toDestinationNamed: name)
        if options.count == 1, let only = options.first {
            path.append(.boarding(routeID: only.route.id, destinationStopID: only.destination.id))
        } else if !options.isEmpty {
            path.append(.routes(destinationName: name))
        }
    }

    func chooseRoute(_ option: DemoCatalog.RouteOption) {
        path.append(.boarding(routeID: option.route.id, destinationStopID: option.destination.id))
    }

    func chooseBoarding(_ stop: Stop, routeID: RouteID, destinationStopID: StopID) {
        draft = RideDraft(routeID: routeID, boardingStopID: stop.id, destinationStopID: destinationStopID)
        path.append(.vehicleCheck)
        beginVehicleCheck()
    }

    /// Repeat rider: one tap from Home to the vehicle check.
    func rideAgain(_ journey: SavedJourney) {
        guard RideDraft(journey).route != nil else { return }
        draft = RideDraft(journey)
        path = [.vehicleCheck]
        beginVehicleCheck()
    }

    /// From the "다시 타기" App Shortcut: the last ride, or search when there is none.
    func rideAgainFromShortcut() {
        guard !hasActiveRide else { return }
        outcome = nil
        if let last = library.lastRide {
            rideAgain(last)
        } else {
            openSearch()
        }
    }

    func toggleFavorite(_ journey: SavedJourney) {
        library.toggleFavorite(id: journey.id)
        store.saveLibrary(library)
    }

    func stopNames(inSharedText text: String) -> [String] {
        StopNameMatcher.matches(in: text, among: DemoCatalog.destinationNames)
    }

    /// The sample ride: 365 from 제주버스터미널 to 제주시청(아라방면), synthetic data.
    /// The demo-only Swift engine ranks the demo fixture; the rider still confirms the bus.
    func startDemo() {
        let now = DemoFixtures.referenceDate
        let ranking = VehicleMatchingEngine().match(
            VehicleMatchingInput(
                plan: DemoFixtures.plan,
                route: DemoFixtures.route,
                boarding: BoardingContext(tappedAt: now),
                candidates: [DemoFixtures.obviousCandidate()],
                now: now
            )
        )
        let proposals = ranking.selectedVehicle.map {
            [VehicleProposal(vehicleID: $0.vehicleID, plate: DemoCatalog.plate(for: $0.vehicleID), stopsAway: 0)]
        } ?? []
        draft = RideDraft(
            routeID: DemoFixtures.route.id,
            boardingStopID: DemoFixtures.plan.boardingStopID,
            destinationStopID: DemoFixtures.plan.destinationStopID
        )
        searchTask?.cancel()
        rejectedVehicles = []
        vehicleCheck = VehicleCheck.evaluate(proposals: proposals, hasSearched: true)
        path = [.vehicleCheck]
    }

    // MARK: Vehicle check

    private func beginVehicleCheck() {
        searchTask?.cancel()
        rejectedVehicles = []
        vehicleCheck = VehicleCheck.evaluate(proposals: [], hasSearched: false)
        guard let route = draft?.route else { return }
        let proposals = DemoCatalog.proposals(for: scenario, route: route)
        searchTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled, let self else { return }
            self.vehicleCheck = VehicleCheck.evaluate(proposals: proposals, hasSearched: true)
            guard proposals.isEmpty else { return }
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            self.vehicleCheck = VehicleCheck.evaluate(
                proposals: DemoCatalog.proposals(for: .smooth, route: route),
                hasSearched: true
            )
        }
    }

    /// "다른 버스예요": drop the proposal and keep watching. Never switches silently.
    func rejectProposal(_ proposal: VehicleProposal) {
        rejectedVehicles.insert(proposal.vehicleID)
        let remaining = vehicleCheck.proposals.filter { !rejectedVehicles.contains($0.vehicleID) }
        vehicleCheck = VehicleCheck.evaluate(proposals: remaining, hasSearched: true)
        guard remaining.isEmpty, let route = draft?.route else { return }
        let followers = ["B", "C", "D"].map { VehicleIdentifier(rawValue: "demo-bus-\(route.number)-\($0)") }
        guard let follower = followers.first(where: { !rejectedVehicles.contains($0) }) else { return }
        searchTask?.cancel()
        searchTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled, let self else { return }
            self.vehicleCheck = VehicleCheck.evaluate(
                proposals: [VehicleProposal(vehicleID: follower, plate: DemoCatalog.plate(for: follower), stopsAway: 2)],
                hasSearched: true
            )
        }
    }

    func cancelSetup() {
        searchTask?.cancel()
        path = []
        draft = nil
    }

    /// The rider's tap is what selects a bus; nothing is selected without it.
    func confirmVehicle(_ proposal: VehicleProposal) async {
        guard
            activeRide == nil,
            let draft,
            let route = draft.route,
            let boarding = draft.boarding,
            let destination = draft.destination
        else { return }
        searchTask?.cancel()
        vehicleCheck = VehicleCheck.evaluate(
            proposals: vehicleCheck.proposals,
            hasSearched: true,
            confirmed: proposal.vehicleID
        )

        let now = Date()
        var session = RideSession(plan: draft.plan, startedAt: now, state: .vehicleConfirmationRequired)
        session.confirm(vehicleID: proposal.vehicleID)
        activeRide = ActiveRide(
            session: session,
            draft: draft,
            plate: proposal.maskedPlate,
            scenario: scenario,
            beatIndex: -1,
            clock: now,
            isOffline: false,
            freshnessOverride: nil,
            lastObservedAt: nil,
            alertedMilestones: []
        )
        outcome = nil
        resumedAfterRelaunch = false
        lastMoment = nil
        applyNextBeat()
        lastMoment = activeRide?.guidance.moment
        // A short ride can open at a milestone; the rider is looking at it, so it counts as signalled.
        if let milestone = activeRide?.guidance.milestone {
            activeRide?.alertedMilestones = [milestone]
            store.saveActiveRide(activeRide)
        }

        library.recordRide(SavedJourney(route: route, boarding: boarding, destination: destination, at: now), at: now)
        store.saveLibrary(library)
        path = []

        await startLiveActivity()
        // The rider may have cancelled while the activity was being requested.
        guard activeRide != nil else {
            await liveActivity?.endAll()
            return
        }
        beginPlayback()
    }

    // MARK: Ride

    func advanceDemo() async {
        guard applyNextBeat() else { return }
        await rideDidChange()
    }

    func speedChanged() {
        playbackTask?.cancel()
        beginPlayback()
    }

    /// Resumes a ride restored at launch.
    func resumeIfNeeded() async {
        guard activeRide != nil else {
            await liveActivity?.endAll()
            return
        }
        if let state = contentState() {
            if liveActivity?.activityID == nil {
                await startLiveActivity()
            } else {
                await liveActivity?.update(state: state, alerting: nil)
            }
        }
        beginPlayback()
    }

    func finishRide() async {
        playbackTask?.cancel()
        guard var ride = activeRide, let destination = ride.draft.destination else { return }
        let finalMoment = ride.guidance.moment
        // The activity's last minute on screen reads "ride ended", not the last milestone.
        ride.session.complete()
        activeRide = ride
        if let final = contentState() {
            await liveActivity?.end(state: final)
        }
        outcome = RideOutcome(
            moment: finalMoment,
            routeNumber: ride.draft.route?.number ?? "",
            destination: destination
        )
        activeRide = nil
        store.saveActiveRide(nil)
    }

    func cancelRide() async {
        playbackTask?.cancel()
        guard var ride = activeRide else { return }
        ride.session.cancel()
        activeRide = ride
        if let state = contentState() {
            await liveActivity?.end(state: state, immediately: true)
        }
        activeRide = nil
        outcome = nil
        store.saveActiveRide(nil)
    }

    func dismissOutcome() {
        outcome = nil
        draft = nil
    }

    func dismissResumeNotice() {
        resumedAfterRelaunch = false
    }

    // MARK: Map hand-off

    func mapRequest(for app: MapApp, to stop: Stop) -> MapHandoffRequest? {
        // Demo stop coordinates are synthetic: only a name search is honest.
        MapHandoff.walkingRequest(to: stop, in: app, coordinatesAreSurveyed: false)
    }

    func openMapApp(_ request: MapHandoffRequest) async {
        mapHandoffFailed = nil
        guard let url = URL(string: request.urlString) else { return }
        let opened = await UIApplication.shared.open(url)
        if !opened { mapHandoffFailed = request.app }
    }

    // MARK: Private

    @discardableResult
    private func applyNextBeat() -> Bool {
        guard var ride = activeRide, let route = ride.draft.route, ride.hasMoreBeats else { return false }
        ride.beatIndex += 1
        switch ride.beats[ride.beatIndex] {
        case let .observe(sequence):
            ride.clock = ride.clock.addingTimeInterval(20)
            ride.freshnessOverride = nil
            ride.lastObservedAt = Date()
            if let vehicle = ride.session.matchedVehicleID,
               let observation = DemoCatalog.observation(route: route, vehicleID: vehicle, stopSequence: sequence, at: ride.clock) {
                _ = ride.session.apply(observation: observation, route: route, now: ride.clock)
            }
        case let .silence(seconds):
            ride.clock = ride.clock.addingTimeInterval(seconds)
            ride.freshnessOverride = FreshnessPolicy.conservativeDefault.classify(
                observedAt: ride.session.latestObservation?.timestamp,
                relativeTo: ride.clock
            )
        case .vehicleMissing:
            ride.session.markVehicleLost()
        case let .connectivity(online):
            ride.isOffline = !online
        }
        activeRide = ride
        store.saveActiveRide(ride)
        return true
    }

    private func rideDidChange() async {
        guard var ride = activeRide else { return }
        let guidance = ride.guidance
        // A milestone signals once per ride: nextStop → delayed → nextStop does not buzz or alert twice.
        var newMilestone: RideMilestone?
        if let milestone = guidance.milestone, !(ride.alertedMilestones ?? []).contains(milestone) {
            newMilestone = milestone
            ride.alertedMilestones = (ride.alertedMilestones ?? []).union([milestone])
            activeRide = ride
            store.saveActiveRide(ride)
        }
        if guidance.moment != lastMoment {
            lastMoment = guidance.moment
            if guidance.milestone == nil || newMilestone != nil {
                RideFeedback.play(guidance.haptic)
            }
            RideFeedback.announce(guidance)
        }
        if let state = contentState() {
            await liveActivity?.update(state: state, alerting: newMilestone)
        }
    }

    private func beginPlayback() {
        playbackTask?.cancel()
        guard let interval = speed.interval else { return }
        playbackTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                guard !Task.isCancelled, let self, self.canAdvanceDemo else { return }
                await self.advanceDemo()
            }
        }
    }

    private func startLiveActivity() async {
        guard let liveActivity, let ride = activeRide, let route = ride.draft.route, let state = contentState() else { return }
        let attributes = TapsoActivityAttributes(
            routeNumber: route.number,
            routeID: route.id.rawValue,
            boardingStopName: ride.draft.boarding?.name ?? "",
            destinationName: ride.draft.destination?.name ?? "",
            totalStops: ride.draft.totalStops,
            vehiclePlate: ride.plate
        )
        do {
            try await liveActivity.start(attributes: attributes, state: state)
            liveActivityUnavailable = false
        } catch {
            liveActivityUnavailable = true
        }
    }

    func contentState() -> TapsoActivityAttributes.ContentState? {
        guard let ride = activeRide else { return nil }
        let signal = ride.signal
        let progress = ride.session.latestProgress
        let next = upcomingStopNames.first
        return TapsoActivityAttributes.ContentState(
            phase: signal.phase,
            currentStopName: progress?.currentStop.stop.name ?? ride.draft.boarding?.name ?? "",
            nextStopName: next,
            remainingStops: signal.remainingStops,
            freshness: signal.freshness,
            updatedAt: ride.lastUpdateAt,
            destinationPassed: signal.destinationPassed,
            isOffline: signal.isOffline
        )
    }
}
