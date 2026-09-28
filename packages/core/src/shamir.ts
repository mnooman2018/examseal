import { combine, split } from "shamir-secret-sharing";

/** Split a 32-byte AES key into n pieces (33 bytes each), any t of which recover it. */
export async function splitKey(key: Uint8Array, n = 5, t = 3): Promise<Uint8Array[]> {
  if (key.length !== 32) throw new Error(`splitKey: key must be 32 bytes, got ${key.length}`);
  return split(key, n, t);
}

/**
 * Combine pieces back into the key. Shamir cannot tell a wrong result from a right one:
 * fewer than t pieces (or a bad piece) silently gives the wrong key. recoverVariant
 * detects that with AES-GCM authentication.
 */
export async function combinePieces(pieces: Uint8Array[]): Promise<Uint8Array> {
  return combine(pieces);
}
