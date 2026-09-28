import { encodeAbiParameters, keccak256 } from "viem";
import { canonicalJson } from "./canonical";
import type { EvidenceReport } from "./forensic/types";
import { concatBytes, type Hex, toHexBytes, utf8 } from "./hex";
import type { MasterPaper } from "./paper";

function check32(name: string, b: Uint8Array): void {
  if (b.length !== 32) throw new Error(`${name} must be 32 bytes, got ${b.length}`);
}

/** keccak256(utf8(canonicalJson(master)) || paperSalt32) */
export function paperCommitment(master: MasterPaper, salt: Uint8Array): Hex {
  check32("paper salt", salt);
  return keccak256(concatBytes(utf8(canonicalJson(master)), salt));
}

/** keccak256(aesBlob). The contract computes the same value on-chain. */
export function variantCommitment(blob: Uint8Array): Hex {
  return keccak256(blob);
}

/** keccak256(abi.encode(uint256 examId, uint32 centreId, bytes fingerprint, bytes32 salt)) */
export function fingerprintCommitment(examId: bigint, centreId: number, fingerprint: Uint8Array, salt: Uint8Array): Hex {
  check32("fingerprint salt", salt);
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint32" }, { type: "bytes" }, { type: "bytes32" }],
      [examId, centreId, toHexBytes(fingerprint), toHexBytes(salt)],
    ),
  );
}

/** keccak256(utf8(canonicalJson(evidenceReport))) */
export function evidenceHash(report: EvidenceReport): Hex {
  return keccak256(utf8(canonicalJson(report)));
}

/** keccak256(utf8(reasonText)), used by revokeCentre (CLAUDE.md §7). */
export function reasonHash(reasonText: string): Hex {
  return keccak256(utf8(reasonText));
}
