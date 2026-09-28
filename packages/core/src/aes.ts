import { concatBytes } from "./hex";

const NONCE_LEN = 12;
const TAG_LEN = 16;

/** WebCrypto wants ArrayBuffer-backed views; copy to be safe across realms. */
const buf = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto (crypto.subtle) is not available");
  return s;
}

async function importKey(key: Uint8Array): Promise<CryptoKey> {
  if (key.length !== 32) throw new Error(`AES key must be 32 bytes, got ${key.length}`);
  return subtle().importKey("raw", buf(key), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function generateAesKey(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

/** AES-256-GCM with a random 12-byte nonce. Output: nonce(12) || ciphertext || tag(16). */
export async function aesGcmEncrypt(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const k = await importKey(key);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: buf(aad), tagLength: TAG_LEN * 8 },
    k,
    buf(plaintext),
  );
  return concatBytes(nonce, new Uint8Array(ct));
}

/** Inverse of aesGcmEncrypt. Throws if the key, AAD, or any byte of the blob is wrong. */
export async function aesGcmDecrypt(key: Uint8Array, blob: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  if (blob.length < NONCE_LEN + TAG_LEN) throw new Error("AES blob is too short");
  const k = await importKey(key);
  try {
    const pt = await subtle().decrypt(
      { name: "AES-GCM", iv: buf(blob.subarray(0, NONCE_LEN)), additionalData: buf(aad), tagLength: TAG_LEN * 8 },
      k,
      buf(blob.subarray(NONCE_LEN)),
    );
    return new Uint8Array(pt);
  } catch {
    throw new Error("AES-GCM authentication failed (wrong key, wrong AAD, or tampered data)");
  }
}
