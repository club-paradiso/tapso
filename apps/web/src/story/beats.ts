import { presentMoment, type RideMoment } from "../demo/rideMoments.ts";
import type { StoryScreen } from "../demo/rideStory.ts";

/**
 * The Island Story Engine: one SYNTHETIC ride, told beat by beat.
 *
 * Every demo on the page — the sticky phone, each step's picture, the
 * persistent island and the hero — reads this table instead of choosing a
 * state of its own. A beat says where the rider's phone is and what TAPSO's
 * Live Activity shows at that point; how a moment looks (colour, count,
 * symbol, alert) comes from `presentMoment`, the web mirror of
 * `RideGuidancePolicy` that `test/productParity.test.ts` pins to Swift.
 *
 * Product rules the table encodes, each checked in `test/islandStory.test.ts`:
 * - The Live Activity starts when the rider confirms the bus
 *   (`TapsoAppModel.confirmVehicle` → `startLiveActivity`). Before that no
 *   island on the page carries anything.
 * - iOS does not show an app's own Live Activity in the island while that app
 *   is in front, so a beat that shows the TAPSO app never fills the island.
 * - Stops only count down; the alerts at two stops, the next stop and arrival
 *   each happen once (`alertedMilestones` in the app).
 * - When the data is late or the bus is missing the count is dimmed or
 *   hidden, never shown as fresh, and nothing alerts.
 */

export type Chapter = "plan" | "confirm" | "ride" | "trust" | "arrive";

export const CHAPTERS: readonly { id: Chapter; index: string; eyebrow: string }[] = [
  { id: "plan", index: "01", eyebrow: "정하기" },
  { id: "confirm", index: "02", eyebrow: "확인하기" },
  { id: "ride", index: "03", eyebrow: "타고 가기" },
  { id: "trust", index: "04", eyebrow: "흔들릴 때" },
  { id: "arrive", index: "05", eyebrow: "내릴 때" },
];

export type IslandForm = "compact" | "expanded" | "minimal";

/** What the TAPSO Live Activity shows. */
export type Activity = { moment: RideMoment; remaining: number };

/** Where the rider's phone is at a beat. */
export type Stage =
  /** The TAPSO app is open. */
  | { kind: "app"; screen: StoryScreen }
  /** The phone is locked: the Live Activity is the Lock Screen banner. */
  | { kind: "lock" }
  /** Another app or the Home Screen is in front: the island carries the activity. */
  | { kind: "home"; form: IslandForm };

export type BeatVariant = {
  id: string;
  /** Button text for the variant picker. */
  label: string;
  stage?: Stage;
  activity?: Activity;
};

export type BeatId =
  | "destination"
  | "boarding"
  | "sameBus"
  | "proposed"
  | "confirmed"
  | "pocket"
  | "island"
  | "trust"
  | "prepare"
  | "nextStop"
  | "arrived";

export type Beat = {
  id: BeatId;
  chapter: Chapter;
  stage: Stage;
  /** The TAPSO Live Activity at this beat; `null` while none runs. */
  activity: Activity | null;
  /** Alternatives the visitor can pick inside the beat; the first is the default. */
  variants?: readonly BeatVariant[];
};

/** Stops left while the trip is under way and the data is shaky: the last count the app trusted. */
const LAST_KNOWN = 4;

