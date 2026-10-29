import { useEffect, useRef, useState, type RefObject } from "react";
import { type HeroFilmSource } from "../content/media.ts";

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

// New Gemini rider clips run for their own durations (10s / 5s), with
// a one-second overlap; the final second is not cut off mid-shot.
const CROSSFADE_MS = 1000;

/** Honor operating-system motion and network data-saving preferences. */
function prefersStill(reduceMotion: boolean): boolean {
  if (reduceMotion) return true;
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return Boolean(connection?.saveData) ||
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g";
}

function chooseSource(film: HeroFilmSource): string {
  const tall = window.matchMedia?.("(max-aspect-ratio: 4/5)")?.matches ?? false;
  if (tall) return film.files.portrait;
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  const pixels = window.innerWidth * Math.min(window.devicePixelRatio || 1, 2);
  return pixels > 1500 && connection?.effectiveType !== "3g"
    ? film.files.wide
    : film.files.medium;
}

type Slot = 0 | 1;

/**
 * Double-buffered hero video player.
 *
 * Both video elements stay mounted. The active clip remains fully visible
 * while the next clip loads invisibly. A transition starts only once the next
 * video can decode and play, *before* the outgoing video ends. With slow
 * networks the current video loops until the incoming buffer is ready,
 * instead of exposing a black frame or a still poster between scenes.
 */
export function useHeroCrossfade(
  first: RefObject<HTMLVideoElement | null>,
  second: RefObject<HTMLVideoElement | null>,
  section: RefObject<HTMLElement | null>,
  playlist: readonly { film: HeroFilmSource }[],
  reduceMotion: boolean,
): {
  activeSlot: Slot;
  incomingSlot: Slot | null;
  activeIndex: number;
  hasFrame: boolean;
} {
  const [activeSlot, setActiveSlot] = useState<Slot>(0);
  const [incomingSlot, setIncomingSlot] = useState<Slot | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    const a = first.current;
    const b = second.current;
    if (!a || !b || playlist.length === 0) return;

    const videos = [a, b] as const;
    let destroyed = false;
    let onScreen = true;
    let currentSlot: Slot = 0;
    let currentIndex = 0;
    // Media time at the end of the previous fade. Counting from this point
    // keeps subsequent scene durations consistent despite the overlap.
    let activeAt = 0;
    let transitioning = false;
    let fadeTimer: number | undefined;

    // Reset both slots before applying the visitor's motion/data preference.
    for (const video of videos) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    setActiveSlot(0);
    setIncomingSlot(null);
    setActiveIndex(0);
    setHasFrame(false);

    if (prefersStill(reduceMotion)) return;

    function prepare(slot: Slot, index: number) {
      const video = videos[slot];
      const film = playlist[index]?.film;
      if (!film) return;
      video.pause();
      video.src = chooseSource(film);
      video.load();
    }

    prepare(0, 0);
    if (playlist.length > 1) prepare(1, 1);

    function resumeIfVisible() {
      if (destroyed) return;
      if (!onScreen || document.hidden) {
        for (const video of videos) video.pause();
        return;
      }
      const video = videos[currentSlot];
      void video.play().then(() => {
        if (!destroyed && video === videos[currentSlot]) setHasFrame(true);
      }).catch(() => {
        // Browser autoplay restrictions / Low Power Mode: keep the still.
      });
    }

    function tryCrossfade(slot: Slot) {
      if (
        destroyed || transitioning || slot !== currentSlot ||
        playlist.length <= 1 || !onScreen || document.hidden
      ) return;

      const outgoing = videos[currentSlot];
      const duration = outgoing.duration;
      // A new scene is already ~1s into playback when its incoming fade ends.
      // Start its outgoing fade one second before the source reaches the end:
      // each 10s/5s clip gets one uninterrupted full playback cycle.
      const expected = playlist[currentIndex]?.film.durationSeconds ?? duration;
      const endAt = Math.min(duration, expected);
      const fadeSeconds = CROSSFADE_MS / 1000;
      if (!Number.isFinite(endAt) || endAt <= fadeSeconds + 1) return;
      const elapsed = outgoing.currentTime >= activeAt
        ? outgoing.currentTime - activeAt
        : endAt - activeAt + outgoing.currentTime;
      const dwellSeconds = endAt - activeAt - fadeSeconds;
      if (dwellSeconds <= 0 || elapsed < dwellSeconds) return;

      const nextSlot = (currentSlot === 0 ? 1 : 0) as Slot;
      const incoming = videos[nextSlot];
      // A video element may report a URL but have no usable decoded frame.
      if (incoming.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || incoming.error) return;

      transitioning = true;
      const nextIndex = (currentIndex + 1) % playlist.length;
      void incoming.play().then(() => {
        if (destroyed) return;
        // Opacity transition affects the incoming layer only; the outgoing
        // layer stays opaque underneath throughout the full crossfade.
        setIncomingSlot(nextSlot);

        fadeTimer = window.setTimeout(() => {
          if (destroyed) return;
          outgoing.pause();
          currentSlot = nextSlot;
          currentIndex = nextIndex;
          activeAt = incoming.currentTime;
          setActiveSlot(nextSlot);
          setIncomingSlot(null);
          setActiveIndex(nextIndex);
          setHasFrame(true);
          transitioning = false;

          // Reuse the old player to preload the following film.
          prepare((nextSlot === 0 ? 1 : 0) as Slot, (nextIndex + 1) % playlist.length);
          if (!onScreen || document.hidden) videos[nextSlot].pause();
        }, CROSSFADE_MS);
      }).catch(() => {
        // If the next video cannot autoplay, keep looping the outgoing film.
        transitioning = false;
      });
    }

    const onFirstTime = () => tryCrossfade(0);
    const onSecondTime = () => tryCrossfade(1);
    const onFirstPlaying = () => {
      if (!destroyed && currentSlot === 0) setHasFrame(true);
    };
    const onSecondPlaying = () => {
      if (!destroyed && currentSlot === 1) setHasFrame(true);
    };
    const onFirstError = () => {
      if (!destroyed && currentSlot === 0 && !transitioning) setHasFrame(false);
    };
    const onSecondError = () => {
      if (!destroyed && currentSlot === 1 && !transitioning) setHasFrame(false);
    };

    a.addEventListener("timeupdate", onFirstTime);
    b.addEventListener("timeupdate", onSecondTime);
    a.addEventListener("playing", onFirstPlaying);
    b.addEventListener("playing", onSecondPlaying);
    a.addEventListener("error", onFirstError);
    b.addEventListener("error", onSecondError);

    const observer = typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver(([entry]) => {
        onScreen = entry?.isIntersecting ?? true;
        resumeIfVisible();
      });
    if (section.current) observer?.observe(section.current);
    document.addEventListener("visibilitychange", resumeIfVisible);
    resumeIfVisible();

    return () => {
      destroyed = true;
      if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", resumeIfVisible);
      a.removeEventListener("timeupdate", onFirstTime);
      b.removeEventListener("timeupdate", onSecondTime);
      a.removeEventListener("playing", onFirstPlaying);
      b.removeEventListener("playing", onSecondPlaying);
      a.removeEventListener("error", onFirstError);
      b.removeEventListener("error", onSecondError);
      for (const video of videos) video.pause();
    };
  }, [first, second, section, playlist, reduceMotion]);

  return { activeSlot, incomingSlot, activeIndex, hasFrame };
}
