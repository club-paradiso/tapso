import Foundation

public enum MatchConfidence: String, Codable, Hashable, Sendable {
    case high
    case medium
    case low
    case unknown
}

public enum MatchEvidenceKind: String, Codable, Hashable, Sendable {
    case exactRoute
    case directionCompatible
    case atBoardingStop
    case approachingBoardingStop
    case justDepartedBoardingStop
    case boardingTimeAligned
    case freshObservation
    case agingObservation
    case headingAligned
    case headingMismatch
    case oneShotLocationAligned
    case plausibleContinuity
    case previousMatchContradicted
}

public struct VehicleMatchEvidence: Codable, Hashable, Sendable {
    public let kind: MatchEvidenceKind
    public let score: Int
    public let explanation: String

    public init(kind: MatchEvidenceKind, score: Int, explanation: String) {
        self.kind = kind
        self.score = score
        self.explanation = explanation
    }
}

public enum CandidateRejectionReason: String, Error, Codable, Hashable, Sendable {
    case noObservations
    case inconsistentVehicleIdentity
    case wrongRoute
    case wrongDirection
    case routeVariantMismatch
    case staleObservation
    case invalidStopOrdering
    case alreadyTooFarPastBoarding
    case implausibleContinuity
}

public struct RejectedVehicleCandidate: Codable, Hashable, Sendable {
    public let vehicleID: VehicleIdentifier
    public let reason: CandidateRejectionReason
}

public struct ScoredVehicleCandidate: Codable, Hashable, Identifiable, Sendable {
    public var id: VehicleIdentifier { vehicleID }
    public let vehicleID: VehicleIdentifier
    public let score: Int
    public let evidence: [VehicleMatchEvidence]
    public let latestObservation: VehicleObservation
}

public struct VehicleMatchResult: Codable, Hashable, Sendable {
    public let selectedVehicle: ScoredVehicleCandidate?
    public let confidence: MatchConfidence
    public let requiresConfirmation: Bool
    public let alternatives: [ScoredVehicleCandidate]
    public let rejectedCandidates: [RejectedVehicleCandidate]
    public let snapshotTimestamp: Date
    public let dataFreshness: DataFreshness
    public let decisionEvidence: [VehicleMatchEvidence]
}

public struct VehicleMatchDebugCandidate: Codable, Hashable, Sendable {
    public let vehicleID: String
    public let score: Int?
    public let evidence: [String]
    public let rejection: String?
}

public struct VehicleMatchDebugRecord: Codable, Hashable, Sendable {
    public let event: String
    public let selectedVehicleID: String?
    public let confidence: String
    public let requiresConfirmation: Bool
    public let freshness: String
    public let candidates: [VehicleMatchDebugCandidate]
}

public extension VehicleMatchResult {
    /// Structured, deterministic development evidence. Callers choose the logger and retention policy.
    var debugRecord: VehicleMatchDebugRecord {
        let scored = alternatives.map {
            VehicleMatchDebugCandidate(
                vehicleID: $0.vehicleID.rawValue,
                score: $0.score,
                evidence: $0.evidence.map { $0.kind.rawValue },
                rejection: nil
            )
        }
        let rejected = rejectedCandidates.map {
            VehicleMatchDebugCandidate(
                vehicleID: $0.vehicleID.rawValue,
                score: nil,
                evidence: [],
                rejection: $0.reason.rawValue
            )
        }
        return VehicleMatchDebugRecord(
            event: selectedVehicle == nil ? "vehicle_match_confirmation_required" : "vehicle_match_selected",
            selectedVehicleID: selectedVehicle?.vehicleID.rawValue,
            confidence: confidence.rawValue,
            requiresConfirmation: requiresConfirmation,
            freshness: dataFreshness.rawValue,
            candidates: scored + rejected
        )
    }
}

public struct VehicleMatchingInput: Sendable {
    public let plan: RidePlan
    public let route: TransitRoute
    public let boarding: BoardingContext
    public let candidates: [VehicleCandidate]
    public let now: Date

    public init(
        plan: RidePlan,
        route: TransitRoute,
        boarding: BoardingContext,
        candidates: [VehicleCandidate],
        now: Date
    ) {
        self.plan = plan
        self.route = route
        self.boarding = boarding
        self.candidates = candidates
        self.now = now
    }
}

/// Demo-only and non-authoritative.
///
/// This engine drives the deterministic demo ride and nothing else. It models a
/// boarding tap and provider stop events, scores a vehicle one stop past the
/// boarding stop as plausible, and has no notion of whether the rider is still
/// waiting, so it does not implement the backend's `directed-route-progress-v1`
/// contract (`services/api/src/matching.ts`) and must never decide which bus a
/// real rider is on. `services/api/test/crossLanguageAuthority.test.ts` fails if
/// the app gains a network path or calls this engine with anything but demo
/// fixtures; before either happens, this engine has to pass the language-neutral
/// cases in `fixtures/transit/directed-matcher-invariants.json`.
public struct VehicleMatchingEngine: Sendable {
    public let freshnessPolicy: FreshnessPolicy

