import { describe, expect, it } from "vitest";
import { x25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { split } from "shamir-secret-sharing";
import { keccak256 } from "viem";

describe("pinned libraries load", () => {
  it("imports noble, shamir, viem and WebCrypto", () => {
    expect(typeof x25519.getPublicKey).toBe("function");
    expect(sha256(new Uint8Array()).length).toBe(32);
    expect(typeof split).toBe("function");
    expect(keccak256("0x")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(typeof globalThis.crypto.subtle.encrypt).toBe("function");
  });
});
