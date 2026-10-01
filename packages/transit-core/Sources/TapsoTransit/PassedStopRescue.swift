import Foundation

/// What to do once the bus has carried the rider past their stop: the Rescue
/// engine's plan (`docs/product/JEJU_SAFETY_LAYER_V3.md`) built from what a
/// ride actually knows.
public struct PassedStopAdvice: Hashable, Sendable {
    /// Where to get off: the first stop after the one the bus was last placed at.
    /// `nil` when the bus's position is unknown.
    public let exitStop: RouteStop?
    /// Straight-line metres from `exitStop` back to the destination stop, rounded
    /// to 10 m. `nil` unless both coordinates are surveyed. A straight line is the
    /// shortest the walk can be, so surfaces show it as a distance, never as minutes.
    public let straightLineMeters: Int?
    public let plan: RescuePlan

    public init(exitStop: RouteStop?, straightLineMeters: Int?, plan: RescuePlan) {
        self.exitStop = exitStop
        self.straightLineMeters = straightLineMeters
        self.plan = plan
    }

    /// The walk was measured, but it is longer than the Rescue policy offers on foot.
    public var walkTooFar: Bool {
        straightLineMeters != nil && !plan.options.contains { $0.action == .walkBack }
    }
}

/// "목적지를 지났어요" answered with the next stop and the way back.
///
/// - The exit is the first stop after the one the bus was last placed at. TAGO
///   says where the bus is, not whether its doors are open, so TAPSO never names
///   a stop the bus may already have left.
/// - The walk back is measured only between surveyed coordinates (TAGO
///   `gpslati`/`gpslong`); the demo's coordinates are synthetic and never measured.
/// - Riding back is never offered: TAPSO cannot yet tell that the same route
///   runs the other way through both stops (`KNOWN_ISSUES.md`), so the map app
///   stays the way to find a bus back.
public enum PassedStopRescue {
    public static func advice(
        route: TransitRoute,
        destinationSequence: Int,
        busSequence: Int?,
        coordinatesAreSurveyed: Bool,
        policy: RescuePolicy = .standard
    ) -> PassedStopAdvice {
        let exit = exitStop(on: route, destinationSequence: destinationSequence, busSequence: busSequence)
        var meters: Int?
        if coordinatesAreSurveyed, let exit, let destination = route.routeStop(sequence: destinationSequence) {
            let distance = exit.stop.coordinate.distance(to: destination.stop.coordinate)
            if distance.isFinite {
                meters = Int((distance / 10).rounded()) * 10
            }
        }
        let plan = Rescue.plan(
            RescueInput(
                kind: .passedDestination,
                nextStopName: exit?.stop.name,
                walkBackMeters: meters.map(Double.init)
            ),
            policy: policy
        )
        return PassedStopAdvice(exitStop: exit, straightLineMeters: meters, plan: plan)
    }

    /// The first stop after both the destination and the bus's last position, by
    /// provider sequence (stop ids repeat round a loop; sequences do not). At the
    /// end of the line there is no stop after the bus, and the bus's own stop is
    /// where everyone gets off.
    static func exitStop(on route: TransitRoute, destinationSequence: Int, busSequence: Int?) -> RouteStop? {
        guard let busSequence else { return nil }
        let after = max(busSequence, destinationSequence)
        if let next = route.stops.first(where: { $0.sequence > after }) {
            return next
        }
        guard let last = route.stops.last, last.sequence == busSequence else { return nil }
        return last
    }
}
