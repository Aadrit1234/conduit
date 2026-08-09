# Conduit — Technical Specification & Architectural Blueprint

Real-time web application where users create temporary or permanent **rooms** and collaborate by
sharing files, folders and data while chatting in real time.

---

## 1. Tech Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Frontend | React 19 + Vite + TypeScript, Zustand, Framer Motion | Mature ecosystem, first-class HMR, tiny runtime; Zustand for predictable room state; Framer Motion for the animated product surface |
| 3D / visuals | Three.js via `@react-three/fiber` + `@react-three/drei` | Declarative WebGL; used for the animated hero and future data visualization inside rooms |
| Real-time signaling & chat | WebSocket (Socket.IO or `ws`) | Bidirectional, ordered, low-latency fan-out for chat, presence, typing indicators and file announcements |
| P2P file transfer | WebRTC DataChannel (mesh topology) | Files never touch our servers when peers can connect directly; chunks are encrypted before leaving the browser |
| Edge relay | TURN (e.g. coturn) + TUS resumable uploads | NAT traversal fallback for peers that can't establish direct connections; resumable chunked uploads for the cloud path |
| Backend | Node.js + Fastify, TypeScript, Redis + BullMQ | Event-loop-friendly for WebSocket fan-out; Redis Pub/Sub for horizontal gateway scaling; queues for transcoding/previews/cleanup |
| Database | PostgreSQL (+ Redis, S3/R2 object storage) | Relational metadata with strong integrity; Redis for ephemeral presence; object storage for file blobs |
| Real-time collaboration data | Yjs (CRDT) | Live cursors, shared structured data and conflict-free edits with zero server state |

**Why this split:** chat is tiny and latency-sensitive → WebSocket. Files are large and
bandwidth-heavy → WebRTC P2P with a cloud fallback. Structured collaboration data benefits from
CRDTs so peers never block on each other.

---

## 2. Core Features & User Flow

1. **Create a room** — one click generates a short code (`KX-7F2A`). Choose *ephemeral* (burns
   when empty / after TTL) or *permanent* (pinned to a workspace).
2. **Share the code** — any link or code opens the room; no signup required for ephemeral rooms.
3. **Drop files & folders** — drag into the room; the client hashes, encrypts and shards content,
   announces metadata over the WebSocket, and peers fetch chunks P2P (or via relay).
4. **Chat alongside content** — messages and file events share one ordered timeline; presence,
   typing indicators and read receipts ride the same socket.
5. **Live data** — shared cursors, boards or dashboards via CRDT broadcast.
6. **Leave or burn** — ephemeral rooms delete the encrypted key-blob at TTL; permanent rooms
   persist with access control.

---

## 3. Data Schema & Architecture

### PostgreSQL

```sql
-- rooms
CREATE TABLE rooms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT UNIQUE NOT NULL,            -- KX-7F2A
  mode         TEXT NOT NULL CHECK (mode IN ('ephemeral','permanent')),
  owner_id     UUID REFERENCES users(id),
  ttl_seconds  INT,                              -- NULL for permanent
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,                      -- ephemeral destruction time
  key_blob     BYTEA NOT NULL                    -- encrypted room key (zero-knowledge)
);

-- users (only for permanent rooms)
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  TEXT NOT NULL,
  public_key    BYTEA NOT NULL,                  -- X25519 public key
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- membership + capabilities
CREATE TABLE room_members (
  room_id      UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id),
  role         TEXT NOT NULL DEFAULT 'member',   -- admin | member
  capabilities TEXT[] NOT NULL DEFAULT '{read,write}', -- read, write, admin
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

-- chat (metadata only — content is E2E encrypted)
CREATE TABLE messages (
  id         BIGSERIAL PRIMARY KEY,
  room_id    UUID REFERENCES rooms(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES users(id),
  seq        BIGINT NOT NULL,                    -- lamport/room sequence
  ciphertext BYTEA NOT NULL,
  nonce      BYTEA NOT NULL,
  ref_file   UUID REFERENCES files(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, seq)
);

-- file metadata (blobs live in object storage, encrypted)
CREATE TABLE files (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID REFERENCES rooms(id) ON DELETE CASCADE,
  parent_id  UUID REFERENCES files(id),          -- folders are files with kind='folder'
  kind       TEXT NOT NULL DEFAULT 'file',       -- file | folder
  name       TEXT NOT NULL,
  mimetype   TEXT,
  size       BIGINT,
  sha256     BYTEA,                              -- of ciphertext, for integrity
  storage    TEXT NOT NULL DEFAULT 'p2p',        -- p2p | relay | cloud
  upload_id  TEXT,                               -- TUS upload id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, parent_id, name)
);
```

### Redis
- `presence:{room_id}` — hash of member → socket, heartbeat TTL
- `pubsub:room:{room_id}` — cross-gateway fan-out channel
- `typing:{room_id}` — short-TTL typing indicators
- `relay:{upload_id}` — TUS chunk offsets for resumable cloud uploads

### Client state (Zustand)
`roomStore` holds `{ room, members, presence, messages, tree, transfers, capabilities }`.
The WebSocket is the source of truth for ordering (sequence numbers); local optimistic updates are
applied immediately and reconciled on ack. File trees are materialized client-side from
`file.announce` events so structure syncs without downloading payloads.

---

## 4. File Handling Strategy

1. **Hashing & encryption** — SHA-256 over plaintext, then AES-256-GCM encrypt with the room's
   per-file key (derived via HKDF from the room key + file id).
2. **Sharding** — files split into 1 MB chunks. Each chunk carries a chunk index; the manifest
   (chunk map + integrity hashes) is announced over WebSocket.
