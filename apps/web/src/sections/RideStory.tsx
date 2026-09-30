import { useEffect, useRef, useState } from "react";
import { AppScreen, screenLabel } from "../components/AppScreens";
import { ArrowIcon, PauseIcon, PlayIcon } from "../components/Icons";
import { LockScreenPhone, PhoneFrame } from "../components/NativeSurfaces";
import { PreviewTag } from "../components/RideParts";
import { SectionHead } from "../components/SectionHead";
import { CHAPTER_LABELS, RIDE_STORY, clampStep, type Chapter } from "../demo/rideStory.ts";
import { useInView } from "../lib/useInView";

const AUTOPLAY_MS = 3200;
const CHAPTERS: Chapter[] = ["plan", "confirm", "ride"];

/**
 * "이렇게 작동해요" — the whole ride in ten steps.
 *
 * A stepper, not scroll-jacking: every step is a button, the phone shows the
 * matching native screen, and an optional player advances on its own only
 * after the visitor presses play (and pauses when the section leaves view).
 */
export function RideStory() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sectionRef, inView] = useInView<HTMLElement>("0px");
  const railRef = useRef<HTMLDivElement>(null);
  const step = RIDE_STORY[index] ?? RIDE_STORY[0]!;
  const last = RIDE_STORY.length - 1;

  // On narrow screens the steps are a horizontal rail: keep the current one in
  // view by scrolling the rail itself, never the page.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || rail.scrollWidth <= rail.clientWidth) return;
    const current = rail.querySelector<HTMLElement>('[aria-current="step"]');
    if (!current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({
      left: current.offsetLeft - rail.clientWidth / 2 + current.offsetWidth / 2,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [index]);

  useEffect(() => {
    if (!playing || !inView) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setIndex((i) => clampStep(i + 1)), AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [playing, inView, index, last]);

  const go = (next: number) => {
    setPlaying(false);
    setIndex(clampStep(next));
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (index >= last) setIndex(0);
    setPlaying(true);
  };

  return (
    <section className="section story" id="how" aria-labelledby="how-title" ref={sectionRef}>
      <div className="container">
        <SectionHead index="01" eyebrow="이렇게 써요" title="내릴 곳 고르고, 버스만 한 번 확인하면 돼요." titleId="how-title">
          <p>
            아래 단계를 눌러 탑서를 쓰는 흐름을 미리 볼 수 있어요. 실제 iOS 앱 화면을 바탕으로 만든 데모예요.
          </p>
        </SectionHead>

        <div className="story-grid">
          <div className="story-steps-wrap" ref={railRef}>
            {CHAPTERS.map((chapter) => (
              <div className="story-chapter" key={chapter}>
                <p className="story-chapter-label" aria-hidden="true">
                  {CHAPTER_LABELS[chapter]}
                </p>
                <ol className="story-steps" aria-label={CHAPTER_LABELS[chapter]}>
                  {RIDE_STORY.map((s, i) =>
                    s.chapter !== chapter ? null : (
                      <li key={s.id}>
                        <button
                          type="button"
                          className={`story-step${i === index ? " is-active" : ""}${i < index ? " is-done" : ""}`}
                          aria-current={i === index ? "step" : undefined}
                          onClick={() => go(i)}
                        >
                          <span className="story-step-num" aria-hidden="true">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="story-step-text">
                            <span className="story-step-label">{s.label}</span>
                            <span className="story-step-title">{s.title}</span>
                            {i === index ? <span className="story-step-body">{s.body}</span> : null}
                          </span>
                        </button>
                      </li>
                    ),
                  )}
                </ol>
              </div>
            ))}
          </div>

          <div className="story-stage">
            <div className="story-device">
              {step.screen.kind === "ride" ? (
                <LockScreenPhone moment={step.screen.moment} remaining={step.screen.remaining} className="story-phone" />
              ) : (
                <PhoneFrame className="story-phone" label={screenLabel(step.screen)}>
                  <AppScreen screen={step.screen} />
                </PhoneFrame>
              )}
              <span className="story-device-note" aria-hidden="true">
                {step.screen.kind === "ride" ? "잠금 화면" : "앱 화면"}
              </span>
            </div>

            <div className="story-caption" aria-hidden="true">
              <span className="story-caption-count">
                {index + 1} / {RIDE_STORY.length} · {CHAPTER_LABELS[step.chapter]}
              </span>
              <strong>{step.title}</strong>
              <span>{step.body}</span>
            </div>

            <div className="story-controls">
              <button type="button" className="icon-btn" onClick={() => go(index - 1)} disabled={index === 0} aria-label="이전 단계">
                <ArrowIcon className="flip" />
              </button>
              <button type="button" className="btn btn-quiet btn-sm story-play" onClick={togglePlay} aria-pressed={playing}>
                {playing ? <PauseIcon /> : <PlayIcon />}
                {playing ? "멈춤" : index >= last ? "처음부터 재생" : "자동 재생"}
              </button>
              <button type="button" className="icon-btn" onClick={() => go(index + 1)} disabled={index === last} aria-label="다음 단계">
                <ArrowIcon />
              </button>
            </div>
            <PreviewTag />
            <p className="visually-hidden" aria-live="polite">
              {`${RIDE_STORY.length}단계 중 ${index + 1}단계. ${step.title}. ${step.body}`}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
