import { useEffect, useRef, useState } from "react";

/**
 * Word-by-word headline reveal: the title's words start blurred and faded,
 * and sharpen/settle in sequence when the heading scrolls into view.
 *
 * Driven by a passive scroll listener + rect check (not IntersectionObserver),
 * so it fires reliably even in throttled or backgrounded tabs — the same
 * deterministic pattern as the navbar progress bar and scroll reel. Words are
 * plain inline-blocks with a per-word transition-delay, so the animation runs
 * on the compositor once triggered.
 */
type WordRevealProps = {
  text: string;
  /** Words (whitespace-separated) that should render with the gradient accent. */
  accent?: string;
  className?: string;
  staggerMs?: number;
};

const strip = (w: string) => w.replace(/[^\w'-]/g, "");

export function WordReveal({
  text,
  accent = "",
  className = "",
  staggerMs = 45,
}: WordRevealProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let done = false;
    const cleanup = () => {
      window.removeEventListener("scroll", reveal);
      window.removeEventListener("resize", reveal);
    };
    const reveal = () => {
      if (done) return;
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.88 && r.bottom > 0) {
        done = true;
        setInView(true);
        cleanup();
      }
    };

    // Wait a beat so the hidden ("armed") state paints before the first
    // position check — otherwise above-the-fold titles would just appear
    // without ever transitioning.
    const t = setTimeout(reveal, 80);
    window.addEventListener("scroll", reveal, { passive: true });
    window.addEventListener("resize", reveal);
    return () => {
      clearTimeout(t);
      cleanup();
    };
  }, []);

  const tokens = text.split(/(\s+)/);
  const accentWords = new Set(accent.split(/\s+/).map(strip).filter(Boolean));
  let n = 0;

  return (
    <h2 ref={ref} className={`${className} wr-armed${inView ? " wr-in" : ""}`}>
      {tokens.map((t, i) => {
        if (/^\s+$/.test(t)) return t;
        const clean = strip(t);
        const idx = n++;
        const word =
          clean && accentWords.has(clean) ? (
            <span className="grad-text">{t}</span>
          ) : (
            t
          );
        return (
          <span
            key={i}
            className="wr-word"
            style={{ transitionDelay: `${idx * staggerMs}ms` }}
          >
            {word}
          </span>
        );
      })}
    </h2>
  );
}
