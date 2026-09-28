import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type CandidateCode,
  MIN_SEAT_DISTANCE,
  SEAT_CHANGES,
  applySeatOps,
  deriveCandidateSeed,
  featureDistance,
  generateCandidates,
  generateSeatOps,
  seatCode,
} from "../src/candidate";
import { buildVariant } from "../src/variant";
import { type CentreCode, generateCodebook } from "../src/codebook";
import { identifyQuestions } from "../src/forensic/identify";
import { decideWithCandidates } from "../src/forensic/seat";
import { syntheticExtraction } from "../src/forensic/synthetic";
import type { Extraction } from "../src/forensic/types";
import { generateCentreKeypair } from "../src/seal";
import { type MasterPaper, validateMasterPaper } from "../src/paper";
import { paper12 } from "./fixtures/paper12";

const realPath = fileURLToPath(new URL("../../../demo-data/master-paper.json", import.meta.url));
const papers: [string, MasterPaper][] = [["fixture paper", paper12]];
if (existsSync(realPath)) {
  const r = validateMasterPaper(JSON.parse(readFileSync(realPath, "utf8")));
  if (r.ok) papers.push(["demo master paper", r.paper]);
}
const centreIds = Array.from({ length: 20 }, (_, i) => i + 1);
const seats30 = Array.from({ length: 30 }, (_, i) => i + 1);

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
function noisy(x: Extraction, rand: () => number): Extraction {
  const typo = (s: string) => [...s].map((c) => (/[a-z]/i.test(c) && rand() < 0.05 ? String.fromCharCode(97 + Math.floor(rand() * 26)) : c)).join("");
  return {
    legibility: "partial",
    questions: x.questions.map((q) => ({
      printedNumber: rand() < 0.3 ? null : q.printedNumber,
      text: typo(q.text),
      options: q.options.filter(() => rand() >= 0.2).map((o) => ({ label: o.label, text: typo(o.text) })),
    })),
  };
}

describe("deriveCandidateSeed", () => {
  it("is deterministic per centre key and differs between keys", () => {
    const a = generateCentreKeypair();
    const b = generateCentreKeypair();
    expect(deriveCandidateSeed(a.privateKey)).toEqual(deriveCandidateSeed(a.privateKey));
    expect(deriveCandidateSeed(a.privateKey)).not.toEqual(deriveCandidateSeed(b.privateKey));
    expect(deriveCandidateSeed(a.privateKey)).toHaveLength(32);
  });
});

describe.each(papers)("seat layer on the %s", (_name, master) => {
  const book = generateCodebook(master, centreIds, new Uint8Array(32).fill(1));
  const keys = book.map(() => generateCentreKeypair());
  const all: CandidateCode[] = book.flatMap((c, i) => generateCandidates(master, c, deriveCandidateSeed(keys[i].privateKey), seats30));

  it("is deterministic and leaves the centre codebook untouched", () => {
    const before = JSON.stringify(book);
    const again = generateCandidates(master, book[13], deriveCandidateSeed(keys[13].privateKey), seats30);
    expect(again).toEqual(all.filter((c) => c.centreId === book[13].centreId));
    expect(JSON.stringify(book)).toBe(before);
    expect(generateCodebook(master, centreIds, new Uint8Array(32).fill(1))).toEqual(book);
  });

  it(`every seat is exactly ${SEAT_CHANGES} features from its centre, and seats of a centre are ≥ ${MIN_SEAT_DISTANCE} apart`, () => {
    for (const centre of book) {
      const seats = all.filter((c) => c.centreId === centre.centreId);
      expect(seats).toHaveLength(30);
      for (const s of seats) expect(featureDistance(s, centre)).toBe(SEAT_CHANGES);
      for (let i = 0; i < seats.length; i++) {
        for (let j = i + 1; j < seats.length; j++) expect(featureDistance(seats[i], seats[j])).toBeGreaterThanOrEqual(MIN_SEAT_DISTANCE);
      }
    }
  });

  it("the centre renders exactly the paper the authority traces against (applySeatOps = buildVariant(seatCode))", () => {
    for (let i = 0; i < book.length; i++) {
      const seed = deriveCandidateSeed(keys[i].privateKey);
      const centreVariant = buildVariant(master, book[i]); // what the centre decrypts
      // The centre knows only the question count and its seed; the authority knows the centre code too.
      for (const ops of generateSeatOps(master.questions.length, seed, seats30)) {
        expect(applySeatOps(centreVariant, ops)).toEqual(buildVariant(master, seatCode(book[i], ops)));
      }
    }
  });

  it("an exact leak of a seat's copy → Centre N, Seat M", () => {
    for (const c of [all[0], all[13 * 30 + 6], all[all.length - 1]]) {
      const obs = identifyQuestions(syntheticExtraction(master, c), master);
      const r = decideWithCandidates(obs, book, all);
      expect(r.decision.kind).toBe("MATCH");
      expect(r.decision.centreId).toBe(c.centreId);
      expect(r.seat?.seat).toBe(c.seat);
      expect(r.decision.reason).toMatch(new RegExp(`^Centre ${String(c.centreId).padStart(2, "0")}, Seat ${c.seat}: 36 of 36`));
    }
  });

  it("a printed (centre) leak → that centre, no seat, exactly as before", () => {
    const obs = identifyQuestions(syntheticExtraction(master, book[13]), master);
    const r = decideWithCandidates(obs, book, all);
    expect(r.decision.kind).toBe("MATCH");
    expect(r.decision.centreId).toBe(book[13].centreId);
    expect(r.seat).toBeUndefined();
    expect(r.decision.reason).toMatch(/Seat not determined: the centre's printed copy matches as well as any seat's/);
  });

  it("partial, noisy seat leaks never name a wrong centre or a wrong seat", () => {
    const rand = lcg(11);
    let wrongCentre = 0;
    let wrongSeat = 0;
    let rightSeat = 0;
    for (let t = 0; t < 300; t++) {
      const c = all[Math.floor(rand() * all.length)];
      const k = [3, 4, 6, 8, 12][t % 5];
      const x = noisy(syntheticExtraction(master, c, pick(rand, 12, k)), rand);
      const r = decideWithCandidates(identifyQuestions(x, master), book, all);
      if (r.decision.kind === "MATCH" && r.decision.centreId !== c.centreId) wrongCentre++;
      if (r.seat) r.seat.seat === c.seat && r.decision.centreId === c.centreId ? rightSeat++ : wrongSeat++;
    }
    expect(wrongCentre).toBe(0);
    expect(wrongSeat).toBe(0);
    expect(rightSeat).toBeGreaterThan(0);
  });

  it("unrelated text → NOT_THIS_EXAM", () => {
    const x: Extraction = { legibility: "good", questions: [{ printedNumber: 1, text: "Who painted the Mona Lisa?", options: [] }] };
    expect(decideWithCandidates(identifyQuestions(x, master), book, all).decision.kind).toBe("NOT_THIS_EXAM");
  });
});

describe("generateCandidates input checks", () => {
  it("rejects bad seeds and seat lists", () => {
    const book: CentreCode[] = generateCodebook(paper12, [1], new Uint8Array(32).fill(1));
    expect(() => generateCandidates(paper12, book[0], new Uint8Array(31), [1])).toThrow();
    expect(() => generateCandidates(paper12, book[0], new Uint8Array(32), [1, 1])).toThrow();
    expect(() => generateCandidates(paper12, book[0], new Uint8Array(32), [0])).toThrow();
  });
});
