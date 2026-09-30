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
  { href: "#how", label: "작동 방식" },
  { href: "#bus", label: "버스 확인" },
  { href: "#live", label: "잠금 화면" },
  { href: "#status", label: "개발 현황" },
  { href: "#faq", label: "자주 묻는 질문" },
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
    body: "내릴 곳 선택부터 버스 확인, 잠금 화면·다이나믹 아일랜드 안내까지 네이티브 앱으로 만들었어요. 지금은 합성 데이터로 움직여요.",
  },
  {
    title: "제주 실시간 버스 데이터",
    state: "active",
    body: "국토교통부 버스 공공데이터를 읽는 서버는 운영 중이에요. 앱과 연결하는 작업이 남았어요.",
  },
  {
    title: "버스 확인 안전성 검증",
    state: "active",
    body: "실제 운행 기록을 다시 돌려 보며 검증하고 있어요. 그동안 자동 선택은 꺼 두고, 탑승자가 직접 확인해요.",
  },
  {
    title: "실제 iPhone 테스트",
    state: "next",
    body: "Apple Developer Program 가입 뒤 실제 기기에서 잠금 화면과 다이나믹 아일랜드를 확인해요.",
  },
  {
    title: "앱을 닫아도 이어지는 안내",
    state: "next",
    body: "서버가 잠금 화면을 갱신하는 푸시를 붙여요. 지금 개발 빌드는 앱이 켜져 있는 동안만 진행돼요.",
  },
  {
    title: "TestFlight 베타",
    state: "later",
    body: "날짜는 아직 정하지 않았어요. 열리면 사전예약한 분께 먼저 메일로 알려드려요.",
  },
  {
    title: "App Store 출시",
    state: "later",
    body: "베타에서 충분히 확인한 뒤에요.",
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
    title: "붙여넣은 내용은 기기 안에서만",
    body: "지도 앱에서 복사한 장소 이름은 휴대폰 안에서만 읽고 어디에도 보내지 않아요.",
  },
] as const;

export type FaqItem = { q: string; a: string };

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    q: "탑서는 지도 앱인가요?",
    a: "아니에요. 길찾기는 카카오맵·네이버 지도가 훨씬 잘해요. 탑서는 버스에 탄 뒤부터 내릴 때까지만 함께해요. 내가 탄 버스를 확인하고, 남은 정거장을 보여주고, 내릴 때를 알려줘요.",
  },
  {
    q: "위치 권한이 필요한가요?",
    a: "아니요. 탑서는 승객이 아니라 버스를 따라가요. 지금 앱은 위치 권한도, 알림 권한도 요청하지 않아요.",
  },
  {
    q: "왜 실제 버스를 확인하나요?",
    a: "같은 번호의 버스가 한 노선에 여러 대 달려요. 남은 정거장은 내가 탄 그 차량을 따라가야 정확해요. 탑서는 정류장으로 오는 버스를 보여드리고, 탈 때 번호판 끝자리로 한 번 확인받아요. 애매하면 대신 고르지 않아요.",
  },
  {
    q: "앱을 닫아도 알려주나요?",
    a: "그게 목표예요. 지금 개발 빌드는 앱이 켜져 있는 동안 잠금 화면과 다이나믹 아일랜드를 갱신해요. 앱이 멈춰도 서버가 안내를 이어가는 푸시는 Apple 개발자 계정이 준비되면 만들어요. 그 전까지는 정보가 멈추면 오래된 안내를 새것처럼 보여주지 않고 ‘업데이트 지연’으로 바꿔요.",
  },
  {
    q: "다이나믹 아일랜드가 없는 iPhone에서는요?",
    a: "잠금 화면의 실시간 현황으로 똑같이 안내해요. 2정거장·다음 하차·도착 알림은 다이나믹 아일랜드 대신 배너로 떠요. iOS 17 이상을 대상으로 만들고 있어요.",
  },
  {
    q: "데이터가 끊기면 어떻게 되나요?",
    a: "버스가 맞는지와 정보가 최신인지를 따로 보여줘요. 정보가 늦거나 연결이 끊기면 마지막으로 확인한 정거장 수를 흐리게 보여주고, 하차 알림은 보내지 않아요. 그럴 땐 차내 안내도 함께 확인해주세요.",
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
