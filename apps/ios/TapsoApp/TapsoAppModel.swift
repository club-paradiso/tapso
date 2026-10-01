import Foundation
import MapKit
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
    /// Live: the route number, then its official variants.
    case liveRoutes
    /// Live: boarding and destination on one variant's real stop list.
    case liveStops(routeID: String)
}

/// The ride being set up: where to get off, which bus, where to board.
///
/// A demo draft looks its route up in the synthetic `DemoCatalog`. A live draft
/// carries the route as TAPSO's API returned it, its TAGO city code, and the
/// provider sequences of both stops (stop ids repeat round a loop; sequences do not).
struct RideDraft: Codable, Hashable {
    let routeID: RouteID
    let boardingStopID: StopID
    let destinationStopID: StopID
    let liveRoute: TransitRoute?
    let cityCode: String?
    let boardingSequence: Int?
    let destinationSequence: Int?
    /// Whether stop coordinates are real (TAGO) rather than synthetic.
    let coordinatesAreSurveyed: Bool?
    /// The place the rider shared from a map app, when the ride was set up from one:
    /// the last mile after the bus (`HandoffJourney`) and the end-of-ride walk go there.
    var finalPlace: SharedPlace?

    init(routeID: RouteID, boardingStopID: StopID, destinationStopID: StopID) {
        self.routeID = routeID
        self.boardingStopID = boardingStopID
        self.destinationStopID = destinationStopID
        liveRoute = nil
        cityCode = nil
        boardingSequence = nil
        destinationSequence = nil
        coordinatesAreSurveyed = false
    }

    init(_ journey: SavedJourney) {
        self.init(routeID: journey.routeID, boardingStopID: journey.boardingStopID, destinationStopID: journey.destinationStopID)
    }

    init(live route: TransitRoute, cityCode: String, boarding: RouteStop, destination: RouteStop, coordinatesAreSurveyed: Bool) {
        routeID = route.id
        boardingStopID = boarding.stop.id
        destinationStopID = destination.stop.id
        liveRoute = route
        self.cityCode = cityCode
        boardingSequence = boarding.sequence
        destinationSequence = destination.sequence
        self.coordinatesAreSurveyed = coordinatesAreSurveyed
    }

    /// Live data from TAPSO's API, as opposed to the synthetic demo.
    var isLive: Bool { cityCode != nil }

    var route: TransitRoute? { liveRoute ?? DemoCatalog.route(id: routeID) }

    var boardingRouteStop: RouteStop? {
        if let boardingSequence, let stop = route?.routeStop(sequence: boardingSequence) { return stop }
        return route?.routeStop(id: boardingStopID)
    }

    var destinationRouteStop: RouteStop? {
        if let destinationSequence, let stop = route?.routeStop(sequence: destinationSequence) { return stop }
        return route?.routeStop(id: destinationStopID)
    }

    var boarding: Stop? { boardingRouteStop?.stop }
    var destination: Stop? { destinationRouteStop?.stop }

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
            let from = boardingRouteStop?.sequence,
            let to = destinationRouteStop?.sequence
        else { return 1 }
        return max(1, to - from)
    }

    /// The journey in the Journey Contract's vocabulary: the ride, then the walk to a shared place.
    var journeySegments: [JourneySegmentSpec] {
        HandoffJourney.segments(
            routeNumber: route?.number ?? "",
            boardSequence: boardingRouteStop?.sequence ?? 0,
            alightSequence: destinationRouteStop?.sequence ?? 0,
            place: finalPlace
        )
    }
}

/// What the server last said about a live ride.
struct LiveRideState: Codable, Hashable {
    let sessionID: String
    let vehicleID: String
    /// The server's reading, translated by `LiveSessionInterpreter`.
    var signal: RideSignal
    var currentStopSequence: Int?
    /// Set when the server ended or lost the session; the ride stops polling.
    var endedByServer: Bool
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
    /// Present for a live ride; `nil` for the demo.
    var live: LiveRideState?

