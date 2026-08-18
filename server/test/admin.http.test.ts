import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/db/memory.js";
import { connectClient, startTestServer } from "./helpers.js";

const PASSWORD = "correct horse battery staple";

function makeApp(password: string | null = PASSWORD) {
  const store = new MemoryStore();
  const app = buildApp({ store, adminPassword: password });
  return { app, store };
}

async function login(app: ReturnType<typeof makeApp>["app"], password = PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/admin/login", payload: { password } });
  assert.equal(res.statusCode, 200);
  return res.json().token as string;
}

test("CORS preflight allows the admin methods (DELETE/PATCH) cross-origin", async () => {
  const { app } = makeApp();
  // A frontend on another origin (e.g. Vercel -> Render) triggers a preflight
  // for DELETE/PATCH. Without DELETE/PATCH in allow-methods the browser blocks
  // the actual request with "Failed to fetch".
  const headers = {
    origin: "https://conduit.example.com",
    "access-control-request-method": "DELETE",
    "access-control-request-headers": "authorization",
  };
  const preflight = await app.inject({ method: "OPTIONS", url: "/admin/rooms/ABC123", headers });
  assert.equal(preflight.statusCode, 204);
  const methods = preflight.headers["access-control-allow-methods"] ?? "";
  assert.match(methods, /DELETE/);
  assert.match(methods, /PATCH/);
  assert.equal(preflight.headers["access-control-allow-origin"], "https://conduit.example.com");
  await app.close();
});

test("admin API is disabled when ADMIN_PASSWORD is not configured", async () => {
  const { app } = makeApp(null);
  const res = await app.inject({ method: "POST", url: "/admin/login", payload: { password: "x" } });
  assert.equal(res.statusCode, 503);
  const rooms = await app.inject({ method: "GET", url: "/admin/rooms" });
  assert.equal(rooms.statusCode, 401, "unauthenticated admin requests still 401");
  await app.close();
});

test("admin login rejects wrong passwords and returns a bearer token for the right one", async () => {
  const { app } = makeApp();
  const bad = await app.inject({ method: "POST", url: "/admin/login", payload: { password: "nope" } });
  assert.equal(bad.statusCode, 401);
  const ok = await app.inject({ method: "POST", url: "/admin/login", payload: { password: PASSWORD } });
  assert.equal(ok.statusCode, 200);
  const body = ok.json();
  assert.ok(typeof body.token === "string" && body.token.length >= 32);
  assert.ok(body.expiresIn > 0);
  await app.close();
});

test("admin room listing requires a valid session and reports counts", async () => {
  const { app } = makeApp();
  // seed two rooms, one with a persisted message
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { code: "ADM01A" } });
  assert.equal(created.statusCode, 201);
  await app.inject({ method: "POST", url: "/rooms", payload: { code: "ADM01B", mode: "permanent" } });
  await app.inject({ method: "POST", url: "/rooms/ADM01A/join" });

  const unauthorized = await app.inject({ method: "GET", url: "/admin/rooms" });
  assert.equal(unauthorized.statusCode, 401);

  const token = await login(app);
  const res = await app.inject({ method: "GET", url: "/admin/rooms", headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 200);
  const { rooms } = res.json();
  assert.equal(rooms.length, 2);
  const byCode = Object.fromEntries(rooms.map((r: { code: string }) => [r.code, r]));
  assert.equal(byCode.ADM01A.mode, "ephemeral");
  assert.equal(byCode.ADM01B.mode, "permanent");
  assert.equal(byCode.ADM01B.expiresAt, null);
  assert.ok(byCode.ADM01A.createdAt, "listing includes createdAt");
  assert.equal(typeof byCode.ADM01A.messageCount, "number");
  assert.equal(typeof byCode.ADM01A.memberCount, "number");
  await app.close();
});

test("admin can rename a room and toggle its mode without the room admin token", async () => {
  const { app } = makeApp();
  await app.inject({ method: "POST", url: "/rooms", payload: { code: "ADM02A" } });
  const token = await login(app);
  const auth = { authorization: `Bearer ${token}` };

  const renamed = await app.inject({
    method: "PATCH",
    url: "/admin/rooms/ADM02A",
    payload: { name: "Ops Room", mode: "permanent" },
    headers: auth,
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().room.name, "Ops Room");
  assert.equal(renamed.json().room.mode, "permanent");

  const empty = await app.inject({ method: "PATCH", url: "/admin/rooms/ADM02A", payload: {}, headers: auth });
  assert.equal(empty.statusCode, 400);
  const missing = await app.inject({ method: "PATCH", url: "/admin/rooms/NOPE99", payload: { name: "x" }, headers: auth });
  assert.equal(missing.statusCode, 404);
  await app.close();
});

test("admin can burn a room without the room admin token", async () => {
  const { app } = makeApp();
  await app.inject({ method: "POST", url: "/rooms", payload: { code: "ADM03A" } });
  const token = await login(app);
  const auth = { authorization: `Bearer ${token}` };

  const burned = await app.inject({ method: "DELETE", url: "/admin/rooms/ADM03A", headers: auth });
  assert.equal(burned.statusCode, 200);
  assert.equal(burned.json().ok, true);

  const gone = await app.inject({ method: "GET", url: "/rooms/ADM03A" });
  assert.equal(gone.statusCode, 404);
  await app.close();
});

test("connected members receive room.closed when an admin burns their room", async () => {
  const server = await startTestServer({ adminPassword: PASSWORD });
  try {
    await server.app.inject({ method: "POST", url: "/rooms", payload: { code: "ADM04A" } });
    const client = await connectClient(server.url, "ADM04A", "Maya");

    const token = await login(server.app);
    const burned = await server.app.inject({
      method: "DELETE",
      url: "/admin/rooms/ADM04A",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(burned.statusCode, 200);

    const closed = await client.waitFor((m) => m.type === "room.closed", 3000);
    assert.equal(closed.type, "room.closed");
    if (closed.type === "room.closed") assert.match(closed.message, /closed by an admin/);
    client.close();
  } finally {
    await server.close();
  }
});
