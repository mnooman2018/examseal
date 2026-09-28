import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeFingerprint, encodeFingerprint } from "../src/codebook";
import { fingerprintCommitment } from "../src/commit";
import { type Hex, fromHexBytes } from "../src/hex";
import { paper12 } from "./fixtures/paper12";

// Shared fixture owned by packages/contracts. The contract test
// "cross-check: TypeScript fingerprint commitment equals Solidity abi.encode" registers
// this commitment and proves revealFingerprint accepts it, i.e. Solidity's
// keccak256(abi.encode(examId, centreId, fingerprint, salt)) equals it. This test proves
// examseal-core computes the same value from the same inputs (CLAUDE.md §7, G2).
const fixturePath = fileURLToPath(
  new URL("../../contracts/test/fixtures/fingerprint-commitment.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  examId: string;
  centreId: number;
  fingerprint: Hex;
  salt: Hex;
  fingerprintCommitment: Hex;
};

describe("cross-check with the Solidity contract (G2)", () => {
  it("examseal-core fingerprintCommitment equals the commitment the contract accepts", () => {
    const got = fingerprintCommitment(
      BigInt(fixture.examId),
      fixture.centreId,
      fromHexBytes(fixture.fingerprint),
      fromHexBytes(fixture.salt),
    );
    expect(got).toBe(fixture.fingerprintCommitment);
  });

  it("the fixture fingerprint is a valid 37-byte §7 fingerprint", () => {
    const bytes = fromHexBytes(fixture.fingerprint);
    expect(bytes.length).toBe(37);
    const code = decodeFingerprint(paper12, fixture.centreId, bytes);
    expect(encodeFingerprint(paper12, code)).toEqual(bytes);
  });
});
