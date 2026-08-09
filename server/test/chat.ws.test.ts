import { test } from "node:test";
import assert from "node:assert/strict";
import { connectClient, startTestServer, type TestServer } from "./helpers.js";

let server: TestServer;

async function setup() {
  server = await startTestServer();
  await server.app.inject({ method: "POST", url: "/rooms", payload: { code: "WSTEST" } });
}

test.afterEach(async () => {
  await server?.close();
});

test("two clients join the same room and see presence + sequenced chat", async () => {
  await setup();
  const a = await connectClient(server.url, "WSTEST", "Ava");
  assert.equal(a.messages.find((m) => m.type === "room.joined")?.members.length, 1);

  const b = await connectClient(server.url, "WSTEST", "Ben");
  assert.equal(b.messages.find((m) => m.type === "room.joined")?.members.length, 2);

  // A sees B join.
  const join = await a.waitFor((m) => m.type === "presence.join");
  assert.equal(join.type, "presence.join");
  if (join.type === "presence.join") {
    assert.equal(join.name, "Ben");
    assert.equal(join.members.length, 2);
  }

  // A sends a message; both A and B receive it with seq 1.
  a.send({ type: "chat.message", payload: "hello from ava" });
  const atB = await b.waitFor((m) => m.type === "chat.message");
  assert.equal(atB.type, "chat.message");
  if (atB.type === "chat.message") {
    assert.equal(atB.payload, "hello from ava");
    assert.equal(atB.seq, 1);
    assert.equal(atB.from, a.peerId);
  }
  const atA = await a.waitFor((m) => m.type === "chat.message" && m.seq === 1);
  assert.equal(atA.type === "chat.message" && atA.payload, "hello from ava");

  // Second message gets the next sequence number.
  b.send({ type: "chat.message", payload: "yo ava" });
  const seq2 = await a.waitFor((m) => m.type === "chat.message" && m.seq === 2);
  assert.equal(seq2.type === "chat.message" && seq2.payload, "yo ava");

  a.close();
  b.close();
});

test("typing and file.announce are fanned out to peers only", async () => {
  await setup();
  const a = await connectClient(server.url, "WSTEST", "Ava");
  const b = await connectClient(server.url, "WSTEST", "Ben");

  a.send({ type: "typing", active: true });
  const typing = await b.waitFor((m) => m.type === "typing");
  assert.equal(typing.type, "typing");
  if (typing.type === "typing") {
    assert.equal(typing.active, true);
    assert.equal(typing.from, a.peerId);
  }
  assert.equal(a.messages.filter((m) => m.type === "typing").length, 0, "sender does not receive its own typing");

  a.send({ type: "file.announce", meta: { name: "spec-v3.pdf", size: 2400000 } });
  const announce = await b.waitFor((m) => m.type === "file.announce");
  assert.equal(announce.type, "file.announce");
  if (announce.type === "file.announce") {
    assert.equal(announce.meta.name, "spec-v3.pdf");
    assert.equal(announce.from, a.peerId);
  }

  a.close();
  b.close();
});

test("a leaving client broadcasts presence.leave with updated members", async () => {
  await setup();
  const a = await connectClient(server.url, "WSTEST", "Ava");
  const b = await connectClient(server.url, "WSTEST", "Ben");

  a.close();
  const leave = await b.waitFor((m) => m.type === "presence.leave");
  assert.equal(leave.type, "presence.leave");
  if (leave.type === "presence.leave") {
    assert.equal(leave.peerId, a.peerId);
    assert.equal(leave.members.length, 1);
  }
  b.close();
});

test("a late joiner receives persisted chat history", async () => {
  await setup();
  const a = await connectClient(server.url, "WSTEST", "Ava");
  a.send({ type: "chat.message", payload: "persist me" });
  await a.waitFor((m) => m.type === "chat.message" && m.seq === 1);
  a.close();

  const c = await connectClient(server.url, "WSTEST", "Cleo");
  const joined = c.messages.find((m) => m.type === "room.joined");
  assert.equal(joined?.type, "room.joined");
  if (joined?.type === "room.joined") {
    assert.equal(joined.history.length, 1);
    assert.equal(joined.history[0].payload, "persist me");
    assert.equal(joined.history[0].seq, 1);
  }
  c.close();
});

test("unknown message shapes get error responses", async () => {
  await setup();
  const a = await connectClient(server.url, "WSTEST", "Ava");
  a.send({ type: "nope" });
  const err = await a.waitFor((m) => m.type === "error");
  assert.equal(err.type, "error");
  if (err.type === "error") assert.match(err.message, /unknown message shape/);
  a.close();
});

test("roles: first member is admin, role.set is admin-only and broadcasts", async () => {
  await setup();
  const a = await connectClient(server.url, "WSTEST", "Ava");
  const b = await connectClient(server.url, "WSTEST", "Ben");

  const joinedA = a.messages.find((m) => m.type === "room.joined");
  assert.equal(joinedA?.type === "room.joined" && joinedA.members[0].role, "admin");
  const joinedB = b.messages.find((m) => m.type === "room.joined");
  if (joinedB?.type === "room.joined") {
    const ben = joinedB.members.find((m) => m.peerId === b.peerId);
    assert.equal(ben?.role, "member");
  }

  // Non-admin cannot change roles.
  b.send({ type: "role.set", peerId: a.peerId, role: "viewer" });
  const denied = await b.waitFor((m) => m.type === "error");
  assert.equal(denied.type, "error");
  if (denied.type === "error") assert.match(denied.message, /only admins/);

  // Admin demotes Ben to viewer; both see role.changed with the new members list.
  a.send({ type: "role.set", peerId: b.peerId, role: "viewer" });
  const changed = await b.waitFor((m) => m.type === "role.changed");
  assert.equal(changed.type, "role.changed");
  if (changed.type === "role.changed") {
    assert.equal(changed.peerId, b.peerId);
    assert.equal(changed.role, "viewer");
    assert.equal(changed.members.find((m) => m.peerId === b.peerId)?.role, "viewer");
  }

  // Admins can't demote themselves.
  a.send({ type: "role.set", peerId: a.peerId, role: "member" });
  const selfDenied = await a.waitFor((m) => m.type === "error");
  assert.equal(selfDenied.type, "error");
  if (selfDenied.type === "error") assert.match(selfDenied.message, /demote themselves/);

  a.close();
  b.close();
});

