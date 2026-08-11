import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, Check, ChevronRight, ClipboardCopy,
  File, FileArchive, FileCode, FileSpreadsheet, FileText, FileVideo,
  Folder, FolderOpen, FolderPlus, HardDrive, Image as ImageIcon, Loader2,
  Lock, Paperclip, Play, Radio, RotateCcw, Send, Settings, Shield, Smile, Trash2, Upload, User, Users, Wifi, WifiOff, X, Zap,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { RoomNetwork, type ReceivedFile, type Peer, type RoomSignaling } from "../webrtc/roomNetwork";
import { fmtBytes } from "../webrtc/framing";
import { createRoom, joinRoom, burnRoom, updateRoom, wsUrlFor, guestName, savedName, rememberName, type LiveRoom } from "../live/api";
import { LiveRoomSocket, type ServerMember } from "../live/socket";
import { CryptoSession, type E2eeStatus } from "../live/cryptoSession";
import { RoomSettings, ROLE_LABEL, type MemberRole } from "./RoomSettings";

/* ================= data ================= */

type TreeItem = {
  id: string;
  name: string;
  type: "folder" | "file";
  kind?: "image" | "code" | "video" | "archive" | "sheet" | "doc" | "other";
  size?: string;
  children?: TreeItem[];
  locked?: boolean;
  p2p?: boolean;
  blobUrl?: string;
  verified?: boolean;
};

type Transfer = {
  key: string;
  name: string;
  size: string;
  pct: number;
  dir: "up" | "down";
  kind: "relay" | "p2p";
  done?: boolean;
  note?: string;
};

const FILE_ICON: Record<string, typeof File> = {
  image: ImageIcon, code: FileCode, video: FileVideo, archive: FileArchive,
  sheet: FileSpreadsheet, doc: FileText, other: File,
};

const AVATAR_COLORS = ["#7c5cff", "#22d3ee", "#ff5c9d", "#4ade80", "#fbbf24", "#f472b6"];

/** How long a peer's typing indicator stays visible after its last update.
 * Senders re-broadcast `typing: true` every ~1.5s while typing, so this
 * comfortably covers the gap while still expiring when they stop, clear the
 * field, or disconnect without sending a `typing: false`. */
const TYPING_EXPIRE_MS = 4000;


/* ================= tiny helpers ================= */

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function fmtClock() {
  return new Date().toTimeString().slice(0, 5);
}

function kindFromMime(mime: string): TreeItem["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "doc";
  if (/zip|gzip|tar|rar|7z/.test(mime)) return "archive";
  if (/(spreadsheet|excel|csv)/.test(mime)) return "sheet";
  if (mime.startsWith("text/") || /json|javascript|typescript|xml/.test(mime)) return "code";
  return "other";
}

function peerShort(name: string) {
  return name.startsWith("Tab·") ? name.slice(4, 6) : initials(name);
}

/* ================= Room: setup screen ================= */

