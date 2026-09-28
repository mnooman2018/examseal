import type { CentreCode } from "../codebook";
import type { CentreScore, Observation } from "./types";

/**
 * For each centre: observed = number of non-null features, matched = how many of those equal the
 * centre's code (§10). Per-question detail drives the ✓/✗ table. Sorted by matched, descending;
 * ties by centre id so the order is deterministic.
 */
export function scoreCentres(obs: Observation[], codebook: CentreCode[]): CentreScore[] {
  const scores = codebook.map((code) => {
    let matched = 0;
    let observed = 0;
    const perQuestion: CentreScore["perQuestion"] = {};
    for (const o of obs) {
      const d: CentreScore["perQuestion"][string] = {};
      if (o.position !== null) {
        observed++;
        d.position = code.order[o.position - 1] === o.qid;
        if (d.position) matched++;
      }
      if (o.optionPerm !== null) {
        observed++;
        const p = code.optionPerms[o.qid];
        d.options = !!p && p.length === o.optionPerm.length && p.every((v, i) => v === o.optionPerm![i]);
        if (d.options) matched++;
      }
      if (o.wordingIndex !== null) {
        observed++;
        d.wording = code.wordings[o.qid] === o.wordingIndex;
        if (d.wording) matched++;
      }
      perQuestion[o.qid] = d;
    }
    return { centreId: code.centreId, matched, observed, perQuestion };
  });
  return scores.sort((a, b) => b.matched - a.matched || a.centreId - b.centreId);
}
