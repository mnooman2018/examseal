import { LEAD_FRACTION_PERCENT, MIN_LEAD, MIN_MATCH_PERCENT, MIN_OBSERVED_FEATURES } from "./constants";
import type { CentreScore, Decision } from "./types";

const pad = (id: number) => String(id).padStart(2, "0");

/** Required lead over the runner-up: max(3, ceil(0.3 × observed)), in integer arithmetic. */
export function requiredLead(observed: number): number {
  return Math.max(MIN_LEAD, Math.ceil((LEAD_FRACTION_PERCENT * observed) / 100));
}

/**
 * §10 decision. Every number comes from the scores; nothing here is a "confidence".
 * - 0 questions identified → NOT_THIS_EXAM
 * - observed < 4 → INCONCLUSIVE
 * - matched/observed ≥ 0.85 and lead ≥ max(3, ceil(0.3 × observed)) → MATCH
 * - otherwise INCONCLUSIVE
 */
export function decide(scores: CentreScore[], identifiedCount: number): Decision {
  if (identifiedCount === 0) {
    return { kind: "NOT_THIS_EXAM", reason: "No question in the photo matches this exam's paper." };
  }
  const best = scores[0];
  const runnerUp = scores[1];
  if (!best) return { kind: "INCONCLUSIVE", reason: "The codebook has no centres to compare against." };
  const observed = best.observed;
  if (observed < MIN_OBSERVED_FEATURES) {
    return {
      kind: "INCONCLUSIVE",
      best,
      runnerUp,
      reason: `Not enough visible features: ${observed} observed, at least ${MIN_OBSERVED_FEATURES} needed.`,
    };
  }
  const lead = best.matched - (runnerUp?.matched ?? 0);
  const need = requiredLead(observed);
  const highEnough = best.matched * 100 >= MIN_MATCH_PERCENT * observed;
  const summary = `Centre ${pad(best.centreId)}: ${best.matched} of ${observed} observed features match.${
    runnerUp ? ` Next closest: Centre ${pad(runnerUp.centreId)} with ${runnerUp.matched}.` : ""
  }`;
  if (highEnough && lead >= need) {
    return { kind: "MATCH", centreId: best.centreId, best, runnerUp, reason: summary };
  }
  const why = !highEnough
    ? `the best centre matches ${best.matched} of ${observed}; a match needs at least ${Math.ceil((MIN_MATCH_PERCENT * observed) / 100)}`
    : `the lead over the next centre is ${lead}; a match needs at least ${need}`;
  return { kind: "INCONCLUSIVE", best, runnerUp, reason: `${summary} Not attributed: ${why}.` };
}
