import type { LiveRoom } from "./api";

export type ServerMember = { peerId: string; name: string; joinedAt: string; role: "admin" | "member" | "viewer" };

export type ServerChatMessage = {
  id: string;
  roomId: string;
  seq: number;
  author: string;
  payload: string;
  ts: string;
};

export type LiveSocketEvents = {
  onJoined(peerId: string, members: ServerMember[], history: ServerChatMessage[], room: LiveRoom): void;
  onPresence(members: ServerMember[]): void;
  onChat(msg: { seq: number; from: string; payload: string; ts: string }): void;
  onTyping(from: string, active: boolean): void;
  onFileAnnounce(from: string, meta: Record<string, unknown>): void;
  /** Room metadata changed (rename / mode toggle) — pushed by the server. */
  onRoomUpdated?(room: LiveRoom): void;
  /** The room was closed server-side (e.g. an admin burned it) — expect the
   * socket to close right after this. */
  onRoomClosed?(message: string): void;
  /** A member's role changed (admin action). */
  onRoleChanged?(peerId: string, role: "admin" | "member" | "viewer", members: ServerMember[]): void;
  onClose(): void;
};

type ServerToClient =
  | { type: "room.joined"; room: LiveRoom; peerId: string; members: ServerMember[]; history: ServerChatMessage[] }
  | { type: "presence.join"; peerId: string; name: string; members: ServerMember[] }
  | { type: "presence.leave"; peerId: string; name: string; members: ServerMember[] }
  | { type: "room.updated"; room: LiveRoom }
  | { type: "room.closed"; message: string }
  | { type: "role.changed"; peerId: string; role: "admin" | "member" | "viewer"; members: ServerMember[] }
  | { type: "chat.message"; seq: number; from: string; payload: string; ts: string }
  | { type: "typing"; from: string; active: boolean }
  | { type: "file.announce"; from: string; meta: Record<string, unknown> }
  | { type: "signal"; from: string; to?: string; data: unknown }
  | { type: "error"; message: string };

const READY_TIMEOUT_MS = 7000;

/**
 * Thin client for the Conduit WebSocket protocol (see server/src/ws.ts).
 * Chat payloads are opaque — the demo sends plaintext; the real product
 * encrypts client-side and ships ciphertext.
 */
export class LiveRoomSocket {
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private events: LiveSocketEvents;
  /** Signaling consumers (E2EE key exchange, WebRTC mesh). */
  private signalHandlers = new Set<(from: string, data: Record<string, unknown>) => void>();

  constructor(events: LiveSocketEvents) {
    this.events = events;
  }

  get ready(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Opens the connection and resolves once the server confirms `room.joined`. */
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      this.closedByUs = false;

      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("timed out waiting for the Conduit server"));
      }, READY_TIMEOUT_MS);

      ws.onmessage = (ev) => {
        let msg: ServerToClient;
        try {
          msg = JSON.parse(ev.data as string) as ServerToClient;
        } catch {
          return;
        }
        switch (msg.type) {
          case "room.joined":
            clearTimeout(timer);
            this.events.onJoined(msg.peerId, msg.members, msg.history, msg.room);
            resolve();
            break;
          case "presence.join":
          case "presence.leave":
            this.events.onPresence(msg.members);
            break;
          case "room.updated":
            this.events.onRoomUpdated?.(msg.room);
            break;
          case "room.closed":
            this.events.onRoomClosed?.(msg.message);
            break;
          case "role.changed":
            this.events.onRoleChanged?.(msg.peerId, msg.role, msg.members);
            break;
          case "chat.message":
            this.events.onChat(msg);
            break;
          case "typing":
            this.events.onTyping(msg.from, msg.active);
            break;
          case "file.announce":
            this.events.onFileAnnounce(msg.from, msg.meta);
            break;
          case "signal":
            for (const handler of this.signalHandlers) handler(msg.from, msg.data as Record<string, unknown>);
            break;
          case "error":
            console.warn("[conduit] server:", msg.message);
            break;
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("could not reach the Conduit server"));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!this.closedByUs) this.events.onClose();
      };
    });
  }

  sendChat(payload: string) {
    this.ws?.send(JSON.stringify({ type: "chat.message", payload }));
  }

  sendTyping(active: boolean) {
    this.ws?.send(JSON.stringify({ type: "typing", active }));
  }

  sendFileAnnounce(meta: Record<string, unknown>) {
    this.ws?.send(JSON.stringify({ type: "file.announce", meta }));
  }

  /** Request a role change for a member (admins only). */
  sendRoleSet(peerId: string, role: "admin" | "member" | "viewer") {
    this.ws?.send(JSON.stringify({ type: "role.set", peerId, role }));
  }

  /** Relay signaling data to a peer (`to` set) or the whole room (broadcast). */
  sendSignal(data: Record<string, unknown>, to?: string) {
    this.ws?.send(JSON.stringify(to ? { type: "signal", to, data } : { type: "signal", data }));
  }

  /** Subscribe to signaling relayed by the server. Returns an unsubscribe. */
  addSignalHandler(handler: (from: string, data: Record<string, unknown>) => void): () => void {
    this.signalHandlers.add(handler);
    return () => this.signalHandlers.delete(handler);
  }

  close() {
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
  }
}
