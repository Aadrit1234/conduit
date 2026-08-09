import { RoomNetwork, type RoomNetworkHandlers } from "./roomNetwork";
import { encodeChunk, decodeChunk, sha256Hex, fmtBytes } from "./framing";

/**
 * In-page WebRTC self-test (?selftest=1).
 *
 * Verifies, in order:
 *  1. the browser can actually establish WebRTC connections (raw probe),
 *  2. chunk framing + SHA-256 primitives,
 *  3. two RoomNetwork instances negotiating a real RTCPeerConnection
 *     (loopback host candidates, loopback signaling) and opening a DataChannel,
 *  4. real file transfers in both directions with hash verification.
 *
 * The only simulated part is signaling transport: instead of a
 * BroadcastChannel (which excludes its own context), messages are looped back
 * to the other instance via queueMicrotask.
 */

type FakeChannel = {
  onmessage: ((ev: { data: unknown }) => void) | null;
  postMessage(msg: unknown): void;
  close(): void;
};

function fakeChannelPair(): [FakeChannel, FakeChannel] {
  const a: FakeChannel = { onmessage: null, postMessage: () => {}, close() {} };
  const b: FakeChannel = { onmessage: null, postMessage: () => {}, close() {} };
  a.postMessage = (msg) => queueMicrotask(() => b.onmessage?.({ data: msg }));
  b.postMessage = (msg) => queueMicrotask(() => a.onmessage?.({ data: msg }));
  return [a, b];
}

function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const iv = setInterval(() => {
      if (cond() || Date.now() - started > timeoutMs) {
        clearInterval(iv);
        resolve(cond());
      }
    }, 120);
  });
}

/** Minimal raw WebRTC probe: two bare RTCPeerConnections, manual signaling. */
async function rawWebRtcProbe(): Promise<string> {
  try {
    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();
    let opened = false;
    a.createDataChannel("probe", { ordered: true }).onopen = () => {
      opened = true;
    };
    b.ondatachannel = (ev) => {
      ev.channel.onopen = () => {
        opened = true;
      };
    };
    const iceA: RTCIceCandidateInit[] = [];
    const iceB: RTCIceCandidateInit[] = [];
    a.onicecandidate = (e) => {
      if (e.candidate) iceA.push(e.candidate.toJSON());
    };
    b.onicecandidate = (e) => {
      if (e.candidate) iceB.push(e.candidate.toJSON());
    };
    const offer = await a.createOffer();
    await a.setLocalDescription(offer);
    await b.setRemoteDescription(offer);
    const answer = await b.createAnswer();
    await b.setLocalDescription(answer);
    await a.setRemoteDescription(answer);
    for (const c of iceB) await a.addIceCandidate(c);
    for (const c of iceA) await b.addIceCandidate(c);
    const started = Date.now();
    while (!opened && Date.now() - started < 6000) {
      await new Promise((r) => setTimeout(r, 120));
    }
    return JSON.stringify({
      opened,
      aConn: a.connectionState,
      aIce: a.iceConnectionState,
      candidates: [iceA.length, iceB.length],
    });
  } catch (err) {
    return "probe threw: " + (err instanceof Error ? err.message : String(err));
  }
}

function emptyHandlers() {
  return { onPeers: () => {}, onSendProgress: () => {}, onReceiveStart: () => {}, onReceiveProgress: () => {}, onReceiveComplete: () => {} };
}

