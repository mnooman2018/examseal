import { variantAad } from "./aad";
import { aesGcmDecrypt } from "./aes";
import { bytesEqual } from "./hex";
import { openPiece } from "./seal";
import { combinePieces } from "./shamir";

function combinations(xs: number[], k: number): number[][] {
  if (k === 0) return [[]];
  if (xs.length < k) return [];
  const [head, ...tail] = xs;
  return [...combinations(tail, k - 1).map((c) => [head, ...c]), ...combinations(tail, k)];
}

/**
 * Open every sealed piece, then try each combination of `threshold` pieces until
 * AES-GCM authenticates the variant (C(5,3) = 10 tries at most).
 * Indices refer to positions in `sealedPieces`. A piece is reported bad if it fails
 * to open, or if swapping it into a working combination gives the wrong key.
 */
export async function recoverVariant(args: {
  sealedPieces: Uint8Array[];
  centreSk: Uint8Array;
  centrePk: Uint8Array;
  ciphertext: Uint8Array;
  examId: bigint;
  centreId: number;
  threshold: number;
}): Promise<{ plaintext: Uint8Array; usedPieceIndices: number[]; badPieceIndices: number[] }> {
  const { sealedPieces, centreSk, centrePk, ciphertext, examId, centreId, threshold } = args;
  if (!Number.isInteger(threshold) || threshold < 2) throw new Error("threshold must be an integer ≥ 2");

  const opened = new Map<number, Uint8Array>();
  const bad = new Set<number>();
  for (let i = 0; i < sealedPieces.length; i++) {
    try {
      opened.set(i, await openPiece(sealedPieces[i], centreSk, centrePk, examId, centreId));
    } catch {
      bad.add(i);
    }
  }
  if (opened.size < threshold) {
    throw new Error(
      `Not enough valid pieces: ${opened.size} opened, ${threshold} needed (${bad.size} could not be opened)`,
    );
  }

  const aad = variantAad(examId, centreId);
  for (const combo of combinations([...opened.keys()], threshold)) {
    let key: Uint8Array;
    try {
      key = await combinePieces(combo.map((i) => opened.get(i)!));
    } catch {
      continue; // e.g. duplicate x-coordinates
    }
    let plaintext: Uint8Array;
    try {
      plaintext = await aesGcmDecrypt(key, ciphertext, aad);
    } catch {
      continue;
    }
    // Check each remaining opened piece against the known-good key.
    const base = combo.slice(0, threshold - 1).map((i) => opened.get(i)!);
    for (const i of opened.keys()) {
      if (combo.includes(i)) continue;
      try {
        if (!bytesEqual(await combinePieces([...base, opened.get(i)!]), key)) bad.add(i);
      } catch {
        bad.add(i);
      }
    }
    return { plaintext, usedPieceIndices: combo, badPieceIndices: [...bad].sort((a, b) => a - b) };
  }
  throw new Error(`No combination of ${threshold} pieces decrypts this centre's paper`);
}
