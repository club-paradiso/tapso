import { ArrowIcon } from "../components/Icons";
import { IslandCompact, LockScreenPhone } from "../components/NativeSurfaces";
import { PreviewTag } from "../components/RideParts";

export function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="container hero-grid">
        <div className="hero-copy">
          <p className="hero-kicker">
            <span className="kicker-dot" aria-hidden="true" />
            제주 버스 승차 동반자 · iPhone 앱 개발 중
          </p>
          <h1 id="hero-title">
            타고,
            <br />
            폰은 넣어두고,
            <br />
            <em>제때 내리세요.</em>
          </h1>
          <p className="hero-lede">
            어디서 내릴지만 정하세요. 탄 버스를 한 번 함께 확인하면, 남은 정거장과 내릴 때를 잠금
            화면과 다이나믹 아일랜드가 알려드려요.
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary btn-lg" href="#waitlist">
              TestFlight 사전예약
              <ArrowIcon />
            </a>
            <a className="btn btn-quiet btn-lg" href="#how">
              어떻게 작동하는지 보기
            </a>
          </div>
          <ul className="hero-facts" aria-label="탑서의 약속">
            <li>위치 권한 없이</li>
            <li>내가 탄 버스를 기준으로</li>
            <li>애매하면 대신 고르지 않아요</li>
          </ul>
        </div>

        <div className="hero-visual">
          <div className="hero-stage">
            <LockScreenPhone moment="riding" remaining={6} className="hero-phone" />
            <div className="hero-float hero-float-island" aria-hidden="true">
              <IslandCompact moment="riding" remaining={6} />
              <span className="hero-float-caption">다른 앱을 볼 때도</span>
            </div>
          </div>
          <PreviewTag />
        </div>
      </div>
    </section>
  );
}
