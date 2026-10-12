import Foundation
import XCTest
@testable import TapsoTransit

/// Release validation of the hybrid engine (`BOARDING_ANCHOR_POSITION_V2.md`): reason strings that
/// no other test asserts, reordered official reads, and synthetic dense, loop and curved variants.
/// SYNTHETIC coordinates throughout; none are Jeju geometry or recordings of any rider.
extension HybridPositionEngineTests {
    func official(_ sequence: Int, destination: Int = 8, freshness: DataFreshness = .fresh) -> RideSignal {
        let remaining = max(0, destination - sequence)
        let phase: JourneyState = switch remaining {
        case 0: .arrived
        case 1: .nextStopIsDestination
        case 2: .approachingDestination
        default: .active
        }
        return RideSignal(phase: phase, remainingStops: remaining, freshness: freshness)
    }

    func at(_ seconds: Double) -> Date { start.addingTimeInterval(seconds) }

    /// SYNTHETIC: a straight north-bound route whose stops are `spacing` degrees of latitude apart.
    func straightRoute(stops count: Int, spacing: Double) -> TransitRoute {
        TransitRoute(id: "synthetic-straight", number: "TEST", direction: .outbound, originName: "A", destinationName: "Z",
                     stops: (1...count).map { index in
            RouteStop(stop: Stop(id: StopID(rawValue: "d\(index)"), name: "D\(index)",
                                coordinate: Coordinate(latitude: 33 + Double(index - 1) * spacing, longitude: 126)), sequence: index)
        })
    }

    func route(_ coordinates: [(Double, Double)]) -> TransitRoute {
        TransitRoute(id: "synthetic-shape", number: "TEST", direction: .outbound, originName: "A", destinationName: "Z",
                     stops: coordinates.enumerated().map { offset, point in
            RouteStop(stop: Stop(id: StopID(rawValue: "c\(offset + 1)"), name: "C\(offset + 1)",
                                coordinate: Coordinate(latitude: point.0, longitude: point.1)), sequence: offset + 1)
        })
    }

    // MARK: Official evidence: age, jumps and reordering

    func testFreshFlaggedButOldEvidenceIsNotStrong() {
        var value = engine()
        seed(&value)
        // The server calls it fresh, but the evidence is 40 s old: the age alone demotes it.
        let old = value.evaluate(official: official(2), sequence: 2, evidenceAt: at(5),
                                 selectedVehicleID: "bus", device: nil, now: at(45))
        XCTAssertEqual(old.state, .lost)
        XCTAssertEqual(old.reason, "no_usable_device_geometry")
        XCTAssertEqual(old.currentStopSequence, 1, "a demoted read moves nothing")
        // Long after the last strong evidence, even a good device fix cannot speak for the bus.
        let expired = value.evaluate(official: official(2), sequence: 2, evidenceAt: at(5),
                                     selectedVehicleID: "bus", device: sample(200, latitude: 33.001), now: at(200))
        XCTAssertEqual(expired.state, .lost)
        XCTAssertEqual(expired.reason, "association_expired")
    }

    func testImplausibleOfficialJumpFailsClosed() {
        var value = engine()
        seed(&value)
        // Three stops in 10 s: the engine assumes at least 8 s a stop (ASSUMPTION, not measured).
        let jump = value.evaluate(official: official(4), sequence: 4, evidenceAt: at(10),
                                  selectedVehicleID: "bus", device: nil, now: at(10))
        XCTAssertEqual(jump.state, .lost)
        XCTAssertEqual(jump.reason, "official_implausible_jump")
        XCTAssertEqual(jump.currentStopSequence, 1)
        // The same three stops at exactly 24 s are accepted (the bound is inclusive).
        let plausible = value.evaluate(official: official(4), sequence: 4, evidenceAt: at(24),
                                       selectedVehicleID: "bus", device: nil, now: at(24))
        XCTAssertEqual(plausible.state, .live)
        XCTAssertEqual(plausible.currentStopSequence, 4)
    }

