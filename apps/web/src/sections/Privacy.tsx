import { BusIcon, PinIcon } from "../components/Icons";
import { SectionHead } from "../components/SectionHead";
import { PRIVACY_POINTS } from "../content/site.ts";

export function Privacy() {
  return (
    <section className="section privacy on-dark" id="privacy" aria-labelledby="privacy-title">
      <div className="container privacy-grid">
        <div>
          <SectionHead title="내 위치 대신, 버스 위치로 안내해요." titleId="privacy-title">
            <p>
              공공 버스 위치 데이터로 남은 정거장을 계산해요. 기본 하차 안내를 위해 내 위치를 계속 공유할 필요는 없어요.
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
                공공 데이터로 확인해요
              </span>
            </p>
            <p className="privacy-row is-off">
              <span className="privacy-token is-person">
                <PinIcon />
              </span>
              <span className="privacy-line" />
              <span className="privacy-label">
                <b>내 위치</b>
                기본 안내에는 필요 없어요
              </span>
            </p>
          </div>
        </div>
        <div>
          <details className="responsive-details">
          <summary>개인정보 원칙 보기<span className="disclosure-mark" aria-hidden="true" /></summary>
          <div className="disclosure-content">
          <ul className="privacy-points">
            {PRIVACY_POINTS.map((point) => (
              <li key={point.title}>
                <b>{point.title}</b>
                <span>{point.body}</span>
              </li>
            ))}
          </ul>
          <p className="fineprint">
            개발 중인 iPhone 앱을 기준으로 안내해요. 위치 권한은 선택 기능을 켤 때 요청할 수 있으며, 실제 iPhone에서의 동작 확인은 아직 남아 있어요.
          </p>
          </div>
          </details>
        </div>
      </div>
    </section>
  );
}
