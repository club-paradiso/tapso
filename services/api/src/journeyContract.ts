/**
 * TAPSO Journey Contract v1: one vocabulary for a journey and for what every
 * surface shows during it.
 *
 * The server, the Swift core (`packages/transit-core/.../JourneyContract.swift`)
 * and the marketing site must not each invent their own journey semantics. The
 * language-neutral specification is `fixtures/journey/journey-contract-v1.json`;
 * both implementations run every case in it. The product description is
 * `docs/product/JOURNEY_CONTRACT_V3.md`.
 *
 * Nothing here decides which bus a rider is on. Vehicle selection stays with
 * the directed matcher and the rider's confirmation; this module only names the
 * journey's shape and picks the single most important thing to show.
 */

export const JOURNEY_CONTRACT_VERSION = "tapso-journey-contract-v1";

export const SEGMENT_KINDS = ["walk", "ride", "transfer"] as const;
export const PRE_RIDE_STAGES = ["searching", "proposed", "similarBuses", "choose", "notFoundYet", "confirmed"] as const;
export const RIDE_MOMENTS = [
  "riding",
  "prepare",
  "nextStop",
  "arrived",
  "passedDestination",
  "delayed",
  "vehicleLost",
  "offline",
  "checking",
  "ended",
] as const;
export const TRANSFER_RISKS = ["safe", "tight", "atRisk", "missed", "recovering", "unknown"] as const;
export const SAFE_RETURN_LEVELS = ["comfortable", "leaveBy", "tight", "notRecommended", "unknown"] as const;
export const SURFACE_STATES = [
  "waiting",
  "confirm",
  "riding",
  "prepare",
  "nextStop",
  "transfer",
  "transferRisk",
  "arrival",
  "delayed",
  "checking",
  "discovery",
  "recovery",
  "ended",
] as const;
export const NEXT_ACTIONS = [
  "walkToStop",
  "waitForBus",
  "confirmBus",
  "stayOnBus",
  "prepareToExit",
  "pressStopButton",
  "exitHere",
  "exitAndTransfer",
  "boardNextBus",
  "checkBusDisplay",
  "keepWatching",
  "checkAlternative",
  "followRecovery",
  "considerStop",
  "finish",
] as const;

export type SegmentKind = (typeof SEGMENT_KINDS)[number];
export type PreRideStage = (typeof PRE_RIDE_STAGES)[number];
/** The per-ride moment `RideGuidancePolicy` produces in the Swift core. */
export type RideMoment = (typeof RIDE_MOMENTS)[number];
export type TransferRisk = (typeof TRANSFER_RISKS)[number];
export type SafeReturnLevel = (typeof SAFE_RETURN_LEVELS)[number];
export type SurfaceState = (typeof SURFACE_STATES)[number];
export type NextAction = (typeof NEXT_ACTIONS)[number];

/** One segment of a journey, in the specification's minimal shape. */
export interface JourneySegmentSpec {
  kind: SegmentKind;
  /** Walking distance for a walk or transfer; absent when not measured. */
  meters?: number;
  routeNumber?: string;
  boardSequence?: number;
  alightSequence?: number;
}

export type JourneyContractError =
  | "noRide"
  | "missingTransfer"
  | "danglingTransfer"
  | "invalidRideOrder"
  | "walkBetweenRides"
  | "invalidDistance";

export type JourneyValidation =
  | { valid: true; rideCount: number; transferCount: number }
  | { valid: false; error: JourneyContractError };

/**
 * A journey is a sequence of segments with at least one ride. Consecutive rides
 * are joined by exactly one transfer, which is where the Transfer Guardian
 * watches; a walk is only ever the first or the last mile.
 */
export function validateJourneySegments(segments: readonly JourneySegmentSpec[]): JourneyValidation {
  let rideCount = 0;
  let transferCount = 0;
  for (const [index, segment] of segments.entries()) {
    if (segment.meters !== undefined && !(Number.isFinite(segment.meters) && segment.meters >= 0)) {
      return { valid: false, error: "invalidDistance" };
    }
    const previous = segments[index - 1];
    const next = segments[index + 1];
    if (segment.kind === "ride") {
      rideCount += 1;
      const board = segment.boardSequence;
      const alight = segment.alightSequence;
      if (board === undefined || alight === undefined || !(alight > board)) {
        return { valid: false, error: "invalidRideOrder" };
      }
      if (previous?.kind === "ride") return { valid: false, error: "missingTransfer" };
    } else if (segment.kind === "transfer") {
      transferCount += 1;
      if (previous?.kind !== "ride" || next?.kind !== "ride") return { valid: false, error: "danglingTransfer" };
    } else if (previous?.kind === "ride" && segments.slice(index + 1).some((later) => later.kind === "ride")) {
      return { valid: false, error: "walkBetweenRides" };
    }
  }
  if (rideCount === 0) return { valid: false, error: "noRide" };
  return { valid: true, rideCount, transferCount };
}

