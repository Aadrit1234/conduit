/**
 * X25519 (Curve25519) implemented in pure BigInt.
 *
 * Web Crypto's ECDH only exposes P-256 in most environments, so this is the
 * smallest dependency-free Montgomery ladder that still satisfies the
 * X25519 requirement. The symmetric layer (AES-256-GCM, HKDF) uses Web Crypto.
 *
 * Validated against the RFC 7748 §6.1 vectors (see the `vectors` export and
 * public/dev/e2ee-test.html).
 */

const P = 2n ** 255n - 19n;
const A24 = 121665n;

/** The Curve25519 base point (u-coordinate 9). */
export const BASE_POINT: Uint8Array<ArrayBuffer> = (() => {
  const u = new Uint8Array(32);
  u[0] = 9;
  return u;
})();

function decodeLE(bytes: Uint8Array): bigint {
  let x = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(bytes[i]);
  return x;
}

function encodeLE(x: bigint, len = 32): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function mod(a: bigint): bigint {
  const r = a % P;
  return r < 0n ? r + P : r;
}

function modPow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = mod(result * b);
    b = mod(b * b);
    e >>= 1n;
  }
  return result;
}

/**
 * The X25519 function: scalar mult of `u` by the clamped scalar `k`.
 * `k` and `u` must each be 32 bytes. Returns the 32-byte shared point.
 */
export function x25519(k: Uint8Array, u: Uint8Array): Uint8Array<ArrayBuffer> {
  // Clamp the scalar per RFC 7748.
  const scalar = k.slice();
  scalar[0] &= 248;
  scalar[31] &= 127;
  scalar[31] |= 64;

  const x1 = mod(decodeLE(u));
  let x2 = 1n;
  let z2 = 0n;
  let x3 = x1;
  let z3 = 1n;
  let swap = 0;

  for (let t = 254; t >= 0; t--) {
    const kt = (scalar[t >> 3] >> (t & 7)) & 1;
    swap ^= kt;
    if (swap) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }
    swap = kt;

    const A = mod(x2 + z2);
    const AA = mod(A * A);
    const B = mod(x2 - z2);
    const BB = mod(B * B);
    const E = mod(AA - BB);
    const C = mod(x3 + z3);
    const D = mod(x3 - z3);
    const DA = mod(D * A);
    const CB = mod(C * B);
    x3 = mod((DA + CB) * (DA + CB));
    z3 = mod(x1 * (DA - CB) * (DA - CB));
    x2 = mod(AA * BB);
    z2 = mod(E * (AA + mod(A24 * E)));
  }

  if (swap) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }

  // x2 * z2^(p-2) — the field inverse of z2.
  return encodeLE(mod(x2 * modPow(z2, P - 2n)));
}

/** RFC 7748 §6.1 — both scalars, points and the shared secret. */
export const vectors = {
  scalarA: hexBytes("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"),
  publicA: hexBytes("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a"),
  scalarB: hexBytes("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb"),
  publicB: hexBytes("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f"),
  shared: hexBytes("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742"),
  hex: hexBytes,
};

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
