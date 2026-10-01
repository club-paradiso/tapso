import Foundation
import TapsoTransit
import XCTest

/// After the bus passes the rider's stop: where to get off, and the way back.
/// Every route below is SYNTHETIC: stops on a straight north–south line in Jeju
/// City, 0.002° (≈222 m) apart, named for the test only.
final class PassedStopRescueTests: XCTestCase {
    private func stop(_ sequence: Int, latitude: Double, id: String? = nil) -> RouteStop {
        RouteStop(
            stop: Stop(
                id: StopID(rawValue: id ?? "SYN\(sequence)"),
                name: "합성정류장\(sequence)",
                coordinate: Coordinate(latitude: latitude, longitude: 126.5300)
            ),
            sequence: sequence
        )
    }

    private func route(_ stops: [RouteStop]) -> TransitRoute {
        TransitRoute(id: "SYN-ROUTE", number: "000", direction: .unknown, originName: "합성기점", destinationName: "합성종점", stops: stops)
    }

    private var line: TransitRoute {
        route((1...6).map { stop($0, latitude: 33.5000 + Double($0) * 0.002) })
    }

    func testTheExitIsTheStopAfterTheBusAndTheWalkBackIsAStraightLine() {
        let advice = PassedStopRescue.advice(route: line, destinationSequence: 3, busSequence: 4, coordinatesAreSurveyed: true)
        XCTAssertEqual(advice.exitStop?.sequence, 5, "the bus was placed at 4; whether it is still there is unknown")
        XCTAssertEqual(advice.straightLineMeters, 440)
        XCTAssertEqual(advice.plan.exitAt, "합성정류장5")
        XCTAssertEqual(advice.plan.options.map(\.action), [.walkBack, .openMapApp])
        XCTAssertFalse(advice.walkTooFar)
    }

    func testTheExitIsAlwaysPastTheDestinationEvenIfTheBusReadsBehindIt() {
        let advice = PassedStopRescue.advice(route: line, destinationSequence: 3, busSequence: 2, coordinatesAreSurveyed: true)
        XCTAssertEqual(advice.exitStop?.sequence, 4)
        XCTAssertEqual(advice.straightLineMeters, 220)
    }

    func testAtTheEndOfTheLineTheBusesOwnStopIsTheExit() {
        let advice = PassedStopRescue.advice(route: line, destinationSequence: 3, busSequence: 6, coordinatesAreSurveyed: true)
        XCTAssertEqual(advice.exitStop?.sequence, 6)
        XCTAssertEqual(advice.straightLineMeters, 670)
    }

    func testABusOffTheEndOfTheListNamesNoStop() {
        let advice = PassedStopRescue.advice(route: line, destinationSequence: 3, busSequence: 9, coordinatesAreSurveyed: true)
        XCTAssertNil(advice.exitStop)
        XCTAssertNil(advice.straightLineMeters)
        XCTAssertNil(advice.plan.exitAt)
        XCTAssertEqual(advice.plan.options.map(\.action), [.openMapApp])
    }

    func testAnUnknownBusPositionLeavesOnlyTheMapApp() {
        let advice = PassedStopRescue.advice(route: line, destinationSequence: 3, busSequence: nil, coordinatesAreSurveyed: true)
        XCTAssertNil(advice.exitStop)
        XCTAssertNil(advice.plan.exitAt)
        XCTAssertEqual(advice.plan.options.map(\.action), [.openMapApp])
    }

    func testSyntheticCoordinatesAreNeverMeasured() {
        let advice = PassedStopRescue.advice(route: line, destinationSequence: 3, busSequence: 4, coordinatesAreSurveyed: false)
        XCTAssertEqual(advice.exitStop?.sequence, 5, "the next stop is still known")
        XCTAssertNil(advice.straightLineMeters)
        XCTAssertFalse(advice.walkTooFar)
        XCTAssertEqual(advice.plan.options.map(\.action), [.openMapApp])
    }

    func testAWalkBeyondThePolicyIsMeasuredButNotOffered() {
        var stops = line.stops
        stops[4] = stop(5, latitude: 33.5220)
        let advice = PassedStopRescue.advice(route: route(stops), destinationSequence: 3, busSequence: 4, coordinatesAreSurveyed: true)
        XCTAssertEqual(advice.straightLineMeters, 1_780)
        XCTAssertGreaterThan(Double(advice.straightLineMeters ?? 0), RescuePolicy.standard.maxWalkBackMeters)
        XCTAssertTrue(advice.walkTooFar)
        XCTAssertEqual(advice.plan.options.map(\.action), [.openMapApp])
    }

    func testALoopIsReadBySequenceNotByStopID() {
        // Sequence 7 revisits stop 1 (same id, same coordinate). The exit is found by
        // sequence, so the repeated id can never send the rider back to sequence 1.
        let loop = route(line.stops + [stop(7, latitude: 33.5020, id: "SYN1")])
        let advice = PassedStopRescue.advice(route: loop, destinationSequence: 2, busSequence: 6, coordinatesAreSurveyed: true)
        XCTAssertEqual(advice.exitStop?.sequence, 7)
        XCTAssertEqual(advice.exitStop?.stop.id.rawValue, "SYN1")
        XCTAssertEqual(advice.straightLineMeters, 220)
    }

    func testRidingBackIsNeverOfferedAndTheMapAppIsAlwaysLast() {
        for bus in [nil, 2, 3, 4, 5, 6] as [Int?] {
            for surveyed in [true, false] {
                let advice = PassedStopRescue.advice(route: line, destinationSequence: 3, busSequence: bus, coordinatesAreSurveyed: surveyed)
                XCTAssertFalse(advice.plan.options.contains { $0.action == .rideBack }, "bus \(String(describing: bus)), surveyed \(surveyed)")
                XCTAssertEqual(advice.plan.options.last?.action, .openMapApp)
                if let meters = advice.straightLineMeters {
                    XCTAssertEqual(meters % 10, 0)
                }
            }
        }
    }
}
