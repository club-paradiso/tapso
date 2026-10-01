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
            ("30-ride-passed-walk-back", ride(.arrived, 0, passed: true, rescue: walkBackAdvice, kakaoAvailable: true))
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
    }

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
