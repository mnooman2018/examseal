"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseEventLogs, type TransactionReceipt } from "viem";
import { useExam } from "@/hooks/useExam";
import { useChainTime } from "@/hooks/useChainTime";
import { useTxFlow } from "@/hooks/useTxFlow";
import { publicClient } from "@/lib/client";
import { registry, EARLY_RELEASE_GAS, POLL_MS, SKIP_REASONS } from "@/lib/registry";
import { centreLabel } from "@/lib/format";
import { parseCustodianFile, type CustodianFile } from "@/lib/secretFiles";
import { FileLoader } from "@/components/FileLoader";
import { ChainCountdown } from "@/components/ChainCountdown";
import { ErrorBanner, WarningBanner } from "@/components/ErrorBanner";
import { TxStatus } from "@/components/TxStatus";
import { AddressLink } from "@/components/TxLink";
import { StatusPill } from "@/components/StatusPill";

export default function CustodianPage() {
  // The custodian file lives in React state only: never persisted, never uploaded.
  const [file, setFile] = useState<{ name: string; data: CustodianFile } | null>(null);

  return (
    <main>
      <div className="muted small">CUSTODIAN CONSOLE</div>
      <h1>Release key pieces</h1>
      <p className="muted">
        Each custodian holds one piece of every centre&apos;s key, sealed so only that centre can open it. The contract accepts pieces only
        at or after the release time.
      </p>
      <section className="panel">
        <h2>1 · Custodian file</h2>
        <FileLoader
          label="Load your custodian file (custodian-N-….custodian.secret.json)"
          loadedName={file?.name}
          onClear={() => setFile(null)}
          onLoad={(json, name) => {
            const r = parseCustodianFile(json);
            if (!r.ok) return r.error;
            if (r.value.contract.toLowerCase() !== registry.address.toLowerCase())
              return `This file is for registry ${r.value.contract}, but this site uses ${registry.address}.`;
            setFile({ name, data: r.value });
            return null;
          }}
        />
      </section>
      {file && <CustodianConsole file={file.data} />}
    </main>
  );
}

