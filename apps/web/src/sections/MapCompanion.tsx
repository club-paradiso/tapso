import { ArrowIcon, BusIcon, MapIcon, WalkIcon } from "../components/Icons";
import { SectionHead } from "../components/SectionHead";

/**
 * TAPSO next to the map apps, never against them. The "지금 되는 연결" list
 * states only what `docs/product/MAP_APP_HANDOFF_V2.md` records as built, and
 * labels the rest.
 */

const FLOW = [
  {
    who: "카카오맵 · 네이버 지도",
    question: "어떻게 갈까?",
    body: "경로를 찾고, 탈 버스와 정류장을 정해요.",
    Icon: MapIcon,
    tone: "map",
  },
  {
    who: "탑서",
    question: "지금 탄 버스, 언제 내리지?",
    body: "탄 버스를 확인하고, 남은 정거장을 지켜보다가 내릴 때 알려요.",
    Icon: BusIcon,
    tone: "tapso",
  },
  {
    who: "다시 지도 앱",
    question: "내린 다음엔 어디로?",
    body: "걸어가는 길은 지도 앱이 더 잘 알아요.",
    Icon: WalkIcon,
    tone: "map",
  },
] as const;

const LINKS = [
  {
    state: "체험판에 있어요",
    tone: "done",
    title: "지도 앱에서 공유한 장소로 시작",
    body: "공유 → 복사한 내용을 붙여넣으면 정류장 이름을 찾아요. 휴대폰 안에서만 읽어요.",
  },
  {
    state: "체험판에 있어요",
    tone: "done",
    title: "내린 뒤 네이버 지도로 넘기기",
    body: "도착하면 네이버 지도에서 목적지 이름을 검색해 걷는 길을 이어가요.",
  },
  {
    state: "아직 없어요",
    tone: "none",
    title: "카카오맵으로 넘기기",
    body: "카카오맵은 앱에서 장소 이름으로 검색하는 공식 방법을 찾지 못해 연결하지 않았어요.",
  },
  {
    state: "계획",
    tone: "planned",
    title: "지도 앱 공유 메뉴에 탑서 추가",
    body: "Apple 개발자 계정이 준비되면 붙일 수 있어요. 지금은 붙여넣기로 같은 일을 해요.",
  },
] as const;

export function MapCompanion() {
  return (
    <section className="section maps" id="maps" aria-labelledby="maps-title">
      <div className="container">
        <SectionHead
          index="06"
          eyebrow="지도 앱과 함께"
          title={
            <>
              지도 앱은 길을 찾고,
              <br />
              탑서는 내릴 때를 지켜요.
            </>
          }
          titleId="maps-title"
        >
          <p>
            버스에서는 길보다 내릴 순간이 중요하니까요. 탑서는 지도 앱을 대신하지 않아요. 버스에 탄
            뒤부터 내릴 때까지만 맡아요.
          </p>
        </SectionHead>

        <ol className="flow">
          {FLOW.map(({ who, question, body, Icon, tone }, i) => (
            <li key={who} className={`flow-card tone-${tone}`}>
              <span className="flow-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="flow-who">{who}</span>
              <strong className="flow-q">“{question}”</strong>
              <span className="flow-body">{body}</span>
              {i < FLOW.length - 1 ? (
                <span className="flow-arrow" aria-hidden="true">
                  <ArrowIcon />
                </span>
              ) : null}
            </li>
          ))}
        </ol>

        <div className="links-block">
          <h3>지금 되는 연결, 아직인 연결</h3>
          <ul className="links-list">
            {LINKS.map((l) => (
              <li key={l.title}>
                <span className={`state-pill tone-${l.tone}`}>{l.state}</span>
                <b>{l.title}</b>
                <span>{l.body}</span>
              </li>
            ))}
          </ul>
          <p className="fineprint">
            카카오맵과 네이버 지도는 각 회사의 서비스이며, 탑서와 제휴 관계가 없어요. ‘체험판’은
            합성 데이터로 움직이는 개발 중인 iOS 앱을 말해요.
          </p>
        </div>
      </div>
    </section>
  );
}
