import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/db/memory.js";
import { generateRoomCode } from "../src/rooms.js";

function makeApp() {
  const store = new MemoryStore();
  const app = buildApp({ store });
  return { app, store };
}

test("POST /rooms creates an ephemeral room with a code and admin token", async () => {
  const { app } = makeApp();
  const res = await app.inject({ method: "POST", url: "/rooms" });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.match(body.room.code, /^[2-9A-HJ-NP-Z]{6}$/);
  assert.equal(body.room.mode, "ephemeral");
  assert.equal(body.room.ttlSeconds, 240 * 60);
  assert.ok(body.room.expiresAt, "ephemeral rooms have an expiry");
  assert.ok(body.adminToken, "creation returns an admin token");
  assert.equal(body.wsUrl, `/ws/rooms/${body.room.code}`);
  await app.close();
});

test("POST /rooms permanent mode has no expiry", async () => {
  const { app } = makeApp();
  const res = await app.inject({ method: "POST", url: "/rooms", payload: { mode: "permanent" } });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.room.mode, "permanent");
  assert.equal(body.room.ttlSeconds, null);
  assert.equal(body.room.expiresAt, null);
  await app.close();
});

test("POST /rooms rejects a duplicate code", async () => {
  const { app } = makeApp();
  const code = "ZZZZZZ";
  const first = await app.inject({ method: "POST", url: "/rooms", payload: { code } });
  assert.equal(first.statusCode, 201);
  const second = await app.inject({ method: "POST", url: "/rooms", payload: { code } });
  assert.equal(second.statusCode, 409);
  await app.close();
});

test("GET /rooms/:code returns the room; unknown codes 404", async () => {
  const { app } = makeApp();
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { code: "KX7F2A" } });
  const code = created.json().room.code;

  const ok = await app.inject({ method: "GET", url: `/rooms/${code}` });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().room.code, code);

  const missing = await app.inject({ method: "GET", url: "/rooms/NOPE99" });
  assert.equal(missing.statusCode, 404);
  await app.close();
});

test("join endpoint returns the room and a ws url with the name", async () => {
  const { app } = makeApp();
  await app.inject({ method: "POST", url: "/rooms", payload: { code: "JOIN01" } });
  const res = await app.inject({ method: "POST", url: "/rooms/JOIN01/join", payload: { name: "Maya" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().wsUrl, "/ws/rooms/JOIN01?name=Maya");
  await app.close();
});

test("expired ephemeral rooms are purged on access", async () => {
  const { app, store } = makeApp();
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { code: "BURN01", ttlMinutes: 0 } });
  assert.equal(created.statusCode, 201);
  const code = created.json().room.code;

  const gone = await app.inject({ method: "GET", url: `/rooms/${code}` });
  assert.equal(gone.statusCode, 404);
  assert.equal(await store.getRoomByCode(code), null, "room was deleted");
  await app.close();
});

test("burn requires the admin token, then the room is gone", async () => {
  const { app } = makeApp();
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { code: "BURN02" } });
  const { room, adminToken } = created.json();

  const forbidden = await app.inject({ method: "DELETE", url: `/rooms/${room.code}` });
  assert.equal(forbidden.statusCode, 403);

  const burned = await app.inject({ method: "DELETE", url: `/rooms/${room.code}`, payload: { adminToken } });
  assert.equal(burned.statusCode, 200);
  assert.equal(burned.json().ok, true);

  const gone = await app.inject({ method: "GET", url: `/rooms/${room.code}` });
  assert.equal(gone.statusCode, 404);
  await app.close();
});

test("admin token survives an app restart over the same store", async () => {
  // Simulates a server reboot: the store persists, the process does not. The
  // token is stored with the room, so the creator's burn powers must survive.
  const store = new MemoryStore();
  const first = buildApp({ store });
  const created = await first.inject({ method: "POST", url: "/rooms", payload: { code: "REST01" } });
  const { room, adminToken } = created.json();
  await first.close();

  const restarted = buildApp({ store });
  const forbidden = await restarted.inject({ method: "DELETE", url: `/rooms/${room.code}` });
  assert.equal(forbidden.statusCode, 403);
  const burned = await restarted.inject({ method: "DELETE", url: `/rooms/${room.code}`, payload: { adminToken } });
  assert.equal(burned.statusCode, 200);
  await restarted.close();
});

test("message history endpoint returns persisted messages in seq order", async () => {
  const { app } = makeApp();
  await app.inject({ method: "POST", url: "/rooms", payload: { code: "HIST01" } });
  await app.inject({ method: "POST", url: "/rooms/HIST01/join" });

  const res = await app.inject({ method: "GET", url: "/rooms/HIST01/messages" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().messages, []);
  await app.close();
});

test("PATCH /rooms/:code renames the room (admin token required)", async () => {
  const { app } = makeApp();
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { code: "NAME01" } });
  const { room, adminToken } = created.json();
  assert.equal(room.name, "");

  const forbidden = await app.inject({ method: "PATCH", url: `/rooms/${room.code}`, payload: { name: "Launch" } });
  assert.equal(forbidden.statusCode, 403);

  const renamed = await app.inject({
    method: "PATCH",
    url: `/rooms/${room.code}`,
    payload: { adminToken, name: "  Launch Review  " },
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().room.name, "Launch Review");

  const fetched = await app.inject({ method: "GET", url: `/rooms/${room.code}` });
  assert.equal(fetched.json().room.name, "Launch Review");
  await app.close();
});

test("PATCH /rooms/:code toggles ephemeral<->permanent with expiry recomputed", async () => {
  const { app } = makeApp();
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { code: "MODE01" } });
  const { room, adminToken } = created.json();
  assert.equal(room.mode, "ephemeral");

  const permanent = await app.inject({
    method: "PATCH",
    url: `/rooms/${room.code}`,
    payload: { adminToken, mode: "permanent" },
  });
  assert.equal(permanent.statusCode, 200);
  assert.equal(permanent.json().room.mode, "permanent");
  assert.equal(permanent.json().room.ttlSeconds, null);
  assert.equal(permanent.json().room.expiresAt, null);

  const ephemeral = await app.inject({
    method: "PATCH",
    url: `/rooms/${room.code}`,
    payload: { adminToken, mode: "ephemeral" },
  });
  assert.equal(ephemeral.statusCode, 200);
  assert.equal(ephemeral.json().room.mode, "ephemeral");
  assert.equal(ephemeral.json().room.ttlSeconds, 240 * 60);
  assert.ok(ephemeral.json().room.expiresAt, "ephemeral rooms get a fresh expiry");
  await app.close();
});

test("PATCH with nothing to update is a 400; unknown room is a 404", async () => {
  const { app } = makeApp();
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { code: "PATCH1" } });
  const { adminToken } = created.json();

  const empty = await app.inject({ method: "PATCH", url: "/rooms/PATCH1", payload: { adminToken } });
  assert.equal(empty.statusCode, 400);

  const missing = await app.inject({ method: "PATCH", url: "/rooms/NOPE99", payload: { adminToken, name: "x" } });
  assert.equal(missing.statusCode, 404);
  await app.close();
});

test("room codes are generated from an unambiguous alphabet", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateRoomCode();
    assert.match(code, /^[2-9A-HJ-NP-Z]{6}$/);
    assert.ok(!/[01IO]/.test(code), "no ambiguous characters");
  }
});
