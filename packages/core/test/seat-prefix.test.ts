import { describe, expect, it } from "vitest";
import { deriveCandidateSeed, generateCandidates, generateSeatOps, seatCode } from "../src/candidate";
import { generateCodebook } from "../src/codebook";
import { generateCentreKeypair } from "../src/seal";
import { paper12 } from "./fixtures/paper12";

describe("seat ops are a stable prefix", () => {
  it("seat M is the same whether 1..M or 1..30 seats are generated (the digital page relies on this)", () => {
    for (let k = 0; k < 5; k++) {
      const seed = deriveCandidateSeed(generateCentreKeypair().privateKey);
      const all = generateSeatOps(12, seed, Array.from({ length: 30 }, (_, i) => i + 1));
      for (const m of [1, 2, 7, 15, 30]) {
        const prefix = generateSeatOps(12, seed, Array.from({ length: m }, (_, i) => i + 1));
        expect(prefix[m - 1]).toEqual(all[m - 1]);
      }
    }
  });

  it("the page's seat equals the authority's seat file entry (same centre key)", () => {
    const [centre] = generateCodebook(paper12, [14], new Uint8Array(32).fill(3));
    const key = generateCentreKeypair();
    const seed = deriveCandidateSeed(key.privateKey);
    const authority = generateCandidates(paper12, centre, seed, Array.from({ length: 30 }, (_, i) => i + 1));
    const seat9page = generateSeatOps(12, seed, Array.from({ length: 9 }, (_, i) => i + 1))[8];
    expect(seatCode(centre, seat9page)).toEqual(authority[8]);
  });
});
