import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { canonicalJson } from "../src/canonical";
import {
  evidenceHash,
  fingerprintCommitment,
  paperCommitment,
  reasonHash,
  variantCommitment,
} from "../src/commit";
import type { EvidenceReport } from "../src/forensic/types";
import { toHexBytes } from "../src/hex";
import type { MasterPaper } from "../src/paper";

const utf8 = (s: string) => new TextEncoder().encode(s);
const word = (n: bigint) => n.toString(16).padStart(64, "0");

const master: MasterPaper = {
  version: 1,
  title: "T",
  subject: "S",
  durationMinutes: 30,
  instructions: "I",
  questions: [{ id: "Q01", wordings: ["a b c d", "e f g h"], options: ["w", "x", "y", "z"], answerIndex: 1 }],
};

describe("commitments", () => {
  it("paperCommitment = keccak256(utf8(canonicalJson(master)) || salt32)", () => {
    const salt = new Uint8Array(32).fill(7);
    const cj = utf8(canonicalJson(master));
    const joined = new Uint8Array(cj.length + 32);
    joined.set(cj);
    joined.set(salt, cj.length);
    expect(paperCommitment(master, salt)).toBe(keccak256(joined));
    expect(paperCommitment(master, new Uint8Array(32).fill(8))).not.toBe(paperCommitment(master, salt));
    expect(() => paperCommitment(master, new Uint8Array(31))).toThrow();
  });

  it("variantCommitment = keccak256(blob)", () => {
    const blob = new Uint8Array([1, 2, 3]);
    expect(variantCommitment(blob)).toBe(keccak256(blob));
  });

  it("fingerprintCommitment matches a hand-built abi.encode(uint256, uint32, bytes, bytes32)", () => {
    const fp = new Uint8Array(37).map((_, i) => i + 1);
    const salt = new Uint8Array(32).fill(0xaa);
    // head: examId | centreId | offset of the bytes tail (4 words = 0x80) | salt
    // tail: length | data right-padded to a multiple of 32 bytes
    const fpPadded = toHexBytes(fp).slice(2).padEnd(128, "0");
    const manual = `0x${word(5n)}${word(14n)}${word(0x80n)}${toHexBytes(salt).slice(2)}${word(37n)}${fpPadded}` as const;
    expect(fingerprintCommitment(5n, 14, fp, salt)).toBe(keccak256(manual));
  });

  it("fingerprintCommitment changes with every input and rejects a short salt", () => {
    const fp = new Uint8Array(37).fill(1);
    const salt = new Uint8Array(32).fill(2);
    const base = fingerprintCommitment(5n, 14, fp, salt);
    expect(fingerprintCommitment(6n, 14, fp, salt)).not.toBe(base);
    expect(fingerprintCommitment(5n, 15, fp, salt)).not.toBe(base);
    expect(fingerprintCommitment(5n, 14, fp.map((b, i) => (i === 3 ? 9 : b)), salt)).not.toBe(base);
    expect(fingerprintCommitment(5n, 14, fp, salt.map(() => 3))).not.toBe(base);
    expect(() => fingerprintCommitment(5n, 14, fp, new Uint8Array(31))).toThrow();
  });

  it("evidenceHash = keccak256(utf8(canonicalJson(report)))", () => {
    const report: EvidenceReport = {
      version: 1,
      examId: "5",
      imageSha256: toHexBytes(new Uint8Array(32)),
      extraction: { questions: [], legibility: "good" },
      observations: [],
      scores: [],
      decision: { kind: "NOT_THIS_EXAM", reason: "no questions identified" },
      matcherVersion: "test",
      createdAt: "2026-09-28T21:43:00.000Z",
    };
    expect(evidenceHash(report)).toBe(keccak256(utf8(canonicalJson(report))));
  });

  it("reasonHash = keccak256(utf8(reasonText))", () => {
    expect(reasonHash("leak traced to centre 14")).toBe(keccak256(utf8("leak traced to centre 14")));
  });
});
