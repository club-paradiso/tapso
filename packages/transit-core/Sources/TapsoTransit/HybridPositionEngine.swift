import Foundation

public enum HybridTrackingState: String, Codable, Hashable, Sendable {
    case live, fused, predicted, lost
}

public struct DevicePositionSample: Hashable, Sendable {
    public let coordinate: Coordinate
    public let timestamp: Date
    public let accuracy: Double
    public let speed: Double?
    public let course: Double?

    public init(coordinate: Coordinate, timestamp: Date, accuracy: Double, speed: Double? = nil, course: Double? = nil) {
        self.coordinate = coordinate
        self.timestamp = timestamp
        self.accuracy = accuracy
        self.speed = speed
        self.course = course
    }
}

/// Where a ride's corridor came from (`BOARDING_ANCHOR_POSITION_V2.md` §6).
/// Only an `authoritative` shape may fuse device evidence into high-confidence
/// guidance; the other two can at most support a capped, never-actionable estimate.
public enum RouteGeometryQuality: String, Codable, Hashable, Sendable, CaseIterable {
    /// Straight lines between surveyed stop coordinates. Every Jeju variant today.
    case stopChords
    /// Built from many independent official vehicle traversals (`DerivedRouteCorridor`).
    /// Evidence, not a survey: never authoritative.
    case derivedVehicleTrace
    /// A published road shape from an authoritative source under usable terms. None exists yet for Jeju.
    case authoritative

    public var allowsFusion: Bool { self == .authoritative }

    /// The confidence a bounded device estimate on this corridor may carry; always below `fused`.
    public var predictionConfidence: Double {
        switch self {
        case .stopChords: 0.45
        case .derivedVehicleTrace: 0.5
        case .authoritative: 0.6
        }
    }
}

/// Stop chords are a fallback corridor, NEVER an authoritative road shape.
public struct RideRouteGeometry: Sendable {
    public let points: [Coordinate]
    public let quality: RouteGeometryQuality

    public init(points: [Coordinate], quality: RouteGeometryQuality) {
        self.points = points
        self.quality = quality
    }

    /// The surveyed stops in route order, labelled as the approximation they are.
    public static func stopChords(of route: TransitRoute) -> RideRouteGeometry {
        RideRouteGeometry(points: route.stops.map { $0.stop.coordinate }, quality: .stopChords)
    }
}

public struct RouteProjection: Hashable, Sendable {
    public let distanceAlong: Double
    public let distanceFromRoute: Double
    public let bearing: Double
}

public enum RideMapMatcher {
    /// Continuity resolves loops; a similarly close competing occurrence fails closed.
    public static func project(_ coordinate: Coordinate, onto points: [Coordinate], after previous: Double? = nil) -> RouteProjection? {
        guard points.count > 1, valid(coordinate), points.allSatisfy(valid) else { return nil }
        var candidates: [RouteProjection] = []
        var accumulated = 0.0
        for index in 0..<(points.count - 1) {
            let a = points[index]
            let b = points[index + 1]
            let length = a.distance(to: b)
            defer { accumulated += length }
            guard length > 1 else { continue }
            let scale = cos(a.latitude * .pi / 180)
            let bx = (b.longitude - a.longitude) * scale * 111_195
            let by = (b.latitude - a.latitude) * 111_195
            let px = (coordinate.longitude - a.longitude) * scale * 111_195
            let py = (coordinate.latitude - a.latitude) * 111_195
            let fraction = min(1, max(0, (px * bx + py * by) / (bx * bx + by * by)))
            let along = accumulated + length * fraction
            if let previous, along < previous - 50 { continue }
            candidates.append(RouteProjection(distanceAlong: along, distanceFromRoute: hypot(px - fraction * bx, py - fraction * by), bearing: a.bearing(to: b)))
        }
        let ordered = candidates.sorted { $0.distanceFromRoute < $1.distanceFromRoute }
        guard let best = ordered.first else { return nil }
        if ordered.dropFirst().contains(where: {
            abs($0.distanceAlong - best.distanceAlong) > 150 && abs($0.distanceFromRoute - best.distanceFromRoute) < 15
        }) { return nil }
        return best
    }

    public static func valid(_ coordinate: Coordinate) -> Bool {
        coordinate.latitude.isFinite && coordinate.longitude.isFinite
            && abs(coordinate.latitude) <= 90 && abs(coordinate.longitude) <= 180
            && !(coordinate.latitude == 0 && coordinate.longitude == 0)
    }
}

