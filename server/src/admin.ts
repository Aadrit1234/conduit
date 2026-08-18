import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ConduitHub } from "./app.js";
import type { RoomStore } from "./db/store.js";
import type { Room, RoomMode } from "./types.js";
import { findLiveRoom, publicRoom } from "./rooms.js";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

type AdminPluginOptions = {
  store: RoomStore;
  adminPassword: string | null;
  /** Filled by the WebSocket plugin at registration — optional until then. */
  hub: Partial<ConduitHub>;
};

type AdminRoom = {
  id: string;
  code: string;
  name: string;
  mode: RoomMode;
  ttlSeconds: number | null;
  createdAt: string;
  expiresAt: string | null;
  messageCount: number;
  memberCount: number;
};

/**
 * The /admin management API — an operator console for the Conduit server.
 *
 * Enabled only when `ADMIN_PASSWORD` is set (see config.ts); otherwise every
 * admin route answers 503 "not configured". Login exchanges the password for a
 * random bearer token held in memory (12h TTL). Chat content is end-to-end
 * encrypted, so admins see room metadata only — codes, mode, lifetime, message
 * and member counts — and can rename, toggle mode, or burn rooms.
 */
export const adminPlugin: FastifyPluginAsync<AdminPluginOptions> = async (app, opts) => {
  const { store, adminPassword, hub } = opts;

  // Bearer sessions: token -> expiry. In-memory by design — an operator login
  // is per-process; a restart simply invalidates old sessions (re-login).
  const sessions = new Map<string, { expiresAt: number }>();
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [token, s] of sessions) if (s.expiresAt <= now) sessions.delete(token);
  }, SESSION_SWEEP_INTERVAL_MS);
  sweeper.unref();
  app.addHook("onClose", async () => clearInterval(sweeper));

  function safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }

  function bearerToken(req: { headers: Record<string, string | string[] | undefined> }): string | null {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
    return header.slice("Bearer ".length).trim() || null;
  }

  /** Fastify preHandler: rejects the request unless the bearer token is valid. */
  function requireAdmin(
    req: { headers: Record<string, string | string[] | undefined> },
    reply: { code(code: number): { send(body: unknown): unknown } }
  ): boolean {
    const token = bearerToken(req);
    const session = token ? sessions.get(token) : undefined;
    if (!session || session.expiresAt <= Date.now()) {
      if (token) sessions.delete(token);
      reply.code(401).send({ error: "invalid or expired admin session" });
      return false;
    }
    return true;
  }

  async function adminRoom(room: Room): Promise<AdminRoom> {
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      mode: room.mode,
      ttlSeconds: room.ttlSeconds,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
      messageCount: await store.countMessages(room.id),
      memberCount: hub.liveMembers?.(room.id) ?? 0,
    };
  }

  /* ---------- auth ---------- */

  app.post<{ Body: { password?: string } }>("/admin/login", async (req, reply) => {
    if (!adminPassword) {
      return reply.code(503).send({ error: "admin access is not configured — set ADMIN_PASSWORD on the server" });
    }
    const password = req.body?.password;
    if (typeof password !== "string" || !safeEqual(password, adminPassword)) {
      return reply.code(401).send({ error: "invalid password" });
    }
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
    return { token, expiresIn: SESSION_TTL_MS };
  });

  /* ---------- rooms ---------- */

  app.get("/admin/rooms", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rooms = await store.listRooms();
    return { rooms: await Promise.all(rooms.map((r) => adminRoom(r))) };
  });

  app.get<{ Params: { code: string }; Querystring: { limit?: string } }>(
    "/admin/rooms/:code/messages",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const room = await findLiveRoom(store, req.params.code);
      if (!room) return reply.code(404).send({ error: "room not found" });
      const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
      // Payloads are E2E ciphertext — the admin sees metadata (author, seq, ts)
      // plus the opaque bytes, never plaintext.
      return { messages: await store.listMessages(room.id, limit) };
    }
  );

  app.patch<{ Params: { code: string }; Body: { name?: string; mode?: RoomMode } }>(
    "/admin/rooms/:code",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const room = await findLiveRoom(store, req.params.code);
      if (!room) return reply.code(404).send({ error: "room not found" });
      const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 60) : undefined;
      const mode =
        req.body?.mode === "ephemeral" || req.body?.mode === "permanent" ? req.body.mode : undefined;
      if (name === undefined && mode === undefined) {
        return reply.code(400).send({ error: "provide name and/or mode" });
      }
      const updated = await store.updateRoom(room.id, { name, mode });
      hub.broadcastRoom?.(room.id, { type: "room.updated", room: publicRoom(updated) });
      return { room: publicRoom(updated) };
    }
  );

  app.delete<{ Params: { code: string } }>("/admin/rooms/:code", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const room = await findLiveRoom(store, req.params.code);
    if (!room) return reply.code(404).send({ error: "room not found" });
    await store.deleteRoom(room.id);
    // Kick everyone still connected out with a clear reason.
    hub.closeRoom?.(room.id, `Room ${room.code} was closed by an admin`);
    return { ok: true };
  });
};
