import { isAddress, isHex, type Address, type Hex } from "viem";

// Parsers for the secret files written by `ops seed` (CLAUDE.md §7). Files are read into
// memory only. They are never persisted and never sent anywhere.

export type CustodianFile = {
  version: number;
  examId: bigint;
  contract: Address;
  custodianIndex: number;
  custodianAddress: Address;
  shares: { centreId: number; sealedShare: Hex }[];
};

export type CentreKeyFile = {
  version: number;
  examId: bigint;
  contract: Address;
  centreId: number;
  x25519PublicKey: Hex;
  x25519PrivateKey: Hex;
};

export type RevealFile = {
  examId: bigint;
  centres: { centreId: number; fingerprint: Hex; salt: Hex }[];
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function obj(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function toExamId(v: unknown): bigint | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v) && BigInt(v) > 0n) return BigInt(v);
  return null;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isBytes = (v: unknown, len?: number): v is Hex =>
  typeof v === "string" && isHex(v) && (len === undefined || v.length === 2 + len * 2);

export function parseCustodianFile(raw: unknown): ParseResult<CustodianFile> {
  const o = obj(raw);
  if (!o) return { ok: false, error: "Not a JSON object." };
  const examId = toExamId(o.examId);
  if (!examId) return { ok: false, error: "Missing or invalid examId. Is this a custodian file?" };
  if (typeof o.contract !== "string" || !isAddress(o.contract)) return { ok: false, error: "Missing contract address." };
  if (typeof o.custodianAddress !== "string" || !isAddress(o.custodianAddress))
    return { ok: false, error: "Missing custodianAddress. Is this a custodian file?" };
  if (!isInt(o.custodianIndex)) return { ok: false, error: "Missing custodianIndex." };
  if (!Array.isArray(o.shares) || o.shares.length === 0) return { ok: false, error: "No shares in this file." };
  const shares: CustodianFile["shares"] = [];
  for (const s of o.shares) {
    const so = obj(s);
    if (!so || !isInt(so.centreId) || !isBytes(so.sealedShare))
      return { ok: false, error: "A share entry is malformed (needs centreId and sealedShare hex)." };
    shares.push({ centreId: so.centreId, sealedShare: so.sealedShare });
  }
  return {
    ok: true,
    value: {
      version: Number(o.version ?? 1),
      examId,
      contract: o.contract,
      custodianIndex: o.custodianIndex,
      custodianAddress: o.custodianAddress,
      shares,
    },
  };
}

export function parseCentreKeyFile(raw: unknown): ParseResult<CentreKeyFile> {
  const o = obj(raw);
  if (!o) return { ok: false, error: "Not a JSON object." };
  const examId = toExamId(o.examId);
  if (!examId) return { ok: false, error: "Missing or invalid examId. Is this a centre key file?" };
  if (typeof o.contract !== "string" || !isAddress(o.contract)) return { ok: false, error: "Missing contract address." };
  if (!isInt(o.centreId)) return { ok: false, error: "Missing centreId. Is this a centre key file?" };
  if (!isBytes(o.x25519PublicKey, 32)) return { ok: false, error: "x25519PublicKey must be 32 bytes of hex." };
  if (!isBytes(o.x25519PrivateKey, 32)) return { ok: false, error: "x25519PrivateKey must be 32 bytes of hex." };
  return {
    ok: true,
    value: {
      version: Number(o.version ?? 1),
      examId,
      contract: o.contract,
      centreId: o.centreId,
      x25519PublicKey: o.x25519PublicKey,
      x25519PrivateKey: o.x25519PrivateKey,
    },
  };
}

export function parseRevealFile(raw: unknown): ParseResult<RevealFile> {
  const o = obj(raw);
  if (!o) return { ok: false, error: "Not a JSON object." };
  const examId = toExamId(o.examId);
  if (!examId) return { ok: false, error: "Missing or invalid examId. Is this reveal.secret.json?" };
  if (!Array.isArray(o.centres)) return { ok: false, error: "Missing centres list." };
  const centres: RevealFile["centres"] = [];
  for (const c of o.centres) {
    const co = obj(c);
    if (!co || !isInt(co.centreId) || !isBytes(co.fingerprint) || !isBytes(co.salt, 32))
      return { ok: false, error: "A centre entry is malformed (needs centreId, fingerprint, 32-byte salt)." };
    centres.push({ centreId: co.centreId, fingerprint: co.fingerprint, salt: co.salt });
  }
  return { ok: true, value: { examId, centres } };
}
