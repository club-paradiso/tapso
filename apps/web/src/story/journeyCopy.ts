import type { BeatId, Chapter } from "./beats.ts";

/**
 * Words for the journey. Product strings the app itself shows are quoted from
 * `src/demo/rideCopy.ts`; this file holds only the page's own explanation.
 * Each claim here is true of the iOS build today or says that it is not yet.
 */

export const CHAPTER_COPY: Record<Chapter, { title: string; lede: string }> = {
  plan: {
    title: "내릴 곳만 정하면 돼요.",
    lede: "길찾기는 지도 앱이 잘해요. 탑서는 버스에 오르기 직전부터, 내릴 때까지만 맡아요.",
  },
  confirm: {
    title: "같은 365번이라도, 같은 버스는 아니에요.",
    lede: "남은 정거장이 맞으려면 내가 실제로 탄 그 차량을 따라가야 해요. 그래서 탈 때 딱 한 번 확인해요.",
  },
  ride: {
    title: "이제 휴대폰은 넣어두세요.",
    lede: "버스를 확인한 뒤로는 잠금 화면과 다이나믹 아일랜드가 남은 정거장을 들고 있어요.",
  },
  trust: {
    title: "잘 모르겠으면, 아는 척하지 않아요.",
    lede: "버스 데이터는 가끔 늦거나 끊겨요. 그럴 때 숫자를 억지로 맞히지 않아요.",
  },
  arrive: {
    title: "내릴 때가 되면, 한 번씩 또렷하게.",
    lede: "알림은 세 번이에요. 2정거장 전, 다음 정류장, 도착. 같은 알림은 두 번 오지 않아요.",
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
    body: "출발지는 묻지 않아요. 버스에서 필요한 건 내릴 정류장이니까요. 지도 앱에서 공유한 장소로 시작해도 돼요.",
  },
  boarding: {
    label: "타는 곳",
    title: "탈 버스와 타는 곳을 알려주세요",
    body: "내릴 곳에 닿는 노선과 방향만 보여줘요. 한 방향뿐이면 이 단계는 건너뛰어요. 타는 정류장을 고르면 몇 정거장 가는지 바로 나와요.",
  },
  sameBus: {
    label: "같은 번호",
    title: "번호만으로는 내 버스를 몰라요",
    body: "365번은 한 대만 다니지 않아요. 같은 번호가 여러 대, 양방향으로 달려요. 탑서는 타는 정류장으로 오는 버스를 한 대씩 살펴봐요.",
  },
  proposed: {
    label: "이 버스?",
    title: "이 버스로 보이면, 한 번만 물어봐요",
    body: "그럴듯한 한 대를 번호판 끝자리와 함께 보여줘요. 이미 지나간 버스는 빼고요. 그럴듯한 버스가 두 대면 대신 고르지 않고 물어봐요.",
  },
  confirmed: {
    label: "확인",
    title: "확인하면, 그때부터 지켜봐요",
    body: "누르는 순간 iPhone의 실시간 현황이 시작돼요. 확인하기 전에는 잠금 화면에도, 다이나믹 아일랜드에도 아무것도 띄우지 않아요.",
  },
  pocket: {
    label: "6정거장",
    title: "남은 정거장은 잠금 화면에",
    body: "정류장을 지날 때마다 화면을 켤 필요 없어요. 탑서가 부를 때만 보면 돼요.",
    note: "지금 개발 빌드는 앱이 켜져 있는 동안만 잠금 화면이 갱신돼요. 앱을 닫아도 이어지게 하는 작업은 아직 진행 중이에요.",
  },
  island: {
    label: "다른 앱",
    title: "다른 앱을 써도, 위에 떠 있어요",
    body: "다이나믹 아일랜드에 노선 번호와 남은 정거장이 작게 보여요. 길게 누르면 펼쳐지고, 다른 실시간 현황과 겹치면 작은 원 하나로 줄어요.",
  },
  trust: {
    label: "흔들릴 때",
    title: "버스와 정보를 따로 확인해요",
    body: "이 버스가 맞는지, 정보가 아직 최신인지 따로 봐요. 둘 중 하나라도 애매하면 숫자를 흐리게 하거나 숨기고, 하차 알림을 멈춰요. 다시 확실해지면 바로 이어서 알려드려요.",
  },
  prepare: {
    label: "2정거장",
    title: "2정거장 전, 일어설 시간을 드려요",
    body: "화면이 켜지고 한 번 알려드려요. 짐 챙기고 일어날 시간이에요.",
  },
  nextStop: {
    label: "다음 하차",
    title: "다음 정류장이면, 가장 크게",
    body: "잠금 화면 안내가 통째로 산호색으로 바뀌어요. 하차벨을 누를 때예요.",
  },
  arrived: {
    label: "도착",
    title: "여기서 내려요",
    body: "‘내렸어요’를 누르면 여정이 끝나고, 잠시 뒤 실시간 현황도 사라져요. 걸어가는 길은 지도 앱에 맡기면 돼요.",
  },
};

/** One line per trust variant: what the app does, in the rider's words. */
export const TRUST_NOTES: Record<string, string> = {
  delayed: "버스는 맞는데 정보가 늦어요. 마지막으로 확인한 정거장 수를 흐리게 두고, 알림은 보내지 않아요.",
  vehicleLost: "정보는 들어오는데 내 버스가 잠시 안 보여요. 다른 버스로 몰래 바꾸지 않고 그 버스를 기다려요.",
  offline: "휴대폰 연결이 끊겨도 차량 확인은 그대로예요. 연결되면 바로 이어서 추적해요.",
  checking: "정보끼리 맞지 않으면 남은 정거장을 숨기고, 확실해질 때까지 알림을 멈춰요.",
};
