import Foundation
import TapsoTransit
import XCTest

/// The Journey Contract's Swift implementation against the language-neutral
/// specification. The server runs the same file in
/// `services/api/test/journeyContract.test.ts`.
final class JourneyContractTests: XCTestCase {
    private struct Spec: Decodable {
        let schemaVersion: String
        let vocabulary: [String: [String]]
        let contractCases: [ContractCase]
        let surfaceCases: [SurfaceCase]
    }

    private struct ContractCase: Decodable {
        let id: String
        let why: String
        let segments: [JourneySegmentSpec]
        let expect: ContractExpectation
    }

    private struct ContractExpectation: Decodable {
        let valid: Bool
        let rideCount: Int?
        let transferCount: Int?
        let error: String?
    }

    private struct SurfaceCase: Decodable {
        let id: String
        let why: String
        let input: SurfaceCaseInput
        let expect: SurfaceExpectation
    }

    private struct SurfaceCaseInput: Decodable {
        let segment: JourneySegmentKind
        let finalLeg: Bool
        let preRide: VehicleCheckStage?
        let rideMoment: RideMoment?
        let transferRisk: TransferRisk?
        let recoveryActive: Bool?
        let discoveryHint: Bool?

        var input: JourneySurfaceInput {
            JourneySurfaceInput(
                segment: segment,
                finalLeg: finalLeg,
                preRide: preRide,
                rideMoment: rideMoment,
                transferRisk: transferRisk,
                recoveryActive: recoveryActive ?? false,
                discoveryHint: discoveryHint ?? false
            )
        }
    }

    private struct SurfaceExpectation: Decodable {
        let state: String
        let action: String
    }

    private func loadSpec() throws -> Spec {
        let repository = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // TapsoTransitTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // transit-core
            .deletingLastPathComponent() // packages
            .deletingLastPathComponent() // repository root
        let url = repository.appendingPathComponent("fixtures/journey/journey-contract-v1.json")
        return try JSONDecoder().decode(Spec.self, from: Data(contentsOf: url))
    }

    func testSpecificationNamesThisVersion() throws {
        XCTAssertEqual(try loadSpec().schemaVersion, JourneyContract.version)
    }

    func testVocabularyMatchesTheSpecificationInOrder() throws {
        let vocabulary = try loadSpec().vocabulary
        XCTAssertEqual(vocabulary["segmentKinds"], JourneySegmentKind.allCases.map(\.rawValue))
        XCTAssertEqual(vocabulary["preRideStages"], VehicleCheckStage.allCases.map(\.rawValue))
        XCTAssertEqual(vocabulary["rideMoments"], RideMoment.allCases.map(\.rawValue))
        XCTAssertEqual(vocabulary["transferRisks"], TransferRisk.allCases.map(\.rawValue))
        XCTAssertEqual(vocabulary["safeReturnLevels"], SafeReturnLevel.allCases.map(\.rawValue))
        XCTAssertEqual(vocabulary["surfaceStates"], JourneySurfaceState.allCases.map(\.rawValue))
        XCTAssertEqual(vocabulary["nextActions"], JourneyNextAction.allCases.map(\.rawValue))
    }

    func testEveryContractCase() throws {
        let cases = try loadSpec().contractCases
        XCTAssertGreaterThanOrEqual(cases.count, 8)
        for contractCase in cases {
            let label = "\(contractCase.id): \(contractCase.why)"
            switch JourneyContract.validate(contractCase.segments) {
            case let .success(shape):
                XCTAssertTrue(contractCase.expect.valid, label)
                XCTAssertEqual(shape.rideCount, contractCase.expect.rideCount, label)
                XCTAssertEqual(shape.transferCount, contractCase.expect.transferCount, label)
            case let .failure(error):
                XCTAssertFalse(contractCase.expect.valid, label)
                XCTAssertEqual(error.rawValue, contractCase.expect.error, label)
            }
        }
    }

    func testEverySurfaceCase() throws {
        let cases = try loadSpec().surfaceCases
        XCTAssertGreaterThanOrEqual(cases.count, 30)
        for surfaceCase in cases {
            let resolved = JourneySurfacePolicy.resolve(surfaceCase.input.input)
            let label = "\(surfaceCase.id): \(surfaceCase.why)"
            XCTAssertEqual(resolved.state.rawValue, surfaceCase.expect.state, label)
            XCTAssertEqual(resolved.action.rawValue, surfaceCase.expect.action, label)
        }
    }

    /// Every combination stays inside the vocabulary, late or uncertain data never
    /// produces a get-off milestone, and discovery never shows while a connection is planned.
    func testResolutionIsTotalAndFailsClosed() {
        let preRides: [VehicleCheckStage?] = [nil] + VehicleCheckStage.allCases.map(Optional.some)
        let moments: [RideMoment?] = [nil] + RideMoment.allCases.map(Optional.some)
        let risks: [TransferRisk?] = [nil] + TransferRisk.allCases.map(Optional.some)
        let uncertain: Set<RideMoment> = [.delayed, .offline, .vehicleLost, .checking]
        let milestones: Set<JourneySurfaceState> = [.prepare, .nextStop, .arrival]
        var combinations = 0
        for segment in JourneySegmentKind.allCases {
            for finalLeg in [false, true] {
                for preRide in preRides {
                    for moment in moments {
                        for risk in risks {
                            for recovery in [false, true] {
                                for hint in [false, true] {
                                    let input = JourneySurfaceInput(
                                        segment: segment,
                                        finalLeg: finalLeg,
                                        preRide: preRide,
                                        rideMoment: moment,
                                        transferRisk: risk,
                                        recoveryActive: recovery,
                                        discoveryHint: hint
                                    )
                                    let resolved = JourneySurfacePolicy.resolve(input)
                                    combinations += 1
                                    if segment == .ride, let moment, uncertain.contains(moment), !recovery {
                                        XCTAssertFalse(milestones.contains(resolved.state), "\(input)")
                                    }
                                    if resolved.state == .discovery {
                                        XCTAssertTrue(finalLeg, "\(input)")
                                        XCTAssertEqual(moment, .riding, "\(input)")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        XCTAssertEqual(combinations, 3 * 2 * 7 * 11 * 7 * 2 * 2)
    }
}
