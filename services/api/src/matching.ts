import type { MatchRequest, MatchResult, RankedCandidate, VehicleObservation } from "./domain.ts";
import { distanceMeters } from "./geo.ts";

const MAX_AGE_SECONDS = 90;
const AMBIGUITY_MARGIN = 12;
const BOARDING_STOP_RADIUS_METERS = 120;
const BOARDING_NEAR_RADIUS_METERS = 500;

export function matchVehicle(request: MatchRequest): MatchResult {
  const now = new Date(request.now).valueOf();
  const ranked = request.candidates
    .map((candidate) => rank(candidate, request, now))
    .sort((left, right) => right.score - left.score || left.vehicleId.localeCompare(right.vehicleId));
  const eligible = ranked.filter((candidate) => candidate.rejectedReasons.length === 0);

  if (eligible.length === 0) {
    return {
      status: "unavailable",
      confidence: "unknown",
      ranked,
      explanation: "No fresh candidate agrees with route, direction, and boarding evidence.",
    };
  }

  const best = eligible[0];
  const runnerUp = eligible[1];
  if (runnerUp && best.score - runnerUp.score < AMBIGUITY_MARGIN) {
    return {
      status: "ambiguous",
      confidence: "low",
      ranked,
      explanation: "The leading candidates are too close; automatic tracking is withheld.",
    };
  }

  return {
    status: "matched",
    confidence: best.score >= 75 ? "high" : "medium",
    selectedVehicleId: best.vehicleId,
    ranked,
    explanation: "A single fresh candidate has a sufficient evidence margin.",
  };
}

function rank(candidate: VehicleObservation, request: MatchRequest, now: number): RankedCandidate {
  let score = 0;
  const evidence: string[] = [];
  const rejectedReasons: string[] = [];
  if (candidate.routeId !== request.routeId) rejectedReasons.push("wrong_route");
  else {
    score += 30;
    evidence.push("route_id");
  }

  if (request.directionCode && candidate.directionCode !== request.directionCode) {
    rejectedReasons.push("wrong_direction");
  } else if (request.directionCode) {
    score += 25;
    evidence.push("direction");
  }

  const ageSeconds = (now - new Date(candidate.observedAt).valueOf()) / 1_000;
  if (candidate.timestampSource === "unavailable" || !Number.isFinite(ageSeconds) || ageSeconds < -10 || ageSeconds > MAX_AGE_SECONDS) {
    rejectedReasons.push("stale_or_invalid_timestamp");
  } else {
    score += Math.max(0, 25 - ageSeconds / 6);
    evidence.push("fresh_observation");
  }

  if (candidate.stopSequence !== undefined) {
    const distance = Math.abs(candidate.stopSequence - request.boardingStopSequence);
    score += Math.max(0, 20 - distance * 5);
    evidence.push(`boarding_stop_delta_${distance}`);
    if (distance > 4) rejectedReasons.push("implausible_boarding_position");
  } else if (hasCoordinate(candidate) && hasBoardingCoordinate(request)) {
    const meters = distanceMeters(
      { latitude: candidate.latitude, longitude: candidate.longitude },
      { latitude: request.boardingLatitude, longitude: request.boardingLongitude },
    );
    if (meters <= BOARDING_STOP_RADIUS_METERS) {
      score += 20;
      evidence.push(`boarding_proximity_${Math.round(meters)}m`);
    } else if (meters <= BOARDING_NEAR_RADIUS_METERS) {
      score += 10;
      evidence.push(`boarding_near_${Math.round(meters)}m`);
    } else {
      evidence.push(`boarding_distance_${Math.round(meters)}m`);
    }
  } else {
    evidence.push("position_missing");
  }

  return { vehicleId: candidate.vehicleId, score: Math.round(score * 10) / 10, evidence, rejectedReasons };
}

function hasCoordinate(
  candidate: VehicleObservation,
): candidate is VehicleObservation & { latitude: number; longitude: number } {
  return Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude);
}

function hasBoardingCoordinate(
  request: MatchRequest,
): request is MatchRequest & { boardingLatitude: number; boardingLongitude: number } {
  return Number.isFinite(request.boardingLatitude) && Number.isFinite(request.boardingLongitude);
}
