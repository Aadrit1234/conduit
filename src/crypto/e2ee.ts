import { x25519, BASE_POINT } from "./x25519";

/**
 * E2EE primitives built on Web Crypto:
 *
 *   - X25519 (see ./x25519.ts) for per-member key agreement
 *   - HKDF-SHA256 to turn each pairwise shared secret into a wrapping key
 *   - AES-256-GCM to (a) wrap the shared room key to a member's public key and
 *     (b) encrypt every chat payload
 *
 * Nothing here touches the network — CryptoSession (src/live/cryptoSession.ts)
 * owns the wire protocol. The server only ever sees wrapped keys and ciphertext.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Wire prefixes. Messages carry a key-generation so decryptors pick the right
 * key from the chain after rotation:
 *   `2:<gen>:<iv>:<ct>` — current format
 *   `1:<iv>:<ct>`       — pre-rotation format, decrypts with generation 1
 */
export const MSG_PREFIX = "2:";
export const LEGACY_PREFIX = "1:";
export const KDF_INFO = "conduit/e2ee/wrap-v1";
export const MSG_AAD = "conduit/e2ee/message-v1";

export type Identity = { privateKey: Uint8Array<ArrayBuffer>; publicKey: Uint8Array<ArrayBuffer> };

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/* ---------- base64 ---------- */

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- X25519 identities ---------- */

export function generateIdentity(): Identity {
  const privateKey = randomBytes(32);
  return { privateKey, publicKey: x25519(privateKey, BASE_POINT) };
}

/** Pairwise shared secret (32 bytes) for a member pair. */
export function ecdhSharedSecret(privateKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array<ArrayBuffer> {
  return x25519(privateKey, peerPublicKey);
}

/* ---------- HKDF → AES-GCM wrapping key ---------- */

export async function deriveWrappingKey(sharedSecret: Uint8Array<ArrayBuffer>, salt: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(salt) as BufferSource, info: encoder.encode(KDF_INFO) as BufferSource },
    base,
    256
  );
  return crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/* ---------- room key wrap / unwrap ---------- */

export type WrappedKey = { iv: string; ct: string };

export async function wrapRoomKey(wrappingKey: CryptoKey, roomKey: Uint8Array<ArrayBuffer>): Promise<WrappedKey> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, roomKey);
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function unwrapRoomKey(wrappingKey: CryptoKey, wrapped: WrappedKey): Promise<Uint8Array<ArrayBuffer>> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(wrapped.iv) },
    wrappingKey,
    fromB64(wrapped.ct)
  );
  return new Uint8Array(plain);
}

/* ---------- chat payload codec ---------- */

export function isEncryptedPayload(payload: string): boolean {
  return payload.startsWith(MSG_PREFIX) || payload.startsWith(LEGACY_PREFIX);
}

/** Parsed wire payload with the key generation it was encrypted under. */
export type EncodedPayload = { gen: number; ivB64: string; ctB64: string };

/**
 * Parse a wire payload. Legacy `1:` payloads predate rotation and were
 * encrypted with the room's first key — generation 1.
 */
export function parseEncodedPayload(payload: string): EncodedPayload | null {
  if (payload.startsWith(MSG_PREFIX)) {
    const rest = payload.slice(MSG_PREFIX.length).split(":");
    if (rest.length !== 3) return null;
    const gen = Number(rest[0]);
    if (!Number.isInteger(gen) || gen < 0 || !rest[1] || !rest[2]) return null;
    return { gen, ivB64: rest[1], ctB64: rest[2] };
  }
  if (payload.startsWith(LEGACY_PREFIX)) {
    const rest = payload.slice(LEGACY_PREFIX.length).split(":");
    if (rest.length !== 2) return null;
    return { gen: 1, ivB64: rest[0], ctB64: rest[1] };
  }
  return null;
}

/** AES-256-GCM encrypt a chat message under key generation `gen`. */
export async function encryptMessage(
  roomKey: Uint8Array<ArrayBuffer>,
  plaintext: string,
  gen = 1
): Promise<string> {
  const key = await crypto.subtle.importKey("raw", roomKey, "AES-GCM", false, ["encrypt"]);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(MSG_AAD) },
    key,
    encoder.encode(plaintext)
  );
  return `${MSG_PREFIX}${gen}:${toB64(iv)}:${toB64(new Uint8Array(ct))}`;
}

/** Decrypt any encrypted payload. Throws on tampering or a wrong key. */
export async function decryptMessage(
  roomKey: Uint8Array<ArrayBuffer>,
  payload: string
): Promise<string> {
  const parsed = parseEncodedPayload(payload);
  if (!parsed) throw new Error("not an encrypted payload");
  const key = await crypto.subtle.importKey("raw", roomKey, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(parsed.ivB64), additionalData: encoder.encode(MSG_AAD) },
    key,
    fromB64(parsed.ctB64)
  );
  return decoder.decode(plain);
}

/* ---------- persistence (per-tab session) ---------- */

const IDENTITY_KEY = "conduit-e2ee-identity";

export function loadIdentity(): Identity | null {
  try {
    const raw = sessionStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { privateKey: string; publicKey: string };
    return { privateKey: fromB64(parsed.privateKey), publicKey: fromB64(parsed.publicKey) };
  } catch {
    return null;
  }
}

export function saveIdentity(identity: Identity): void {
  try {
    sessionStorage.setItem(
      IDENTITY_KEY,
      JSON.stringify({ privateKey: toB64(identity.privateKey), publicKey: toB64(identity.publicKey) })
    );
  } catch {
    /* private mode / storage full — identity lives for this session only */
  }
}

export function roomKeyStorageKey(code: string): string {
  return `conduit-e2ee-roomkey-${code}`;
}

/**
 * The room's key chain: every generation ever used, so history stays
 * decryptable after rotation. `activeGen` is the key new messages use.
 */
export type KeyChain = {
  activeGen: number;
  keys: Map<number, Uint8Array<ArrayBuffer>>;
};

export function loadRoomKeyChain(code: string): KeyChain | null {
  try {
    const raw = sessionStorage.getItem(roomKeyStorageKey(code));
    if (!raw) return null;
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as { activeGen: number; keys: Record<string, string> };
      const keys = new Map<number, Uint8Array<ArrayBuffer>>();
      for (const [g, b64] of Object.entries(parsed.keys)) keys.set(Number(g), fromB64(b64));
      return { activeGen: parsed.activeGen, keys };
    }
    // Legacy: a single bare base64 key from before rotation existed → generation 1.
    return { activeGen: 1, keys: new Map([[1, fromB64(raw)]]) };
  } catch {
    return null;
  }
}

export function saveRoomKeyChain(code: string, chain: KeyChain): void {
  try {
    const keys: Record<string, string> = {};
    for (const [g, k] of chain.keys) keys[String(g)] = toB64(k);
    sessionStorage.setItem(roomKeyStorageKey(code), JSON.stringify({ activeGen: chain.activeGen, keys }));
  } catch {
    /* same caveat as identity */
  }
}
