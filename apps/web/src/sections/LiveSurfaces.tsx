import { useState } from "react";
import { BellIcon, LockIcon } from "../components/Icons";
import { IslandCompact, IslandExpanded, IslandMinimal, LockScreenPhone, surfaceLabel } from "../components/NativeSurfaces";
import { PreviewTag } from "../components/RideParts";
import { SectionHead } from "../components/SectionHead";
import { presentMoment, type RideMoment } from "../demo/rideMoments.ts";

type LiveStep = { moment: RideMoment; remaining: number; label: string };

const LIVE_STEPS: readonly LiveStep[] = [
  { moment: "riding", remaining: 6, label: "6정거장" },
  { moment: "prepare", remaining: 2, label: "2정거장" },
  { moment: "nextStop", remaining: 1, label: "다음 하차" },
  { moment: "arrived", remaining: 0, label: "도착" },
];

/**
 * The hero feature: Lock Screen and Dynamic Island, driven by one moment rail
 * the way one `RideGuidance` drives every native surface.
 */
export function LiveSurfaces() {
  const [index, setIndex] = useState(0);
  const step = LIVE_STEPS[index] ?? LIVE_STEPS[0]!;
  const p = presentMoment(step.moment);

  return (
    <section className="section live on-dark" id="live" aria-labelledby="live-title">
      <div className="container">
        <SectionHead
          index="03"
          eyebrow="잠금 화면 · 다이나믹 아일랜드"
          title={
            <>
              휴대폰을 열지 않아도,
              <br />
              내릴 때가 보여요.
            </>
          }
          titleId="live-title"
        >
          <p>
            버스를 확인하면 iPhone의 실시간 현황이 시작돼요. 잠금 화면에도, 다른 앱을 쓰는
            동안의 다이나믹 아일랜드에도 남은 정거장이 떠 있어요. 가까워질수록 더 또렷해져요.
          </p>
        </SectionHead>

        <div className="live-rail" role="group" aria-label="여정 단계 고르기">
          {LIVE_STEPS.map((s, i) => (
            <button
              key={s.moment}
              type="button"
              className={`live-rail-step role-${presentMoment(s.moment).colorRole}${i === index ? " is-active" : ""}${i < index ? " is-done" : ""}`}
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
            >
              <span className="live-rail-node" aria-hidden="true" />
              {s.label}
            </button>
          ))}
        </div>

        <div className={`live-grid role-${p.colorRole}`}>
          <div className="live-lock">
            <LockScreenPhone moment={step.moment} remaining={step.remaining} className="live-phone" />
            <p className="live-caption">
              <LockIcon />
              잠금 화면
            </p>
          </div>

          <div className="live-islands">
            <div className="live-island-card">
              <p className="live-island-label">
                <b>다른 앱을 쓰는 중</b>
                <span>다이나믹 아일랜드 · 작게</span>
              </p>
              <div className="live-island-stage" role="img" aria-label={surfaceLabel("다이나믹 아일랜드 작은 화면", step.moment, step.remaining)}>
                <IslandCompact moment={step.moment} remaining={step.remaining} />
              </div>
            </div>
            <div className="live-island-card">
              <p className="live-island-label">
                <b>길게 누르면</b>
                <span>다이나믹 아일랜드 · 펼침</span>
              </p>
              <div className="live-island-stage" role="img" aria-label={surfaceLabel("다이나믹 아일랜드 펼친 화면", step.moment, step.remaining)}>
                <IslandExpanded moment={step.moment} remaining={step.remaining} />
              </div>
            </div>
            <div className="live-island-card live-island-card-row">
              <p className="live-island-label">
                <b>다른 실시간 현황과 겹치면</b>
                <span>다이나믹 아일랜드 · 최소</span>
              </p>
              <div className="live-island-stage" role="img" aria-label={surfaceLabel("다이나믹 아일랜드 최소 화면", step.moment, step.remaining)}>
                <IslandMinimal moment={step.moment} remaining={step.remaining} />
              </div>
            </div>

            <div className={`live-alert${p.milestone ? " is-on" : ""}`} aria-live="polite">
              <BellIcon />
              {p.milestone ? (
                <span>
                  <b>이 순간 한 번 알려요.</b> 화면이 켜지고 알림음이 울려요. 다이나믹 아일랜드가 없는
                  iPhone에서는 배너로 떠요.
                </span>
              ) : (
                <span>
                  <b>지금은 조용히.</b> 알림은 2정거장, 다음 정류장, 도착에서 한 번씩만 와요.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="live-foot">
          <PreviewTag>제품 미리보기 · 브라우저에서는 실제 다이나믹 아일랜드가 동작하지 않아요</PreviewTag>
        </div>
      </div>
    </section>
  );
}
