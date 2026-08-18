import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { RoomStore } from "./db/store.js";
import type { WsServerMessage } from "./types.js";
import { roomsPlugin } from "./rooms.js";
import { wsPlugin } from "./ws.js";
import { adminPlugin } from "./admin.js";

export type BuildAppOptions = {
  store: RoomStore;
  logger?: boolean;
  prefix?: string;
  /** Enables the /admin management API. Null (unset) disables it. */
  adminPassword?: string | null;
};

/**
 * Cross-plugin bridge: the WebSocket hub exposes hooks that the HTTP layer
 * uses to push updates to connected clients — room metadata changes (PATCH),
 * live member counts (admin API) and forced closes (admin room deletion).
 * Decorated at the root so both plugins can see it.
 */
export type ConduitHub = {
  broadcastRoom: (roomId: string, msg: WsServerMessage) => void;
  /** Number of members currently connected to a room's WebSocket hub. */
  liveMembers: (roomId: string) => number;
  /** Tells a room's connected members it was closed (e.g. admin deletion). */
  closeRoom: (roomId: string, message: string) => void;
};

/** Builds a configured Fastify instance. Call `listen()` or `inject()` on it. */
export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  app.register(cors, { origin: true });
  app.register(websocket);
  const hub: Partial<ConduitHub> = {};
  app.decorate("conduitHub", hub);
  app.register(roomsPlugin, { store: opts.store, prefix: opts.prefix });
  app.register(wsPlugin, { store: opts.store, prefix: opts.prefix });
  app.register(adminPlugin, { store: opts.store, adminPassword: opts.adminPassword ?? null, hub, prefix: opts.prefix });

  app.get("/health", async () => ({
    ok: true,
    service: "conduit",
    uptime: process.uptime(),
    ts: new Date().toISOString(),
  }));

  return app;
}