export async function runSelfTest(): Promise<{ pass: boolean; lines: string[] }> {
  const lines: string[] = [];
  const step = (msg: string) => lines.push(msg);

  try {
    // 1. raw capability probe — establishes whether this browser/context can do WebRTC
    const probe = await rawWebRtcProbe();
    const probeOk = probe.includes('"opened":true');
    step(`raw WebRTC probe: ${probe}`);
    if (!probeOk) {
      throw new Error(
        "this browser/context cannot establish WebRTC connections — the mesh and transfer steps are skipped"
      );
    }

    // 2. framing + hash primitives
    const payload = new Uint8Array(300_000).map((_, i) => i % 251);
    const frame = encodeChunk(42, 7, payload.buffer as ArrayBuffer);
    const decoded = decodeChunk(frame);
    if (decoded.transferId !== 42 || decoded.index !== 7) throw new Error("chunk framing header mismatch");
    if (decoded.data.byteLength !== payload.byteLength) throw new Error("chunk framing length mismatch");
    for (let i = 0; i < payload.length; i += 997) {
      if (new Uint8Array(decoded.data)[i] !== payload[i]) throw new Error("chunk payload corrupted");
    }
    step(`framing round-trip ok (${fmtBytes(payload.byteLength)} chunk)`);

    const hash = await sha256Hex(payload.buffer as ArrayBuffer);
    if (hash.length !== 64) throw new Error("sha256 length mismatch");
    step(`sha256 ok (${hash.slice(0, 12)}…)`);

    // 3. two networks negotiate a real connection over loopback signaling
    const [chA, chB] = fakeChannelPair();
    const [netA, netB] = [new RoomNetwork("SELFTEST", emptyHandlers()), new RoomNetwork("SELFTEST", emptyHandlers())];

    type NetHooks = {
      handleSignal(m: unknown): unknown;
      post(m: object): void;
      peers: Map<string, { pc: RTCPeerConnection | null; connected: boolean }>;
      channel: FakeChannel;
      myId: string;
      myName: string;
    };
    const aHooks = netA as unknown as NetHooks;
    const bHooks = netB as unknown as NetHooks;

    // Force distinct identities (constructor reuses the sessionStorage id).
    aHooks.myId = "peer-A";
    aHooks.myName = "Tab·AAAA";
    bHooks.myId = "peer-B";
    bHooks.myName = "Tab·BBBB";
    aHooks.channel = chA;
    bHooks.channel = chB;

    // Bind signaling delivery to the network instances (mirrors how the real
    // BroadcastChannel handler is bound with an arrow function).
    chA.onmessage = (ev) => aHooks.handleSignal(ev.data);
    chB.onmessage = (ev) => bHooks.handleSignal(ev.data);

    const aState = { peers: 0, sendPct: 0, received: null as null | { name: string; verified: boolean } };
    const bState = { peers: 0, recvPct: 0, received: null as null | { name: string; size: number; verified: boolean; sender: string } };
    (netA as unknown as { handlers: RoomNetworkHandlers }).handlers = {
      onPeers: (peers) => { aState.peers = peers.filter((p) => p.connected).length; },
      onSendProgress: (_id, _n, sent, total) => { aState.sendPct = Math.round((sent / total) * 100); },
      onReceiveStart: () => {},
      onReceiveProgress: () => {},
      onReceiveComplete: (f) => { aState.received = f; },
    };
    (netB as unknown as { handlers: RoomNetworkHandlers }).handlers = {
      onPeers: (peers) => { bState.peers = peers.filter((p) => p.connected).length; },
      onSendProgress: () => {},
      onReceiveStart: () => {},
      onReceiveProgress: (_id, received, total) => { bState.recvPct = Math.round((received / total) * 100); },
      onReceiveComplete: (f) => { bState.received = f; },
    };

    // Kick off the mesh with a hello from A (mirrors net.start()).
    aHooks.post({ type: "rtc-hello", peerId: netA.myId, name: netA.myName });

    const opened = await waitFor(() => aState.peers >= 1 && bState.peers >= 1, 15_000);
    if (!opened) {
      const dump = [...aHooks.peers, ...bHooks.peers].map(([id, p]) => ({
        id,
        conn: p.pc?.connectionState,
        sig: p.pc?.signalingState,
        connected: p.connected,
      }));
      throw new Error(`datachannel never opened (${JSON.stringify(dump)})`);
    }
    step("WebRTC mesh connected · datachannel open on both sides");

    // 4. real file transfer A → B
    const size = 2 * 1024 * 1024 + 12345; // awkward size to exercise chunking
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >> 8)) % 256;
    const file = new File([bytes], "mesh-test.bin", { type: "application/octet-stream" });

    const sentTo = await netA.sendFile(file);
    if (sentTo !== 1) throw new Error(`expected 1 peer target, got ${sentTo}`);

    const got = await waitFor(() => bState.received !== null, 30_000);
    if (!got) throw new Error(`file never arrived (B recvPct=${bState.recvPct}%)`);
    if (bState.received!.name !== "mesh-test.bin") throw new Error("received name mismatch");
    if (bState.received!.size !== size) throw new Error(`received size mismatch: ${bState.received!.size} != ${size}`);
    if (!bState.received!.verified) throw new Error("SHA-256 verification FAILED");
    if (bState.received!.sender !== "Tab·AAAA") throw new Error("sender attribution mismatch");
    step(`file transferred A→B: ${fmtBytes(size)} · sha256 verified (${aState.sendPct}% → ${bState.recvPct}%)`);

    // 5. bidirectional: B → A
    const size2 = 512 * 1024;
    const bytes2 = new Uint8Array(size2).map((_, i) => (i * 7 + 3) % 256);
    const file2 = new File([bytes2], "back-chat.md", { type: "text/markdown" });

    const sentBack = await netB.sendFile(file2);
    if (sentBack !== 1) throw new Error(`expected 1 peer target for B→A, got ${sentBack}`);
    const gotBack = await waitFor(() => aState.received !== null, 30_000);
    if (!gotBack || !aState.received!.verified || aState.received!.name !== "back-chat.md") {
      throw new Error(`B→A transfer failed (${JSON.stringify(aState.received)})`);
    }
    step(`file transferred B→A: ${fmtBytes(size2)} · sha256 verified`);

    netA.stop();
    netB.stop();

    step("PASS — full WebRTC mesh + P2P transfer pipeline verified");
    return { pass: true, lines };
  } catch (err) {
    step(`FAIL — ${err instanceof Error ? err.message : String(err)}`);
    return { pass: false, lines };
  }
}

