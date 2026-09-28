import type { MasterPaper } from "../paper";
import {
  OPTIONS_NEEDED_FOR_PERM,
  OPTION_MIN_SIMILARITY,
  QUESTION_MIN_MARGIN,
  QUESTION_MIN_SIMILARITY,
  WORDING_MIN_GAP,
} from "./constants";
import { similarity } from "./normalize";
import type { Extraction, Observation } from "./types";

const LABELS = ["A", "B", "C", "D"];

type Identified = Observation & { sim: number };

/**
 * Map an extracted question's options to master option indices and return the option
 * permutation (perm[labelIndex] = master option index), or null if fewer than 3 options
 * can be placed with confidence (§10).
 */
function inferOptionPerm(options: Extraction["questions"][number]["options"], masterOptions: readonly string[]): number[] | null {
  // Label index: the printed label if present, otherwise the position when all 4 options are visible.
  const labelled = options
    .map((o, i) => {
      const fromLabel = o.label ? LABELS.indexOf(o.label.toUpperCase()) : -1;
      const label = fromLabel >= 0 ? fromLabel : options.length === 4 ? i : -1;
      return { label, text: o.text };
    })
    .filter((o) => o.label >= 0);

  // One-to-one assignment, best similarity first (deterministic tie-break by indices).
  const pairs: { e: number; m: number; s: number }[] = [];
  labelled.forEach((o, e) =>
    masterOptions.forEach((mt, m) => {
      const s = similarity(o.text, mt);
      if (s >= OPTION_MIN_SIMILARITY) pairs.push({ e, m, s });
    }),
  );
  pairs.sort((a, b) => b.s - a.s || a.e - b.e || a.m - b.m);
  const perm: (number | undefined)[] = new Array(masterOptions.length).fill(undefined);
  const usedE = new Set<number>();
  const usedM = new Set<number>();
  for (const p of pairs) {
    const label = labelled[p.e].label;
    if (usedE.has(p.e) || usedM.has(p.m) || perm[label] !== undefined) continue;
    perm[label] = p.m;
    usedE.add(p.e);
    usedM.add(p.m);
  }
  const placed = perm.filter((v) => v !== undefined).length;
  if (placed < OPTIONS_NEEDED_FOR_PERM) return null;
  if (placed === masterOptions.length - 1) {
    const missingLabel = perm.findIndex((v) => v === undefined);
    const missingMaster = masterOptions.findIndex((_, m) => !usedM.has(m));
    perm[missingLabel] = missingMaster;
  }
  return perm.every((v) => v !== undefined) ? (perm as number[]) : null;
}

/**
 * Deterministic question identification (§10). For each transcribed question, find the best of the
 * 24 (question, wording) candidates; accept it only at similarity ≥ 0.55 and a lead of ≥ 0.10 over
 * every other question. If two transcribed questions pick the same question, the stronger one wins.
 */
export function identifyQuestions(x: Extraction, master: MasterPaper): Observation[] {
  const n = master.questions.length;
  const byQid = new Map<string, Identified>();

  for (const eq of x.questions) {
    const scored = master.questions.map((mq) => {
      const s0 = similarity(eq.text, mq.wordings[0]);
      const s1 = similarity(eq.text, mq.wordings[1]);
      return { mq, s0, s1, best: Math.max(s0, s1) };
    });
    let top = scored[0];
    for (const c of scored) if (c.best > top.best) top = c;
    const runnerUp = Math.max(0, ...scored.filter((c) => c !== top).map((c) => c.best));
    if (top.best < QUESTION_MIN_SIMILARITY || top.best - runnerUp < QUESTION_MIN_MARGIN) continue;

    const gap = top.s0 - top.s1;
    const obs: Identified = {
      qid: top.mq.id,
      position: eq.printedNumber !== null && Number.isInteger(eq.printedNumber) && eq.printedNumber >= 1 && eq.printedNumber <= n ? eq.printedNumber : null,
      optionPerm: inferOptionPerm(eq.options, top.mq.options),
      wordingIndex: Math.abs(gap) >= WORDING_MIN_GAP ? (gap > 0 ? 0 : 1) : null,
      sim: top.best,
    };
    const prev = byQid.get(obs.qid);
    if (!prev || obs.sim > prev.sim) byQid.set(obs.qid, obs);
  }

  const order = new Map(master.questions.map((q, i) => [q.id, i]));
  return [...byQid.values()]
    .sort((a, b) => order.get(a.qid)! - order.get(b.qid)!)
    .map(({ qid, position, optionPerm, wordingIndex }) => ({ qid, position, optionPerm, wordingIndex }));
}