    var isLive: Bool { live != nil }

    /// When the ride's data last reached the app, in real time.
    var lastUpdateAt: Date { lastObservedAt ?? session.startedAt }

    var beats: [DemoRideBeat] {
        guard live == nil, let route = draft.route else { return [] }
        return DemoRideScript.beats(
            route: route,
            boarding: draft.boardingStopID,
            destination: draft.destinationStopID,
            scenario: scenario
        )
    }

    var hasMoreBeats: Bool { beatIndex + 1 < beats.count }

    var signal: RideSignal {
        guard let live else {
            return RideSignal(session: session, freshness: freshnessOverride, isOffline: isOffline)
        }
        // A finished or cancelled ride reads as ended on every surface, whatever the server said last.
        if session.state == .completed || session.state == .cancelled {
            return RideSignal(phase: session.state, remainingStops: 0, freshness: .fresh)
        }
        // Silence since the server last answered can only make the data older, never fresher.
        let server = live.signal
        return RideSignal(
            phase: live.endedByServer ? .vehicleRecovery : server.phase,
            remainingStops: live.endedByServer ? -1 : server.remainingStops,
            freshness: Self.older(server.freshness, freshnessOverride),
            destinationPassed: server.destinationPassed,
            isOffline: isOffline || server.isOffline
        )
    }

    private static func older(_ server: DataFreshness, _ local: DataFreshness?) -> DataFreshness {
        func rank(_ value: DataFreshness) -> Int {
            switch value {
            case .fresh: 0
            case .aging: 1
            case .stale: 2
            case .unknown: 3
            }
        }
        guard let local else { return server }
        return rank(local) > rank(server) ? local : server
    }

    var guidance: RideGuidance { RideGuidancePolicy.guidance(for: signal) }
}

/// How the last ride ended, for the end screen.
struct RideOutcome: Hashable {
    let moment: RideMoment
    let routeNumber: String
    let destination: Stop
    /// The shared place the walk after the bus goes to, if the ride started from one.
    var place: SharedPlace? = nil
    /// Live rides only: TAGO's city code and the variant ridden, for reading the way back.
    var cityCode: String? = nil
    var routeID: RouteID? = nil
}

/// The way back after a live ride: each official variant of the route number with
/// today's last bus (`LastBus`), as TAPSO's API publishes it.
enum ReturnService: Equatable {
    case idle
    case loading
    case loaded([ReturnServiceRow])
    case failed(TransitAPIFailure)

    var isFailed: Bool {
        switch self {
        case .failed: true
        default: false
        }
    }
}

struct ReturnServiceRow: Equatable, Identifiable {
    let route: TransitAPIRoute
    let advice: LastBusAdvice
    /// The variant the rider just rode.
    let ridden: Bool

    var id: String { route.routeId }
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
    /// Live setup: the route number search.
    private(set) var liveRouteSearch: LiveRouteSearch = .idle
    /// Live setup: one variant's real stop list.
    private(set) var liveStops: LiveStops = .idle
    /// The last live request that did not answer, shown as a calm notice. `nil` once one succeeds.
    private(set) var liveFailure: TransitAPIFailure?
    /// A saved live journey no longer matched the route's current stop list.
    private(set) var liveSavedJourneyChanged = false
    /// A place the rider brought from a map app: pasted, or left by the share extension.
    /// Read on the device only; it reaches a ride only through a setup that started from it.
    private(set) var sharedPlace: SharedPlace?
    /// The last paste held nothing TAPSO could read as a place.
    private(set) var sharedPlaceUnreadable = false
    private(set) var appleMapsFailed = false
    /// After a live ride: today's last buses of the route number, for the way back.
    private(set) var returnService: ReturnService = .idle

