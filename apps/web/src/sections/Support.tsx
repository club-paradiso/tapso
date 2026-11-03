import { SectionHead } from "../components/SectionHead";

/** The dialog only exposes configured channels and checks native checkout status. */
export function Support({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="section support" id="support" aria-labelledby="support-title">
      <div className="container">
        <SectionHead
          title="개발자한테 커피 한 잔 보태고 싶다면"
          titleId="support-title"
        >
          <p>
            보태 주신 돈은 서버 운영, 실제 iPhone 테스트, 출시 준비에 써요.
            후원은 선택이고, 후원하지 않아도 앱은 똑같이 쓸 수 있어요.
          </p>
        </SectionHead>
        <button className="btn btn-primary support-mobile-action" type="button" onClick={onOpen}>후원 방법 보기</button>
        <div className="support-grid">
          <div className="support-card">
            <p className="support-status">
              <span className={"state-pill tone-next"}>
                후원 방법 안내
              </span>
            </p>
            <h3>후원금은 여기에 써요</h3>
            <ul className="support-uses">
              <li>Apple Developer Program 가입비</li>
              <li>실제 iPhone에서 하는 기기 테스트</li>
              <li>서버와 실시간 데이터 운영</li>
              <li>TestFlight와 출시 준비</li>
            </ul>
            <p className="support-detail">‘후원 방법 보기’를 누르면 계좌이체처럼 지금 쓸 수 있는 방법이 나와요.</p>
          </div>

          <div className="support-free">
            <h3>얼마나 만들었는지 먼저 보고 싶다면</h3>
            <ul>
              <li>
                <a href="#status">
                  <b>개발 현황</b>
                  <span>만든 기능과 출시 전까지 남은 일을 볼 수 있어요.</span>
                </a>
              </li>
              <li>
                <a href="#faq">
                  <b>FAQ</b>
                  <span>출시 일정과 기능에 대해 자주 받는 질문이에요.</span>
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
