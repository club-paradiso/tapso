import { useEffect, useState } from "react";
import { SectionHead } from "../components/SectionHead";
import { SUPPORT_CHANNEL_AVAILABILITY } from "../lib/supportChannels.ts";
import { fetchSupportConfig, type SupportConfigResponse } from "../lib/supportClient";
import { supportStatus } from "../lib/supportStatus.ts";
import { useInView } from "../lib/useInView";

/**
 * Support hub. External support methods are public configuration, while native
 * Toss availability remains a server fact. The section never implies a payment
 * route exists unless at least one route is actually configured.
 */
export function Support({ onOpen }: { onOpen: () => void }) {
  const [ref, near] = useInView<HTMLElement>("400px", true);
  const [config, setConfig] = useState<SupportConfigResponse | undefined>(undefined);

  useEffect(() => {
    if (!near) return;
    const controller = new AbortController();
    void fetchSupportConfig(controller.signal).then((result) => {
      if (!controller.signal.aborted) setConfig(result);
    });
    return () => controller.abort();
  }, [near]);

  const nativeStatus = supportStatus(config);
  const externalOpen =
    SUPPORT_CHANNEL_AVAILABILITY.buyMeACoffee ||
    SUPPORT_CHANNEL_AVAILABILITY.bankTransfer ||
    SUPPORT_CHANNEL_AVAILABILITY.kakaoPay;
  const supportOpen = externalOpen || nativeStatus.open;

  const detail = SUPPORT_CHANNEL_AVAILABILITY.bankTransfer
    ? SUPPORT_CHANNEL_AVAILABILITY.buyMeACoffee
      ? "제주은행 계좌이체와 Buy Me a Coffee 중 편한 방법으로 응원할 수 있어요."
      : "원화 계좌이체로 원하는 금액을 응원할 수 있어요."
    : SUPPORT_CHANNEL_AVAILABILITY.buyMeACoffee
      ? "커피 한 잔으로 응원할 수 있어요. 결제는 Buy Me a Coffee에서 처리돼요."
      : SUPPORT_CHANNEL_AVAILABILITY.kakaoPay
        ? "카카오페이 송금으로 탑서 개발을 응원할 수 있어요."
        : nativeStatus.detail;

  return (
    <section className="section support" id="support" aria-labelledby="support-title" ref={ref}>
      <div className="container">
        <SectionHead
          title="탑서에 커피 한 잔 보태고 싶다면"
          titleId="support-title"
        >
          <p>
            서버비, 실제 기기 테스트, 출시 준비에 비용이 들어요. 후원하지 않아도
            탑서는 그대로 쓸 수 있습니다.
          </p>
        </SectionHead>

        <div className="support-grid">
          <div className="support-card">
            <p className="support-status">
              <span className={`state-pill tone-${supportOpen ? "done" : "next"}`}>
                {supportOpen ? "후원 가능" : nativeStatus.label}
              </span>
            </p>
            <h3>후원금은 여기에 써요</h3>
            <ul className="support-uses">
              <li>Apple Developer Program 가입비</li>
              <li>실제 iPhone에서 하는 기기 테스트</li>
              <li>서버와 실시간 데이터 운영</li>
              <li>TestFlight와 출시 준비</li>
            </ul>
            <p className="support-detail">{detail}</p>
            <button type="button" className="btn btn-outline" onClick={onOpen}>
              {supportOpen ? "후원하기" : "후원 준비 상태 보기"}
            </button>
            <p className="fineprint">
              탑서는 비영리 단체가 아니며 기부금 영수증이나 세액공제는 제공하지
              않습니다. 후원 여부와 앱 이용에는 아무 관계가 없어요.
            </p>
          </div>

          <div className="support-free">
            <h3>돈 말고도 큰 도움이 돼요</h3>
            <ul>
              <li>
                <a href="#waitlist">
                  <b>사전예약하기</b>
                  <span>TestFlight를 기다려주는 것만으로도 큰 도움이 돼요.</span>
                </a>
              </li>
              <li>
                <a href="#status">
                  <b>개발 현황 살펴보기</b>
                  <span>탑서가 어디까지 만들어졌는지 확인해보세요.</span>
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
      </div>
    </section>
  );
}
