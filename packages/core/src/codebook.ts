import { sha256 } from "@noble/hashes/sha2";
import { concatBytes, utf8 } from "./hex";
import type { MasterPaper } from "./paper";

export type CentreCode = {
  centreId: number;
  order: string[];
  optionPerms: Record<string, number[]>;
  wordings: Record<string, 0 | 1>;
};

// §9 minimum pairwise distances, stated for a 12-question paper. Scaled linearly for
// other sizes (only used by dev fixtures): floor(9n/12), floor(9n/12), floor(4n/12).
export const MIN_POSITION_DIFF_PER_12 = 9;
export const MIN_OPTION_DIFF_PER_12 = 9;
export const MIN_WORDING_DIFF_PER_12 = 4;
export const MAX_CODEBOOK_RETRIES = 10_000;
export const FINGERPRINT_VERSION = 0x01;

export function minDistances(questionCount: number): { position: number; options: number; wording: number } {
  return {
    position: Math.floor((MIN_POSITION_DIFF_PER_12 * questionCount) / 12),
    options: Math.floor((MIN_OPTION_DIFF_PER_12 * questionCount) / 12),
    wording: Math.floor((MIN_WORDING_DIFF_PER_12 * questionCount) / 12),
  };
}

/** Deterministic PRNG: SHA-256 in counter mode over the seed. Never Math.random. */
class Sha256Stream {
  private counter = 0;
  private buf: Uint8Array = new Uint8Array(0);
  private pos = 0;
  constructor(private readonly seed: Uint8Array) {}

  private nextByte(): number {
    if (this.pos >= this.buf.length) {
      const ctr = new Uint8Array(4);
      new DataView(ctr.buffer).setUint32(0, this.counter++);
      this.buf = sha256(concatBytes(utf8("examseal/v1/codebook"), this.seed, ctr));
      this.pos = 0;
    }
    return this.buf[this.pos++];
  }

  private nextU32(): number {
    return ((this.nextByte() << 24) | (this.nextByte() << 16) | (this.nextByte() << 8) | this.nextByte()) >>> 0;
  }

  /** Uniform integer in [0, n) by rejection sampling. */
  int(n: number): number {
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    for (;;) {
      const x = this.nextU32();
      if (x < limit) return x % n;
    }
  }

