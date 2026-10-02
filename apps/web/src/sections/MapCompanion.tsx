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
            길찾기는 카카오맵이나 네이버 지도가 더 잘해요. 탑서는 버스에 탄 다음부터 맡습니다. 지금 탄 버스와 남은 정거장, 내릴 순간에만 집중해요.
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
            카카오맵, 네이버 지도, Apple 지도는 각 회사의 서비스이며, 탑서와 제휴 관계가 없어요. ‘체험판’은
            합성 데이터로 움직이는 개발 중인 iOS 앱을 말해요.
          </p>
        </div>
      </div>
    </section>
  );
}
