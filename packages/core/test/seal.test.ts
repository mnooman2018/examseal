import { describe, expect, it } from "vitest";
import { generateCentreKeypair, openPiece, sealPiece } from "../src/seal";

const piece = () => globalThis.crypto.getRandomValues(new Uint8Array(33));

describe("sealed piece (ECIES over X25519)", () => {
  it("is 93 bytes and the right centre opens it", async () => {
    const c = generateCentreKeypair();
    expect(c.publicKey.length).toBe(32);
    expect(c.privateKey.length).toBe(32);
    const p = piece();
    const blob = await sealPiece(p, c.publicKey, 7n, 14);
    expect(blob.length).toBe(93);
    expect(await openPiece(blob, c.privateKey, c.publicKey, 7n, 14)).toEqual(p);
  });

  it("the wrong centre key fails", async () => {
    const c = generateCentreKeypair();
    const other = generateCentreKeypair();
    const blob = await sealPiece(piece(), c.publicKey, 7n, 14);
    await expect(openPiece(blob, other.privateKey, other.publicKey, 7n, 14)).rejects.toThrow();
  });

  it("a private key that does not match the public key is rejected", async () => {
    const c = generateCentreKeypair();
    const other = generateCentreKeypair();
    const blob = await sealPiece(piece(), c.publicKey, 7n, 14);
    await expect(openPiece(blob, other.privateKey, c.publicKey, 7n, 14)).rejects.toThrow();
  });

  it("the wrong examId or centreId in the AAD fails", async () => {
    const c = generateCentreKeypair();
    const blob = await sealPiece(piece(), c.publicKey, 7n, 14);
    await expect(openPiece(blob, c.privateKey, c.publicKey, 8n, 14)).rejects.toThrow();
    await expect(openPiece(blob, c.privateKey, c.publicKey, 7n, 15)).rejects.toThrow();
  });

  it("a tampered blob fails", async () => {
    const c = generateCentreKeypair();
    const blob = await sealPiece(piece(), c.publicKey, 7n, 14);
    for (const i of [0, 32, 44, 92]) {
      const t = blob.slice();
      t[i] ^= 1;
      await expect(openPiece(t, c.privateKey, c.publicKey, 7n, 14)).rejects.toThrow();
    }
  });

  it("rejects wrong input lengths", async () => {
    const c = generateCentreKeypair();
    await expect(sealPiece(new Uint8Array(32), c.publicKey, 7n, 14)).rejects.toThrow();
    await expect(openPiece(new Uint8Array(92), c.privateKey, c.publicKey, 7n, 14)).rejects.toThrow();
  });
});
