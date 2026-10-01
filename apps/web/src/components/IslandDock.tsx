import { useEffect, useRef, useState } from "react";
import type { RideMoment } from "../demo/rideMoments.ts";
import { BEATS, milestoneToSignal, resolveBeat, type Activity } from "../story/beats.ts";
import { useStory } from "../story/storyStore.ts";
import { useReducedMotion } from "../lib/useReducedMotion";
import { Island, islandLabel } from "./NativeSurfaces";

/** How long a milestone keeps the island open, like an alert on the phone. */
const SIGNAL_MS = 2600;

function useActivity(): Activity | null {
  const position = useStory((s) => s.position);
  const variants = useStory((s) => s.variants);
  const found = BEATS.find((b) => b.id === position);
  return found ? resolveBeat(found, variants[found.id]).activity : null;
}

/** Whether the persistent island is on screen: a Live Activity runs and the hero is out of view. */
export function useIslandShowing(): boolean {
  const activity = useActivity();
  const heroInView = useStory((s) => s.heroInView);
  return activity !== null && !heroInView;
}

/**
 * The page's persistent island: TAPSO's Live Activity for wherever the visitor
 * is in the story. It appears when the rider confirms the bus and leaves when
 * the ride ends, sits in the header on wide screens and above the browser's
 * own toolbar on phones, opens on hover, focus or tap the way a long press
 * opens it on iPhone, and opens by itself once per milestone.
 *
 * It is a picture of the iPhone feature, labelled as one; browsers have no
 * Dynamic Island.
 */
export function IslandDock() {
  const activity = useActivity();
  const heroInView = useStory((s) => s.heroInView);
  const reduceMotion = useReducedMotion();
  const visible = activity !== null && !heroInView;

  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [signal, setSignal] = useState<RideMoment | null>(null);
  const [signalOpens, setSignalOpens] = useState(false);
  const signalled = useRef(new Set<RideMoment>());

  // One alert per milestone per visit, mirroring `alertedMilestones`. On a
  // wide screen the island opens the way an alert opens it on the phone; on a
  // narrow one, where it would cover the page, it only glows.
  useEffect(() => {
    const moment = milestoneToSignal(activity, signalled.current);
    if (!moment || !visible) return;
    signalled.current.add(moment);
    if (reduceMotion) return;
    setSignal(moment);
    setSignalOpens(window.matchMedia?.("(min-width: 900px)")?.matches ?? false);
    const timer = window.setTimeout(() => setSignal(null), SIGNAL_MS);
    return () => window.clearTimeout(timer);
  }, [activity, visible, reduceMotion]);

  useEffect(() => {
    if (!visible) {
      setPinned(false);
      setHovered(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!pinned) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinned]);

  const open = visible && (pinned || hovered || focused || (signal !== null && signalOpens));
  const form = open ? "expanded" : "compact";

  return (
    <div className={`dock${visible ? " is-visible" : ""}${open ? " is-open" : ""}`} aria-hidden={!visible} inert={!visible}>
      <button
        type="button"
        className="dock-button"
        aria-expanded={open}
        aria-label={`탑서 실시간 현황, iPhone 미리보기. ${islandLabel(activity, form)}`}
        onClick={() => setPinned((p) => !p)}
        onKeyDown={(event) => {
          // Escape closes the island and leaves focus where it is.
          if (event.key !== "Escape") return;
          setPinned(false);
          setFocused(false);
          setHovered(false);
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setHovered(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setHovered(false);
        }}
        onFocus={(event) => setFocused(event.currentTarget.matches(":focus-visible"))}
        onBlur={() => {
          setFocused(false);
          setPinned(false);
        }}
      >
        <Island activity={activity} form={form} signalling={signal !== null} />
      </button>
      <span className="dock-note" aria-hidden="true">
        iPhone 미리보기 · 합성 데이터
      </span>
    </div>
  );
}