    @ObservationIgnored private let store: JourneyStore
    @ObservationIgnored private let liveActivity: LiveActivityClient?
    @ObservationIgnored private let api: TapsoAPIClient
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var playbackTask: Task<Void, Never>?
    @ObservationIgnored private var rejectedVehicles: Set<VehicleIdentifier> = []
    @ObservationIgnored private var lastMoment: RideMoment?
    /// The live session being set up, before a bus is confirmed.
    @ObservationIgnored private var liveSetupSession: JourneySessionSnapshot?

    /// Seconds between session reads while the rider waits at the stop and while riding.
    /// Each read costs one bus-feed request on the server.
    static let liveCheckInterval: Duration = .seconds(10)
    static let liveRideInterval: Duration = .seconds(15)

    init(
        store: JourneyStore = JourneyStore(),
        liveActivity: LiveActivityClient? = LiveActivityClient(),
        api: TapsoAPIClient = TapsoAPIClient()
    ) {
        self.store = store
        self.liveActivity = liveActivity
        self.api = api
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
        if let ride = activeRide, ride.isLive {
            let sequence = ride.live?.currentStopSequence
            return sequence.flatMap { ride.draft.route?.routeStop(sequence: $0)?.stop.name } ?? ride.draft.boarding?.name ?? ""
        }
        return activeRide?.session.latestProgress?.currentStop.stop.name ?? activeRide?.draft.boarding?.name ?? ""
    }

    var isLiveRide: Bool { activeRide?.isLive ?? false }
    /// The server ended or lost the live session; the rider can only finish the ride.
    var liveRideEndedByServer: Bool { activeRide?.live?.endedByServer ?? false }

    /// Stops still ahead, next first, ending at the destination.
    var upcomingStopNames: [String] {
        guard
            let ride = activeRide,
            let route = ride.draft.route,
            let destination = ride.draft.destinationRouteStop?.sequence
        else { return [] }
        let current = ride.live?.currentStopSequence
            ?? ride.session.latestProgress?.currentStop.sequence
            ?? ride.draft.boardingRouteStop?.sequence
            ?? destination
        return route.stops
            .filter { $0.sequence > current && $0.sequence <= destination }
            .map(\.stop.name)
    }

    /// Past the stop: where to get off and the way back, from the Rescue engine (`PassedStopRescue`).
    var passedStopAdvice: PassedStopAdvice? {
        guard
            let ride = activeRide,
            ride.guidance.moment == .passedDestination,
            let route = ride.draft.route,
            let destination = ride.draft.destinationRouteStop?.sequence
        else { return nil }
        let bus = ride.isLive ? ride.live?.currentStopSequence : ride.session.latestProgress?.currentStop.sequence
        return PassedStopRescue.advice(
            route: route,
            destinationSequence: destination,
            busSequence: bus,
            coordinatesAreSurveyed: ride.draft.coordinatesAreSurveyed ?? false
        )
    }

    // MARK: Destination-first setup

    func openSearch() {
        path = [.search]
    }

    func openMapImport() {
        path = [.mapImport]
    }

    // MARK: Map hand-off in (`docs/product/MAP_HANDOFF_V3.md`)

    /// Reads pasted map-app text on the device. Nothing is fetched or sent.
    func importSharedText(_ text: String) {
        let place = SharedPlaceParser.parse(text: text)
        sharedPlace = place
        sharedPlaceUnreadable = place == nil
    }

    /// Picks up a place TAPSO's share extension left in the App Group, once.
    func collectHandoff(from inbox: HandoffInbox? = HandoffInbox.shared(), now: Date = Date()) {
        guard let place = inbox?.take(now: now) else { return }
        receiveSharedPlace(place)
    }

    /// A shared place opens the map-import screen from Home. During a ride, or in
    /// another setup, it waits on Home's map card instead of interrupting.
    func receiveSharedPlace(_ place: SharedPlace) {
        sharedPlace = place
        sharedPlaceUnreadable = false
        guard activeRide == nil, outcome == nil, path.isEmpty || path.first == .mapImport else { return }
        path = [.mapImport]
    }

    func dismissSharedPlace() {
        sharedPlace = nil
        sharedPlaceUnreadable = false
    }

