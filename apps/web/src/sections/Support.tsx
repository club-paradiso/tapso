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
        <SectionHead index="10" eyebrow="응원하기" title="탑서에 힘을 보태고 싶다면" titleId="support-title">
          <p>서버비, 실제 기기 테스트, 출시 준비에 비용이 들어요. 후원이 열리면 여기서 받을게요.</p>
        </SectionHead>

        <div className="support-grid">
          <div className="support-card">
            <p className="support-status">
              <span className={`state-pill tone-${status.open ? "done" : "next"}`}>{status.label}</span>
            </p>
            <h3>후원금은 여기에 써요</h3>
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
              탑서는 비영리 단체가 아니며 기부금 영수증이나 세액공제는 제공하지 않습니다. 후원 여부와 앱 이용에는 아무 관계가 없어요.
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
                <a href={LINKS.github} rel="noopener">
                  <b>
                    <GitHubIcon /> GitHub에서 지켜보기
                  </b>
                  <span>개발 과정과 코드는 전부 공개해두고 있어요.</span>
                </a>
              </li>
              <li>
                <a href={LINKS.issues} rel="noopener">
                  <b>의견 남기기</b>
                  <span>제주 버스를 타면서 겪은 불편을 알려주세요.</span>
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
