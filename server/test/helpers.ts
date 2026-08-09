import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/db/memory.js";
import type { WsServerMessage } from "../src/types.js";

export type TestServer = {
  app: FastifyInstance;
  store: MemoryStore;
  url: string;
  close: () => Promise<void>;
};

export async function startTestServer(): Promise<TestServer> {
  const store = new MemoryStore();
  const app = buildApp({ store });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    app,
    store,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await app.close();
    },
  };
}

export type TestClient = {
  peerId: string;
  messages: WsServerMessage[];
  joined: () => Promise<WsServerMessage & { type: "room.joined" }>;
  waitFor: (pred: (m: WsServerMessage) => boolean, timeoutMs?: number) => Promise<WsServerMessage>;
  send: (msg: unknown) => void;
  close: () => void;
};

/** Connects a ws client, resolves once `room.joined` arrives. */
export function connectClient(baseUrl: string, roomCode: string, name?: string, joinTimeoutMs = 5000): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const url = `${baseUrl.replace("http", "ws")}/ws/rooms/${roomCode}${name ? `?name=${encodeURIComponent(name)}` : ""}`;
    const ws = new WebSocket(url);
    const messages: WsServerMessage[] = [];
    const waiters: Array<{ pred: (m: WsServerMessage) => boolean; resolve: (m: WsServerMessage) => void; timer: NodeJS.Timeout }> = [];

    function push(msg: WsServerMessage) {
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(msg)) {
          const w = waiters.splice(i, 1)[0];
          clearTimeout(w.timer);
          w.resolve(msg);
        }
      }
    }

    ws.on("open", () => {});
    ws.on("message", (data) => {
      try {
        push(JSON.parse(data.toString()) as WsServerMessage);
      } catch {
        /* ignore malformed frames in tests */
      }
    });
    ws.on("error", reject);

    const client: TestClient = {
      peerId: "",
      messages,
      joined: () =>
        new Promise((res, rej) => {
          const existing = messages.find((m) => m.type === "room.joined");
          if (existing) return res(existing as never);
          const timer = setTimeout(() => rej(new Error("timed out waiting for room.joined")), joinTimeoutMs);
          waiters.push({ pred: (m) => m.type === "room.joined", resolve: res as never, timer });
        }),
      waitFor: (pred, timeoutMs = 5000) =>
        new Promise((res, rej) => {
          const existing = messages.find(pred);
          if (existing) return res(existing);
          const timer = setTimeout(() => rej(new Error("timed out waiting for message")), timeoutMs);
          waiters.push({ pred, resolve: res, timer });
        }),
      send: (msg) => ws.send(JSON.stringify(msg)),
      close: () => ws.close(),
    };

    client.joined().then((joined) => {
      client.peerId = joined.peerId;
      resolve(client);
    }, reject);
  });
}
