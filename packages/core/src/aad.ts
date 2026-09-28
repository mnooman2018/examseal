import { utf8 } from "./hex";

function checkIds(examId: bigint, centreId: number): void {
  if (typeof examId !== "bigint" || examId < 0n) throw new Error("examId must be a non-negative bigint");
  if (!Number.isInteger(centreId) || centreId < 0 || centreId > 0xffffffff) {
    throw new Error("centreId must be a uint32");
  }
}

/** AAD for a centre's AES variant blob (CLAUDE.md §7). */
export function variantAad(examId: bigint, centreId: number): Uint8Array {
  checkIds(examId, centreId);
  return utf8(`examseal/v1/variant/${examId}/${centreId}`);
}

/** AAD for a sealed Shamir piece (CLAUDE.md §7). */
export function shareAad(examId: bigint, centreId: number): Uint8Array {
  checkIds(examId, centreId);
  return utf8(`examseal/v1/share/${examId}/${centreId}`);
}
