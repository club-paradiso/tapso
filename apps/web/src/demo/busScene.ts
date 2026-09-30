/**
 * SYNTHETIC. The "which 365 am I on?" illustration.
 *
 * It explains the product rule, not the matcher: before the rider is aboard a
 * bus that has already left the boarding stop cannot be theirs, two plausible
 * buses become a question rather than a pick, and a bus is selected only when
 * the rider confirms it (`docs/product/INFORMATION_ARCHITECTURE_V2.md` › Bus
 * check; `docs/KNOWN_ISSUES.md` › automatic vehicle selection is off). No
 * score, percentage or internal term is shown.
 */

export const BUS_VIEWS = ["routeOnly", "tapso", "similar"] as const;
export type BusView = (typeof BUS_VIEWS)[number];

export type BusRole =
  /** Only the route number is known. */
  | "unknown"
  /** Offered to the rider to confirm. */
  | "proposed"
  /** One of two plausible buses; the rider picks. */
  | "choice"
  /** Already beyond the boarding stop, so it cannot be the rider's bus. */
  | "passed"
  /** Still several stops away. */
  | "farther";

export type SceneBus = {
  id: string;
  /** SYNTHETIC plate ending. */
  plate: string;
  /** Stops before the boarding stop; negative means it has already passed it. */
  stopsAway: number;
  role: BusRole;
  note: string;
};

export type BusScene = {
  view: BusView;
  tab: string;
  headline: string;
  detail: string;
  buses: SceneBus[];
  /** True when the rider is asked to pick between buses. */
  asksRider: boolean;
};

export const BUS_SCENES: Record<BusView, BusScene> = {
  routeOnly: {
    view: "routeOnly",
    tab: "번호만 볼 때",
    headline: "세 대 모두 365번이에요",
    detail: "노선 번호로는 방향도, 내가 탄 차량도 알 수 없어요. 남은 정거장은 그 차량을 따라가야 맞아요.",
    asksRider: false,
    buses: [
      { id: "a", plate: "••0001", stopsAway: 0, role: "unknown", note: "어느 차량?" },
      { id: "b", plate: "••0417", stopsAway: -1, role: "unknown", note: "어느 차량?" },
      { id: "c", plate: "••0932", stopsAway: 3, role: "unknown", note: "어느 차량?" },
    ],
  },
  tapso: {
    view: "tapso",
    tab: "탑서가 볼 때",
    headline: "이 버스로 보여요",
    detail: "타는 정류장을 기준으로 봐요. 이미 지나간 버스는 내 버스일 수 없고, 최종 확인은 탑승자가 해요.",
    asksRider: false,
    buses: [
      { id: "a", plate: "••0001", stopsAway: 0, role: "proposed", note: "정류장에 도착" },
      { id: "b", plate: "••0417", stopsAway: -1, role: "passed", note: "이미 지나감" },
      { id: "c", plate: "••0932", stopsAway: 3, role: "farther", note: "3정거장 전" },
    ],
  },
  similar: {
    view: "similar",
    tab: "비슷한 버스가 있을 때",
    headline: "비슷한 버스가 있어요",
    detail: "두 대 모두 그럴듯하면 대신 고르지 않아요. 탄 버스를 골라주세요. 둘 다 아니면 계속 찾아요.",
    asksRider: true,
    buses: [
      { id: "a", plate: "••0001", stopsAway: 0, role: "choice", note: "정류장에 도착" },
      { id: "d", plate: "••0002", stopsAway: 1, role: "choice", note: "1정거장 전" },
      { id: "b", plate: "••0417", stopsAway: -1, role: "passed", note: "이미 지나감" },
    ],
  },
};
