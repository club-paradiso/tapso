import XCTest
import TapsoTransit
@testable import Tapso

/// A ride long enough that no state in this file is still waiting for its bus.
private let testRideLength = 30

final class TapsoActivityAttributesTests: XCTestCase {
    func testContentStateRoundTripsThroughJSON() throws {
        let state = TapsoActivityAttributes.ContentState(
            phase: .approachingDestination,
            currentStopName: "동문로터리",
            nextStopName: "제주여자상업고등학교",
            remainingStops: 2,
            freshness: .fresh,
            updatedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )

        let data = try JSONEncoder().encode(state)
        XCTAssertEqual(try JSONDecoder().decode(TapsoActivityAttributes.ContentState.self, from: data), state)
        XCTAssertLessThan(data.count, 4_096)
    }

    /// The server's APNs payload (`services/api/src/apns.ts`, committed as the
    /// SYNTHETIC fixture `fixtures/transit/live-activity-push.json`) decodes as
    /// this app's content state the way ActivityKit decodes `content-state`:
    /// `JSONDecoder` defaults, so a date is seconds since 2001-01-01.
    func testServerPushContentStateDecodesAsTheAppsContentState() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("fixtures/transit/live-activity-push.json")
        let fixture = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        XCTAssertEqual(fixture["synthetic"] as? Bool, true)
        let aps = try XCTUnwrap((fixture["body"] as? [String: Any])?["aps"] as? [String: Any])
        let contentState = try JSONSerialization.data(withJSONObject: try XCTUnwrap(aps["content-state"]))
        let state = try JSONDecoder().decode(TapsoActivityAttributes.ContentState.self, from: contentState)
        XCTAssertEqual(state.phase, .approachingDestination)
        XCTAssertEqual(state.remainingStops, 2)
        XCTAssertEqual(state.freshness, .fresh)
        XCTAssertEqual(state.updatedAt, Date(timeIntervalSince1970: TimeInterval(try XCTUnwrap(aps["timestamp"] as? Int))))
        XCTAssertEqual(state.guidance(rideLength: testRideLength).milestone, .prepare)
    }

    func testDemoTimelineEndsAtDestination() {
        XCTAssertEqual(DemoFixtures.demoTimeline().count, 9)
        XCTAssertEqual(DemoFixtures.demoTimeline().last?.confirmedStopID, DemoFixtures.plan.destinationStopID)
    }

    func testMilestonesEscalateRelevanceTowardArrival() {
        let active = makeState(phase: .active, remainingStops: 8)
        let prepare = makeState(phase: .approachingDestination, remainingStops: 2)
        let next = makeState(phase: .nextStopIsDestination, remainingStops: 1)
        let arrived = makeState(phase: .arrived, remainingStops: 0)

        XCTAssertNil(TapsoLiveActivityPolicy.milestone(for: active, rideLength: testRideLength))
        XCTAssertEqual(TapsoLiveActivityPolicy.milestone(for: prepare, rideLength: testRideLength), .prepare)
        XCTAssertEqual(TapsoLiveActivityPolicy.milestone(for: next, rideLength: testRideLength), .nextStop)
        XCTAssertEqual(TapsoLiveActivityPolicy.milestone(for: arrived, rideLength: testRideLength), .arrived)
        XCTAssertLessThan(
            TapsoLiveActivityPolicy.relevanceScore(for: active, rideLength: testRideLength),
            TapsoLiveActivityPolicy.relevanceScore(for: arrived, rideLength: testRideLength)
        )
        XCTAssertNil(TapsoLiveActivityPolicy.staleDate(for: arrived, rideLength: testRideLength))
    }

    func testInconsistentMilestoneFailsClosedWithoutAlert() {
        let inconsistentNext = makeState(
            phase: .nextStopIsDestination,
            remainingStops: 2
        )
        let prematureArrival = makeState(
            phase: .arrived,
            remainingStops: 1
        )

        XCTAssertEqual(
            TapsoLiveActivityPolicy.displayPhase(for: inconsistentNext, rideLength: testRideLength),
            .checking
        )
        XCTAssertEqual(
            TapsoLiveActivityPolicy.displayPhase(for: prematureArrival, rideLength: testRideLength),
            .checking
        )
        XCTAssertNil(TapsoLiveActivityPolicy.milestone(for: inconsistentNext, rideLength: testRideLength))
        XCTAssertNil(TapsoLiveActivityPolicy.milestone(for: prematureArrival, rideLength: testRideLength))
    }

    func testStaleNextStopSuppressesGetOffAlert() {
        let staleNext = makeState(
            phase: .nextStopIsDestination,
            remainingStops: 1,
            freshness: .stale
        )

        XCTAssertEqual(TapsoLiveActivityPolicy.displayPhase(for: staleNext, rideLength: testRideLength), .delayed)
        XCTAssertNil(TapsoLiveActivityPolicy.milestone(for: staleNext, rideLength: testRideLength))
        XCTAssertGreaterThan(
            TapsoLiveActivityPolicy.relevanceScore(for: staleNext, rideLength: testRideLength),
            TapsoLiveActivityPolicy.relevanceScore(
                for: makeState(phase: .active, remainingStops: 8),
                rideLength: testRideLength
            )
        )
    }

    func testStaleArrivalSuppressesArrivalAlert() {
        let staleArrival = makeState(
            phase: .arrived,
            remainingStops: 0,
            freshness: .stale
        )

        XCTAssertEqual(TapsoLiveActivityPolicy.displayPhase(for: staleArrival, rideLength: testRideLength), .delayed)
        XCTAssertNil(TapsoLiveActivityPolicy.milestone(for: staleArrival, rideLength: testRideLength))
        XCTAssertNotNil(TapsoLiveActivityPolicy.staleDate(for: staleArrival, rideLength: testRideLength))
    }

    func testUnknownFreshnessUsesCheckingPresentation() {
        let unknown = makeState(
            phase: .active,
            remainingStops: 8,
            freshness: .unknown
        )

        XCTAssertEqual(TapsoLiveActivityPolicy.displayPhase(for: unknown, rideLength: testRideLength), .checking)
        XCTAssertNil(TapsoLiveActivityPolicy.milestone(for: unknown, rideLength: testRideLength))
    }

    func testCombinedActivityPayloadStaysBelowActivityKitLimit() throws {
        struct Payload: Encodable {
            let attributes: TapsoActivityAttributes
            let state: TapsoActivityAttributes.ContentState
        }
        let payload = Payload(
            attributes: TapsoActivityAttributes(
                routeNumber: "365",
                routeID: "demo-route-365-outbound",
                boardingStopName: "제주버스터미널",
                destinationName: "제주시청(아라방면)",
                totalStops: 8
            ),
            state: makeState(phase: .approachingDestination, remainingStops: 2)
        )
        XCTAssertLessThan(try JSONEncoder().encode(payload).count, 4_096)
    }

    private func makeState(
        phase: JourneyState,
        remainingStops: Int,
        freshness: DataFreshness = .fresh
    ) -> TapsoActivityAttributes.ContentState {
        TapsoActivityAttributes.ContentState(
            phase: phase,
            currentStopName: "동문로터리",
            nextStopName: "제주여자상업고등학교",
            remainingStops: remainingStops,
            freshness: freshness,
            updatedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }
}
