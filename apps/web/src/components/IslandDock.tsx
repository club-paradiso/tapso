import { useEffect, useState } from "react";
import { type Activity } from "../story/beats.ts";
import { Island, islandLabel } from "./NativeSurfaces";

/**
 * The island demo belongs to the specific journey step that explains it,
 * not to a fixed viewport overlay that blocks navigation and other content.
 */
export function IslandDock({ activity }: { activity: Activity | null }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const form = expanded ? "expanded" : "compact";

  return (
    <div className={`dock${expanded ? " is-open" : ""}`} role="group" aria-label="다이나믹 아일랜드 시연">
      <button
        type="button"
        className="dock-button"
        aria-expanded={expanded}
        aria-label={`다이나믹 아일랜드 시연. ${islandLabel(activity, form)}. 눌러서 ${expanded ? "접기" : "펼치기"}`}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setExpanded(false);
          }
        }}
      >
        <Island activity={activity} form={form} />
      </button>
      <span className="dock-note">iPhone 미리보기 · 합성 데이터 · 눌러서 ${expanded ? "접기" : "펼쳐보기"}</span>
    </div>
  );
}