    func testOlderEvidenceAfterNewerIsIgnoredAsAStaleReorderedRead() {
        var value = engine()
        XCTAssertEqual(value.evaluate(official: official(3), sequence: 3, evidenceAt: at(20),
                                      selectedVehicleID: "bus", device: nil, now: at(20)).state, .live)
        // The same evidence again (same age, same stop) is an ordinary repeated read.
        let repeated = value.evaluate(official: official(3), sequence: 3, evidenceAt: at(20),
                                      selectedVehicleID: "bus", device: nil, now: at(22))
        XCTAssertEqual(repeated.state, .live)
        XCTAssertEqual(repeated.reason, "consistent_official")
        XCTAssertEqual(repeated.validUntil, at(50), "freshness is never extended")
        // Same stop, older evidence: it must not re-anchor the association clock backward.
        let sameStop = value.evaluate(official: official(3), sequence: 3, evidenceAt: at(0),
                                      selectedVehicleID: "bus", device: nil, now: at(25))
        XCTAssertEqual(sameStop.state, .lost)
        XCTAssertEqual(sameStop.reason, "official_stale_reordered")
        XCTAssertEqual(sameStop.currentStopSequence, 3)
        // A lower stop with older evidence is a reordered read, not a backward move.
        let lower = value.evaluate(official: official(2), sequence: 2, evidenceAt: at(12),
                                   selectedVehicleID: "bus", device: nil, now: at(26))
        XCTAssertEqual(lower.reason, "official_stale_reordered")
        XCTAssertNotEqual(lower.reason, "official_backward_conflict")
        XCTAssertEqual(lower.currentStopSequence, 3, "fail closed: a stale read advances or regresses nothing")
        // The association window still runs from the newest evidence (t=20): at t=190 it holds,
        // which it would not had the older reads moved it back to t=0.
        let associated = value.evaluate(official: nil, sequence: nil, evidenceAt: nil,
                                        selectedVehicleID: "bus", device: sample(190, latitude: 33.002), now: at(190))
        XCTAssertEqual(associated.state, .predicted)
        XCTAssertNotEqual(associated.reason, "association_expired")
    }

    // MARK: Device evidence reasons

    func testOutOfOrderDeviceSampleFailsClosed() {
        var value = engine(verified: true)
        seed(&value, gps: sample(0))
        XCTAssertNotEqual(delayed(&value, at: 15, gps: sample(15, latitude: 33.0005)).state, .lost)
        let result = delayed(&value, at: 16, gps: sample(10, latitude: 33.0006))
        XCTAssertEqual(result.state, .lost)
        XCTAssertEqual(result.reason, "out_of_order_device_sample")
    }

    func testGPSJumpIsNamed() {
        var value = engine(verified: true)
        seed(&value, gps: sample(0))
        let result = delayed(&value, at: 1, gps: sample(1, latitude: 33.007))
        XCTAssertEqual(result.state, .lost)
        XCTAssertEqual(result.reason, "gps_jump")
        XCTAssertEqual(result.currentStopSequence, 1)
    }

    // MARK: Opposite-side pole and wrong-direction bus

    func testOppositePoleWithinAnchorRadiusIsNotFlagged() {
        // The engine's limit, documented: a rider at the opposite pole, about 30 m across the road,
        // is well inside the 1 km anchor radius. Only the catalog's exact pole (`BoardingAnchor`)
        // and a device run (§12) can catch this; the engine cannot.
        var value = HybridPositionEngine(vehicleID: "bus", route: sparseRoute, destinationSequence: 6, surveyed: true, boardingSequence: 4)
        let acrossTheRoad = sample(0, latitude: 33.06, longitude: 126.000322)
        let result = value.evaluate(official: official(1, destination: 6), sequence: 1, evidenceAt: start,
                                    selectedVehicleID: "bus", device: acrossTheRoad, now: start)
        XCTAssertEqual(result.state, .live)
        XCTAssertEqual(result.reason, "consistent_official")
    }