/// One result for all passenger surfaces. Nothing precise is retained in this value.
public struct HybridRidePosition: Codable, Hashable, Sendable {
    public let state: HybridTrackingState
    public let confidence: Double
    public let currentStopSequence: Int?
    public let remainingStops: Int
    public let destinationPassed: Bool
    public let evaluatedAt: Date
    public let validUntil: Date
    public let reason: String
    public let routeDistanceBucket: Int?

    public var source: String {
        switch state {
        case .live: "official"
        case .fused: "verified_route_device"
        case .predicted: "device_stop_estimate"
        case .lost: "unavailable"
        }
    }

    public var confidenceCategory: String {
        confidence >= 0.75 ? "high" : (confidence >= 0.4 ? "estimated" : "low")
    }

    public func signal(at now: Date) -> RideSignal {
        guard now <= validUntil, state != .lost, remainingStops >= 0 else {
            return RideSignal(phase: .vehicleRecovery, remainingStops: -1, freshness: .unknown)
        }
        let phase: JourneyState = switch remainingStops {
        case 0: .arrived
        case 1: .nextStopIsDestination
        case 2: .approachingDestination
        default: .active
        }
        return RideSignal(phase: phase, remainingStops: remainingStops, freshness: .fresh, destinationPassed: destinationPassed, isEstimated: state == .predicted)
    }
}

/// A trip-scoped, deterministic engine; never selects/rematches a vehicle.
/// Thresholds are conservative initial assumptions, requiring real-ride calibration.
public struct HybridPositionEngine: Sendable {
    /// The worst device fix the engine accepts. `LocationSamplingPolicy` asks for fixes at least this good.
    public static let maximumDeviceAccuracy = 50.0
    /// The oldest device fix the engine accepts, seconds.
    public static let maximumDeviceAge = 20.0
    /// Before the bus officially reaches the rider's pole, the phone is with the rider at that pole.
    /// Farther than this from it, the phone cannot be describing this ride (lag-tolerant: TAGO's
    /// stop sequence can trail the bus by a stop or more).
    public static let boardingAnchorRadius = 1_000.0

    private let vehicleID: String
    private let stops: [RouteStop]
    private let destination: Int
    private let geometry: RideRouteGeometry
    private let boarding: RouteStop?
    private var officialSequence: Int?
    private var strongAt: Date?
    private var committed: Int?
    /// True while `committed` came from device stop passage rather than official progress.
    private var committedFromDevice = false
    private var lastProjection: RouteProjection?
    private var lastDeviceAt: Date?
    private var passageCandidate: Int?
    private var passageAt: Date?
    private var passageSamples = 0
    private var consistentSamples = 0

    /// - Parameter boardingSequence: the rider's exact boarding pole on this variant (`BoardingAnchor`).
    ///   Its coordinate is read from `route`, never passed separately. `nil` keeps the V1 behaviour.
    public init(vehicleID: String, route: TransitRoute, destinationSequence: Int, surveyed: Bool,
                geometry: RideRouteGeometry? = nil, boardingSequence: Int? = nil) {
        self.vehicleID = vehicleID
        stops = route.stops
        destination = destinationSequence
        self.geometry = geometry ?? (surveyed ? .stopChords(of: route) : RideRouteGeometry(points: [], quality: .stopChords))
        // An unsurveyed pole has no coordinate worth anchoring to; a sequence not on the route is ignored.
        boarding = surveyed ? boardingSequence.flatMap { sequence in route.stops.first { $0.sequence == sequence } } : nil
    }

