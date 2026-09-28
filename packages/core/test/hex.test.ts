import { describe, expect, it } from "vitest";
import { fromHexBytes, toHexBytes } from "../src/hex";

describe("hex", () => {
  it("round-trips bytes as 0x-prefixed lowercase hex", () => {
    const b = new Uint8Array([0, 1, 0xab, 0xff]);
    expect(toHexBytes(b)).toBe("0x0001abff");
    expect(fromHexBytes("0x0001abff")).toEqual(b);
    expect(fromHexBytes("0x0001ABFF")).toEqual(b);
  });

  it("handles empty input", () => {
    expect(toHexBytes(new Uint8Array())).toBe("0x");
    expect(fromHexBytes("0x")).toEqual(new Uint8Array());
  });

  it("rejects malformed hex", () => {
    expect(() => fromHexBytes("0x123")).toThrow();
    expect(() => fromHexBytes("0xzz")).toThrow();
    expect(() => fromHexBytes("abcd" as `0x${string}`)).toThrow();
  });
});
