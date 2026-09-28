import { describe, expect, it } from "vitest";
import {
  codeDistance,
  decodeFingerprint,
  encodeFingerprint,
  generateCodebook,
  lehmerIndex,
  permFromLehmer,
} from "../src/codebook";
import { paper12 } from "./fixtures/paper12";

const seedA = new Uint8Array(32).fill(1);
const seedB = new Uint8Array(32).fill(2);
const centres20 = Array.from({ length: 20 }, (_, i) => i + 1);

function allPerms(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => allPerms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe("Lehmer encoding", () => {
  it("round-trips all 24 permutations of 4 onto 0..23", () => {
    const perms = allPerms([0, 1, 2, 3]);
    expect(perms).toHaveLength(24);
    const seen = new Set<number>();
    for (const p of perms) {
      const idx = lehmerIndex(p);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(24);
      expect(permFromLehmer(idx, 4)).toEqual(p);
      seen.add(idx);
    }
    expect(seen.size).toBe(24);
    expect(lehmerIndex([0, 1, 2, 3])).toBe(0);
    expect(lehmerIndex([3, 2, 1, 0])).toBe(23);
  });

  it("rejects non-permutations and out-of-range indices", () => {
    expect(() => lehmerIndex([0, 0, 1, 2])).toThrow();
    expect(() => lehmerIndex([1, 2, 3, 4])).toThrow();
    expect(() => permFromLehmer(24, 4)).toThrow();
  });
});

describe("codebook", () => {
  const book = generateCodebook(paper12, centres20, seedA);

  it("has one complete code per centre", () => {
    expect(book.map((c) => c.centreId)).toEqual(centres20);
    for (const c of book) {
      expect([...c.order].sort()).toEqual(paper12.questions.map((q) => q.id));
      for (const q of paper12.questions) {
        expect([...c.optionPerms[q.id]].sort()).toEqual([0, 1, 2, 3]);
        expect([0, 1]).toContain(c.wordings[q.id]);
      }
    }
  });

  it("every pair of centres meets the §9 minimum distances (9 / 9 / 4 of 12)", () => {
    for (let i = 0; i < book.length; i++) {
      for (let j = i + 1; j < book.length; j++) {
        const d = codeDistance(book[i], book[j]);
        expect(d.position, `centres ${book[i].centreId}/${book[j].centreId}`).toBeGreaterThanOrEqual(9);
        expect(d.options).toBeGreaterThanOrEqual(9);
        expect(d.wording).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("the same seed gives the same codebook", () => {
    expect(generateCodebook(paper12, centres20, seedA)).toEqual(book);
  });

  it("a different seed gives a different codebook", () => {
    expect(generateCodebook(paper12, centres20, seedB)).not.toEqual(book);
  });

  it("rejects a bad seed or duplicate centre ids", () => {
    expect(() => generateCodebook(paper12, centres20, new Uint8Array(31))).toThrow();
    expect(() => generateCodebook(paper12, [1, 1], seedA)).toThrow();
  });
});

describe("fingerprint bytes (§7)", () => {
  const book = generateCodebook(paper12, centres20, seedA);

  it("is 37 bytes for 12 questions and round-trips", () => {
    for (const code of book) {
      const fp = encodeFingerprint(paper12, code);
      expect(fp.length).toBe(37);
      expect(fp[0]).toBe(0x01);
      expect(decodeFingerprint(paper12, code.centreId, fp)).toEqual(code);
    }
  });

  it("stores position, Lehmer index and wording per question in master order", () => {
    const code = book[13];
    const fp = encodeFingerprint(paper12, code);
    paper12.questions.forEach((q, i) => {
      expect(fp[1 + 3 * i]).toBe(code.order.indexOf(q.id) + 1);
      expect(fp[2 + 3 * i]).toBe(lehmerIndex(code.optionPerms[q.id]));
      expect(fp[3 + 3 * i]).toBe(code.wordings[q.id]);
    });
  });

  it("rejects malformed fingerprints", () => {
    const fp = encodeFingerprint(paper12, book[0]);
    expect(() => decodeFingerprint(paper12, 1, fp.slice(0, 36))).toThrow();
    const badVersion = fp.slice();
    badVersion[0] = 2;
    expect(() => decodeFingerprint(paper12, 1, badVersion)).toThrow();
    const dupPos = fp.slice();
    dupPos[4] = dupPos[1];
    expect(() => decodeFingerprint(paper12, 1, dupPos)).toThrow();
  });
});
