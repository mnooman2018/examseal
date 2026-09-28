import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { type CentreCode, codeDistance } from "./codebook";
import { concatBytes, utf8 } from "./hex";
import type { MasterPaper } from "./paper";
import type { VariantPaper } from "./variant";

// Per-candidate (seat) variants: a separate layer on top of the per-centre codebook (D9).
// The centre codebook, its seed and every §7 format are unchanged.
//
// A seat's changes are defined RELATIVE TO THE CENTRE'S PRINTED COPY (positions and A–D labels),
// never in terms of master question ids or the second wording. That way:
//   - the centre can render a seat's copy from its own decrypted paper alone (applySeatOps), and
//   - the authority can compute the same seat's code from the centre code (seatCode),
// and both derive the same ops from a seed only the two of them can compute (the centre's private key).

export type CandidateCode = CentreCode & { seat: number };

/** One seat's changes. Positions are 1-based printed positions in the CENTRE's copy. */
export type SeatOps = {
  seat: number;
  /** Disjoint pairs of printed positions whose questions are swapped. */
  swaps: [number, number][];
  /** For a printed question: new label j shows the centre's label sigma[j]. sigma is never the identity. */
  optionChanges: { position: number; sigma: number[] }[];
};

/** 2 disjoint swaps (4 position features) + 4 option re-orderings = 8 of 36 features for 12 questions. */
export const SEAT_SWAPS = 2;
export const SEAT_OPTION_CHANGES = 4;
export const SEAT_CHANGES = 2 * SEAT_SWAPS + SEAT_OPTION_CHANGES;
/** Any two seats of the same centre differ in at least this many features. */
export const MIN_SEAT_DISTANCE = 6;
export const MAX_SEAT_RETRIES = 10_000;

/** Seat seed for one centre: HKDF-SHA256 over the centre's X25519 private key. */
export function deriveCandidateSeed(centreSk: Uint8Array): Uint8Array {
  if (centreSk.length !== 32) throw new Error("centre private key must be 32 bytes");
  return hkdf(sha256, centreSk, utf8("examseal/v1/candidates"), utf8("examseal/v1/candidate-seed"), 32);
}

