/**
 * Adapter for Sampurna's `examseal-core` package (CLAUDE.md §8).
 *
 * TODO(examseal-core): `packages/core` does not exist yet, so importing it would break the
 * build. When it lands on main:
 *   1. add `"examseal-core": "workspace:*"` to packages/frontend/package.json dependencies,
 *   2. add "examseal-core" to transpilePackages in next.config.js,
 *   3. replace EVERYTHING below this comment with:
 *        export { recoverVariant, renderVariantHtml } from "examseal-core";
 *        export type { VariantPaper } from "examseal-core";
 *        export const CORE_AVAILABLE = true;
 * The frontend never implements crypto itself. Signatures here are copied verbatim from §8.
 */

export const CORE_AVAILABLE = false;

export type VariantPaper = {
  version: 1;
  examTitle: string;
  subject: string;
  durationMinutes: number;
  instructions: string;
  questions: { number: number; text: string; options: { label: "A" | "B" | "C" | "D"; text: string }[] }[];
};

const missing = (fn: string) =>
  new Error(`${fn} is provided by examseal-core, which is not merged yet. Decryption is unavailable in this build.`);

export async function recoverVariant(_args: {
  sealedPieces: Uint8Array[];
  centreSk: Uint8Array;
  centrePk: Uint8Array;
  ciphertext: Uint8Array;
  examId: bigint;
  centreId: number;
  threshold: number;
}): Promise<{ plaintext: Uint8Array; usedPieceIndices: number[]; badPieceIndices: number[] }> {
  throw missing("recoverVariant");
}

export function renderVariantHtml(_v: VariantPaper): string {
  throw missing("renderVariantHtml");
}
