export type RoomMode = "ephemeral" | "permanent";

export type Room = {
  id: string;
  code: string;
  name: string;
  mode: RoomMode;
  ttlSeconds: number | null;
  createdAt: string;
  expiresAt: string | null;
};

export type MemberRole = "admin" | "member" | "viewer";

export type ChatMessage = {
  id: string;
  roomId: string;
  seq: number;
  author: string;
  /** Opaque bytes — in the real product this is ciphertext (AES-256-GCM). */
  payload: string;
  ts: string;
};

export type Member = {
  peerId: string;
  name: string;
  joinedAt: string;
  role: MemberRole;
};

/* ---------- WebSocket protocol (client → server) ---------- */

export type WsClientMessage =
  | { type: "chat.message"; payload: string }
  | { type: "typing"; active: boolean }
  | { type: "file.announce"; meta: Record<string, unknown> }
  | { type: "signal"; to?: string; data: unknown }
  | { type: "role.set"; peerId: string; role: MemberRole }
  | { type: "room.leave" };

/* ---------- WebSocket protocol (server → client) ---------- */

export type PublicRoom = {
  code: string;
  name: string;
  mode: RoomMode;
  ttlSeconds: number | null;
  expiresAt: string | null;
};

export type WsServerMessage =
  | {
      type: "room.joined";
      room: PublicRoom;
      peerId: string;
      members: Member[];
      history: ChatMessage[];
    }
  | { type: "presence.join"; peerId: string; name: string; members: Member[] }
  | { type: "presence.leave"; peerId: string; name: string; members: Member[] }
  | { type: "room.updated"; room: PublicRoom }
  | { type: "room.closed"; message: string }
  | { type: "role.changed"; peerId: string; role: MemberRole; members: Member[] }
  | { type: "chat.message"; seq: number; from: string; payload: string; ts: string }
  | { type: "typing"; from: string; active: boolean }
  | { type: "file.announce"; from: string; meta: Record<string, unknown> }
  | { type: "signal"; from: string; to?: string; data: unknown }
  | { type: "error"; message: string };

export function isWsClientMessage(raw: unknown): raw is WsClientMessage {
  if (typeof raw !== "object" || raw === null) return false;
  const msg = raw as Record<string, unknown>;
  switch (msg.type) {
    case "chat.message":
      return typeof msg.payload === "string";
    case "typing":
      return typeof msg.active === "boolean";
    case "file.announce":
      return typeof msg.meta === "object" && msg.meta !== null;
    case "signal":
      return true;
    case "role.set":
      return (
        typeof msg.peerId === "string" &&
        (msg.role === "admin" || msg.role === "member" || msg.role === "viewer")
      );
    case "room.leave":
      return true;
    default:
      return false;
  }
}
