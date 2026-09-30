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
    "제주출입국·외국인청",
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
