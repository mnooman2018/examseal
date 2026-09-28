import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { shareAad } from "./aad";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aes";
import { bytesEqual, concatBytes, utf8 } from "./hex";

// Sealed piece layout (CLAUDE.md §7): ephPk(32) || nonce(12) || ct(33) || tag(16) = 93 bytes.
const PIECE_LEN = 33;
const SEALED_LEN = 93;
const HKDF_INFO = utf8("examseal/v1/share");

function deriveKey(shared: Uint8Array, ephPk: Uint8Array, centrePk: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, concatBytes(ephPk, centrePk), HKDF_INFO, 32);
}

function checkLen(name: string, b: Uint8Array, len: number): void {
  if (!(b instanceof Uint8Array) || b.length !== len) {
    throw new Error(`${name} must be ${len} bytes, got ${b?.length}`);
  }
}

export function generateCentreKeypair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  const privateKey = x25519.utils.randomPrivateKey();
  return { publicKey: x25519.getPublicKey(privateKey), privateKey };
}

/** Encrypt a 33-byte Shamir piece so only the holder of centrePk's private key can open it. */
export async function sealPiece(
  piece: Uint8Array,
  centrePk: Uint8Array,
  examId: bigint,
  centreId: number,
): Promise<Uint8Array> {
  checkLen("piece", piece, PIECE_LEN);
  checkLen("centre public key", centrePk, 32);
  const ephSk = x25519.utils.randomPrivateKey();
  const ephPk = x25519.getPublicKey(ephSk);
  const shared = x25519.getSharedSecret(ephSk, centrePk);
  const k = deriveKey(shared, ephPk, centrePk);
  // aesGcmEncrypt output is nonce(12) || ct || tag(16), exactly the rest of the layout.
  return concatBytes(ephPk, await aesGcmEncrypt(k, piece, shareAad(examId, centreId)));
}

/** Open a sealed piece with the centre's key pair. Throws on any mismatch. */
export async function openPiece(
  blob: Uint8Array,
  centreSk: Uint8Array,
  centrePk: Uint8Array,
  examId: bigint,
  centreId: number,
): Promise<Uint8Array> {
  checkLen("sealed piece", blob, SEALED_LEN);
  checkLen("centre private key", centreSk, 32);
  checkLen("centre public key", centrePk, 32);
  if (!bytesEqual(x25519.getPublicKey(centreSk), centrePk)) {
    throw new Error("Centre private key does not match the centre public key");
  }
  const ephPk = blob.subarray(0, 32);
  const shared = x25519.getSharedSecret(centreSk, ephPk);
  const k = deriveKey(shared, ephPk, centrePk);
  const piece = await aesGcmDecrypt(k, blob.subarray(32), shareAad(examId, centreId));
  checkLen("opened piece", piece, PIECE_LEN);
  return piece;
}