    public mutating func evaluate(
        official: RideSignal?, sequence: Int?, evidenceAt: Date?, selectedVehicleID: String?,
        device: DevicePositionSample?, now: Date
    ) -> HybridRidePosition {
        func result(_ state: HybridTrackingState, _ confidence: Double, _ reason: String, _ validity: TimeInterval = 20) -> HybridRidePosition {
            HybridRidePosition(state: state, confidence: confidence, currentStopSequence: committed,
                               remainingStops: committed.map { max(0, destination - $0) } ?? -1,
                               destinationPassed: committed.map { $0 > destination } ?? false,
                               evaluatedAt: now, validUntil: now.addingTimeInterval(validity), reason: reason,
                               routeDistanceBucket: lastProjection.map { Int($0.distanceAlong / 100) })
        }
        guard selectedVehicleID == vehicleID else {
            clearDeviceContinuity()
            return result(.lost, 0, "vehicle_identity_conflict")
        }
        let officialAge = evidenceAt.map { now.timeIntervalSince($0) }
        let sequenceValid = sequence.map { candidate in stops.contains { $0.sequence == candidate } } ?? false
        if let official, let sequence, official.freshness == .fresh,
           official.remainingStops != max(0, destination - sequence) {
            return result(.lost, 0.1, "official_progress_conflict")
        }
        let officialStrong = official?.freshness == .fresh && official?.isOffline == false
            && official?.phase != .vehicleRecovery && official?.phase != .vehicleTemporarilyLost
            && sequenceValid && official.map { RideGuidancePolicy.moment(for: $0) != .checking } == true
            && (officialAge.map { $0 >= 0 && $0 <= 30 } ?? false)
        // Newer official progress reconciles a device estimate, even downward: an
        // estimate that ran ahead of the official count may have been early, and a
        // late display is preferable to an early one. Official progress itself
        // never moves backward.
        var reconciled = false
        if officialStrong, let sequence, let evidenceAt {
            if let committed, sequence < committed {
                guard committedFromDevice, sequence >= (officialSequence ?? sequence) else {
                    return result(.lost, 0.2, "official_backward_conflict")
                }
                reconciled = true
                clearDeviceContinuity()
            }
            if let old = officialSequence, sequence > old + 1, let strongAt,
               evidenceAt.timeIntervalSince(strongAt) < Double(sequence - old) * 8 {
                return result(.lost, 0.2, "official_implausible_jump")
            }
            officialSequence = sequence
            committed = sequence
            committedFromDevice = false
            strongAt = evidenceAt
        }

        let gpsAge = device.map { now.timeIntervalSince($0.timestamp) }
        let deviceValid = device.map {
            $0.accuracy.isFinite && $0.accuracy > 0 && $0.accuracy <= Self.maximumDeviceAccuracy
                && RideMapMatcher.valid($0.coordinate)
                && ($0.speed.map { $0.isFinite && $0 >= 0 && $0 <= 35 } ?? true)
                && ($0.course.map { $0.isFinite && $0 >= 0 && $0 < 360 } ?? true)
        } ?? false
        let recentDevice = deviceValid && (gpsAge.map { $0 >= 0 && $0 <= Self.maximumDeviceAge } ?? false)
        let officialReason = reconciled ? "official_reconciled_estimate" : "consistent_official"
        let officialValidity = max(0, 30 - (officialAge ?? 30))

        // Until official progress puts the bus at the rider's pole, the phone
        // describes the rider waiting there, not the bus: it may neither seed
        // the bus's continuity nor produce an estimate, and a phone far from the
        // pole cannot overturn the official reading either.
        if let boarding, (committed ?? Int.min) < boarding.sequence {
            clearDeviceContinuity()
            guard officialStrong else { return result(.lost, 0.15, "boarding_needs_official") }
            if recentDevice, let device, device.coordinate.distance(to: boarding.stop.coordinate) > Self.boardingAnchorRadius {
                return result(.live, 0.95, "boarding_anchor_mismatch", officialValidity)
            }
            return result(.live, 0.95, officialReason, officialValidity)
        }
        var projection: RouteProjection?
        if recentDevice, let device {
            projection = RideMapMatcher.project(device.coordinate, onto: geometry.points, after: lastProjection?.distanceAlong)
            if let match = projection {
                guard match.distanceFromRoute <= 80 else {
                    clearDeviceContinuity()
                    return result(.lost, 0.15, "route_deviation")
                }
                if let course = device.course, (device.speed ?? 0) > 2 {
                    let difference = abs(course - match.bearing)
                    guard min(difference, 360 - difference) <= 90 else {
                        clearDeviceContinuity()
                        return result(.lost, 0.2, "direction_conflict")
                    }
                }
                if let previous = lastProjection, let lastDeviceAt {
                    let seconds = device.timestamp.timeIntervalSince(lastDeviceAt)
                    if seconds < 0 { return result(.lost, 0.25, "out_of_order_device_sample") }
                    guard match.distanceAlong >= previous.distanceAlong - 25,
                          match.distanceAlong - previous.distanceAlong <= 35 * seconds + device.accuracy else {
                        clearDeviceContinuity()
                        return result(.lost, 0.2, "gps_jump")
                    }
                }
                if officialStrong, let sequence, let stop = stops.first(where: { $0.sequence == sequence }) {
                    // Only large disagreement counts: provider sequence can mean the next stop.
                    let adjacent = stops.filter { abs($0.sequence - sequence) <= 1 }
                    if adjacent.allSatisfy({ device.coordinate.distance(to: $0.stop.coordinate) > 1_500 })
                        && device.coordinate.distance(to: stop.stop.coordinate) > 1_500 {
                        return result(.lost, 0.15, "official_device_conflict")
                    }
                }
                if lastDeviceAt == nil, let officialSequence,
                   let anchor = stops.first(where: { $0.sequence == officialSequence }),
                   device.coordinate.distance(to: anchor.stop.coordinate) > 1_500 {
                    return result(.lost, 0.2, "device_reacquisition_too_far")
                }
                if lastDeviceAt != device.timestamp { consistentSamples += 1 }
                lastProjection = match
                lastDeviceAt = device.timestamp
            }
        }
        if officialStrong { return result(.live, 0.95, officialReason, officialValidity) }
        guard let strongAt, now.timeIntervalSince(strongAt) >= 0, now.timeIntervalSince(strongAt) <= 180,
              let committed else { return result(.lost, 0.1, "association_expired") }
        guard recentDevice, let device, let projection else {
            clearDeviceContinuity()
            return result(.lost, 0.15, "no_usable_device_geometry")
        }
        // Surveyed stop proximity followed by forward departure can advance an approximate
        // count. A chord alone or elapsed time can never do so; approximate results cannot alert.
        advanceConfirmedPassage(device: device, projection: projection, now: now)
        // No device evidence, on any geometry, holds an actionable 2/1/0-stop
        // milestone: near the destination only fresh official progress counts.
        guard destination - (self.committed ?? committed) > 2 else { return result(.lost, 0.3, "destination_needs_confirmation") }
        if geometry.quality.allowsFusion {
            let ageFactor = max(0, 1 - now.timeIntervalSince(strongAt) / 240)
            let accuracyFactor = max(0, 1 - device.accuracy / 100)
            let routeFactor = max(0, 1 - projection.distanceFromRoute / 160)
            let confidence = 0.4 * ageFactor + 0.3 * accuracyFactor + 0.3 * routeFactor
            // Multiple distinct samples and moving course are required for fusion.
            if confidence >= 0.75, consistentSamples >= 2, (device.speed ?? 0) >= 2, device.course != nil {
                return result(.fused, confidence, "verified_route_device_fusion", min(20, 180 - now.timeIntervalSince(strongAt)))
            }
        }
        return result(.predicted, geometry.quality.predictionConfidence, "bounded_device_estimate", min(20, 180 - now.timeIntervalSince(strongAt)))
    }

