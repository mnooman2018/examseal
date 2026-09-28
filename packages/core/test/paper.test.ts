import { describe, expect, it } from "vitest";
import { validateMasterPaper } from "../src/paper";
import { paper12 } from "./fixtures/paper12";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function errorsFor(mutate: (p: any) => void): string[] {
  const p = clone(paper12);
  mutate(p);
  const r = validateMasterPaper(p);
  return r.ok ? [] : r.errors;
}

describe("validateMasterPaper (§9 rules)", () => {
  it("accepts the 12-question fixture", () => {
    const r = validateMasterPaper(clone(paper12));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("rule 1: exactly 12 questions with ids Q01–Q12 in order", () => {
    expect(errorsFor((p) => p.questions.pop()).join()).toMatch(/exactly 12/);
    expect(errorsFor((p) => (p.questions[4].id = "Q5")).join()).toMatch(/id must be "Q05"/);
  });

  it("rule 2: two wordings that differ by at least 3 words", () => {
    expect(errorsFor((p) => (p.questions[0].wordings = [p.questions[0].wordings[0]])).join()).toMatch(/exactly 2/);
    expect(
      errorsFor((p) => (p.questions[0].wordings[1] = p.questions[0].wordings[0].replace("follows", "obeys"))).join(),
    ).toMatch(/differ by 1 word/);
  });

  it("rule 3: 4 distinct options of at most 8 words", () => {
    expect(errorsFor((p) => p.questions[0].options.pop()).join()).toMatch(/exactly 4/);
    expect(errorsFor((p) => (p.questions[0].options[3] = "one two three four five six seven eight nine")).join()).toMatch(
      /9 words/,
    );
    expect(errorsFor((p) => (p.questions[0].options[3] = "stack!")).join()).toMatch(/same as option A/);
  });

  it("rule 4: no options that refer to other options", () => {
    for (const bad of ["All of the above", "None of the above", "Both A and B", "A or C", "Same as option B"]) {
      expect(errorsFor((p) => (p.questions[0].options[3] = bad)).join(), bad).toMatch(/rule 4/);
    }
  });

  it("rule 5: no references to question numbers and plain text only", () => {
    expect(errorsFor((p) => (p.questions[1].wordings[0] += " (see question 1)")).join()).toMatch(/question number/);
    expect(errorsFor((p) => (p.questions[1].wordings[0] = "What is <b>binary</b> search's cost?")).join()).toMatch(/HTML/);
    expect(errorsFor((p) => (p.questions[1].wordings[0] = "What is $\\log n$ for binary search?")).join()).toMatch(/LaTeX/);
    expect(errorsFor((p) => (p.questions[1].wordings[0] = "Line one\nline two of the question")).join()).toMatch(/line breaks/);
  });

  it("rule 6: questions must be clearly different", () => {
    expect(errorsFor((p) => (p.questions[11].wordings[0] = p.questions[0].wordings[0] + " today")).join()).toMatch(
      /rule 6: Q01 and Q12/,
    );
  });

  it("checks header fields and answerIndex", () => {
    expect(errorsFor((p) => (p.version = 2)).join()).toMatch(/version/);
    expect(errorsFor((p) => (p.durationMinutes = 0)).join()).toMatch(/durationMinutes/);
    expect(errorsFor((p) => (p.questions[0].answerIndex = 4)).join()).toMatch(/answerIndex/);
    expect(validateMasterPaper(null).ok).toBe(false);
  });
});
