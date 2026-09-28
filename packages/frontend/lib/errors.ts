import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, decodeErrorResult, type Hex } from "viem";
import { registry } from "./registry";
import { formatClock } from "./format";

export type DecodedRevert = { name: string; args: readonly unknown[] };

/** Plain-English text for each custom error in the frozen §6 interface. */
export function describeRevert(r: DecodedRevert): string {
  const a = r.args;
  switch (r.name) {
    case "ReleaseNotStarted":
      return `release opens at ${formatClock(a[0] as bigint)} (chain time); it was ${formatClock(a[1] as bigint)} when this was checked.`;
    case "RevealNotStarted":
      return `fingerprints can be revealed from ${formatClock(a[0] as bigint)} (chain time); it was ${formatClock(a[1] as bigint)}.`;
    case "NotAuthority":
      return "only the exam authority's wallet can do this.";
    case "NotCustodian":
      return "this wallet is not a custodian of this exam.";
    case "ExamNotFound":
      return "this exam does not exist on the registry.";
    case "CentreNotFound":
      return "this centre is not registered for this exam.";
    case "RegistrationClosed":
      return "centre registration closed at the release time.";
    case "BadThreshold":
      return "the threshold must be at least 2 and no more than the number of custodians.";
    case "BadTimes":
      return "the release time must be in the future and the reveal time must not be before it.";
    case "BadCustodians":
      return "custodians must be unique, non-zero, and at most 10.";
    case "CentreExists":
      return "this centre is already registered.";
    case "BadPubKey":
      return "the centre public key is empty.";
    case "LengthMismatch":
      return "the lists sent to the contract have different lengths.";
    case "CommitmentMismatch":
      return "the fingerprint and salt do not match the commitment stored at sealing time.";
    case "AlreadyRevealed":
      return "this centre's fingerprint has already been revealed.";
    default:
      return `${r.name}(${r.args.map(String).join(", ")})`;
  }
}

function findRevertData(err: unknown): Hex | undefined {
  let cur: any = err;
  for (let i = 0; i < 10 && cur; i++) {
    const d = cur.data ?? cur.error?.data;
    if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) return d as Hex;
    if (d && typeof d === "object" && typeof d.data === "string") return d.data as Hex;
    cur = cur.cause;
  }
  return undefined;
}

/** Extracts the registry custom error from any viem/wallet error, if there is one. */
export function decodeRevert(err: unknown): DecodedRevert | null {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) {
      return { name: reverted.data.errorName, args: reverted.data.args ?? [] };
    }
  }
  const data = findRevertData(err);
  if (data) {
    try {
      const d = decodeErrorResult({ abi: registry.abi, data });
      return { name: d.errorName, args: d.args ?? [] };
    } catch {
      /* not one of ours */
    }
  }
  return null;
}

/**
 * Turns any error into one sentence for the UI.
 * `mined` = the transaction was included in a block with status "reverted".
 * `read`  = the error came from a view call, not a transaction.
 */
export function explainError(err: unknown, opts: { mined?: boolean; read?: boolean } = {}): string {
  const r = decodeRevert(err);
  if (r) {
    if (opts.read) return `The registry reports: ${describeRevert(r)}`;
    const tail = opts.mined ? " Your transaction was recorded as failed." : "";
    return `Rejected by the contract: ${describeRevert(r)}${tail}`;
  }
  if (err instanceof BaseError && err.walk((e) => e instanceof UserRejectedRequestError)) {
    return "You rejected the request in your wallet. Nothing was sent.";
  }
  const msg = err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message : String(err);
  if (/user (rejected|denied)/i.test(msg)) return "You rejected the request in your wallet. Nothing was sent.";
  if (/fetch|network|HTTP request failed|timed out/i.test(msg)) {
    return `Could not reach MST Testnet (${msg}). Nothing is shown until the chain answers.`;
  }
  return msg;
}
