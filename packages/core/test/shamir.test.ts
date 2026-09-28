import { describe, expect, it } from "vitest";
import { generateAesKey } from "../src/aes";
import { combinePieces, splitKey } from "../src/shamir";
import { combinations } from "./helpers";

describe("shamir 3-of-5", () => {
  it("gives 5 pieces of 33 bytes by default", async () => {
    const pieces = await splitKey(generateAesKey());
    expect(pieces).toHaveLength(5);
    for (const p of pieces) expect(p.length).toBe(33);
  });

  it("any 3 of 5 pieces recover the key (all 10 combinations)", async () => {
    const key = generateAesKey();
    const pieces = await splitKey(key, 5, 3);
    const all = combinations([0, 1, 2, 3, 4], 3);
    expect(all).toHaveLength(10);
    for (const c of all) expect(await combinePieces(c.map((i) => pieces[i]))).toEqual(key);
  });

  it("2 pieces do not recover the key", async () => {
    const key = generateAesKey();
    const pieces = await splitKey(key, 5, 3);
    for (const c of combinations([0, 1, 2, 3, 4], 2)) {
      expect(await combinePieces(c.map((i) => pieces[i]))).not.toEqual(key);
    }
  });

  it("rejects a key that is not 32 bytes", async () => {
    await expect(splitKey(new Uint8Array(16))).rejects.toThrow();
  });
});
