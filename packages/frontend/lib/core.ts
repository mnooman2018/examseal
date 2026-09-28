/**
 * Adapter for Sampurna's `examseal-core` package (CLAUDE.md §8).
 * The frontend never implements crypto itself; /centre imports decryption from here.
 */
export { recoverVariant, renderVariantHtml } from "examseal-core";
export type { VariantPaper } from "examseal-core";
export const CORE_AVAILABLE = true;
