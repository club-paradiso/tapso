import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ArrowIcon, PauseIcon, PlayIcon } from "../components/Icons";
import { Island, LockScreenActivity, surfaceLabel } from "../components/NativeSurfaces";
import { HERO_FILM } from "../content/media.ts";
import config from "../design/marketing.json";
import { presentMoment } from "../demo/rideMoments.ts";
import { useHeroFilm, type FilmState } from "../lib/useHeroFilm";
import { useReducedMotion } from "../lib/useReducedMotion";
import { HERO_LOOP, loopLabel } from "../story/beats.ts";
import { useHeroTracking } from "../story/storyStore.ts";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** iPhone 15/16 screen proportions, as in `.phone`. */
const PHONE_RATIO = 852 / 393;

type Box = { x: number; y: number; w: number; h: number };

/** Where the phone sits once the film has become its Lock Screen. */
function phoneBox(vw: number, vh: number): Box {
  const narrow = vw < 760;
  const h = narrow ? Math.min(vh * 0.56, 500) : Math.min((vh - 64) * 0.84, 760);
  const w = h / PHONE_RATIO;
  const cx = narrow ? vw / 2 : Math.min(vw * 0.7, vw / 2 + 360);
  const y = narrow ? 76 : 64 + (vh - 64 - h) / 2;
  return { x: cx - w / 2, y, w, h };
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const ramp = (p: number, from: number, to: number) => clamp((p - from) / (to - from));
const ease = (t: number) => t * t * (3 - 2 * t);

/** The ride moment the phone shows at a scroll position. */
function stepAt(p: number): number {
  return Math.min(HERO_LOOP.length - 1, Math.floor(ramp(p, 0.64, 0.98) * HERO_LOOP.length));
}

/**
 * Paints one stage at progress `p`: 0 is the film filling the screen, 1 is the
 * film cut down to an iPhone screen with TAPSO's Lock Screen Live Activity on
 * it. Writes CSS variables only, so scrolling never re-renders React.
 */
function paint(stage: HTMLElement, p: number) {
  const vw = stage.clientWidth;
  const vh = stage.clientHeight;
  const box = phoneBox(vw, vh);
  const pad = box.w * 0.03;
  const e = ease(ramp(p, 0.1, 0.58));
  const top = (box.y + pad) * e;
  const left = (box.x + pad) * e;
  const right = (vw - box.x - box.w + pad) * e;
  const bottom = (vh - box.y - box.h + pad) * e;
  const radius = box.w * 0.128 * e;
  stage.style.setProperty("--film-clip", `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`);
  stage.style.setProperty("--phone-x", `${box.x}px`);
  stage.style.setProperty("--phone-y", `${box.y}px`);
  stage.style.setProperty("--phone-w", `${box.w}px`);
  stage.style.setProperty("--copy-out", `${ramp(p, 0.02, 0.24)}`);
  stage.style.setProperty("--device-in", `${ramp(p, 0.5, 0.62)}`);
  stage.style.setProperty("--pocket-in", `${ramp(p, 0.52, 0.7)}`);
}

/** Drives the sticky stage from the section's scroll position. */
function useScrollStage(section: RefObject<HTMLElement | null>, stage: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [progress, setProgress] = useState({ step: 0, pocket: false });

  useIsoLayoutEffect(() => {
    const host = section.current;
    const el = stage.current;
    if (!host || !el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = host.getBoundingClientRect();
      const travel = rect.height - el.clientHeight;
      const p = enabled && travel > 0 ? clamp(-rect.top / travel) : 0;
      paint(el, p);
      const next = { step: stepAt(p), pocket: p > 0.5 };
      setProgress((prev) => (prev.step === next.step && prev.pocket === next.pocket ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("resize", schedule);
    if (enabled) window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [enabled, section, stage]);

  return progress;
}

function FilmMedia({
  videoRef,
  state,
  hasFrame = false,
}: {
  videoRef?: RefObject<HTMLVideoElement | null>;
  state: FilmState;
  hasFrame?: boolean;
}) {
  return (
    <div className={`coast-media film-${state}${hasFrame ? " has-frame" : ""}`} aria-hidden="true">
      <picture>
        <source media="(max-aspect-ratio: 4/5)" srcSet={HERO_FILM.stills.portrait} />
        <img className="coast-still" src={HERO_FILM.stills.wide} alt="" decoding="async" fetchPriority="high" />
      </picture>
      {videoRef ? (
        <video ref={videoRef} className="coast-film" muted loop playsInline preload="none" disablePictureInPicture tabIndex={-1} />
      ) : null}
      <span className="coast-shade" />
    </div>
  );
}

/** The phone the film turns into: hardware edge, island, clock and TAPSO's Live Activity. */
function PocketPhone({ step, hidden }: { step: number; hidden: boolean }) {
  const activity = HERO_LOOP[step] ?? HERO_LOOP[0]!;
  return (
    <div
      className={`coast-phone phone phone-dark role-${presentMoment(activity.moment).colorRole}`}
      role="img"
      aria-label={surfaceLabel("잠금 화면", activity.moment, activity.remaining)}
      aria-hidden={hidden || undefined}
    >
      <div className="phone-screen" aria-hidden="true">
        <div className="phone-status">
          <span className="phone-time">8:24</span>
          <span className="phone-indicators">
            <span className="phone-signal" />
            <span className="phone-battery" />
          </span>
        </div>
        <div className="phone-isle-slot">
          <Island activity={null} />
        </div>
        <div className="lock-clock">
          <span className="lock-date">9월 30일 수요일</span>
          <span className="lock-time">8:24</span>
        </div>
        <div className="lock-activity">
          <LockScreenActivity moment={activity.moment} remaining={activity.remaining} />
        </div>
      </div>
    </div>
  );
}

function StepPicker({ step, onPick }: { step: number; onPick: (i: number) => void }) {
  return (
    <ol className="coast-steps" aria-label="잠금 화면 미리보기 단계">
      {HERO_LOOP.map((a, i) => (
        <li key={a.moment}>
          <button
            type="button"
            className={`role-${presentMoment(a.moment).colorRole}${i === step ? " is-active" : ""}${i < step ? " is-done" : ""}`}
            aria-pressed={i === step}
            onClick={() => onPick(i)}
          >
            {loopLabel(a)}
          </button>
        </li>
      ))}
    </ol>
  );
}

function PocketCopy({ step, onPick, hidden }: { step: number; onPick: (i: number) => void; hidden: boolean }) {
  return (
    <div className="coast-pocket" inert={hidden}>
      <p className="coast-eyebrow">창밖은 제주, 정거장은 탑서가</p>
      <h2 className="coast-pocket-title">
        버스에 탔다면,
        <br />
        휴대폰은 주머니에.
      </h2>
      <p className="coast-pocket-body">
        탄 버스를 한 번 확인하면 남은 정거장과 내릴 때를 잠금 화면과 다이나믹 아일랜드가 알려줘요.
      </p>
      <StepPicker step={step} onPick={onPick} />
      <p className="coast-note">앱 화면은 미리보기 · 합성 데이터</p>
    </div>
  );
}

function FilmBar({ state, onToggle }: { state: FilmState; onToggle: () => void }) {
  const playing = state === "playing";
  return (
    <div className="coast-bar">
      <p className="coast-credit">
        {state === "failed" ? "영상을 불러오지 못해 사진으로 보여드려요. " : null}
        {HERO_FILM.credit}
      </p>
      {state === "failed" ? null : (
        <button type="button" className="coast-toggle" onClick={onToggle} aria-pressed={!playing}>
          {playing ? <PauseIcon /> : <PlayIcon />}
          <span>{playing ? "영상 멈추기" : "영상 재생"}</span>
        </button>
      )}
    </div>
  );
}

/**
 * First screen: real footage of a Jeju coastal road fills the screen under
 * the promise and the waitlist button. Scrolling cuts the same film down to
 * an iPhone screen, where TAPSO's Lock Screen Live Activity counts the stops
 * down: the scenery outside, the stops in your pocket. With reduced motion
 * nothing is tied to scrolling; the two moments are stacked instead.
 */
export function Hero() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pocketStage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  useHeroTracking(section);
  const reduceMotion = useReducedMotion();
  const film = useHeroFilm(video, section, reduceMotion);
  const scroll = useScrollStage(section, stage, !reduceMotion);
  const [picked, setPicked] = useState<number | null>(null);

  // A pick holds until the visitor scrolls on to another moment.
  useEffect(() => setPicked(null), [scroll.step]);
  useIsoLayoutEffect(() => {
    const el = pocketStage.current;
    if (!reduceMotion || !el) return;
    const repaint = () => paint(el, 1);
    repaint();
    window.addEventListener("resize", repaint);
    return () => window.removeEventListener("resize", repaint);
  }, [reduceMotion]);
  const step = picked ?? scroll.step;
  const pick = useCallback((i: number) => setPicked(i), []);

  return (
    <section className={`coast${reduceMotion ? " is-static" : ""}`} id="top" aria-labelledby="hero-title" ref={section}>
      <div className="coast-stage" ref={stage}>
        <FilmMedia videoRef={video} state={film.state} hasFrame={film.hasFrame} />
        {reduceMotion ? null : (
          <>
            <PocketPhone step={step} hidden={!scroll.pocket} />
            <PocketCopy step={step} onPick={pick} hidden={!scroll.pocket} />
          </>
        )}
        <div className="coast-copy" inert={scroll.pocket}>
          <p className="coast-eyebrow">
            제주 버스 · iPhone 앱 · <span className="coast-status">개발 중</span>
          </p>
          <h1 id="hero-title">
            {config.copy.headline.split("\n").map((line, i) => (
              <span key={line}>
                {i > 0 ? <br /> : null}
                {line}
              </span>
            ))}
          </h1>
          <p className="coast-gloss">
            <span className="coast-gloss-tag">제주어</span>서두르지 말고, 어서 타세요.
          </p>
          <p className="coast-lede">{config.copy.description}</p>
          <div className="coast-actions">
            <a className="btn btn-primary btn-lg" href="#waitlist">
              {config.copy.cta}
              <ArrowIcon />
            </a>
            <a className="btn btn-glass btn-lg" href="#how">
              타는 법 보기
            </a>
          </div>
          <p className="coast-status-line">
            아직 개발 중이고 TestFlight는 열리지 않았어요. 열리면 사전예약하신 분께 먼저 알려드려요.{" "}
            <a href="#status">개발 현황 보기</a>
          </p>
        </div>
        <FilmBar state={film.state} onToggle={film.toggle} />
        {reduceMotion ? null : (
          <span className="coast-cue" aria-hidden="true">
            스크롤하면 잠금 화면으로
          </span>
        )}
      </div>
      {reduceMotion ? (
        <div className="coast-stage is-pocket" ref={pocketStage}>
          <FilmMedia state="still" />
          <PocketPhone step={step} hidden={false} />
          <PocketCopy step={step} onPick={pick} hidden={false} />
        </div>
      ) : null}
    </section>
  );
}
