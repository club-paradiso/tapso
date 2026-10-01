import { useEffect, useSyncExternalStore, type RefObject } from "react";
import type { BeatId } from "./beats.ts";

/**
 * Where the visitor is in the story. Scrolling only *reads* the page: the
 * store follows which step crosses the middle of the viewport and never moves
 * the page itself. Everything that mirrors the ride (sticky phone, persistent
 * island) subscribes here, so they cannot disagree.
 */

export type Position = BeatId | "before" | "after";

export type StoryState = {
  position: Position;
  /** The visitor's pick inside beats that offer variants. */
  variants: Readonly<Partial<Record<BeatId, string>>>;
  /** True while the hero (which has its own devices) is on screen. */
  heroInView: boolean;
};

const INITIAL: StoryState = { position: "before", variants: {}, heroInView: true };

let state: StoryState = INITIAL;
const listeners = new Set<() => void>();

function set(next: StoryState): void {
  state = next;
  for (const listener of listeners) listener();
}

export const storyStore = {
  get: (): StoryState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setPosition(position: Position): void {
    if (state.position !== position) set({ ...state, position });
  },
  setVariant(beatId: BeatId, variantId: string): void {
    if (state.variants[beatId] !== variantId) set({ ...state, variants: { ...state.variants, [beatId]: variantId } });
  },
  setHeroInView(heroInView: boolean): void {
    if (state.heroInView !== heroInView) set({ ...state, heroInView });
  },
  /** Tests only. */
  reset(): void {
    set(INITIAL);
  },
};

/** Subscribe to one slice. Selectors must return primitives or stored references. */
export function useStory<T>(selector: (s: StoryState) => T): T {
  return useSyncExternalStore(
    storyStore.subscribe,
    () => selector(storyStore.get()),
    () => selector(INITIAL),
  );
}

/**
 * Follows the step being read: the last step whose top has passed the reading
 * line, a little below the middle of the viewport. Computed from layout on
 * each animation frame after a scroll or resize, so a jump (an anchor link, a
 * restored scroll position) lands on the right step too. Above the journey the
 * position is "before"; once its end has passed the line, "after".
 */
export function useStoryTracking(journeyRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const journey = journeyRef.current;
    if (!journey) return;
    let frame = 0;

    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.56;
      const bounds = journey.getBoundingClientRect();
      if (bounds.bottom < line) {
        storyStore.setPosition("after");
        return;
      }
      let current: Position = "before";
      journey.querySelectorAll<HTMLElement>("[data-beat]").forEach((step) => {
        if (step.getBoundingClientRect().top <= line) current = (step.dataset.beat as BeatId | undefined) ?? current;
      });
      storyStore.setPosition(current);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [journeyRef]);
}

/** Reports whether the hero is on screen, so the persistent island stays out of its way. */
export function useHeroTracking(heroRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => storyStore.setHeroInView(entry?.isIntersecting ?? false),
      { rootMargin: "-64px 0px 0px 0px", threshold: 0.12 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, [heroRef]);
}
