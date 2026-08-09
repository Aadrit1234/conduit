/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Conduit backend. Empty = same origin (Vite proxy in dev). */
  readonly VITE_API_BASE?: string;
  /** JSON array of RTCIceServer for WebRTC (STUN/TURN). Empty = public STUN. */
  readonly VITE_ICE_SERVERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
