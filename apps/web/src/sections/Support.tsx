import { useEffect, useState } from "react";
import { GitHubIcon } from "../components/Icons";
import { SectionHead } from "../components/SectionHead";
import { LINKS } from "../content/site.ts";
import { fetchSupportConfig, type SupportConfigResponse } from "../lib/supportClient";
import { supportStatus } from "../lib/supportStatus.ts";
import { useInView } from "../lib/useInView";

/**
 * Support, restrained. Whether payment is open is asked of the server once the
 * section is near; until it answers `live`, the section says payment is not
 * open and the button only opens the explanatory sheet.
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

  const status = supportStatus(config);

  return (
    <section className="section support" id="support" aria-labelledby="support-title" ref={ref}>
      <div className="container">
        <SectionHead index="10" eyebrow="응원하기" title="탑서를 응원하는 방법" titleId="support-title">
          <p>출시까지 드는 비용이 있어요. 어디에 쓸지 먼저 적어둘게요.</p>
        </SectionHead>

        <div className="support-grid">
          <div className="support-card">
            <p className="support-status">
              <span className={`state-pill tone-${status.open ? "done" : "next"}`}>{status.label}</span>
            </p>
            <h3>후원금이 쓰일 곳</h3>
            <ul className="support-uses">
              <li>Apple Developer Program 가입비</li>
              <li>실제 iPhone에서 하는 기기 테스트</li>
              <li>서버와 실시간 데이터 운영</li>
              <li>TestFlight와 출시 준비</li>
            </ul>
            <p className="support-detail">{status.detail}</p>
            <button type="button" className="btn btn-outline" onClick={onOpen}>
              {status.action}
            </button>
            <p className="fineprint">
              탑서는 비영리 단체가 아니에요. 기부금 영수증이나 세액공제는 제공하지 않아요. 후원하지
              않아도 탑서는 똑같이 쓸 수 있어요.
            </p>
          </div>

          <div className="support-free">
            <h3>지금 바로 할 수 있는 응원</h3>
            <ul>
              <li>
                <a href="#waitlist">
                  <b>사전예약하기</b>
                  <span>첫 승객이 되어주는 게 가장 큰 힘이에요.</span>
                </a>
              </li>
              <li>
                <a href={LINKS.github} rel="noopener">
                  <b>
                    <GitHubIcon /> GitHub에서 지켜보기
                  </b>
                  <span>코드와 진행 기록이 모두 공개돼 있어요.</span>
                </a>
              </li>
              <li>
                <a href={LINKS.issues} rel="noopener">
                  <b>의견 남기기</b>
                  <span>제주 버스를 타며 불편했던 점을 알려주세요.</span>
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
