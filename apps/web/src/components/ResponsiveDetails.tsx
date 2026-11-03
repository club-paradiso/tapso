import { useEffect, useState, type ReactNode } from "react";

/** Native disclosure stays closed until requested, on every screen size. */
export function ResponsiveDetails({ summary, children, className = "", id }: {
  summary: string; children: ReactNode; className?: string; id?: string;
}) {
  return <details id={id} className={`responsive-details ${className}`}>
    <summary>{summary}<span className="disclosure-mark" aria-hidden="true" /></summary>
    <div className="disclosure-content">{children}</div>
  </details>;
}

/**
 * The page is one document split into views: the home view (hero, support,
 * FAQ) and one view per top tab. Every view is in the prerendered HTML; only
 * the active one is shown. A view is chosen by the anchor a link points at,
 * so `#trust` opens the ride guide and `#faq` the home view.
 */
export const VIEWS = ["home", "how", "privacy", "status"] as const;
export type View = (typeof VIEWS)[number];

function isView(value: string | undefined): value is View {
  return (VIEWS as readonly string[]).includes(value ?? "");
}

/** Reveal the real anchor target without replacing native browser history. */
export function revealAnchor(hash: string): HTMLElement | null {
  let id: string;
  try { id = decodeURIComponent(hash.slice(1)); } catch { return null; }
  const target = document.getElementById(id);
  if (!target) return null;
  let ancestor = target.parentElement;
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  return target;
}

function viewOf(target: HTMLElement | null): View {
  const panel = target?.closest<HTMLElement>("[data-view]")?.dataset.view;
  return isView(panel) ? panel : "home";
}

/** Follows in-page links into the right view and scrolls once it is shown. */
export function useDisclosureAnchors(): View {
  const [view, setView] = useState<View>("home");
  useEffect(() => {
    let frame = 0;
    // A clicked link also fires hashchange; that echo must not undo the click's focus move.
    let clickedHash = "";
    const follow = (hash: string, focus: boolean) => {
      const target = hash.length > 1 ? revealAnchor(hash) : null;
      setView(viewOf(target));
      cancelAnimationFrame(frame);
      // Two frames: the first lets React show the view, the second can measure it.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          // A view's own opener (and the hero) starts the view from the top.
          const opensView = !target || target.matches("[data-view] > :first-child");
          if (opensView) window.scrollTo({ top: 0 });
          else target.scrollIntoView({ block: "start" });
          if (focus && target) {
            const heading = opensView ? target.querySelector<HTMLElement>("h1, h2") ?? target : target;
            if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
            heading.focus({ preventScroll: true });
          }
        });
      });
    };
    const changed = () => {
      const echo = window.location.hash === clickedHash;
      clickedHash = "";
      if (!echo) follow(window.location.hash, false);
    };
    const clicked = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
      if (link && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
        if (link.hash !== window.location.hash) clickedHash = link.hash;
        follow(link.hash, true);
      }
    };
    changed();
    document.addEventListener("click", clicked);
    window.addEventListener("hashchange", changed);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("click", clicked); window.removeEventListener("hashchange", changed); };
  }, []);
  return view;
}

/** One view of the page. Hidden views stay in the HTML; without JavaScript every view shows (see index.html). */
export function ViewPanel({ view, active, label, children }: {
  view: View; active: View; label: string; children: ReactNode;
}) {
  return <div className="view-panel" data-view={view} role="region" aria-label={label} hidden={view !== active}>{children}</div>;
}
