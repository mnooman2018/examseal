import { describe, expect, it } from "vitest";
import { aesGcmDecrypt, aesGcmEncrypt, generateAesKey } from "../src/aes";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("aes-256-gcm", () => {
  it("round-trips with layout nonce(12) || ciphertext || tag(16)", async () => {
    const key = generateAesKey();
    expect(key.length).toBe(32);
    const pt = utf8("the exam paper");
    const blob = await aesGcmEncrypt(key, pt, utf8("aad"));
    expect(blob.length).toBe(12 + pt.length + 16);
    expect(await aesGcmDecrypt(key, blob, utf8("aad"))).toEqual(pt);
  });

  it("uses a fresh nonce each time", async () => {
    const key = generateAesKey();
    const a = await aesGcmEncrypt(key, utf8("x"), utf8("aad"));
    const b = await aesGcmEncrypt(key, utf8("x"), utf8("aad"));
    expect(a.slice(0, 12)).not.toEqual(b.slice(0, 12));
  });

  it("fails on a tampered blob (nonce, ciphertext or tag)", async () => {
    const key = generateAesKey();
    const blob = await aesGcmEncrypt(key, utf8("the exam paper"), utf8("aad"));
    for (const i of [0, 12, blob.length - 1]) {
      const t = blob.slice();
      t[i] ^= 1;
      await expect(aesGcmDecrypt(key, t, utf8("aad"))).rejects.toThrow();
    }
  });

  it("fails with the wrong AAD", async () => {
    const key = generateAesKey();
    const blob = await aesGcmEncrypt(key, utf8("the exam paper"), utf8("examseal/v1/variant/1/14"));
    await expect(aesGcmDecrypt(key, blob, utf8("examseal/v1/variant/1/15"))).rejects.toThrow();
  });

  it("fails with the wrong key", async () => {
    const blob = await aesGcmEncrypt(generateAesKey(), utf8("x"), utf8("aad"));
    await expect(aesGcmDecrypt(generateAesKey(), blob, utf8("aad"))).rejects.toThrow();
  });

  it("rejects keys that are not 32 bytes and blobs that are too short", async () => {
    await expect(aesGcmEncrypt(new Uint8Array(16), utf8("x"), utf8("aad"))).rejects.toThrow();
    await expect(aesGcmDecrypt(generateAesKey(), new Uint8Array(27), utf8("aad"))).rejects.toThrow();
  });
});
