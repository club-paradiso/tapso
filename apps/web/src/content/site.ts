/**
 * Page content that is not product copy from the app: links, the development
 * status, privacy points and the FAQ. Every status line is checked against the
 * repository's reality labels (README › Current status, docs/ROADMAP.md,
 * docs/KNOWN_ISSUES.md); none of it may claim more than those documents show.
 */

export const LINKS = {
  github: "https://github.com/club-paradiso/tapso",
  issues: "https://github.com/club-paradiso/tapso/issues",
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
  later: "그다음",
};

export type StatusItem = { title: string; state: StatusState; body: string };

export const STATUS_ITEMS: readonly StatusItem[] = [
  {
    title: "Product V2 · iOS 앱 흐름",
    state: "done",
    body: "내릴 곳을 고르고 버스를 확인한 뒤, 잠금 화면·다이나믹 아일랜드로 안내받는 흐름까지 만들었어요. 지금은 합성 데이터로 테스트하고 있어요.",
  },
  {
    title: "제주 실시간 버스 데이터",
    state: "active",
    body: "국토교통부 버스 공공데이터를 읽는 서버와 iPhone 앱의 연결은 만들었어요. 운영 서버에서 여정 기능을 켜는 설정이 남았어요.",
  },
  {
    title: "지도 앱에서 바로 출발",
    state: "active",
    body: "카카오맵·네이버 지도·Apple 지도에서 공유한 장소로 여정을 시작하고, 내린 뒤 걷는 길은 다시 지도 앱으로 넘겨요. 실제 iPhone 확인이 남았어요.",
  },
  {
    title: "돌아갈 때 막차",
    state: "active",
    body: "노선의 막차(기점 출발) 시각이 공개돼 있으면 몇 시까지 정류장에 나가야 하는지 알려주고, 원하면 남은 시간을 잠금 화면에 띄워요. 다만 지금 받는 제주 노선 정보에는 막차 시각이 비어 있어서 \"알 수 없어요\"로 안내해요. iPhone 확인도 남았어요.",
  },
  {
    title: "내릴 곳을 지났을 때",
    state: "active",
    body: "지나친 뒤 내릴 다음 정류장과 목적지까지의 직선거리를 알려주고, 다른 길은 지도 앱으로 이어줘요. 실제 iPhone 확인이 남았어요.",
  },
  {
    title: "버스 확인 안전성 검증",
    state: "active",
    body: "실제 운행 기록으로 계속 검증하고 있어요. 버스 자동 선택 기능은 꺼 둔 상태라, 탈 때 직접 한 번 확인합니다.",
  },
  {
    title: "실제 iPhone 테스트",
    state: "next",
    body: "Apple Developer Program을 준비한 뒤 실제 iPhone에서 잠금 화면과 다이나믹 아일랜드를 확인할 차례예요.",
  },
  {
    title: "앱을 닫아도 이어지는 안내",
    state: "next",
    body: "앱을 닫아도 잠금 화면이 계속 갱신되도록 푸시를 붙여야 해요. 지금 개발 빌드는 앱이 켜져 있을 때만 진행됩니다.",
  },
  {
    title: "TestFlight 베타",
    state: "later",
    body: "아직 날짜는 없습니다. TestFlight가 열리면 사전예약한 분께 먼저 메일을 보낼게요.",
  },
  {
    title: "App Store 출시",
    state: "later",
    body: "TestFlight에서 충분히 검증한 뒤 준비합니다.",
  },
];

export type MapLink = { state: string; tone: "done" | "none" | "planned"; title: string; body: string };

/** What works with the map apps today, each item backed in `productParity.test.ts`. */
export const MAP_LINKS: readonly MapLink[] = [
  {
    state: "체험판에 있어요",
    tone: "done",
    title: "지도 앱에서 공유한 장소로 시작",
    body: "공유 메뉴에서 탑서를 고르거나 복사한 내용을 붙여넣으면, 장소를 휴대폰 안에서만 읽고 그곳으로 가는 탑승을 시작해요.",
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
    body: "공유 메뉴의 탑서는 만들었지만, 카카오맵과 네이버 지도의 공유가 실제 iPhone에서 그대로 들어오는지는 아직 확인하지 못했어요.",
  },
];

export const PRIVACY_POINTS = [
  {
    title: "위치 권한을 묻지 않아요",
    body: "탑서는 승객이 아니라 버스를 따라가요. 남은 정거장은 내가 탄 차량의 위치로 계산해요.",
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
    q: "탑서는 지도 앱인가요?",
    a: "아니요. 길찾기는 카카오맵이나 네이버 지도에 맡기면 돼요. 탑서는 버스에 탄 뒤부터 씁니다. 탄 버스를 확인하고, 남은 정거장과 내릴 때를 보여줘요.",
  },
  {
    q: "위치 권한이 필요한가요?",
    a: "아니요. 탑서는 승객이 아니라 버스를 따라가요. 지금 앱은 위치 권한도, 알림 권한도 요청하지 않아요.",
  },
  {
    q: "왜 실제 버스를 확인하나요?",
    a: "같은 365번도 여러 대가 동시에 다녀요. 그래서 노선 번호만으로는 내가 탄 버스를 알 수 없습니다. 탈 때 번호판 끝자리로 한 번 확인하고, 애매하면 탑서가 멋대로 고르지 않아요.",
  },
  {
    q: "앱을 닫아도 알려주나요?",
    a: "그게 목표입니다. 지금 개발 빌드는 앱이 켜져 있을 때만 잠금 화면과 다이나믹 아일랜드가 갱신돼요. 앱을 닫아도 이어지게 만드는 푸시는 아직 작업 전이고, 그동안 정보가 멈추면 ‘업데이트 지연’으로 표시합니다.",
  },
  {
    q: "다이나믹 아일랜드가 없는 iPhone에서는요?",
    a: "잠금 화면의 실시간 현황으로 똑같이 안내해요. 2정거장·다음 하차·도착 알림은 다이나믹 아일랜드 대신 배너로 떠요. iOS 17 이상을 대상으로 만들고 있어요.",
  },
  {
    q: "데이터가 끊기면 어떻게 되나요?",
    a: "정보가 늦거나 끊기면 숫자를 새것처럼 보여주지 않아요. 마지막으로 확인한 값은 흐리게 표시하고 하차 알림도 멈춥니다. 그럴 때는 차내 안내도 같이 확인해주세요.",
  },
  {
    q: "TestFlight는 언제 시작하나요?",
    a: "날짜는 아직 정하지 않았어요. Apple Developer Program 가입과 실제 기기 테스트가 먼저예요. 사전예약하시면 열리는 대로 메일로 먼저 알려드려요.",
  },
  {
    q: "Android도 나오나요?",
    a: "지금은 iPhone에 집중하고 있어요. 잠금 화면과 다이나믹 아일랜드 안내가 탑서의 중심이라서요. Android는 핵심 경험이 믿을 만하다는 게 확인된 뒤에 검토할 아이디어예요.",
  },
  {
    q: "이 페이지의 휴대폰 화면은 진짜 앱인가요?",
    a: "아니요. iOS 앱 디자인을 웹으로 다시 그린 미리보기예요. 버스, 번호판, 정류장 순서는 모두 합성 데이터예요. 다이나믹 아일랜드와 잠금 화면 안내는 iPhone 앱에서만 동작해요.",
  },
  {
    q: "‘탑서’는 무슨 뜻인가요?",
    a: "제주어로 ‘타세요’예요. ‘와리지 말앙 혼저 탑서’는 ‘서두르지 말고 어서 타세요’라는 뜻이에요.",
  },
];
