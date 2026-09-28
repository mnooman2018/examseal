// Text normalisation and similarity (CLAUDE.md §10). Deterministic; used by the
// matcher and by validateMasterPaper to check questions are clearly different.

/** NFKC, lowercase, punctuation → space, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  const n = normalizeText(s);
  return n ? n.split(" ") : [];
}

export function tokenJaccard(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function trigrams(s: string): Map<string, number> {
  const n = normalizeText(s);
  const out = new Map<string, number>();
  if (!n) return out;
  const padded = ` ${n} `;
  for (let i = 0; i + 3 <= padded.length; i++) {
    const g = padded.slice(i, i + 3);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Multiset Dice coefficient over character trigrams of the normalised text. */
export function trigramDice(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  let sizeA = 0;
  let sizeB = 0;
  let inter = 0;
  for (const c of A.values()) sizeA += c;
  for (const c of B.values()) sizeB += c;
  if (sizeA + sizeB === 0) return 0;
  for (const [g, c] of A) inter += Math.min(c, B.get(g) ?? 0);
  return (2 * inter) / (sizeA + sizeB);
}

/** max(token Jaccard, character-trigram Dice), in [0, 1]. */
export function similarity(a: string, b: string): number {
  return Math.max(tokenJaccard(a, b), trigramDice(a, b));
}

/** Word-level Levenshtein distance between the normalised texts. */
export function wordEditDistance(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}
