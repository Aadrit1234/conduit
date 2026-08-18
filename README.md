# Conduit

Real-time rooms where teams share files, folders and data while they chat — end-to-end encrypted, ephemeral or permanent.

This repository contains the **product frontend + real-time backend**. The frontend is a
deployable SPA: landing site + real rooms (server-backed chat, end-to-end encryption, WebRTC
peer-to-peer file transfer). The full technical specification lives in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Stack

- **Vite 8 + React 19 + TypeScript**
- **Three.js** via `@react-three/fiber` + `@react-three/drei` — animated 3D hero (morphing core, particle network, data rings, mouse parallax)
- **Framer Motion** — scroll reveals, magnetic buttons, 3D tilt cards, page transitions, animated counters
- **Lucide** icons throughout (no emojis)
- **Theme system** — dark/light via CSS variables, persisted toggle (nav + room), system-preference fallback, theme-aware 3D scene

## Getting started

```bash
npm install
npm run dev      # dev server → http://localhost:5173
npm run build    # typecheck + production build
npm run preview  # serve the production build
```

## What's here

| Area | Description |
| --- | --- |
| `src/components/` | Landing sections (hero, features, security, architecture, roadmap) + the room app |
| `src/three/` | WebGL scene — morphing core blob, particle field, streaming rings, floating room nodes |
| `src/live/` | Backend client: REST (rooms), WebSocket protocol, E2EE session |
| `src/crypto/` | X25519 (pure JS) + Web Crypto AES-256-GCM / HKDF |
| `src/webrtc/` | Peer-to-peer mesh: server-relay signaling (cross-device), chunked SHA-256-verified transfers |
| `docs/ARCHITECTURE.md` | Full technical spec: stack, data schema, file handling, security model, implementation roadmap |

**Routing** — real paths via React Router: `/` (landing), `/room` (create/join), `/room/:code`
(auto-join, refresh-safe, shareable). Creating a room updates the URL to `/room/CODE` so the
link is the invite.

## Real WebRTC peer-to-peer transfers

Files you drop in a room travel **peer-to-peer over WebRTC DataChannels** between any two
members — two tabs, two devices, two networks. Signaling rides the server's opaque `signal`
relay (the server forwards it without ever inspecting it), so peers discover each other across
devices and browsers; each member is a node in a full mesh, and every transfer is chunked,
SHA-256-verified, and backpressure-buffered.

For large files on the public internet, add a TURN relay so peers behind restrictive NATs and
firewalls can still connect — set `VITE_ICE_SERVERS` (a JSON array of `RTCIceServer`) at build
time, e.g. a free Metered/Twilio account or your own coturn server:

```
VITE_ICE_SERVERS=[{"urls":"turn:relay.metered.ca:80","username":"u","credential":"p"}]
```

Unset, the app falls back to public STUN — fine for most NATs, but large cross-network files
are much more reliable with TURN. There are no upload limits: transfer speed is whatever the
peers' connections allow, and the server's disk is never touched.

To try it locally:

1. Create a room at `http://localhost:5173/room`, then open the resulting `/room/CODE` link in a second tab.
2. Wait for the topbar to read `mesh · 1 peer`, then drop a file — or a whole folder,
   which arrives with its structure intact — in either tab. It appears in the other tab's
   file tree, verified by hash, with a download button.

No peers connected? The drop shows a "no peers connected" hint instead — real transfers need
another member on the same room code.

## Live rooms over the real backend

The room is a real client of the Conduit server — no simulated peers:

1. `npm run server` — starts the backend on `http://localhost:8787` (defaults to the in-memory store).
2. `npm run dev` — Vite proxies `/rooms`, `/health` and `/ws` to the backend (override the target with `CONDUIT_SERVER`).

Create a room from the app and it issues `POST /rooms` (the URL becomes `/room/CODE`); chat
messages are broadcast over the WebSocket with server-assigned `seq` ordering, and a second
tab joining the same link receives `room.joined` with the same history, live presence, and
typing indicators. Reload the page and the history comes back from the server (and decrypts
via the persisted room key).

A quick diagnostic of the whole client → server flow (create, join, chat echo, presence,
history, typing) lives at `/dev/live-test.html`.

## End-to-end encryption (chat)

Chat payloads are genuinely encrypted in the browser — the server never sees plaintext.

- **Key agreement:** the first member to join generates a random 32-byte room key. Every member
  publishes an X25519 public key over the server's opaque `signal` relay and receives the room
  key wrapped to their key (`AES-256-GCM` under `HKDF(ECDH(me, peer))`). Anyone holding the key
  can re-wrap it for a newcomer, so late joiners get history.
- **Per message:** `AES-256-GCM` with a fresh 96-bit IV; wire format is `2:<gen>:<iv>:<ct>`
  (generation-tagged), so the server persists and fans out ciphertext only. Tampered payloads
  fail GCM authentication.
- **Key rotation:** when a member who exchanged keys leaves, the creator rotates — a fresh key
  generation is wrapped to every remaining member, so the departed peer can't read anything
  sent after they left. Older generations stay in the per-tab chain, so history remains
  decryptable (pre-rotation `1:` payloads decrypt with generation 1).
- **Identity & keys** persist per tab (sessionStorage), so a reload in the same tab keeps its
  keys and can decrypt history without re-exchanging.
