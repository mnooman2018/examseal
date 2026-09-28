export type Hex = `0x${string}`;

/** Bytes → 0x-prefixed lowercase hex (CLAUDE.md §7 encoding). */
export function toHexBytes(b: Uint8Array): Hex {
  let s = "0x";
  for (const byte of b) s += byte.toString(16).padStart(2, "0");
  return s as Hex;
}

/** 0x-prefixed hex (either case) → bytes. Throws on anything malformed. */
export function fromHexBytes(h: Hex): Uint8Array {
  if (typeof h !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(h)) {
    throw new Error("fromHexBytes: expected 0x-prefixed hex with an even number of digits");
  }
  const out = new Uint8Array((h.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

/** Concatenate byte arrays. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
