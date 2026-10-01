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
    body: "국토교통부 버스 공공데이터를 읽는 서버는 돌아가고 있어요. 이제 iPhone 앱과 연결하는 작업이 남았습니다.",
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