3. **Transfer path selection**
   - **P2P mesh (default):** peers exchange SDP/ICE through the signaling WebSocket, then pull
     chunks directly over DataChannels. Sender-role fairness via chunk scheduling.
   - **Edge relay fallback:** symmetric NAT or no-WebRTC clients get a TUS resumable upload to the
     relay; other peers pull from the relay, which never stores plaintext.
   - **Cloud overflow:** rooms that outlive their peers move blobs to S3/R2 with server-side
     encryption; only metadata and encrypted chunks are stored.
4. **Security at rest** — blobs stored encrypted; keys never leave the browser (see §5).
5. **Folders** — a folder is a `files` row with `kind='folder'`; the tree is synced by announcing
   child metadata, so structure, names and previews sync even before chunks arrive.

---

## 5. Security & Privacy

- **End-to-end encryption (chat + files).** Room key derived in-browser via
  `PBKDF2(passphrase, salt)` → HKDF → X25519 key exchange per member. Chat messages and file
  chunks are AES-256-GCM encrypted; the server stores only `key_blob` (encrypted with each
  member's public key), salt and public keys. **Zero knowledge**: a server compromise yields
  ciphertext only.
- **Access control.** Capability tokens (`read` / `write` / `admin`) issued by the room owner.
  Revocation rotates the room key and re-wraps the key-blob for remaining members, so a revoked
  peer can never decrypt new content.
- **Room expiration.** Ephemeral rooms carry a key-encryption deadline: at TTL the server
  destroys the encrypted key-blob, making history permanently undecryptable — even with a
  database leak. Permanent rooms keep the blob under capability control.
- **Transport.** TLS everywhere; WebRTC DTLS-SRTP (files use DataChannels with SCTP, not media).
- **Abuse & rate limiting.** Room creation rate-limited per IP, upload quotas per room,
  message size caps, and a burn-room endpoint.

> **Implemented in the demo** — chat payloads are genuinely E2E encrypted: `src/crypto/x25519.ts`
> (dependency-free X25519, validated against RFC 7748) + `src/crypto/e2ee.ts` (Web Crypto
> AES-256-GCM / HKDF). The first member to join generates a random 32-byte room key; each new
> member publishes an X25519 identity over the server's opaque `signal` relay and receives the
> key wrapped to their public key (`src/live/cryptoSession.ts`). **Key rotation is live**: when a
> member who exchanged keys leaves, the creator generates a fresh key generation and re-wraps it
> to every remaining member, so departed peers can't read new messages; the key chain keeps
> older generations decryptable for history. Payloads are `2:<gen>:<iv>:<ct>` ciphertext — the
> harness at `public/dev/e2ee-test.html` proves the server stores only ciphertext, late joiners
> decrypt history, and departed members are locked out of post-rotation messages.

```ts
// Key derivation (client-side, Web Crypto)
async function deriveRoomKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 310_000, hash: "SHA-256" }, base, 256);
  return crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
}
```

---

## 6. WebSocket protocol & room creation

```ts
// room/create.ts — API + socket handshake
export async function createRoom(mode: "ephemeral" | "permanent") {
  const code = nanoid(6).toUpperCase();          // KX-7F2A
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const roomKey = await deriveRoomKey(code, salt); // code doubles as passphrase for ephemeral

  const room = await api.post("/rooms", { code, mode, ttlMinutes: mode === "ephemeral" ? 240 : null });
  const ws = new WebSocket(`${WS_URL}/rooms/${room.id}?token=${room.token}`);

  ws.onopen = () => ws.send(JSON.stringify({ type: "room.join", role: "admin" }));
  return { room, roomKey, ws };
}
```

```ts
// gateway/ws.ts — message handling
ws.on("message", (raw) => {
  const msg = JSON.parse(raw);
  switch (msg.type) {
    case "chat.message":
      // verify capability 'write', attach lamport seq, fan out via Redis pub/sub
      redis.publish(`room:${msg.roomId}`, JSON.stringify({
        type: "chat.message", seq: nextSeq(msg.roomId), payload: msg.payload
      }));
      break;
    case "file.announce":
      broadcast({ type: "file.announce", meta: msg.meta }); // metadata only, no plaintext
      break;
    case "signal":
      forwardSignal(msg.to, msg.sdp); // WebRTC signaling (SDP/ICE)
      break;
  }
});
```

---

## 7. Implementation Roadmap

### Phase 1 — MVP (2–3 weeks)
Room create/join with codes · WebSocket chat + presence · drag-in file upload via relay ·
encrypted at-rest storage · ephemeral TTL deletion.

### Phase 2 — P2P & collaboration (3–4 weeks)
WebRTC DataChannel mesh with signaling · chunked resumable transfers (TUS) · folder sync +
live cursors (Yjs) · capability tokens & key rotation on revocation.

### Phase 3 — Scale & product (4–6 weeks)
Horizontal gateway fan-out (Redis pub/sub) · multi-region relay · permanent team workspaces ·
audit log & compliance export · previews/thumbnails pipeline (BullMQ).

---

## 8. Production concerns

- **Observability:** structured logs (pino), OpenTelemetry traces across gateway → Redis → DB,
  Grafana dashboards for room churn, socket count, P2P success rate.
- **Scaling:** gateways are stateless; Redis pub/sub fans out per room; object storage is the only
  durable blob store. WebRTC mesh capped at ~100 peers per room; above that, rooms fall back to
  relay/cloud transfer.
- **Cost control:** ephemeral rooms purge blobs at TTL; cloud overflow is opt-in per room.
