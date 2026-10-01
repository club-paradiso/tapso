import { useEffect, useState } from "react";

/**
 * The visitor's reduced-motion preference. `false` on the prerendered page and
 * until the effect runs, so nothing that waits on it moves before it is known:
 * every automatic motion on the page starts only after a delay.
 */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : undefined;
    if (!query) return;
    setReduce(query.matches);
    const onChange = () => setReduce(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduce;
}
