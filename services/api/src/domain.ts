export type Direction = "outbound" | "inbound";

export interface RouteRequest {
  routeId: string;
  cityCode: string;
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
  /**
   * When the provider says it observed the vehicle — but only when
   * `timestampSource` is `"provider"`. Under `"unavailable"` this is the epoch
   * sentinel `1970-01-01T00:00:00.000Z` and carries no information at all.
   */
  observedAt: string;
  /**
   * When TAPSO's own server received the snapshot. Server receipt time, full
   * stop. It is never a provider observation time and must not be renamed,
   * serialised or described as one; a freshness rule built on it can only
   * claim that the provider kept answering, never when it looked.
   */
  receivedAt?: string;
  /**
   * `"unavailable"` means the provider publishes no observation time — TAGO's
   * realtime position feed is the case this exists for. Consumers must fail
   * closed on it rather than substituting `receivedAt`.
   */
  timestampSource?: "provider" | "unavailable";
  stopId?: string;
  stopName?: string;
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
