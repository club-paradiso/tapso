import { useEffect, useRef, useState } from "react";
import { ArrowIcon, PauseIcon, PlayIcon } from "../components/Icons";
import { HomeScreenPhone, LockScreenPhone } from "../components/NativeSurfaces";
import { PreviewTag } from "../components/RideParts";
import { presentMoment } from "../demo/rideMoments.ts";
import { HERO_LOOP, loopLabel } from "../story/beats.ts";
import { useHeroTracking, useStory } from "../story/storyStore.ts";
import { useReducedMotion } from "../lib/useReducedMotion";

/** How long each moment of the loop stays; riding gets the longest look. */
const HOLD_MS = [3400, 2600, 2600, 3000] as const;

/**
 * First screen: Jeju bus, iPhone, in development; destination, one bus check,
 * then the Lock Screen and the island carry the stops. The devices play the
 * ride's escalation once you are looking, pause off screen, and never move
 * for a visitor who asked for reduced motion.
 */
export function Hero() {
  const ref = useRef<HTMLElement>(null);
  useHeroTracking(ref);
  const heroInView = useStory((s) => s.heroInView);
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (reduceMotion) {
      setPlaying(false);
      return;
    }
    const start = window.setTimeout(() => setPlaying(true), 1200);
    return () => window.clearTimeout(start);
  }, [reduceMotion]);

  useEffect(() => {
    if (!playing || !heroInView) return;
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % HERO_LOOP.length), HOLD_MS[index] ?? 2600);
    return () => window.clearTimeout(timer);
  }, [playing, heroInView, index]);

  const activity = HERO_LOOP[index] ?? HERO_LOOP[0]!;
  const p = presentMoment(activity.moment);

  return (
    <section className="hero" id="top" aria-labelledby="hero-title" ref={ref}>
      <div className="container hero-grid">
        <div className="hero-copy">
          <p className="hero-chips">
            <span>제주 버스</span>
            <span>iPhone 앱</span>
            <span className="is-status">개발 중</span>
          </p>
          <h1 id="hero-title">
            와리지 말앙 <br className="hero-break" />
            혼저 탑서.
          </h1>
          <p className="hero-gloss">
            <span className="hero-gloss-tag">제주어</span>
            서두르지 말고, 어서 타세요.
          </p>
          <ol className="hero-steps">
            <li>
              <span className="hero-step-dot" aria-hidden="true" />
              내릴 곳을 고르고
            </li>
            <li>
              <span className="hero-step-dot" aria-hidden="true" />
              탄 버스를 한 번 확인하면
            </li>
            <li>
              <span className="hero-step-dot is-destination" aria-hidden="true" />
              남은 정거장은 잠금 화면과 다이나믹 아일랜드가 알려줘요
            </li>
          </ol>
          <div className="hero-actions">
            <a className="btn btn-primary btn-lg" href="#waitlist">
              TestFlight 사전예약
              <ArrowIcon />
            </a>
            <a className="btn btn-quiet btn-lg" href="#how">
              타는 법 보기
            </a>
          </div>
          <p className="hero-status">
            아직 개발 중이에요. TestFlight는 열리지 않았고, 열리면 사전예약하신 분께 먼저 알려드려요.{" "}
            <a className="text-link" href="#status">
              개발 현황
            </a>
            {" · "}
            <a className="text-link" href="#support">
              개발 후원
            </a>
          </p>
        </div>

        <div className={`hero-visual role-${p.colorRole}`}>
          <div className="hero-devices">
            <span className="hero-glow" aria-hidden="true" />
            <HomeScreenPhone activity={activity} form="compact" className="hero-phone-back" />
            <LockScreenPhone moment={activity.moment} remaining={activity.remaining} className="hero-phone-front" />
          </div>
          <div className="hero-rail">
            <ol aria-label="미리보기 단계">
              {HERO_LOOP.map((a, i) => (
                <li key={a.moment}>
                  <button
                    type="button"
                    className={`hero-rail-step role-${presentMoment(a.moment).colorRole}${i === index ? " is-active" : ""}${i < index ? " is-done" : ""}`}
                    aria-pressed={i === index}
                    onClick={() => {
                      setPlaying(false);
                      setIndex(i);
                    }}
                  >
                    <span className="hero-rail-node" aria-hidden="true" />
                    {loopLabel(a)}
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="icon-btn hero-play"
              onClick={() => setPlaying((v) => !v)}
              aria-label={playing ? "미리보기 자동 재생 멈추기" : "미리보기 자동 재생"}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
          </div>
          <PreviewTag>제품 미리보기 · 합성 데이터 · 왼쪽 다른 앱을 쓸 때, 오른쪽 잠금 화면</PreviewTag>
        </div>
      </div>
    </section>
  );
}
