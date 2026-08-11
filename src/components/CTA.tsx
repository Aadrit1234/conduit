import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound } from "lucide-react";
import { Magnetic } from "./Magnetic";
import { Reveal } from "./Reveal";

export function CTA() {
  const navigate = useNavigate();
  const twinkles = [
    { top: "12%", left: "8%", size: 5, delay: 0 },
    { top: "24%", right: "14%", size: 4, delay: 0.8 },
    { bottom: "18%", left: "18%", size: 3, delay: 1.6 },
    { bottom: "28%", right: "8%", size: 6, delay: 0.4 },
    { top: "8%", left: "42%", size: 4, delay: 2.1 },
    { bottom: "10%", left: "55%", size: 3, delay: 1.1 },
  ];
  const shapes = [
    { top: "-34px", left: "10%", rotate: 12, color: "#7c5cff" },
    { bottom: "-28px", right: "12%", rotate: -8, color: "#22d3ee" },
    { top: "18%", right: "-22px", rotate: 45, color: "#ff5c9d" },
    { bottom: "14%", left: "-26px", rotate: 0, color: "#22d3ee" },
  ];

  return (
    <section className="section cta-section">
      <div className="container">
        <Reveal>
          <div className="cta-box animated-border">
            <div className="cta-stars" aria-hidden="true">
              {twinkles.map((s, i) => (
                <motion.span
                  key={i}
                  className="cta-star"
                  style={{ top: s.top, left: s.left, right: s.right, bottom: s.bottom, width: s.size, height: s.size }}
                  animate={{ opacity: [0.15, 1, 0.15], scale: [0.7, 1.25, 0.7] }}
                  transition={{ duration: 2.6, repeat: Infinity, delay: s.delay, ease: "easeInOut" }}
                />
              ))}
            </div>
            <div className="cta-shapes" aria-hidden="true">
              {shapes.map((sh, i) => (
                <motion.div
                  key={i}
                  className="cta-shape"
                  style={{ top: sh.top, left: sh.left, right: sh.right, bottom: sh.bottom, backgroundColor: sh.color }}
                  animate={{ rotate: sh.rotate + 360, y: [0, -14, 0] }}
                  transition={{ rotate: { duration: 22, repeat: Infinity, ease: "linear" }, y: { duration: 6 + i, repeat: Infinity, ease: "easeInOut" } }}
                />
              ))}
            </div>
            <div className="cta-inner">
              <motion.div
                className="cta-orbit"
                animate={{ rotate: 360 }}
                transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
              >
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span key={i} style={{ transform: `rotate(${i * 60}deg) translateY(-64px)` }} />
                ))}
              </motion.div>
              <span className="badge">
                <KeyRound size={13} /> No signup · Free during beta
              </span>
              <h2 className="cta-title">
                Your next room is <span className="grad-text">one click away</span>
              </h2>
              <p className="cta-sub">
                Create a room, share the code, drop in your files. Everything else is real time.
              </p>
              <Magnetic>
                <button className="btn btn-primary cta-btn" onClick={() => navigate("/room")}>
                  Create a room <ArrowRight size={18} />
                </button>
              </Magnetic>
              <div className="cta-hint">
                <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }}>
                  Works in any modern browser
                </motion.span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
