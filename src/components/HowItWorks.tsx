import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { FolderUp, Link2, MessagesSquare, Sparkles } from "lucide-react";
import { Reveal } from "./Reveal";

const steps = [
  {
    n: "01",
    icon: Sparkles,
    title: "Spin up a room",
    body: "One click generates a short room code. Choose ephemeral — it burns when everyone leaves — or permanent, pinned to your workspace.",
    code: `// room/create.ts
const room = await api.rooms.create({
  mode: "ephemeral",      // | "permanent"
  maxPeers: 100,
  ttlMinutes: 240,        // ephemeral expiry
});

// → { code: "KX-7F2A", wsUrl, iceServers }`,
  },
  {
    n: "02",
    icon: FolderUp,
    title: "Drop files & data",
    body: "Drag in files or whole folders. The client hashes, encrypts and shards them — peers fetch chunks directly while the edge relays what's needed.",
    code: `// transfer/upload.ts
const key = await room.deriveKey("files");
const { meta, chunks } = await encryptFile(file, key);

await tus.upload(chunks, {
  endpoint: relayUrl,
  metadata: meta, // size, sha256, mimetype
});

ws.send({ type: "file.announce", meta });`,
  },
  {
    n: "03",
    icon: MessagesSquare,
    title: "Collaborate live",
    body: "Chat, cursors and presence ride the same WebSocket. Everyone sees the same timeline — messages and file events interleaved, never out of order.",
    code: `// chat/send.ts
ws.send({
  type: "chat.message",
  msg: await encrypt(text, roomKey),
  seq: room.nextSeq(),   // lamport clock
  ref: activeFileId,     // attach to a file
});`,
  },
];

export function HowItWorks() {
  const navigate = useNavigate();
  return (
    <section className="section" id="how">
      <div className="container">
        <Reveal>
          <span className="section-kicker">
            <Link2 size={13} /> The flow
          </span>
          <h2 className="section-title">
            From empty room to <span className="grad-text">living workspace</span>
          </h2>
        </Reveal>

        <div className="steps">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.1}>
              <motion.article
                className="step"
                initial={false}
                whileHover="hover"
                variants={{ hover: { y: -6 } }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
              >
                <div className="step-head">
                  <motion.span
                    className="step-num"
                    variants={{ hover: { rotate: -8, scale: 1.08 } }}
                  >
                    {s.n}
                  </motion.span>
                  <div className="step-icon">
                    <s.icon size={19} />
                  </div>
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <pre className="step-code">
                  <code>{s.code}</code>
                </pre>
              </motion.article>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.15}>
          <div className="how-cta">
            <button className="btn btn-primary" onClick={() => navigate("/room")}>
              Try the flow <motion.span animate={{ x: [0, 4, 0] }} transition={{ duration: 1.4, repeat: Infinity }}>→</motion.span>
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
