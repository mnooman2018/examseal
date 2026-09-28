import type { Hex } from "../hex";

// Types from CLAUDE.md §8 (forensic/*). The matcher itself lands in Phase 2.

export type Extraction = {
  questions: { printedNumber: number | null; text: string; options: { label: string | null; text: string }[] }[];
  legibility: "good" | "partial" | "poor";
};

export type Observation = {
  qid: string;
  position: number | null;
  optionPerm: number[] | null;
  wordingIndex: 0 | 1 | null;
};

export type CentreScore = {
  centreId: number;
  matched: number;
  observed: number;
  perQuestion: Record<string, { position?: boolean; options?: boolean; wording?: boolean }>;
};

export type Decision = {
  kind: "MATCH" | "INCONCLUSIVE" | "NOT_THIS_EXAM";
  centreId?: number;
  best?: CentreScore;
  runnerUp?: CentreScore;
  reason: string;
};

export type EvidenceReport = {
  version: 1;
  examId: string;
  imageSha256: Hex;
  extraction: Extraction;
  observations: Observation[];
  scores: CentreScore[];
  decision: Decision;
  matcherVersion: string;
  createdAt: string;
};