    /// Live: the rider names the bus that goes there; the stop list then suggests where to get off.
    func continueWithLiveRoute() {
        searchTask?.cancel()
        liveRouteSearch = .idle
        liveFailure = nil
        liveSavedJourneyChanged = false
        path.append(.liveRoutes)
    }

    /// The shared place, while the setup on screen started from it.
    var handoffPlace: SharedPlace? {
        path.first == .mapImport ? sharedPlace : nil
    }

    /// Hands the setup's shared place to the draft being created, and only then.
    private func attachHandoffPlace(to draft: inout RideDraft) {
        guard let place = handoffPlace, !place.isLinkOnly, place.isInJeju != false else { return }
        draft.finalPlace = place
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
        var chosen = RideDraft(routeID: routeID, boardingStopID: stop.id, destinationStopID: destinationStopID)
        attachHandoffPlace(to: &chosen)
        draft = chosen
        path.append(.vehicleCheck)
        beginVehicleCheck()
    }

    /// Repeat rider: one tap from Home to the vehicle check.
    func rideAgain(_ journey: SavedJourney) {
        if journey.isLive {
            Task { await self.rideAgainLive(journey) }
            return
        }
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
        if draft?.isLive == true {
            // The server keeps reporting every bus; the next read shows the next one.
            if let snapshot = liveSetupSession {
                vehicleCheck = LiveSessionInterpreter.vehicleCheck(for: snapshot, excluding: rejectedVehicles)
            }
            return
        }
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
        endLiveSetupSession()
        path = []
        draft = nil
        liveFailure = nil
    }

    /// The rider's tap is what selects a bus; nothing is selected without it.
    func confirmVehicle(_ proposal: VehicleProposal) async {
        if draft?.isLive == true {
            await confirmLiveVehicle(proposal)
            return
        }
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
        if draft.finalPlace != nil { sharedPlace = nil }
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
        guard !isLiveRide else { return }
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
        if isLiveRide {
            beginLivePolling()
        } else {
            beginPlayback()
        }
    }

