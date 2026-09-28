import {
  type CandidateCode,
  type CentreCode,
  type Extraction,
  type Hex,
  type MasterPaper,
  buildEvidenceReport,
  decide,
  decideWithCandidates,
  evidenceHash,
  identifyQuestions,
  scoreCentres,
} from "examseal-core";
import type { MatchOutcome } from "./hotline";

/** Same matching as /trace: centre-level, or centre then seat when the exam's seat file is loaded (D9). */
export function makeMatcher(master: MasterPaper, codebook: CentreCode[], candidates: CandidateCode[] | null, examId: string) {
  return (extraction: Extraction, sha256: Hex, createdAt: string): MatchOutcome => {
    const observations = identifyQuestions(extraction, master);
    let scores;
    let decision;
    let seat: number | undefined;
    if (candidates) {
      const r = decideWithCandidates(observations, codebook, candidates);
      ({ scores, decision } = r);
      seat = r.seat?.seat;
    } else {
      scores = scoreCentres(observations, codebook);
      decision = decide(scores, observations.length);
    }
    const report = buildEvidenceReport({ examId, imageSha256: sha256, extraction, observations, scores, decision, createdAt });
    return { decision, seat, report, hash: evidenceHash(report), identified: observations.length };
  };
}
