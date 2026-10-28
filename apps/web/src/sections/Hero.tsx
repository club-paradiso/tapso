import { useEffect, useRef, useState } from "react";
import { ArrowIcon, PauseIcon, PlayIcon } from "../components/Icons";
import { LockScreenPhone } from "../components/NativeSurfaces";
import { PreviewTag } from "../components/RideParts";
import { presentMoment } from "../demo/rideMoments.ts";
import { HERO_LOOP, loopLabel } from "../story/beats.ts";
import { useHeroTracking, useStory } from "../story/storyStore.ts";
import config from "../design/marketing.json";
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const userPaused = useRef(false);
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

  useEffect(() => {
    if (!heroInView) videoRef.current?.pause();
    else if (!reduceMotion && !userPaused.current && videoRef.current?.paused) void videoRef.current.play().catch(() => setVideoPlaying(false));
  }, [heroInView, reduceMotion]);

  return (
    <section className="hero liquid-hero" id="top" aria-labelledby="hero-title" ref={ref}>
      <video ref={videoRef} className="hero-film" muted playsInline loop autoPlay={!reduceMotion} preload="metadata" poster="/media/jeju-coast.webp" aria-hidden="true" onPlay={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)}>
        <source src="/media/jeju-journey.mp4" type="video/mp4" />
      </video>
      <div className="hero-wash" aria-hidden="true"/>
      <div className="container hero-grid">
        <div className="hero-copy">
          <p className="hero-chips">
            <span>제주 버스</span>
            <span>iPhone 앱</span>
            <span className="is-status">개발 중</span>
          </p>
          <h1 id="hero-title">
            {config.copy.headline.split("\n").map((line,i)=><span key={line}>{i>0?<br/>:null}{line}</span>)}
          </h1>
          <p className="hero-gloss">
            <span className="hero-gloss-tag">제주어</span>
            서두르지 말고, 어서 타세요.
          </p>
          <p className="liquid-lede">{config.copy.description}</p>
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
              {config.copy.cta}
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
          <PreviewTag>제품 미리보기 · 합성 데이터</PreviewTag>
        </div>
      </div>
      <div className="lens-controls"><span>풍경은 연출 이미지 · 앱 화면은 미리보기</span><button type="button" onClick={() => { const video = videoRef.current; if (!video) return; if (video.paused) { userPaused.current = false; void video.play().catch(() => setVideoPlaying(false)); } else { userPaused.current = true; video.pause(); } }} aria-label={videoPlaying ? "배경 영상 일시 정지" : "배경 영상 재생"}>{videoPlaying ? "영상 멈추기" : "영상 재생"}</button><a href="#how">아래로 내려서 타보기 ↓</a></div>
    </section>
  );
}
