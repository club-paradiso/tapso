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
    /// Destination-first on the canonical catalog: the variants that reach a place.
    case catalogRoutes(placeName: String)
}

/// A destination chosen from the canonical catalog. The live stop list opens with it fixed,
/// once the server's current list confirms the same stop at the same provider sequence.
struct CatalogDestination: Equatable {
    let routeID: String
    let sequence: Int
    let stopID: String
    let placeName: String
}

/// One route number's official timetables, as last read this session.
enum TimetableLoad: Equatable {
    case loading
    case loaded(TransitAPITimetable)
    case failed(TransitAPIFailure)
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
    /// The server's hybrid rollout switch as read when this ride started, so a relaunch keeps the
    /// same authority for the whole ride. Absent on rides saved before the switch existed.
    var hybridTracking: Bool?
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

    var hybridPosition: HybridRidePosition?

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
        if !live.endedByServer, let hybridPosition { return hybridPosition.signal(at: Date()) }
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
    /// Screenshot route import (`docs/product/SCREENSHOT_IMPORT_V1.md`): what the last picked screenshot came to.
    private(set) var screenshotImport: ScreenshotImportState = .idle
    /// A stop the screenshot showed as the place to get off, while the rider chooses where to board.
    private(set) var screenshotDestination: RouteStop?
    /// Whether the original of the picked screenshot can be deleted from Photos, and how that went.
    private(set) var originalDeletion: OriginalDeletionState = .unavailable
    /// The picked photo's Photos identifier. Only the rider's own "delete" uses it.
    @ObservationIgnored private var screenshotAssetID: String?
    /// The route that stop belongs to: the suggestion is offered on no other route.
    private(set) var screenshotDestinationRoute: RouteID?
    /// After a live ride: today's last buses of the route number, for the way back.
    private(set) var returnService: ReturnService = .idle
    /// The server accepted this ride's Live Activity push token: the Lock Screen can update while TAPSO is closed.
    private(set) var liveActivityPushRegistered = false
    /// The canonical Jeju catalog on this phone, searched locally.
    private(set) var catalogIndex: DestinationSearchIndex?
    private(set) var catalogStatus: CatalogStatus = .idle
    /// A destination chosen from the catalog, while its route's stop list is set up.
    private(set) var catalogDestination: CatalogDestination?
    /// Official timetables per route number (`GET /v1/timetables`), never live.
    private(set) var timetables: [String: TimetableLoad] = [:]
    /// The way back pinned to the Lock Screen as a countdown, if one is running.
    private(set) var pinnedReturn: PinnedReturn?
    /// The countdown could not start: Live Activities are off for TAPSO.
    private(set) var returnReminderUnavailable = false

    @ObservationIgnored private let store: JourneyStore
    @ObservationIgnored private let liveActivity: LiveActivityClient?
    @ObservationIgnored private let returnReminders: ReturnReminderClient?
    @ObservationIgnored private let api: TapsoAPIClient
    @ObservationIgnored private let routeCatalog: LiveRouteImportCatalog
    @ObservationIgnored private let catalogFile: TransitCatalogFile
    @ObservationIgnored private var catalogETag: String?
    @ObservationIgnored private var catalogRefreshInFlight = false
    @ObservationIgnored private let screenshotImporter: ScreenshotRouteImporter
    @ObservationIgnored private let originalEraser: any ScreenshotOriginalEraser
    @ObservationIgnored private var screenshotTask: Task<Void, Never>?
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var playbackTask: Task<Void, Never>?
    /// Registers the live ride's Live Activity push tokens with the server.
    @ObservationIgnored private var pushTokenTask: Task<Void, Never>?
    @ObservationIgnored private var rejectedVehicles: Set<VehicleIdentifier> = []
    @ObservationIgnored private var lastMoment: RideMoment?
    /// The live session being set up, before a bus is confirmed.
    @ObservationIgnored private var liveSetupSession: JourneySessionSnapshot?
    /// The development opt-in; no debug surfaces in release builds.
    private let hybridLaunchArgument = ProcessInfo.processInfo.arguments.contains("-tapsoHybridTracking")
    /// Whether this ride fuses device evidence: the launch argument, or the server's rollout switch
    /// read when the ride started (`/health` → `hybridTracking.enabled`, off by default). Fixed for
    /// the ride's lifetime, relaunches included, so authority never flips mid-ride.
    private(set) var hybridTrackingEnabled = ProcessInfo.processInfo.arguments.contains("-tapsoHybridTracking")
    private(set) var isRecheckingPosition = false
    private(set) var hybridDiagnosticLines: [String] = []
    #if DEBUG
    /// The live ride's field trace (`RideTrace`): recorded automatically, exported from the ride screen.
    private(set) var rideTrace = RideTrace()
    #endif
    @ObservationIgnored private let locationSampler = RideLocationSampler()
    @ObservationIgnored private var hybridEngine: HybridPositionEngine?
    @ObservationIgnored private var hybridSessionID: String?
    @ObservationIgnored private var lastManualRefresh: Date?
    @ObservationIgnored private var readInFlight = false
    @ObservationIgnored private var rideInForeground = true
    @ObservationIgnored private var retainedDeviceSample: DevicePositionSample?
    @ObservationIgnored private var hybridPermissionRequested = false