/** What the surface resolution reads. Every field is a fact some other system already decided. */
export interface SurfaceInput {
  /** The kind of segment the rider is in now. */
  segment: SegmentKind;
  /** True when no ride segment follows the current one. */
  finalLeg: boolean;
  /** The vehicle check, before a ride moment exists. */
  preRide?: PreRideStage;
  /** The current ride's guidance moment (`RideGuidancePolicy`), once riding. */
  rideMoment?: RideMoment;
  /** The Transfer Guardian's view of the next connection, if one is planned. */
  transferRisk?: TransferRisk;
  /** A Rescue plan is in force (missed stop, missed connection, wrong direction). */
  recoveryActive?: boolean;
  /** A next-stop discovery is available for this ride. */
  discoveryHint?: boolean;
}

export interface ResolvedSurface {
  state: SurfaceState;
  action: NextAction;
}

/**
 * The single most important thing to show now, for the app hero, the Lock
 * Screen and every Dynamic Island region alike. Fail closed: anything the rules
 * do not recognise as a confident moment becomes `checking`, which never alerts.
 *
 * Precedence, highest first: ended; an active recovery; the segment's own
 * moment, where getting off at the right stop outranks a risky connection and
 * late data outranks everything that depends on timing; a connection at risk;
 * a discovery hint, offered only on the final ride so TAPSO never suggests a
 * detour while a connection is planned.
 */
export function resolveSurface(input: SurfaceInput): ResolvedSurface {
  if (input.rideMoment === "ended") return { state: "ended", action: "finish" };
  if (input.recoveryActive) return { state: "recovery", action: "followRecovery" };

  switch (input.segment) {
    case "walk":
      return input.finalLeg ? { state: "arrival", action: "finish" } : { state: "waiting", action: "walkToStop" };
    case "transfer":
      switch (input.transferRisk) {
        case "recovering":
          return { state: "recovery", action: "followRecovery" };
        case "atRisk":
        case "missed":
          return { state: "transferRisk", action: "checkAlternative" };
        default:
          return { state: "transfer", action: "boardNextBus" };
      }
    case "ride":
      return resolveRide(input);
  }
}

function resolveRide(input: SurfaceInput): ResolvedSurface {
  const moment = input.rideMoment;
  if (moment === undefined) {
    switch (input.preRide) {
      case "searching":
      case "notFoundYet":
        return { state: "waiting", action: "waitForBus" };
      case "proposed":
      case "similarBuses":
      case "choose":
        return { state: "confirm", action: "confirmBus" };
      default:
        return { state: "checking", action: "keepWatching" };
    }
  }
  switch (moment) {
    case "passedDestination":
      return { state: "recovery", action: "followRecovery" };
    case "arrived":
      return input.finalLeg ? { state: "arrival", action: "exitHere" } : { state: "transfer", action: "exitAndTransfer" };
    case "nextStop":
      return { state: "nextStop", action: "pressStopButton" };
    case "prepare":
      return { state: "prepare", action: "prepareToExit" };
    case "delayed":
    case "offline":
      return { state: "delayed", action: "checkBusDisplay" };
    case "vehicleLost":
      return { state: "delayed", action: "keepWatching" };
    case "checking":
      return { state: "checking", action: "keepWatching" };
    case "riding": {
      if (!input.finalLeg) {
        if (input.transferRisk === "recovering") return { state: "recovery", action: "followRecovery" };
        if (input.transferRisk === "atRisk" || input.transferRisk === "missed") {
          return { state: "transferRisk", action: "checkAlternative" };
        }
      }
      if (input.finalLeg && input.discoveryHint) return { state: "discovery", action: "considerStop" };
      return { state: "riding", action: "stayOnBus" };
    }
    case "ended":
      return { state: "ended", action: "finish" };
  }
}
