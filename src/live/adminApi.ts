import { API_BASE } from "./api";

export type AdminRoom = {
  id: string;
  code: string;
  name: string;
  mode: "ephemeral" | "permanent";
  ttlSeconds: number | null;
  createdAt: string;
  expiresAt: string | null;
  messageCount: number;
  memberCount: number;
};

const TOKEN_KEY = "conduit-admin-session";

/** The admin session token, if this browser logged in. */
export function adminToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeAdminToken(token: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — session lasts only in memory */
  }
}

export function clearAdminToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

type AdminInit = RequestInit & { token?: string | null };

/** Admin API fetcher — always sends the bearer token when one is known.
 * Content-type is only set when there is a body: Fastify rejects an empty
 * JSON body with a 400 (e.g. the body-less DELETE burn). */
async function adminFetch<T>(path: string, init?: AdminInit): Promise<T> {
  const token = init?.token ?? adminToken();
  const hasBody = init?.body != null;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
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

/** Exchanges the operator password for a bearer session token. */
export async function adminLogin(password: string): Promise<{ token: string; expiresIn: number }> {
  return adminFetch<{ token: string; expiresIn: number }>("/admin/login", {
    method: "POST",
    token: null,
    body: JSON.stringify({ password }),
  });
}

/** Lists every room with live member + message counts. */
export async function adminListRooms(): Promise<{ rooms: AdminRoom[] }> {
  return adminFetch<{ rooms: AdminRoom[] }>("/admin/rooms");
}

/** Rename a room and/or toggle ephemeral/permanent as the operator. */
export async function adminUpdateRoom(
  code: string,
  input: { name?: string; mode?: "ephemeral" | "permanent" }
): Promise<{ room: { code: string; name: string; mode: "ephemeral" | "permanent" } }> {
  return adminFetch(`/admin/rooms/${encodeURIComponent(code)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** Destroys a room as the operator (kicks all members out). */
export async function adminBurnRoom(code: string): Promise<{ ok: boolean }> {
  return adminFetch<{ ok: boolean }>(`/admin/rooms/${encodeURIComponent(code)}`, {
    method: "DELETE",
  });
}
