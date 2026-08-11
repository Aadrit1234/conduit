const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

export type LiveRoom = {
  id: string;
  code: string;
  name: string;
  mode: "ephemeral" | "permanent";
  ttlSeconds: number | null;
  createdAt: string;
  expiresAt: string | null;
};

export type RoomUpdateInput = { name?: string; mode?: "ephemeral" | "permanent" };

export type CreateRoomResult = { room: LiveRoom; adminToken: string; wsUrl: string };
export type JoinRoomResult = { room: LiveRoom; wsUrl: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep status text */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/** Creates a room on the Conduit server. */
export async function createRoom(mode: "ephemeral" | "permanent", ttlMinutes = 240): Promise<CreateRoomResult> {
  return request<CreateRoomResult>("/rooms", {
    method: "POST",
    body: JSON.stringify({ mode, ttlMinutes }),
  });
}

/** Resolves a join code to a live room. Throws (404) if the room doesn't exist. */
export async function joinRoom(code: string): Promise<JoinRoomResult> {
  return request<JoinRoomResult>(`/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** Absolute WebSocket URL for a room, honoring VITE_API_BASE or same-origin proxying. */
export function wsUrlFor(code: string, name: string): string {
  const base = API_BASE || window.location.origin;
  const proto = base.startsWith("https") ? "wss" : "ws";
  return `${proto}://${base.replace(/^https?:\/\//, "")}/ws/rooms/${encodeURIComponent(code)}?name=${encodeURIComponent(name)}`;
}

/** Destroys a room. Only the creator's admin token can burn it. */
export async function burnRoom(code: string, adminToken: string): Promise<void> {
  await request(`/rooms/${encodeURIComponent(code)}`, {
    method: "DELETE",
    body: JSON.stringify({ adminToken }),
  });
}

/** Rename the room and/or toggle ephemeral/permanent. Admin-token gated. */
export async function updateRoom(code: string, adminToken: string, input: RoomUpdateInput): Promise<{ room: LiveRoom }> {
  return request<{ room: LiveRoom }>(`/rooms/${encodeURIComponent(code)}`, {
    method: "PATCH",
    body: JSON.stringify({ adminToken, ...input }),
  });
}

/** Stable per-tab guest identity (shared with the WebRTC mesh naming). */
export function guestName(): string {
  const key = "conduit-guest";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12);
    sessionStorage.setItem(key, id);
  }
  return `Tab·${id.slice(-4).toUpperCase()}`;
}

/** The display name the user last entered, if any. */
export function savedName(): string {
  try {
    return (localStorage.getItem("conduit-name") ?? "").trim();
  } catch {
    return "";
  }
}

/** Remember the display name for the next room session. */
export function rememberName(name: string) {
  try {
    const clean = name.trim().slice(0, 40);
    if (clean) localStorage.setItem("conduit-name", clean);
  } catch {
    /* storage unavailable (private mode) — skip persistence */
  }
}
