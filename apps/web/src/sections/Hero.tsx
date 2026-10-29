import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowIcon, PauseIcon, PlayIcon } from "../components/Icons";
import { Island, LockScreenActivity, surfaceLabel } from "../components/NativeSurfaces";
import { EXTRA_FILMS, FILM_SCENES, filmAssetsExist, type FilmSceneId, type HeroFilmSource } from "../content/media.ts";
import config from "../design/marketing.json";
import { presentMoment } from "../demo/rideMoments.ts";
import { useHeroFilm, type FilmState } from "../lib/useHeroFilm";
import { getSiteReducedMotion, setSiteReducedMotion, useReducedMotion } from "../lib/useReducedMotion";
import { HERO_LOOP, loopLabel } from "../story/beats.ts";
import { useHeroTracking } from "../story/storyStore.ts";

type Scene = FilmSceneId | "preview";

function FilmMedia({
  videoRef,
  state,
  hasFrame,
  film,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  state: FilmState;
  hasFrame: boolean;
  film: HeroFilmSource;
}) {
  return (
    <div className={`coast-media film-${state}${hasFrame ? " has-frame" : ""}`} aria-hidden="true">
      <picture>
        <source media="(max-aspect-ratio: 4/5)" srcSet={film.stills.portrait} />
        <img className="coast-still" src={film.stills.wide} alt="" decoding="async" fetchPriority="high" />
      </picture>
      <video ref={videoRef} className="coast-film" muted loop playsInline preload="none" disablePictureInPicture tabIndex={-1} />
      <span className="coast-shade" />
    </div>
  );
}

/** Real product states: manually selected, never advanced by scrolling or a timer. */
function PreviewPhone({ step }: { step: number }) {
  const activity = HERO_LOOP[step] ?? HERO_LOOP[0]!;
  return (
    <div
      className={`coast-demo-phone phone phone-dark role-${presentMoment(activity.moment).colorRole}`}
      role="img"
      aria-label={surfaceLabel("잠금 화면", activity.moment, activity.remaining)}
    >
      <div className="phone-screen" aria-hidden="true">
        <div className="phone-status">
          <span className="phone-time">8:24</span>
          <span className="phone-indicators"><span className="phone-signal" /><span className="phone-battery" /></span>
        </div>
        <div className="phone-isle-slot"><Island activity={null} /></div>
        <div className="lock-clock"><span className="lock-date">9월 30일 수요일</span><span className="lock-time">8:24</span></div>
        <div className="lock-activity">
          <LockScreenActivity moment={activity.moment} remaining={activity.remaining} />
        </div>
      </div>
    </div>
  );
}

function DemoPreview({ step, onPick }: { step: number; onPick: (n: number) => void }) {
  return (
    <div className="coast-demo" aria-labelledby="coast-demo-title">
      <div className="coast-demo-copy">
        <p className="coast-eyebrow">화면을 직접 눌러보세요</p>
        <h2 id="coast-demo-title">버스에 타면,<br />내릴 때까지.</h2>
        <p>탑서가 정거장 수와 하차 시점을 잠금 화면에서 보여주는 방식이에요.</p>
        <div className="coast-steps" role="group" aria-label="앱 알림 단계 선택">
          {HERO_LOOP.map((item, index) => (
            <button
              key={item.moment}
              type="button"
              className={index === step ? "is-active" : ""}
              aria-pressed={index === step}
              onClick={() => onPick(index)}
            >
              {loopLabel(item)}
            </button>
          ))}
        </div>
        <p className="coast-note">앱 화면은 미리보기 · 합성 데이터</p>
      </div>
      <PreviewPhone step={step} />
    </div>
  );
}

function FilmControls({ state, onToggle, film }: { state: FilmState; onToggle: () => void; film: HeroFilmSource }) {
  return (
    <div className="coast-film-controls">
      <p className="coast-credit">
        {state === "failed" ? "영상을 불러오지 못해 사진으로 보여드려요. " : null}
        {film.credit}
      </p>
      {state !== "failed" && (
        <button type="button" className="coast-control-button" aria-pressed={state !== "playing"} onClick={onToggle}>
          {state === "playing" ? <PauseIcon /> : <PlayIcon />}
          <span>{state === "playing" ? "영상 멈추기" : "영상 재생"}</span>
        </button>
      )}
    </div>
  );
}

