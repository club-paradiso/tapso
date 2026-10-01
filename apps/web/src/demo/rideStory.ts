import type { RideMoment } from "./rideMoments.ts";

/**
 * The one ride every marketing demo tells.
 *
 * Route topology is the current official 365 full-length direction
 * JEB405136522 (제주한라대학교 → 제주대학교), fetched through TAPSO's
 * production TAGO-backed /v1/stops endpoint on 2026-10-01. Stop names and
 * order below are real provider topology. Vehicle identity, plate and playback
 * timing remain synthetic; the marketing demo is not a live bus observation.
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

export type Chapter = "plan" | "confirm" | "ride";

export const CHAPTER_LABELS: Record<Chapter, string> = {
  plan: "정하기",
  confirm: "확인하기",
  ride: "타고 가기",
};

export type StoryScreen =
  | { kind: "search" }
  | { kind: "route" }
  | { kind: "boarding" }
  | { kind: "check"; stage: "searching" | "proposed" | "confirmed" }
  | { kind: "ride"; moment: Extract<RideMoment, "riding" | "prepare" | "nextStop" | "arrived">; remaining: number };

export type StoryStep = {
  id: string;
  chapter: Chapter;
  /** Short label for the step rail. */
  label: string;
  title: string;
  body: string;
  screen: StoryScreen;
};

export const RIDE_STORY: readonly StoryStep[] = [
  {
    id: "destination",
    chapter: "plan",
    label: "내릴 곳",
    title: "어디서 내릴지만 정하세요",
    body: "출발지부터 묻지 않아요. 버스에서 필요한 건 내릴 정류장이니까요.",
    screen: { kind: "search" },
  },
  {
    id: "route",
    chapter: "plan",
    label: "탈 버스",
    title: "그곳에 가는 버스를 골라요",
    body: "내릴 곳에 닿는 노선과 방향만 보여줘요. 한 방향뿐이면 이 단계는 건너뛰어요.",
    screen: { kind: "route" },
  },
  {
    id: "boarding",
    chapter: "plan",
    label: "타는 곳",
    title: "타는 정류장을 알려주세요",
    body: "내릴 곳에서 가까운 정류장부터 보여줘요. 몇 정거장 가는지도 함께요.",
    screen: { kind: "boarding" },
  },
  {
    id: "searching",
    chapter: "confirm",
    label: "버스 찾기",
    title: "정류장으로 오는 버스를 찾아요",
    body: "같은 365번이 여러 대 달려요. 탑서는 타는 정류장으로 오는 버스를 한 대씩 살펴봐요.",
    screen: { kind: "check", stage: "searching" },
  },
  {
    id: "proposed",
    chapter: "confirm",
    label: "이 버스?",
    title: "이 버스로 보이면, 물어봐요",
    body: "번호판 끝자리를 보여드려요. 탈 때 한 번만 맞는지 확인해주세요.",
    screen: { kind: "check", stage: "proposed" },
  },
  {
    id: "confirmed",
    chapter: "confirm",
    label: "확인",
    title: "확인하면, 그 버스를 지켜봐요",
    body: "이때부터 잠금 화면과 다이나믹 아일랜드 안내가 시작돼요.",
    screen: { kind: "check", stage: "confirmed" },
  },
  {
    id: "riding",
    chapter: "ride",
    label: "6정거장",
    title: "이제 휴대폰은 넣어두세요",
    body: "남은 정거장은 잠금 화면에 떠 있어요. 들여다보지 않아도 돼요.",
    screen: { kind: "ride", moment: "riding", remaining: 6 },
  },
  {
    id: "prepare",
    chapter: "ride",
    label: "2정거장",
    title: "2정거장 전, 일어설 시간을 드려요",
    body: "화면이 켜지고 한 번 알려드려요. 짐을 챙길 시간이에요.",
    screen: { kind: "ride", moment: "prepare", remaining: 2 },
  },
  {
    id: "nextStop",
    chapter: "ride",
    label: "다음 하차",
    title: "다음 정류장이면, 가장 크게",
    body: "잠금 화면 안내가 통째로 산호색으로 바뀌어요. 하차벨을 누를 때예요.",
    screen: { kind: "ride", moment: "nextStop", remaining: 1 },
  },
  {
    id: "arrived",
    chapter: "ride",
    label: "도착",
    title: "여기서 내려요",
    body: "도착하면 여정이 끝나요. 걸어가는 길은 지도 앱에 맡겨요.",
    screen: { kind: "ride", moment: "arrived", remaining: 0 },
  },
];

export function clampStep(index: number): number {
  return Math.max(0, Math.min(RIDE_STORY.length - 1, index));
}
