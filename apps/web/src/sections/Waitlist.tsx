import WaitlistForm from "../components/WaitlistForm";
import { CheckIcon } from "../components/Icons";

/** The main conversion point: what the visitor signs up for, then the form. */
export function Waitlist() {
  return (
    <section className="section waitlist" id="waitlist" aria-labelledby="waitlist-title">
      <div className="container waitlist-grid">
        <div className="waitlist-copy">
          <p className="eyebrow">
            <span className="eyebrow-index">09</span>
            <span className="eyebrow-rail" aria-hidden="true" />
            TestFlight 사전예약
          </p>
          <h2 id="waitlist-title">
            혼저 탑서.
            <br />
            TestFlight가 열리면 가장 먼저 알려드릴게요.
          </h2>
          <p className="waitlist-translate">‘혼저 탑서’는 제주어로 ‘어서 타세요’예요.</p>

          <ul className="waitlist-promises">
            <li>
              <CheckIcon />
              <span>
                <b>신청되면 바로 확인</b>
                신청이 정상적으로 저장되면 확인 메일을 보내요.
              </span>
            </li>
            <li>
              <CheckIcon />
              <span>
                <b>TestFlight 오픈 소식</b>
                베타가 열리면 이 이메일로 먼저 알려드려요.
              </span>
            </li>
            <li>
              <CheckIcon />
              <span>
                <b>광고는 보내지 않아요</b>
                출시 소식 말고는 메일을 보내지 않아요. 뉴스레터도 없어요.
              </span>
            </li>
          </ul>

          <img
            className="waitlist-dori"
            src="/media/dori-480.webp"
            alt=""
            width={240}
            height={240}
            loading="lazy"
            decoding="async"
          />
        </div>

        <div className="waitlist-form-wrap">
          <WaitlistForm />
          <details className="privacy-details" id="waitlist-privacy">
            <summary>사전예약 개인정보 안내</summary>
            <dl>
              <div>
                <dt>받는 것</dt>
                <dd>이메일 주소, 이용 유형(도민·여행객 등), 동의한 시각과 동의문 버전</dd>
              </div>
              <div>
                <dt>받지 않는 것</dt>
                <dd>이름, 전화번호, 주소, 위치. IP 주소도 저장하지 않아요.</dd>
              </div>
              <div>
                <dt>쓰는 곳</dt>
                <dd>탑서 출시와 TestFlight 소식 안내에만 써요.</dd>
              </div>
              <div>
                <dt>지우는 때</dt>
                <dd>안내가 끝나거나 요청하시면 지워요. 확인 메일에 답장하면 돼요.</dd>
              </div>
            </dl>
          </details>
        </div>
      </div>
    </section>
  );
}
