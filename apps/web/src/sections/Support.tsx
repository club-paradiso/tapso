import { ResponsiveDetails } from "../components/ResponsiveDetails";
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
            서버비, 실제 기기 테스트, 출시 준비에 비용이 들어요. 후원하지 않아도
            앱 이용과 관계없어요.
          </p>
        </SectionHead>

        <button className="btn btn-primary support-mobile-action" type="button" onClick={onOpen}>후원 방법 보기</button>
        <ResponsiveDetails summary="개발 응원과 후원 준비 안내" mobileOpen>
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
            <p className="support-detail">후원 방법 보기에서 이용 가능한 경로를 확인해 주세요.</p>
          </div>

          <div className="support-free">
            <h3>돈 말고도 큰 도움이 돼요</h3>
            <ul>
              <li>
                <a href="#status">
                  <b>개발 현황 살펴보기</b>
                  <span>TAPSO가 어디까지 만들어졌는지 확인해보세요.</span>
                </a>
              </li>
              <li>
                <a href="#faq">
                  <b>자주 묻는 질문 보기</b>
                  <span>출시 일정과 기능에 대한 안내를 모았어요.</span>
                </a>
              </li>
            </ul>
          </div>
        </div>
        </ResponsiveDetails>
      </div>
    </section>
  );
}