function CustodianConsole({ file }: { file: CustodianFile }) {
  const { address, isConnected } = useAccount();
  const { data, error, refetch } = useExam(file.examId);
  const chain = useChainTime();
  const tx = useTxFlow();
  const early = useTxFlow();

  const exam = data?.exam;
  const centres = useMemo(() => data?.centres ?? [], [data]);
  const chainIndex = exam?.custodians.findIndex((c) => c.toLowerCase() === file.custodianAddress.toLowerCase()) ?? -1;
  const walletMatches = !!address && address.toLowerCase() === file.custodianAddress.toLowerCase();

  // Which of my pieces are already stored on-chain (hasReleased per centre), polled every 3 s.
  const released = useQuery({
    queryKey: ["hasReleased", file.examId.toString(), file.custodianAddress, file.shares.length],
    queryFn: async () => {
      const flags = await Promise.all(
        file.shares.map((s) =>
          publicClient.readContract({ ...registry, functionName: "hasReleased", args: [file.examId, s.centreId, file.custodianAddress] })
        )
      );
      return new Set(file.shares.filter((_, i) => flags[i]).map((s) => s.centreId));
    },
    refetchInterval: POLL_MS,
  });

  const statusOf = useMemo(() => new Map(centres.map((c) => [c.id, c])), [centres]);
  const toSend = file.shares.filter((s) => !released.data?.has(s.centreId) && statusOf.get(s.centreId)?.status !== "Compromised");
  const releaseOpen = exam !== undefined && chain.now !== undefined && chain.now >= exam.releaseTime;
  const canWrite = isConnected && walletMatches && chainIndex >= 0;

  async function releaseAll() {
    await tx.send({
      label: "Release my pieces for all centres",
      functionName: "releaseShares",
      args: [file.examId, toSend.map((s) => s.centreId), toSend.map((s) => s.sealedShare)],
    });
  }

  async function attemptEarly() {
    await early.send({
      label: "Early release attempt",
      functionName: "releaseShares",
      args: [file.examId, file.shares.map((s) => s.centreId), file.shares.map((s) => s.sealedShare)],
      gas: EARLY_RELEASE_GAS,
    });
  }

  return (
    <>
      {error ? <ErrorBanner title={`Could not read exam #${file.examId}`} error={error} onRetry={() => refetch()} /> : null}

      <section className="panel">
        <h2>2 · Exam and wallet</h2>
        <dl className="kv">
          <dt>Exam</dt>
          <dd>
            <Link href={`/exam/${file.examId}`}>#{file.examId.toString()} {exam?.title ?? ""}</Link>
          </dd>
          <dt>This file belongs to</dt>
          <dd>
            <AddressLink address={file.custodianAddress} /> {chainIndex >= 0 ? `(Custodian ${chainIndex + 1} on-chain)` : ""}
          </dd>
          <dt>Connected wallet</dt>
          <dd>{address ? <AddressLink address={address} /> : <span className="muted">not connected</span>}</dd>
          <dt>Pieces in file</dt>
          <dd>{file.shares.length} centres</dd>
        </dl>
        {exam && chainIndex < 0 && (
          <ErrorBanner message={`${file.custodianAddress} is not a custodian of exam #${file.examId} on-chain. This file does not match the exam.`} />
        )}
        {!isConnected && <WarningBanner>Connect the custodian wallet with the button at the top of the page.</WarningBanner>}
        {isConnected && !walletMatches && (
          <WarningBanner>
            Wallet mismatch: the connected wallet is {address}, but this file belongs to {file.custodianAddress}. Switch accounts in your
            wallet (or use this custodian&apos;s Chrome profile). Release is disabled until they match.
          </WarningBanner>
        )}
      </section>

      {exam && (
        <section className="panel stack">
          <h2>3 · Release</h2>
          <ChainCountdown large target={exam.releaseTime} now={chain.now} before="Release opens in" after="Release opened at" />

          <div className="row">
            <button className="btn-primary btn-large" disabled={!canWrite || !releaseOpen || toSend.length === 0 || tx.busy} onClick={releaseAll}>
              Release my pieces for all centres
            </button>
            {!releaseOpen && chain.now !== undefined && (
              <button className="btn-warn" disabled={!canWrite || early.busy} onClick={attemptEarly} title="Sends the transaction anyway with explicit gas so the rejection is recorded on-chain">
                Attempt early release (demo)
              </button>
            )}
          </div>
          {!releaseOpen && <p className="muted small">The contract rejects releases before the release time. Try the demo button to see it happen on-chain.</p>}
          {releaseOpen && toSend.length === 0 && released.data && (
            <p className="check-ok">All your pieces for this exam are on-chain.</p>
          )}

          <TxStatus state={early.state} />
          <TxStatus state={tx.state}>{tx.state.stage === "confirmed" && <ReleaseSummary receipt={tx.state.receipt} />}</TxStatus>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Centre</th>
                  <th>Centre status</th>
                  <th>Approvals</th>
                  <th>My piece</th>
                </tr>
              </thead>
              <tbody>
                {file.shares.map((s) => {
                  const c = statusOf.get(s.centreId);
                  const mine = released.data?.has(s.centreId);
                  return (
                    <tr key={s.centreId}>
                      <td>{centreLabel(s.centreId)}</td>
                      <td>{c ? <StatusPill status={c.status} /> : <span className="muted">not registered</span>}</td>
                      <td className="mono">{c ? `${c.approvals}/${exam.custodians.length}` : "—"}</td>
                      <td>{released.data === undefined ? "…" : mine ? <span className="check-ok">released</span> : <span className="muted">held</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function ReleaseSummary({ receipt }: { receipt: TransactionReceipt }) {
  const logs = parseEventLogs({ abi: registry.abi, logs: receipt.logs });
  const releasedN = logs.filter((l) => l.eventName === "ShareReleased").length;
  const skipped = logs.filter((l) => l.eventName === "ShareSkipped");
  const authorized = logs.filter((l) => l.eventName === "ReleaseAuthorized");
  return (
    <div className="small">
      {releasedN} piece(s) stored on-chain.
      {skipped.length > 0 &&
        ` ${skipped.length} skipped (${Array.from(new Set(skipped.map((l) => SKIP_REASONS[Number((l.args as { reason: number }).reason)]))).join(", ")}).`}
      {authorized.length > 0 && <strong className="check-ok"> RELEASE AUTHORIZED for {authorized.length} centre(s).</strong>}
    </div>
  );
}