function SetupScreen({ onEnter, onBack }: { onEnter: (mode: "ephemeral" | "permanent", code: string, name: string) => void; onBack: () => void }) {
  const [mode, setMode] = useState<"ephemeral" | "permanent">("ephemeral");
  const [code, setCode] = useState("");
  const [name, setName] = useState<string>(() => savedName() || guestName());
  const [joining, setJoining] = useState(false);

  function enter() {
    const finalCode = code.trim().toUpperCase();
    rememberName(name);
    setJoining(true);
    setTimeout(() => onEnter(mode, finalCode, name.trim() || guestName()), 500);
  }

  return (
    <div className="room-shell">
      <div className="setup">
        <motion.button className="setup-back" onClick={onBack} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <ArrowLeft size={15} /> Back to site
        </motion.button>

        <motion.div
          className="setup-card glass"
          initial={{ opacity: 0, y: 30, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="setup-orbit">
            <Radio size={26} />
          </div>
          <h2 className="setup-title">
            <span className="grad-text">New room</span>, in seconds
          </h2>
          <p className="setup-sub">Choose how long your room lives. The code is all your teammates need.</p>

          <div className="setup-name">
            <User size={15} />
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 40))}
              placeholder="Your name"
              maxLength={40}
              spellCheck={false}
              aria-label="Your name"
            />
          </div>

          <div className="mode-switch">
            <motion.button
              className={`mode-opt ${mode === "ephemeral" ? "mode-active" : ""}`}
              onClick={() => setMode("ephemeral")}
              whileTap={{ scale: 0.97 }}
            >
              <Zap size={17} />
              <div>
                <strong>Ephemeral</strong>
                <span>Burns when empty · TTL 4h</span>
              </div>
              {mode === "ephemeral" && <motion.span layoutId="mode-dot" className="mode-check"><Check size={13} /></motion.span>}
            </motion.button>
            <motion.button
              className={`mode-opt ${mode === "permanent" ? "mode-active" : ""}`}
              onClick={() => setMode("permanent")}
              whileTap={{ scale: 0.97 }}
            >
              <HardDrive size={17} />
              <div>
                <strong>Permanent</strong>
                <span>Pinned to your workspace</span>
              </div>
              {mode === "permanent" && <motion.span layoutId="mode-dot" className="mode-check"><Check size={13} /></motion.span>}
            </motion.button>
          </div>

          <div className="setup-divider"><span>or join with a code</span></div>

          <div className="join-row">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
              onKeyDown={(e) => e.key === "Enter" && enter()}
              placeholder="KX-7F2A"
              spellCheck={false}
              aria-label="Room code"
            />
            <button className="btn btn-primary" onClick={enter} disabled={joining}>
              {joining ? <Loader2 size={17} className="spin" /> : <Play size={17} fill="currentColor" />}
              {joining ? "Connecting…" : (code.trim() ? "Join room" : "Create room")}
            </button>
          </div>

          <div className="setup-meta">
            <span><Lock size={12} /> E2E encrypted</span>
            <span><Users size={12} /> Up to 100 peers</span>
            <span><Shield size={12} /> Zero signup</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* ================= Room: file tree ================= */

function FileNode({ item, depth = 0, onOpen }: { item: TreeItem; depth?: number; onOpen: (f: TreeItem) => void }) {
  const [open, setOpen] = useState(depth === 0);
  const Icon = item.type === "folder" ? (open ? FolderOpen : Folder) : FILE_ICON[item.kind ?? "other"];

  return (
    <div>
      <motion.div
        className={`file-row ${item.type === "file" ? "file-row-clickable" : ""}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => {
          if (item.type === "folder") setOpen((o) => !o);
          else onOpen(item);
        }}
        layout
      >
        {item.type === "folder" ? (
          <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }} className="tree-chevron">
            <ChevronRight size={13} />
          </motion.span>
        ) : (
          <span className="tree-chevron" />
        )}
        <Icon size={15} className={`tree-icon ${item.type === "folder" ? "tree-folder" : "tree-file"}`} />
        <span className="tree-name">{item.name}</span>
        {item.p2p && <span className="tree-chip">P2P</span>}
        {item.size && <span className="tree-size">{item.size}</span>}
      </motion.div>
      <AnimatePresence initial={false}>
        {item.type === "folder" && open && item.children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "hidden" }}
          >
            {item.children.map((c) => (
              <FileNode key={c.id} item={c} depth={depth + 1} onOpen={onOpen} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ================= Room: main ================= */

type Msg = {
  id: number;
  from: string;
  text: string;
  file?: string | null;
  t: string;
  pending?: boolean;
  locked?: boolean;
};

type Phase = "setup" | "connecting" | "live" | "error";

export function RoomDemo({ initialCode, onExit }: { initialCode?: string; onExit: () => void }) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("setup");
  const [roomCode, setRoomCode] = useState(initialCode ?? "");
  const [errorMsg, setErrorMsg] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState<string[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [tree, setTree] = useState<TreeItem[]>([]);
  const [realPeers, setRealPeers] = useState<Peer[]>([]);
  const [selectedFile, setSelectedFile] = useState<TreeItem | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [live, setLive] = useState<null | { peerId: string; members: ServerMember[]; room: LiveRoom }>(null);
  const [e2ee, setE2ee] = useState<E2eeStatus>("simulated");
  const idRef = useRef(100);
  const chatEnd = useRef<HTMLDivElement>(null);
  const networkRef = useRef<RoomNetwork | null>(null);
  const socketRef = useRef<LiveRoomSocket | null>(null);
  const cryptoRef = useRef<CryptoSession | null>(null);
  const adminTokenRef = useRef<string | null>(null);
  const myIdRef = useRef<string | null>(null);
  const lastTypingRef = useRef(0);
  const autoJoinedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const decryptChain = useRef<Promise<void>>(Promise.resolve());
  const lockedQueueRef = useRef<{ id: number; payload: string }[]>([]);
  const knownPeersRef = useRef<Set<string>>(new Set());
  const lastPctRef = useRef<Map<number, number>>(new Map());
  const typingTimersRef = useRef<Map<string, number>>(new Map());

  const roomId = useMemo(() => roomCode || "KX-7F2A", [roomCode]);
  const meshCount = realPeers.length;
  const liveMembers = live?.members ?? [];
  const roster = liveMembers.map((m) => ({ key: m.peerId, name: m.name, role: m.role, you: m.peerId === live?.peerId, online: true }));
  const myRole: MemberRole = liveMembers.find((m) => m.peerId === myIdRef.current)?.role ?? "member";
  const roomUrl = `${window.location.origin}/room/${roomId}`;

  /* auto-join /room/:code links straight through the backend */
  useEffect(() => {
    if (!initialCode || autoJoinedRef.current || phase !== "setup") return;
    autoJoinedRef.current = true;
    setPhase("connecting");
    void enterRoom("ephemeral", initialCode, savedName() || guestName());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  /* ---------- live backend ---------- */

  function clockOf(iso: string) {
    return new Date(iso).toTimeString().slice(0, 5);
  }

  /** Decrypt history messages that arrived as locked placeholders while keys were exchanged. */
  function resolveLockedMessages() {
    const queue = lockedQueueRef.current;
    if (queue.length === 0) return;
    lockedQueueRef.current = [];
    decryptChain.current = decryptChain.current.then(async () => {
      const resolved: Record<number, string> = {};
      for (const item of queue) {
        try {
          resolved[item.id] = (await cryptoRef.current?.decrypt(item.payload)) ?? item.payload;
        } catch {
          resolved[item.id] = "encrypted — couldn't decrypt";
        }
      }
      setMessages((m) => m.map((x) => (resolved[x.id] !== undefined ? { ...x, text: resolved[x.id], locked: false } : x)));
    });
  }

  function connectLive(roomCode: string, wsUrl: string): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new LiveRoomSocket({
        onJoined(peerId, members, history, room) {
          myIdRef.current = peerId;
          setLive({ peerId, members, room });
          knownPeersRef.current = new Set(members.map((m) => m.peerId));

          // E2EE: the first member generates the room key; everyone else receives
          // it wrapped to their X25519 public key over the server's signal relay.
          const session = new CryptoSession({
            roomCode,
            socket,
            myPeerId: peerId,
            isCreator: members.length === 1,
            onStatus: (status) => {
              setE2ee(status);
              if (status === "ready") resolveLockedMessages();
            },
            onRotated: (gen) => {
              setMessages((m) => [
                ...m,
                { id: ++idRef.current, from: "conduit", text: `Room key rotated (v${gen}) — the departed member can't read new messages`, file: null, t: fmtClock() },
              ]);
            },
          });
          cryptoRef.current = session;

          if (history.length === 0) {
            setMessages([]);
          } else {
            lockedQueueRef.current = history.map((h) => ({ id: h.seq, payload: h.payload }));
            setMessages(
              history.map((h) => ({
                id: h.seq,
                from: h.author,
                text: "decrypting…",
                file: null,
                t: clockOf(h.ts),
                locked: true,
              }))
            );
          }
          session.start();
        },
        onPresence(members) {
          setLive((l) => (l ? { ...l, members } : l));
          const current = new Set(members.map((m) => m.peerId));
          // departed members — the creator rotates the room key so they can't read new messages
          for (const known of knownPeersRef.current) {
            if (known !== myIdRef.current && !current.has(known)) {
              cryptoRef.current?.onPeerLeft(known, members);
            }
          }
          knownPeersRef.current = new Set([...knownPeersRef.current].filter((p) => current.has(p) || p === myIdRef.current));
          // greet newcomers so they can reach our identity (and the room key)
          for (const m of members) {
            if (m.peerId !== myIdRef.current && !knownPeersRef.current.has(m.peerId)) {
              knownPeersRef.current.add(m.peerId);
              cryptoRef.current?.onPeerJoined(m.peerId);
            }
          }
        },
        onChat(msg) {
          decryptChain.current = decryptChain.current.then(async () => {
            let text: string;
            try {
              text = (await cryptoRef.current?.decrypt(msg.payload)) ?? msg.payload;
            } catch {
              text = "encrypted — couldn't decrypt";
            }
            const next: Msg = { id: ++idRef.current, from: msg.from, text, file: null, t: clockOf(msg.ts) };
            setMessages((m) => {
              // replace the optimistic pending copy of my own message (sent before keys were ready)
              const dup = m.findIndex((x) => x.pending && x.from === "you" && x.text === text);
              if (dup >= 0) {
                const copy = [...m];
                copy[dup] = next;
                return copy;
              }
              return [...m, next];
            });
          });
        },
        onTyping(from, active) {
          if (from === myIdRef.current) return;
          const timers = typingTimersRef.current;
          const existing = timers.get(from);
          if (existing) window.clearTimeout(existing);
          if (active) {
            setTyping((t) => (t.includes(from) ? t : [...t, from]));
            // Auto-expire even if the peer never sends `typing: false` (stops
            // with text left in the box, closes the tab, loses connection…).
            timers.set(
              from,
              window.setTimeout(() => {
                timers.delete(from);
                setTyping((t) => t.filter((x) => x !== from));
              }, TYPING_EXPIRE_MS)
            );
          } else {
            timers.delete(from);
            setTyping((t) => t.filter((x) => x !== from));
          }
        },
        onRoomUpdated: (room) => setLive((l) => (l ? { ...l, room } : l)),
        onRoleChanged: (peerId, role, members) => {
          setLive((l) => (l ? { ...l, members } : l));
          const name = members.find((m) => m.peerId === peerId)?.name ?? "A member";
          setMessages((m) => [
            ...m,
            {
              id: ++idRef.current,
              from: "conduit",
              text: `${name} is now ${role === "viewer" ? "read-only (viewer)" : role === "admin" ? "an admin" : "a member"}`,
              file: null,
              t: fmtClock(),
            },
          ]);
        },
        onFileAnnounce() {
          /* files travel over WebRTC — file.announce stays a no-op */
        },
        onClose() {
          setLive(null);
          setE2ee("simulated");
          setPhase("error");
          setErrorMsg("Connection to the server was lost. Reconnect to pick up where you left off.");
        },
      });
      socketRef.current = socket;
      socket.connect(wsUrl).then(
        () => resolve(true),
        () => {
          socket.close();
          socketRef.current = null;
          resolve(false);
        }
      );
    });
  }

  async function enterRoom(mode: "ephemeral" | "permanent", code: string, name: string) {
    autoJoinedRef.current = true;
    setErrorMsg("");
    try {
      let res;
      if (code) {
        res = await joinRoom(code);
        // A creator who reloads / deep-links back into their own room keeps burn
        // / rename / mode powers: the token lives in sessionStorage (not the
        // server), so it survives page reloads in this browser session.
        adminTokenRef.current = sessionStorage.getItem(`conduit-admin:${code}`);
      } else {
        const created = await createRoom(mode);
        adminTokenRef.current = created.adminToken;
        sessionStorage.setItem(`conduit-admin:${created.room.code}`, created.adminToken);
        res = created;
      }
      setRoomCode(res.room.code);
      navigate(`/room/${res.room.code}`, { replace: true });
      setPhase("connecting");
      if (await connectLive(res.room.code, wsUrlFor(res.room.code, name))) {
        setPhase("live");
        return;
      }
      setErrorMsg("Couldn't open the WebSocket connection. Is the server reachable?");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(
        /not found/i.test(msg)
          ? `Room "${code}" doesn't exist or has expired.`
          : "Server unreachable — is the Conduit backend running?"
      );
    }
    setPhase("error");
  }

  function retry() {
    if (!roomCode) {
      setPhase("setup");
      return;
    }
    setPhase("connecting");
    void enterRoom("ephemeral", roomCode, savedName() || guestName());
  }

  /* ---------- real WebRTC mesh ---------- */

  function upsertRealTransfer(id: number, name: string, size: number, pct: number, dir: "up" | "down") {
    const key = `r-${id}`;
    const rounded = Math.min(Math.round(pct), 100);
    // A large file emits one progress event per 64 KB chunk (~16k for 1 GB) —
    // skip re-renders while the visible percentage hasn't moved.
    const prev = lastPctRef.current.get(id);
    if (prev !== undefined && prev === rounded && rounded < 100) return;
    lastPctRef.current.set(id, rounded);
    if (rounded >= 100) lastPctRef.current.delete(id);
    setTransfers((t) => {
      const existing = t.find((x) => x.key === key);
      if (existing) {
        return t.map((x) => (x.key === key ? { ...x, pct: rounded, done: x.done || rounded >= 100 } : x));
      }
      return [...t, { key, name, size: fmtBytes(size), pct: rounded, dir, kind: "p2p" }];
    });
  }

  function addReceivedFile(file: ReceivedFile) {
    const key = `r-${file.id}`;
    setTransfers((t) => t.map((x) => (x.key === key ? { ...x, pct: 100, done: true, note: file.verified ? "hash verified" : "hash mismatch!" } : x)));
    setTimeout(() => setTransfers((t) => t.filter((x) => x.key !== key)), 5000);

    const kind = kindFromMime(file.mime);
    const url = URL.createObjectURL(file.blob);
    const item: TreeItem = { id: `rx-${file.id}`, name: file.name, type: "file", kind, size: fmtBytes(file.size), p2p: true, blobUrl: url, verified: file.verified };
    setTree((t) => [...t, item]);
    setSelectedFile(item);
    setMessages((m) => [
      ...m,
      {
        id: ++idRef.current,
        from: file.senderId,
        text: file.verified ? "received over WebRTC — sha256 verified" : "received over WebRTC — SHA-256 mismatch!",
        file: file.name,
        t: fmtClock(),
      },
    ]);
  }

  useEffect(() => {
    if (phase !== "live") return;
    // Signaling rides the server's opaque `signal` relay so peers on different
    // devices/browsers find each other (the WebRTC mesh is cross-origin now).
    const socket = socketRef.current;
    const myId = myIdRef.current;
    const signaling: RoomSignaling | undefined =
      socket && myId
        ? {
            myId,
            send: (msg, to) => socket.sendSignal(msg as Record<string, unknown>, to),
            onMessage: (cb) => socket.addSignalHandler((from, data) => cb(from, data)),
          }
        : undefined;
    const net = new RoomNetwork(roomId, {
      onPeers: (peers) => setRealPeers(peers.filter((p) => p.connected)),
      onSendProgress: (id, name, sent, total) => {
        upsertRealTransfer(id, name, total, (sent / total) * 100, "up");
        if (sent >= total) {
          setTimeout(() => setTransfers((t) => t.filter((x) => x.key !== `r-${id}`)), 4000);
        }
      },
      onReceiveStart: (id, name, size) => upsertRealTransfer(id, name, size, 0, "down"),
      onReceiveProgress: (id, received, total) => upsertRealTransfer(id, "receiving…", total, (received / total) * 100, "down"),
      onReceiveComplete: (file) => addReceivedFile(file),
    }, signaling);
    networkRef.current = net;
    net.start();
    return () => {
      net.stop();
      networkRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, roomId]);

  /* close the live socket on unmount */
  useEffect(() => {
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
      for (const t of typingTimersRef.current.values()) window.clearTimeout(t);
      typingTimersRef.current.clear();
    };
  }, []);

  /* scroll to bottom on new messages */
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, typing]);

  /* ---------- actions ---------- */

  function onDraftChange(value: string) {
    setDraft(value);
    const socket = socketRef.current;
    if (!socket?.ready) return;
    const now = Date.now();
    if (value.length > 0) {
      if (now - lastTypingRef.current > 1500) {
        lastTypingRef.current = now;
        socket.sendTyping(true);
      }
    } else {
      lastTypingRef.current = 0;
      socket.sendTyping(false);
    }
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const socket = socketRef.current;
    if (!socket?.ready) return;
    const session = cryptoRef.current;
    if (session) {
      // encrypt in-browser first — the server only ever sees `1:<iv>:<ct>` ciphertext
      void session
        .encrypt(text)
        .then((cipher) => {
          if (cipher) {
            socket.sendChat(cipher);
          } else {
            // keys still negotiating — the session queues the send; show it as pending
            setMessages((m) => [...m, { id: ++idRef.current, from: "you", text, file: null, t: fmtClock(), pending: true }]);
          }
        })
        .catch(() => {
          setMessages((m) => [...m, { id: ++idRef.current, from: "you", text, file: null, t: fmtClock(), pending: true }]);
        });
      return;
    }
    socket.sendChat(text);
  }

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;

    const net = networkRef.current;
    if (!net) {
      setMessages((m) => [
        ...m,
        { id: ++idRef.current, from: "you", text: "couldn't start a transfer — try again", file: null, t: fmtClock() },
      ]);
      return;
    }
    for (const f of files) {
      const sent = await net.sendFile(f);
      if (sent === 0) {
        setMessages((m) => [
          ...m,
          { id: ++idRef.current, from: "you", text: "no peers connected — open this room in another tab to transfer P2P", file: f.name, t: fmtClock() },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          { id: ++idRef.current, from: "you", text: `sent to ${sent} tab${sent === 1 ? "" : "s"} over the WebRTC mesh`, file: f.name, t: fmtClock() },
        ]);
      }
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) void handleFiles(files);
  }

  function copyCode() {
    navigator.clipboard?.writeText(roomId).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadSelected() {
    const f = selectedFile;
    if (!f?.blobUrl) return;
    const a = document.createElement("a");
    a.href = f.blobUrl;
    a.download = f.name;
    a.click();
  }

  async function burn() {
    const token = adminTokenRef.current;
    if (!token) {
      setMessages((m) => [
        ...m,
        { id: ++idRef.current, from: "conduit", text: "Only the creator's browser can burn this room — reload the room from the tab where you created it.", file: null, t: fmtClock() },
      ]);
      return;
    }
    try {
      await burnRoom(roomId, token);
      sessionStorage.removeItem(`conduit-admin:${roomId}`);
      onExit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const networkFailure = err instanceof TypeError || /failed to fetch|networkerror|load failed|fetch failed/i.test(msg);
      const notCreator = /403|invalid admin token/i.test(msg);
      setMessages((m) => [
        ...m,
        {
          id: ++idRef.current,
          from: "conduit",
          text: networkFailure
            ? "Couldn't burn the room: the Conduit server isn't reachable. Check that the backend is running and try again."
            : notCreator
              ? "Couldn't burn the room: this browser isn't the room's creator, or the room predates burn permissions. Reload it from the tab that created it, or create a fresh room."
              : `Couldn't burn the room: ${msg}.`,
          file: null,
          t: fmtClock(),
        },
      ]);
    }
  }

  /* ---------- room settings (rename / mode / roles) ---------- */

  async function renameRoom(name: string) {
    const token = adminTokenRef.current;
    if (!token) return;
    await updateRoom(roomId, token, { name });
  }

  async function setRoomMode(mode: "ephemeral" | "permanent") {
    const token = adminTokenRef.current;
    if (!token) return;
    await updateRoom(roomId, token, { mode });
  }

  function setMemberRole(peerId: string, role: MemberRole) {
    socketRef.current?.sendRoleSet(peerId, role);
  }

  function resolvePeer(id: string): { name: string; color: string; short: string } {
    if (id === "conduit") return { name: "Conduit", color: "#a78bfa", short: "CD" };
    if (live && id === live.peerId) return { name: "You", color: "#4ade80", short: "YO" };
    const member = live?.members.find((m) => m.peerId === id);
    if (member) return { name: member.name, color: "#22d3ee", short: peerShort(member.name) };
    const real = realPeers.find((p) => p.id === id);
    if (real) return { name: real.name, color: "#22d3ee", short: peerShort(real.name) };
    return { name: "Guest", color: "#22d3ee", short: "GU" };
  }

  /* ---------- connecting ---------- */
  if (phase === "connecting") {
    return (
      <div className="room-shell">
        <div className="connecting">
          <motion.div
            className="connecting-orbit"
            animate={{ rotate: 360 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
          >
            <span style={{ transform: "rotate(0deg) translateY(-40px)" }} />
            <span style={{ transform: "rotate(120deg) translateY(-40px)" }} />
            <span style={{ transform: "rotate(240deg) translateY(-40px)" }} />
            <Radio size={22} />
          </motion.div>
          <motion.h3 initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
            Connecting to room <span className="grad-text">{roomId}</span>
          </motion.h3>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="connecting-sub">
            negotiating WebRTC · exchanging X25519 keys · syncing presence
          </motion.p>
        </div>
      </div>
    );
  }

  /* ---------- error ---------- */
  if (phase === "error") {
    return (
      <div className="room-shell">
        <div className="connecting">
          <motion.div
            className="connecting-orbit error-orbit"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
          >
            <WifiOff size={22} />
          </motion.div>
          <motion.h3 initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
            {/doesn't exist/.test(errorMsg) ? "Room not found" : "Can't reach Conduit"}
          </motion.h3>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="connecting-sub">
            {errorMsg}
          </motion.p>
          <motion.div className="error-actions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
            <button className="btn btn-primary" onClick={retry}>
              <RotateCcw size={15} /> Try again
            </button>
            <button className="btn btn-ghost" onClick={onExit}>
              <ArrowLeft size={15} /> Back to site
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  /* ---------- setup ---------- */
  if (phase === "setup") {
    return <SetupScreen onBack={onExit} onEnter={(mode, c, name) => void enterRoom(mode, c, name)} />;
  }

  /* ---------- live room ---------- */
  return (
    <div className="room-shell">
      <div className="room-topbar glass">
        <div className="room-top-left">
          <button className="icon-btn" onClick={onExit} aria-label="Leave room"><ArrowLeft size={17} /></button>
          <div className="room-id">
            <Radio size={15} className="room-id-icon" />
            <strong title={roomId}>{live?.room.name ? live.room.name : roomId}</strong>
            <button className="icon-btn icon-btn-sm" onClick={copyCode} aria-label="Copy room code">
              {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
            </button>
          </div>
          <span className="conn-badge">
            <span className="pulse-dot" />
            {meshCount > 0 ? `mesh · ${meshCount} peer${meshCount === 1 ? "" : "s"}` : "server · no peers yet"}
          </span>
        </div>
        <div className="room-top-right">
          <div className="top-avatars">
            {roster.map((p, i) => (
              <motion.span
                key={p.key}
                className="top-avatar"
                style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                title={p.name}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 18 }}
              >
                {peerShort(p.name)}
              </motion.span>
            ))}
          </div>
          <span className="presence-count">{liveMembers.length} online</span>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Room settings">
            <Settings size={16} />
          </button>
          <ThemeToggle sm />
          <span className={`e2e-badge ${e2ee === "ready" ? "e2e-ready" : e2ee === "negotiating" ? "e2e-negotiating" : ""}`}>
            {e2ee === "negotiating" ? <Loader2 size={12} className="spin" /> : <Lock size={12} />}
            {e2ee === "ready" ? "E2EE · ready" : e2ee === "negotiating" ? "keys…" : "E2EE"}
          </span>
        </div>
      </div>

      <div className="room-body">
        {/* -------- files -------- */}
        <aside className="files-panel glass">
          <div className="panel-head">
            <span><FolderOpen size={15} /> Files</span>
            <button className="icon-btn icon-btn-sm" aria-label="Add files" onClick={() => fileInputRef.current?.click()}>
              <FolderPlus size={15} />
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) void handleFiles(files);
            }}
          />
          <div
            className={`dropzone ${dragOver ? "dropzone-active" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            aria-label="Drop files or click to browse"
          >
            <Upload size={18} />
            <span>Drop files or folders</span>
            <span className="dropzone-hint">
              {meshCount > 0 ? `WebRTC mesh · ${meshCount} peer${meshCount === 1 ? "" : "s"} connected` : "no peers yet — open /room/CODE in another tab to transfer P2P"}
            </span>
          </div>
          <div className="tree">
            {tree.length === 0 && <div className="tree-empty">No files yet — drop something in.</div>}
            {tree.map((n) => (
              <FileNode key={n.id} item={n} onOpen={setSelectedFile} />
            ))}
          </div>

          <div className="panel-head panel-head-2"><span><HardDrive size={14} /> Transfers</span></div>
          <div className="uploads">
            <AnimatePresence>
              {transfers.map((u) => (
                <motion.div
                  key={u.key}
                  className="upload"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  layout
                >
                  <div className="upload-row">
                    <span className="upload-name">{u.name}</span>
                    <span className="upload-pct">
                      {u.done ? <Check size={12} /> : `${u.pct}%`}
                    </span>
                  </div>
                  <div className="progress-track">
                    <motion.div
                      className="progress-fill"
                      animate={{ width: `${u.pct}%` }}
                      transition={{ ease: "easeOut", duration: 0.15 }}
                    />
                  </div>
                  <div className="upload-sub">
                    {u.dir === "down" ? <ArrowDown size={10} /> : <ArrowUp size={10} />}
                    {u.size} · {u.kind === "p2p" ? "mesh" : "relay"}
                    {u.note ? ` · ${u.note}` : ""}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {transfers.length === 0 && <div className="uploads-empty">Nothing transferring</div>}
          </div>
        </aside>

        {/* -------- chat -------- */}
        <main className="chat-panel">
          {selectedFile && (
            <motion.div
              className="file-preview glass"
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {(() => {
                const Icon = FILE_ICON[selectedFile.kind ?? "other"];
                return <div className="preview-icon"><Icon size={20} /></div>;
              })()}
              <div className="preview-meta">
                <strong>{selectedFile.name}</strong>
                <span>
                  {selectedFile.size} · {selectedFile.p2p ? (selectedFile.verified ? "sha256 verified" : "hash mismatch") : "received"}
                </span>
              </div>
              <div className="preview-actions">
                <button
                  className="icon-btn icon-btn-sm"
                  onClick={downloadSelected}
                  disabled={!selectedFile.blobUrl}
                  aria-label={selectedFile.blobUrl ? "Download file" : "No file data to download"}
                  title={selectedFile.blobUrl ? "Download file" : "No file data to download"}
                >
                  <ArrowUpRight size={15} />
                </button>
                <button className="icon-btn icon-btn-sm" onClick={() => setSelectedFile(null)} aria-label="Close preview"><X size={15} /></button>
              </div>
            </motion.div>
          )}

          <div className="chat-scroll" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            <div className="chat-day">
              <span>Today · room {roomId}</span>
            </div>
            <AnimatePresence initial={false}>
              {messages.map((m) => {
                const peer = resolvePeer(m.from);
                const you = m.from === "you";
                return (
                  <motion.div
                    key={m.id}
                    className={`msg ${you ? "msg-you" : ""}`}
                    initial={{ opacity: 0, y: 18, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    layout
                  >
                    <span className="msg-avatar" style={{ background: peer.color }}>{peer.short}</span>
                    <div className="msg-body">
                      <div className="msg-head">
                        <span className="msg-name">{peer.name}</span>
                        <span className="msg-time">{m.t}</span>
                        {m.pending && <Loader2 size={12} className="spin" />}
                      </div>
                      <div className="msg-bubble">
                        {m.text}
                        {m.file && (
                          <div className="msg-file">
                            <FileArchive size={15} />
                            <span>{m.file}</span>
                            <Check size={13} className="msg-file-check" />
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            <AnimatePresence>
              {typing.map((t) => {
                const peer = resolvePeer(t);
                return (
                  <motion.div
                    key={t}
                    className="msg typing-row"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    <span className="msg-avatar" style={{ background: peer.color }}>{peer.short}</span>
                    <div className="typing-bubble">
                      <motion.i animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity }} />
                      <motion.i animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: 0.15 }} />
                      <motion.i animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: 0.3 }} />
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            <div ref={chatEnd} />
          </div>

          <div className="composer">
            <div className="composer-inner glass">
              <button className="icon-btn" aria-label="Attach file" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /></button>
              <button className="icon-btn" aria-label="Emoji"><Smile size={17} /></button>
              <input
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={`Message ${roomId}…`}
                aria-label="Message"
              />
              <button className="composer-send" onClick={send} disabled={!draft.trim()} aria-label="Send message">
                <Send size={16} />
              </button>
            </div>
            <div className="composer-hint">
              {e2ee === "ready" ? (
                <><Lock size={11} /> AES-256-GCM in-browser · X25519 keys · server sees ciphertext only</>
              ) : e2ee === "negotiating" ? (
                <><Lock size={11} /> negotiating X25519 room keys…</>
              ) : (
                <><Lock size={11} /> messages encrypted in-browser · files travel P2P over WebRTC</>
              )}
            </div>
          </div>
        </main>

        {/* -------- members -------- */}
        <aside className="members-panel glass">
          <div className="panel-head"><span><Users size={15} /> Members</span></div>
          <div className="members">
            {roster.map((p, i) => (
              <motion.div
                key={p.key}
                className="member"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.08 }}
              >
                <span className="member-avatar" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                  {peerShort(p.name)}
                  <i className="member-online" />
                </span>
                <div className="member-meta">
                  <strong>{p.name}{p.you && <span className="member-you">you</span>}</strong>
                  <span className="member-sub">
                    <i className="member-role-dot" style={{ background: "var(--green, #4ade80)" }} />
                    {ROLE_LABEL[p.role]}
                  </span>
                </div>
              </motion.div>
            ))}
            {roster.length === 0 && <div className="members-empty">Waiting for members…</div>}
          </div>

          {realPeers.length > 0 && (
            <>
              <div className="panel-head panel-head-2"><span><Wifi size={14} /> Live tabs · mesh</span></div>
              <div className="members">
                {realPeers.map((p) => (
                  <motion.div
                    key={p.id}
                    className="member"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                  >
                    <span className="member-avatar tab-avatar">
                      {peerShort(p.name)}
                      <i className="member-online" />
                    </span>
                    <div className="member-meta">
                      <strong>{p.name}<span className="member-you">p2p</span></strong>
                      <span>datachannel open</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </>
          )}

          <div className="panel-head panel-head-2"><span><Shield size={14} /> Room policy</span></div>
          <div className="policy">
            <div className="policy-row"><Zap size={13} /><span>{live?.room.mode === "permanent" ? "Permanent room" : `Ephemeral · TTL ${Math.max(1, Math.round((live?.room.ttlSeconds ?? 0) / 3600))}h`}</span></div>
            <div className="policy-row"><Lock size={13} /><span>AES-256-GCM session keys</span></div>
            <div className="policy-row"><Users size={13} /><span>Everyone can read & write</span></div>
            <button
              className="btn btn-ghost btn-sm policy-revoke"
              onClick={() => void burn()}
              disabled={!adminTokenRef.current}
              title={adminTokenRef.current ? "Destroy this room for everyone" : "Only the creator can burn the room"}
            >
              <Trash2 size={14} /> Burn room now
            </button>
          </div>
        </aside>
      </div>

      <AnimatePresence>
        {settingsOpen && live && (
          <RoomSettings
            room={live.room}
            members={liveMembers}
            myPeerId={live.peerId}
            roomUrl={roomUrl}
            isCreator={adminTokenRef.current != null}
            myRole={myRole}
            onClose={() => setSettingsOpen(false)}
            onRename={renameRoom}
            onSetMode={setRoomMode}
            onSetRole={setMemberRole}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export type { TreeItem };