    private mutating func clearDeviceContinuity() {
        lastProjection = nil
        lastDeviceAt = nil
        passageCandidate = nil
        passageAt = nil
        passageSamples = 0
        consistentSamples = 0
    }

    private mutating func advanceConfirmedPassage(device: DevicePositionSample, projection: RouteProjection, now: Date) {
        guard let committed, let index = stops.firstIndex(where: { $0.sequence == committed }),
              stops.indices.contains(index + 1) else { return }
        let next = stops[index + 1]
        guard next.sequence <= destination,
              let stopProjection = RideMapMatcher.project(next.stop.coordinate, onto: geometry.points, after: projection.distanceAlong - 150),
              stopProjection.distanceFromRoute <= 30 else { return }
        // Observe proximity before passage: merely projecting far ahead cannot skip stops.
        if device.coordinate.distance(to: next.stop.coordinate) <= max(25, device.accuracy), passageCandidate != next.sequence {
            passageCandidate = next.sequence
            passageAt = device.timestamp
            passageSamples = 1
        } else if passageCandidate == next.sequence, let passageAt, device.timestamp > passageAt {
            passageSamples += 1
            let margin = max(40, device.accuracy * 2)
            if now.timeIntervalSince(passageAt) >= 5, passageSamples >= (next.sequence == destination ? 3 : 2),
               projection.distanceAlong > stopProjection.distanceAlong + margin,
               (device.speed ?? 0) > 2, device.course != nil {
                // Do not claim arrival from passing a shape point; destination needs official evidence.
                guard next.sequence < destination else { return }
                self.committed = next.sequence
                committedFromDevice = true
                passageCandidate = nil
                self.passageAt = nil
            }
        }
    }
}

/// Extension point for aggregated route/variant/direction/time bucket timings.
/// No precise rider samples are stored, and timing alone never commits passage.
public struct SegmentTimingEstimate: Sendable {
    public let sampleCount: Int
    public let medianSeconds: Double?

    public init(samples: [Double]) {
        let valid = samples.filter { $0.isFinite && $0 >= 5 && $0 <= 1_800 }.sorted()
        sampleCount = valid.count
        if valid.count >= 5 {
            let mid = valid.count / 2
            medianSeconds = valid.count.isMultiple(of: 2) ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid]
        } else {
            medianSeconds = nil
        }
    }
}
