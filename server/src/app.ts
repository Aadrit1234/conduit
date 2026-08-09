import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { RoomStore } from "./db/store.js";
import type { WsServerMessage } from "./types.js";
import { roomsPlugin } from "./rooms.js";
import { wsPlugin } from "./ws.js";

export type BuildAppOptions = {
  store: RoomStore;
  logger?: boolean;
  prefix?: string;
};

/**
 * Cross-plugin bridge: the WebSocket hub exposes a broadcast hook that the
 * HTTP layer (room PATCH) uses to push room metadata updates to connected
 * clients. Decorated at the root so both plugins can see it.
 */
export type ConduitHub = {
  broadcastRoom: (roomId: string, msg: WsServerMessage) => void;
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

  app.get("/health", async () => ({
    ok: true,
    service: "conduit",
    uptime: process.uptime(),
    ts: new Date().toISOString(),
  }));

  return app;
}