- **Implementation:** `src/crypto/x25519.ts` (dependency-free X25519, RFC 7748-validated),
  `src/crypto/e2ee.ts` (Web Crypto primitives), `src/live/cryptoSession.ts` (key exchange
  protocol). The E2EE badge in the room shows key state: `E2EE · ready`, `keys…`, or the static
  badge in simulated mode.

The `/dev/e2ee-test.html` harness proves the whole thing against the live server: RFC 7748
vectors, three-client key exchange through the relay, cross-client decryption, ciphertext-only
at rest, late-joiner history decryption, and GCM tamper rejection.

### `?selftest=1`

Runs a standalone diagnostic that probes raw WebRTC capability, then exercises the real
mesh + transfer pipeline (two loopback peer connections, transfers in both directions).
Useful to verify the WebRTC stack in a given browser/context.

## Deployment

The whole stack ships as containers — frontend (nginx) + backend (Fastify) + Postgres:

```bash
docker compose up --build
# frontend  → http://localhost:8080
# backend   → http://localhost:8787
# postgres  → internal only (uncomment DATABASE_URL in docker-compose.yml for persistence)
```

Startup order is enforced: Postgres healthy → `db-init` applies `server/src/db/schema.sql`
(idempotent) → backend starts → frontend waits on the backend healthcheck. The nginx config
(`deploy/nginx.conf`) serves the built SPA with `/room/:code` fallback and proxies `/rooms`,
`/health` and `/ws` (with upgrade headers) to the backend, so the default build is
same-origin. For a different-origin API, build with `--build-arg VITE_API_BASE=…`
(see `.env.example`); the backend already sends CORS headers. Static assets are fingerprinted
and cached immutably.

### Build pipeline

`make verify` runs the whole pipeline locally, no Docker needed:

```bash
make verify          # server tests → lint → frontend build (tsc + vite) → backend build → prod smoke
```

Docker targets:

```bash
make images          # docker build frontend + backend
make up              # docker compose up --build -d
make down            # docker compose down
make push            # tag + push images to $REGISTRY (e.g. ghcr.io/<org>/conduit-*)
make deploy          # pull + up on a remote host over SSH ($SSH_HOST, $DEPLOY_DIR)
```

CI/CD: `.github/workflows/ci.yml` runs the same stages on every push/PR, builds and pushes
images to GHCR on `main`/tags, and has a manual `workflow_dispatch` deploy job over SSH.
Deploying prebuilt images instead of building on the host:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
# override images with CONDUIT_FRONTEND_IMAGE / CONDUIT_BACKEND_IMAGE
```

> Requires Docker Compose ≥ 2.24 (the prod override uses the `!reset` tag) and Docker ≥ 24.

Local production check (no Docker):

```bash
npm run build && npm run preview
```

## Backend (`server/`)

Fastify + WebSocket API for rooms and real-time chat — room creation, join codes,
chat broadcast with per-room sequence numbers, presence, typing, and a relay for file
announcements and WebRTC signaling. The PostgreSQL schema in
[`server/src/db/schema.sql`](server/src/db/schema.sql) mirrors the blueprint in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```bash
npm run server          # dev (tsx watch) — defaults to an in-memory store
npm run server:test     # HTTP + WebSocket integration tests
```

Set `DATABASE_URL` (see [`server/.env.example`](server/.env.example)) and apply the schema
for persistence:

```bash
psql "$DATABASE_URL" -f server/src/db/schema.sql
```

Without `DATABASE_URL` the server runs on an in-memory store (data lost on restart), so
you can develop without Postgres.

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/rooms` | Create a room (`mode: ephemeral\|permanent`, optional `ttlMinutes`) → `{ room, adminToken, wsUrl }` |
| `GET` | `/rooms/:code` | Room info by join code |
| `POST` | `/rooms/:code/join` | Join → `{ room, wsUrl }` |
| `PATCH` | `/rooms/:code` | Rename / toggle ephemeral↔permanent (requires `adminToken`) → broadcasts `room.updated` |
| `GET` | `/rooms/:code/messages` | Persisted chat history (seq order) |
| `DELETE` | `/rooms/:code` | Burn the room (requires `adminToken`) |
| `WS` | `/ws/rooms/:code?name=` | Join the live room |

### WebSocket protocol

Client → server: `chat.message` (payload is opaque — ciphertext in the real product),
`typing`, `file.announce`, `signal` (WebRTC signaling relay), `role.set` (admin-gated),
`room.leave`.
Server → client: `room.joined` (with members + roles + history), `presence.join/leave`,
`room.updated` (rename/mode), `role.changed`, `chat.message` (with monotonically increasing
`seq`), `typing`, `file.announce`, `signal`.
Messages are persisted before fan-out, so broadcast order always matches history order.

The first member of a room is its **admin**; admins can promote/demote members (`admin`,
`member`, `viewer`) via `role.set`. **Viewers are read-only** — chat, typing and file
announcements are rejected server-side. Room metadata (name, mode) changes via `PATCH` are
fanned out to every connected client.

**Leave-vs-burn.** When the last member of an *ephemeral* room disconnects, the server
destroys the room immediately instead of waiting for the TTL sweep — its code, history and
keys are gone. *Permanent* rooms survive an empty room and stay joinable by code. A
room whose mode was toggled via `PATCH` honors the latest mode, and a join that races a
last-member leave is rejected rather than attached to a dead room.

The hub is single-process today; horizontal gateway fan-out via Redis pub/sub is Phase 3
in `docs/ARCHITECTURE.md` — `server/src/ws.ts` is the seam that swaps in.
