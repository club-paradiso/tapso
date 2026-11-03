import type { BeatId, Chapter } from "./beats.ts";

/**
 * Words for the journey. Product strings the app itself shows are quoted from
 * `src/demo/rideCopy.ts`; this file holds only the page's own explanation.
 * Each claim here is true of the iOS build today or says that it is not yet.
 */

export const CHAPTER_COPY: Record<Chapter, { title: string; lede: string }> = {
  plan: {
    title: "내릴 곳만 정하면 돼요.",
    lede: "TAPSO는 목적지 검색부터 탑승 정류장 선택, 하차 안내까지 이어줘요. 실제로 탄 버스를 확인하면 남은 정거장과 내릴 때를 한눈에 볼 수 있어요.",
  },
  confirm: {
    title: "365번 버스, 내가 탄 차를 확인해요.",
    lede: "같은 번호의 버스가 여러 대 다녀요. 남은 정거장을 정확히 알려드리려면, 내가 탄 버스를 한 번만 확인해 주세요.",
  },
  ride: {
    title: "잠금 화면에서 남은 정거장을 확인해요.",
    lede: "탄 버스를 확인하면, 잠금 화면과 다이나믹 아일랜드에 남은 정거장이 표시돼요.",
  },
  trust: {
    title: "확인된 위치만 알려드려요.",
    lede: "버스 위치가 늦거나 끊기면 화면에 그대로 보여드려요. 오래된 위치를 지금 위치처럼 알려드리지 않아요.",
  },
  arrive: {
    title: "내릴 준비부터 도착까지 알려드려요.",
    lede: "2정거장 전, 다음 정류장, 도착할 때 알려주도록 만들었어요. 실제 iPhone에서는 아직 확인하지 못했어요.",
  },
};

export type StepCopy = {
  /** Short stop name on the journey rail. */
  label: string;
  title: string;
  body: string;
  /** A plain statement of what the current build does not do yet. */
  note?: string;
};

export const STEP_COPY: Record<BeatId, StepCopy> = {
  destination: {
    label: "내릴 곳",
    title: "어디서 내릴지부터 골라요",
    body: "정류장 이름, 도착할 주소, 건물 이름 중 아는 걸 입력해보세요. 정류장은 바로 찾고, 주소나 건물은 근처 하차 정류장을 골라 시작할 수 있어요. 지도 앱에서 공유한 장소도 가져올 수 있어요.",
  },
  boarding: {
    label: "타는 곳",
    title: "어느 버스를 어디서 탈까요?",
    body: "내릴 곳으로 가는 버스를 확인하고, 타는 정류장을 골라주세요. 선택한 정류장에서 목적지까지 몇 정거장인지 TAPSO가 보여줘요.",
  },
  sameBus: {
    label: "같은 번호",
    title: "같은 노선에도 여러 대가 다녀요",
    body: "365번 버스도 여러 대가 양방향으로 다녀요. TAPSO는 타는 정류장으로 오는 버스를 보여줘요.",
  },
  proposed: {
    label: "이 버스?",
    title: "탄 버스를 직접 확인해요",
    body: "번호판 끝자리를 보고, 목록에서 내가 탄 버스를 직접 골라 확인해요. 자동 선택은 꺼져 있어요.",
  },
  confirmed: {
    label: "확인",
    title: "탄 버스를 확인하면 안내가 시작돼요",
    body: "탄 버스를 확인하면 iPhone의 실시간 현황이 시작돼요. 확인하기 전에는 잠금 화면과 다이나믹 아일랜드에 안내가 뜨지 않아요.",
  },
  pocket: {
    label: "6정거장",
    title: "남은 정거장은 잠금 화면에",
    body: "잠금 화면에 남은 정거장과 하차 안내가 함께 표시돼요.",
    note: "기본 안내는 앱이 켜져 있을 때만 새로 고쳐져요. 앱을 닫은 뒤에도 이어지는 안내는 실제 iPhone에서 아직 확인하지 못했어요.",
  },
  island: {
    label: "다른 앱",
    title: "다른 앱을 써도, 위에 떠 있어요",
    body: "다이나믹 아일랜드에 노선 번호와 남은 정거장이 작게 보여요. 길게 누르면 펼쳐지고, 다른 실시간 현황과 겹치면 작은 원 하나로 줄어요.",
  },
  trust: {
    label: "위치 지연",
    title: "버스와 위치를 따로 확인해요",
    body: "버스 위치가 늦게 들어오면 마지막으로 받은 정거장 수를 흐리게 보여줘요. 위치가 서로 맞지 않으면 숫자를 숨기고요. 이때는 내릴 때 알림을 멈췄다가, 위치가 다시 확인되면 안내를 이어가요.",
  },
  prepare: {
    label: "2정거장",
    title: "2정거장 전부터 내릴 준비를 해요",
    body: "2정거장 전에 알려주도록 만들었어요. 알림이 뜨는 모습은 실제 iPhone에서 아직 확인하지 못했어요.",
  },
  nextStop: {
    label: "다음 하차",
    title: "다음 정류장에서 내릴 땐 산호색으로",
    body: "잠금 화면이 통째로 산호색으로 바뀌어요. 하차벨을 누를 때예요.",
  },
  arrived: {
    label: "도착",
    title: "여기서 내려요",
    body: "‘내렸어요’를 누르면 여정이 끝나고, 잠시 뒤 실시간 현황도 사라져요. 걸어가는 길은 지도 앱에 맡기면 돼요.",
  },
};

/** One line per trust variant: what the app does, in the rider's words. */
export const TRUST_NOTES: Record<string, string> = {
  delayed: "탄 버스는 확인됐지만 위치가 늦게 들어와요. 마지막으로 확인한 정거장 수를 흐리게 보여주고, 내릴 때 알림은 멈춰요.",
  vehicleLost: "탄 버스의 위치가 잠시 보이지 않아요. 다른 버스로 바꾸지 않고, 같은 버스가 다시 보일 때까지 기다려요.",
  offline: "인터넷이 끊겨도 확인한 버스는 그대로 두고, 연결되면 같은 버스로 안내를 이어가요.",
  checking: "버스 위치가 서로 맞지 않으면 남은 정거장을 숨기고, 다시 확인될 때까지 내릴 때 알림을 멈춰요.",
};
