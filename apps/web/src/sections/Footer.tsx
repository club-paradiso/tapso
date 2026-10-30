import { BrandMark } from "../components/BrandMark";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <p className="footer-logo">
            <BrandMark size={36} />
            <span className="brand-word" role="img" aria-label="TAPSO">
              TAPS<span className="brand-word-o" aria-hidden="true">O</span>
            </span>
          </p>
          <p className="footer-motto">
            와리지 말앙 혼저 탑서.
            <span>서두르지 말고, 어서 타세요.</span>
          </p>
          <p className="footer-status">
            <span className="kicker-dot" aria-hidden="true" />
            개발 중 · TestFlight 준비 중
          </p>
        </div>

        <nav className="footer-nav" aria-label="바닥글">
          <ul>
            <li>
              <a href="#waitlist">사전예약</a>
            </li>
            <li>
              <a href="#support">개발 후원하기</a>
            </li>
            <li>
              <a href="#status">개발 현황</a>
            </li>
            <li>
              <a href="#waitlist-privacy">사전예약 개인정보 안내</a>
            </li>
            <li>
              <a href="#privacy">TAPSO의 개인정보 원칙</a>
            </li>
          </ul>
          <ul>
            <li><a href="#how">TAPSO 사용 방법</a></li>
            <li><a href="#faq">자주 묻는 질문</a></li>
          </ul>
        </nav>
      </div>
      <div className="container footer-legal">
        <p>
          이 페이지의 앱 화면, 버스, 번호판, 정류장 순서는 모두 합성 데이터로 만든 미리보기예요. iPhone은
          Apple Inc.의 상표예요.
        </p>
      </div>
    </footer>
  );
}
