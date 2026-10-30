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

/**
 * How far a status item has been checked, from weakest to strongest. A level
 * is only as strong as the evidence in `statusEvidence.ts`; nothing here may
 * imply a stronger check than that file records.
 *
 * - built: in the app or server code and covered by automatic tests or
 *   simulator snapshots; not yet seen on a real iPhone or bus.
 * - realdata: checked against real Jeju bus data in production.
 * - verifying: being checked; the result is not in yet.
 * - blocked: waiting on an account, credential or release step.
 * - device: seen working on a real iPhone. No item may use it until an
 *   device-validation evidence file exists in the repository (checked by statusHonesty.test.ts).
 */
export type StatusLevel = "built" | "realdata" | "verifying" | "blocked" | "device";

export const STATUS_LEVEL_LABELS: Record<StatusLevel, string> = {
  built: "구현됨",
  realdata: "실데이터 확인",
  verifying: "검증 중",
  blocked: "준비 중",
  device: "실기기 확인",
};

export type StatusGroupId = "built" | "verifying" | "remaining";

export const STATUS_GROUPS: readonly { id: StatusGroupId; title: string; lede: string }[] = [
  { id: "built", title: "지금까지 만든 기능", lede: "앱과 서버에 들어 있어요. 아직 실제 iPhone에서 써 본 기록은 없어요." },
  { id: "verifying", title: "지금 검증하는 기능", lede: "실제 제주 버스와 사용 환경에서 확인하는 중이에요." },
  { id: "remaining", title: "출시까지 남은 단계", lede: "계정, 인증 정보, 배포 절차가 필요한 일이에요." },
];

export type StatusItem = {
  id: string;
  group: StatusGroupId;
  title: string;
  level: StatusLevel;
  body: string;
};

export const STATUS_ITEMS: readonly StatusItem[] = [
  {
    id: "destination-search",
    group: "built",
    title: "내릴 곳 검색",
    level: "realdata",
    body: "정류장, 장소, 주소, 건물 이름으로 찾고 근처 정류장을 보여줘요. 제주 정류장 4,338곳 데이터를 쓰고, 실제 iPhone 확인은 남았어요.",
  },
  {
    id: "route-boarding",
    group: "built",
    title: "노선, 방향, 탈 정류장 고르기",
    level: "realdata",
    body: "버스 번호를 고르면 방향과 정류장 목록이 나와요. 운영 서버의 여정 저장은 확인했고, 앱 화면은 실제 iPhone 확인이 남았어요.",
  },
  {
    id: "lock-screen",
    group: "built",
    title: "잠금 화면과 다이나믹 아일랜드",
    level: "built",
    body: "남은 정거장, 내릴 준비, 도착을 각각 다른 화면으로 보여줘요. 시뮬레이터 화면은 확인했고, 실제 iPhone 확인은 남았어요.",
  },
  {
    id: "map-apps",
    group: "built",
    title: "지도 앱 연동",
    level: "built",
    body: "카카오맵, 네이버 지도, Apple 지도에서 장소를 공유해 시작하고, 내린 뒤 걷는 길은 지도 앱으로 이어줘요. 실제 iPhone 확인이 남았어요.",
  },
  {
    id: "last-bus-passed-stop",
    group: "built",
    title: "막차와 내릴 곳을 지났을 때",
    level: "built",
    body: "지나쳤을 때 다음에 내릴 정류장을 알려줘요. 지금 받는 제주 노선 정보에는 막차 시각이 없어 \"알 수 없어요\"로 안내해요. 실제 iPhone 확인이 남았어요.",
  },
  {
    id: "vehicle-progress",
    group: "verifying",
    title: "탄 버스 확인과 남은 정거장",
    level: "verifying",
    body: "번호판을 보고 직접 확인한 버스를 따라가요. 자동 선택은 꺼 둔 상태예요. 실제 탑승으로 확인한 기록은 아직 없어요.",
  },
  {
    id: "language-access-privacy",
    group: "verifying",
    title: "언어, 접근성, 개인정보",
    level: "verifying",
    body: "한국어, 영어, 중국어, 일본어를 준비했어요. 중국어와 일본어는 원어민 검수 전이고, VoiceOver는 실제 iPhone 확인이 남았어요.",
  },
  {
    id: "background-push",
    group: "remaining",
    title: "앱을 닫아도 이어지는 안내",
    level: "blocked",
    body: "푸시 알림 서버는 만들었지만 Apple 인증 정보가 없어 운영에서 꺼져 있어요. 지금은 앱이 열려 있을 때 안내가 갱신돼요.",
  },
  {
    id: "real-iphone",
    group: "remaining",
    title: "실제 iPhone과 버스에서 테스트",
    level: "blocked",
    body: "테스트 절차는 준비했어요. 실제 iPhone에서 확인한 기록은 아직 없어요.",
  },
  {
    id: "release",
    group: "remaining",
    title: "TestFlight와 App Store",
    level: "blocked",
    body: "유료 Apple Developer Program 가입이 먼저예요. 출시 일정은 정해지지 않았어요.",
  },
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
    title: "위치 권한을 묻지 않아요",
    body: "TAPSO는 승객이 아니라 버스를 따라가요. 남은 정거장은 내가 탄 차량의 위치로 계산해요.",
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
    a: "아니요. TAPSO는 승객이 아니라 버스를 따라가요. 지금 앱은 위치 권한도, 알림 권한도 요청하지 않아요.",
  },
  {
    q: "왜 실제 버스를 확인하나요?",
    a: "같은 365번도 여러 대가 동시에 다녀요. 그래서 노선 번호만으로는 내가 탄 버스를 알 수 없습니다. 탈 때 번호판 끝자리로 한 번 확인하고, 애매하면 TAPSO가 멋대로 고르지 않아요.",
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
