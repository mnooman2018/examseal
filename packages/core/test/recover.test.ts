import { describe, expect, it } from "vitest";
import { variantAad } from "../src/aad";
import { aesGcmEncrypt, generateAesKey } from "../src/aes";
import { recoverVariant } from "../src/recover";
import { generateCentreKeypair, sealPiece } from "../src/seal";
import { splitKey } from "../src/shamir";
import { combinations } from "./helpers";

const examId = 3n;
const centreId = 14;

async function setup() {
  const centre = generateCentreKeypair();
  const key = generateAesKey();
  const plaintext = new TextEncoder().encode(JSON.stringify({ paper: "a centre variant" }));
  const ciphertext = await aesGcmEncrypt(key, plaintext, variantAad(examId, centreId));
  const pieces = await splitKey(key, 5, 3);
  const sealed = await Promise.all(pieces.map((p) => sealPiece(p, centre.publicKey, examId, centreId)));
  return { centre, plaintext, ciphertext, pieces, sealed };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const args = (s: Setup, sealedPieces: Uint8Array[]) => ({
  sealedPieces,
  centreSk: s.centre.privateKey,
  centrePk: s.centre.publicKey,
  ciphertext: s.ciphertext,
  examId,
  centreId,
  threshold: 3,
});

describe("recoverVariant (G2 round trip)", () => {
  it("encrypt → split → seal → open any 3 → decrypt", async () => {
    const s = await setup();
    for (const idx of combinations([0, 1, 2, 3, 4], 3)) {
      const r = await recoverVariant(args(s, idx.map((i) => s.sealed[i])));
      expect(r.plaintext).toEqual(s.plaintext);
      expect(r.usedPieceIndices).toEqual([0, 1, 2]);
      expect(r.badPieceIndices).toEqual([]);
    }
  });

  it("2 pieces fail", async () => {
    const s = await setup();
    for (const idx of combinations([0, 1, 2, 3, 4], 2)) {
      await expect(recoverVariant(args(s, idx.map((i) => s.sealed[i])))).rejects.toThrow();
    }
  });

  it("1 bad piece among 4 (garbage blob) still succeeds and reports the bad index", async () => {
    const s = await setup();
    const garbage = globalThis.crypto.getRandomValues(new Uint8Array(93));
    const r = await recoverVariant(args(s, [s.sealed[0], garbage, s.sealed[2], s.sealed[4]]));
    expect(r.plaintext).toEqual(s.plaintext);
    expect(r.badPieceIndices).toEqual([1]);
    expect(r.usedPieceIndices).toEqual([0, 2, 3]);
  });

  it("1 bad piece among 4 (correctly sealed but wrong share) still succeeds and reports the bad index", async () => {
    const s = await setup();
    const wrong = s.pieces[3].slice();
    wrong[0] ^= 0xff; // corrupt a y-value, keep the x-coordinate (last byte)
    const wrongSealed = await sealPiece(wrong, s.centre.publicKey, examId, centreId);
    const r = await recoverVariant(args(s, [wrongSealed, s.sealed[0], s.sealed[1], s.sealed[2]]));
    expect(r.plaintext).toEqual(s.plaintext);
    expect(r.badPieceIndices).toEqual([0]);
    expect(r.usedPieceIndices).toEqual([1, 2, 3]);
  });

  it("fails when the ciphertext belongs to another centre id", async () => {
    const s = await setup();
    await expect(recoverVariant({ ...args(s, s.sealed.slice(0, 3)), centreId: 15 })).rejects.toThrow();
  });
});
