import type { ChatMessage, Room, RoomMode } from "../types.js";

export type CreateRoomInput = {
  code: string;
  mode: RoomMode;
  ttlSeconds: number | null;
  keyBlob?: Buffer | null;
  name?: string;
  /** Creator-only credential that gates burn/rename/mode changes. Persisted so it
   * survives server restarts (in-memory tokens orphan every room on reboot). */
  adminToken?: string;
};

export type UpdateRoomInput = {
  name?: string;
  mode?: RoomMode;
};

const DEFAULT_EPHEMERAL_TTL_SECONDS = 240 * 60;

/** Recomputes expiry for a mode change (ephemeral→permanent and back). */
export function applyModeChange(
  room: Room,
  input: UpdateRoomInput
): { name: string; mode: RoomMode; ttlSeconds: number | null; expiresAt: string | null } {
  const name = input.name !== undefined ? input.name : room.name;
  const mode = input.mode ?? room.mode;
  if (mode === room.mode && input.mode === undefined) {
    return { name, mode: room.mode, ttlSeconds: room.ttlSeconds, expiresAt: room.expiresAt };
  }
  if (mode === "permanent") {
    return { name, mode, ttlSeconds: null, expiresAt: null };
  }
  const ttlSeconds = DEFAULT_EPHEMERAL_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  return { name, mode, ttlSeconds, expiresAt };
}

/**
 * Storage boundary for rooms and messages. `PostgresStore` is the production
 * implementation (schema in `db/schema.sql`); `MemoryStore` powers dev and tests.
 * Sequence numbers (the lamport clock per room) are assigned atomically here so
 * broadcast ordering matches persistence order.
 */
export interface RoomStore {
  createRoom(input: CreateRoomInput): Promise<Room>;
  getRoomByCode(code: string): Promise<Room | null>;
  getRoomById(id: string): Promise<Room | null>;
  getAdminToken(id: string): Promise<string | null>;
  updateRoom(id: string, input: UpdateRoomInput): Promise<Room>;
  deleteRoom(id: string): Promise<boolean>;
  /** Deletes rooms past their expiry; returns the ids removed. */
  purgeExpired(now?: Date): Promise<string[]>;
  /** Persists a message and returns it with the room's next sequence number. */
  saveMessage(roomId: string, author: string, payload: string): Promise<ChatMessage>;
  listMessages(roomId: string, limit?: number): Promise<ChatMessage[]>;
}
