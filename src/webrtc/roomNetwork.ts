import { CHUNK_SIZE, encodeChunk, decodeChunk, isChunkFrame, sha256Hex, readFileChunks } from "./framing";

/* ================= public types ================= */

export type Peer = { id: string; name: string; connected: boolean };

export type ReceivedFile = {
  id: string;
  name: string;
  size: number;
  mime: string;
  sha256: string;
  verified: boolean;
  sender: string;
  senderId: string;
  blob: Blob;
};

export type RoomNetworkHandlers = {
  onPeers(peers: Peer[]): void;
  onSendProgress(id: number, name: string, sent: number, total: number): void;
  onReceiveStart(id: number, name: string, size: number): void;
  onReceiveProgress(id: number, received: number, total: number): void;
  onReceiveComplete(file: ReceivedFile): void;
};

/**
 * Pluggable signaling transport for the WebRTC mesh.
 *
 * The real app rides the server's opaque `signal` relay (server/src/ws.ts
 * forwards it without inspecting it), so peers on different devices and
 * browsers find each other — this is what makes P2P file transfer work
 * outside a single browser. A same-origin BroadcastChannel is the fallback
 * (two tabs of one browser with no backend), and the self-test uses a
 * loopback pair.
 *
 * Every message carries its *sender's* id in `peerId`. Point-to-point
 * messages (offer/answer/ice) also carry `to` (the recipient's id) and the
 * transport must deliver them only to that peer. Broadcast messages
 * (hello / bye) have no `to` and reach every other member.
 */
export type RoomSignaling = {
  /** My identity as known to the transport (the WS peerId in the real app). */
  myId: string;
  /** Send a signaling message, optionally to one specific peer. */
  send(msg: object, to?: string): void;
  /** Subscribe to inbound signaling. Returns an unsubscribe function. */
  onMessage(cb: (from: string, msg: object) => void): () => void;
};

/* ================= internal types ================= */

type MetaMsg = {
  kind: "file-meta";
  id: number;
  name: string;
  size: number;
  mime: string;
  sha256: string;
  chunks: number;
  sender: string;
};

type DoneMsg = { kind: "file-done"; id: number; count: number };

type PeerRecord = {
  id: string;
  name: string;
  pc: RTCPeerConnection | null;
  dc: RTCDataChannel | null;
  pendingIce: RTCIceCandidateInit[];
  remoteSet: boolean;
  connected: boolean;
  sendTransfers: Map<number, { name: string; sent: number; total: number }>;
  recvChunks: Map<number, { meta: MetaMsg; chunks: ArrayBuffer[]; received: number }>;
};

/** Public STUN — enough for most NATs; set VITE_ICE_SERVERS to add TURN. */
function defaultIceServers(): RTCIceServer[] {
  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ];
}

/**
 * ICE servers from VITE_ICE_SERVERS (JSON array of RTCIceServer, e.g.
 * `[{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]`).
 * Falls back to public STUN when unset or malformed.
 */
function iceServers(): RTCIceServer[] {
  const raw = import.meta.env.VITE_ICE_SERVERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as RTCIceServer[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      console.warn("[conduit] VITE_ICE_SERVERS is not valid JSON — using public STUN");
    }
  }
  return defaultIceServers();
}

/* ================= the mesh ================= */

/**
 * Connects every member of the same room into a full WebRTC mesh. Signaling
 * rides a pluggable transport (the server's `signal` relay by default, or a
 * same-origin BroadcastChannel), then file transfers flow peer-to-peer over
 * ordered DataChannels with SHA-256 verification.
 */
export class RoomNetwork {
  readonly roomCode: string;
  readonly myId: string;
  readonly myName: string;

  private channel: BroadcastChannel | null = null;
  private signaling: RoomSignaling | null;
  private unsubSignal: (() => void) | null = null;
  private peers = new Map<string, PeerRecord>();
  private handlers: RoomNetworkHandlers;
  private nextTransfer = (Date.now() & 0xffffffff) >>> 0;
  private stopped = false;

