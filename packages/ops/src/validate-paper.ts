import { validateMasterPaper } from "examseal-core";
import { readJson, rel, resolvePaperPath } from "./env";

/** pnpm ops validate-paper [--paper <path>] */
export function validatePaper(opts: { paper?: string }): number {
  const file = resolvePaperPath(opts.paper);
  const result = validateMasterPaper(readJson(file));
  if (result.ok) {
    const p = result.paper;
    console.log(`OK: ${rel(file)} follows the §9 rules.`);
    console.log(`  "${p.title}" · ${p.subject} · ${p.durationMinutes} min · ${p.questions.length} questions`);
    return 0;
  }
  console.log(`${rel(file)}: ${result.errors.length} problem(s):`);
  result.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  return 1;
}
