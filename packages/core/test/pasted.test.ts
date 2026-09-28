import { describe, expect, it } from "vitest";
import { generateCodebook } from "../src/codebook";
import { decide } from "../src/forensic/decide";
import { identifyQuestions } from "../src/forensic/identify";
import { parsePastedText } from "../src/forensic/pasted";
import { scoreCentres } from "../src/forensic/score";
import { buildVariant } from "../src/variant";
import { paper12 } from "./fixtures/paper12";

describe("parsePastedText", () => {
  it("parses numbered questions with one option per line", () => {
    const x = parsePastedText(`1. Which data structure follows the First-In-First-Out principle?
(A) Stack
(B) Queue
(C) Binary tree
(D) Hash table

2) How many bits make up one byte?
A) 4
B) 8
C) 16
D) 32`);
    expect(x.questions).toHaveLength(2);
    expect(x.questions[0]).toEqual({
      printedNumber: 1,
      text: "Which data structure follows the First-In-First-Out principle?",
      options: [
        { label: "A", text: "Stack" },
        { label: "B", text: "Queue" },
        { label: "C", text: "Binary tree" },
        { label: "D", text: "Hash table" },
      ],
    });
    expect(x.questions[1].printedNumber).toBe(2);
    expect(x.questions[1].options.map((o) => o.text)).toEqual(["4", "8", "16", "32"]);
  });

  it("parses options on one line, Q-prefixed numbers, lowercase labels and wrapped text", () => {
    const x = parsePastedText(`Q3. Which protocol translates domain names
into IP addresses?
a) DNS  b) DHCP  c) FTP  d) SMTP
Question 4: What does CPU stand for? (A) Central Processing Unit (B) Central Program Utility (C) Computer Personal Unit (D) Core Processing Utility`);
    expect(x.questions).toHaveLength(2);
    expect(x.questions[0].text).toBe("Which protocol translates domain names into IP addresses?");
    expect(x.questions[0].options.map((o) => `${o.label}:${o.text}`)).toEqual(["A:DNS", "B:DHCP", "C:FTP", "D:SMTP"]);
    expect(x.questions[1].printedNumber).toBe(4);
    expect(x.questions[1].text).toBe("What does CPU stand for?");
    expect(x.questions[1].options).toHaveLength(4);
  });

  it("does not mistake an initial in the text for an option list", () => {
    const x = parsePastedText("5. Who proposed the theory described by A. Einstein in 1905?\n(A) Relativity\n(B) Evolution\n(C) Gravity\n(D) Optics");
    expect(x.questions[0].text).toBe("Who proposed the theory described by A. Einstein in 1905?");
    expect(x.questions[0].options).toHaveLength(4);
  });

  it("falls back to blank-line blocks when nothing is numbered", () => {
    const x = parsePastedText("Which data structure follows FIFO?\nStack\nQueue\n\nHow many bits are in a byte?\n4\n8");
    expect(x.questions).toHaveLength(2);
    expect(x.questions.every((q) => q.printedNumber === null)).toBe(true);
    expect(x.questions[0].text).toContain("Which data structure follows FIFO?");
  });

  it("round-trips a rendered variant retyped as text → the right centre", () => {
    const book = generateCodebook(paper12, Array.from({ length: 20 }, (_, i) => i + 1), new Uint8Array(32).fill(1));
    const v = buildVariant(paper12, book[13]);
    const text = v.questions.map((q) => `${q.number}. ${q.text}\n${q.options.map((o) => `(${o.label}) ${o.text}`).join("\n")}`).join("\n\n");
    const obs = identifyQuestions(parsePastedText(text), paper12);
    const d = decide(scoreCentres(obs, book), obs.length);
    expect(d.kind).toBe("MATCH");
    expect(d.centreId).toBe(14);
    expect(d.best!.matched).toBe(36);
  });

  it("returns no questions for empty input", () => {
    expect(parsePastedText("   \n\n ").questions).toEqual([]);
  });
});