/** SHA-256 counter-mode stream (same construction as the codebook's, separate domain). */
class Stream {
  private counter = 0;
  private buf: Uint8Array = new Uint8Array(0);
  private pos = 0;
  constructor(private readonly seed: Uint8Array) {}
  private byte(): number {
    if (this.pos >= this.buf.length) {
      const ctr = new Uint8Array(4);
      new DataView(ctr.buffer).setUint32(0, this.counter++);
      this.buf = sha256(concatBytes(utf8("examseal/v1/candidates/stream"), this.seed, ctr));
      this.pos = 0;
    }
    return this.buf[this.pos++];
  }
  int(n: number): number {
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    for (;;) {
      const x = ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
      if (x < limit) return x % n;
    }
  }
  shuffle(n: number): number[] {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

const isIdentity = (p: number[]) => p.every((v, i) => v === i);

function drawOps(n: number, seat: number, s: Stream): SeatOps {
  const pos = s.shuffle(n).map((i) => i + 1);
  const swaps: [number, number][] = [];
  for (let i = 0; i < SEAT_SWAPS; i++) swaps.push([pos[2 * i], pos[2 * i + 1]]);
  const optionChanges = s
    .shuffle(n)
    .slice(0, SEAT_OPTION_CHANGES)
    .map((i) => {
      let sigma: number[];
      do sigma = s.shuffle(4);
      while (isIdentity(sigma));
      return { position: i + 1, sigma };
    });
  return { seat, swaps, optionChanges };
}

/** Where each centre position ends up, and each centre position's option re-ordering. */
function relative(n: number, ops: SeatOps): { newPos: number[]; sigma: string[] } {
  const at = Array.from({ length: n }, (_, i) => i + 1); // at[printedPos-1] = centre position shown there
  for (const [a, b] of ops.swaps) [at[a - 1], at[b - 1]] = [at[b - 1], at[a - 1]];
  const newPos = new Array<number>(n + 1);
  at.forEach((centrePos, i) => (newPos[centrePos] = i + 1));
  const sigma = Array.from({ length: n + 1 }, () => "0,1,2,3");
  for (const c of ops.optionChanges) sigma[c.position] = c.sigma.join();
  return { newPos, sigma };
}

/** Features in which two seats of the same centre differ (position + option order; wording never changes). */
export function seatOpsDistance(n: number, a: SeatOps, b: SeatOps): number {
  const ra = relative(n, a);
  const rb = relative(n, b);
  let d = 0;
  for (let p = 1; p <= n; p++) {
    if (ra.newPos[p] !== rb.newPos[p]) d++;
    if (ra.sigma[p] !== rb.sigma[p]) d++;
  }
  return d;
}

const NO_OPS: SeatOps = { seat: 0, swaps: [], optionChanges: [] };

/**
 * Seat changes for one centre, deterministic from the seed and the number of questions only, so the
 * centre and the authority derive identical ops. Each seat is exactly SEAT_CHANGES features from the
 * centre's copy and at least MIN_SEAT_DISTANCE from every other seat.
 */
export function generateSeatOps(questionCount: number, seed: Uint8Array, seats: number[]): SeatOps[] {
  if (seed.length !== 32) throw new Error("candidate seed must be 32 bytes");
  if (new Set(seats).size !== seats.length || seats.some((x) => !Number.isInteger(x) || x < 1)) {
    throw new Error("seats must be unique positive integers");
  }
  if (questionCount < 2 * SEAT_SWAPS || questionCount < SEAT_OPTION_CHANGES) throw new Error("too few questions for seat variants");
  const s = new Stream(seed);
  const out: SeatOps[] = [];
  let retries = 0;
  for (const seat of seats) {
    for (;;) {
      const ops = drawOps(questionCount, seat, s);
      if (
        seatOpsDistance(questionCount, ops, NO_OPS) === SEAT_CHANGES &&
        out.every((o) => seatOpsDistance(questionCount, o, ops) >= MIN_SEAT_DISTANCE)
      ) {
        out.push(ops);
        break;
      }
      if (++retries > MAX_SEAT_RETRIES) throw new Error(`could not generate seat variants after ${MAX_SEAT_RETRIES} retries`);
    }
  }
  return out;
}

/** Authority side: the seat's code (same shape as a centre code) from the centre code and the seat ops. */
export function seatCode(centre: CentreCode, ops: SeatOps): CandidateCode {
  const optionPerms: Record<string, number[]> = Object.fromEntries(Object.entries(centre.optionPerms).map(([k, v]) => [k, [...v]]));
  for (const c of ops.optionChanges) {
    const qid = centre.order[c.position - 1];
    const base = centre.optionPerms[qid];
    optionPerms[qid] = c.sigma.map((j) => base[j]);
  }
  const order = [...centre.order];
  for (const [a, b] of ops.swaps) [order[a - 1], order[b - 1]] = [order[b - 1], order[a - 1]];
  return { centreId: centre.centreId, seat: ops.seat, order, optionPerms, wordings: { ...centre.wordings } };
}

/** Centre side: the seat's printable paper from the centre's decrypted paper and the seat ops. */
export function applySeatOps(v: VariantPaper, ops: SeatOps): VariantPaper {
  const labels = ["A", "B", "C", "D"] as const;
  const qs = v.questions.map((q) => ({ ...q, options: q.options.map((o) => ({ ...o })) }));
  for (const c of ops.optionChanges) {
    const q = qs[c.position - 1];
    const old = q.options;
    q.options = c.sigma.map((j, i) => ({ label: labels[i], text: old[j].text }));
  }
  for (const [a, b] of ops.swaps) [qs[a - 1], qs[b - 1]] = [qs[b - 1], qs[a - 1]];
  return { ...v, questions: qs.map((q, i) => ({ ...q, number: i + 1 })) };
}

/** Total number of differing features between two codes (position + option order + wording). */
export function featureDistance(a: CentreCode, b: CentreCode): number {
  const d = codeDistance(a, b);
  return d.position + d.options + d.wording;
}

/** Authority side: every seat's code for one centre. */
export function generateCandidates(master: MasterPaper, centre: CentreCode, seed: Uint8Array, seats: number[]): CandidateCode[] {
  return generateSeatOps(master.questions.length, seed, seats).map((ops) => seatCode(centre, ops));
}