test("roles: viewers are read-only (chat, typing, file.announce rejected)", async () => {
  await setup();
  const a = await connectClient(server.url, "WSTEST", "Ava");
  const b = await connectClient(server.url, "WSTEST", "Ben");
  a.send({ type: "role.set", peerId: b.peerId, role: "viewer" });
  await b.waitFor((m) => m.type === "role.changed");

  b.send({ type: "chat.message", payload: "should be blocked" });
  const err = await b.waitFor((m) => m.type === "error");
  assert.equal(err.type, "error");
  if (err.type === "error") assert.match(err.message, /read-only/);
  assert.equal(b.messages.filter((m) => m.type === "chat.message").length, 0, "viewer message never persisted");

  b.send({ type: "typing", active: true });
  b.send({ type: "file.announce", meta: { name: "x" } });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(b.messages.filter((m) => m.type === "typing").length, 0);
  assert.equal(b.messages.filter((m) => m.type === "file.announce").length, 0);

  // Admins can still send.
  a.send({ type: "chat.message", payload: "admin still works" });
  const ok = await b.waitFor((m) => m.type === "chat.message");
  assert.equal(ok.type === "chat.message" && ok.payload, "admin still works");

  a.close();
  b.close();
});

test("room.updated is broadcast to connected clients after a PATCH", async () => {
  await setup();
  const created = await server.app.inject({ method: "POST", url: "/rooms", payload: { code: "RENAMED" } });
  const { adminToken } = created.json();
  const a = await connectClient(server.url, "RENAMED", "Ava");
  const b = await connectClient(server.url, "RENAMED", "Ben");

  await server.app.inject({
    method: "PATCH",
    url: "/rooms/RENAMED",
    payload: { adminToken, name: "Renamed Room", mode: "permanent" },
  });

  const updated = await b.waitFor((m) => m.type === "room.updated");
  assert.equal(updated.type, "room.updated");
  if (updated.type === "room.updated") {
    assert.equal(updated.room.name, "Renamed Room");
    assert.equal(updated.room.mode, "permanent");
  }
  await a.waitFor((m) => m.type === "room.updated");
  b.close();
  a.close();
});

test("connecting to an unknown room is rejected", async () => {
  await setup();
  await assert.rejects(
    () => connectClient(server.url, "NOPE99", "Ghost", 4000),
    /timed out waiting for room\.joined|connect ECONNREFUSED|room not found/
  );
});

test("leave-vs-burn: an empty ephemeral room is destroyed immediately", async () => {
  server = await startTestServer();
  const created = await server.app.inject({ method: "POST", url: "/rooms", payload: { code: "BURNWS" } });
  assert.equal(created.statusCode, 201);
  const code = created.json().room.code;

  const a = await connectClient(server.url, code, "Ava");
  const b = await connectClient(server.url, code, "Ben");
  a.close();
  await b.waitFor((m) => m.type === "presence.leave");

  // Still alive while a member is connected.
  const alive = await server.app.inject({ method: "GET", url: `/rooms/${code}` });
  assert.equal(alive.statusCode, 200);

  // The last member leaving burns the room now — no TTL wait.
  b.close();
  await new Promise((r) => setTimeout(r, 100));
  const gone = await server.app.inject({ method: "GET", url: `/rooms/${code}` });
  assert.equal(gone.statusCode, 404);
  assert.equal(await server.store.getRoomByCode(code), null, "room was deleted from the store");
});

test("leave-vs-burn: a burned room cannot be rejoined", async () => {
  server = await startTestServer();
  const created = await server.app.inject({ method: "POST", url: "/rooms", payload: { code: "BURNJN" } });
  const code = created.json().room.code;
  const a = await connectClient(server.url, code, "Ava");
  a.close();
  await new Promise((r) => setTimeout(r, 100));

  await assert.rejects(
    () => connectClient(server.url, code, "Ghost", 800),
    /timed out waiting for room\.joined|room not found/
  );
});

test("leave-vs-burn: permanent rooms survive an empty room and stay joinable", async () => {
  server = await startTestServer();
  const created = await server.app.inject({
    method: "POST",
    url: "/rooms",
    payload: { code: "KEEPWS", mode: "permanent" },
  });
  const code = created.json().room.code;

  const a = await connectClient(server.url, code, "Ava");
  a.close();
  await new Promise((r) => setTimeout(r, 100));

  const alive = await server.app.inject({ method: "GET", url: `/rooms/${code}` });
  assert.equal(alive.statusCode, 200);

  // A new member can still join after the room sat empty.
  const b = await connectClient(server.url, code, "Ben");
  const joined = b.messages.find((m) => m.type === "room.joined");
  assert.equal(joined?.type === "room.joined" && joined.members.length, 1);
  assert.equal((await server.store.getRoomByCode(code))?.mode, "permanent");
  b.close();
});
