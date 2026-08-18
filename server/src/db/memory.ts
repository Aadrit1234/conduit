import { randomUUID } from "node:crypto";
import type { ChatMessage, Room, RoomMode } from "../types.js";
import { applyModeChange, type CreateRoomInput, type RoomStore, type UpdateRoomInput } from "./store.js";

type RoomRecord = Room & { keyBlob: Buffer | null };
type MessageRecord = {
  id: string;
  roomId: string;
  seq: number;
  author: string;
  ciphertext: Buffer;
  createdAt: Date;
};

/** In-memory RoomStore — dev and tests. Not for multi-process production. */
export class MemoryStore implements RoomStore {
  private rooms = new Map<string, RoomRecord>();
  private byCode = new Map<string, string>();
  private adminTokens = new Map<string, string>();
  private messages = new Map<string, MessageRecord[]>();

  async createRoom(input: CreateRoomInput): Promise<Room> {
    if (this.byCode.has(input.code)) {
      const err = new Error(`room code ${input.code} already exists`);
      (err as Error & { code?: string }).code = "23505"; // unique violation — same contract as pg
      throw err;
    }
    const now = new Date();
    const id = randomUUID();
    const expiresAt = input.mode === "ephemeral" && input.ttlSeconds != null
      ? new Date(now.getTime() + input.ttlSeconds * 1000)
      : null;
    const room: RoomRecord = {
      id,
      code: input.code,
      name: input.name ?? "",
      mode: input.mode,
      ttlSeconds: input.ttlSeconds,
      keyBlob: input.keyBlob ?? null,
      createdAt: now.toISOString(),
      expiresAt: expiresAt?.toISOString() ?? null,
    };
    this.rooms.set(id, room);
    this.byCode.set(input.code, id);
    if (input.adminToken) this.adminTokens.set(id, input.adminToken);
    this.messages.set(id, []);
    return this.toPublic(room);
  }

  async getAdminToken(id: string): Promise<string | null> {
    return this.adminTokens.get(id) ?? null;
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    const id = this.byCode.get(code.toUpperCase());
    if (!id) return null;
    const room = this.rooms.get(id);
    return room ? this.toPublic(room) : null;
  }

  async getRoomById(id: string): Promise<Room | null> {
    const room = this.rooms.get(id);
    return room ? this.toPublic(room) : null;
  }

  async updateRoom(id: string, input: UpdateRoomInput): Promise<Room> {
    const room = this.rooms.get(id);
    if (!room) throw new Error(`room ${id} not found`);
    const next = applyModeChange(this.toPublic(room), input);
    room.name = next.name;
    room.mode = next.mode;
    room.ttlSeconds = next.ttlSeconds;
    room.expiresAt = next.expiresAt;
    return this.toPublic(room);
  }

  async deleteRoom(id: string): Promise<boolean> {
    const room = this.rooms.get(id);
    if (!room) return false;
    this.rooms.delete(id);
    this.byCode.delete(room.code);
    this.adminTokens.delete(id);
    this.messages.delete(id);
    return true;
  }

  async purgeExpired(now: Date = new Date()): Promise<string[]> {
    const removed: string[] = [];
    for (const room of this.rooms.values()) {
      if (room.expiresAt && new Date(room.expiresAt) <= now) {
        await this.deleteRoom(room.id);
        removed.push(room.id);
      }
    }
    return removed;
  }

  async saveMessage(roomId: string, author: string, payload: string): Promise<ChatMessage> {
    const list = this.messages.get(roomId);
    if (!list) throw new Error(`room ${roomId} not found`);
    const seq = list.reduce((max, m) => Math.max(max, m.seq), 0) + 1;
    const record: MessageRecord = {
      id: randomUUID(),
      roomId,
      seq,
      author,
      ciphertext: Buffer.from(payload, "utf8"),
      createdAt: new Date(),
    };
    list.push(record);
    return this.toChatMessage(record);
  }

  async listMessages(roomId: string, limit = 100): Promise<ChatMessage[]> {
    const list = this.messages.get(roomId) ?? [];
    return list.slice(-limit).map((m) => this.toChatMessage(m));
  }

  async listRooms(): Promise<Room[]> {
    return [...this.rooms.values()]
      .map((r) => this.toPublic(r))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async countMessages(roomId: string): Promise<number> {
    return this.messages.get(roomId)?.length ?? 0;
  }

  private toPublic(room: RoomRecord): Room {
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      mode: room.mode as RoomMode,
      ttlSeconds: room.ttlSeconds,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
    };
  }

  private toChatMessage(m: MessageRecord): ChatMessage {
    return {
      id: m.id,
      roomId: m.roomId,
      seq: m.seq,
      author: m.author,
      payload: m.ciphertext.toString("utf8"),
      ts: m.createdAt.toISOString(),
    };
  }
}
