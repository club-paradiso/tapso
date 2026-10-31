import { useEffect, useRef, type ReactNode } from "react";

/** Native disclosure: closed on phones, expanded on desktop, usable without JS. */
export function ResponsiveDetails({ summary, children, className = "", id }: {
  summary: string; children: ReactNode; className?: string; id?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const sync = () => {
      const details = ref.current;
      if (!details) return;
      // Never strand keyboard focus in content collapsed by a breakpoint change.
      if (!media.matches && details.contains(document.activeElement)) details.querySelector("summary")?.focus();
      details.classList.toggle("is-wide", media.matches);
      details.open = media.matches;
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return <details ref={ref} id={id} className={`responsive-details ${className}`}>
    <summary>{summary}<span className="disclosure-mark" aria-hidden="true" /></summary>
    <div className="disclosure-content">{children}</div>
  </details>;
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

export function useDisclosureAnchors() {
  useEffect(() => {
    let frame = 0;
    const follow = (hash: string) => {
      const target = revealAnchor(hash);
      if (target) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
      }
    };
    const changed = () => follow(window.location.hash);
    const clicked = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
      if (link && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) follow(link.hash);
    };
    changed();
    document.addEventListener("click", clicked);
    window.addEventListener("hashchange", changed);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("click", clicked); window.removeEventListener("hashchange", changed); };
  }, []);
}
