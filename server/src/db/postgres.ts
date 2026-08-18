import { Pool, type PoolConfig } from "pg";
import type { ChatMessage, Room, RoomMode } from "../types.js";
import { applyModeChange, type CreateRoomInput, type RoomStore, type UpdateRoomInput } from "./store.js";

type RoomRow = {
  id: string;
  code: string;
  name: string;
  mode: RoomMode;
  ttl_seconds: number | null;
  key_blob: Buffer;
  created_at: Date;
  expires_at: Date | null;
};

type MessageRow = {
  id: string;
  room_id: string;
  seq: number;
  author: string;
  ciphertext: Buffer;
  created_at: Date;
};

/** Production RoomStore backed by PostgreSQL (see `db/schema.sql`). */
export class PostgresStore implements RoomStore {
  readonly pool: Pool;

  constructor(config?: PoolConfig) {
    this.pool = new Pool(config);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async createRoom(input: CreateRoomInput): Promise<Room> {
    // expires_at is computed here (not via make_interval) so Postgres never has
    // to infer a parameter type that is NULL for permanent rooms.
    const expiresAt =
      input.mode === "ephemeral" && input.ttlSeconds != null
        ? new Date(Date.now() + input.ttlSeconds * 1000)
        : null;
    const { rows } = await this.pool.query<RoomRow>(
      `INSERT INTO rooms (code, mode, name, ttl_seconds, key_blob, admin_token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, code, name, mode, ttl_seconds, key_blob, created_at, expires_at`,
      [input.code, input.mode, input.name ?? "", input.ttlSeconds, input.keyBlob ?? Buffer.alloc(0), input.adminToken ?? null, expiresAt]
    );
    return this.toRoom(rows[0]);
  }

  async getAdminToken(id: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ admin_token: string | null }>(
      `SELECT admin_token FROM rooms WHERE id = $1`,
      [id]
    );
    return rows[0]?.admin_token ?? null;
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    const { rows } = await this.pool.query<RoomRow>(
      `SELECT id, code, name, mode, ttl_seconds, key_blob, created_at, expires_at
       FROM rooms WHERE code = $1`,
      [code.toUpperCase()]
    );
    return rows[0] ? this.toRoom(rows[0]) : null;
  }

  async getRoomById(id: string): Promise<Room | null> {
    const { rows } = await this.pool.query<RoomRow>(
      `SELECT id, code, name, mode, ttl_seconds, key_blob, created_at, expires_at
       FROM rooms WHERE id = $1`,
      [id]
    );
    return rows[0] ? this.toRoom(rows[0]) : null;
  }

  async updateRoom(id: string, input: UpdateRoomInput): Promise<Room> {
    const current = await this.getRoomById(id);
    if (!current) throw new Error(`room ${id} not found`);
    const next = applyModeChange(current, input);
    const { rows } = await this.pool.query<RoomRow>(
      `UPDATE rooms
       SET name = $2, mode = $3, ttl_seconds = $4, expires_at = $5
       WHERE id = $1
       RETURNING id, code, name, mode, ttl_seconds, key_blob, created_at, expires_at`,
      [id, next.name, next.mode, next.ttlSeconds, next.expiresAt]
    );
    return this.toRoom(rows[0]);
  }

  async deleteRoom(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("DELETE FROM rooms WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  }

  async purgeExpired(now: Date = new Date()): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      "DELETE FROM rooms WHERE expires_at IS NOT NULL AND expires_at <= $1 RETURNING id",
      [now]
    );
    return rows.map((r) => r.id);
  }

  /**
   * Assigns the room's next sequence number atomically: takes a row lock on the
   * room, then inserts with seq = max(seq)+1 in the same transaction. Broadcast
   * ordering and persistence order therefore agree.
   */
  async saveMessage(roomId: string, author: string, payload: string): Promise<ChatMessage> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM rooms WHERE id = $1 FOR UPDATE", [roomId]);
      const { rows } = await client.query<MessageRow>(
        `INSERT INTO messages (room_id, seq, author, ciphertext)
         VALUES ($1, COALESCE((SELECT MAX(seq) FROM messages WHERE room_id = $1), 0) + 1, $2, $3)
         RETURNING id, room_id, seq, author, ciphertext, created_at`,
        [roomId, author, Buffer.from(payload, "utf8")]
      );
      await client.query("COMMIT");
      return this.toChatMessage(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async listMessages(roomId: string, limit = 100): Promise<ChatMessage[]> {
    const { rows } = await this.pool.query<MessageRow>(
      `SELECT id, room_id, seq, author, ciphertext, created_at
       FROM messages WHERE room_id = $1 ORDER BY seq DESC LIMIT $2`,
      [roomId, limit]
    );
    return rows.reverse().map((m) => this.toChatMessage(m));
  }

  async listRooms(): Promise<Room[]> {
    const { rows } = await this.pool.query<RoomRow>(
      `SELECT id, code, name, mode, ttl_seconds, key_blob, created_at, expires_at
       FROM rooms ORDER BY created_at DESC`
    );
    return rows.map((r) => this.toRoom(r));
  }

  async countMessages(roomId: string): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM messages WHERE room_id = $1`,
      [roomId]
    );
    return Number(rows[0]?.count ?? 0);
  }

  private toRoom(row: RoomRow): Room {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      mode: row.mode,
      ttlSeconds: row.ttl_seconds,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    };
  }

  private toChatMessage(row: MessageRow): ChatMessage {
    return {
      id: row.id,
      roomId: row.room_id,
      seq: row.seq,
      author: row.author,
      payload: row.ciphertext.toString("utf8"),
      ts: row.created_at.toISOString(),
    };
  }
}
