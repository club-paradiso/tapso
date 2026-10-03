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

/// Stop chords are a fallback corridor, NEVER an authoritative road shape.
public struct RideRouteGeometry: Sendable {
    public let points: [Coordinate]
    public let verifiedRoadShape: Bool

    public init(points: [Coordinate], verifiedRoadShape: Bool) {
        self.points = points
        self.verifiedRoadShape = verifiedRoadShape
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
    private let vehicleID: String
    private let stops: [RouteStop]
    private let destination: Int
    private let geometry: RideRouteGeometry
    private var officialSequence: Int?
    private var strongAt: Date?
    private var committed: Int?
    private var lastProjection: RouteProjection?
    private var lastDeviceAt: Date?
    private var passageCandidate: Int?
    private var passageAt: Date?
    private var passageSamples = 0
    private var consistentSamples = 0

    public init(vehicleID: String, route: TransitRoute, destinationSequence: Int, surveyed: Bool, geometry: RideRouteGeometry? = nil) {
        self.vehicleID = vehicleID
        stops = route.stops
        destination = destinationSequence
        self.geometry = geometry ?? RideRouteGeometry(points: surveyed ? route.stops.map { $0.stop.coordinate } : [], verifiedRoadShape: false)
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
        // Newer official progress may reconcile an estimate, but cannot move it backward.
        if officialStrong, let sequence, let evidenceAt {
            if let committed, sequence < committed { return result(.lost, 0.2, "official_backward_conflict") }
            if let old = officialSequence, sequence > old + 1, let strongAt,
               evidenceAt.timeIntervalSince(strongAt) < Double(sequence - old) * 8 {
                return result(.lost, 0.2, "official_implausible_jump")
            }
            officialSequence = sequence
            committed = sequence
            strongAt = evidenceAt
        }

        let gpsAge = device.map { now.timeIntervalSince($0.timestamp) }
        let deviceValid = device.map {
            $0.accuracy.isFinite && $0.accuracy > 0 && $0.accuracy <= 50
                && RideMapMatcher.valid($0.coordinate)
                && ($0.speed.map { $0.isFinite && $0 >= 0 && $0 <= 35 } ?? true)
                && ($0.course.map { $0.isFinite && $0 >= 0 && $0 < 360 } ?? true)
        } ?? false
        let recentDevice = deviceValid && (gpsAge.map { $0 >= 0 && $0 <= 20 } ?? false)
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
        if officialStrong { return result(.live, 0.95, "consistent_official", 30) }
        guard let strongAt, now.timeIntervalSince(strongAt) >= 0, now.timeIntervalSince(strongAt) <= 180,
              let committed else { return result(.lost, 0.1, "association_expired") }
        guard recentDevice, let device, let projection else {
            clearDeviceContinuity()
            return result(.lost, 0.15, "no_usable_device_geometry")
        }
        // Only a surveyed road shape can commit stop passage. Chords remain a visual estimate.
        if geometry.verifiedRoadShape {
            advanceConfirmedPassage(device: device, projection: projection, now: now)
            let ageFactor = max(0, 1 - now.timeIntervalSince(strongAt) / 240)
            let accuracyFactor = max(0, 1 - device.accuracy / 100)
            let routeFactor = max(0, 1 - projection.distanceFromRoute / 160)
            let confidence = 0.4 * ageFactor + 0.3 * accuracyFactor + 0.3 * routeFactor
            // Multiple distinct samples and moving course are required for fusion.
            if confidence >= 0.75, consistentSamples >= 2, (device.speed ?? 0) >= 2, device.course != nil {
                return result(.fused, confidence, "verified_route_device_fusion")
            }
        }
        // A prediction never causes an actionable 2/1/0-stop milestone.
        guard destination - committed > 2 else { return result(.lost, 0.3, "destination_needs_confirmation") }
        return result(.predicted, geometry.verifiedRoadShape ? 0.6 : 0.45, "bounded_device_estimate")
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
                passageCandidate = nil
                self.passageAt = nil
            }
        }
    }
}

/// Extension point for aggregated route/variant/direction/time bucket timings.
/// No precise rider samples are stored, and predictions never commit passage.
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
