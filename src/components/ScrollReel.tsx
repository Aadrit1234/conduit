import { lazy, Suspense, useEffect, useRef } from "react";
import { FolderUp, MessagesSquare, ShieldCheck } from "lucide-react";

const ScrollScene = lazy(() => import("../three/ScrollScene"));

const panels = [
  {
    icon: FolderUp,
    kicker: "Share",
    title: "Any size. Any folder.",
    body: "Chunks stream peer-to-peer over the WebRTC mesh — no upload cap, SHA-256 verified on arrival.",
    accent: "#22d3ee",
  },
  {
    icon: MessagesSquare,
    kicker: "Real time",
    title: "Move as one.",
    body: "Chat, presence and live data ride the same WebSocket. Everyone sees the same timeline.",
    accent: "#7c5cff",
  },
  {
    icon: ShieldCheck,
    kicker: "Private",
    title: "Invisible to us.",
    body: "AES-256-GCM in the browser, X25519 keys per member. The server only ever stores ciphertext.",
    accent: "#ff5c9d",
  },
];

const FADE = 0.06; // fraction of the section over which a panel fades in/out

/**
 * Scroll-driven 3D reel: a sticky full-viewport three.js stage sits behind
 * three text panels, each fading in as the user scrolls through its third of
 * the section. Everything is written synchronously on the scroll event (no
 * rAF), so it tracks even in throttled/backgrounded tabs.
 */
export function ScrollReel() {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const progressObj = useRef({ v: 0 });
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const n = panels.length;

  useEffect(() => {
    const onScroll = () => {
      const sec = sectionRef.current;
      if (!sec) return;
      const rect = sec.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const p = total > 0 ? Math.min(Math.max(-rect.top / total, 0), 1) : 0;
      progressObj.current.v = p;

      if (canvasRef.current) {
        const scale = 0.92 + p * 0.2;
        canvasRef.current.style.transform = `scale(${scale})`;
      }

      for (let i = 0; i < n; i++) {
        const el = panelRefs.current[i];
        if (el) {
          const start = i / n;
          const end = (i + 1) / n;
          let o = 0.12;
          if (p >= start && p <= end) {
            const rise = Math.min((p - start) / FADE, 1);
            const fall = Math.min((end - p) / FADE, 1);
            o = 0.12 + 0.88 * Math.min(rise, fall);
          }
          el.style.opacity = String(o);
          const span = 1 / n;
          const t = Math.min(Math.max((p - start) / span, 0), 1);
          el.style.transform = `translateY(${(1 - t) * 46 - t * 46}px)`;
        }
        const dot = dotRefs.current[i];
        if (dot) {
          const start = i / n;
          const end = (i + 1) / n;
          dot.style.transform = `scaleY(${Math.min(Math.max((p - start) / (end - start), 0), 1)})`;
        }
      }
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [n]);

  return (
    <section className="scroll-reel" ref={sectionRef} id="reel">
      <div className="scroll-reel-stage">
        <div className="scroll-reel-canvas" ref={canvasRef}>
          <Suspense fallback={null}>
            <ScrollScene progress={progressObj.current} />
          </Suspense>
        </div>
        <div className="scroll-reel-progress" aria-hidden="true">
          {panels.map((_, i) => (
            <div key={i} className="sr-dot">
              <span
                ref={(el) => {
                  dotRefs.current[i] = el;
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {panels.map((p, i) => (
        <div key={p.kicker} className="scroll-reel-panel">
          <div
            className="scroll-reel-panel-inner glass"
            ref={(el) => {
              panelRefs.current[i] = el;
            }}
          >
            <span className="section-kicker" style={{ color: p.accent }}>
              <p.icon size={13} /> {p.kicker}
            </span>
            <h2 className="scroll-reel-title">{p.title}</h2>
            <p className="scroll-reel-body">{p.body}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
