/** Binary framing for file chunks sent over a WebRTC DataChannel.
 *
 * Wire format for each chunk: [transferId: u32 LE][index: u32 LE][payload bytes]
 * Control messages (meta / done) are JSON strings; chunks are raw ArrayBuffers,
 * so the receiver can tell them apart by type.
 */

export const CHUNK_SIZE = 64 * 1024;
export const HEADER_BYTES = 8;

export function encodeChunk(transferId: number, index: number, data: ArrayBuffer): ArrayBuffer {
  const out = new ArrayBuffer(HEADER_BYTES + data.byteLength);
  const view = new DataView(out);
  view.setUint32(0, transferId >>> 0, true);
  view.setUint32(4, index >>> 0, true);
  new Uint8Array(out, HEADER_BYTES).set(new Uint8Array(data));
  return out;
}

export function decodeChunk(buf: ArrayBuffer): { transferId: number; index: number; data: ArrayBuffer } {
  const view = new DataView(buf);
  return {
    transferId: view.getUint32(0, true),
    index: view.getUint32(4, true),
    data: buf.slice(HEADER_BYTES),
  };
}

export function isChunkFrame(data: unknown): data is ArrayBuffer {
  return data instanceof ArrayBuffer && data.byteLength >= HEADER_BYTES;
}

export async function sha256Hex(data: ArrayBuffer | Blob): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readChunks(file: File, chunkSize = CHUNK_SIZE): Promise<ArrayBuffer[]> {
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    chunks.push(await file.slice(offset, Math.min(offset + chunkSize, file.size)).arrayBuffer());
  }
  return chunks;
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
