import type { Extraction } from "./types";

// Deterministic parser for leaked text that was pasted or retyped (digital exams, D9).
// No AI is involved; the UI labels the result "Pasted text".

const QUESTION = /^\s*(?:q(?:uestion)?\s*\.?\s*)?(\d{1,3})\s*[.):\]-]\s*(.*)$/i;
// An option marker: "(A)", "A)", "A.", "a)" at the start or after whitespace, followed by text.
const OPTION_MARK = /(?:^|\s)\(?([A-Da-d])\s*[).:\]](?=\s|$)/g;

type Q = Extraction["questions"][number];

/** Split a line into [text before the first option, ...options] when it contains option markers. */
function splitOptions(line: string): { before: string; options: { label: string; text: string }[] } | null {
  const marks = [...line.matchAll(OPTION_MARK)];
  // Require the markers to run A, B, C… in order (so "A. Einstein" alone is not mistaken for a list).
  if (marks.length === 0) return null;
  const labels = marks.map((m) => m[1].toUpperCase());
  const inOrder = labels.every((l, i) => i === 0 || l.charCodeAt(0) === labels[i - 1].charCodeAt(0) + 1);
  if (!inOrder) return null;
  const startsAtLineStart = line.slice(0, marks[0].index! + marks[0][0].length).trim() === marks[0][0].trim();
  if (marks.length === 1 && !startsAtLineStart) return null;
  const options = marks.map((m, i) => {
    const from = m.index! + m[0].length;
    const to = i + 1 < marks.length ? marks[i + 1].index! : line.length;
    return { label: labels[i], text: line.slice(from, to).trim() };
  });
  return { before: line.slice(0, marks[0].index!).trim(), options: options.filter((o) => o.text.length > 0) };
}

/**
 * Turn pasted/retyped exam text into an Extraction: numbered questions ("1.", "1)", "Q1.",
 * "Question 1:"), options ("(A)", "A)", "A.", "a)", one per line or several on a line), and
 * wrapped lines. If no numbered question is found, blank-line-separated blocks become questions
 * with no printed number.
 */
export function parsePastedText(text: string): Extraction {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const questions: Q[] = [];
  let cur: Q | null = null;

  const addLine = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    const qm = QUESTION.exec(line);
    if (qm && qm[2].trim()) {
      cur = { printedNumber: Number(qm[1]), text: "", options: [] };
      questions.push(cur);
      const split = splitOptions(qm[2]);
      if (split) {
        cur.text = split.before;
        cur.options.push(...split.options);
      } else cur.text = qm[2].trim();
      return;
    }
    if (!cur) {
      cur = { printedNumber: null, text: line, options: [] };
      questions.push(cur);
      return;
    }
    const split = splitOptions(line);
    if (split) {
      if (split.before) cur.options.length ? (cur.options[cur.options.length - 1].text += ` ${split.before}`) : (cur.text += ` ${split.before}`);
      cur.options.push(...split.options);
      return;
    }
    // Continuation of the question text, or of the last option.
    if (cur.options.length) cur.options[cur.options.length - 1].text += ` ${line}`;
    else cur.text += ` ${line}`;
  };

  if (lines.some((l) => QUESTION.test(l.trim()) && (QUESTION.exec(l.trim())?.[2] ?? "").trim())) {
    for (const l of lines) addLine(l);
  } else {
    // No numbers: each blank-line-separated block is one question.
    for (const block of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
      cur = null;
      for (const l of block.split("\n")) addLine(l);
    }
  }
  return {
    questions: questions
      .map((q) => ({ ...q, text: q.text.replace(/\s+/g, " ").trim(), options: q.options.map((o) => ({ label: o.label, text: o.text.replace(/\s+/g, " ").trim() })) }))
      .filter((q) => q.text.length > 0),
    legibility: "good",
  };
}