    func finishRide() async {
        playbackTask?.cancel()
        guard var ride = activeRide, let destination = ride.draft.destination else { return }
        endLiveRideSession(ride)
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
            destination: destination,
            place: ride.draft.finalPlace,
            cityCode: ride.draft.cityCode,
            routeID: ride.draft.routeID
        )
        returnService = .idle
        activeRide = nil
        store.saveActiveRide(nil)
    }

    func cancelRide() async {
        playbackTask?.cancel()
        guard var ride = activeRide else { return }
        endLiveRideSession(ride)
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
        returnService = .idle
    }

    /// Live rides: the route number's variants and today's last bus of each. A
    /// variant without a published service day reads `unknown`, never safe.
    func loadReturnService(for outcome: RideOutcome, now: Date = Date()) async {
        guard let cityCode = outcome.cityCode, returnService == .idle || returnService.isFailed else { return }
        returnService = .loading
        do {
            // The provider's number search can list other numbers too (7 rows for 800, 5 of them 800: data-source probe, 2026-10-01).
            let variants = try await api.routes(number: outcome.routeNumber, cityCode: cityCode)
                .filter { $0.routeNumber == outcome.routeNumber }
            var rows: [ReturnServiceRow] = []
            for variant in variants.prefix(Self.returnVariantLimit) {
                let hours = try? await api.routeInfo(routeID: variant.routeId, cityCode: cityCode)
                rows.append(ReturnServiceRow(
                    route: variant,
                    advice: LastBus.advice(for: hours, now: now),
                    ridden: variant.routeId == outcome.routeID?.rawValue
                ))
            }
            returnService = .loaded(rows)
        } catch {
            returnService = .failed(Self.failure(error))
        }
    }

    /// Each variant costs one cached route-info read; a route number has a handful.
    static let returnVariantLimit = 6

    func dismissResumeNotice() {
        resumedAfterRelaunch = false
    }

    // MARK: Map hand-off

    func mapRequest(for app: MapApp, to stop: Stop) -> MapHandoffRequest? {
        // Demo stop coordinates are synthetic: only a name search is honest there.
        // Live stops carry TAGO's surveyed coordinates when every stop had them.
        let surveyed = (activeRide?.draft ?? draft)?.coordinatesAreSurveyed ?? false
        return MapHandoff.walkingRequest(to: stop, in: app, coordinatesAreSurveyed: surveyed)
    }

    /// The walk after the ride: to the shared place when the ride started from one
    /// (and only through apps that can take it there), otherwise to the stop.
    func mapRequest(for app: MapApp, outcome: RideOutcome) -> MapHandoffRequest? {
        if let place = outcome.place {
            return MapHandoff.walkingRequest(to: place, in: app)
        }
        return mapRequest(for: app, to: outcome.destination)
    }

    /// The way back from a passed stop: toward the shared place when the ride started
    /// from one (through apps that can take it there), otherwise to the stop.
    func rescueMapRequest(for app: MapApp) -> MapHandoffRequest? {
        guard let draft = activeRide?.draft else { return nil }
        if let place = draft.finalPlace {
            return MapHandoff.walkingRequest(to: place, in: app)
        }
        guard let destination = draft.destination else { return nil }
        return mapRequest(for: app, to: destination)
    }

    /// Where Apple Maps can show the rider: a real coordinate only, never a synthetic stop.
    func appleMapsTarget(for outcome: RideOutcome) -> (coordinate: Coordinate, name: String)? {
        if let place = outcome.place {
            guard let coordinate = place.coordinate, place.isInJeju == true else { return nil }
            return (coordinate, place.name ?? place.address ?? outcome.destination.name)
        }
        let surveyed = (activeRide?.draft ?? draft)?.coordinatesAreSurveyed ?? false
        guard surveyed else { return nil }
        return (outcome.destination.coordinate, outcome.destination.name)
    }

    func openMapApp(_ request: MapHandoffRequest) async {
        mapHandoffFailed = nil
        appleMapsFailed = false
        guard let url = URL(string: request.urlString) else { return }
        let opened = await UIApplication.shared.open(url)
        if !opened { mapHandoffFailed = request.app }
    }

    /// Shows the place in Apple Maps through MapKit's own API (`MKMapItem.openInMaps`), so no URL
    /// shape is assumed. It asks for no directions mode: walking directions in Korea are UNVERIFIED
    /// (`docs/product/MAP_HANDOFF_V3.md`), and the rider can ask Apple Maps for them there.
    func openAppleMaps(for outcome: RideOutcome) {
        mapHandoffFailed = nil
        guard let target = appleMapsTarget(for: outcome) else { return }
        let location = CLLocationCoordinate2D(latitude: target.coordinate.latitude, longitude: target.coordinate.longitude)
        let item = MKMapItem(placemark: MKPlacemark(coordinate: location))
        item.name = target.name
        appleMapsFailed = !item.openInMaps(launchOptions: nil)
    }

    // MARK: Live rides (TAPSO API)

    /// Live setup starts from the route number: TAPSO's API has no stop search yet,
    /// and inventing one from a stale list would send riders to the wrong stop.
    func openLiveSearch() {
        searchTask?.cancel()
        liveRouteSearch = .idle
        liveFailure = nil
        liveSavedJourneyChanged = false
        path = [.liveRoutes]
    }

    /// Every official variant of a route number.
    func searchLiveRoutes(number raw: String) async {
        let number = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !number.isEmpty, number.count <= 16 else {
            liveRouteSearch = .idle
            return
        }
        liveRouteSearch = .loading(number)
        do {
            let routes = try await api.routes(number: number)
            guard case let .loading(current) = liveRouteSearch, current == number else { return }
            liveRouteSearch = .results(number, routes)
        } catch {
            guard case let .loading(current) = liveRouteSearch, current == number else { return }
            liveRouteSearch = .failed(number, Self.failure(error))
        }
    }

    /// Opens one variant's real stop list.
    func chooseLiveRoute(_ route: TransitAPIRoute) async {
        liveStops = .loading(route)
        path.append(.liveStops(routeID: route.routeId))
        await loadLiveStops(route)
    }

    func loadLiveStops(_ route: TransitAPIRoute) async {
        liveStops = .loading(route)
        do {
            let list = try await api.stops(routeID: route.routeId)
            guard case let .loading(current) = liveStops, current.routeId == route.routeId else { return }
            let built = TransitRoute.live(route, stops: list.items)
            liveStops = .loaded(LiveRouteStops(
                apiRoute: route,
                route: built.route,
                coordinatesAreSurveyed: built.coordinatesAreSurveyed,
                topology: list.meta?.topology?.kind ?? "linear"
            ))
        } catch {
            guard case let .loading(current) = liveStops, current.routeId == route.routeId else { return }
            liveStops = .failed(route, Self.failure(error))
        }
    }

    /// Boarding and destination chosen on a real stop list: the server session starts here.
    func chooseLiveStops(boarding: RouteStop, destination: RouteStop, on stops: LiveRouteStops) {
        guard boarding.sequence < destination.sequence else { return }
        var chosen = RideDraft(
            live: stops.route,
            cityCode: TapsoAPIClient.jejuCityCode,
            boarding: boarding,
            destination: destination,
            coordinatesAreSurveyed: stops.coordinatesAreSurveyed
        )
        attachHandoffPlace(to: &chosen)
        draft = chosen
        path.append(.vehicleCheck)
        beginLiveVehicleCheck()
    }

    /// Leaving the vehicle check by any route (back, cancel, a new search) stops its polling.
    func pathDidChange(_ newPath: [SetupStep]) {
        guard !newPath.contains(.vehicleCheck), activeRide == nil else { return }
        searchTask?.cancel()
        endLiveSetupSession()
    }

    /// A saved live journey starts from the server's current stop list, never a stored one.
    private func rideAgainLive(_ journey: SavedJourney) async {
        guard
            let cityCode = journey.cityCode,
            let boardingSequence = journey.boardingSequence,
            let destinationSequence = journey.destinationSequence
        else { return }
        let apiRoute = TransitAPIRoute(
            routeId: journey.routeID.rawValue,
            routeNumber: journey.routeNumber,
            startStopName: nil,
            endStopName: journey.headsign
        )
        liveFailure = nil
        do {
            let list = try await api.stops(routeID: apiRoute.routeId, cityCode: cityCode)
            let built = TransitRoute.live(apiRoute, stops: list.items)
            guard
                let boarding = built.route.routeStop(sequence: boardingSequence),
                let destination = built.route.routeStop(sequence: destinationSequence),
                boarding.stop.id == journey.boardingStopID,
                destination.stop.id == journey.destinationStopID
            else {
                // The route changed since this journey was saved: choose again.
                openLiveSearch()
                liveSavedJourneyChanged = true
                await searchLiveRoutes(number: journey.routeNumber)
                return
            }
            draft = RideDraft(
                live: built.route,
                cityCode: cityCode,
                boarding: boarding,
                destination: destination,
                coordinatesAreSurveyed: built.coordinatesAreSurveyed
            )
            path = [.vehicleCheck]
            beginLiveVehicleCheck()
        } catch {
            openLiveSearch()
            liveFailure = Self.failure(error)
        }
    }

    private func beginLiveVehicleCheck() {
        searchTask?.cancel()
        endLiveSetupSession()
        rejectedVehicles = []
        liveFailure = nil
        vehicleCheck = VehicleCheck.evaluate(proposals: [], hasSearched: false)
        resumeLiveVehicleCheck()
    }

    /// Polls the setup session, creating it first if needed. The server ranks the
    /// buses; the rider confirms one. Nothing is selected here.
    private func resumeLiveVehicleCheck() {
        searchTask?.cancel()
        guard let draft, draft.isLive else { return }
        searchTask = Task { [weak self] in
            await self?.runLiveVehicleCheck(draft)
        }
    }

    private func runLiveVehicleCheck(_ draft: RideDraft) async {
        guard
            let cityCode = draft.cityCode,
            let boarding = draft.boardingSequence,
            let destination = draft.destinationSequence
        else { return }
        while !Task.isCancelled {
            do {
                let snapshot: JourneySessionSnapshot
                if let existing = liveSetupSession {
                    snapshot = try await api.session(id: existing.id)
                } else {
                    snapshot = try await api.createSession(
                        routeID: draft.routeID.rawValue,
                        cityCode: cityCode,
                        boardingSequence: boarding,
                        destinationSequence: destination
                    )
                }
                if Task.isCancelled {
                    // The rider left while this was in flight; a session nobody reads must not linger.
                    if liveSetupSession?.id != snapshot.id { endSessionInBackground(snapshot.id) }
                    return
                }
                liveSetupSession = snapshot
                liveFailure = nil
                vehicleCheck = LiveSessionInterpreter.vehicleCheck(for: snapshot, excluding: rejectedVehicles)
            } catch is CancellationError {
                return
            } catch {
                let failure = Self.failure(error)
                liveFailure = failure
                switch failure {
                case .sessionExpired, .sessionNotFound:
                    liveSetupSession = nil
                default:
                    if !failure.isTransient { return }
                }
            }
            try? await Task.sleep(for: Self.liveCheckInterval)
        }
    }

    private func confirmLiveVehicle(_ proposal: VehicleProposal) async {
        guard
            activeRide == nil,
            let draft,
            let route = draft.route,
            let boarding = draft.boardingRouteStop,
            let destination = draft.destinationRouteStop,
            let cityCode = draft.cityCode,
            let setup = liveSetupSession
        else { return }
        searchTask?.cancel()
        liveFailure = nil
        let snapshot: JourneySessionSnapshot
        do {
            snapshot = try await api.confirm(sessionID: setup.id, vehicleID: proposal.vehicleID.rawValue)
        } catch {
            // The bus may have left the feed, or the network dropped: say so and keep checking.
            liveFailure = Self.failure(error)
            resumeLiveVehicleCheck()
            return
        }
        // The setup session is now the ride's session; it must not be ended as setup.
        liveSetupSession = nil
        vehicleCheck = VehicleCheck.evaluate(proposals: vehicleCheck.proposals, hasSearched: true, confirmed: proposal.vehicleID)

        let now = Date()
        var session = RideSession(plan: draft.plan, startedAt: now, state: .vehicleConfirmationRequired)
        session.confirm(vehicleID: proposal.vehicleID)
        activeRide = ActiveRide(
            session: session,
            draft: draft,
            plate: proposal.maskedPlate,
            scenario: .smooth,
            beatIndex: -1,
            clock: now,
            isOffline: false,
            freshnessOverride: nil,
            lastObservedAt: now,
            alertedMilestones: [],
            live: LiveRideState(
                sessionID: snapshot.id,
                vehicleID: proposal.vehicleID.rawValue,
                signal: LiveSessionInterpreter.rideSignal(for: snapshot),
                currentStopSequence: LiveSessionInterpreter.currentStopSequence(for: snapshot),
                endedByServer: false
            )
        )
        outcome = nil
        resumedAfterRelaunch = false
        lastMoment = activeRide?.guidance.moment
        // A short ride can open at a milestone; the rider is looking at it, so it counts as signalled.
        if let milestone = activeRide?.guidance.milestone {
            activeRide?.alertedMilestones = [milestone]
        }
        store.saveActiveRide(activeRide)

        library.recordRide(
            SavedJourney(liveRoute: route, cityCode: cityCode, boarding: boarding, destination: destination, at: now),
            at: now
        )
        store.saveLibrary(library)
        if draft.finalPlace != nil { sharedPlace = nil }
        path = []

        await startLiveActivity()
        guard activeRide != nil else {
            await liveActivity?.endAll()
            return
        }
        beginLivePolling()
    }

    private func beginLivePolling() {
        playbackTask?.cancel()
        guard let live = activeRide?.live, !live.endedByServer else { return }
        let sessionID = live.sessionID
        playbackTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.liveRideInterval)
                guard !Task.isCancelled, let self else { return }
                guard await self.refreshLiveRide(sessionID: sessionID) else { return }
            }
        }
    }

    /// One session read during the ride. False when polling should stop.
    private func refreshLiveRide(sessionID: String) async -> Bool {
        do {
            let snapshot = try await api.session(id: sessionID)
            guard var ride = activeRide, ride.live?.sessionID == sessionID else { return false }
            ride.live?.signal = LiveSessionInterpreter.rideSignal(for: snapshot)
            if let sequence = LiveSessionInterpreter.currentStopSequence(for: snapshot) {
                ride.live?.currentStopSequence = sequence
            }
            ride.isOffline = false
            ride.freshnessOverride = nil
            ride.lastObservedAt = Date()
            activeRide = ride
            liveFailure = nil
        } catch is CancellationError {
            return false
        } catch {
            guard var ride = activeRide, ride.live?.sessionID == sessionID else { return false }
            let failure = Self.failure(error)
            liveFailure = failure
            switch failure {
            case .sessionExpired, .sessionNotFound, .sessionsUnavailable, .serviceUnavailable, .rejected:
                ride.live?.endedByServer = true
            case .offline:
                ride.isOffline = true
            default:
                // Silence ages the data; it never makes it fresher.
                ride.freshnessOverride = FreshnessPolicy.conservativeDefault.classify(
                    observedAt: ride.lastObservedAt,
                    relativeTo: Date()
                )
            }
            activeRide = ride
        }
        store.saveActiveRide(activeRide)
        await rideDidChange()
        return !(activeRide?.live?.endedByServer ?? true)
    }

    private func endLiveSetupSession() {
        if let id = liveSetupSession?.id { endSessionInBackground(id) }
        liveSetupSession = nil
    }

    private func endLiveRideSession(_ ride: ActiveRide) {
        guard let live = ride.live, !live.endedByServer else { return }
        let api = self.api
        let id = live.sessionID
        Task.detached {
            try? await api.endSession(id: id)
        }
    }

    /// Best effort: a session nobody ends expires on the server after four hours without polling.
    /// A setup session that became the ride's session is never ended from setup.
    private func endSessionInBackground(_ id: String) {
        guard activeRide?.live?.sessionID != id else { return }
        let api = self.api
        Task.detached {
            try? await api.endSession(id: id)
        }
    }

    private static func failure(_ error: Error) -> TransitAPIFailure {
        (error as? TransitAPIFailure) ?? .server
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
        let next = upcomingStopNames.first
        return TapsoActivityAttributes.ContentState(
            phase: signal.phase,
            currentStopName: currentStopName,
            nextStopName: next,
            remainingStops: signal.remainingStops,
            freshness: signal.freshness,
            updatedAt: ride.lastUpdateAt,
            destinationPassed: signal.destinationPassed,
            isOffline: signal.isOffline
        )
    }
}

/// Live setup: the route number search.
enum LiveRouteSearch: Equatable {
    case idle
    case loading(String)
    case results(String, [TransitAPIRoute])
    case failed(String, TransitAPIFailure)
}

/// Live setup: one variant's stop list, as the API returned it.
enum LiveStops: Equatable {
    case idle
    case loading(TransitAPIRoute)
    case loaded(LiveRouteStops)
    case failed(TransitAPIRoute, TransitAPIFailure)
}

struct LiveRouteStops: Equatable {
    let apiRoute: TransitAPIRoute
    let route: TransitRoute
    let coordinatesAreSurveyed: Bool
    /// `linear`, `loop` or `repeating` (`classifyTopology` on the server).
    let topology: String
}
