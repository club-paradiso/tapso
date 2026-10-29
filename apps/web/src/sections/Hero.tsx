import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowIcon } from "../components/Icons";
import { EXTRA_FILMS, FILM_SCENES, filmAssetsExist, type FilmSceneId, type HeroFilmSource } from "../content/media.ts";
import config from "../design/marketing.json";
import { useHeroFilm, type FilmState } from "../lib/useHeroFilm";
import { getSiteReducedMotion, setSiteReducedMotion, useReducedMotion } from "../lib/useReducedMotion";
import { useHeroTracking } from "../story/storyStore.ts";

function FilmMedia({
  videoRef,
  state,
  hasFrame,
  film,
  loop,
  onEnded,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  state: FilmState;
  hasFrame: boolean;
  film: HeroFilmSource;
  loop: boolean;
  onEnded: () => void;
}) {
  return (
    <div className={`coast-media film-${state}${hasFrame ? " has-frame" : ""}`} aria-hidden="true">
      <picture>
        <source media="(max-aspect-ratio: 4/5)" srcSet={film.stills.portrait} />
        <img className="coast-still" src={film.stills.wide} alt="" decoding="async" fetchPriority="high" />
      </picture>
      <video
        ref={videoRef}
        className="coast-film"
        muted
        autoPlay
        loop={loop}
        playsInline
        preload="none"
        disablePictureInPicture
        tabIndex={-1}
        onEnded={onEnded}
      />
      <span className="coast-shade" />
    </div>
  );
}

/**
 * V4 continuous film: cycle by the actual media ended event rather than an
 * arbitrary timer. The next clip starts only after the previous clip ends.
 * Reduced-motion and data-saver preferences retain the static poster fallback.
 */
export function Hero() {
  const section = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  useHeroTracking(section);
  const reduceMotion = useReducedMotion();
  const [filmIndex, setFilmIndex] = useState(0);
  const [additionalFilms, setAdditionalFilms] = useState<FilmSceneId[]>([]);
  const [userReducedMotion, setUserReducedMotion] = useState(false);

  // Match SSR markup before reading persisted client-side preferences.
  useEffect(() => setUserReducedMotion(getSiteReducedMotion()), []);

  // Verify video and poster files before adding them to automatic playback.
  // A Vercel SPA 200/HTML fallback must never be treated as a valid MP4.
  useEffect(() => {
    let active = true;
    void Promise.all(EXTRA_FILMS.map(async ({ id, film }) => ({
      id,
      ready: await filmAssetsExist(film),
    }))).then((results) => {
      if (active) setAdditionalFilms(results.filter((result) => result.ready).map((result) => result.id));
    });
    return () => { active = false; };
  }, []);

  const playlist = FILM_SCENES.filter(({ id }) => id === "coast" || additionalFilms.includes(id));
  const current = playlist[filmIndex % playlist.length] ?? FILM_SCENES[0]!;
  const film = useHeroFilm(video, section, reduceMotion, true, current.film);

  const advanceFilm = () => {
    if (!reduceMotion && playlist.length > 1) {
      setFilmIndex((index) => (index + 1) % playlist.length);
    }
  };

  const toggleReducedMotion = () => {
    const next = !userReducedMotion;
    setUserReducedMotion(next);
    setSiteReducedMotion(next);
    if (next) video.current?.pause();
  };

  return (
    <section className="coast coast-v4" id="top" aria-labelledby="hero-title" ref={section}>
      <div className="coast-stage">
        <FilmMedia
          videoRef={video}
          state={film.state}
          hasFrame={film.hasFrame && !reduceMotion}
          film={current.film}
          loop={playlist.length <= 1}
          onEnded={advanceFilm}
        />
        <div className="coast-copy">
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
            <p className="coast-credit">{current.film.credit}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
