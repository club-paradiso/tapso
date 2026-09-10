export type Direction = "outbound" | "inbound";

export interface RouteRequest {
  routeId: string;
  standardRegionCode: string;
}

export interface StopOnRoute {
  stopId: string;
  name: string;
  sequence: number;
  directionCode?: string;
  latitude?: number;
  longitude?: number;
}

export interface VehicleObservation {
  vehicleId: string;
  routeId: string;
  observedAt: string;
  stopSequence?: number;
  directionCode?: string;
  latitude?: number;
  longitude?: number;
  speedKph?: number;
  headingDegrees?: number;
  eventCode?: string;
  receiveType?: string;
}

export interface MatchRequest {
  routeId: string;
  boardingStopSequence: number;
  boardingLatitude?: number;
  boardingLongitude?: number;
  directionCode?: string;
  now: string;
  candidates: VehicleObservation[];
}

export interface RankedCandidate {
  vehicleId: string;
  score: number;
  evidence: string[];
  rejectedReasons: string[];
}

export interface MatchResult {
  status: "matched" | "ambiguous" | "unavailable";
  confidence: "high" | "medium" | "low" | "unknown";
  selectedVehicleId?: string;
  ranked: RankedCandidate[];
  explanation: string;
}