    public init(freshnessPolicy: FreshnessPolicy = .conservativeDefault) {
        self.freshnessPolicy = freshnessPolicy
    }

    public func match(_ input: VehicleMatchingInput) -> VehicleMatchResult {
        makeResult(input: input, previousVehicleID: nil)
    }

    public func reevaluate(
        previousVehicleID: VehicleIdentifier,
        with input: VehicleMatchingInput
    ) -> VehicleMatchResult {
        makeResult(input: input, previousVehicleID: previousVehicleID)
    }

    private func makeResult(
        input: VehicleMatchingInput,
        previousVehicleID: VehicleIdentifier?
    ) -> VehicleMatchResult {
        var scored: [ScoredVehicleCandidate] = []
        var rejected: [RejectedVehicleCandidate] = []

        for candidate in input.candidates {
            switch score(candidate: candidate, input: input) {
            case let .success(value): scored.append(value)
            case let .failure(reason):
                rejected.append(.init(vehicleID: candidate.vehicleID, reason: reason))
            }
        }
        scored.sort {
            if $0.score == $1.score { return $0.vehicleID.rawValue < $1.vehicleID.rawValue }
            return $0.score > $1.score
        }

        guard let best = scored.first else {
            return VehicleMatchResult(
                selectedVehicle: nil,
                confidence: .unknown,
                requiresConfirmation: true,
                alternatives: [],
                rejectedCandidates: rejected,
                snapshotTimestamp: input.now,
                dataFreshness: .unknown,
                decisionEvidence: contradictionEvidence(previousVehicleID, scored: scored)
            )
        }

        let gap = best.score - (scored.dropFirst().first?.score ?? 0)
        let confidence: MatchConfidence
        let selected: ScoredVehicleCandidate?
        if best.score >= 105 && (scored.count == 1 || gap >= 25) {
            confidence = .high
            selected = best
        } else if best.score >= 80 && (scored.count == 1 || gap >= 15) {
            confidence = .medium
            selected = best
        } else {
            confidence = .low
            selected = nil
        }

        return VehicleMatchResult(
            selectedVehicle: selected,
            confidence: confidence,
            requiresConfirmation: selected == nil,
            alternatives: scored,
            rejectedCandidates: rejected,
            snapshotTimestamp: input.now,
            dataFreshness: freshnessPolicy.classify(
                observedAt: best.latestObservation.timestamp,
                relativeTo: input.now
            ),
            decisionEvidence: best.evidence + contradictionEvidence(previousVehicleID, scored: scored)
        )
    }

    private func contradictionEvidence(
        _ previousVehicleID: VehicleIdentifier?,
        scored: [ScoredVehicleCandidate]
    ) -> [VehicleMatchEvidence] {
        guard let previousVehicleID, scored.first?.vehicleID != previousVehicleID else { return [] }
        return [
            .init(
                kind: .previousMatchContradicted,
                score: 0,
                explanation: "New evidence no longer ranks the previously matched vehicle first."
            )
        ]
    }