export const BEATS: readonly Beat[] = [
  { id: "destination", chapter: "plan", stage: { kind: "app", screen: { kind: "search" } }, activity: null },
  { id: "boarding", chapter: "plan", stage: { kind: "app", screen: { kind: "boarding" } }, activity: null },
  { id: "sameBus", chapter: "confirm", stage: { kind: "app", screen: { kind: "check", stage: "searching" } }, activity: null },
  { id: "proposed", chapter: "confirm", stage: { kind: "app", screen: { kind: "check", stage: "proposed" } }, activity: null },
  {
    id: "confirmed",
    chapter: "confirm",
    stage: { kind: "app", screen: { kind: "check", stage: "confirmed" } },
    activity: { moment: "riding", remaining: 6 },
  },
  { id: "pocket", chapter: "ride", stage: { kind: "lock" }, activity: { moment: "riding", remaining: 6 } },
  {
    id: "island",
    chapter: "ride",
    stage: { kind: "home", form: "compact" },
    activity: { moment: "riding", remaining: 5 },
    variants: [
      { id: "compact", label: "작게", stage: { kind: "home", form: "compact" } },
      { id: "expanded", label: "길게 누르면", stage: { kind: "home", form: "expanded" } },
      { id: "minimal", label: "다른 현황과 겹치면", stage: { kind: "home", form: "minimal" } },
    ],
  },
  {
    id: "trust",
    chapter: "trust",
    stage: { kind: "lock" },
    activity: { moment: "delayed", remaining: LAST_KNOWN },
    variants: [
      { id: "delayed", label: "정보 지연", activity: { moment: "delayed", remaining: LAST_KNOWN } },
      { id: "vehicleLost", label: "버스 놓침", activity: { moment: "vehicleLost", remaining: LAST_KNOWN } },
      { id: "offline", label: "오프라인", activity: { moment: "offline", remaining: LAST_KNOWN } },
      { id: "checking", label: "다시 확인 중", activity: { moment: "checking", remaining: LAST_KNOWN } },
    ],
  },
  { id: "prepare", chapter: "arrive", stage: { kind: "lock" }, activity: { moment: "prepare", remaining: 2 } },
  { id: "nextStop", chapter: "arrive", stage: { kind: "lock" }, activity: { moment: "nextStop", remaining: 1 } },
  { id: "arrived", chapter: "arrive", stage: { kind: "lock" }, activity: { moment: "arrived", remaining: 0 } },
];

export function beat(id: BeatId): Beat {
  const found = BEATS.find((b) => b.id === id);
  if (!found) throw new Error(`unknown beat ${id}`);
  return found;
}

export function beatsOf(chapter: Chapter): Beat[] {
  return BEATS.filter((b) => b.chapter === chapter);
}

/** A beat with the visitor's pick applied. Unknown or absent picks fall back to the default. */
export function resolveBeat(b: Beat, variantId?: string): { stage: Stage; activity: Activity | null; variant?: BeatVariant } {
  const variant = b.variants?.find((v) => v.id === variantId) ?? b.variants?.[0];
  return {
    stage: variant?.stage ?? b.stage,
    activity: variant?.activity ?? b.activity,
    ...(variant ? { variant } : {}),
  };
}

/**
 * What the phone's own island shows at a stage. The app in front never shows
 * its own activity there, and nothing shows before the activity exists.
 */
export function islandOnPhone(stage: Stage, activity: Activity | null): { activity: Activity; form: IslandForm } | null {
  if (stage.kind !== "home" || activity === null) return null;
  return { activity, form: stage.form };
}

/**
 * The alert a newly reached beat may raise: a milestone (two stops, next stop,
 * arrival) that has not been signalled on this ride. The web mirror of the
 * app's `alertedMilestones`; degraded moments are never milestones.
 */
export function milestoneToSignal(activity: Activity | null, signalled: ReadonlySet<RideMoment>): RideMoment | null {
  if (activity === null) return null;
  if (!presentMoment(activity.moment).milestone) return null;
  return signalled.has(activity.moment) ? null : activity.moment;
}

/** The hero's short loop: the ride's escalation, nothing else. */
export const HERO_LOOP: readonly Activity[] = [
  { moment: "riding", remaining: 6 },
  { moment: "prepare", remaining: 2 },
  { moment: "nextStop", remaining: 1 },
  { moment: "arrived", remaining: 0 },
];

/** Short labels for the hero's journey rail. */
export function loopLabel(activity: Activity): string {
  switch (activity.moment) {
    case "riding":
    case "prepare":
      return `${activity.remaining}정거장`;
    case "nextStop":
      return "다음 하차";
    case "arrived":
      return "도착";
    default:
      return presentMoment(activity.moment).eyebrow;
  }
}
