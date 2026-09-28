import type { CandidateCode } from "../candidate";
import type { CentreCode } from "../codebook";
import { MIN_MATCH_PERCENT, MIN_OBSERVED_FEATURES, SEAT_MIN_LEAD } from "./constants";
import { decide } from "./decide";
import { scoreCentres } from "./score";
import type { CentreScore, Decision, Observation } from "./types";

export type SeatResult = {
  seat: number;
  matched: number;
  observed: number;
  runnerUpSeat?: number;
  runnerUpMatched?: number;
  /** How well the centre's own (printed) copy matches: a seat must beat it too. */
  printedMatched: number;
};

export type SeatDecision = {
  /** Centre-level decision (§8 type, unchanged). When a seat is attributed, the reason names it. */
  decision: Decision;
  /** Per-centre scores: each centre's best code among its printed copy and its seats' copies. */
  scores: CentreScore[];
  seat?: SeatResult;
};

const pad = (id: number) => String(id).padStart(2, "0");

/**
 * Centre first, then seat (D9). Each centre is scored by the best of its own copy and its seats'
 * copies, and the existing §10 decide() runs on those scores, so a printed leak is attributed exactly
 * as before. Only if that is a MATCH is a seat considered, and only within that centre: the best
 * seat must reach MIN_MATCH_PERCENT with at least MIN_OBSERVED_FEATURES, and lead both the next seat
 * and the centre's printed copy by SEAT_MIN_LEAD. Otherwise the result is centre only.
 */
export function decideWithCandidates(obs: Observation[], codebook: CentreCode[], candidates: CandidateCode[]): SeatDecision {
  const codes: (CentreCode & { seat?: number })[] = [...codebook, ...candidates];
  // scoreCentres keys by centreId, so give every code a unique temporary id.
  const scored = scoreCentres(
    obs,
    codes.map((c, i) => ({ ...c, centreId: i })),
  ).map((s) => ({ ...s, code: codes[s.centreId] }));

  const bestPerCentre = new Map<number, CentreScore>();
  for (const s of scored) {
    const id = s.code.centreId;
    const prev = bestPerCentre.get(id);
    if (!prev || s.matched > prev.matched) bestPerCentre.set(id, { centreId: id, matched: s.matched, observed: s.observed, perQuestion: s.perQuestion });
  }
  const scores = [...bestPerCentre.values()].sort((a, b) => b.matched - a.matched || a.centreId - b.centreId);
  const decision = decide(scores, obs.length);
  if (decision.kind !== "MATCH") return { decision, scores };

  const centreId = decision.centreId!;
  const inCentre = scored.filter((s) => s.code.centreId === centreId);
  const printed = inCentre.find((s) => s.code.seat === undefined);
  const seats = inCentre.filter((s) => s.code.seat !== undefined).sort((a, b) => b.matched - a.matched || a.code.seat! - b.code.seat!);
  if (seats.length === 0) return { decision, scores };

  const [best, next] = seats;
  const observed = best.observed;
  const printedMatched = printed?.matched ?? 0;
  const seat: SeatResult = {
    seat: best.code.seat!,
    matched: best.matched,
    observed,
    runnerUpSeat: next?.code.seat,
    runnerUpMatched: next?.matched,
    printedMatched,
  };
  const centreRunnerUp = decision.runnerUp ? ` Next closest centre: Centre ${pad(decision.runnerUp.centreId)} with ${decision.runnerUp.matched}.` : "";

  let why: string | null = null;
  if (printedMatched >= best.matched) why = `the centre's printed copy matches as well as any seat's (${printedMatched} of ${observed})`;
  else if (observed < MIN_OBSERVED_FEATURES) why = `only ${observed} features observed`;
  else if (best.matched * 100 < MIN_MATCH_PERCENT * observed) why = `the best seat matches ${best.matched} of ${observed}`;
  else if (best.matched - (next?.matched ?? 0) < SEAT_MIN_LEAD) why = `the best seat leads the next seat by ${best.matched - (next?.matched ?? 0)}; at least ${SEAT_MIN_LEAD} needed`;
  else if (best.matched - printedMatched < SEAT_MIN_LEAD) why = `the best seat leads the centre's printed copy by only ${best.matched - printedMatched}; at least ${SEAT_MIN_LEAD} needed`;

  if (why) {
    return { decision: { ...decision, reason: `${decision.reason} Seat not determined: ${why}.` }, scores };
  }
  return {
    decision: {
      ...decision,
      reason: `Centre ${pad(centreId)}, Seat ${best.code.seat}: ${best.matched} of ${observed} observed features match this seat's copy. Next closest seat: ${
        next ? `${next.code.seat} with ${next.matched}` : "none"
      }; the centre's printed copy: ${printedMatched}.${centreRunnerUp}`,
    },
    scores,
    seat,
  };
}
