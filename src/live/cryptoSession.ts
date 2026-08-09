import type { LiveRoomSocket } from "./socket";
import type { ServerMember } from "./socket";
import {
  type Identity,
  type KeyChain,
  ecdhSharedSecret,
  encryptMessage,
  decryptMessage,
  deriveWrappingKey,
  wrapRoomKey,
  unwrapRoomKey,
  generateIdentity,
  loadIdentity,
  saveIdentity,
  loadRoomKeyChain,
  saveRoomKeyChain,
  randomBytes,
  toB64,
  fromB64,
  parseEncodedPayload,
} from "../crypto/e2ee";

/**
 * Per-room E2EE session with key rotation.
 *
 * Key exchange rides the server's opaque `signal` relay, so the server
 * forwards wrapped keys and ciphertext without ever seeing a plaintext byte:
 *
 *   e2ee.identity  — publish my X25519 public key (broadcast on join, targeted
 *                    to newcomers on presence.join)
 *   e2ee.key       — a room-key generation wrapped to a specific member's
 *                    public key (AES-256-GCM under HKDF(ECDH(me, them)))
 *
 * The first member to join generates the room key (generation 1) and is the
 * room's key authority. When a member who exchanged keys leaves, the creator
 * **rotates**: a fresh key (next generation) is wrapped to every remaining
 * member. The key chain keeps older generations in memory (and in the per-tab
 * store), so history stays decryptable while new messages are unreadable to
 * the departed peer — the server only ever held ciphertext for all of it.
 *
 * Chat payloads are `2:<gen>:<iv>:<ct>`; pre-rotation `1:<iv>:<ct>` payloads
 * decrypt with generation 1.
 */

export type E2eeStatus = "simulated" | "negotiating" | "ready";

type SignalData = {
  kind?: string;
  publicKey?: string;
  iv?: string;
  ct?: string;
  gen?: number;
  rotate?: boolean;
};

export type CryptoSessionOptions = {
  roomCode: string;
  socket: LiveRoomSocket;
  myPeerId: string;
  /** First member to join → generates the room key and owns rotation. */
  isCreator: boolean;
  /** Explicit identity for tests; defaults to the persisted per-tab identity. */
  identity?: Identity;
  /** Persist the key chain for same-tab reloads (default true; tests pass false). */
  persist?: boolean;
  onStatus: (status: E2eeStatus) => void;
  /** Fired when this session adopts a rotated key generation. */
  onRotated?: (gen: number) => void;
};

export class CryptoSession {
  private readonly roomCode: string;
  private readonly socket: LiveRoomSocket;
  private readonly myPeerId: string;
  private readonly identity: Identity;
  private readonly isCreator: boolean;
  private readonly persist: boolean;
  private readonly onStatus: (status: E2eeStatus) => void;
  private readonly onRotated?: (gen: number) => void;

  /** gen → key. New messages use `keys.get(activeGen)`. */
  private keys = new Map<number, Uint8Array<ArrayBuffer>>();
  private activeGen = 0;
  private status: E2eeStatus;
  private pending: string[] = [];
  /** peerId → X25519 public key, learned from their identity signals. */
  private knownIdentities = new Map<string, string>();

  constructor(opts: CryptoSessionOptions) {
    this.roomCode = opts.roomCode;
    this.socket = opts.socket;
    this.myPeerId = opts.myPeerId;
    this.isCreator = opts.isCreator;
    this.persist = opts.persist ?? true;
    this.onStatus = opts.onStatus;
    this.onRotated = opts.onRotated;
    this.identity = opts.identity ?? loadIdentity() ?? this.freshIdentity();
    this.status = "negotiating";

    const stored = opts.persist === false ? null : loadRoomKeyChain(this.roomCode);
    if (stored) {
      this.keys = stored.keys;
      this.activeGen = stored.activeGen;
    }
  }

  private freshIdentity(): Identity {
    const identity = generateIdentity();
    saveIdentity(identity);
    return identity;
  }

  get publicKey(): string {
    return toB64(this.identity.publicKey);
  }

  /** Whether chat can be encrypted right now. */
  get ready(): boolean {
    return this.status === "ready" && this.activeGen > 0;
  }

  /** The generation new messages are encrypted under (0 until keys exist). */
  get activeGeneration(): number {
    return this.activeGen;
  }

  /** Wire the signal handler, publish identity, and start key exchange. */
  start(): void {
    this.socket.setSignalHandler((from, data) => this.handleSignal(from, data as SignalData));

    // First member to join generates generation 1; a reload picks up the chain.
    if (this.keys.size === 0 && this.isCreator) {
      this.activeGen = 1;
      this.keys.set(1, randomBytes(32));
      if (this.persist) this.persistKeys();
    }

    this.socket.sendSignal({ kind: "e2ee.identity", publicKey: this.publicKey });
    if (this.keys.size > 0) {
      this.setReady();
    } else {
      this.onStatus("negotiating");
    }
  }