    private func score(
        candidate: VehicleCandidate,
        input: VehicleMatchingInput
    ) -> Result<ScoredVehicleCandidate, CandidateRejectionReason> {
        guard let latest = candidate.latest else { return .failure(.noObservations) }
        guard candidate.observations.allSatisfy({ $0.vehicleID == candidate.vehicleID }) else {
            return .failure(.inconsistentVehicleIdentity)
        }
        guard latest.routeID == input.plan.routeID, latest.routeID == input.route.id else {
            return .failure(.wrongRoute)
        }
        if input.plan.direction != .unknown,
           latest.direction != .unknown,
           latest.direction != input.plan.direction {
            return .failure(.wrongDirection)
        }
        if let expectedVariant = input.plan.routeVariantID,
           latest.routeVariantID != expectedVariant || input.route.variantID != expectedVariant {
            return .failure(.routeVariantMismatch)
        }
        guard let boardingStop = input.route.routeStop(id: input.plan.boardingStopID),
              let destinationStop = input.route.routeStop(id: input.plan.destinationStopID),
              boardingStop.sequence < destinationStop.sequence else {
            return .failure(.invalidStopOrdering)
        }

        let freshness = freshnessPolicy.classify(observedAt: latest.timestamp, relativeTo: input.now)
        guard freshness != .stale, freshness != .unknown else {
            return .failure(.staleObservation)
        }
        if let currentID = latest.confirmedStopID,
           let currentStop = input.route.routeStop(id: currentID),
           currentStop.sequence > boardingStop.sequence + 1 {
            return .failure(.alreadyTooFarPastBoarding)
        }
        guard continuityIsPlausible(candidate.observations, route: input.route) else {
            return .failure(.implausibleContinuity)
        }

        var evidence = [
            VehicleMatchEvidence(kind: .exactRoute, score: 45, explanation: "Vehicle is reporting the selected route.")
        ]
        if latest.direction == input.plan.direction {
            evidence.append(.init(kind: .directionCompatible, score: 20, explanation: "Vehicle direction can reach the destination."))
        }

        if let currentID = latest.confirmedStopID,
           let current = input.route.routeStop(id: currentID) {
            let delta = current.sequence - boardingStop.sequence
            switch (delta, latest.event) {
            case (0, .arrivedAtStop):
                evidence.append(.init(kind: .atBoardingStop, score: 35, explanation: "Vehicle is at the selected boarding stop."))
            case (0, .departedStop):
                evidence.append(.init(kind: .justDepartedBoardingStop, score: 30, explanation: "Vehicle just departed the boarding stop."))
            case (-1, _):
                evidence.append(.init(kind: .approachingBoardingStop, score: 22, explanation: "Vehicle is one stop before boarding."))
            case (0, _):
                evidence.append(.init(kind: .atBoardingStop, score: 25, explanation: "Latest confirmed stop is the boarding stop."))
            case (1, _):
                evidence.append(.init(kind: .justDepartedBoardingStop, score: 18, explanation: "Vehicle is one stop beyond boarding."))
            default:
                break
            }
        } else {
            let distance = latest.coordinate.distance(to: boardingStop.stop.coordinate)
            if distance <= 120 {
                evidence.append(.init(kind: .atBoardingStop, score: 20, explanation: "Vehicle position is within 120 m of boarding."))
            } else if distance <= 500 {
                evidence.append(.init(kind: .approachingBoardingStop, score: 10, explanation: "Vehicle position is near boarding."))
            }
        }

        let boardingDelta = abs(latest.timestamp.timeIntervalSince(input.boarding.tappedAt))
        if boardingDelta <= 60 {
            evidence.append(.init(kind: .boardingTimeAligned, score: 18, explanation: "Observation is within one minute of the boarding action."))
        } else if boardingDelta <= 180 {
            evidence.append(.init(kind: .boardingTimeAligned, score: 8, explanation: "Observation is within three minutes of boarding."))
        }

        switch freshness {
        case .fresh:
            evidence.append(.init(kind: .freshObservation, score: 18, explanation: "Observation is fresh under the injected policy."))
        case .aging:
            evidence.append(.init(kind: .agingObservation, score: 4, explanation: "Observation is aging; confidence is reduced."))
        case .stale, .unknown:
            break
        }

        if let heading = latest.headingDegrees,
           let expected = input.route.expectedBearing(at: latest.confirmedStopID ?? input.plan.boardingStopID) {
            let delta = angularDifference(heading, expected)
            if delta <= 45 {
                evidence.append(.init(kind: .headingAligned, score: 8, explanation: "Heading aligns with the route."))
            } else if delta >= 110 {
                evidence.append(.init(kind: .headingMismatch, score: -12, explanation: "Heading conflicts with the route."))
            }
        }

        if let passenger = input.boarding.oneShotLocation {
            let distance = passenger.distance(to: latest.coordinate)
            if distance <= 80 {
                evidence.append(.init(kind: .oneShotLocationAligned, score: 18, explanation: "Optional one-shot location is near this vehicle."))
            }
        }
        if candidate.observations.count >= 2 {
            evidence.append(.init(kind: .plausibleContinuity, score: 8, explanation: "Observation history moves forward at a plausible speed."))
        }

        return .success(
            ScoredVehicleCandidate(
                vehicleID: candidate.vehicleID,
                score: evidence.reduce(0) { $0 + $1.score },
                evidence: evidence,
                latestObservation: latest
            )
        )
    }

    private func continuityIsPlausible(
        _ observations: [VehicleObservation],
        route: TransitRoute
    ) -> Bool {
        let sorted = observations.sorted { $0.timestamp < $1.timestamp }
        for pair in zip(sorted, sorted.dropFirst()) {
            let elapsed = pair.1.timestamp.timeIntervalSince(pair.0.timestamp)
            guard elapsed > 0 else { return false }
            let metersPerSecond = pair.0.coordinate.distance(to: pair.1.coordinate) / elapsed
            if metersPerSecond > 45 { return false }
            if let firstID = pair.0.confirmedStopID,
               let secondID = pair.1.confirmedStopID,
               let first = route.routeStop(id: firstID),
               let second = route.routeStop(id: secondID),
               second.sequence < first.sequence {
                return false
            }
        }
        return true
    }

    private func angularDifference(_ lhs: Double, _ rhs: Double) -> Double {
        let delta = abs(lhs - rhs).truncatingRemainder(dividingBy: 360)
        return min(delta, 360 - delta)
    }
}
