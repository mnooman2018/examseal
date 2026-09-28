import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { type CentreCode, codeDistance } from "./codebook";
import { concatBytes, utf8 } from "./hex";
import type { MasterPaper } from "./paper";

// Per-candidate (seat) variants: a separate layer on top of the per-centre codebook (D9).
// The centre codebook, its seed and every §7 format are unchanged. A seat's copy is its centre's
// copy with exactly SEAT_CHANGES feature changes, derived deterministically from a seed that both
// the centre (from its private key) and the authority (from the centre key files) can compute.

export type CandidateCode = CentreCode & { seat: number };

/** Changes from the centre's copy: 1 question pair swapped (2 position features), 3 option orders, 3 wordings. */
export const SEAT_SWAPS = 1;
export const SEAT_OPTION_CHANGES = 3;
export const SEAT_WORDING_CHANGES = 3;
export const SEAT_CHANGES = 2 * SEAT_SWAPS + SEAT_OPTION_CHANGES + SEAT_WORDING_CHANGES; // 8 of 36 for 12 questions
/** Any two seats of the same centre differ in at least this many features (position + options + wording). */
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
  pickDistinct(n: number, k: number): number[] {
    const all = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, k);
  }
}

/** Total number of differing features between two codes (position + option order + wording). */
export function featureDistance(a: CentreCode, b: CentreCode): number {
  const d = codeDistance(a, b);
  return d.position + d.options + d.wording;
}

function perturb(master: MasterPaper, centre: CentreCode, seat: number, s: Stream): CandidateCode {
  const qids = master.questions.map((q) => q.id);
  const order = [...centre.order];
  const optionPerms: Record<string, number[]> = Object.fromEntries(Object.entries(centre.optionPerms).map(([k, v]) => [k, [...v]]));
  const wordings: Record<string, 0 | 1> = { ...centre.wordings };
  for (let i = 0; i < SEAT_SWAPS; i++) {
    const [a, b] = s.pickDistinct(order.length, 2);
    [order[a], order[b]] = [order[b], order[a]];
  }
  for (const qi of s.pickDistinct(qids.length, SEAT_OPTION_CHANGES)) {
    const q = qids[qi];
    const orig = optionPerms[q].join();
    let p: number[];
    do {
      p = [0, 1, 2, 3];
      for (let i = 3; i > 0; i--) {
        const j = s.int(i + 1);
        [p[i], p[j]] = [p[j], p[i]];
      }
    } while (p.join() === orig);
    optionPerms[q] = p;
  }
  for (const qi of s.pickDistinct(qids.length, SEAT_WORDING_CHANGES)) {
    const q = qids[qi];
    wordings[q] = wordings[q] === 0 ? 1 : 0;
  }
  return { centreId: centre.centreId, seat, order, optionPerms, wordings };
}

/**
 * Seat codes for one centre, deterministic from (centre code, seed). Each seat is exactly
 * SEAT_CHANGES features away from the centre's copy, and every pair of seats is at least
 * MIN_SEAT_DISTANCE apart. Throws after MAX_SEAT_RETRIES redraws in total.
 */
export function generateCandidates(master: MasterPaper, centre: CentreCode, seed: Uint8Array, seats: number[]): CandidateCode[] {
  if (seed.length !== 32) throw new Error("candidate seed must be 32 bytes");
  if (new Set(seats).size !== seats.length || seats.some((x) => !Number.isInteger(x) || x < 1)) {
    throw new Error("seats must be unique positive integers");
  }
  if (master.questions.length < 4) throw new Error("seat variants need at least 4 questions");
  const s = new Stream(seed);
  const out: CandidateCode[] = [];
  let retries = 0;
  for (const seat of seats) {
    for (;;) {
      const c = perturb(master, centre, seat, s);
      if (featureDistance(c, centre) === SEAT_CHANGES && out.every((o) => featureDistance(o, c) >= MIN_SEAT_DISTANCE)) {
        out.push(c);
        break;
      }
      if (++retries > MAX_SEAT_RETRIES) throw new Error(`could not generate seat variants for centre ${centre.centreId} after ${MAX_SEAT_RETRIES} retries`);
    }
  }
  return out;
}
