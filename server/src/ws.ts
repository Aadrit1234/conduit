import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { WebSocket } from "ws";
import {
  isWsClientMessage,
  type Member,
  type MemberRole,
  type RoomMode,
  type WsServerMessage,
} from "./types.js";
import type { RoomStore } from "./db/store.js";
import { findLiveRoom, publicRoom } from "./rooms.js";

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_ROOM_PEERS = 100;

type Connection = {
  socket: WebSocket;
  peerId: string;
  name: string;
  joinedAt: string;
};

type HubOptions = { store: RoomStore };

/**
 * The real-time hub. Each room maps to its connected peers; messages are
 * persisted with a monotonically increasing per-room sequence number before
 * being fanned out, so every client observes the same ordering.
 *
 * Single-process for the scaffold. Horizontal scaling (Redis pub/sub fan-out)
 * is Phase 3 in docs/ARCHITECTURE.md — the hub is the seam that would swap in.
 */
export const wsPlugin: FastifyPluginAsync<HubOptions> = async (app, opts) => {
  const { store } = opts;
  const rooms = new Map<string, Map<string, Connection>>();
  const roles = new Map<string, Map<string, MemberRole>>(); // roomId -> peerId -> role
  // Cached room mode, refreshed on every join and every room.updated broadcast,
  // so the leave-vs-burn decision below is synchronous (no async gap to race).
  const roomModes = new Map<string, RoomMode>();
  // Ephemeral rooms burned on last-member-leave. Guard: a join request that
  // passed findLiveRoom just before the burn must not attach to a dead room.
  const burned = new Set<string>();

  function roleOf(roomId: string, peerId: string): MemberRole {
    return roles.get(roomId)?.get(peerId) ?? "member";
  }

  // Fill the root-decorated hub bridge so the HTTP layer (rooms PATCH, admin
  // API) can push to connected clients (see app.ts). The mode cache is kept in
  // sync so a PATCH toggle is honored by leave-vs-burn.
  type HubBridge = {
    broadcastRoom(roomId: string, msg: WsServerMessage): void;
    liveMembers(roomId: string): number;
    closeRoom(roomId: string, message: string): void;
  };
  const hub = (app as unknown as { conduitHub: Partial<HubBridge> }).conduitHub;
  hub.broadcastRoom = (roomId, msg) => {
    if (msg.type === "room.updated") roomModes.set(roomId, msg.room.mode);
    broadcast(roomId, msg);
  };
  hub.liveMembers = (roomId) => rooms.get(roomId)?.size ?? 0;
  hub.closeRoom = (roomId, message) => {
    const peers = rooms.get(roomId);
    if (!peers) return;
    for (const conn of peers.values()) {
      send(conn, { type: "room.closed", message } satisfies WsServerMessage);
      conn.socket.close();
    }
  };

  function send(conn: Connection, msg: WsServerMessage) {
    if (conn.socket.readyState === conn.socket.OPEN) {
      conn.socket.send(JSON.stringify(msg));
    }
  }

  function broadcast(roomId: string, msg: WsServerMessage, exceptPeerId?: string) {
    const peers = rooms.get(roomId);
    if (!peers) return;
    for (const conn of peers.values()) {
      if (conn.peerId !== exceptPeerId) send(conn, msg);
    }
  }

  function membersOf(roomId: string): Member[] {
    const peers = rooms.get(roomId);
    if (!peers) return [];
    return [...peers.values()]
      .map((c) => ({ peerId: c.peerId, name: c.name, joinedAt: c.joinedAt, role: roleOf(roomId, c.peerId) }))
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  }

  async function handleMessage(roomId: string, conn: Connection, raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      send(conn, { type: "error", message: "invalid JSON" });
      return;
    }
    if (!isWsClientMessage(parsed)) {
      send(conn, { type: "error", message: "unknown message shape" });
      return;
    }

    switch (parsed.type) {
      case "chat.message": {
        if (roleOf(roomId, conn.peerId) === "viewer") {
          send(conn, { type: "error", message: "read-only: viewers can't send messages" });
          return;
        }
        if (Buffer.byteLength(parsed.payload, "utf8") > MAX_PAYLOAD_BYTES) {
          send(conn, { type: "error", message: "message too large" });
          return;
        }
        // Persist first (assigns the room seq), then fan out in seq order.
        const saved = await store.saveMessage(roomId, conn.peerId, parsed.payload);
        broadcast(roomId, {
          type: "chat.message",
          seq: saved.seq,
          from: conn.peerId,
          payload: saved.payload,
          ts: saved.ts,
        });
        return;
      }
      case "typing":
        if (roleOf(roomId, conn.peerId) === "viewer") {
          send(conn, { type: "error", message: "read-only: viewers can't send typing" });
          return;
        }
        broadcast(roomId, { type: "typing", from: conn.peerId, active: parsed.active }, conn.peerId);
        return;
      case "file.announce":
        if (roleOf(roomId, conn.peerId) === "viewer") {
          send(conn, { type: "error", message: "read-only: viewers can't announce files" });
          return;
        }
        broadcast(roomId, { type: "file.announce", from: conn.peerId, meta: parsed.meta }, conn.peerId);
        return;
      case "role.set": {
        if (roleOf(roomId, conn.peerId) !== "admin") {
          send(conn, { type: "error", message: "only admins can change roles" });
          return;
        }
        const target = rooms.get(roomId)?.get(parsed.peerId);
        if (!target) {
          send(conn, { type: "error", message: "member not in room" });
          return;
        }
        if (parsed.peerId === conn.peerId && parsed.role !== "admin") {
          send(conn, { type: "error", message: "admins can't demote themselves" });
          return;
        }
        roles.get(roomId)?.set(parsed.peerId, parsed.role);
        broadcast(roomId, {
          type: "role.changed",
          peerId: parsed.peerId,
          role: parsed.role,
          members: membersOf(roomId),
        });
        return;
      }
      case "signal":
        if (parsed.to) {
          const peers = rooms.get(roomId);
          const target = peers?.get(parsed.to);
          if (target) send(target, { type: "signal", from: conn.peerId, to: parsed.to, data: parsed.data });
        } else {
          broadcast(roomId, { type: "signal", from: conn.peerId, data: parsed.data }, conn.peerId);
        }
        return;
      case "room.leave":
        conn.socket.close();
        return;
    }
  }

  function attach(roomId: string, conn: Connection) {
    conn.socket.on("message", (data, isBinary) => {
      if (isBinary) {
        send(conn, { type: "error", message: "binary frames not supported" });
        return;
      }
      // `ws` delivers text frames as Buffers unless `raw` is set.
      void handleMessage(roomId, conn, data.toString());
    });
    conn.socket.on("close", () => {
      const peers = rooms.get(roomId);
      if (!peers?.delete(conn.peerId)) return;
      roles.get(roomId)?.delete(conn.peerId);
      broadcast(roomId, { type: "presence.leave", peerId: conn.peerId, name: conn.name, members: membersOf(roomId) });
      if (peers.size === 0) {
        const mode = roomModes.get(roomId);
        rooms.delete(roomId);
        roles.delete(roomId);
        roomModes.delete(roomId);
        // Leave-vs-burn: an empty ephemeral room dies now instead of waiting for
        // the TTL sweep. Permanent rooms survive an empty room.
        if (mode === "ephemeral") {
          burned.add(roomId);
          void store.deleteRoom(roomId).catch((err) => {
            burned.delete(roomId); // keep the room joinable if the burn failed
            app.log.error({ roomId, err }, "failed to burn empty ephemeral room");
          });
        }
      }
    });
    conn.socket.on("error", () => {
      conn.socket.close();
    });
  }

  app.get<{ Params: { code: string }; Querystring: { name?: string } }>(
    "/ws/rooms/:code",
    { websocket: true },
    async (socket, req) => {
      const room = await findLiveRoom(store, req.params.code);
      if (!room || burned.has(room.id)) {
        socket.send(JSON.stringify({ type: "error", message: "room not found" } satisfies WsServerMessage));
        socket.close();
        return;
      }

      const peers = rooms.get(room.id) ?? new Map<string, Connection>();
      if (peers.size >= MAX_ROOM_PEERS) {
        socket.send(JSON.stringify({ type: "error", message: "room is full" } satisfies WsServerMessage));
        socket.close();
        return;
      }
      rooms.set(room.id, peers);
      roomModes.set(room.id, room.mode);
      const roomRoles = roles.get(room.id) ?? new Map<string, MemberRole>();
      roles.set(room.id, roomRoles);

      const name = (req.query.name ?? "Guest").slice(0, 40);
      const conn: Connection = { socket, peerId: randomUUID(), name, joinedAt: new Date().toISOString() };
      peers.set(conn.peerId, conn);
      // The first member of a room is its admin (the key authority client-side).
      roomRoles.set(conn.peerId, peers.size === 1 ? "admin" : "member");
      attach(room.id, conn);

      send(conn, {
        type: "room.joined",
        room: publicRoom(room),
        peerId: conn.peerId,
        members: membersOf(room.id),
        history: await store.listMessages(room.id),
      });
      broadcast(room.id, { type: "presence.join", peerId: conn.peerId, name: conn.name, members: membersOf(room.id) }, conn.peerId);
    }
  );
};
