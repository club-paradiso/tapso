import Foundation

public enum DemoFixtures {
    public static let referenceDate = Date(timeIntervalSince1970: 1_800_000_000)

    public static let route: TransitRoute = {
        let names = [
            "제주버스터미널",
            "용문마을",
            "용담사거리",
            "서문시장",
            "관덕정",
            "중앙로",
            "동문로터리",
            "제주여자상업고등학교",
            "제주시청(아라방면)",
            "국립제주박물관"
        ]
        let stops = names.enumerated().map { index, name in
            RouteStop(
                stop: Stop(
                    id: StopID(rawValue: "demo-stop-\(index)"),
                    name: name,
                    coordinate: Coordinate(
                        latitude: 33.4990 + Double(index) * 0.0015,
                        longitude: 126.5140 + Double(index) * 0.0012
                    )
                ),
                sequence: index
            )
        }
        return TransitRoute(
            id: "demo-route-365-outbound",
            number: "365",
            direction: .outbound,
            variantID: "demo-main",
            originName: names.first!,
            destinationName: names.last!,
            stops: stops
        )
    }()

    public static let plan = RidePlan(
        routeID: route.id,
        routeVariantID: route.variantID,
        direction: .outbound,
        boardingStopID: "demo-stop-0",
        destinationStopID: "demo-stop-8"
    )

    public static func observation(
        vehicleID: VehicleIdentifier = "demo-bus-365-A",
        stopSequence: Int,
        seconds: TimeInterval = 0,
        event: VehicleEvent = .arrivedAtStop,
        routeID: RouteID? = nil,
        direction: RouteDirection = .outbound,
        routeVariantID: String? = "demo-main"
    ) -> VehicleObservation {
        let routeStop = route.stops[stopSequence]
        return VehicleObservation(
            vehicleID: vehicleID,
            routeID: routeID ?? route.id,
            routeVariantID: routeVariantID,
            direction: direction,
            timestamp: referenceDate.addingTimeInterval(seconds),
            coordinate: routeStop.stop.coordinate,
            headingDegrees: route.expectedBearing(at: routeStop.stop.id),
            speedKilometersPerHour: event == .arrivedAtStop ? 0 : 24,
            confirmedStopID: routeStop.stop.id,
            event: event
        )
    }

    public static func obviousCandidate(now: Date = referenceDate) -> VehicleCandidate {
        VehicleCandidate(
            vehicleID: "demo-bus-365-A",
            observations: [
                observation(stopSequence: 0, seconds: -15, event: .approachingStop),
                observation(stopSequence: 0, seconds: 0, event: .departedStop)
            ]
        )
    }

    public static func demoTimeline(stepSeconds: TimeInterval = 10) -> [VehicleObservation] {
        (0...8).map { sequence in
            observation(
                stopSequence: sequence,
                seconds: Double(sequence) * stepSeconds,
                event: sequence == 0 ? .departedStop : .arrivedAtStop
            )
        }
    }
}
