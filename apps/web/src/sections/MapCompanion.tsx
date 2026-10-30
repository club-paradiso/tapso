import { ArrowIcon, BusIcon, MapIcon, WalkIcon } from "../components/Icons";
import { SectionHead } from "../components/SectionHead";
import { MAP_LINKS } from "../content/site";

/**
 * TAPSO next to the map apps, never against them. The "지금 되는 것과 아직 안
 * 되는 것" list is `MAP_LINKS`; `test/productParity.test.ts` ties each item to
 * the code (or the open device check) that backs it.
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
    who: "TAPSO",
    question: "지금 탄 버스, 언제 내리지?",
    body: "탄 버스를 확인하고, 남은 정거장을 지켜보다가 내릴 때 알려요.",
    Icon: BusIcon,
    tone: "tapso",
  },
  {
    who: "다시 지도 앱",
    question: "내린 다음엔 어디로?",
    body: "내린 뒤 도보 길찾기로 자연스럽게 이어갈 수 있어요.",
    Icon: WalkIcon,
    tone: "map",
  },
] as const;
export function MapCompanion() {
  return (
    <section className="section maps" id="maps" aria-labelledby="maps-title">
      <div className="container">
        <SectionHead
          title={
            <>
              목적지를 정한 순간부터,
              <br />
              TAPSO가 하차까지 함께해요.
            </>
          }
          titleId="maps-title"
        >
          <p>
            목적지나 건물 이름으로 하차 정류장을 찾고, 탈 버스를 확인하세요. TAPSO가 남은 정거장과 내릴 순간을 계속 보여줘요.
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
          <h3>지금 되는 것과 아직 안 되는 것</h3>
          <ul className="links-list">
            {MAP_LINKS.map((l) => (
              <li key={l.title}>
                <span className={`state-pill tone-${l.tone}`}>{l.state}</span>
                <b>{l.title}</b>
                <span>{l.body}</span>
              </li>
            ))}
          </ul>
          <p className="fineprint">
            카카오맵, 네이버 지도, Apple 지도는 각 회사의 서비스이며, TAPSO와 제휴 관계가 없어요. ‘체험판’은
            합성 데이터로 움직이는 개발 중인 iOS 앱을 말해요.
          </p>
        </div>
      </div>
    </section>
  );
}
