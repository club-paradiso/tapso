import { SectionHead } from "../components/SectionHead";
import { TRIP_TOTAL_STOPS } from "../demo/rideStory.ts";

/**
 * The attention philosophy, drawn: when does a rider look at the phone?
 * An illustration of the product rule (design principle 13), not a
 * measurement — the page says so.
 */

type Glance = { at: number; label: string; kind: "confirm" | "prepare" | "next" | "arrive" };

const TAPSO_GLANCES: readonly Glance[] = [
  { at: 0, label: "탈 때 한 번 확인", kind: "confirm" },
  { at: TRIP_TOTAL_STOPS - 2, label: "2정거장 전", kind: "prepare" },
  { at: TRIP_TOTAL_STOPS - 1, label: "다음 하차", kind: "next" },
  { at: TRIP_TOTAL_STOPS, label: "도착", kind: "arrive" },
];

const pct = (stop: number) => `${(stop / TRIP_TOTAL_STOPS) * 100}%`;

export function PhoneAway() {
  const stops = Array.from({ length: TRIP_TOTAL_STOPS + 1 }, (_, i) => i);
  return (
    <section className="section away" id="away" aria-labelledby="away-title">
      <div className="container">
        <SectionHead
          index="04"
          eyebrow="휴대폰은 주머니에"
          title="계속 보고 있을 필요 없어요."
          titleId="away-title"
        >
          <p>
            지도 앱만 켜 두면, 정류장을 지날 때마다 화면을 확인하게 돼요. 탑서는 처음 한 번만
            확인받고, 그다음엔 이유가 있을 때만 불러요.
          </p>
        </SectionHead>

        <figure className="glance">
          <div className="glance-row glance-before">
            <p className="glance-row-label">
              <b>지도 앱만 볼 때</b>
              <span>정류장마다 “아직인가?”</span>
            </p>
            <div className="glance-track" aria-hidden="true">
              {stops.map((s) => (
                <span key={s} className="glance-mark is-anxious" style={{ left: pct(s) }} />
              ))}
            </div>
          </div>
          <div className="glance-row glance-after">
            <p className="glance-row-label">
              <b>탑서와 함께</b>
              <span>탑서가 부를 때만</span>
            </p>
            <div className="glance-track" aria-hidden="true">
              <span className="glance-pocket" style={{ left: pct(1.6), right: `calc(100% - ${pct(TRIP_TOTAL_STOPS - 2.4)})` }}>
                주머니 속
              </span>
              {TAPSO_GLANCES.map((g) => (
                <span key={g.kind} className={`glance-mark is-${g.kind}`} style={{ left: pct(g.at) }}>
                  <span className="glance-mark-label">{g.label}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="glance-axis" aria-hidden="true">
            <span>탑승</span>
            <span>{TRIP_TOTAL_STOPS}정거장 뒤 도착</span>
          </div>
          <figcaption>
            <span className="visually-hidden">
              지도 앱만 볼 때는 {TRIP_TOTAL_STOPS}개 정류장마다 화면을 확인하지만, 탑서와 함께라면 탈 때
              한 번, 2정거장 전, 다음 하차, 도착 때만 화면을 봐요.
            </span>
            그림으로 나타낸 예시예요. 측정한 수치가 아니에요.
          </figcaption>
        </figure>

        <ul className="away-points">
          <li>
            <b>한 번만 확인</b>
            <span>버스를 확인하는 건 탈 때 한 번이에요.</span>
          </li>
          <li>
            <b>알림은 세 번</b>
            <span>2정거장 전, 다음 정류장, 도착. 같은 알림은 두 번 오지 않아요.</span>
          </li>
          <li>
            <b>모르면 조용히</b>
            <span>확실하지 않을 때는 알림 대신 무슨 일인지 설명해요.</span>
          </li>
        </ul>
      </div>
    </section>
  );
}
