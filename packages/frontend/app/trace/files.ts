import { type CandidateCode, type CentreCode, type MasterPaper, validateMasterPaper } from "examseal-core";

// Parsers for the two authority files /trace needs. Both are read into React state only:
// never persisted, never sent to any server (§10 step 4).

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseMasterPaperFile(raw: unknown): ParseResult<MasterPaper> {
  const r = validateMasterPaper(raw);
  if (r.ok) return { ok: true, value: r.paper };
  return { ok: false, error: `This is not a valid master paper: ${r.errors[0]}${r.errors.length > 1 ? ` (+${r.errors.length - 1} more)` : ""}` };
}

const isPerm4 = (v: unknown) =>
  Array.isArray(v) && v.length === 4 && [...v].sort().every((x, i) => x === i);

/**
 * codebook.secret.json (§7): { version, codebookSeed, centres: CentreCode[] }.
 * Only `centres` is kept; the seed is dropped immediately. Every centre must cover exactly the
 * master paper's questions.
 */
export function parseCodebookFile(raw: unknown, master: MasterPaper): ParseResult<CentreCode[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Not a JSON object." };
  const centres = (raw as { centres?: unknown }).centres;
  if (!Array.isArray(centres) || centres.length === 0) {
    return { ok: false, error: "No centres list. Is this codebook.secret.json?" };
  }
  const qids = master.questions.map((q) => q.id);
  const want = [...qids].sort().join();
  const out: CentreCode[] = [];
  for (const c of centres) {
    const o = c as Partial<CentreCode>;
    if (!Number.isInteger(o.centreId)) return { ok: false, error: "A centre entry has no centreId." };
    const label = `centre ${o.centreId}`;
    if (!Array.isArray(o.order) || [...o.order].sort().join() !== want) {
      return { ok: false, error: `${label}: its question order does not match this master paper (${qids.length} questions). Wrong paper or wrong codebook?` };
    }
    for (const q of qids) {
      if (!isPerm4(o.optionPerms?.[q])) return { ok: false, error: `${label}: bad option order for ${q}.` };
      if (o.wordings?.[q] !== 0 && o.wordings?.[q] !== 1) return { ok: false, error: `${label}: bad wording for ${q}.` };
    }
    out.push({ centreId: o.centreId!, order: [...o.order], optionPerms: { ...o.optionPerms! }, wordings: { ...o.wordings! } });
  }
  if (new Set(out.map((c) => c.centreId)).size !== out.length) return { ok: false, error: "Duplicate centre ids in the codebook." };
  return { ok: true, value: out.sort((a, b) => a.centreId - b.centreId) };
}

/**
 * candidates.secret.json (D9): { version, examId, seats, candidates: CandidateCode[] }. Seat variants are
 * derived from each exam's centre keys, so the file must belong to the exam being traced. Every seat
 * must belong to a centre in the loaded codebook and cover the master paper's questions.
 */
export function parseCandidatesFile(raw: unknown, master: MasterPaper, codebook: CentreCode[], examId: string): ParseResult<CandidateCode[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Not a JSON object." };
  const o = raw as { examId?: unknown; candidates?: unknown };
  if (!Array.isArray(o.candidates) || o.candidates.length === 0) return { ok: false, error: "No candidates list. Is this candidates.secret.json?" };
  if (String(o.examId) !== examId) {
    return { ok: false, error: `This seat file is for exam #${String(o.examId)}, but you are tracing exam #${examId}. Seat variants differ per exam.` };
  }
  const centres = new Set(codebook.map((c) => c.centreId));
  const want = master.questions.map((q) => q.id).sort().join();
  const out: CandidateCode[] = [];
  for (const c of o.candidates as Partial<CandidateCode>[]) {
    if (!Number.isInteger(c.centreId) || !Number.isInteger(c.seat)) return { ok: false, error: "A seat entry has no centreId or seat." };
    if (!centres.has(c.centreId!)) return { ok: false, error: `Seat file has centre ${c.centreId}, which is not in the codebook.` };
    if (!Array.isArray(c.order) || [...c.order].sort().join() !== want) return { ok: false, error: `Centre ${c.centreId} seat ${c.seat}: question order does not match this paper.` };
    for (const q of master.questions.map((x) => x.id)) {
      if (!isPerm4(c.optionPerms?.[q])) return { ok: false, error: `Centre ${c.centreId} seat ${c.seat}: bad option order for ${q}.` };
      if (c.wordings?.[q] !== 0 && c.wordings?.[q] !== 1) return { ok: false, error: `Centre ${c.centreId} seat ${c.seat}: bad wording for ${q}.` };
    }
    out.push({ centreId: c.centreId!, seat: c.seat!, order: [...c.order], optionPerms: { ...c.optionPerms! }, wordings: { ...c.wordings! } });
  }
  return { ok: true, value: out };
}
