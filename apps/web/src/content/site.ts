/**
 * Page content that is not product copy from the app: links, the development
 * status, privacy points and the FAQ. Every status line is checked against the
 * repository's reality labels (README › Current status, docs/ROADMAP.md,
 * docs/KNOWN_ISSUES.md); none of it may claim more than those documents show.
 */

export const LINKS = {
  site: "https://tapso-nu.vercel.app/",
} as const;

export const NAV_ITEMS = [
  { href: "#how", label: "타는 법" },
  { href: "#trust", label: "흔들릴 때" },
  { href: "#status", label: "개발 현황" },
  { href: "#support", label: "후원하기" },
  { href: "#faq", label: "FAQ" },
] as const;

export type StatusState = "done" | "active" | "next" | "later";

export const STATUS_STATE_LABELS: Record<StatusState, string> = {
  done: "완료",
  active: "진행 중",
  next: "준비 중",
  later: "이용 전",
};

export type StatusItem = { title: string; state: StatusState; body: string };

export const STATUS_ITEMS: readonly StatusItem[] = [
  { title: "지금 만들었어요", state: "done", body: "목적지를 찾고 탈 버스를 직접 확인한 뒤 남은 정거장을 보는 iPhone 앱을 만들었어요. 제주 실시간 버스 데이터를 연결했어요." },
  { title: "실제 사용을 검증할 차례예요", state: "active", body: "실제 iPhone과 버스에서 데이터와 잠금 화면 안내를 확인해야 해요. 버스 자동 선택은 꺼져 있어 직접 확인해야 합니다." },
  { title: "아직 이용할 수 없어요", state: "later", body: "TestFlight와 App Store는 아직 공개되지 않았어요. 공개 전 실제 기기 검증과 배포 준비가 필요해요. 일정은 정해지지 않았어요." },
];

export type MapLink = { state: string; tone: "done" | "none" | "planned"; title: string; body: string };

/** What works with the map apps today, each item backed in `productParity.test.ts`. */
export const MAP_LINKS: readonly MapLink[] = [
  {
    state: "체험판에 있어요",
    tone: "done",
    title: "지도 앱에서 공유한 장소로 시작",
    body: "공유 메뉴에서 TAPSO를 고르거나 복사한 내용을 붙여넣으면, 장소를 휴대폰 안에서만 읽고 그곳으로 가는 탑승을 시작해요.",
  },
  {
    state: "체험판에 있어요",
    tone: "done",
    title: "내린 뒤 지도 앱으로 넘기기",
    body: "도착하면 네이버 지도와 카카오맵의 도보 길찾기로 이어가고, Apple 지도에서는 장소를 보여줘요. 카카오맵은 좌표를 아는 곳만 넘겨요.",
  },
  {
    state: "아직 없어요",
    tone: "none",
    title: "카카오맵에서 이름으로 찾기",
    body: "카카오맵 앱에서 장소 이름으로 검색하는 공식 링크를 찾지 못했어요. 그래서 좌표를 모르는 곳은 카카오맵으로 넘기지 않아요.",
  },
  {
    state: "iPhone 확인 전",
    tone: "planned",
    title: "실제 iPhone에서 공유 메뉴 확인",
    body: "공유 메뉴의 TAPSO는 만들었지만, 카카오맵과 네이버 지도의 공유가 실제 iPhone에서 그대로 들어오는지는 아직 확인하지 못했어요.",
  },
];

export const PRIVACY_POINTS = [
  {
    title: "기본 안내에는 위치 권한이 필요 없어요",
    body: "TAPSO는 버스 위치로 남은 정거장을 계산해요. 선택 기능에서는 위치 권한을 요청할 수 있어요.",
  },
  {
    title: "알림 권한도 필요 없어요",
    body: "하차 안내는 iPhone의 실시간 현황(Live Activity)으로 보내요. 실시간 현황은 설정에서 언제든 끌 수 있어요.",
  },
  {
    title: "계정을 만들지 않아요",
    body: "이름도 전화번호도 받지 않아요. 최근 여정과 즐겨찾기는 휴대폰 안에만 저장돼요.",
  },
  {
    title: "공유한 장소는 기기 안에서만",
    body: "지도 앱에서 공유하거나 붙여넣은 장소는 휴대폰 안에서만 읽고 어디에도 보내지 않아요.",
  },
] as const;

