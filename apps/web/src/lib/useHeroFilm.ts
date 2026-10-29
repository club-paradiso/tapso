import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { HERO_FILM } from "../content/media.ts";

/**
 * - `waiting`: nothing decided yet (also the prerendered page): the still shows.
 * - `still`: the visitor asked for less motion or less data, or the network is
 *   2G; the still stays and the film loads only if they press play.
 * - `playing` / `paused`: the film is loaded.
 * - `failed`: the film could not load; the still stays for good.
 */
export type FilmState = "waiting" | "still" | "playing" | "paused" | "failed";

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

/** Whether to hold the film back before the visitor asks for it. */
function prefersStill(reduceMotion: boolean): boolean {
  if (reduceMotion) return true;
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (connection?.saveData) return true;
  return connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g";
}

function onSlowNetwork(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return connection?.effectiveType === "3g";
}

/** The smallest file that fills this screen: the portrait cut on tall screens, 720p on a slow network. */
function chooseSource(): string {
  const tall = window.matchMedia?.("(max-aspect-ratio: 4/5)")?.matches ?? false;
  if (tall) return HERO_FILM.files.portrait;
  const pixels = window.innerWidth * Math.min(window.devicePixelRatio || 1, 2);
  return pixels > 1500 && !onSlowNetwork() ? HERO_FILM.files.wide : HERO_FILM.files.medium;
}

/**
 * The hero film: muted, looping, inline. It loads after hydration (never on a
 * reduced-motion, data-saver or 2G connection unless asked), plays only
 * while its section is on screen and the tab is visible, remembers a pause the
 * visitor chose, and falls back to the still on any error.
 */
export function useHeroFilm(
  video: RefObject<HTMLVideoElement | null>,
  section: RefObject<HTMLElement | null>,
  reduceMotion: boolean,
  enabled = true,
): { state: FilmState; hasFrame: boolean; toggle: () => void } {
  const [state, setState] = useState<FilmState>("waiting");
  // Until a frame is decoded the <video> would paint black over the still.
  const [hasFrame, setHasFrame] = useState(false);
  const userPaused = useRef(false);
  const onScreen = useRef(true);

  const load = useCallback(() => {
    const element = video.current;
    if (!element || element.getAttribute("src")) return element;
    element.src = chooseSource();
    element.load();
    return element;
  }, [video]);

  const play = useCallback(() => {
    const element = load();
    if (!element) return;
    void element.play().catch(() => {
      // Autoplay refused (Low Power Mode, a policy): keep the still, offer the button.
      if (element.error) setState("failed");
      else setState("paused");
    });
  }, [load]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const onPlay = () => setState("playing");
    const onPause = () => setState((s) => (s === "failed" ? s : "paused"));
    const onError = () => setState("failed");
    const onFrame = () => setHasFrame(true);
    element.addEventListener("loadeddata", onFrame);
    element.addEventListener("playing", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("error", onError);
    return () => {
      element.removeEventListener("loadeddata", onFrame);
      element.removeEventListener("playing", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("error", onError);
    };
  }, [video]);

  // Decide once the reduced-motion preference is known (it starts `false`).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!enabled) {
        video.current?.pause();
        return;
      }
      if (prefersStill(reduceMotion)) {
        video.current?.pause();
        setState((s) => (s === "failed" ? s : s === "waiting" ? "still" : s === "playing" ? "paused" : s));
        return;
      }
      if (!userPaused.current && onScreen.current) play();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [reduceMotion, play, video, enabled]);

  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const resumeIfAllowed = () => {
      const film = video.current;
      if (!film) return;
      if (!enabled) { film.pause(); return; }
      if (!film.getAttribute("src") || userPaused.current || film.error) return;
      if (onScreen.current && !document.hidden) void film.play().catch(() => undefined);
      else film.pause();
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(([entry]) => {
            onScreen.current = entry?.isIntersecting ?? true;
            resumeIfAllowed();
          });
    observer?.observe(element);
    document.addEventListener("visibilitychange", resumeIfAllowed);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", resumeIfAllowed);
    };
  }, [section, video, enabled]);

  const toggle = useCallback(() => {
    const element = video.current;
    if (!element || !enabled) return;
    if (state === "playing") {
      userPaused.current = true;
      element.pause();
    } else {
      userPaused.current = false;
      play();
    }
  }, [state, play, video, enabled]);

  return { state, hasFrame, toggle };
}
