import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound } from "lucide-react";
import { Magnetic } from "./Magnetic";
import { Reveal } from "./Reveal";

export function CTA() {
  const navigate = useNavigate();
  return (
    <section className="section cta-section">
      <div className="container">
        <Reveal>
          <div className="cta-box animated-border">
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
