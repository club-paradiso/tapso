import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Whether an element is on screen. Starts `false` (also on the prerendered
 * page) and never throws where `IntersectionObserver` is missing: it then
 * reports `true`, which only means "do the work", never "hide the content".
 */
export function useInView<T extends Element>(
  rootMargin = "0px",
  once = false,
): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry?.isIntersecting ?? false;
        setInView(visible);
        if (visible && once) observer.disconnect();
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, once]);

  return [ref, inView];
}
