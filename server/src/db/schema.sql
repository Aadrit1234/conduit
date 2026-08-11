-- Conduit schema (mirrors docs/ARCHITECTURE.md §3)
-- Run: psql "$DATABASE_URL" -f server/src/db/schema.sql

-- gen_random_uuid() is core since PostgreSQL 13 (all managed providers run 13+),
-- so pgcrypto is deliberately not created here to avoid privilege failures on
-- restricted DB roles (Neon, Render, Railway).

-- Users: only needed for permanent rooms; ephemeral peers are anonymous tabs.
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  TEXT NOT NULL,
  public_key    BYTEA NOT NULL,                               -- X25519 public key
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rooms: ephemeral (burns on TTL / empty) or permanent (pinned to a workspace).
CREATE TABLE IF NOT EXISTS rooms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT UNIQUE NOT NULL,                          -- e.g. KX-7F2A
  name         TEXT NOT NULL DEFAULT '',                      -- display name (empty = the code)
  mode         TEXT NOT NULL CHECK (mode IN ('ephemeral','permanent')),
  owner_id     UUID REFERENCES users(id),
  admin_token  TEXT,                                          -- creator's burn/rename credential
  ttl_seconds  INT,                                           -- NULL for permanent
  key_blob     BYTEA NOT NULL DEFAULT ''::bytea,              -- encrypted room key (zero-knowledge)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ                                    -- ephemeral destruction time
);

-- Idempotent migration for databases created before admin_token existed.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS admin_token TEXT;

CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms (code);
CREATE INDEX IF NOT EXISTS idx_rooms_expires_at ON rooms (expires_at);

-- Membership + capabilities for permanent rooms.
CREATE TABLE IF NOT EXISTS room_members (
  room_id      UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id),
  role         TEXT NOT NULL DEFAULT 'member',                -- admin | member
  capabilities TEXT[] NOT NULL DEFAULT '{read,write}',       -- read, write, admin
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

-- Chat (metadata only — content is E2E encrypted; ciphertext is opaque here).
CREATE TABLE IF NOT EXISTS messages (
  id         BIGSERIAL PRIMARY KEY,
  room_id    UUID REFERENCES rooms(id) ON DELETE CASCADE,
  seq        BIGINT NOT NULL,                                 -- lamport/room sequence
  author     TEXT NOT NULL,                                   -- peer/tab id (or user id)
  ciphertext BYTEA NOT NULL,                                  -- encrypted payload bytes
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_messages_room_seq ON messages (room_id, seq);

-- File metadata (blobs live in object storage, encrypted; folders are kind='folder').
CREATE TABLE IF NOT EXISTS files (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID REFERENCES rooms(id) ON DELETE CASCADE,
  parent_id  UUID REFERENCES files(id),                       -- folders: kind='folder'
  kind       TEXT NOT NULL DEFAULT 'file',                    -- file | folder
  name       TEXT NOT NULL,
  mimetype   TEXT,
  size       BIGINT,
  sha256     BYTEA,                                           -- of ciphertext, integrity
  storage    TEXT NOT NULL DEFAULT 'p2p',                     -- p2p | relay | cloud
  upload_id  TEXT,                                            -- TUS resumable id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, parent_id, name)
);

-- Idempotent migrations for databases created before these columns existed.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
