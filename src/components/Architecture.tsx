import { Boxes, Database, GitBranch, Globe, Layers, MonitorSmartphone, Rocket, Server, Workflow } from "lucide-react";
import { Reveal } from "./Reveal";
import { FoldIn } from "./FoldIn";

const stack = [
  {
    layer: "Client",
    icon: MonitorSmartphone,
    stack: ["React 19", "Vite", "Zustand", "Framer Motion"],
    note: "SPA + PWA. Wasm for crypto & hashing.",
    accent: "#22d3ee",
  },
  {
    layer: "Real-time",
    icon: Globe,
    stack: ["WebSocket", "WebRTC", "Yjs", "Socket.io"],
    note: "Chat fan-out, presence, mesh datachannels.",
    accent: "#7c5cff",
  },
  {
    layer: "Backend",
    icon: Server,
    stack: ["Node.js", "Fastify", "Redis", "BullMQ"],
    note: "Stateless API + gateway. Queue-backed jobs.",
    accent: "#ff5c9d",
  },
  {
    layer: "Data",
    icon: Database,
    stack: ["PostgreSQL", "Redis", "S3 / R2"],
    note: "Metadata in SQL, ephemeral state in Redis, blobs in object storage.",
    accent: "#4ade80",
  },
];

const diagramNodes = [
  { id: "client", label: "Browser A", x: 60, y: 70 },
  { id: "client2", label: "Browser B", x: 60, y: 190 },
  { id: "client3", label: "Browser C", x: 60, y: 310 },
  { id: "ws", label: "WS Gateway", x: 340, y: 70 },
  { id: "rtc", label: "WebRTC mesh", x: 340, y: 190 },
  { id: "api", label: "API / Rooms", x: 340, y: 310 },
  { id: "redis", label: "Redis", x: 620, y: 70 },
  { id: "pg", label: "Postgres", x: 620, y: 190 },
  { id: "s3", label: "Object store", x: 620, y: 310 },
];

const edges = [
  ["client", "ws"], ["client", "rtc"], ["client", "api"],
  ["client2", "ws"], ["client2", "rtc"], ["client2", "api"],
  ["client3", "ws"], ["client3", "rtc"], ["client3", "api"],
  ["ws", "redis"], ["ws", "pg"], ["rtc", "s3"], ["api", "pg"], ["api", "s3"],
];

const roadmap = [
  {
    phase: "Phase 1 · MVP",
    icon: Rocket,
    time: "2–3 weeks",
    items: ["Room create/join with codes", "WebSocket chat + presence", "Drag-in file upload via relay", "Encrypted at-rest storage"],
    state: "now",
  },
  {
    phase: "Phase 2 · P2P",
    icon: Workflow,
    time: "3–4 weeks",
    items: ["WebRTC datachannel mesh", "Chunked resume (TUS)", "Folder sync + live cursors", "Capability tokens & revocation"],
    state: "next",
  },
  {
    phase: "Phase 3 · Scale",
    icon: Boxes,
    time: "4–6 weeks",
    items: ["Horizontal gateway fan-out", "Multi-region relay", "Permanent team workspaces", "Audit log & compliance export"],
    state: "later",
  },
];

export function Architecture() {
  return (
    <section className="section" id="architecture">
      <div className="container">
        <Reveal>
          <span className="section-kicker">
            <Layers size={13} /> Under the hood
          </span>
          <h2 className="section-title">
            An architecture that <span className="grad-text">scales with the room</span>
          </h2>
        </Reveal>

        <div className="stack-grid">
          {stack.map((s, i) => (
            <Reveal key={s.layer} delay={i * 0.07}>
              <div className="card stack-card">
                <div className="card-icon" style={{ color: s.accent }}>
                  <s.icon size={20} />
                </div>
                <div className="stack-layer">{s.layer}</div>
                <div className="stack-tech">
                  {s.stack.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <p>{s.note}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1}>
          <div className="diagram glass">
            <div className="diagram-head">
              <GitBranch size={15} />
              <span>Runtime topology — data flows both ways</span>
            </div>
            <svg viewBox="0 0 700 400" className="diagram-svg" role="img" aria-label="System architecture diagram">
              {edges.map(([a, b], i) => {
                const na = diagramNodes.find((n) => n.id === a)!;
                const nb = diagramNodes.find((n) => n.id === b)!;
                return (
                  <line
                    key={i}
                    x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                    className="diagram-edge"
                    pathLength={1}
                  >
                    <animate attributeName="stroke-dashoffset" from="1" to="0" dur={`${1.6 + (i % 4) * 0.4}s`} repeatCount="indefinite" />
                  </line>
                );
              })}
              {diagramNodes.map((n, i) => (
                <g key={n.id}>
                  <rect
                    x={n.x - 74} y={n.y - 20} width={148} height={40} rx={10}
                    className="diagram-node"
                  >
                    <animate attributeName="opacity" values="0.55;1;0.55" dur="3s" begin={`${i * 0.35}s`} repeatCount="indefinite" />
                  </rect>
                  <text x={n.x} y={n.y + 5} textAnchor="middle" className="diagram-text">
                    {n.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </Reveal>

        <div className="roadmap">
          {/* alternate the fold direction so each card unfolds from a different crease */}
          {roadmap.map((r, i) => (
            <FoldIn key={r.phase} delay={i * 0.12} from={i % 2 === 0 ? "top" : "bottom"}>
              <div className={`card roadmap-card ${r.state === "now" ? "roadmap-now" : ""}`}>
                {r.state === "now" && <span className="roadmap-live"><span className="pulse-dot" /> in build</span>}
                <div className="card-icon">
                  <r.icon size={20} />
                </div>
                <h3>{r.phase}</h3>
                <div className="roadmap-time">{r.time}</div>
                <ul>
                  {r.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </div>
            </FoldIn>
          ))}
        </div>
      </div>
    </section>
  );
}