    func testOppositeDirectionBusAfterBoardingFailsClosed() {
        var value = HybridPositionEngine(vehicleID: "bus", route: route, destinationSequence: 8, surveyed: true, boardingSequence: 4)
        let boarded = value.evaluate(official: official(4), sequence: 4, evidenceAt: start,
                                     selectedVehicleID: "bus", device: sample(0, latitude: 33.003), now: start)
        XCTAssertEqual(boarded.state, .live)
        // The phone moves the other way along the corridor: the rider is on a bus going the wrong way.
        let result = delayed(&value, at: 15, gps: sample(15, latitude: 33.0025, speed: 8, course: 180))
        XCTAssertEqual(result.state, .lost)
        XCTAssertEqual(result.reason, "direction_conflict")
        XCTAssertEqual(result.signal(at: at(15)).phase, .vehicleRecovery, "no estimate")
    }

    // MARK: Dense, loop and curved variants

    func testDenseStopsNeverSkipAStopOnInaccurateFixes() {
        // Poles about 30 m apart, fixes at 45 m: one fix can be "near" two poles at once.
        let spacing = 0.00027
        let dense = straightRoute(stops: 14, spacing: spacing)
        var value = HybridPositionEngine(vehicleID: "bus", route: dense, destinationSequence: 14, surveyed: true)
        XCTAssertEqual(value.evaluate(official: official(1, destination: 14), sequence: 1, evidenceAt: start,
                                      selectedVehicleID: "bus", device: sample(0, accuracy: 45), now: start).state, .live)
        var previous = 1
        for step in 1...20 {
            let seconds = Double(step) * 5
            // About 30 m every 5 s (6 m/s): one pole per sample.
            let latitude = 33 + Double(step) * spacing
            let result = value.evaluate(official: nil, sequence: nil, evidenceAt: nil, selectedVehicleID: "bus",
                                        device: sample(seconds, latitude: latitude, accuracy: 45, speed: 6, course: 0), now: at(seconds))
            let current = result.currentStopSequence ?? previous
            XCTAssertLessThanOrEqual(current - previous, 1, "skipped a stop at t=\(seconds)")
            XCTAssertGreaterThanOrEqual(current, previous, "moved backward at t=\(seconds)")
            XCTAssertLessThanOrEqual(current, step + 1, "ahead of the poles the phone has passed at t=\(seconds)")
            previous = current
        }
    }

    func testLoopVariantFailsClosedAtEngineLevel() {
        // A variant that returns past its own poles: stop 4 stands where stop 2 does, stop 5 where stop 1 does.
        let loop = route([(33.000, 126.000), (33.002, 126.000), (33.004, 126.000), (33.002, 126.000),
                          (33.000, 126.000), (33.000, 126.002), (33.000, 126.004), (33.000, 126.006)])
        var value = HybridPositionEngine(vehicleID: "bus", route: loop, destinationSequence: 8, surveyed: true)
        let seeded = value.evaluate(official: official(2), sequence: 2, evidenceAt: start,
                                    selectedVehicleID: "bus", device: sample(0, latitude: 33.002), now: start)
        XCTAssertEqual(seeded.state, .live, "official progress is unaffected")
        for seconds in [15.0, 25, 35, 45] {
            // The phone sits at the shared pole: it matches two places on the variant.
            let result = value.evaluate(official: nil, sequence: nil, evidenceAt: nil, selectedVehicleID: "bus",
                                        device: sample(seconds, latitude: 33.002), now: at(seconds))
            XCTAssertEqual(result.state, .lost, "t=\(seconds)")
            XCTAssertEqual(result.reason, "no_usable_device_geometry", "t=\(seconds)")
            XCTAssertEqual(result.currentStopSequence, 2, "t=\(seconds)")
        }
    }

    func testCurveChordDeviationFailsClosed() {
        // The chord from stop 1 to stop 2 cuts a right-angle bend; the road runs north, then east.
        let curve = route([(33.000, 126.000), (33.003, 126.0036), (33.003, 126.0072), (33.003, 126.0108),
                           (33.003, 126.0144), (33.003, 126.018)])
        var value = HybridPositionEngine(vehicleID: "bus", route: curve, destinationSequence: 6, surveyed: true)
        XCTAssertEqual(value.evaluate(official: official(1, destination: 6), sequence: 1, evidenceAt: start,
                                      selectedVehicleID: "bus", device: sample(0), now: start).state, .live)
        // On the real road, about 170 m north of stop 1: over 100 m from the chord.
        let result = value.evaluate(official: nil, sequence: nil, evidenceAt: nil, selectedVehicleID: "bus",
                                    device: sample(15, latitude: 33.0015, speed: 8, course: 0), now: at(15))
        XCTAssertEqual(result.state, .lost)
        XCTAssertEqual(result.reason, "route_deviation")
        XCTAssertEqual(result.currentStopSequence, 1)
    }

