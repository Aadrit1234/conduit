import { motion } from "framer-motion";
import { Eye, Fingerprint, KeyRound, Lock, Timer, XCircle } from "lucide-react";
import { Reveal } from "./Reveal";
import { WordReveal } from "./WordReveal";

const caps = [
  {
    icon: KeyRound,
    title: "Zero-knowledge keys",
    body: "Room keys derive from a passphrase + random salt in the browser (PBKDF2 → X25519 → AES-256-GCM). The server stores only salt and public keys.",
    accent: "#7c5cff",
  },
  {
    icon: Fingerprint,
    title: "File access control",
    body: "Per-member capability tokens: read, write, or admin. Revocation rotates the room key so revoked peers lose the ability to decrypt new content.",
    accent: "#22d3ee",
  },
  {
    icon: Timer,
    title: "Crypto-expiring rooms",
    body: "Ephemeral rooms get a key-encryption deadline: after TTL, the server destroys the encrypted key-blob. Even a leaked database can't decrypt history.",
    accent: "#ff5c9d",
  },
];

const pipeline = [
  { label: "You", note: "plaintext", icon: Eye },
  { label: "Encrypt", note: "AES-256-GCM", icon: Lock },
  { label: "Relay", note: "opaque bytes", icon: KeyRound },
  { label: "Peer", note: "plaintext", icon: Eye },
];

export function Security() {
  return (
    <section className="section" id="security">
      <div className="container">
        <Reveal>
          <span className="section-kicker">
            <Lock size={13} /> Security & privacy
          </span>
          <WordReveal
            className="section-title"
            text="Encrypted in the browser, invisible to us"
            accent="invisible to us"
          />
          <p className="section-sub">
            Conduit is built zero-knowledge by default. Chat and file contents never exist in
            plaintext outside your device.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="pipeline glass">
            {pipeline.map((p, i) => (
              <div key={p.label} className="pipe-step-wrap">
                <motion.div
                  className="pipe-step"
                  initial={{ opacity: 0, scale: 0.8 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.25, type: "spring", stiffness: 220, damping: 18 }}
                >
                  <div className={`pipe-icon ${i === 1 || i === 2 ? "pipe-locked" : ""}`}>
                    <p.icon size={18} />
                  </div>
                  <div className="pipe-label">{p.label}</div>
                  <div className="pipe-note">{p.note}</div>
                </motion.div>
                {i < pipeline.length - 1 && (
                  <motion.div
                    className="pipe-arrow"
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.25 + 0.15, duration: 0.4 }}
                  >
                    <span />
                    <motion.i
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.3 }}
                    />
                  </motion.div>
                )}
              </div>
            ))}
          </div>
        </Reveal>

        <div className="caps">
          {caps.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.08}>
              <div className="card cap-card">
                <div className="card-icon" style={{ color: c.accent }}>
                  <c.icon size={20} />
                </div>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
                <div className="cap-tags">
                  {["X25519", "AES-256-GCM", "HKDF", "Capability tokens"].map((t) => (
                    <span key={t} className="cap-tag">{t}</span>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1}>
          <div className="threat-row">
            <XCircle size={16} />
            <span>Even with full server access, an attacker sees only ciphertext, metadata shape and public keys.</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