/** Renders the self-test into a standalone dark page. */
export function renderSelfTest(container: HTMLElement) {
  container.innerHTML = `
    <style>
      body { margin: 0; background: #05060a; color: #e9ebf5; font: 14px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; }
      #selftest { max-width: 760px; margin: 48px auto; padding: 0 24px; }
      #selftest h1 { font-size: 20px; letter-spacing: 0.04em; }
      #selftest .status { font-size: 13px; color: #9aa1ba; margin-bottom: 20px; }
      #selftest .line { padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06); color: #cdd3ec; white-space: pre-wrap; }
      #selftest .line.pass { color: #4ade80; font-weight: 600; }
      #selftest .line.fail { color: #ff5c9d; font-weight: 600; }
      #selftest .badge { display:inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; margin-left: 10px; vertical-align: middle; }
      #selftest .badge.run { background: rgba(34,211,238,0.15); color: #22d3ee; }
      #selftest .badge.pass { background: rgba(74,222,128,0.15); color: #4ade80; }
      #selftest .badge.fail { background: rgba(255,92,157,0.15); color: #ff5c9d; }
    </style>
    <div id="selftest">
      <h1>Conduit WebRTC self-test <span class="badge run">running…</span></h1>
      <div class="status">raw WebRTC probe · loopback mesh · real DataChannel file transfers</div>
      <div id="lines"></div>
    </div>`;

  const linesEl = container.querySelector<HTMLDivElement>("#lines")!;
  const badge = container.querySelector<HTMLSpanElement>(".badge")!;

  runSelfTest().then(({ pass, lines }) => {
    badge.className = `badge ${pass ? "pass" : "fail"}`;
    badge.textContent = pass ? "pass" : "fail";
    document.title = `selftest ${pass ? "PASS" : "FAIL"}`;
    linesEl.innerHTML = lines
      .map((l, i) => `<div class="line ${i === lines.length - 1 ? (pass ? "pass" : "fail") : ""}">${escapeHtml(l)}</div>`)
      .join("");
  });
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
