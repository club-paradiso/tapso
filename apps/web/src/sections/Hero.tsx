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
            제주 버스에서 내릴 때까지 · iPhone 앱 개발 중
          </p>
          <h1 id="hero-title">와리지 말앙 혼저 탑서.</h1>
          <p className="hero-lede">
            내릴 곳을 고르고, 탄 버스만 한 번 확인하세요. 그다음부터는 남은 정거장과 내릴 때를 잠금
            화면과 다이나믹 아일랜드에서 바로 볼 수 있어요.
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
            <li>내 위치 안 받아요</li>
            <li>탄 버스만 한 번 확인해요</li>
            <li>확실하지 않으면 모른다고 해요</li>
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
