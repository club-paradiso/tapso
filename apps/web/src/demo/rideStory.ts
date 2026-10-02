import type { RideMoment } from "./rideMoments.ts";

/**
 * The one ride every marketing demo tells.
 *
 * Route topology is the verified 365 full-length direction JEB405136522
 * (제주한라대학교 → 제주대학교), checked through TAPSO's TAGO-backed
 * production /v1/stops path on 2026-10-01. Stop names and order below are
 * provider topology. Vehicle identity, plate and playback timing remain
 * synthetic; this is not a live bus observation.
 */
export const DEMO_ROUTE = {
  number: "365",
  sourceRouteId: "JEB405136522",
  sourceCheckedOn: "2026-10-01",
  outboundHeadsign: "제주대학교",
  inboundHeadsign: "제주한라대학교",
  stops: [
    "제주한라대학교[동]",
    "정존마을[동]",
    "노형초등학교[동]",
    "노형오거리(한라병원방면)[동]",
    "남녕고등학교",
    "한라병원[동]",
    "삼무공원사거리/롯데시티호텔[남]",
    "제원아파트[서]",
    "은남동[남]",
    "도호동[남]",
    "연동주민센터",
    "제주도청 신제주로터리[동]",
    "제주국제공항3(용담,시청)[북]",
    "월성마을/선사유적지",
    "용문마을회관[동]",
    "용문마을[동]",
    "용문사거리[동]",
    "용담1동주민센터[남]",
    "제주중학교/제주향교",
    "서문시장[남]",
    "관덕정[남]",
    "중앙로 제민신협본점[서]",
    "시민회관[서]",
    "삼성초등학교",
    "광양[서]",
    "제주시청(아라방면)",
    "고산동산(아라방면) / 국립제주트라우마치유센터",
    "제주지방법원(아라방면)",
    "제주중앙여자고등학교/한국 소방안전원",
    "제주여자중고등학교(아라방면)",
    "남국원(아라방면)",
    "아라초등학교[서]",
    "아라주공아파트/아라스위첸아파트[서]",
    "인다마을[서]",
    "제주대학교병원[서]",
    "죽성마을 입구[서]",
    "남국사[서]",
    "제주대학교입구[남]",
    "제대마을[남]",
    "제대아파트[남]",
    "제주대학교[남]",
  ],
} as const;

export const DEMO_TRIP = {
  /** 제주국제공항3(용담,시청)[북], provider sequence 13. */
  boardingIndex: 12,
  /** 제주시청(아라방면), provider sequence 26. */
  destinationIndex: 25,
  /** SYNTHETIC plate ending, formatted as the app masks it. */
  plate: "••0001",
} as const;

/** All stops before the destination are valid boarding choices on this direction. */
export const ROUTE_BOARDING_COUNT = DEMO_TRIP.destinationIndex;
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

/** 0 at the selected boarding stop, 1 at the destination. */
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