  /** A new member joined — make sure they get our identity (and key). */
  onPeerJoined(peerId: string): void {
    if (peerId === this.myPeerId) return;
    this.socket.sendSignal({ kind: "e2ee.identity", publicKey: this.publicKey }, peerId);
  }

  /**
   * A member left. The creator rotates the room key so the departed peer —
   * who holds the old generation — cannot read anything sent from now on.
   * Only members who actually exchanged keys trigger a rotation.
   */
  onPeerLeft(peerId: string, remaining: ServerMember[]): void {
    if (peerId === this.myPeerId || !this.isCreator) return;
    if (!this.knownIdentities.has(peerId)) return; // never had a key — nothing to rotate
    void this.rotate(remaining);
  }

  private async rotate(remaining: ServerMember[]): Promise<void> {
    const nextGen = this.activeGen + 1;
    const newKey = randomBytes(32);
    this.keys.set(nextGen, newKey);
    this.activeGen = nextGen;
    if (this.persist) this.persistKeys();
    this.onRotated?.(nextGen);

    for (const m of remaining) {
      if (m.peerId === this.myPeerId) continue;
      const pub = this.knownIdentities.get(m.peerId);
      if (pub) await this.shareKeyTo(m.peerId, pub, nextGen);
    }
  }

  /** Room key arrived (or we are the creator). Safe to encrypt now. */
  setReady(): void {
    this.status = "ready";
    this.onStatus("ready");
    this.flushPending();
  }

  private handleSignal(from: string, data: SignalData): void {
    if (from === this.myPeerId) return;
    if (data.kind === "e2ee.identity" && data.publicKey) {
      this.knownIdentities.set(from, data.publicKey);
      // I can wrap the current key for this member if I hold it.
      if (this.keys.size > 0) {
        void this.shareKeyTo(from, data.publicKey, this.activeGen);
      }
      return;
    }
    if (data.kind === "e2ee.key" && data.iv && data.ct && data.publicKey && typeof data.gen === "number") {
      void this.receiveKeyShare(data);
    }
  }

  private async shareKeyTo(peerId: string, peerPublicKeyB64: string, gen: number): Promise<void> {
    const key = this.keys.get(gen);
    if (!key) return;
    try {
      const shared = ecdhSharedSecret(this.identity.privateKey, fromB64(peerPublicKeyB64));
      const wrappingKey = await deriveWrappingKey(shared, this.roomCode);
      const wrapped = await wrapRoomKey(wrappingKey, key);
      this.socket.sendSignal(
        { kind: "e2ee.key", publicKey: this.publicKey, gen, iv: wrapped.iv, ct: wrapped.ct },
        peerId
      );
    } catch {
      /* peer's key is malformed — ignore */
    }
  }

  private async receiveKeyShare(data: SignalData): Promise<void> {
    if (typeof data.gen !== "number" || this.keys.has(data.gen)) return; // stale/duplicate
    try {
      const shared = ecdhSharedSecret(this.identity.privateKey, fromB64(data.publicKey!));
      const wrappingKey = await deriveWrappingKey(shared, this.roomCode);
      const key = await unwrapRoomKey(wrappingKey, { iv: data.iv!, ct: data.ct! });
      this.keys.set(data.gen, key);
      if (data.gen > this.activeGen) this.activeGen = data.gen;
      if (this.persist) this.persistKeys();
      if (data.rotate) this.onRotated?.(data.gen);
      this.setReady();
    } catch {
      this.onStatus("negotiating");
    }
  }

  /** Encrypt a message. Returns ciphertext to send, or null if the key isn't ready (queued). */
  async encrypt(text: string): Promise<string | null> {
    const key = this.keys.get(this.activeGen);
    if (!key) {
      this.pending.push(text);
      return null;
    }
    return encryptMessage(key, text, this.activeGen);
  }

  /** Decrypt a payload, or return it untouched if it isn't ciphertext. Throws on wrong/missing key. */
  async decrypt(payload: string): Promise<string> {
    const parsed = parseEncodedPayload(payload);
    if (!parsed) return payload; // not ciphertext — pass through
    const key = this.keys.get(parsed.gen);
    if (!key) throw new Error(`no key for generation ${parsed.gen}`);
    return decryptMessage(key, payload);
  }

  private persistKeys(): void {
    saveRoomKeyChain(this.roomCode, { activeGen: this.activeGen, keys: this.keys } satisfies KeyChain);
  }

  private flushPending(): void {
    const queued = this.pending;
    this.pending = [];
    for (const text of queued) {
      const key = this.keys.get(this.activeGen);
      if (!key) continue;
      void encryptMessage(key, text, this.activeGen).then((cipher) => {
        if (this.socket.ready) this.socket.sendChat(cipher);
      });
    }
  }
}
