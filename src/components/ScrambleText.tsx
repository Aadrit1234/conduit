import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!<>-_\\/[]{}—=+*^?#";

const TICK_MS = 33; // ~30fps tick
const SCRAMBLE_IN_MS = 620;
const HOLD_MS = 2100;
const SCRAMBLE_OUT_MS = 420;

/**
 * Cycling text-scramble: the phrase resolves character-by-character out of
 * random glyphs, holds, then collapses back into noise before the next phrase
 * resolves. Timer-driven (setInterval, not rAF) with wall-clock timing, so it
 * runs at the right speed even in throttled tabs where both requestAnimationFrame
 * and timer precision are degraded.
 */
export function ScrambleText({
  texts,
  className,
}: {
  texts: string[];
  className?: string;
}) {
  const reduce = useReducedMotion();
  const maxLen = Math.max(...texts.map((t) => t.length));
  const [display, setDisplay] = useState(() => texts[0] ?? "");

  useEffect(() => {
    if (reduce) {
      setDisplay(texts[0] ?? "");
      return;
    }
    let index = 0;
    let phase: "hold" | "out" | "in" = "hold";
    let elapsed = 0;
    let last = performance.now();

    const scramble = (target: string, resolve: number) => {
      const len = target.length;
      const resolved = Math.floor(resolve * len);
      let out = "";
      for (let i = 0; i < maxLen; i++) {
        if (i < len && i < resolved) out += target[i];
        else if (i < len) out += CHARS[Math.floor(Math.random() * CHARS.length)];
        else out += " ";
      }
      return out;
    };

    const iv = setInterval(() => {
      const now = performance.now();
      elapsed += Math.min(now - last, 500); // cap jumps so a long pause doesn't skip the whole cycle
      last = now;
      const target = texts[index];

      if (phase === "in") {
        setDisplay(scramble(target, Math.min(elapsed / SCRAMBLE_IN_MS, 1)));
        if (elapsed >= SCRAMBLE_IN_MS) {
          setDisplay(target.padEnd(maxLen, " "));
          phase = "hold";
          elapsed = 0;
        }
      } else if (phase === "hold") {
        if (elapsed >= HOLD_MS) {
          phase = "out";
          elapsed = 0;
        }
      } else {
        setDisplay(scramble(target, Math.max(1 - elapsed / SCRAMBLE_OUT_MS, 0)));
        if (elapsed >= SCRAMBLE_OUT_MS) {
          index = (index + 1) % texts.length;
          phase = "in";
          elapsed = 0;
        }
      }
    }, TICK_MS);

    return () => clearInterval(iv);
    // `texts` must be referentially stable (module-level or memoized) so
    // parent re-renders don't restart the cycle.
  }, [texts, reduce, maxLen]);

  return <span className={className}>{display}</span>;
}
