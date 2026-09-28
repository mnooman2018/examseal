"use client";

import { useAccount } from "wagmi";
import { type Decision, type Hex, reasonHash } from "examseal-core";
import type { Centre, Exam } from "@/hooks/useExam";
import { useTxFlow } from "@/hooks/useTxFlow";
import { TxStatus } from "@/components/TxStatus";
import { StatusPill } from "@/components/StatusPill";
import { AddressLink } from "@/components/TxLink";
import { HashDisplay } from "@/components/HashDisplay";
import { centreLabel } from "@/lib/format";

/** Reason text for revokeCentre; only its keccak256 goes on-chain (§7 reasonHash). */
export function revokeReason(centreId: number, evidence: Hex): string {
  return `Leak traced to ${centreLabel(centreId)}. Evidence ${evidence}`;
}

/**
 * §10 step 5 / §12 run-book step 7: "Record evidence on MST" (recordLeak), then "Revoke Centre N"
 * (revokeCentre). Both are signed by the exam authority's wallet in BridgeKey. The page shows
 * only what the chain confirms: no optimistic state (§11).
 */
export function Accountability({ exam, centre, decision, evidence }: { exam: Exam; centre: Centre; decision: Decision; evidence: Hex }) {
  const { address, isConnected } = useAccount();
  const record = useTxFlow();
  const revoke = useTxFlow();
  const isAuthority = !!address && address.toLowerCase() === exam.authority.toLowerCase();
  const label = centreLabel(centre.id);

  // Recovered from the chain after a refresh: the stored evidence hash equals this report's hash.
  const recordedOnChain = centre.lastEvidenceHash.toLowerCase() === evidence.toLowerCase();
  const recorded = recordedOnChain || record.state.stage === "confirmed";
  const revoked = centre.status === "Compromised";
  const matched = decision.best?.matched ?? 0;
  const observed = decision.best?.observed ?? 0;
  const reason = revokeReason(centre.id, evidence);

  return (
    <section className="panel stack">
      <h2>4 · Accountability on MST</h2>
      {!isAuthority && (
        <div className="banner banner-warn">
          <div>
            {isConnected ? "The connected wallet is not this exam's authority. " : "No wallet connected. "}
            Connect the authority wallet <AddressLink address={exam.authority} /> in BridgeKey to record evidence and revoke.
          </div>
        </div>
      )}

      <div className="stack">
        <div className="row">
          <button
            type="button"
            className="btn-primary"
            disabled={!isAuthority || recorded || record.busy}
            onClick={() =>
              record.send({ label: "Record evidence on MST", functionName: "recordLeak", args: [exam.id, centre.id, evidence, matched, observed] })
            }
          >
            Record evidence on MST
          </button>
          <span className="muted small">
            recordLeak({String(exam.id)}, {centre.id}, evidence hash, {matched}, {observed})
          </span>
        </div>
        <TxStatus state={record.state} />
        {recordedOnChain && (
          <div className="small">
            <span className="check-ok">✓</span> {label}&apos;s evidence hash on-chain equals this report: <HashDisplay value={centre.lastEvidenceHash} />
          </div>
        )}
      </div>

      <div className="stack">
        <div className="row">
          <button
            type="button"
            className="btn-danger"
            disabled={!isAuthority || !recorded || revoked || revoke.busy}
            onClick={() =>
              revoke.send({ label: `Revoke ${label}`, functionName: "revokeCentre", args: [exam.id, centre.id, reasonHash(reason)] })
            }
          >
            Revoke {label}
          </button>
          <StatusPill status={centre.status} />
        </div>
        {!recorded && !revoked && <div className="muted small">Record the evidence first, so the revocation points at it.</div>}
        <div className="muted small">
          Reason stored as keccak256(&quot;{reason}&quot;)
        </div>
        <TxStatus state={revoke.state} />
        {revoked && (
          <div className="banner do-not-use" role="alert">
            DO NOT USE: {label.toUpperCase()} HAS BEEN REVOKED
          </div>
        )}
      </div>
    </section>
  );
}
