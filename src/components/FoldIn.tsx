import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * 3D "fold-in" reveal: the card starts folded flat against its top (or bottom)
 * crease and unfolds into place when it scrolls into view. Driven by an
 * IntersectionObserver + a CSS transition on transform, so it runs on the
 * compositor — it plays even in throttled/backgrounded tabs where
 * requestAnimationFrame-driven animations stall.
 */
export function FoldIn({
  children,
  delay = 0,
  className,
  from = "top",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  from?: "top" | "bottom";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [inView, setInView] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Fail open: only arm the folded state when an observer is actually
    // available, so content is never left invisible if IO is missing or
    // throttled (e.g. some embedded/backgrounded contexts).
    if (typeof IntersectionObserver === "undefined") return;
    setArmed(true);
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
          }
        }
      },
      { rootMargin: "-60px", threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const cls = [
    "fold-in",
    armed ? "fold-in-armed" : "",
    armed && inView ? "fold-in-open" : "",
    from === "bottom" ? "fold-in-bottom" : "",
    reduce ? "fold-in-reduce" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={ref}
      className={cls}
      style={{ "--fold-delay": `${delay}s` } as CSSProperties}
    >
      {children}
    </div>
  );
}
