import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical";

describe("canonicalJson", () => {
  it("is stable regardless of key order", () => {
    const a = { b: 1, a: { d: [3, { y: true, x: null }], c: "s" } };
    const b = { a: { c: "s", d: [3, { x: null, y: true }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":"s","d":[3,{"x":null,"y":true}]},"b":1}');
  });

  it("NFC-normalises strings and keys", () => {
    const decomposed = "Café"; // e + combining acute accent
    const composed = "Café";
    expect(canonicalJson({ [decomposed]: decomposed })).toBe(canonicalJson({ [composed]: composed }));
  });

  it("omits undefined object fields like JSON.stringify", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("rejects floats, non-finite numbers and bigint", () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow();
    expect(() => canonicalJson([NaN])).toThrow();
    expect(() => canonicalJson(Infinity)).toThrow();
    expect(() => canonicalJson(1n)).toThrow();
  });

  it("rejects undefined inside arrays", () => {
    expect(() => canonicalJson([1, undefined])).toThrow();
  });
});
