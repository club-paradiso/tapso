import Foundation

/// Reads a server journey session into the facts the app's surfaces already
/// understand: a `VehicleCheck` before the ride and a `RideSignal` during it.
///
/// The server decides; this only translates. Freshness comes from the
/// server's state (`tracking` means the selected bus had fresh cadence evidence
/// on that poll), never from a timestamp re-read on the phone: TAGO publishes
/// no observation time, and `evidenceAt` is TAPSO's receipt time.
public enum LiveSessionInterpreter {
    /// Whether the server lets the matcher's list be presented as a suggestion.
    ///
    /// Only at `READY_FOR_CONFIRMATION_ASSISTED` or above (issue #80). A server
    /// that does not say, or says something unknown, gets the rider-identifies
    /// presentation: the safe reading of silence.
    public static func allowsMatcherSuggestion(_ snapshot: JourneySessionSnapshot) -> Bool {
        snapshot.vehicleChoice?.allowsMatcherSuggestion == true
    }

    /// Buses the rider can confirm, nearest the stop first, minus any they said were not theirs.
    ///
    /// Below confirmation-assisted readiness these are the server's raw
    /// positions (`vehicleChoice.vehicles`): nothing the matcher ranked or
    /// filtered. At that readiness they are the matcher's confirmation list,
    /// and only `confirmation_required` lists are proposals: an
    /// `awaiting_match` session publishes the matcher's full ranking, which
    /// includes buses that have already left the stop.
    public static func proposals(
        from snapshot: JourneySessionSnapshot,
        excluding rejected: Set<VehicleIdentifier> = []
    ) -> [VehicleProposal] {
        guard snapshot.selectedVehicleId == nil else { return [] }
        if !allowsMatcherSuggestion(snapshot) {
            guard snapshot.sessionState == .confirmationRequired || snapshot.sessionState == .awaitingMatch else { return [] }
            if let choice = snapshot.vehicleChoice {
                return choice.vehicles.compactMap { vehicle in
                    let vehicleID = VehicleIdentifier(rawValue: vehicle.vehicleId)
                    guard !rejected.contains(vehicleID) else { return nil }
                    return VehicleProposal(vehicleID: vehicleID, plate: vehicle.vehicleId, stopsAway: vehicle.stopsAway)
                }
            }
            // A server from before `vehicleChoice`: its confirmation list, shown
            // without any suggestion (`vehicleCheck` asks the rider to pick).
        }
        guard snapshot.sessionState == .confirmationRequired else { return [] }
        return (snapshot.candidates ?? []).compactMap { candidate in
            let vehicleID = VehicleIdentifier(rawValue: candidate.vehicleId)
            guard !rejected.contains(vehicleID), !(candidate.rejectedReasons ?? []).contains("wrong_route") else { return nil }
            let stopsAway: Int? = candidate.stopOffset.flatMap { $0 <= 0 ? -$0 : nil }
            return VehicleProposal(vehicleID: vehicleID, plate: candidate.vehicleId, stopsAway: stopsAway)
        }
    }

    /// The pre-ride check for a session that has been read at least once.
    /// Below confirmation-assisted readiness even a single bus is a question
    /// (`choose`), never "this looks like your bus".
    public static func vehicleCheck(
        for snapshot: JourneySessionSnapshot,
        excluding rejected: Set<VehicleIdentifier> = []
    ) -> VehicleCheck {
        if let selected = snapshot.selectedVehicleId {
            let vehicleID = VehicleIdentifier(rawValue: selected)
            let proposal = VehicleProposal(vehicleID: vehicleID, plate: selected, stopsAway: nil)
            return VehicleCheck.evaluate(proposals: [proposal], hasSearched: true, confirmed: vehicleID)
        }
        return VehicleCheck.evaluate(
            proposals: proposals(from: snapshot, excluding: rejected),
            hasSearched: true,
            suggestionsAllowed: allowsMatcherSuggestion(snapshot)
        )
    }

