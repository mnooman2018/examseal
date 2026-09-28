import type { CentreCode } from "./codebook";
import type { MasterPaper } from "./paper";

export type VariantPaper = {
  version: 1;
  examTitle: string;
  subject: string;
  durationMinutes: number;
  instructions: string;
  questions: { number: number; text: string; options: { label: "A" | "B" | "C" | "D"; text: string }[] }[];
}; // NO centre id, NO question ids, NO answers: exactly what gets printed

const LABELS = ["A", "B", "C", "D"] as const;

export function buildVariant(master: MasterPaper, code: CentreCode): VariantPaper {
  const byId = new Map(master.questions.map((q) => [q.id, q]));
  if (code.order.length !== master.questions.length || new Set(code.order).size !== code.order.length) {
    throw new Error(`centre ${code.centreId}: order must list every question exactly once`);
  }
  return {
    version: 1,
    examTitle: master.title,
    subject: master.subject,
    durationMinutes: master.durationMinutes,
    instructions: master.instructions,
    questions: code.order.map((qid, i) => {
      const q = byId.get(qid);
      if (!q) throw new Error(`centre ${code.centreId}: unknown question ${qid}`);
      const perm = code.optionPerms[qid];
      const w = code.wordings[qid];
      if (!perm || perm.length !== 4 || w === undefined) throw new Error(`centre ${code.centreId}: incomplete code for ${qid}`);
      return {
        number: i + 1,
        text: q.wordings[w],
        // optionPerm[j] = the master option index printed at label j
        options: perm.map((m, j) => ({ label: LABELS[j], text: q.options[m] })),
      };
    }),
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Printable page. The layout is identical for every centre; only the text differs. */
export function renderVariantHtml(v: VariantPaper): string {
  const questions = v.questions
    .map(
      (q) => `    <li class="q">
      <p class="qt"><span class="qn">${q.number}.</span> ${esc(q.text)}</p>
      <ol class="opts">
${q.options.map((o) => `        <li><span class="ol">(${o.label})</span> ${esc(o.text)}</li>`).join("\n")}
      </ol>
    </li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(v.examTitle)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Times New Roman", Times, serif; font-size: 13pt; line-height: 1.45; color: #000; background: #fff; margin: 0 auto; max-width: 180mm; }
  header { text-align: center; border-bottom: 1.5pt solid #000; padding-bottom: 6pt; margin-bottom: 10pt; }
  h1 { font-size: 16pt; margin: 0 0 4pt; }
  .meta { display: flex; justify-content: space-between; font-size: 12pt; margin-top: 6pt; }
  .instr { font-style: italic; margin: 0 0 10pt; }
  ol.qs { list-style: none; padding: 0; margin: 0; }
  li.q { margin: 0 0 11pt; break-inside: avoid; }
  .qt { margin: 0 0 3pt; }
  .qn { font-weight: bold; }
  ol.opts { list-style: none; padding: 0 0 0 22pt; margin: 0; }
  ol.opts li { margin: 1pt 0; }
</style>
</head>
<body>
  <header>
    <h1>${esc(v.examTitle)}</h1>
    <div>${esc(v.subject)}</div>
    <div class="meta"><span>Time: ${v.durationMinutes} minutes</span><span>Questions: ${v.questions.length}</span></div>
  </header>
  <p class="instr">${esc(v.instructions)}</p>
  <ol class="qs">
${questions}
  </ol>
</body>
</html>
`;
}
