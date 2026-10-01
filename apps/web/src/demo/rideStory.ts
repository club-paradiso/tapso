import type { RideMoment } from "./rideMoments.ts";

/**
 * SYNTHETIC. The one ride every demo on the page tells.
 *
 * Stop names and order are the app's own demo route
 * (`packages/transit-core/Sources/TapsoTransit/DemoFixtures.swift`); plates are
 * invented. Nothing here describes a real Jeju bus or a live observation.
 */
export const DEMO_ROUTE = {
  number: "365",
  outboundHeadsign: "국립제주박물관",
  inboundHeadsign: "제주버스터미널",
  stops: [
    "제주버스터미널",
    "용문마을",
    "용담사거리",
    "서문시장",
    "관덕정",
    "중앙로",
    "동문로터리",
    "제주여자상업고등학교",
    "제주시청(아라방면)",
    "국립제주박물관",
  ],
} as const;

export const DEMO_TRIP = {
  boardingIndex: 0,
  destinationIndex: 8,
  /** SYNTHETIC plate ending, formatted as the app masks it. */
  plate: "••0001",
} as const;

export const TRIP_TOTAL_STOPS = DEMO_TRIP.destinationIndex - DEMO_TRIP.boardingIndex;

export function stopName(index: number): string {
  return DEMO_ROUTE.stops[index] ?? "";
}

export const BOARDING_STOP = stopName(DEMO_TRIP.boardingIndex);
export const DESTINATION_STOP = stopName(DEMO_TRIP.destinationIndex);

/** Where the bus is, and what comes next, for a given number of stops left. */
export function positionFor(remaining: number): { current: string; next: string | undefined } {
  const index = DEMO_TRIP.destinationIndex - remaining;
  return {
    current: stopName(index),
    next: remaining > 0 ? stopName(index + 1) : undefined,
  };
}

/** 0 at boarding, 1 at the destination. */
export function railProgress(remaining: number): number {
  const done = TRIP_TOTAL_STOPS - Math.max(0, Math.min(TRIP_TOTAL_STOPS, remaining));
  return done / TRIP_TOTAL_STOPS;
}

export type StoryScreen =
  | { kind: "search" }
  | { kind: "route" }
  | { kind: "boarding" }
  | { kind: "check"; stage: "searching" | "proposed" | "confirmed" }
  | { kind: "ride"; moment: Extract<RideMoment, "riding" | "prepare" | "nextStop" | "arrived">; remaining: number };
