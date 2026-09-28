import type { CentreCode } from "../codebook";
import type { MasterPaper } from "../paper";
import { buildVariant } from "../variant";
import type { Extraction } from "./types";

/**
 * A perfect transcription of the given printed positions (1-based) of a centre's variant.
 * Used by tests and by `ops simulate` (which adds noise on top).
 */
export function syntheticExtraction(master: MasterPaper, code: CentreCode, positions?: number[]): Extraction {
  const v = buildVariant(master, code);
  const keep = new Set(positions ?? v.questions.map((q) => q.number));
  return {
    questions: v.questions
      .filter((q) => keep.has(q.number))
      .map((q) => ({ printedNumber: q.number, text: q.text, options: q.options.map((o) => ({ label: o.label, text: o.text })) })),
    legibility: "good",
  };
}