  shuffle<T>(xs: T[]): T[] {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

/** Number of questions on which two centre codes differ, per feature. */
export function codeDistance(a: CentreCode, b: CentreCode): { position: number; options: number; wording: number } {
  let position = 0;
  let options = 0;
  let wording = 0;
  for (const qid of a.order) {
    if (a.order.indexOf(qid) !== b.order.indexOf(qid)) position++;
    if (a.optionPerms[qid].join() !== b.optionPerms[qid].join()) options++;
    if (a.wordings[qid] !== b.wordings[qid]) wording++;
  }
  return { position, options, wording };
}

/**
 * One code per centre, deterministic from the 32-byte seed. Centres are generated in the
 * given order; each candidate is redrawn until it meets the §9 minimum distances against
 * every centre already accepted. Throws after MAX_CODEBOOK_RETRIES redraws in total.
 */
export function generateCodebook(master: MasterPaper, centreIds: number[], seed: Uint8Array): CentreCode[] {
  if (seed.length !== 32) throw new Error(`codebook seed must be 32 bytes, got ${seed.length}`);
  if (new Set(centreIds).size !== centreIds.length) throw new Error("centreIds must be unique");
  for (const c of centreIds) {
    if (!Number.isInteger(c) || c < 0 || c > 0xffffffff) throw new Error(`centreId ${c} is not a uint32`);
  }
  const qids = master.questions.map((q) => q.id);
  const min = minDistances(qids.length);
  const rng = new Sha256Stream(seed);
  const accepted: CentreCode[] = [];
  let retries = 0;

  for (const centreId of centreIds) {
    for (;;) {
      const code: CentreCode = { centreId, order: rng.shuffle(qids), optionPerms: {}, wordings: {} };
      for (const qid of qids) {
        code.optionPerms[qid] = rng.shuffle([0, 1, 2, 3]);
        code.wordings[qid] = rng.int(2) as 0 | 1;
      }
      const ok = accepted.every((other) => {
        const d = codeDistance(code, other);
        return d.position >= min.position && d.options >= min.options && d.wording >= min.wording;
      });
      if (ok) {
        accepted.push(code);
        break;
      }
      if (++retries > MAX_CODEBOOK_RETRIES) {
        throw new Error(`could not generate a codebook meeting the §9 distances after ${MAX_CODEBOOK_RETRIES} retries`);
      }
    }
  }
  return accepted;
}

const FACTORIALS = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];

function assertPermutation(perm: number[]): void {
  const n = perm.length;
  if (n > 8 || [...perm].sort((a, b) => a - b).some((v, i) => v !== i)) {
    throw new Error(`not a permutation of 0..${n - 1}: [${perm.join(",")}]`);
  }
}

/** Lehmer code rank of a permutation of 0..n-1 (identity = 0). */
export function lehmerIndex(perm: number[]): number {
  assertPermutation(perm);
  let index = 0;
  for (let i = 0; i < perm.length; i++) {
    let smaller = 0;
    for (let j = i + 1; j < perm.length; j++) if (perm[j] < perm[i]) smaller++;
    index += smaller * FACTORIALS[perm.length - 1 - i];
  }
  return index;
}

/** Inverse of lehmerIndex. */
export function permFromLehmer(index: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 0 || n > 8) throw new Error("n must be an integer in 0..8");
  if (!Number.isInteger(index) || index < 0 || index >= FACTORIALS[n]) throw new Error(`Lehmer index ${index} out of range for n=${n}`);
  const pool = Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  let rest = index;
  for (let i = n - 1; i >= 0; i--) {
    const d = Math.floor(rest / FACTORIALS[i]);
    rest %= FACTORIALS[i];
    out.push(pool.splice(d, 1)[0]);
  }
  return out;
}

/** §7 layout: 0x01, then per question in MASTER order: position (1-based), Lehmer index, wording. */
export function encodeFingerprint(master: MasterPaper, code: CentreCode): Uint8Array {
  const out = new Uint8Array(1 + 3 * master.questions.length);
  out[0] = FINGERPRINT_VERSION;
  master.questions.forEach((q, i) => {
    const pos = code.order.indexOf(q.id);
    if (pos < 0) throw new Error(`centre ${code.centreId} code has no position for ${q.id}`);
    const w = code.wordings[q.id];
    if (w !== 0 && w !== 1) throw new Error(`centre ${code.centreId} code has no wording for ${q.id}`);
    out[1 + 3 * i] = pos + 1;
    out[2 + 3 * i] = lehmerIndex(code.optionPerms[q.id] ?? []);
    out[3 + 3 * i] = w;
  });
  return out;
}

export function decodeFingerprint(master: MasterPaper, centreId: number, bytes: Uint8Array): CentreCode {
  const n = master.questions.length;
  if (bytes.length !== 1 + 3 * n) throw new Error(`fingerprint must be ${1 + 3 * n} bytes, got ${bytes.length}`);
  if (bytes[0] !== FINGERPRINT_VERSION) throw new Error(`unknown fingerprint version ${bytes[0]}`);
  const order: (string | undefined)[] = new Array(n);
  const code: CentreCode = { centreId, order: [], optionPerms: {}, wordings: {} };
  master.questions.forEach((q, i) => {
    const pos = bytes[1 + 3 * i];
    const w = bytes[3 + 3 * i];
    if (pos < 1 || pos > n || order[pos - 1] !== undefined) throw new Error(`invalid position ${pos} for ${q.id}`);
    if (w !== 0 && w !== 1) throw new Error(`invalid wording index ${w} for ${q.id}`);
    order[pos - 1] = q.id;
    code.optionPerms[q.id] = permFromLehmer(bytes[2 + 3 * i], 4);
    code.wordings[q.id] = w;
  });
  code.order = order as string[];
  return code;
}