    /// The ride's facts for `RideGuidancePolicy`. Anything the server did not
    /// establish fails closed to `checking`, which never alerts.
    public static func rideSignal(for snapshot: JourneySessionSnapshot, isOffline: Bool = false) -> RideSignal {
        let progress = snapshot.progress
        let remaining = progress?.remainingStops ?? -1
        let reading = progress.flatMap { phase(for: $0.phase) }

        switch snapshot.sessionState {
        case .tracking, .arrived, .passedDestination:
            guard let progress, let reading else { return checking(isOffline: isOffline) }
            return RideSignal(
                phase: reading.state,
                remainingStops: reading.passed ? 0 : progress.remainingStops,
                freshness: .fresh,
                destinationPassed: reading.passed,
                isOffline: isOffline
            )
        case .degraded:
            // Last accepted progress, labelled as last known; no alert can come from it.
            return RideSignal(
                phase: reading?.state ?? .dataStale,
                remainingStops: remaining,
                freshness: .aging,
                destinationPassed: reading?.passed ?? false,
                isOffline: isOffline
            )
        case .lost:
            return RideSignal(phase: .vehicleTemporarilyLost, remainingStops: remaining, freshness: .stale, isOffline: isOffline)
        case .awaitingMatch, .confirmationRequired, .unrecognized:
            return checking(isOffline: isOffline)
        }
    }

    /// The stop the server last placed the bus at, if any.
    public static func currentStopSequence(for snapshot: JourneySessionSnapshot) -> Int? {
        snapshot.progress?.currentStopSequence
    }

    private static func phase(for wire: String) -> (state: JourneyState, passed: Bool)? {
        switch wire {
        case "active": return (JourneyState.active, false)
        case "approaching": return (JourneyState.approachingDestination, false)
        case "next_stop": return (JourneyState.nextStopIsDestination, false)
        case "arrived": return (JourneyState.arrived, false)
        case "passed_destination": return (JourneyState.arrived, true)
        default: return nil
        }
    }

    private static func checking(isOffline: Bool) -> RideSignal {
        RideSignal(phase: .vehicleRecovery, remainingStops: -1, freshness: .unknown, isOffline: isOffline)
    }
}

public extension TransitRoute {
    /// A live route variant from TAPSO's API. `coordinatesAreSurveyed` is false
    /// when any stop came without coordinates; those stops carry a placeholder
    /// that must never reach a walking route (`MapHandoff`).
    static func live(_ route: TransitAPIRoute, stops: [TransitAPIStop]) -> (route: TransitRoute, coordinatesAreSurveyed: Bool) {
        var surveyed = !stops.isEmpty
        let routeStops = stops.map { stop -> RouteStop in
            let coordinate: Coordinate
            if let latitude = stop.latitude, let longitude = stop.longitude, latitude.isFinite, longitude.isFinite {
                coordinate = Coordinate(latitude: latitude, longitude: longitude)
            } else {
                surveyed = false
                coordinate = Coordinate(latitude: 0, longitude: 0)
            }
            return RouteStop(stop: Stop(id: StopID(rawValue: stop.stopId), name: stop.name, coordinate: coordinate), sequence: stop.sequence)
        }
        let sorted = routeStops.sorted { $0.sequence < $1.sequence }
        let transitRoute = TransitRoute(
            id: RouteID(rawValue: route.routeId),
            number: route.routeNumber,
            direction: .unknown,
            originName: route.startStopName ?? sorted.first?.stop.name ?? "",
            destinationName: route.endStopName ?? sorted.last?.stop.name ?? "",
            stops: routeStops
        )
        return (transitRoute, surveyed)
    }

    /// The stop at a provider sequence. Stop ids repeat round a loop; sequences do not.
    func routeStop(sequence: Int) -> RouteStop? {
        stops.first { $0.sequence == sequence }
    }
}
