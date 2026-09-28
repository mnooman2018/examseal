import { MATCHER_VERSION } from "./constants";
import type { EvidenceReport } from "./types";

/** Assemble the report whose keccak256(canonicalJson(...)) is recorded on-chain via recordLeak (§7). */
export function buildEvidenceReport(args: Omit<EvidenceReport, "version" | "matcherVersion">): EvidenceReport {
  return {
    version: 1,
    examId: args.examId,
    imageSha256: args.imageSha256,
    extraction: args.extraction,
    observations: args.observations,
    scores: args.scores,
    decision: args.decision,
    matcherVersion: MATCHER_VERSION,
    createdAt: args.createdAt,
  };
}
