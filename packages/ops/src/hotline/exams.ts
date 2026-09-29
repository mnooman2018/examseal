import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { CandidateCode, CentreCode } from "examseal-core";

/** Secret files for one exam, found under demo-data/secrets/exam-<id>/. They never leave this laptop. */
export type ExamFiles = { id: bigint; dir: string; codebook: CentreCode[]; candidates: CandidateCode[] | null };

/**
 * Every exam with a codebook under `secretsDir` (exam-<id>/codebook.secret.json), sorted by id.
 * `only` keeps just that exam (the optional --exam filter). Problems with one exam's files are
 * returned as `skipped` so the others still load.
 */
export function discoverExams(secretsDir: string, only?: bigint): { exams: ExamFiles[]; skipped: string[] } {
  const exams: ExamFiles[] = [];
  const skipped: string[] = [];
  if (!existsSync(secretsDir)) return { exams, skipped };

  for (const name of readdirSync(secretsDir)) {
    const m = /^exam-(\d+)$/.exec(name);
    if (!m) continue;
    const id = BigInt(m[1]);
    if (only !== undefined && id !== only) continue;
    const dir = path.join(secretsDir, name);
    const bookFile = path.join(dir, "codebook.secret.json");
    if (!existsSync(bookFile)) {
      skipped.push(`exam ${id}: no codebook.secret.json`);
      continue;
    }
    try {
      const codebook = (JSON.parse(readFileSync(bookFile, "utf8")) as { centres?: CentreCode[] }).centres;
      if (!Array.isArray(codebook) || codebook.length === 0) {
        skipped.push(`exam ${id}: codebook has no centres`);
        continue;
      }
      let candidates: CandidateCode[] | null = null;
      const candFile = path.join(dir, "candidates.secret.json");
      if (existsSync(candFile)) {
        const c = JSON.parse(readFileSync(candFile, "utf8")) as { examId?: string | number; candidates?: CandidateCode[] };
        if (String(c.examId) !== String(id)) {
          skipped.push(`exam ${id}: candidates.secret.json is for exam ${c.examId}`);
          continue;
        }
        candidates = c.candidates ?? null;
      }
      exams.push({ id, dir, codebook, candidates });
    } catch (e) {
      // Never echo the parser message: it can quote the secret file's contents.
      skipped.push(`exam ${id}: could not read its files (${e instanceof SyntaxError ? "not valid JSON" : (e as NodeJS.ErrnoException).code ?? "read error"})`);
    }
  }
  exams.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { exams, skipped };
}