  constructor(roomCode: string, handlers: RoomNetworkHandlers, signaling?: RoomSignaling) {
    this.roomCode = roomCode.trim().toUpperCase();
    this.handlers = handlers;
    this.signaling = signaling ?? null;

    if (signaling) {
      this.myId = signaling.myId;
      this.unsubSignal = signaling.onMessage((_from, msg) => this.handleSignal(msg));
    } else {
      // Stable per-tab identity so StrictMode remounts don't re-negotiate with themselves.
      const key = `conduit-peer-${this.roomCode}`;
      let id = sessionStorage.getItem(key);
      if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12);
        sessionStorage.setItem(key, id);
      }
      this.myId = id;
    }
    this.myName = `Tab·${this.myId.slice(-4).toUpperCase()}`;
  }

  get peerList(): Peer[] {
    return [...this.peers.values()].map((p) => ({ id: p.id, name: p.name, connected: p.connected }));
  }

  get connectedCount(): number {
    return [...this.peers.values()].filter((p) => p.connected).length;
  }

  start() {
    if (typeof RTCPeerConnection === "undefined") return;
    window.addEventListener("beforeunload", this.announceBye);
    if (this.signaling) {
      this.post({ type: "rtc-hello", peerId: this.myId, name: this.myName });
      return;
    }
    if (typeof BroadcastChannel === "undefined") return;
    this.channel = new BroadcastChannel(`conduit-room:${this.roomCode}`);
    this.channel.onmessage = (ev: MessageEvent) => this.handleSignal(ev.data);
    this.post({ type: "rtc-hello", peerId: this.myId, name: this.myName });
  }

  stop() {
    this.stopped = true;
    this.announceBye();
    window.removeEventListener("beforeunload", this.announceBye);
    this.unsubSignal?.();
    this.unsubSignal = null;
    this.channel?.close();
    this.channel = null;
    for (const p of this.peers.values()) p.pc?.close();
    this.peers.clear();
    this.emitPeers();
  }

  /* ---------- file transfer ---------- */

  async sendFile(file: File): Promise<number> {
    const open = () =>
      [...this.peers.values()].filter((p) => p.connected && p.dc && p.dc.readyState === "open");
    let targets = open();
    if (targets.length === 0) {
      await this.waitForOpenPeer(4000);
      targets = open();
    }
    if (targets.length === 0) return 0;

    const sha = await sha256Hex(file);
    const chunkCount = Math.ceil(file.size / CHUNK_SIZE);
    let sent = 0;
    for (const peer of targets) {
      try {
        await this.sendToPeer(peer, file, sha, chunkCount);
        sent++;
      } catch (err) {
        console.warn("[conduit] p2p send failed", err);
      }
    }
    return sent;
  }

  private async sendToPeer(peer: PeerRecord, file: File, sha: string, chunkCount: number) {
    const dc = peer.dc!;
    const id = this.nextTransfer++;
    peer.sendTransfers.set(id, { name: file.name, sent: 0, total: file.size });
    this.handlers.onSendProgress(id, file.name, 0, file.size);

    const meta: MetaMsg = {
      kind: "file-meta",
      id,
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      sha256: sha,
      chunks: chunkCount,
      sender: this.myName,
    };
    dc.send(JSON.stringify(meta));

    // Stream slices from the File on demand instead of pre-loading every chunk,
    // so a multi-GB transfer keeps a flat memory footprint.
    let index = 0;
    for await (const chunk of readFileChunks(file)) {
      // Backpressure: pause while the channel buffer is full.
      if (dc.bufferedAmount > 1.5 * 1024 * 1024) {
        await new Promise<void>((resolve) => {
          const onLow = () => {
            dc.removeEventListener("bufferedamountlow", onLow);
            resolve();
          };
          dc.addEventListener("bufferedamountlow", onLow);
        });
      }
      dc.send(encodeChunk(id, index, chunk));
      const rec = peer.sendTransfers.get(id);
      if (rec) {
        rec.sent += chunk.byteLength;
        this.handlers.onSendProgress(id, rec.name, rec.sent, rec.total);
      }
      index++;
    }
    dc.send(JSON.stringify({ kind: "file-done", id, count: index } satisfies DoneMsg));
    peer.sendTransfers.delete(id);
  }

  private waitForOpenPeer(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const started = Date.now();
      const iv = setInterval(() => {
        const ready =
          [...this.peers.values()].some((p) => p.connected && p.dc && p.dc.readyState === "open") ||
          Date.now() - started > ms ||
          this.stopped;
        if (ready) {
          clearInterval(iv);
          resolve();
        }
      }, 120);
    });
  }

  /* ---------- data channel: receive ---------- */

  private attachChannel(peer: PeerRecord, dc: RTCDataChannel) {
    peer.dc = dc;
    dc.bufferedAmountLowThreshold = 512 * 1024;
    dc.onopen = () => {
      peer.connected = true;
      this.emitPeers();
    };
    dc.onclose = () => {
      peer.connected = false;
      this.emitPeers();
    };
    dc.onerror = () => {};
    dc.onmessage = (ev: MessageEvent) => this.onDataMessage(peer, ev.data);
  }

  private onDataMessage(peer: PeerRecord, data: unknown) {
    if (typeof data === "string") {
      let msg: { kind?: string };
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.kind === "file-meta") this.onMeta(peer, msg as MetaMsg);
      else if (msg.kind === "file-done") this.onDone(peer, msg as DoneMsg);
      return;
    }
    if (isChunkFrame(data)) {
      const { transferId, index, data: payload } = decodeChunk(data);
      const t = peer.recvChunks.get(transferId);
      if (!t || index >= t.chunks.length) return;
      t.chunks[index] = payload;
      t.received += payload.byteLength;
      this.handlers.onReceiveProgress(transferId, t.received, t.meta.size);
    }
  }

  private onMeta(peer: PeerRecord, meta: MetaMsg) {
    peer.recvChunks.set(meta.id, { meta, chunks: new Array<ArrayBuffer>(meta.chunks), received: 0 });
    this.handlers.onReceiveStart(meta.id, meta.name, meta.size);
  }

  private async onDone(peer: PeerRecord, done: DoneMsg) {
    const t = peer.recvChunks.get(done.id);
    if (!t) return;
    peer.recvChunks.delete(done.id);
    const blob = new Blob(t.chunks, { type: t.meta.mime });
    const actual = await sha256Hex(blob);
    this.handlers.onReceiveComplete({
      id: String(done.id),
      name: t.meta.name,
      size: t.meta.size,
      mime: t.meta.mime,
      sha256: t.meta.sha256,
      verified: actual === t.meta.sha256,
      sender: t.meta.sender,
      senderId: peer.id,
      blob,
    });
  }

  /* ---------- signaling ---------- */

  private post(msg: object, to?: string) {
    if (this.signaling) this.signaling.send(msg, to);
    else this.channel?.postMessage(msg);
  }

  private handleSignal(msg: any) {
    // Every message carries the sender's id in `peerId`. Never process our own.
    if (!msg || typeof msg !== "object" || msg.peerId === this.myId) return;
    // Point-to-point messages carry the recipient's id in `to` — the transport
    // should have routed them already; this is a defensive double-check.
    if (msg.to && msg.to !== this.myId) return;
    switch (msg.type) {
      case "rtc-hello":
        this.ensurePeer(msg.peerId, msg.name);
        this.post({ type: "rtc-hello-back", peerId: this.myId, name: this.myName });
        break;
      case "rtc-hello-back":
        this.ensurePeer(msg.peerId, msg.name);
        break;
      case "rtc-offer":
        void this.onOffer(msg);
        break;
      case "rtc-answer":
        void this.onAnswer(msg);
        break;
      case "rtc-ice":
        this.onIce(msg);
        break;
      case "rtc-bye":
        this.removePeer(msg.peerId);
        break;
    }
  }

  private ensurePeer(peerId: string, name: string) {
    if (this.stopped) return;
    let peer = this.peers.get(peerId);
    if (!peer) {
      peer = {
        id: peerId,
        name,
        pc: null,
        dc: null,
        pendingIce: [],
        remoteSet: false,
        connected: false,
        sendTransfers: new Map(),
        recvChunks: new Map(),
      };
      this.peers.set(peerId, peer);
    } else {
      peer.name = name;
    }
    if (!peer.pc) {
      peer.pc = this.createPeerConnection(peer);
      // Deterministic role: the tab with the smaller id starts negotiation.
      if (this.myId < peerId) {
        setTimeout(() => this.negotiate(peer!), 250);
      }
    }
    this.emitPeers();
  }

  private createPeerConnection(peer: PeerRecord): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.post({ type: "rtc-ice", peerId: this.myId, to: peer.id, candidate: ev.candidate.toJSON() });
      }
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        peer.connected = true;
        this.emitPeers();
      } else if (st === "failed" || st === "closed" || st === "disconnected") {
        peer.connected = false;
        this.emitPeers();
      }
    };
    pc.ondatachannel = (ev) => this.attachChannel(peer, ev.channel);
    return pc;
  }

  private async negotiate(peer: PeerRecord) {
    const pc = peer.pc;
    if (!pc) return;
    const dc = pc.createDataChannel("files", { ordered: true });
    this.attachChannel(peer, dc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (pc.localDescription) {
      this.post({ type: "rtc-offer", peerId: this.myId, to: peer.id, sdp: pc.localDescription });
    }
  }

  private async onOffer(msg: { peerId: string; sdp: RTCSessionDescriptionInit }) {
    const peer = this.peers.get(msg.peerId);
    if (!peer || !peer.pc || peer.remoteSet) return;
    peer.remoteSet = true;
    try {
      await peer.pc.setRemoteDescription(msg.sdp);
      this.flushIce(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      if (peer.pc.localDescription) {
        this.post({ type: "rtc-answer", peerId: this.myId, to: peer.id, sdp: peer.pc.localDescription });
      }
    } catch (err) {
      console.warn("[conduit] answer failed", err);
    }
  }

  private async onAnswer(msg: { peerId: string; sdp: RTCSessionDescriptionInit }) {
    const peer = this.peers.get(msg.peerId);
    if (!peer || !peer.pc || peer.remoteSet) return;
    peer.remoteSet = true;
    try {
      await peer.pc.setRemoteDescription(msg.sdp);
      this.flushIce(peer);
    } catch (err) {
      console.warn("[conduit] remote description failed", err);
    }
  }

  private onIce(msg: { peerId: string; candidate: RTCIceCandidateInit }) {
    const peer = this.peers.get(msg.peerId);
    if (!peer || !peer.pc) return;
    if (peer.remoteSet) {
      peer.pc.addIceCandidate(msg.candidate).catch(() => {});
    } else {
      peer.pendingIce.push(msg.candidate);
    }
  }

  private flushIce(peer: PeerRecord) {
    for (const c of peer.pendingIce) {
      peer.pc?.addIceCandidate(c).catch(() => {});
    }
    peer.pendingIce = [];
  }

  private removePeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.pc?.close();
    this.peers.delete(peerId);
    this.emitPeers();
  }

  private emitPeers() {
    this.handlers.onPeers(this.peerList);
  }

  private announceBye = () => {
    this.post({ type: "rtc-bye", peerId: this.myId });
  };
}

export { CHUNK_SIZE };
