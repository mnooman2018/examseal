import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type CandidateCode,
  type CentreCode,
  type Hex,
  type MasterPaper,
  deriveCandidateSeed,
  fromHexBytes,
  generateCandidates,
  validateMasterPaper,
} from "examseal-core";
import { jsonStringify } from "./chain";
import { ROOT, UserError, readJson, rel, resolvePaperPath, userPath } from "./env";

export const DEFAULT_SEATS = 30;

export type CandidatesFile = { version: 1; examId: string; seats: number[]; candidates: CandidateCode[] };

/** Seat codes for every centre, from the centre codebook and each centre's private key (D9). */
export function buildCandidates(master: MasterPaper, centres: CentreCode[], centreSks: Map<number, Uint8Array>, seats: number[]): CandidateCode[] {
  return centres.flatMap((c) => {
    const sk = centreSks.get(c.centreId);
    if (!sk) throw new UserError(`No centre key for centre ${c.centreId}`);
    return generateCandidates(master, c, deriveCandidateSeed(sk), seats);
  });
}

export function writeCandidatesFile(dir: string, examId: string, candidates: CandidateCode[], seats: number[]): string {
  const file = path.join(dir, "candidates.secret.json");
  const body: CandidatesFile = { version: 1, examId, seats, candidates };
  writeFileSync(file, jsonStringify(body));
  return file;
}

/**
 * pnpm ops candidates --exam <id> [--seats 30] [--paper <path>] [--secrets-root <dir>]
 * Writes demo-data/secrets/exam-<id>/candidates.secret.json (gitignored) for /trace, from that
 * exam's codebook.secret.json and centre key files. Needs no chain access.
 */
export function candidates(opts: { exam?: string; seats?: string; paper?: string; secretsRoot?: string }): number {
  if (!opts.exam || !/^\d+$/.test(opts.exam)) throw new UserError("--exam <id> is required, e.g. --exam 4");
  const n = Number(opts.seats ?? DEFAULT_SEATS);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw new UserError("--seats must be 1..500");
  const seats = Array.from({ length: n }, (_, i) => i + 1);

  const root = opts.secretsRoot ? userPath(opts.secretsRoot) : path.join(ROOT, "demo-data", "secrets");
  const dir = path.join(root, `exam-${opts.exam}`);
  if (!existsSync(dir)) throw new UserError(`No secrets for exam ${opts.exam} in ${root}`);

  const check = validateMasterPaper(readJson(resolvePaperPath(opts.paper)));
  if (!check.ok) throw new UserError("The master paper does not pass validate-paper");
  const book = readJson(path.join(dir, "codebook.secret.json")) as { centres?: CentreCode[] };
  if (!Array.isArray(book.centres)) throw new UserError("codebook.secret.json has no centres");

  const sks = new Map<number, Uint8Array>();
  const keyDir = path.join(dir, "centres");
  for (const f of existsSync(keyDir) ? readdirSync(keyDir) : []) {
    if (!f.endsWith(".centrekey.secret.json")) continue;
    const k = readJson(path.join(keyDir, f)) as { centreId: number; x25519PrivateKey: Hex; examId: string };
    if (String(k.examId) !== opts.exam) throw new UserError(`${f} is for exam ${k.examId}, not ${opts.exam}`);
    sks.set(k.centreId, fromHexBytes(k.x25519PrivateKey));
  }

  const list = buildCandidates(check.paper, book.centres, sks, seats);
  const file = writeCandidatesFile(dir, opts.exam, list, seats);
  console.log(`Wrote ${list.length} seat variants (${book.centres.length} centres × ${n} seats) to ${rel(file)}`);
  console.log("Load it in /trace next to the codebook to trace leaks to a seat.");
  return 0;
}
