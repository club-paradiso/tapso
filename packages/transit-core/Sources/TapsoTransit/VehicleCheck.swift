import Foundation

/// A bus the rider may be about to board, as TAPSO proposes it.
///
/// A proposal never selects a vehicle. Automatic selection is withheld by the
/// matcher readiness gate, so the rider's tap is what confirms a bus.
public struct VehicleProposal: Codable, Hashable, Identifiable, Sendable {
    public var id: VehicleIdentifier { vehicleID }
    public let vehicleID: VehicleIdentifier
    /// Only the last digits of the plate, as painted on the bus.
    public let maskedPlate: String
    /// Stops between the bus and the boarding stop. `0` means at the stop.
    public let stopsAway: Int?

    public init(vehicleID: VehicleIdentifier, plate: String?, stopsAway: Int?) {
        self.vehicleID = vehicleID
        self.maskedPlate = VehiclePlate.masked(plate ?? vehicleID.rawValue)
        self.stopsAway = stopsAway
    }
}

public enum VehiclePlate {
    /// Keeps the last four digits and hides the rest: `제주70자1234` → `••1234`.
    public static func masked(_ plate: String) -> String {
        let digits = plate.filter(\.isNumber)
        guard digits.count >= 2 else { return "••••" }
        return "••" + String(digits.suffix(4))
    }
}

/// Where the pre-ride vehicle check stands.
public enum VehicleCheckStage: String, Codable, Hashable, Sendable, CaseIterable {
    /// Watching buses on the way to the boarding stop.
    case searching
    /// One bus fits; the rider confirms it.
    case proposed
    /// More than one bus fits; the rider picks the one they boarded.
    case similarBuses
    /// No bus fits yet. Still watching.
    case notFoundYet
    /// The rider confirmed a bus. The ride can start.
    case confirmed
}

public struct VehicleCheck: Hashable, Sendable {
    public let stage: VehicleCheckStage
    public let proposals: [VehicleProposal]

    /// Decides the stage from what the rider could board.
    ///
    /// Two or more proposals are always a question for the rider, never a pick,
    /// however they are ordered.
    public static func evaluate(
        proposals: [VehicleProposal],
        hasSearched: Bool,
        confirmed: VehicleIdentifier? = nil
    ) -> VehicleCheck {
        if let confirmed, proposals.contains(where: { $0.vehicleID == confirmed }) {
            return VehicleCheck(stage: .confirmed, proposals: proposals.filter { $0.vehicleID == confirmed })
        }
        switch proposals.count {
        case 0:
            return VehicleCheck(stage: hasSearched ? .notFoundYet : .searching, proposals: [])
        case 1:
            return VehicleCheck(stage: .proposed, proposals: proposals)
        default:
            let ordered = proposals.sorted { ($0.stopsAway ?? .max) < ($1.stopsAway ?? .max) }
            return VehicleCheck(stage: .similarBuses, proposals: ordered)
        }
    }

    public var headlineKey: String { "check.\(stage.rawValue).headline" }
    public var detailKey: String { "check.\(stage.rawValue).detail" }

    public static var allCopyKeys: [String] {
        [VehicleCheckStage.searching, .proposed, .similarBuses, .notFoundYet, .confirmed].flatMap {
            ["check.\($0.rawValue).headline", "check.\($0.rawValue).detail"]
        }
    }
}
