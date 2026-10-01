import Foundation
import TapsoTransit
import XCTest

/// The Jeju safety layer against its language-neutral specifications. The
/// server runs the same files in `services/api/test/journeySafety.test.ts`.
final class JourneySafetyTests: XCTestCase {
    private struct Spec<Input: Decodable, Expectation: Decodable>: Decodable {
        let policy: [String: Double]
        let cases: [Case<Input, Expectation>]
    }

    private struct Case<Input: Decodable, Expectation: Decodable>: Decodable {
        let id: String
        let why: String
        let input: Input
        let expect: Expectation
    }

    private func load<Input: Decodable, Expectation: Decodable>(
        _ name: String,
        as _: Spec<Input, Expectation>.Type
    ) throws -> Spec<Input, Expectation> {
        let repository = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let url = repository.appendingPathComponent("fixtures/journey/\(name)")
        return try JSONDecoder().decode(Spec<Input, Expectation>.self, from: Data(contentsOf: url))
    }

    func testSafeReturnSpecification() throws {
        let spec = try load("safe-return-v1.json", as: Spec<SafeReturnInput, SafeReturnStatus>.self)
        let policy = SafeReturnPolicy.standard
        XCTAssertEqual(spec.policy, [
            "safetyMarginMinutes": policy.safetyMarginMinutes,
            "comfortableSlackMinutes": policy.comfortableSlackMinutes,
            "tightSlackMinutes": policy.tightSlackMinutes,
            "longWaitMinutes": policy.longWaitMinutes,
            "estimatedDataMaxAgeMinutes": policy.estimatedDataMaxAgeMinutes,
        ])
        XCTAssertGreaterThanOrEqual(spec.cases.count, 14)
        for specCase in spec.cases {
            XCTAssertEqual(SafeReturn.evaluate(specCase.input), specCase.expect, "\(specCase.id): \(specCase.why)")
        }
    }

    func testTransferGuardianSpecification() throws {
        let spec = try load("transfer-guardian-v1.json", as: Spec<TransferInput, TransferAssessment>.self)
        let policy = TransferGuardianPolicy.standard
        XCTAssertEqual(spec.policy, [
            "safeMarginMinutes": policy.safeMarginMinutes,
            "longWaitMinutes": policy.longWaitMinutes,
        ])
        XCTAssertGreaterThanOrEqual(spec.cases.count, 12)
        for specCase in spec.cases {
            XCTAssertEqual(TransferGuardian.assess(specCase.input), specCase.expect, "\(specCase.id): \(specCase.why)")
        }
    }

    func testRescueSpecification() throws {
        let spec = try load("rescue-v1.json", as: Spec<RescueInput, RescuePlan>.self)
        let policy = RescuePolicy.standard
        XCTAssertEqual(spec.policy, [
            "walkingMetersPerMinute": policy.walkingMetersPerMinute,
            "maxWalkBackMeters": policy.maxWalkBackMeters,
            "comfortableWalkMinutes": policy.comfortableWalkMinutes,
            "longWaitMinutes": policy.longWaitMinutes,
        ])
        XCTAssertGreaterThanOrEqual(spec.cases.count, 12)
        for specCase in spec.cases {
            XCTAssertEqual(Rescue.plan(specCase.input), specCase.expect, "\(specCase.id): \(specCase.why)")
        }
    }

    /// No useful visit followed by a catchable bus means no recommendation, whatever else is true.
    func testSafeReturnNeverRecommendsATripWithoutAWayBack() {
        var generator = SplitMix64(seed: 20_261_001)
        for _ in 0..<5_000 {
            let arrival = Double(generator.next() % 300)
            let minimumStay = Double(10 + generator.next() % 180)
            let walk = Double(generator.next() % 20)
            let count = Int(generator.next() % 8)
            let departures = (0..<count).map { _ in Double(generator.next() % 720) }
            let status = SafeReturn.evaluate(SafeReturnInput(
                arrival: arrival,
                minimumStay: minimumStay,
                walkToReturnStop: walk,
                departures: departures,
                quality: .scheduled,
                disruption: generator.next() % 5 == 0
            ))
            let margin = SafeReturnPolicy.standard.safetyMarginMinutes
            let wayBack = departures.contains { $0 - walk - margin >= arrival + minimumStay }
            if wayBack {
                XCTAssertNotEqual(status.level, .notRecommended)
            } else {
                XCTAssertEqual(status.level, .notRecommended)
                XCTAssertFalse(status.allowsRecommendation)
            }
            XCTAssertNotEqual(status.level, .unknown, "a complete scheduled list always gets an answer")
        }
    }

    func testRescueAlwaysEndsWithAMapHandOff() {
        for kind in RescueKind.allCases {
            for meters in [nil, 0, 500, 1_200, 1_201, 5_000] as [Double?] {
                for opposite in [false, true] {
                    let plan = Rescue.plan(RescueInput(
                        kind: kind,
                        nextStopName: "곽지",
                        walkBackMeters: meters,
                        oppositeDirection: opposite,
                        nextConnectionWaitMinutes: 20
                    ))
                    XCTAssertEqual(plan.options.last?.action, .openMapApp)
                    let walks = plan.options.contains { $0.action == .walkBack }
                    if kind != .passedDestination || meters == nil || (meters ?? 0) > RescuePolicy.standard.maxWalkBackMeters {
                        XCTAssertFalse(walks)
                    }
                }
            }
        }
    }
}

/// A small deterministic generator, so property runs are reproducible.
private struct SplitMix64 {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var value = state
        value = (value ^ (value >> 30)) &* 0xBF58_476D_1CE4_E5B9
        value = (value ^ (value >> 27)) &* 0x94D0_49BB_1331_11EB
        return value ^ (value >> 31)
    }
}