export type FaqItem = { q: string; a: string };

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    q: "TAPSO는 지도 앱인가요?",
    a: "TAPSO는 목적지나 건물 이름으로 하차 정류장을 찾고, 실제로 탄 버스를 확인해 남은 정거장과 내릴 때를 알려주는 앱이에요. 지도 앱에서 공유한 장소로도 시작할 수 있어요.",
  },
  {
    q: "위치 권한이 필요한가요?",
    a: "기본 안내에는 필요하지 않아요. 선택 기능을 켜면 위치 권한을 요청할 수 있어요. 실제 기기에서 동작을 확인해야 해요.",
  },
  {
    q: "왜 실제 버스를 확인하나요?",
    a: "같은 365번도 여러 대가 동시에 다녀요. 그래서 노선 번호만으로는 내가 탄 버스를 알 수 없습니다. 탈 때 번호판 끝자리로 한 번 확인하고, 애매하면 TAPSO가 멋대로 고르지 않아요.",
  },
  {
    q: "앱을 닫아도 알려주나요?",
    a: "그게 목표입니다. 지금 개발 빌드는 앱이 켜져 있을 때만 잠금 화면과 다이나믹 아일랜드가 갱신돼요. 앱을 닫은 뒤 갱신하는 기능은 아직 운영 환경과 실제 기기에서 검증되지 않았고, 그동안 정보가 멈추면 ‘업데이트 지연’으로 표시합니다.",
  },
  {
    q: "다이나믹 아일랜드가 없는 iPhone에서는요?",
    a: "잠금 화면의 실시간 현황을 지원하도록 만들고 있어요. 알림 표시와 소리는 실제 iPhone에서 확인해야 해요. iOS 17 이상을 대상으로 합니다.",
  },
  {
    q: "데이터가 끊기면 어떻게 되나요?",
    a: "정보가 늦거나 끊기면 숫자를 새것처럼 보여주지 않아요. 마지막으로 확인한 값은 흐리게 표시하고 하차 알림도 멈춥니다. 그럴 때는 차내 안내도 같이 확인해주세요.",
  },
  {
    q: "막차 시간도 알려주나요?",
    a: "제공되는 제주 노선 정보에 막차 시각이 없어 현재는 알 수 없다고 안내해요. 막차 시각이 확인되는 경우를 위한 안내 기능은 만들어 두었지만 실제 iPhone 검증이 필요해요.",
  },
  {
    q: "지도 앱에서 장소를 공유할 수 있나요?",
    a: "카카오맵, 네이버 지도, Apple 지도에서 장소를 공유하는 기능을 만들었어요. 실제 iPhone에서 공유 내용이 전달되는지 확인해야 해요.",
  },
  {
    q: "TestFlight는 언제 시작하나요?",
    a: "날짜는 아직 정하지 않았어요. 실제 iPhone 테스트와 배포 준비가 먼저예요. 현재 사전예약도 받고 있지 않아요.",
  },
  {
    q: "Android도 나오나요?",
    a: "지금은 iPhone에 집중하고 있어요. 잠금 화면과 다이나믹 아일랜드 안내가 TAPSO의 중심이라서요. Android는 핵심 경험이 믿을 만하다는 게 확인된 뒤에 검토할 아이디어예요.",
  },
  {
    q: "이 페이지의 휴대폰 화면은 진짜 앱인가요?",
    a: "아니요. iOS 앱 디자인을 웹으로 다시 그린 미리보기예요. 버스, 번호판, 정류장 순서는 모두 합성 데이터예요. 다이나믹 아일랜드와 잠금 화면 안내는 iPhone 앱에서만 동작해요.",
  },
  {
    q: "‘TAPSO’는 무슨 뜻인가요?",
    a: "TAPSO는 제주어 ‘혼저 탑서’에서 따온 이름이에요. ‘와리지 말앙 혼저 탑서’는 ‘서두르지 말고 어서 타세요’라는 뜻이에요.",
  },
];
