import { useEffect, useState } from "react";

/**
 * Follow the visitor's OS accessibility preference without exposing an
 * independent on-page motion toggle. Legacy tapso:reduce-motion localStorage
 * entries are intentionally ignored so an old website preference cannot
 * silently prevent autoplay after the control has been removed.
 */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return reduce;
}
