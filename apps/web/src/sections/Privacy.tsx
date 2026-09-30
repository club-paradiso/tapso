import { BusIcon, PinIcon } from "../components/Icons";
import { SectionHead } from "../components/SectionHead";
import { PRIVACY_POINTS } from "../content/site.ts";

export function Privacy() {
  return (
    <section className="section privacy on-dark" id="privacy" aria-labelledby="privacy-title">
      <div className="container privacy-grid">
        <div>
          <SectionHead index="07" eyebrow="개인정보" title="사람이 아니라, 버스를 따라가요." titleId="privacy-title">
            <p>
              내 위치를 계속 보내는 대신 공공 버스 위치를 봐요. 그래서 기본 기능에는 위치 권한이 필요하지 않아요.
            </p>
          </SectionHead>
          <div className="privacy-visual" aria-hidden="true">
            <p className="privacy-row">
              <span className="privacy-token is-bus">
                <BusIcon />
              </span>
              <span className="privacy-line" />
              <span className="privacy-label">
                <b>버스 위치</b>
                공공 데이터로 따라가요
              </span>
            </p>
            <p className="privacy-row is-off">
              <span className="privacy-token is-person">
                <PinIcon />
              </span>
              <span className="privacy-line" />
              <span className="privacy-label">
                <b>내 위치</b>
                요청하지 않아요
              </span>
            </p>
          </div>
        </div>
        <div>
          <ul className="privacy-points">
            {PRIVACY_POINTS.map((point) => (
              <li key={point.title}>
                <b>{point.title}</b>
                <span>{point.body}</span>
              </li>
            ))}
          </ul>
          <p className="fineprint">
            지금 개발 중인 iOS 앱 기준이에요. 나중에 ‘근처 정류장’ 같은 기능이 생기더라도 위치
            권한은 그 기능을 쓸 때만, 선택으로 물어볼 거예요.
          </p>
        </div>
      </div>
    </section>
  );
}