    /// Seconds between session reads while the rider waits at the stop and while riding.
    /// Each read costs one bus-feed request on the server.
    static let liveCheckInterval: Duration = .seconds(10)
    static let liveRideInterval: Duration = .seconds(15)

    init(
        store: JourneyStore = JourneyStore(),
        liveActivity: LiveActivityClient? = LiveActivityClient(),
        returnReminders: ReturnReminderClient? = ReturnReminderClient(),
        api: TapsoAPIClient = TapsoAPIClient(),
        routeCatalog: LiveRouteImportCatalog? = nil,
        screenshotImporter: ScreenshotRouteImporter? = nil,
        originalEraser: (any ScreenshotOriginalEraser)? = nil,
        catalogFile: TransitCatalogFile? = nil
    ) {
        self.store = store
        self.catalogFile = catalogFile ?? .standard
        self.liveActivity = liveActivity
        self.returnReminders = returnReminders
        self.api = api
        let catalog = routeCatalog ?? LiveRouteImportCatalog(api: api)
        self.routeCatalog = catalog
        // `nil` rather than a default argument: Xcode 16.4's SILGen crashes on an existential default here.
        self.originalEraser = originalEraser ?? PhotoLibraryScreenshotEraser()
        self.screenshotImporter = screenshotImporter ?? ScreenshotRouteImporter(
            interpreter: LocalVisionRouteInterpreter(recognizer: VisionScreenshotTextRecognizer()),
            source: catalog
        )
        library = store.loadLibrary()
        if var saved = store.loadActiveRide(), Date().timeIntervalSince(saved.lastUpdateAt) < 8 * 3_600 {
            hybridTrackingEnabled = hybridLaunchArgument || (saved.live?.hybridTracking ?? false)
            // Re-age restored data against the wall clock: a ride saved at the next stop and
            // reopened later is shown as delayed (or checking), never as a fresh milestone.
            let age = FreshnessPolicy.conservativeDefault.classify(observedAt: saved.lastObservedAt, relativeTo: Date())
            if age != .fresh {
                saved.freshnessOverride = age
            }
            if saved.hybridPosition != nil {
                // A recent evaluation is not a recent official observation. Device continuity
                // is memory-only and must be re-established after process termination.
                saved.freshnessOverride = .unknown
            }
            saved.hybridPosition = nil
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
            let sequence = ride.hybridPosition?.currentStopSequence ?? ride.live?.currentStopSequence
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
        let current = ride.hybridPosition?.currentStopSequence ?? ride.live?.currentStopSequence
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
        catalogDestination = nil
        path = [.search]
    }

    func openMapImport() {
        path = [.mapImport]
    }

    // MARK: Map hand-off in (`docs/product/MAP_HANDOFF_V3.md`)

    /// Reads pasted map-app text on the device. Nothing is fetched or sent.
    func importSharedText(_ text: String) {
        cancelScreenshotImport()
        let place = SharedPlaceParser.parse(text: text)
        sharedPlace = place
        sharedPlaceUnreadable = place == nil
    }

    /// Picks up a place, or a screenshot's reading, TAPSO's share extension left in the App Group, once.
    func collectHandoff(from inbox: HandoffInbox? = HandoffInbox.shared(), now: Date = Date()) {
        if let place = inbox?.take(now: now) {
            receiveSharedPlace(place)
        } else if let reading = inbox?.takeReading(now: now) {
            receiveScreenshotReading(reading)
        }
    }

    /// A shared place opens the map-import screen from Home. During a ride, or in
    /// another setup, it waits on Home's map card instead of interrupting.
    func receiveSharedPlace(_ place: SharedPlace) {
        cancelScreenshotImport()
        sharedPlace = place
        sharedPlaceUnreadable = false
        guard activeRide == nil, outcome == nil, path.isEmpty || path.first == .mapImport else { return }
        path = [.mapImport]
    }

    func dismissSharedPlace() {
        sharedPlace = nil
        sharedPlaceUnreadable = false
    }

    // MARK: Screenshot route import (`docs/product/SCREENSHOT_IMPORT_V1.md`)

    /// Reads a screenshot the rider picked: text on the device, then TAPSO's own routes for the bus
    /// numbers read. The picture is never stored or sent, and nothing starts until the rider confirms.
    /// - Parameter assetID: the photo's Photos identifier, when the picker gave one. It lets the rider
    ///   delete the original afterwards; it is never used otherwise.
    func importScreenshot(_ imageData: Data, assetID: String? = nil) {
        beginScreenshotImport { importer in await importer.importRoute(from: imageData) }
        screenshotAssetID = assetID
        originalDeletion = assetID == nil ? .unavailable : .available
    }

    /// The rider asked to delete the original screenshot from Photos. Photo access is requested now, the
    /// first time, and iOS confirms the deletion itself.
    func deleteOriginalScreenshot() async {
        guard let assetID = screenshotAssetID else { return }
        switch originalDeletion {
        case .available, .failed: break
        case .unavailable, .deleting, .deleted: return
        }
        originalDeletion = .deleting
        let outcome = await originalEraser.erase(assetIdentifier: assetID)
        switch outcome {
        case .deleted:
            screenshotAssetID = nil
            originalDeletion = .deleted
        case .cancelled:
            originalDeletion = .available
        case .denied:
            originalDeletion = .failed(.denied)
        case .notFound, .failed:
            originalDeletion = .failed(.other)
        }
    }

    /// A screenshot shared to TAPSO from the Photos share sheet: the extension read it on the device and
    /// left only its reading. It is checked against TAPSO's route data exactly like a picked one. The
    /// import screen opens when nothing else is going on; during a ride the result waits there.
    func receiveScreenshotReading(_ reading: ScreenshotReading) {
        if activeRide == nil, outcome == nil, path.isEmpty || path.first == .mapImport {
            path = [.mapImport]
        }
        beginScreenshotImport { importer in await importer.importRoute(from: reading) }
    }

    private func beginScreenshotImport(_ work: @escaping @Sendable (ScreenshotRouteImporter) async -> RouteImportResult) {
        screenshotTask?.cancel()
        sharedPlace = nil
        sharedPlaceUnreadable = false
        screenshotDestination = nil
        screenshotDestinationRoute = nil
        screenshotAssetID = nil
        originalDeletion = .unavailable
        screenshotImport = .reading
        let importer = screenshotImporter
        screenshotTask = Task { [weak self] in
            let result = await work(importer)
            guard !Task.isCancelled else { return }
            self?.finishScreenshotImport(result)
        }
    }

    /// The photo could not be loaded from the picker.
    func screenshotCouldNotLoad() {
        screenshotTask?.cancel()
        screenshotImport = .failed(.unreadableImage)
    }

    /// Stops reading and returns to the start of the screen. Picking nothing leaves it there too.
    func cancelScreenshotImport() {
        screenshotTask?.cancel()
        screenshotTask = nil
        screenshotAssetID = nil
        originalDeletion = .unavailable
        screenshotImport = .idle
    }

    private func finishScreenshotImport(_ result: RouteImportResult) {
        screenshotTask = nil
        switch result {
        case let .confirmed(proposal):
            screenshotImport = .confirm(proposal)
        case let .choose(proposals):
            screenshotImport = .choose(proposals)
        case .notFound(.interrupted):
            screenshotImport = .idle
        case let .notFound(failure):
            screenshotImport = .failed(failure)
        }
    }

    /// The rider confirmed a route TAPSO verified. With both stops the vehicle check starts, exactly as
    /// after choosing them by hand; with only a destination the rider picks where to board first.
    func startScreenshotRoute(_ proposal: RouteImportProposal) async {
        guard let stops = await routeCatalog.liveStops(for: proposal.route.id.rawValue) else {
            screenshotImport = .failed(.routeDataUnavailable)
            return
        }
        screenshotImport = .idle
        if let boarding = proposal.boarding {
            chooseLiveStops(boarding: boarding, destination: proposal.destination, on: stops)
        } else {
            screenshotDestination = proposal.destination
            screenshotDestinationRoute = proposal.route.id
            liveStops = .loaded(stops)
            path.append(.liveStops(routeID: stops.apiRoute.routeId))
        }
    }

    /// "Not this route": the bus number's own variants, to choose from by hand.
    func chooseAnotherRoute(like proposal: RouteImportProposal) {
        let number = proposal.route.number
        screenshotImport = .idle
        openLiveSearch()
        Task { await searchLiveRoutes(number: number) }
    }

    /// Live: the rider names the bus that goes there; the stop list then suggests where to get off.
    func continueWithLiveRoute() {
        screenshotDestination = nil
        screenshotDestinationRoute = nil
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
        // A journey from the synthetic demo replays only in a demo build.
        guard TapsoBuild.showsDemo else {
            openSearch()
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

    /// Stop names found in a shared place's text: real catalog places once the catalog is on the
    /// phone (at least three letters, at most five, longest first); the demo's only in a demo build.
    func stopNames(inSharedText text: String) -> [String] {
        if let index = catalogIndex {
            let names = index.places.map(\.name).filter { StopNameMatcher.normalized($0).count >= 3 }
            return Array(StopNameMatcher.matches(in: text, among: names).prefix(5))
        }
        return TapsoBuild.showsDemo ? StopNameMatcher.matches(in: text, among: DemoCatalog.destinationNames) : []
    }

    /// The catalog in use is the phone's copy: the last update did not arrive.
    var catalogUpdateFailed: Bool {
        if case let .ready(_, _, refreshFailed) = catalogStatus { return refreshFailed }
        return false
    }

    /// Whether `stopNames(inSharedText:)` came from the synthetic demo.
    var sharedTextMatchesAreSynthetic: Bool { catalogIndex == nil }

    // MARK: Canonical catalog (`GET /v1/catalog`)

    /// Loads the copy on the phone, then asks the server for a newer one. A copy that
    /// does not decode and check is never used; the one in hand stays.
    func refreshCatalog() async {
        guard !catalogRefreshInFlight else { return }
        catalogRefreshInFlight = true
        defer { catalogRefreshInFlight = false }
        if catalogIndex == nil, let cached = catalogFile.load(), let index = await Self.searchIndex(from: cached.data) {
            catalogETag = cached.etag
            installCatalog(index, refreshFailed: false)
        }
        if catalogIndex == nil { catalogStatus = .loading }
        do {
            switch try await api.catalog(ifNoneMatch: catalogIndex == nil ? nil : catalogETag) {
            case .notModified:
                if let index = catalogIndex { installCatalog(index, refreshFailed: false) }
            case let .updated(data, etag):
                guard let index = await Self.searchIndex(from: data) else {
                    catalogRefreshFailed(.unexpectedResponse)
                    return
                }
                catalogFile.save(data, etag: etag)
                catalogETag = etag
                installCatalog(index, refreshFailed: false)
            }
        } catch is CancellationError {
            if catalogIndex == nil { catalogStatus = .idle }
        } catch {
            catalogRefreshFailed(Self.failure(error))
        }
    }

    private func installCatalog(_ index: DestinationSearchIndex, refreshFailed: Bool) {
        catalogIndex = index
        catalogStatus = .ready(version: index.catalog.catalogVersion, generatedAt: index.catalog.generatedAt, refreshFailed: refreshFailed)
    }

    private func catalogRefreshFailed(_ failure: TransitAPIFailure) {
        if let index = catalogIndex {
            installCatalog(index, refreshFailed: true)
        } else {
            catalogStatus = .failed(failure)
        }
    }

    private nonisolated static func searchIndex(from data: Data) async -> DestinationSearchIndex? {
        await Task.detached(priority: .userInitiated) { () -> DestinationSearchIndex? in
            guard let catalog = try? JejuTransitCatalog.decode(data) else { return nil }
            return DestinationSearchIndex(catalog: catalog)
        }.value
    }

    func catalogPlace(named name: String) -> DestinationPlace? {
        let key = DestinationSearchIndex.placeName(name)
        return catalogIndex?.places.first { $0.name == key }
    }

    /// A place chosen in search: a single way there opens its stop list, several are listed.
    func chooseCatalogPlace(_ place: DestinationPlace) {
        guard let index = catalogIndex else { return }
        let options = index.routeOptions(to: place).flatMap(\.options)
        if options.count == 1, let only = options.first {
            Task { await chooseCatalogRoute(only, placeName: place.name) }
        } else if !options.isEmpty {
            path.append(.catalogRoutes(placeName: place.name))
        }
    }

    /// One variant chosen for a place: the server's current stop list opens with the place fixed.
    func chooseCatalogRoute(_ option: DestinationRouteOption, placeName: String) async {
        guard let index = catalogIndex else { return }
        screenshotDestination = nil
        screenshotDestinationRoute = nil
        catalogDestination = CatalogDestination(
            routeID: option.route.routeId,
            sequence: option.destinationSequence,
            stopID: option.destinationStopID,
            placeName: placeName
        )
        await chooseLiveRoute(index.catalog.apiRoute(option.route))
    }

    /// The catalog's destination on the server's current list: the same stop at the same sequence, or nothing.
    func fixedDestination(on stops: LiveRouteStops) -> RouteStop? {
        guard let destination = catalogDestination, destination.routeID == stops.apiRoute.routeId else { return nil }
        guard let stop = stops.route.routeStop(sequence: destination.sequence), stop.stop.id.rawValue == destination.stopID else { return nil }
        return stop
    }

    /// The route changed since the catalog was built: the rider chooses the destination again.
    func catalogDestinationMoved(on stops: LiveRouteStops) -> Bool {
        catalogDestination?.routeID == stops.apiRoute.routeId && fixedDestination(on: stops) == nil
    }

    /// A recent destination from Home: the catalog's place, the demo's in a demo build, or search.
    func chooseRecentDestination(named name: String) {
        if let place = catalogPlace(named: name) {
            path = [.search]
            chooseCatalogPlace(place)
        } else if TapsoBuild.showsDemo, !DemoCatalog.routeOptions(toDestinationNamed: name).isEmpty {
            path = [.search]
            chooseDestination(named: name)
        } else {
            openSearch()
        }
    }

    // MARK: Official timetables (`GET /v1/timetables`)

    func loadTimetable(routeNumber: String) async {
        if case .loaded = timetables[routeNumber] { return }
        if timetables[routeNumber] == .loading { return }
        timetables[routeNumber] = .loading
        do {
            timetables[routeNumber] = .loaded(try await api.timetable(routeNumber: routeNumber))
        } catch is CancellationError {
            timetables[routeNumber] = nil
        } catch {
            timetables[routeNumber] = .failed(Self.failure(error))
        }
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
        if hybridTrackingEnabled, isLiveRide {
            // A restored old activity may have an APNs token. End it before local authority begins.
            await liveActivity?.endAll()
            await reconcileRidePosition(manual: false)
        }
        if let state = contentState() {
            if liveActivity?.activityID == nil {
                await startLiveActivity()
            } else {
                await liveActivity?.update(state: state, alerting: nil)
                registerPushTokens()
            }
        }
        if isLiveRide {
            beginLivePolling()
        } else {
            beginPlayback()
        }
    }

    func finishRide() async {
        resetHybridTracking()
        playbackTask?.cancel()
        pushTokenTask?.cancel()
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
        resetHybridTracking()
        playbackTask?.cancel()
        pushTokenTask?.cancel()
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

    // MARK: The way back on the Lock Screen

    struct PinnedReturn: Equatable {
        let routeID: String
        let beAtStopBy: Date
    }

    enum ReturnPinAvailability: Equatable {
        /// The countdown for this variant is on the Lock Screen.
        case pinned
        case available
        /// More than a Live Activity's eight hours away.
        case tooEarly
        /// Nothing to count down to: gone, unknown, or a matter of minutes.
        case notOffered
    }

    func pinAvailability(for row: ReturnServiceRow, now: Date = Date()) -> ReturnPinAvailability {
        if pinnedReturn?.routeID == row.route.routeId { return .pinned }
        if Self.returnReminder(for: row, now: now) != nil { return .available }
        if let date = row.advice.beAtStopByDate, date.timeIntervalSince(now) > Self.returnReminderMaximumLead { return .tooEarly }
        return .notOffered
    }

    /// Starts the countdown for one variant, replacing any other.
    func pinReturnReminder(_ row: ReturnServiceRow, now: Date = Date()) async {
        guard let reminder = Self.returnReminder(for: row, now: now), let returnReminders else { return }
        do {
            try await returnReminders.start(attributes: reminder.attributes, state: reminder.state)
            pinnedReturn = PinnedReturn(routeID: row.route.routeId, beAtStopBy: reminder.state.beAtStopBy)
            returnReminderUnavailable = false
        } catch {
            returnReminderUnavailable = true
        }
    }

    func unpinReturnReminder() async {
        await returnReminders?.end()
        pinnedReturn = nil
    }

    /// When the app comes to the front: picks up a countdown started before a relaunch, and
    /// clears one whose time to be at the stop is long past.
    func refreshReturnReminder(now: Date = Date()) async {
        guard let current = returnReminders?.current else {
            pinnedReturn = nil
            return
        }
        if now.timeIntervalSince(current.state.beAtStopBy) > Self.returnReminderGrace {
            await unpinReturnReminder()
        } else {
            pinnedReturn = PinnedReturn(routeID: current.attributes.routeID, beAtStopBy: current.state.beAtStopBy)
        }
    }

    /// What the countdown for `row` would show, or `nil` when there is nothing worth counting down to.
    static func returnReminder(
        for row: ReturnServiceRow,
        now: Date
    ) -> (attributes: TapsoReturnAttributes, state: TapsoReturnAttributes.ContentState)? {
        let advice = row.advice
        guard
            [.comfortable, .leaveBy, .tight].contains(advice.level),
            let date = advice.beAtStopByDate,
            let text = advice.beAtStopBy,
            let last = advice.lastDeparture
        else { return nil }
        let lead = date.timeIntervalSince(now)
        guard lead >= returnReminderMinimumLead, lead <= returnReminderMaximumLead else { return nil }
        let attributes = TapsoReturnAttributes(
            routeID: row.route.routeId,
            routeNumber: row.route.routeNumber,
            startStopName: row.route.startStopName ?? "—",
            endStopName: row.route.endStopName ?? "—",
            beAtStopByText: text,
            lastDeparture: last
        )
        return (attributes, TapsoReturnAttributes.ContentState(startedAt: now, beAtStopBy: date))
    }

    /// The system ends a Live Activity after eight hours (ActivityKit, "Displaying live data with
    /// Live Activities", read 2026-10-01): a longer countdown is not offered.
    static let returnReminderMaximumLead: TimeInterval = 8 * 3_600
    /// `ASSUMED`: with less than five minutes left there is no time to watch a countdown; the card's own line is enough.
    static let returnReminderMinimumLead: TimeInterval = 5 * 60
    /// `ASSUMED`: half an hour after the time to be at the stop, the countdown has nothing left to say.
    static let returnReminderGrace: TimeInterval = 30 * 60

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

    /// Live setup from a route number. Destination-first setup runs on the catalog
    /// (`chooseCatalogPlace`) and joins this flow at the variant's stop list.
    func openLiveSearch() {
        catalogDestination = nil
        screenshotDestination = nil
        screenshotDestinationRoute = nil
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
        if !newPath.contains(.mapImport), screenshotImport != .idle { cancelScreenshotImport() }
        if newPath.isEmpty { screenshotDestination = nil; screenshotDestinationRoute = nil; catalogDestination = nil }
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

        // The hybrid rollout switch is read once, here, and travels with the ride.
        var hybridForThisRide = hybridLaunchArgument
        if !hybridForThisRide { hybridForThisRide = await api.hybridTrackingEnabled() }
        hybridTrackingEnabled = hybridForThisRide

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
                endedByServer: false,
                hybridTracking: hybridForThisRide
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

        if hybridTrackingEnabled { await reconcileRidePosition(manual: false) }
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
                guard self.rideInForeground else { continue }
                if self.hybridTrackingEnabled {
                    await self.reconcileRidePosition(manual: false)
                    if self.activeRide?.live?.endedByServer != false { return }
                } else {
                    guard await self.refreshLiveRide(sessionID: sessionID) else { return }
                }
            }
        }
    }

    func rideSceneChanged(isActive: Bool) async {
        rideInForeground = isActive
        trace("lifecycle")
        guard hybridTrackingEnabled, isLiveRide else { return }
        if isActive {
            await reconcileRidePosition(manual: false)
        } else {
            locationSampler.stop()
            retainedDeviceSample = nil
        }
    }

    func recheckRidePosition() async {
        guard !isRecheckingPosition, !readInFlight, let live = activeRide?.live, !live.endedByServer else { return }
        let now = Date()
        guard lastManualRefresh.map({ now.timeIntervalSince($0) >= 10 }) ?? true else { return }
        lastManualRefresh = now
        isRecheckingPosition = true
        defer { isRecheckingPosition = false }
        trace("recheck")
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        if hybridTrackingEnabled {
            await reconcileRidePosition(manual: true)
        } else {
            _ = await refreshLiveRide(sessionID: live.sessionID)
        }
    }

    private func resetHybridTracking() {
        locationSampler.stop()
        hybridEngine = nil
        hybridSessionID = nil
        retainedDeviceSample = nil
        hybridDiagnosticLines = []
        #if DEBUG
        rideTrace.reset()
        #endif
        hybridPermissionRequested = false
        lastManualRefresh = nil
    }

    private func reconcileRidePosition(manual: Bool) async {
        guard !readInFlight, rideInForeground, let ride = activeRide, let live = ride.live,
              !live.endedByServer, let route = ride.draft.route,
              let destination = ride.draft.destinationRouteStop?.sequence else { return }
        readInFlight = true
        defer { readInFlight = false }
        let sessionID = live.sessionID
        if hybridSessionID != sessionID {
            hybridEngine = HybridPositionEngine(vehicleID: live.vehicleID, route: route,
                destinationSequence: destination, surveyed: ride.draft.coordinatesAreSurveyed == true)
            hybridSessionID = sessionID
            retainedDeviceSample = nil
        }
        let urgent = manual || ride.signal.remainingStops <= 3 || ride.hybridPosition?.state != .live
        let requestPermission = !hybridPermissionRequested
        hybridPermissionRequested = true
        async let sample = locationSampler.sample(urgent: urgent, requestPermission: requestPermission)
        var snapshot: JourneySessionSnapshot?
        var failure: TransitAPIFailure?
        do { snapshot = try await api.session(id: sessionID) }
        catch is CancellationError { return }
        catch { failure = Self.failure(error) }
        let freshDevice = await sample
        guard var current = activeRide, current.live?.sessionID == sessionID else { return }
        if let freshDevice { retainedDeviceSample = freshDevice }
        if let failure, !failure.isTransient { current.live?.endedByServer = true }
        if let snapshot {
            current.live?.signal = LiveSessionInterpreter.rideSignal(for: snapshot)
            if let sequence = snapshot.progress?.currentStopSequence { current.live?.currentStopSequence = sequence }
        }
        let evidenceAt = snapshot?.progress?.evidenceAt.flatMap { ISO8601DateFormatter.tapsoEvidence.date(from: $0) }
        let usableOfficial = snapshot?.progress?.source != "retained_last_known" ? snapshot.map { LiveSessionInterpreter.rideSignal(for: $0) } : nil
        let snapshotMatchesRide = snapshot.map {
            $0.id == sessionID && $0.routeId == current.draft.routeID.rawValue
                && $0.destinationStop.sequence == destination
                && $0.cityCode == current.draft.cityCode
        } ?? true
        let result = hybridEngine?.evaluate(official: usableOfficial, sequence: snapshot?.progress?.currentStopSequence,
            evidenceAt: evidenceAt, selectedVehicleID: !snapshotMatchesRide || (snapshot != nil && snapshot?.progress == nil) || snapshot?.trackingIntegrity != nil ? nil : (snapshot == nil ? live.vehicleID : snapshot?.selectedVehicleId),
            device: retainedDeviceSample, now: Date())
        current.hybridPosition = result
        current.isOffline = false // Connectivity alone is not passenger reliability.
        current.freshnessOverride = nil
        current.lastObservedAt = result?.evaluatedAt
        activeRide = current
        liveFailure = current.live?.endedByServer == true ? failure : nil
        #if DEBUG
        if let result {
            let deviceAge = retainedDeviceSample.map { Int(Date().timeIntervalSince($0.timestamp) / 5) * 5 } ?? -1
            let accuracy = retainedDeviceSample.map { Int($0.accuracy / 10) * 10 } ?? -1
            let officialAge = evidenceAt.map { Int(Date().timeIntervalSince($0) / 5) * 5 } ?? -1
            let line = "\(Int(result.evaluatedAt.timeIntervalSince1970)) route=\(route.number) variant=\(route.id.rawValue) direction=\(route.direction.rawValue) vehicle=\(current.plate) state=\(result.state.rawValue) source=\(result.source) category=\(result.confidenceCategory) confidence=\(Int(result.confidence * 100)) reason=\(result.reason) route100m=\(result.routeDistanceBucket ?? -1) stop=\(result.currentStopSequence ?? -1) remaining=\(result.remainingStops) officialAge5s=\(officialAge) gpsAge5s=\(deviceAge) accuracy10m=\(accuracy) legacy=\(current.live?.signal.freshness.rawValue ?? "unknown") legacyRemaining=\(current.live?.signal.remainingStops ?? -1) officialSequence=\(snapshot?.progress?.currentStopSequence ?? -1)"
            hybridDiagnosticLines.append(line)
            if hybridDiagnosticLines.count > 200 { hybridDiagnosticLines.removeFirst(hybridDiagnosticLines.count - 200) }
        }
        trace(failure == nil ? "hybrid" : "poll_failed", snapshot: snapshot, detail: failure?.name ?? "\(result?.source ?? "-") \(result?.reason ?? "-")")
        #endif
        store.saveActiveRide(activeRide)
        await rideDidChange()
    }

    /// Records one trace event for the active live ride (Debug builds only; a no-op otherwise).
    private func trace(_ event: String, snapshot: JourneySessionSnapshot? = nil, milestone: RideMilestone? = nil, detail: String? = nil) {
        #if DEBUG
        guard let ride = activeRide, let live = ride.live, let route = ride.draft.route else { return }
        let guidance = ride.guidance
        rideTrace.record(RideTraceEvent(
            at: Date(),
            build: TapsoBuild.identity().line,
            event: event,
            route: route.number,
            variant: route.id.rawValue,
            vehicle: ride.plate,
            providerSequence: snapshot?.progress?.currentStopSequence ?? live.currentStopSequence,
            sessionState: snapshot?.state,
            serverTrust: snapshot?.reliability?.trust,
            moment: guidance.moment.rawValue,
            trust: guidance.trust.rawValue,
            remainingStops: ride.signal.remainingStops,
            hybridState: ride.hybridPosition?.state.rawValue,
            gpsAccuracyBucket: retainedDeviceSample.map { Int($0.accuracy / 10) * 10 },
            lifecycle: rideInForeground ? "foreground" : "background",
            milestone: milestone?.rawValue,
            detail: detail
        ))
        #endif
    }

    /// One session read during the ride. False when polling should stop.
    private func refreshLiveRide(sessionID: String) async -> Bool {
        guard !readInFlight else { return true }
        readInFlight = true
        defer { readInFlight = false }
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
            trace("poll", snapshot: snapshot)
        } catch is CancellationError {
            return false
        } catch {
            guard var ride = activeRide, ride.live?.sessionID == sessionID else { return false }
            let failure = Self.failure(error)
            liveFailure = failure
            trace("poll_failed", detail: failure.name)
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
            RideFeedback.announce(guidance, exitStopName: passedStopAdvice?.exitStop?.stop.name)
            trace(newMilestone == nil ? "guidance" : "milestone", milestone: newMilestone)
        }
        if let state = contentState() {
            await liveActivity?.update(state: state, alerting: newMilestone)
            trace("live_activity", milestone: newMilestone, detail: "freshness=\(state.freshness.rawValue) phase=\(state.phase.rawValue)")
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
        // Only a live ride has a server session to push to; a demo ride never asks for a token.
        let push = ride.live != nil && !hybridTrackingEnabled ? await api.liveActivityPushEnabled() : false
        do {
            try await liveActivity.start(attributes: attributes, state: state, push: push)
            liveActivityUnavailable = false
        } catch {
            liveActivityUnavailable = true
            return
        }
        registerPushTokens()
    }

    /// Sends each push token of the live ride's activity to the server, rotations included. The
    /// server clears the token when the session ends; a failed registration leaves the activity
    /// updating from the app, as it does without push.
    private func registerPushTokens() {
        pushTokenTask?.cancel()
        liveActivityPushRegistered = false
        guard !hybridTrackingEnabled, let sessionID = activeRide?.live?.sessionID, let tokens = liveActivity?.pushTokens() else { return }
        let api = self.api
        pushTokenTask = Task {
            for await token in tokens {
                guard !Task.isCancelled else { return }
                let accepted = (try? await api.registerLiveActivityToken(sessionID: sessionID, token: token)) != nil
                if accepted { self.liveActivityPushRegistered = true }
            }
        }
    }

    func contentState() -> TapsoActivityAttributes.ContentState? {
        guard let ride = activeRide else { return nil }
        let signal = ride.signal
        // Past the stop, "next" is where to get off (`PassedStopRescue`), not a stop before the destination.
        let next = ride.guidance.moment == .passedDestination
            ? passedStopAdvice?.exitStop?.stop.name
            : upcomingStopNames.first
        return TapsoActivityAttributes.ContentState(
            phase: signal.phase,
            currentStopName: currentStopName,
            nextStopName: next,
            remainingStops: signal.remainingStops,
            freshness: signal.freshness,
            updatedAt: ride.lastUpdateAt,
            destinationPassed: signal.destinationPassed,
            isOffline: signal.isOffline,
            isEstimated: signal.isEstimated ?? false,
            trackingValidUntil: ride.hybridPosition?.validUntil
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

/// Screenshot import: what the screen shows. A result is never a started ride.
enum ScreenshotImportState: Equatable {
    case idle
    /// Reading the picture and looking up the routes of the bus numbers in it.
    case reading
    /// One route and direction strongly supported: the rider confirms.
    case confirm(RouteImportProposal)
    /// Several candidates, or one that is not certain enough to confirm outright.
    case choose([RouteImportProposal])
    case failed(RouteImportFailure)
}

private extension ISO8601DateFormatter {
    static var tapsoEvidence: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}

/// Deleting the original screenshot from Photos, which only the rider can ask for.
enum OriginalDeletionState: Equatable {
    /// No original to delete: not picked from Photos (a shared screenshot has no identifier), or already deleted.
    case unavailable
    case available
    case deleting
    case deleted
    case failed(OriginalDeletionFailure)
}

enum OriginalDeletionFailure: Equatable {
    /// Photo access was refused.
    case denied
    /// Photos did not show the photo to TAPSO, or the change failed.
    case other
}
