import { motion } from "framer-motion";
import { Cable, FolderTree, HardDriveDownload, MessageSquare, Radio, ShieldCheck, Timer } from "lucide-react";
import { Reveal } from "./Reveal";
import { Tilt } from "./Tilt";
import { WordReveal } from "./WordReveal";

const grid = [
  {
    icon: MessageSquare,
    title: "Chat that never lags",
    body: "Messages stream over a WebSocket fan-out with presence, typing indicators and read receipts — median latency under 50 ms.",
    className: "bento-wide",
    accent: "#22d3ee",
  },
  {
    icon: FolderTree,
    title: "Files & folders",
    body: "Drop an entire folder. Structure, metadata and previews stay synced for every member.",
    accent: "#7c5cff",
  },
  {
    icon: HardDriveDownload,
    title: "P2P transfer",
    body: "Chunks fly peer-to-peer over WebRTC datachannels, falling back to an edge relay.",
    accent: "#ff5c9d",
  },
  {
    icon: Radio,
    title: "Live data",
    body: "Broadcast structured data — cursors, diagrams, dashboards — with CRDT-style conflict handling.",
    className: "bento-wide",
    accent: "#4ade80",
  },
  {
    icon: ShieldCheck,
    title: "Encrypted by default",
    body: "Keys are derived in-browser. The server never sees plaintext chat or file contents.",
    accent: "#22d3ee",
  },
  {
    icon: Timer,
    title: "Ephemeral or permanent",
    body: "Burn rooms after the session or pin them for your team. Expiry is enforced cryptographically.",
    accent: "#7c5cff",
  },
];

export function Features() {
  return (
    <section className="section" id="features">
      <div className="container">
        <Reveal>
          <span className="section-kicker">
            <Cable size={13} /> Everything, one room
          </span>
          <WordReveal
            className="section-title"
            text="Files, data and chat — one live canvas"
            accent="one live canvas"
          />
          <p className="section-sub">
            A room is a shared space where conversation and content occupy the same timeline. Nothing
            is siloed, nothing is out of sync.
          </p>
        </Reveal>

        <div className="bento">
          {grid.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.06} className={f.className ?? ""}>
              <Tilt className="h-full">
                <motion.div
                  className={`card bento-card h-full ${f.className ?? ""}`}
                  whileHover={{ scale: 1.015 }}
                  transition={{ type: "spring", stiffness: 300, damping: 24 }}
                >
                  <div className="card-glow" style={{ background: `radial-gradient(600px circle at 50% 0%, ${f.accent}22, transparent 60%)` }} />
                  <div className="card-icon" style={{ color: f.accent }}>
                    <f.icon size={20} />
                  </div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </motion.div>
              </Tilt>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
