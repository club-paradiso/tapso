import { useEffect, useState } from "react";
import { BEATS, resolveBeat, type Activity } from "../story/beats.ts";
import { useStory } from "../story/storyStore.ts";
import { Island, islandLabel } from "./NativeSurfaces";

function useActivity(): Activity | null {
  const position = useStory((s) => s.position);
  const variants = useStory((s) => s.variants);
  const found = BEATS.find((beat) => beat.id === position);
  return found ? resolveBeat(found, variants[found.id]).activity : null;
}

export function useIslandShowing(): boolean {
  const activity = useActivity();
  const heroInView = useStory((s) => s.heroInView);
  return activity !== null && !heroInView;
}

/** V4: a compact preview that expands only on deliberate user activation. */
export function IslandDock() {
  const activity = useActivity();
  const heroInView = useStory((s) => s.heroInView);
  const visible = activity !== null && !heroInView;
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!visible) setPinned(false);
  }, [visible]);

  useEffect(() => {
    if (!pinned) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinned]);

  const open = visible && pinned;
  const form = open ? "expanded" : "compact";

  return (
    <div className={`dock${visible ? " is-visible" : ""}${open ? " is-open" : ""}`} aria-hidden={!visible} inert={!visible}>
      <button
        type="button"
        className="dock-button"
        aria-expanded={open}
        aria-label={`탑서 실시간 현황 미리보기. ${islandLabel(activity, form)}. 눌러서 ${open ? "접기" : "펼치기"}`}
        onClick={() => setPinned((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setPinned(false);
          }
        }}
      >
        <Island activity={activity} form={form} />
      </button>
      <span className="dock-note" aria-hidden="true">iPhone 미리보기 · 합성 데이터</span>
    </div>
  );
}
