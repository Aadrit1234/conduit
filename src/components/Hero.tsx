import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FolderUp, KeyRound, Lock, MessageSquare, Play, Users, Zap } from "lucide-react";
import { Magnetic } from "./Magnetic";
import { ScrambleText } from "./ScrambleText";

const HeroScene = lazy(() => import("../three/HeroScene"));

const stats = [
  { value: 42, suffix: "ms", label: "median latency" },
  { value: 120, suffix: "MB", label: "P2P chunk size" },
  { value: 99.9, suffix: "%", label: "uptime", decimals: 1 },
  { value: 0, suffix: "KB", label: "chat stored server-side" },
];

// Module-level so the scramble's effect deps stay referentially stable.
const taglines = ["Move as one.", "Share anything.", "Stay private.", "Go live now.", "Zero setup."];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.2 } },
};

const item = {
  hidden: { opacity: 0, y: 34, filter: "blur(8px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] as const } },
};

function Counter({ value, suffix, decimals = 0 }: { value: number; suffix: string; decimals?: number }) {
  const [n, setN] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const dur = 1400;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min((t - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span>
      {n.toFixed(decimals)}
      <span className="stat-suffix">{suffix}</span>
    </span>
  );
}

export function Hero() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const sectionRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  // scroll-driven parallax: copy drifts up & fades, the 3D scene sinks & scales
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start start", "end start"] });
  const copyY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -110]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.65], [1, 0]);
  const visualY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 130]);
  const visualScale = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 0.84]);

  function onMove(e: MouseEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - rect.top}px`);
  }

  function join() {
    const trimmed = code.trim().toUpperCase();
    navigate(trimmed ? `/room/${trimmed}` : "/room");
  }

  return (
    <section className="hero" id="top" ref={sectionRef} onMouseMove={onMove}>
      <div className="hero-spotlight" aria-hidden="true" />
      <div className="container hero-inner">
        <motion.div className="hero-copy" variants={container} initial="hidden" animate="show" style={{ y: copyY, opacity: copyOpacity }}>
          <motion.div variants={item}>
            <span className="badge">
              <span className="pulse-dot" />
              Real-time rooms · end-to-end encrypted
            </span>
          </motion.div>

          <motion.h1 className="hero-title" variants={item}>
            Share files.
            <br />
            <ScrambleText texts={taglines} className="grad-text" />
          </motion.h1>

          <motion.p className="hero-sub" variants={item}>
            Conduit spins up a room in one click — drop files, folders and live data in,
            and chat beside them in real time. No signup, no setup, nothing to install.
          </motion.p>

          <motion.div className="hero-cta" variants={item}>
            <Magnetic>
              <button className="btn btn-primary" onClick={() => navigate("/room")}>
                Create a room <ArrowRight size={18} />
              </button>
            </Magnetic>
            <div className="join-box glass">
              <KeyRound size={16} />
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && join()}
                placeholder="Enter room code"
                aria-label="Enter room code"
                spellCheck={false}
                maxLength={8}
              />
              <button className="join-go" onClick={join} aria-label="Join room">
                <Play size={14} fill="currentColor" />
              </button>
            </div>
          </motion.div>

          <motion.div className="hero-stats" variants={item}>
            {stats.map((s) => (
              <div key={s.label} className="stat">
                <div className="stat-value">
                  <Counter value={s.value} suffix={s.suffix} decimals={s.decimals ?? 0} />
                </div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </motion.div>
        </motion.div>

        <motion.div className="hero-visual" style={{ y: visualY, scale: visualScale }}>
          <Suspense fallback={<div className="hero-visual-fallback"><motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.6, repeat: Infinity }}>rendering 3D room…</motion.div></div>}>
            <HeroScene />
          </Suspense>
          <motion.div
            className="float-card glass float-slow"
            style={{ top: "16%", left: "-4%" }}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="fc-icon cyan"><MessageSquare size={15} /></div>
            <div>
              <div className="fc-title">Maya sent a message</div>
              <div className="fc-sub">design-spec-v3.pdf · 2.4 MB</div>
            </div>
          </motion.div>

          <motion.div
            className="float-card glass float-slower"
            style={{ bottom: "18%", right: "-2%" }}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.25, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="fc-icon violet"><FolderUp size={15} /></div>
            <div className="fc-progress">
              <div className="fc-title">Uploading assets/</div>
              <div className="progress-track">
                <motion.div
                  className="progress-fill"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ delay: 1.5, duration: 2.4, ease: "easeInOut" }}
                />
              </div>
              <div className="fc-sub">3 of 12 files · encrypted</div>
            </div>
          </motion.div>

          <motion.div
            className="float-card glass float-slower"
            style={{ bottom: "8%", left: "6%" }}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.5, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="fc-icon green"><Lock size={15} /></div>
            <div>
              <div className="fc-title">E2E encrypted</div>
              <div className="fc-sub"><Zap size={11} /> X25519 + AES-256-GCM</div>
            </div>
          </motion.div>

          <motion.div
            className="float-card glass float-slow"
            style={{ top: "10%", right: "6%" }}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.1, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="avatars">
              {["#7c5cff", "#22d3ee", "#ff5c9d", "#4ade80"].map((c, i) => (
                <span key={c} className="avatar" style={{ background: c, zIndex: 4 - i }} />
              ))}
              <span className="avatar-count">+3</span>
            </div>
            <div>
              <div className="fc-title">4 online now</div>
              <div className="fc-sub"><Users size={11} /> room · KX-7F2A</div>
            </div>
          </motion.div>
        </motion.div>
      </div>

      <div className="hero-scroll">
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="scroll-line" />
        </motion.div>
      </div>
    </section>
  );
}
