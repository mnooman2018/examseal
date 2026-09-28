import { describe, expect, it } from "vitest";
import { generateCodebook } from "../src/codebook";
import { buildVariant, renderVariantHtml } from "../src/variant";
import { paper12 } from "./fixtures/paper12";

const book = generateCodebook(paper12, [1, 2, 14], new Uint8Array(32).fill(1));

describe("variant", () => {
  it("prints questions in the centre's order, with its wording and option order", () => {
    const code = book[2];
    const v = buildVariant(paper12, code);
    expect(v.questions).toHaveLength(12);
    v.questions.forEach((vq, i) => {
      const qid = code.order[i];
      const mq = paper12.questions.find((q) => q.id === qid)!;
      expect(vq.number).toBe(i + 1);
      expect(vq.text).toBe(mq.wordings[code.wordings[qid]]);
      expect(vq.options.map((o) => o.label)).toEqual(["A", "B", "C", "D"]);
      expect(vq.options.map((o) => o.text)).toEqual(code.optionPerms[qid].map((m) => mq.options[m]));
    });
  });

  it("contains no centre id, question ids, or answers", () => {
    const v = buildVariant(paper12, book[2]);
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/centreId|answerIndex|"Q\d\d"/);
    expect(Object.keys(v).sort()).toEqual(
      ["durationMinutes", "examTitle", "instructions", "questions", "subject", "version"].sort(),
    );
  });

  it("renders the same layout for every centre (only the text differs)", () => {
    const skeleton = (html: string) => html.replace(/>[^<]*</g, "><");
    const h1 = renderVariantHtml(buildVariant(paper12, book[0]));
    const h2 = renderVariantHtml(buildVariant(paper12, book[1]));
    expect(h1).not.toBe(h2);
    expect(skeleton(h1)).toBe(skeleton(h2));
    expect(h1).not.toMatch(/centre/i);
  });

  it("escapes HTML in the paper text", () => {
    const p = JSON.parse(JSON.stringify(paper12));
    p.questions[0].options[0] = "a < b & c";
    const html = renderVariantHtml(buildVariant(p, book[0]));
    expect(html).toContain("a &lt; b &amp; c");
  });
});
