import SwiftUI
import XCTest
import TapsoTransit
@testable import Tapso

/// Renders every Product V2 screen and ride surface to PNG for visual review
/// against Figma. Runs only when `TAPSO_SNAPSHOT_DIR` is set (CI passes it as
/// `TEST_RUNNER_TAPSO_SNAPSHOT_DIR`); the language comes from `-testLanguage`.
///
/// These are evidence images, not pixel assertions. The Dynamic Island frames
/// are the island regions drawn inside a mock of the island's outline: iOS
/// draws the real outline, and only a device shows it exactly.
@MainActor
final class SnapshotEvidenceTests: XCTestCase {
    private func outputDirectory() throws -> URL {
        guard let path = ProcessInfo.processInfo.environment["TAPSO_SNAPSHOT_DIR"], !path.isEmpty else {
            throw XCTSkip("Set TAPSO_SNAPSHOT_DIR to render snapshot evidence")
        }
        let language = Locale.preferredLanguages.first.map { String($0.prefix(2)) } ?? "xx"
        let directory = URL(fileURLWithPath: path).appendingPathComponent(language)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    // MARK: Screens

    func testRenderScreens() throws {
        let directory = try outputDirectory()
        let library = sampleLibrary()
        let screens: [(String, AnyView)] = [
            ("01-home-first-run", AnyView(HomeContent(library: JourneyLibrary(), onSearch: {}, onDestination: { _ in }, onRideAgain: { _ in }, onToggleFavorite: { _ in }, onMapImport: {}, onSample: {}))),
            ("02-home-recent-favorites", AnyView(HomeContent(library: library, onSearch: {}, onDestination: { _ in }, onRideAgain: { _ in }, onToggleFavorite: { _ in }, onMapImport: {}, onSample: {}))),
            ("03-destination-search", AnyView(DestinationSearchContent(query: "", recentNames: library.recentDestinationNames, onChoose: { _ in }))),
            ("04-destination-results", AnyView(DestinationSearchContent(query: "제주", recentNames: [], onChoose: { _ in }))),
            ("05-route-select", AnyView(RouteSelectContent(destinationName: "관덕정", options: DemoCatalog.routeOptions(toDestinationNamed: "관덕정"), onChoose: { _ in }))),
            ("06-boarding-stop", AnyView(BoardingStopContent(route: DemoCatalog.outbound, destination: DemoCatalog.outbound.stops[8], onChoose: { _ in }))),
            ("07-map-import", AnyView(MapImportContent(place: nil, paste: AnyView(pastePlaceholder), onChooseDemo: { _ in }, onSearch: {}))),
            ("08-map-import-found", AnyView(MapImportContent(place: sharedPlace, demoMatches: ["제주시청(아라방면)"], paste: AnyView(pastePlaceholder), onChooseDemo: { _ in }, onSearch: {}))),
            ("09-check-searching", check(.evaluate(proposals: [], hasSearched: false))),
            ("10-check-proposed", check(.evaluate(proposals: DemoCatalog.proposals(for: .smooth, route: DemoCatalog.outbound), hasSearched: true))),
            ("11-check-similar-buses", check(.evaluate(proposals: DemoCatalog.proposals(for: .similarBuses, route: DemoCatalog.outbound), hasSearched: true))),
            ("12-check-not-found", check(.evaluate(proposals: [], hasSearched: true))),
            ("13-ride-riding", ride(.active, 6)),
            ("14-ride-prepare", ride(.approachingDestination, 2)),
            ("15-ride-next-stop", ride(.nextStopIsDestination, 1)),
            ("16-ride-arrived", ride(.arrived, 0)),
            ("17-ride-passed", ride(.arrived, 0, passed: true, rescue: PassedStopRescue.advice(
                route: DemoCatalog.outbound, destinationSequence: 8, busSequence: 9, coordinatesAreSurveyed: false
            ))),
            ("18-ride-delayed", ride(.active, 4, freshness: .stale)),
            ("19-ride-vehicle-lost", ride(.vehicleTemporarilyLost, 4)),
            ("20-ride-offline", ride(.active, 4, offline: true)),
            ("21-ride-checking", ride(.nextStopIsDestination, 2)),
            ("22-ride-resumed", ride(.active, 5, resumed: true)),
            ("23-ride-live-activity-off", ride(.active, 6, liveActivityOff: true)),
            ("24-end-arrived", end(.arrived)),
            ("25-end-passed", end(.passedDestination)),
            ("26-map-import-outside-jeju", AnyView(MapImportContent(
                place: SharedPlace(source: .appleMaps, name: "합성 장소", coordinate: Coordinate(latitude: 37.5665, longitude: 126.9780)),
                paste: AnyView(pastePlaceholder), onChooseDemo: { _ in }, onSearch: {}
            ))),
            ("27-map-import-link-only", AnyView(MapImportContent(
                place: SharedPlace(source: .kakaoMap, unresolvedLink: "kakaomap://place?id=SynThetic"),
                paste: AnyView(pastePlaceholder), onChooseDemo: { _ in }, onSearch: {}
            ))),
            ("28-end-walk-to-place", AnyView(RideEndContent(
                outcome: RideOutcome(moment: .arrived, routeNumber: "202", destination: DemoCatalog.outbound.stops[8].stop, place: sharedPlace),
                naverAvailable: true,
                kakaoAvailable: true,
                handoffFailed: nil,
                onMap: { _ in },
                onDone: {},
                appleMapsAvailable: true
            ))),
            ("29-end-return-trip", AnyView(RideEndContent(
                outcome: RideOutcome(moment: .arrived, routeNumber: "202", destination: DemoCatalog.outbound.stops[8].stop),
                naverAvailable: true,
                kakaoAvailable: true,
                handoffFailed: nil,
                onMap: { _ in },
                onDone: {},
                returnService: .loaded(returnRows)
            ))),
            ("30-ride-passed-walk-back", ride(.arrived, 0, passed: true, rescue: walkBackAdvice, kakaoAvailable: true)),
            ("32-map-import-screenshot", screenshotImport(.idle)),
            ("33-screenshot-reading", screenshotImport(.reading)),
            ("34-screenshot-confirm", screenshotImport(.confirm(screenshotProposal(boarding: 2)))),
            ("35-screenshot-confirm-destination-only", screenshotImport(.confirm(screenshotProposal(boarding: nil)))),
            ("36-screenshot-choose", screenshotImport(.choose([screenshotProposal(boarding: 2), screenshotProposal(boarding: nil)]))),
            ("37-screenshot-failed", screenshotImport(.failed(.noStopMatch))),
            ("31-end-return-countdown", AnyView(RideEndContent(
                outcome: RideOutcome(moment: .arrived, routeNumber: "202", destination: DemoCatalog.outbound.stops[8].stop),
                naverAvailable: true,
                kakaoAvailable: true,
                handoffFailed: nil,
                onMap: { _ in },
                onDone: {},
                returnService: .loaded(returnRows),
                returnPin: { $0.route.routeId == "SYN-202-W" ? .pinned : .available }
            ))),
            ("38-catalog-search", AnyView(CatalogDestinationSearchContent(query: "", index: catalogIndex, recentNames: ["합성시청[동]"], generatedAt: "2026-10-03T00:00:00.000Z", onChoose: { _ in }))),
            ("39-catalog-results", AnyView(CatalogDestinationSearchContent(query: "합성", index: catalogIndex, recentNames: [], generatedAt: "2026-10-03T00:00:00.000Z", onChoose: { _ in }))),
            ("40-catalog-route-select", AnyView(CatalogRouteSelectContent(
                placeName: "합성대학교",
                groups: catalogIndex.routeOptions(to: catalogIndex.places.first { $0.name == "합성대학교" }!),
                onChoose: { _ in }
            ))),
            ("41-stop-picker-fixed-destination", stopPickerWithFixedDestination()),
            ("42-timetable-today", AnyView(TimetableCard(routeNumber: "202", load: .loaded(timetable(Self.timetableToday)), onLoad: {}, onShowAll: { _ in }).padding())),
            ("43-timetable-unavailable", AnyView(TimetableCard(routeNumber: "999", load: .loaded(timetable(Self.timetableNone)), onLoad: {}, onShowAll: { _ in }).padding())),
            ("44-timetable-sheet", AnyView(TimetableSheetContent(view: timetable(Self.timetableToday))))
        ]
        for (name, view) in screens {
            for scheme in [ColorScheme.light, .dark] {
                try render(in: directory, view, name: "\(name)-\(scheme == .light ? "light" : "dark")", width: 402, scheme: scheme)
            }
        }
        // Device widths and large text for the screens that carry the most.
        for (name, view) in screens where ["02-home-recent-favorites", "13-ride-riding", "15-ride-next-stop", "10-check-proposed"].contains(name) {
            try render(in: directory, view, name: "\(name)-375-se", width: 375, scheme: .light)
            try render(in: directory, view, name: "\(name)-440-promax", width: 440, scheme: .light)
            try render(in: directory, view, name: "\(name)-ax3", width: 402, scheme: .light, typeSize: .accessibility3)
        }
    }

    // MARK: Live Activity and Dynamic Island

    func testRenderRideSurfaces() throws {
        let directory = try outputDirectory()
        let states: [(String, TapsoActivityAttributes.ContentState, Bool)] = [
            ("riding", state(.active, 6), false),
            ("prepare", state(.approachingDestination, 2), false),
            ("next-stop", state(.nextStopIsDestination, 1), false),
            ("arrived", state(.arrived, 0), false),
            ("passed", state(.arrived, 0, passed: true), false),
            ("delayed", state(.active, 4, freshness: .aging), false),
            ("vehicle-lost", state(.vehicleTemporarilyLost, 4), false),
            ("offline", state(.active, 4, offline: true), false),
            ("checking", state(.nextStopIsDestination, 2), false),
            // Fresh next-stop content past its stale date (app suspended): every surface shows delayed.
            ("next-stop-stale", state(.nextStopIsDestination, 1), true)
        ]
        for (name, state, isStale) in states {
            try render(in: directory,
                AnyView(LockScreenRideView(attributes: attributes, state: state, isStale: isStale, drawsBackground: true)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))),
                name: "la-lockscreen-\(name)", width: 370, scheme: .dark, background: .black
            )
            try render(in: directory, AnyView(IslandCompactMock(attributes: attributes, state: state, isStale: isStale)), name: "di-compact-\(name)", width: 300, scheme: .dark, background: .white)
            try render(in: directory, AnyView(IslandMinimalMock(state: state, isStale: isStale)), name: "di-minimal-\(name)", width: 60, scheme: .dark, background: .white)
            try render(in: directory, AnyView(IslandExpandedMock(attributes: attributes, state: state, isStale: isStale)), name: "di-expanded-\(name)", width: 380, scheme: .dark, background: .white)
        }
        // "돌아갈 시간": counting down, then past the time to be at the stop. The timer runs from now.
        let countdown = TapsoReturnAttributes.ContentState(startedAt: Date(), beAtStopBy: Date().addingTimeInterval(83 * 60))
        for (name, isStale) in [("return-countdown", false), ("return-late", true)] {
            try render(in: directory,
                AnyView(ReturnLockScreenView(attributes: returnAttributes, state: countdown, isStale: isStale, drawsBackground: true)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))),
                name: "la-lockscreen-\(name)", width: 370, scheme: .dark, background: .black
            )
            try render(in: directory, AnyView(ReturnIslandCompactMock(attributes: returnAttributes, state: countdown, isStale: isStale)), name: "di-compact-\(name)", width: 300, scheme: .dark, background: .white)
            try render(in: directory, AnyView(ReturnIslandMinimal(isStale: isStale).frame(width: 37, height: 37).background(Color.black, in: Circle()).padding(10)), name: "di-minimal-\(name)", width: 60, scheme: .dark, background: .white)
            try render(in: directory, AnyView(ReturnIslandExpandedMock(attributes: returnAttributes, state: countdown, isStale: isStale)), name: "di-expanded-\(name)", width: 380, scheme: .dark, background: .white)
        }
    }

    /// SYNTHETIC: the way back as the end screen would pin it.
    private let returnAttributes = TapsoReturnAttributes(
        routeID: "SYN-202-E",
        routeNumber: "202",
        startStopName: "협재",
        endStopName: "제주버스터미널",
        beAtStopByText: "21:40",
        lastDeparture: "21:50"
    )

    // MARK: Builders

    private let attributes = TapsoActivityAttributes(
        routeNumber: "365",
        routeID: "demo-route-365-outbound",
        boardingStopName: "제주버스터미널",
        destinationName: "제주시청(아라방면)",
        totalStops: 8,
        // The plate of the bus the sample check proposes, so check, ride and surfaces agree.
        vehiclePlate: DemoCatalog.proposals(for: .smooth, route: DemoCatalog.outbound)[0].maskedPlate
    )

    /// SYNTHETIC: a small catalog in the real shape (two directions of 202, two branches of 202-1).
    private var catalogIndex: DestinationSearchIndex {
        let names = ["합성터미널", "합성시청[동]", "합성시청[서]", "합성대학교", "합성공항", "합성마을"]
        let stops = names.enumerated().map { index, name in
            JejuTransitCatalog.Stop(id: "SYN-\(index)", name: name, lat: 33.45 + Double(index) / 500, lng: 126.5 + Double(index) / 500)
        }
        return DestinationSearchIndex(catalog: JejuTransitCatalog(
            catalogVersion: "0123456789abcdef",
            generatedAt: "2026-10-03T00:00:00.000Z",
            stops: stops,
            routes: [
                .init(routeId: "SYN202A", routeNo: "202", start: "합성터미널", end: "합성대학교", stops: [0, 1, 3]),
                .init(routeId: "SYN202B", routeNo: "202", start: "합성대학교", end: "합성터미널", stops: [3, 2, 0]),
                .init(routeId: "SYN2021", routeNo: "202-1", start: "합성터미널", end: "합성대학교", stops: [0, 4, 3]),
                .init(routeId: "SYN2021X", routeNo: "202-1", start: "합성터미널", end: "합성대학교", stops: [0, 5, 3]),
            ]
        ))
    }

    private func stopPickerWithFixedDestination() -> AnyView {
        let index = catalogIndex
        let route = index.catalog.routes[0]
        let transitRoute = index.transitRoute(route)
        let stops = LiveRouteStops(apiRoute: index.catalog.apiRoute(route), route: transitRoute, coordinatesAreSurveyed: true, topology: "linear")
        return AnyView(LiveStopPickerContent(
            stops: stops,
            onChoose: { _, _ in },
            fixedDestination: transitRoute.routeStop(sequence: 3),
            timetable: AnyView(TimetableCard(routeNumber: "202", load: .loaded(timetable(Self.timetableToday)), onLoad: {}, onShowAll: { _ in }))
        ))
    }

    private func timetable(_ json: String) -> TransitAPITimetable {
        try! JSONDecoder().decode(TransitAPITimetable.self, from: Data(json.utf8))
    }

    /// SYNTHETIC timetable views in the server's shape (`fixtures/journey/timetable-views-v1.json` has the real ones).
    private static let timetableToday = #"""
    {"routeNo":"202","status":"available","label":"OFFICIAL_DATED","asOf":"2026-10-03","freshness":"fresh","date":"2026-10-07",
     "serviceDay":{"date":"2026-10-07","weekday":"wed","publicHoliday":null,"calendarCovered":true},
     "today":[{"direction":"합성터미널→합성대학교","first":{"time":"05:50","from":"합성터미널"},"last":{"time":"22:40","from":"합성터미널"},"dayLabel":"평일","applicability":"applies"},
              {"direction":"합성대학교→합성터미널","first":{"time":"06:05","from":"합성대학교"},"last":{"time":"24:10","from":"합성대학교"},"dayLabel":"평일","applicability":"applies"}],
     "services":[{"direction":"합성터미널→합성대학교","dayType":"weekday","dayLabel":"평일","applicability":"applies","effectiveFrom":"2026-06-24","inEffect":true,"status":"ok",
       "timepoints":["합성터미널","합성시청","합성대학교"],
       "trips":[{"routeNumber":"202","times":["05:50","06:02","06:20"],"firstTime":"05:50"},{"routeNumber":"202","times":["06:30","06:42","07:00"],"firstTime":"06:30"},
                {"routeNumber":"202","times":["22:40","22:52","23:10"],"firstTime":"22:40"},{"routeNumber":"202","times":["23:20","23:32","23:50"],"firstTime":"23:20","conditions":["11,12,1,2월 막차"]}],
       "first":{"time":"05:50","from":"합성터미널"},"last":{"time":"22:40","from":"합성터미널"},
       "laterConditional":[{"time":"23:20","from":"합성터미널","conditions":["11,12,1,2월 막차"]}],"hasConditionalTrips":true}]}
    """#

    private static let timetableNone = #"""
    {"routeNo":"999","status":"not_published","label":"OFFICIAL_DATED","asOf":"2026-10-03","freshness":"fresh","date":"2026-10-07",
     "serviceDay":{"date":"2026-10-07","weekday":"wed","publicHoliday":null,"calendarCovered":true},"today":[],"services":[]}
    """#

    /// SYNTHETIC: a demo route's stops standing in for a verified screenshot result.
    private func screenshotProposal(boarding: Int?) -> RouteImportProposal {
        let route = DemoCatalog.outbound
        return RouteImportProposal(
            route: route,
            boarding: boarding.map { route.stops[$0] },
            destination: route.stops[8],
            evidence: boarding == nil ? .destinationOnly : .orderedStops(count: 3),
            score: 90,
            numberWasCorrected: false,
            weakestStopSimilarity: 1
        )
    }

    private func screenshotImport(_ state: ScreenshotImportState) -> AnyView {
        AnyView(MapImportContent(
            place: nil,
            screenshot: AnyView(ScreenshotImportContent(state: state, picker: AnyView(pastePlaceholder), anotherPicker: AnyView(pastePlaceholder))),
            paste: AnyView(pastePlaceholder),
            onChooseDemo: { _ in },
            onSearch: {}
        ))
    }

    private var pastePlaceholder: some View {
        Label("Paste", systemImage: "doc.on.clipboard")
            .buttonStyleLike()
    }

    private func sampleLibrary() -> JourneyLibrary {
        var library = JourneyLibrary()
        let route = DemoCatalog.outbound
        let date = DemoFixtures.referenceDate
        let favorite = SavedJourney(route: route, boarding: route.stops[0].stop, destination: route.stops[4].stop, at: date)
        library.recordRide(favorite, at: date)
        library.toggleFavorite(id: favorite.id)
        library.recordRide(SavedJourney(route: route, boarding: route.stops[0].stop, destination: route.stops[8].stop, at: date), at: date.addingTimeInterval(60))
        return library
    }

    private func check(_ check: VehicleCheck) -> AnyView {
        AnyView(VehicleCheckContent(
            check: check,
            routeNumber: "365",
            boardingName: "제주버스터미널",
            destinationName: "제주시청(아라방면)",
            onConfirm: { _ in },
            onReject: { _ in }
        ))
    }

    private func ride(
        _ phase: JourneyState,
        _ remaining: Int,
        freshness: DataFreshness = .fresh,
        passed: Bool = false,
        offline: Bool = false,
        resumed: Bool = false,
        liveActivityOff: Bool = false,
        rescue: PassedStopAdvice? = nil,
        kakaoAvailable: Bool = false
    ) -> AnyView {
        let guidance = RideGuidancePolicy.guidance(for: RideSignal(
            phase: phase, remainingStops: remaining, freshness: freshness, destinationPassed: passed, isOffline: offline
        ))
        let names = DemoCatalog.outbound.stops.map(\.stop.name)
        let current = max(0, 8 - remaining)
        return AnyView(RideContent(
            snapshot: RideSnapshot(
                guidance: guidance,
                routeNumber: "365",
                destinationName: names[8],
                remainingStops: remaining,
                totalStops: 8,
                currentStopName: names[min(current, 8)],
                upcomingStops: current < 8 ? Array(names[(current + 1)...8]) : [],
                plate: attributes.vehiclePlate,
                liveActivityUnavailable: liveActivityOff,
                resumed: resumed,
                rescue: rescue,
                kakaoAvailable: kakaoAvailable
            ),
            onFinish: {},
            onMapSearch: { _ in },
            onDismissResume: {}
        ))
    }

    /// SYNTHETIC: a place as KakaoMap's share text would describe it (`MAP_HANDOFF_V3.md`).
    private var sharedPlace: SharedPlace {
        SharedPlace(
            source: .kakaoMap,
            name: "협재해수욕장",
            address: "제주특별자치도 제주시 한림읍 협재리 2497-1",
            coordinate: Coordinate(latitude: 33.3940, longitude: 126.2397)
        )
    }

    /// SYNTHETIC: a passed stop whose next stop is 440 m from the destination in a straight
    /// line, as surveyed coordinates would measure it. The demo's own coordinates are never measured.
    private var walkBackAdvice: PassedStopAdvice {
        let exit = DemoCatalog.outbound.stops[9]
        return PassedStopAdvice(
            exitStop: exit,
            straightLineMeters: 440,
            plan: Rescue.plan(RescueInput(kind: .passedDestination, nextStopName: exit.stop.name, walkBackMeters: 440))
        )
    }

    /// SYNTHETIC: two variants of a route number at 21:30 on a weekday in Jeju.
    private var returnRows: [ReturnServiceRow] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = LastBus.timeZone
        let evening = calendar.date(from: DateComponents(year: 2026, month: 10, day: 1, hour: 21, minute: 30))!
        let way = TransitAPIRoute(routeId: "SYN-202-W", routeNumber: "202", startStopName: "제주버스터미널", endStopName: "협재")
        let back = TransitAPIRoute(routeId: "SYN-202-E", routeNumber: "202", startStopName: "협재", endStopName: "제주버스터미널")
        return [
            ReturnServiceRow(
                route: way,
                advice: LastBus.advice(for: TransitAPIRouteServiceHours(routeId: way.routeId, firstDeparture: "06:00", lastDeparture: "22:30", headwayMinutes: .init(weekday: 30)), now: evening),
                ridden: true
            ),
            ReturnServiceRow(
                route: back,
                advice: LastBus.advice(for: TransitAPIRouteServiceHours(routeId: back.routeId, firstDeparture: "06:10", lastDeparture: "21:50", headwayMinutes: .init(weekday: 30)), now: evening),
                ridden: false
            ),
        ]
    }

    private func end(_ moment: RideMoment) -> AnyView {
        AnyView(RideEndContent(
            outcome: RideOutcome(moment: moment, routeNumber: "365", destination: DemoCatalog.outbound.stops[8].stop),
            naverAvailable: true,
            kakaoAvailable: false,
            handoffFailed: nil,
            onMap: { _ in },
            onDone: {}
        ))
    }

    private func state(
        _ phase: JourneyState,
        _ remaining: Int,
        freshness: DataFreshness = .fresh,
        passed: Bool = false,
        offline: Bool = false
    ) -> TapsoActivityAttributes.ContentState {
        TapsoActivityAttributes.ContentState(
            phase: phase,
            currentStopName: "동문로터리",
            // Past the stop, the ride names where to get off (`PassedStopRescue`).
            nextStopName: passed ? "국립제주박물관" : "제주여자상업고등학교",
            remainingStops: remaining,
            freshness: freshness,
            updatedAt: DemoFixtures.referenceDate,
            destinationPassed: passed,
            isOffline: offline
        )
    }

    private func render(
        in directory: URL,
        _ view: AnyView,
        name: String,
        width: CGFloat,
        scheme: ColorScheme,
        typeSize: DynamicTypeSize = .large,
        background: Color? = nil
    ) throws {
        let content = view
            .frame(width: width)
            .background(background ?? TapsoColor.backgroundPrimary)
            .environment(\.colorScheme, scheme)
            .environment(\.dynamicTypeSize, typeSize)
        let renderer = ImageRenderer(content: content)
        renderer.scale = 2
        renderer.proposedSize = ProposedViewSize(width: width, height: nil)
        let data = try XCTUnwrap(renderer.uiImage?.pngData(), "\(name) rendered")
        try data.write(to: directory.appendingPathComponent("\(name).png"))
    }
}

private extension View {
    func buttonStyleLike() -> some View {
        font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(Color.black, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// The compact island: leading and trailing either side of the camera cut-out.
private struct ReturnIslandCompactMock: View {
    let attributes: TapsoReturnAttributes
    let state: TapsoReturnAttributes.ContentState
    let isStale: Bool

    var body: some View {
        HStack(spacing: 0) {
            ReturnIslandCompactLeading(attributes: attributes, isStale: isStale)
                .padding(.leading, 10)
            Spacer(minLength: 126)
            ReturnIslandCompactTrailing(state: state, isStale: isStale)
                .padding(.trailing, 10)
        }
        .frame(height: 37)
        .background(Color.black, in: Capsule())
        .padding(12)
    }
}

private struct ReturnIslandExpandedMock: View {
    let attributes: TapsoReturnAttributes
    let state: TapsoReturnAttributes.ContentState
    let isStale: Bool

    var body: some View {
        VStack(spacing: 8) {
            HStack(alignment: .top) {
                ReturnIslandExpandedLeading(attributes: attributes, isStale: isStale)
                Spacer()
                ReturnIslandExpandedTrailing(state: state, isStale: isStale)
            }
            ReturnIslandExpandedBottom(attributes: attributes, isStale: isStale)
        }
        .padding(16)
        .background(Color.black, in: RoundedRectangle(cornerRadius: 44, style: .continuous))
        .padding(12)
    }
}

private struct IslandCompactMock: View {
    let attributes: TapsoActivityAttributes
    let state: TapsoActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        HStack(spacing: 0) {
            IslandCompactLeading(attributes: attributes, state: state, isStale: isStale)
                .padding(.leading, 10)
            Spacer(minLength: 126)
            IslandCompactTrailing(state: state, isStale: isStale)
                .padding(.trailing, 10)
        }
        .frame(height: 37)
        .background(Color.black, in: Capsule())
        .padding(12)
    }
}

private struct IslandMinimalMock: View {
    let state: TapsoActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        IslandMinimal(state: state, isStale: isStale)
            .frame(width: 37, height: 37)
            .background(Color.black, in: Circle())
            .padding(10)
    }
}

/// The expanded island: leading, centre and trailing on top, bottom beneath.
private struct IslandExpandedMock: View {
    let attributes: TapsoActivityAttributes
    let state: TapsoActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        VStack(spacing: 8) {
            HStack(alignment: .top) {
                IslandExpandedLeading(attributes: attributes, state: state, isStale: isStale)
                Spacer()
                IslandExpandedCenter(state: state, isStale: isStale)
                Spacer()
                IslandExpandedTrailing(state: state, isStale: isStale)
            }
            IslandExpandedBottom(attributes: attributes, state: state, isStale: isStale)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Color.black, in: RoundedRectangle(cornerRadius: 44, style: .continuous))
        .padding(8)
    }
}
