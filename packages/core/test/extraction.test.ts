import { describe, expect, it } from "vitest";
import { parseExtraction } from "../src/forensic/extraction";

describe("parseExtraction (zod, §10)", () => {
  it("accepts well-formed output", () => {
    const x = parseExtraction(
      '{"questions":[{"printedNumber":3,"text":"Which gate?","options":[{"label":"A","text":"AND"},{"label":null,"text":"OR"}]}],"legibility":"good"}',
    );
    expect(x.questions[0].printedNumber).toBe(3);
    expect(x.questions[0].options[1].label).toBeNull();
  });

  it("rejects non-JSON, code fences, wrong types and extra fields", () => {
    expect(() => parseExtraction("Here is the JSON: {}")).toThrow(/not valid JSON/);
    expect(() => parseExtraction('```json\n{"questions":[],"legibility":"good"}\n```')).toThrow();
    expect(() => parseExtraction('{"questions":[{"printedNumber":"3","text":"x","options":[]}],"legibility":"good"}')).toThrow(
      /printedNumber/,
    );
    expect(() => parseExtraction('{"questions":[],"legibility":"excellent"}')).toThrow(/legibility/);
    expect(() => parseExtraction('{"questions":[],"legibility":"good","confidence":0.99}')).toThrow();
  });
});