/**
 * V4 calm hero: no scroll-pinned film, no full-screen clip morph and no
 * automatic phone-state cycling. Film and product preview are user-selected.
 */
export function Hero() {
  const section = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  useHeroTracking(section);
  const reduceMotion = useReducedMotion();
  const [scene, setScene] = useState<Scene>("coast");
  const [step, setStep] = useState(0);
  const [additionalFilms, setAdditionalFilms] = useState<FilmSceneId[]>([]);
  const [userReducedMotion, setUserReducedMotion] = useState(false);
  // Match SSR markup first; load persisted client preference after hydration.
  useEffect(() => setUserReducedMotion(getSiteReducedMotion()), []);
  const selectedFilm = FILM_SCENES.find((entry) => entry.id === scene) ?? FILM_SCENES[0]!;
  const film = useHeroFilm(video, section, reduceMotion, scene !== "preview", selectedFilm.film);

  // Only offer a scene after every MP4/WebP asset is actually published. This
  // also guards against Vercel SPA fallback pages masquerading as an asset.
  useEffect(() => {
    let active = true;
    void Promise.all(EXTRA_FILMS.map(async ({ id, film: source }) => ({
      id,
      ready: await filmAssetsExist(source),
    }))).then((results) => {
      if (active) setAdditionalFilms(results.filter((x) => x.ready).map((x) => x.id));
    });
    return () => { active = false; };
  }, []);

  const pickScene = (next: Scene) => setScene(next);

  const toggleReducedMotion = () => {
    const next = !userReducedMotion;
    setUserReducedMotion(next);
    setSiteReducedMotion(next);
    if (next) video.current?.pause();
  };

  return (
    <section className={`coast coast-v4${scene === "preview" ? " is-preview" : ""}`} id="top" aria-labelledby="hero-title" ref={section}>
      <div className="coast-stage">
        <FilmMedia videoRef={video} state={film.state} hasFrame={film.hasFrame} film={selectedFilm.film} />
        {scene === "preview" ? <DemoPreview step={step} onPick={setStep} /> : null}
        <div className="coast-copy" aria-hidden={scene === "preview"} inert={scene === "preview"}>
          <p className="coast-eyebrow">제주 버스 · iPhone 앱 · <span className="coast-status">개발 중</span></p>
          <h1 id="hero-title">
            {config.copy.headline.split("\n").map((line, index) => (
              <span key={index}>{index > 0 ? <br /> : null}{line}</span>
            ))}
          </h1>
          <p className="coast-gloss"><span className="coast-gloss-tag">제주어</span>서두르지 말고, 어서 타세요.</p>
          <p className="coast-lede">{config.copy.description}</p>
          <div className="coast-actions">
            <a className="btn btn-primary btn-lg" href="#waitlist">{config.copy.cta}<ArrowIcon /></a>
            <a className="btn btn-glass btn-lg" href="#how">타는 법 보기</a>
          </div>
          <p className="coast-status-line">
            아직 개발 중이고 TestFlight는 열리지 않았어요. 열리면 사전예약하신 분께 먼저 알려드려요.{" "}
            <a href="#status">개발 현황 보기</a>
          </p>
        </div>
        <div className="coast-bottom">
          <div className="coast-scene-picker" role="group" aria-label="화면 선택">
             {FILM_SCENES.filter(({ id }) => id === "coast" || additionalFilms.includes(id)).map(({ id, label }) => (
              <button type="button" key={id} aria-pressed={scene === id} className={scene === id ? "is-active" : ""} onClick={() => pickScene(id)}>{label}</button>
            ))}
            <button type="button" aria-pressed={scene === "preview"} className={scene === "preview" ? "is-active" : ""} onClick={() => pickScene("preview")}>앱 미리보기</button>
          </div>
          <div className="coast-bottom-actions">
            <button
              type="button"
              className="coast-control-button"
              onClick={toggleReducedMotion}
              aria-pressed={userReducedMotion}
              title={reduceMotion && !userReducedMotion ? "기기 설정에서 움직임을 줄이고 있어요" : undefined}
            >
              {userReducedMotion ? "움직임 기본값" : "움직임 줄이기"}
            </button>
            {scene !== "preview" ? <FilmControls state={film.state} onToggle={film.toggle} film={selectedFilm.film} /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
