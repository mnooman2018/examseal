import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical";
import { type CentreCode, generateCodebook } from "../src/codebook";
import { evidenceHash } from "../src/commit";
import { MATCHER_VERSION } from "../src/forensic/constants";
import { decide } from "../src/forensic/decide";
import { buildEvidenceReport } from "../src/forensic/evidence";
import { identifyQuestions } from "../src/forensic/identify";
import { scoreCentres } from "../src/forensic/score";
import { syntheticExtraction } from "../src/forensic/synthetic";
import type { Extraction } from "../src/forensic/types";
import { type MasterPaper, validateMasterPaper } from "../src/paper";
import { paper12 } from "./fixtures/paper12";

const realPath = fileURLToPath(new URL("../../../demo-data/master-paper.json", import.meta.url));
const papers: [string, MasterPaper][] = [["fixture paper", paper12]];
if (existsSync(realPath)) {
  const r = validateMasterPaper(JSON.parse(readFileSync(realPath, "utf8")));
  if (r.ok) papers.push(["demo master paper", r.paper]);
}

const centres = Array.from({ length: 20 }, (_, i) => i + 1);
const seed = (b: number) => new Uint8Array(32).fill(b);

/** Small deterministic PRNG for picking test subsets (tests only; the codebook uses SHA-256). */
function lcg(s: number) {
  let x = s >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 0x1_0000_0000);
}
function pick(rand: () => number, n: number, k: number): number[] {
  const all = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, k);
}

function trace(master: MasterPaper, book: CentreCode[], x: Extraction) {
  const obs = identifyQuestions(x, master);
  const scores = scoreCentres(obs, book);
  return { obs, scores, decision: decide(scores, obs.length) };
}

function addNoise(x: Extraction, rand: () => number): Extraction {
  const typo = (s: string) =>
    [...s].map((c) => (/[a-z]/i.test(c) && rand() < 0.05 ? String.fromCharCode(97 + Math.floor(rand() * 26)) : c)).join("");
  return {
    legibility: "partial",
    questions: x.questions.map((q) => ({
      printedNumber: rand() < 0.3 ? null : q.printedNumber,
      text: typo(q.text),
      options: q.options.filter(() => rand() >= 0.2).map((o) => ({ label: o.label, text: typo(o.text) })),
    })),
  };
}

describe.each(papers)("forensic matcher on the %s", (_name, master) => {
  const book = generateCodebook(master, centres, seed(1));

  it("an exact synthetic leak of every centre → MATCH that centre, all 36 features", () => {
    for (const code of book) {
      const { obs, decision } = trace(master, book, syntheticExtraction(master, code));
      expect(obs).toHaveLength(12);
      expect(decision.kind).toBe("MATCH");
      expect(decision.centreId).toBe(code.centreId);
      expect(decision.best!.matched).toBe(36);
      expect(decision.best!.observed).toBe(36);
      expect(decision.reason).toMatch(/^Centre \d\d: 36 of 36 observed features match\. Next closest: Centre \d\d with \d+\.$/);
    }
  });

  it("2, 3 and 4 visible questions → MATCH or INCONCLUSIVE, never a wrong MATCH", () => {
    const rand = lcg(42);
    for (const k of [2, 3, 4]) {
      let wrong = 0;
      for (const code of book) {
        for (let t = 0; t < 25; t++) {
          const { decision } = trace(master, book, syntheticExtraction(master, code, pick(rand, 12, k)));
          expect(decision.kind).not.toBe("NOT_THIS_EXAM");
          if (decision.kind === "MATCH" && decision.centreId !== code.centreId) wrong++;
        }
      }
      expect(wrong, `k=${k}`).toBe(0);
    }
  });

  it("noisy leaks (typos, dropped options, missing numbers) never produce a wrong MATCH", () => {
    const rand = lcg(7);
    let wrong = 0;
    let right = 0;
    for (const k of [3, 6, 12]) {
      for (const code of book) {
        for (let t = 0; t < 5; t++) {
          const x = addNoise(syntheticExtraction(master, code, pick(rand, 12, k)), rand);
          const { decision } = trace(master, book, x);
          if (decision.kind === "MATCH") decision.centreId === code.centreId ? right++ : wrong++;
        }
      }
    }
    expect(wrong).toBe(0);
    expect(right).toBeGreaterThan(0);
  });

  it("the master-order fake (§12 photo 7) → INCONCLUSIVE for several codebooks", () => {
    const masterOrder: CentreCode = {
      centreId: 0,
      order: master.questions.map((q) => q.id),
      optionPerms: Object.fromEntries(master.questions.map((q) => [q.id, [0, 1, 2, 3]])),
      wordings: Object.fromEntries(master.questions.map((q) => [q.id, 0 as const])),
    };
    for (const s of [1, 2, 3, 4, 5]) {
      const b = generateCodebook(master, centres, seed(s));
      const { obs, decision } = trace(master, b, syntheticExtraction(master, masterOrder));
      expect(obs).toHaveLength(12);
      expect(decision.kind, `seed ${s}: ${decision.reason}`).toBe("INCONCLUSIVE");
    }
  });

  it("unrelated text → NOT_THIS_EXAM", () => {
    const x: Extraction = {
      legibility: "good",
      questions: [
        { printedNumber: 1, text: "Who wrote the national anthem of India?", options: [{ label: "A", text: "Rabindranath Tagore" }] },
        { printedNumber: 2, text: "What is the chemical symbol for gold?", options: [{ label: "A", text: "Au" }, { label: "B", text: "Ag" }] },
      ],
    };
    const { obs, decision } = trace(master, book, x);
    expect(obs).toHaveLength(0);
    expect(decision.kind).toBe("NOT_THIS_EXAM");
  });
});

