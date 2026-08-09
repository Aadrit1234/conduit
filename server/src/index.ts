import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./db/memory.js";
import { PostgresStore } from "./db/postgres.js";
import type { RoomStore } from "./db/store.js";

const config = loadConfig();

/**
 * Locates schema.sql relative to this entry file. Layouts:
 *   - `tsx src/index.ts`    -> ./db/schema.sql
 *   - `node dist/index.js`  -> ./db/schema.sql (the Dockerfile copies it into dist)
 */
function loadSchemaSql(): string | null {
  const candidates = [
    new URL("./db/schema.sql", import.meta.url), // tsx src/index.ts, or Docker dist/db/schema.sql
    new URL("../db/schema.sql", import.meta.url),
    new URL("../src/db/schema.sql", import.meta.url), // node dist/index.js, source tree present
  ];
  for (const url of candidates) {
    if (existsSync(url)) return readFileSync(url, "utf8");
  }
  return null;
}

async function makeStore(): Promise<{ store: RoomStore; close: () => Promise<void> }> {
  if (config.databaseUrl) {
    const store = new PostgresStore({ connectionString: config.databaseUrl });
    // Fail fast if the database is unreachable.
    await store.pool.query("SELECT 1");
    // Auto-migrate: the schema is idempotent (CREATE ... IF NOT EXISTS), so applying
    // it on every boot is safe and removes the manual psql step on managed Postgres
    // (Neon, Render, Railway, Fly).
    const schema = loadSchemaSql();
    if (!schema) throw new Error("DATABASE_URL is set but schema.sql was not found next to this entry file");
    await store.pool.query(schema);
    console.log("[conduit] PostgreSQL schema applied");
    return { store, close: () => store.close() };
  }
  console.warn(
    "[conduit] DATABASE_URL not set — using in-memory store. Data is lost on restart.\n" +
      "          Set DATABASE_URL for persistence (the schema is applied automatically on boot)."
  );
  const store = new MemoryStore();
  return { store, close: async () => {} };
}

const { store, close: closeStore } = await makeStore();
const app = buildApp({ store, logger: true });

// Ephemeral-room sweeper: purges expired rooms (and cascade-deletes their rows).
const sweeper = setInterval(() => {
  store.purgeExpired().then((ids) => {
    if (ids.length > 0) app.log.info({ rooms: ids.length }, "purged expired rooms");
  });
}, 60_000);
sweeper.unref();

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  clearInterval(sweeper);
  await app.close();
  await closeStore();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ port: config.port, url: `http://${config.host}:${config.port}` }, "conduit listening");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
