import { normalizeText, similarity, wordEditDistance } from "./forensic/normalize";

export type MasterQuestion = {
  id: string;
  wordings: [string, string];
  options: [string, string, string, string];
  answerIndex: 0 | 1 | 2 | 3;
};

export type MasterPaper = {
  version: 1;
  title: string;
  subject: string;
  durationMinutes: number;
  instructions: string;
  questions: MasterQuestion[];
};

// Mechanical checks for the §9 authoring rules.
export const PAPER_QUESTION_COUNT = 12;
export const MIN_WORDING_WORD_DIFF = 3;
export const MAX_OPTION_WORDS = 8;
/**
 * Rule 6: the matcher accepts a question only at similarity ≥ 0.55 with a 0.10 lead
 * over every other question. Wordings of different questions must stay well below that.
 */
export const MAX_CROSS_QUESTION_SIMILARITY = 0.5;

const POSITIONAL_OPTION_PATTERNS: [RegExp, string][] = [
  [/\b(all|none) of (the|these)\b/i, `refers to other options ("all/none of the ...")`],
  [/\b(above|below)\b/i, `refers to other options' positions ("above/below")`],
  [/\b(option|choice|answer)s?\s*\(?[A-D]\)?(\W|$)/i, `refers to another option by label`],
  [/\b[A-D]\s*(and|or|&|,)\s*[A-D]\b/, `refers to other options by label ("A and B")`],
];

const QUESTION_NUMBER_REF = /\b(question|q)\s*(no\.?|number|#)?\s*\d+\b/i;

function plainTextProblem(s: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(s)) return "contains line breaks or control characters";
  if (/<\/?[a-z][^>]*>/i.test(s)) return "contains HTML tags";
  if (/\$[^$]+\$/.test(s) || /\\[a-zA-Z]{2,}/.test(s)) return "contains LaTeX";
  if (/!\[/.test(s) || (s.match(/\|/g)?.length ?? 0) >= 2) return "contains markdown images or tables";
  return null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function validateMasterPaper(p: unknown): { ok: true; paper: MasterPaper } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof p !== "object" || p === null || Array.isArray(p)) return { ok: false, errors: ["paper must be a JSON object"] };
  const o = p as Record<string, unknown>;

  if (o.version !== 1) errors.push(`version must be 1`);
  for (const f of ["title", "subject", "instructions"] as const) {
    if (!isNonEmptyString(o[f])) errors.push(`${f} must be a non-empty string`);
    else {
      const bad = plainTextProblem(o[f] as string);
      if (bad) errors.push(`${f} ${bad}`);
    }
  }
  if (!Number.isSafeInteger(o.durationMinutes) || (o.durationMinutes as number) <= 0) {
    errors.push("durationMinutes must be a positive integer");
  }
  if (!Array.isArray(o.questions)) {
    errors.push("questions must be an array");
    return { ok: false, errors };
  }
  const qs = o.questions as unknown[];
  if (qs.length !== PAPER_QUESTION_COUNT) {
    errors.push(`rule 1: expected exactly ${PAPER_QUESTION_COUNT} questions, got ${qs.length}`);
  }

  const wellFormed: { idx: number; id: string; wordings: string[] }[] = [];
  qs.forEach((raw, i) => {
    const expectedId = `Q${String(i + 1).padStart(2, "0")}`;
    const where = `question ${i + 1}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${where}: must be an object`);
      return;
    }
    const q = raw as Record<string, unknown>;
    const id = q.id;
    const label = typeof id === "string" ? `${where} (${id})` : where;
    if (id !== expectedId) errors.push(`${label}: rule 1: id must be "${expectedId}" (ids Q01–Q12 in order)`);

    // Wordings (rule 2, 5)
    let wordingsOk = false;
    if (!Array.isArray(q.wordings) || q.wordings.length !== 2 || !q.wordings.every(isNonEmptyString)) {
      errors.push(`${label}: wordings must be exactly 2 non-empty strings`);
    } else {
      wordingsOk = true;
      const [w0, w1] = q.wordings as string[];
      const d = wordEditDistance(w0, w1);
      if (d < MIN_WORDING_WORD_DIFF) {
        errors.push(`${label}: rule 2: the two wordings differ by ${d} word(s); need at least ${MIN_WORDING_WORD_DIFF}`);
      }
      (q.wordings as string[]).forEach((w, wi) => {
        const bad = plainTextProblem(w);
        if (bad) errors.push(`${label}: rule 5: wording ${wi + 1} ${bad}`);
        if (QUESTION_NUMBER_REF.test(w)) errors.push(`${label}: rule 5: wording ${wi + 1} refers to another question number`);
      });
    }

    // Options (rule 3, 4)
    if (!Array.isArray(q.options) || q.options.length !== 4 || !q.options.every(isNonEmptyString)) {
      errors.push(`${label}: rule 3: options must be exactly 4 non-empty strings`);
    } else {
      const opts = q.options as string[];
      const seen = new Map<string, number>();
      opts.forEach((opt, oi) => {
        const L = "ABCD"[oi];
        const words = opt.trim().split(/\s+/).length;
        if (words > MAX_OPTION_WORDS) errors.push(`${label}: rule 3: option ${L} has ${words} words; max ${MAX_OPTION_WORDS}`);
        const n = normalizeText(opt);
        if (seen.has(n)) errors.push(`${label}: rule 3: option ${L} is the same as option ${"ABCD"[seen.get(n)!]}`);
        else seen.set(n, oi);
        for (const [re, why] of POSITIONAL_OPTION_PATTERNS) {
          if (re.test(opt)) errors.push(`${label}: rule 4: option ${L} ${why}; options are shuffled per centre`);
        }
        const bad = plainTextProblem(opt);
        if (bad) errors.push(`${label}: rule 5: option ${L} ${bad}`);
      });
    }

    if (![0, 1, 2, 3].includes(q.answerIndex as number)) errors.push(`${label}: answerIndex must be 0, 1, 2 or 3`);

    if (wordingsOk && typeof id === "string") wellFormed.push({ idx: i, id, wordings: q.wordings as string[] });
  });

  // Rule 6: questions must be clearly different from each other.
  for (let a = 0; a < wellFormed.length; a++) {
    for (let b = a + 1; b < wellFormed.length; b++) {
      let worst = 0;
      for (const wa of wellFormed[a].wordings) for (const wb of wellFormed[b].wordings) worst = Math.max(worst, similarity(wa, wb));
      if (worst > MAX_CROSS_QUESTION_SIMILARITY) {
        errors.push(
          `rule 6: ${wellFormed[a].id} and ${wellFormed[b].id} are too similar (text similarity ${worst.toFixed(2)} > ${MAX_CROSS_QUESTION_SIMILARITY}); reword one of them`,
        );
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, paper: p as MasterPaper };
}
