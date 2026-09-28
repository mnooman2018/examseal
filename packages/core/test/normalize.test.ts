import { describe, expect, it } from "vitest";
import { normalizeText, similarity, wordEditDistance } from "../src/forensic/normalize";

describe("normalize and similarity (§10)", () => {
  it("normalises case, punctuation and whitespace", () => {
    expect(normalizeText("  First-In-First-Out,   PRINCIPLE?! ")).toBe("first in first out principle");
    expect(normalizeText("ﬁle")).toBe("file"); // NFKC ligature
  });

  it("scores identical text 1 and unrelated text low", () => {
    expect(similarity("Which data structure is FIFO?", "which data structure is fifo")).toBe(1);
    expect(similarity("Which data structure is FIFO?", "The mitochondria is the powerhouse")).toBeLessThan(0.3);
    expect(similarity("", "")).toBe(0);
  });

  it("tolerates small typos", () => {
    expect(similarity("Which data structure follows FIFO", "Whlch data strueture follows FIFO")).toBeGreaterThan(0.7);
  });

  it("counts word-level edits", () => {
    expect(wordEditDistance("a b c d", "a b c d")).toBe(0);
    expect(wordEditDistance("a b c d", "a x c d e")).toBe(2);
  });
});