describe("identifyQuestions details", () => {
  const book = generateCodebook(paper12, centres, seed(1));
  const code = book[13];
  const full = syntheticExtraction(paper12, code);

  it("infers the 4th option by elimination from 3, and gives up with 2", () => {
    const q = full.questions[0];
    const three: Extraction = { legibility: "good", questions: [{ ...q, options: q.options.slice(0, 3) }] };
    const two: Extraction = { legibility: "good", questions: [{ ...q, options: q.options.slice(1, 3) }] };
    const [o3] = identifyQuestions(three, paper12);
    const [o2] = identifyQuestions(two, paper12);
    expect(o3.optionPerm).toEqual(code.optionPerms[o3.qid]);
    expect(o2.optionPerm).toBeNull();
  });

  it("uses option order when labels are missing but all 4 options are visible", () => {
    const q = full.questions[0];
    const unlabelled: Extraction = { legibility: "good", questions: [{ ...q, options: q.options.map((o) => ({ label: null, text: o.text })) }] };
    const [o] = identifyQuestions(unlabelled, paper12);
    expect(o.optionPerm).toEqual(code.optionPerms[o.qid]);
  });

  it("ignores printed numbers outside 1..12 and keeps the stronger of two duplicates", () => {
    const q = full.questions[0];
    const x: Extraction = {
      legibility: "good",
      questions: [
        { ...q, printedNumber: 13 },
        { ...q, text: q.text.slice(0, Math.floor(q.text.length * 0.8)), printedNumber: 5 },
      ],
    };
    const obs = identifyQuestions(x, paper12);
    expect(obs).toHaveLength(1);
    expect(obs[0].position).toBeNull();
  });
});

describe("evidence report", () => {
  it("is canonical-JSON safe (integers only) and hashes deterministically", () => {
    const book = generateCodebook(paper12, centres, seed(1));
    const x = syntheticExtraction(paper12, book[13], [1, 2, 3, 4, 5]);
    const obs = identifyQuestions(x, paper12);
    const scores = scoreCentres(obs, book);
    const args = {
      examId: "3",
      imageSha256: `0x${"ab".repeat(32)}` as const,
      extraction: x,
      observations: obs,
      scores,
      decision: decide(scores, obs.length),
      createdAt: "2026-09-29T00:00:00.000Z",
    };
    const r = buildEvidenceReport(args);
    expect(r.version).toBe(1);
    expect(r.matcherVersion).toBe(MATCHER_VERSION);
    expect(() => canonicalJson(r)).not.toThrow();
    expect(evidenceHash(r)).toBe(evidenceHash(buildEvidenceReport(args)));
  });
});
