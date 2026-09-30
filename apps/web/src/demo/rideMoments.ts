import { IOS_COPY, type CopyKey } from "./rideCopy.ts";

/**
 * A web mirror of the ride moments `RideGuidancePolicy` produces in
 * `packages/transit-core/Sources/TapsoTransit/RideGuidance.swift`.
 *
 * The website only *shows* moments. It never derives one from data: each demo
 * names the moment it is illustrating, and this table says how the native
 * surfaces present it (colour role, count, symbol, trust signals, alert).
 * `test/rideMoments.test.ts` pins every row to the Swift policy and to
 * `docs/product/JOURNEY_STATE_MODEL_V2.md`.
 */

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
] as const;

export type RideMoment = (typeof RIDE_MOMENTS)[number];

export type ColorRole = "active" | "prepare" | "next" | "arrival" | "checking" | "degraded";
export type CountPresentation = "live" | "lastKnown" | "hidden";
export type VehicleStatus = "confirmed" | "rechecking" | "lost";
export type DataStatus = "live" | "delayed" | "offline" | "checking";
export type MomentSymbol =
  | "bus"
  | "stand"
  | "bell"
  | "walk"
  | "uturn"
  | "clock"
  | "search"
  | "wifiOff"
  | "refresh";
/** Lock Screen surface: basalt while riding, coral at the next stop, tangerine on arrival. */
export type Surface = "basalt" | "coral" | "tangerine";

export type MomentPresentation = {
  moment: RideMoment;
  colorRole: ColorRole;
  count: CountPresentation;
  symbol: MomentSymbol;
  /** Whether a Live Activity alert (screen, sound, expanded island) belongs to this moment. */
  milestone: boolean;
  surface: Surface;
  /** A representative signal for the demo; the Swift policy computes these independently. */
  vehicle: VehicleStatus;
  data: DataStatus;
  eyebrow: string;
  headline: string;
  detail: string;
  /** Island compact-trailing pill text; absent while riding, where the count is shown instead. */
  compact?: string;
};

const COLOR_ROLE: Record<RideMoment, ColorRole> = {
  riding: "active",
  prepare: "prepare",
  nextStop: "next",
  passedDestination: "next",
  arrived: "arrival",
  checking: "checking",
  delayed: "degraded",
  vehicleLost: "degraded",
  offline: "degraded",
};

const COUNT: Record<RideMoment, CountPresentation> = {
  riding: "live",
  prepare: "live",
  nextStop: "live",
  delayed: "lastKnown",
  vehicleLost: "lastKnown",
  offline: "lastKnown",
  arrived: "hidden",
  passedDestination: "hidden",
  checking: "hidden",
};

const SYMBOL: Record<RideMoment, MomentSymbol> = {
  riding: "bus",
  prepare: "stand",
  nextStop: "bell",
  arrived: "walk",
  passedDestination: "uturn",
  delayed: "clock",
  vehicleLost: "search",
  offline: "wifiOff",
  checking: "refresh",
};

/** Two signals, computed apart: "the right bus, late data" must be expressible. */
const SIGNALS: Record<RideMoment, { vehicle: VehicleStatus; data: DataStatus }> = {
  riding: { vehicle: "confirmed", data: "live" },
  prepare: { vehicle: "confirmed", data: "live" },
  nextStop: { vehicle: "confirmed", data: "live" },
  arrived: { vehicle: "confirmed", data: "live" },
  passedDestination: { vehicle: "confirmed", data: "live" },
  delayed: { vehicle: "confirmed", data: "delayed" },
  vehicleLost: { vehicle: "lost", data: "live" },
  offline: { vehicle: "confirmed", data: "offline" },
  checking: { vehicle: "rechecking", data: "live" },
};

function copy(key: string): string {
  return IOS_COPY[key as CopyKey];
}

export function presentMoment(moment: RideMoment): MomentPresentation {
  const compactKey = `ride.${moment}.compact`;
  return {
    moment,
    colorRole: COLOR_ROLE[moment],
    count: COUNT[moment],
    symbol: SYMBOL[moment],
    milestone: moment === "prepare" || moment === "nextStop" || moment === "arrived",
    surface:
      moment === "nextStop" || moment === "passedDestination"
        ? "coral"
        : moment === "arrived"
          ? "tangerine"
          : "basalt",
    ...SIGNALS[moment],
    eyebrow: copy(`ride.${moment}.eyebrow`),
    headline: copy(`ride.${moment}.headline`),
    detail: copy(`ride.${moment}.detail`),
    ...(compactKey in IOS_COPY ? { compact: copy(compactKey) } : {}),
  };
}

export function vehicleLabel(status: VehicleStatus): string {
  return copy(`trust.vehicle.${status}`);
}

export function dataLabel(status: DataStatus): string {
  return copy(`trust.data.${status}`);
}

/**
 * The one sentence VoiceOver reads for a ride surface, in the shape of the
 * app's `a11y.ride.live` / `lastKnown` / `hidden` strings.
 */
export function spokenSummary(
  p: MomentPresentation,
  route: string,
  destination: string,
  remaining: number,
): string {
  const tail = `${p.headline}. ${p.detail}.`;
  if (p.count === "live") return `${route}번, ${destination}까지 ${remaining}정거장 남음. ${tail}`;
  if (p.count === "lastKnown") return `${route}번, ${destination}까지. 마지막 확인 기준 ${remaining}정거장 남음. ${tail}`;
  return `${route}번, ${destination}. ${tail}`;
}
