import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { RoomMode, WsServerMessage } from "./types.js";
import type { RoomStore } from "./db/store.js";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I
const DEFAULT_EPHEMERAL_TTL_MINUTES = 240;

export function generateRoomCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

/**
 * Resolves a room by code, purging it if an ephemeral room has expired.
 * Shared by the HTTP routes and the WebSocket hub.
 */
export async function findLiveRoom(store: RoomStore, code: string) {
  const room = await store.getRoomByCode(code.trim().toUpperCase());
  if (!room) return null;
  if (room.expiresAt && new Date(room.expiresAt) <= new Date()) {
    await store.deleteRoom(room.id);
    return null;
  }
  return room;
}

type CreateBody = {
  mode?: RoomMode;
  ttlMinutes?: number;
  code?: string;
  name?: string;
  keyBlob?: string; // base64
};

type UpdateBody = {
  adminToken?: string;
  name?: string;
  mode?: RoomMode;
};

/** The room shape sent over WebSocket and PATCH responses. */
export function publicRoom(room: { code: string; name: string; mode: RoomMode; ttlSeconds: number | null; expiresAt: string | null }) {
  return {
    code: room.code,
    name: room.name,
    mode: room.mode,
    ttlSeconds: room.ttlSeconds,
    expiresAt: room.expiresAt,
  };
}

type RoomPluginOptions = { store: RoomStore };

export const roomsPlugin: FastifyPluginAsync<RoomPluginOptions> = async (app, opts) => {
  const { store } = opts;
  // Admin tokens are intentionally in-memory for this scaffold: they gate the
  // burn endpoint, which is ephemeral anyway. Swap for signed tokens (JWT/JWS)
  // when permanent workspaces land.
  const adminTokens = new Map<string, string>();

  app.post<{ Body: CreateBody }>("/rooms", async (req, reply) => {
    const mode: RoomMode = req.body?.mode === "permanent" ? "permanent" : "ephemeral";
    const ttlMinutes = req.body?.ttlMinutes ?? DEFAULT_EPHEMERAL_TTL_MINUTES;
    const code = req.body?.code?.trim().toUpperCase() || generateRoomCode();
    if (code.length < 4 || code.length > 12) {
      return reply.code(400).send({ error: "code must be 4-12 characters" });
    }

    const room = await store.createRoom({
      code,
      name: req.body?.name?.trim().slice(0, 60) ?? "",
      mode,
      ttlSeconds: mode === "ephemeral" ? ttlMinutes * 60 : null,
      keyBlob: req.body?.keyBlob ? Buffer.from(req.body.keyBlob, "base64") : null,
    }).catch(() => null);
    if (!room) {
      return reply.code(409).send({ error: `room code ${code} is taken` });
    }

    const adminToken = randomUUID();
    adminTokens.set(room.id, adminToken);
    return reply.code(201).send({ room, adminToken, wsUrl: `/ws/rooms/${room.code}` });
  });

  app.get<{ Params: { code: string } }>("/rooms/:code", async (req, reply) => {
    const room = await findLiveRoom(store, req.params.code);
    if (!room) return reply.code(404).send({ error: "room not found" });
    return { room };
  });

  app.post<{ Params: { code: string }; Body: { name?: string } }>(
    "/rooms/:code/join",
    async (req, reply) => {
      const room = await findLiveRoom(store, req.params.code);
      if (!room) return reply.code(404).send({ error: "room not found" });
      return {
        room,
        wsUrl: `/ws/rooms/${room.code}${req.body?.name ? `?name=${encodeURIComponent(req.body.name)}` : ""}`,
      };
    }
  );

  app.get<{ Params: { code: string }; Querystring: { limit?: string } }>(
    "/rooms/:code/messages",
    async (req, reply) => {
      const room = await findLiveRoom(store, req.params.code);
      if (!room) return reply.code(404).send({ error: "room not found" });
      const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
      return { messages: await store.listMessages(room.id, limit) };
    }
  );

  app.patch<{ Params: { code: string }; Body: UpdateBody }>(
    "/rooms/:code",
    async (req, reply) => {
      const room = await findLiveRoom(store, req.params.code);
      if (!room) return reply.code(404).send({ error: "room not found" });
      if (adminTokens.get(room.id) !== req.body?.adminToken) {
        return reply.code(403).send({ error: "invalid admin token" });
      }
      const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 60) : undefined;
      const mode =
        req.body?.mode === "ephemeral" || req.body?.mode === "permanent" ? req.body.mode : undefined;
      if (name === undefined && mode === undefined) {
        return reply.code(400).send({ error: "provide name and/or mode" });
      }
      const updated = await store.updateRoom(room.id, { name, mode });
      // Notify connected clients so the rename/toggle shows up live.
      (app as unknown as { conduitHub?: { broadcastRoom(roomId: string, msg: WsServerMessage): void } }).conduitHub
        ?.broadcastRoom(room.id, { type: "room.updated", room: publicRoom(updated) });
      return { room: publicRoom(updated) };
    }
  );

  app.delete<{ Params: { code: string }; Body: { adminToken?: string } }>(
    "/rooms/:code",
    async (req, reply) => {
      const room = await findLiveRoom(store, req.params.code);
      if (!room) return reply.code(404).send({ error: "room not found" });
      if (adminTokens.get(room.id) !== req.body?.adminToken) {
        return reply.code(403).send({ error: "invalid admin token" });
      }
      await store.deleteRoom(room.id);
      adminTokens.delete(room.id);
      return { ok: true };
    }
  );
};
