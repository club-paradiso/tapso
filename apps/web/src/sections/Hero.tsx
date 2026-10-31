import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowIcon } from "../components/Icons";
import { EXTRA_FILMS, FILM_SCENES, filmAssetsExist, type FilmSceneId, type HeroFilmSource } from "../content/media.ts";
import config from "../design/marketing.json";
import { useHeroCrossfade } from "../lib/useHeroFilm";
import { useReducedMotion } from "../lib/useReducedMotion";
import { useHeroTracking } from "../story/storyStore.ts";

type Slot = 0 | 1;

function FilmMedia({
  first,
  second,
  activeSlot,
  incomingSlot,
  hasFrame,
  film,
}: {
  first: RefObject<HTMLVideoElement | null>;
  second: RefObject<HTMLVideoElement | null>;
  activeSlot: Slot;
  incomingSlot: Slot | null;
  hasFrame: boolean;
  film: HeroFilmSource;
}) {
  const role = (slot: Slot): string => {
    if (slot === incomingSlot) return "is-incoming";
    return slot === activeSlot && hasFrame ? "is-active" : "is-standby";
  };

  return (
    <div className="coast-media" aria-hidden="true">
      <picture>
        <source media="(max-aspect-ratio: 4/5)" srcSet={film.stills.portrait} />
        <img className="coast-still" src={film.stills.wide} alt="" decoding="async" fetchPriority="high" />
      </picture>
      <video
        ref={first}
        className={`coast-film ${role(0)}`}
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        tabIndex={-1}
      />
      <video
        ref={second}
        className={`coast-film ${role(1)}`}
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        tabIndex={-1}
      />
      <span className="coast-shade" />
    </div>
  );
}

/**
 * Four user-supplied AI rider scenes, full duration, preloaded and crossfaded.
 * No scene controls, scroll pinning, or artificial playing-state overlays.
 */
export function Hero() {
  const section = useRef<HTMLElement>(null);
  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  useHeroTracking(section);
  const reduceMotion = useReducedMotion();
  const [additionalFilms, setAdditionalFilms] = useState<FilmSceneId[]>([]);

  // Never schedule a scene without its published MP4 and poster images.
  // Check MIME as well: a 200 SPA HTML fallback is not a working video.
  useEffect(() => {
    let active = true;
    void Promise.all(EXTRA_FILMS.map(async ({ id, film }) => ({
      id,
      ready: await filmAssetsExist(film),
    }))).then((results) => {
      if (active) setAdditionalFilms(results.filter(({ ready }) => ready).map(({ id }) => id));
    });
    return () => { active = false; };
  }, []);

  const playlist = useMemo(
    () => FILM_SCENES.filter(({ id }) => id === "rural-city" || additionalFilms.includes(id)),
    [additionalFilms],
  );
  const player = useHeroCrossfade(videoA, videoB, section, playlist, reduceMotion);
  const current = playlist[player.activeIndex] ?? FILM_SCENES[0]!;

  return (
    <section className="coast coast-v4" id="top" aria-labelledby="hero-title" ref={section}>
      <div className="coast-stage">
        <FilmMedia
          first={videoA}
          second={videoB}
          activeSlot={player.activeSlot}
          incomingSlot={player.incomingSlot}
          hasFrame={player.hasFrame && !reduceMotion}
          film={current.film}
        />
        <div className="coast-copy">
          <h1 id="hero-title">
            {config.copy.headline.split("\n").map((line, index) => (
              <span key={index}>{index > 0 ? <br /> : null}{line}</span>
            ))}
          </h1>
          <p className="coast-gloss">서두르지 말고, 쉬어 가며 타세요.</p>
          <p className="coast-lede">내가 탄 제주 버스와 남은 정거장,<br />내릴 때를 한눈에. 개발 중인 iPhone 앱이에요.</p>
          <div className="coast-actions">
            <a className="btn btn-primary btn-lg" href="#how">타는 법 살펴보기<ArrowIcon /></a>
            <a className="coast-status-link" href="#status">개발 현황 보기</a>
          </div>
          <p className="coast-status-line">
            아직 개발 중이며 TestFlight는 공개되지 않았어요. 사전예약도 받고 있지 않아요.
          </p>
        </div>
        <div className="coast-bottom">
          <div className="coast-bottom-actions">
            <p className="coast-credit">{current.film.credit}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
