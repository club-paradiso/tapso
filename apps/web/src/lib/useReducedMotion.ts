import { useEffect, useState } from "react";

const KEY = "tapso:reduce-motion";
const EVENT = "tapso:motion-preference";

/** User-controlled preference in addition to OS-level reduced motion. */
export function setSiteReducedMotion(reduce: boolean): void {
  try {
    window.localStorage.setItem(KEY, reduce ? "1" : "0");
  } catch {
    // Private browsing can prohibit storage. The current tab still works.
  }
  document.documentElement.dataset.motion = reduce ? "reduce" : "normal";
  window.dispatchEvent(new Event(EVENT));
}

function savedPreference(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return document.documentElement.dataset.motion === "reduce";
  }
}

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const query = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : undefined;
    const sync = () => setReduce(Boolean(query?.matches) || savedPreference());
    sync();
    query?.addEventListener("change", sync);
    window.addEventListener(EVENT, sync);
    return () => {
      query?.removeEventListener("change", sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);
  return reduce;
}

/** For the site's own toggle, distinct from the OS setting. */
export function getSiteReducedMotion(): boolean {
  return typeof window !== "undefined" && savedPreference();
}