    // MARK: Destination

    func testStalledAtOneAndZeroRemainingNeverHeldByDevice() {
        for (sequence, latitude) in [(7, 33.006), (8, 33.007)] {
            var value = engine()
            let live = value.evaluate(official: official(sequence), sequence: sequence, evidenceAt: start,
                                      selectedVehicleID: "bus", device: nil, now: start)
            XCTAssertEqual(live.state, .live, "seq \(sequence)")
            // The feed stalls; a good fix at the pole cannot hold the 1- or 0-stop milestone.
            let stalled = value.evaluate(official: official(sequence, freshness: .aging), sequence: sequence, evidenceAt: start,
                                         selectedVehicleID: "bus", device: sample(40, latitude: latitude), now: at(40))
            XCTAssertEqual(stalled.state, .lost, "seq \(sequence)")
            XCTAssertEqual(stalled.reason, "destination_needs_confirmation", "seq \(sequence)")
            XCTAssertEqual(stalled.signal(at: at(40)).phase, .vehicleRecovery, "seq \(sequence)")
            XCTAssertEqual(stalled.usableStopSequence, sequence, "a lost result names only the accepted official stop")
        }
    }

    func testOnlyAUsableResultNamesItsStop() {
        var value = engine()
        let live = seed(&value, sequence: 3)
        XCTAssertEqual(live.usableStopSequence, 3)
        let lost = value.evaluate(official: official(2), sequence: 2, evidenceAt: at(30),
                                  selectedVehicleID: "bus", device: nil, now: at(30))
        XCTAssertEqual(lost.reason, "official_backward_conflict")
        XCTAssertEqual(lost.currentStopSequence, 3, "the engine still holds its count")
        XCTAssertEqual(lost.usableStopSequence, 3, "the accepted official stop, not the refused read")
    }

    func testALostResultNeverNamesARefusedReadAhead() {
        // Five stops in 5 s: refused as a jump (8 s a stop is an ASSUMPTION, not measured).
        var jump = engine()
        seed(&jump, sequence: 2)
        let jumped = jump.evaluate(official: official(7), sequence: 7, evidenceAt: at(5),
                                   selectedVehicleID: "bus", device: nil, now: at(5))
        XCTAssertEqual(jumped.reason, "official_implausible_jump")
        XCTAssertEqual(jumped.officialStopSequence, 2)
        XCTAssertEqual(jumped.usableStopSequence, 2)

        // Another bus's read ahead of the rider's.
        var other = engine()
        seed(&other, sequence: 2)
        let conflict = other.evaluate(official: official(6), sequence: 6, evidenceAt: at(60),
                                      selectedVehicleID: "other-bus", device: nil, now: at(60))
        XCTAssertEqual(conflict.reason, "vehicle_identity_conflict")
        XCTAssertEqual(conflict.usableStopSequence, 2)

        // Nothing official accepted yet: a lost result names nothing.
        var fresh = engine()
        let unseeded = fresh.evaluate(official: official(6), sequence: 6, evidenceAt: start,
                                      selectedVehicleID: "other-bus", device: nil, now: start)
        XCTAssertEqual(unseeded.state, .lost)
        XCTAssertNil(unseeded.usableStopSequence)
    }

    func testAResultSavedBeforeTheOfficialStopExistedStillDecodes() throws {
        var value = engine()
        let live = seed(&value, sequence: 3)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(live)) as? [String: Any])
        object["officialStopSequence"] = nil
        let decoded = try JSONDecoder().decode(HybridRidePosition.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertNil(decoded.officialStopSequence)
        XCTAssertEqual(decoded.usableStopSequence, 3)
    }
}
