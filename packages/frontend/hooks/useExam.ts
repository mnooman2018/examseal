"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { publicClient } from "@/lib/client";
import { registry, POLL_MS, CENTRE_STATUS, type CentreStatusName } from "@/lib/registry";
import { decodeRevert } from "@/lib/errors";

export type Exam = {
  id: bigint;
  authority: Address;
  title: string;
  paperCommitment: Hex;
  releaseTime: number;
  revealTime: number;
  threshold: number;
  centreCount: number;
  createdBlock: bigint;
  custodians: readonly Address[];
};

export type Centre = {
  id: number;
  status: CentreStatusName;
  approvals: number;
  encPubKey: Hex;
  variantCommitment: Hex;
  fingerprintCommitment: Hex;
  registeredBlock: bigint;
  fingerprintRevealed: boolean;
  lastEvidenceHash: Hex;
};

export async function fetchExam(examId: bigint): Promise<{ exam: Exam; centres: Centre[] }> {
  const [e, ids] = await Promise.all([
    publicClient.readContract({ ...registry, functionName: "getExam", args: [examId] }),
    publicClient.readContract({ ...registry, functionName: "getCentreIds", args: [examId] }),
  ]);
  const raw = await Promise.all(
    ids.map((id) => publicClient.readContract({ ...registry, functionName: "getCentre", args: [examId, id] }))
  );
  const exam: Exam = {
    id: examId,
    authority: e.authority,
    title: e.title,
    paperCommitment: e.paperCommitment,
    releaseTime: Number(e.releaseTime),
    revealTime: Number(e.revealTime),
    threshold: e.threshold,
    centreCount: e.centreCount,
    createdBlock: e.createdBlock,
    custodians: e.custodians,
  };
  const centres: Centre[] = raw
    .map((c, i) => ({
      id: ids[i],
      status: CENTRE_STATUS[c.status] ?? "None",
      approvals: c.approvals,
      encPubKey: c.encPubKey,
      variantCommitment: c.variantCommitment,
      fingerprintCommitment: c.fingerprintCommitment,
      registeredBlock: c.registeredBlock,
      fingerprintRevealed: c.fingerprintRevealed,
      lastEvidenceHash: c.lastEvidenceHash,
    }))
    .sort((a, b) => a.id - b.id);
  return { exam, centres };
}

/** Exam + all centres, re-read from the chain every 3 s. Query keys use strings (no raw bigint). */
export function useExam(examId: bigint | undefined) {
  return useQuery({
    queryKey: ["exam", examId?.toString()],
    queryFn: () => fetchExam(examId!),
    enabled: examId !== undefined && examId > 0n,
    refetchInterval: POLL_MS,
    // A contract revert (e.g. ExamNotFound) is deterministic: show it at once instead of retrying.
    retry: (count, err) => decodeRevert(err) === null && count < 2,
  });
}

/** Latest exam id = nextExamId() - 1 (0 if none yet). */
export function useLatestExamId() {
  return useQuery({
    queryKey: ["nextExamId"],
    queryFn: async () => (await publicClient.readContract({ ...registry, functionName: "nextExamId" })) - 1n,
    refetchInterval: POLL_MS,
  });
}

/** Parses a ?exam= value or route param into a positive bigint, or undefined. */
export function parseExamId(v: string | null | undefined): bigint | undefined {
  if (!v || !/^\d+$/.test(v)) return undefined;
  const n = BigInt(v);
  return n > 0n ? n : undefined;
}

export type Phase = "Sealed" | "Awaiting release" | "Released" | "Compromised";

/**
 * Overall phase for the phase strip, derived only from chain data:
 * Compromised if any centre is revoked; Released once every centre is released;
 * Awaiting release once chain time passes releaseTime; otherwise Sealed.
 */
export function examPhase(exam: Exam, centres: Centre[], now: number | undefined): Phase {
  if (centres.some((c) => c.status === "Compromised")) return "Compromised";
  if (centres.length > 0 && centres.every((c) => c.status === "Released")) return "Released";
  if (now !== undefined && now >= exam.releaseTime) return "Awaiting release";
  return "Sealed";
}
