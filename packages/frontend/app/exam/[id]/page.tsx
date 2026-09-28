"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { keccak256, toBytes } from "viem";
import { examPhase, phaseLabel, parseExamId, useExam, type Centre, type Exam } from "@/hooks/useExam";
import { useChainTime } from "@/hooks/useChainTime";
import { useCustodyEvents } from "@/hooks/useCustodyEvents";
import { useTxFlow } from "@/hooks/useTxFlow";
import { CustodyTimelineView, type CustodyFeed } from "@/components/CustodyTimeline";
import { ChainCountdown } from "@/components/ChainCountdown";
import { ErrorBanner, WarningBanner } from "@/components/ErrorBanner";
import { FileLoader } from "@/components/FileLoader";
import { HashDisplay } from "@/components/HashDisplay";
import { PhaseStrip } from "@/components/PhaseStrip";
import { StatusPill } from "@/components/StatusPill";
import { TxStatus } from "@/components/TxStatus";
import { AddressLink, BlockLink } from "@/components/TxLink";
import { centreLabel, formatDateTime } from "@/lib/format";
import { parseRevealFile, type RevealFile } from "@/lib/secretFiles";

export default function ExamPage({ params }: { params: { id: string } }) {
  const examId = parseExamId(params.id);
  const { data, error, isLoading, refetch } = useExam(examId);
  const chain = useChainTime();
  const feed = useCustodyEvents(examId, data?.exam.createdBlock);

  if (!examId) {
    return (
      <main>
        <ErrorBanner message={`"${params.id}" is not a valid exam number.`} />
      </main>
    );
  }

  const exam = data?.exam;
  const centres = data?.centres ?? [];

  return (
    <main>
      <div className="muted small">
        <Link href={`/?exam=${examId}`}>← Control room</Link> · EXAM #{examId.toString()}
      </div>
      <h1>{exam?.title ?? (isLoading ? "Reading exam from chain…" : "—")}</h1>
      {error ? <ErrorBanner title={`Could not read exam #${examId}`} error={error} onRetry={() => refetch()} /> : null}

      {exam && (
        <>
          <PhaseStrip
            phase={examPhase(exam, centres, chain.now)}
            label={phaseLabel(examPhase(exam, centres, chain.now), exam, centres)}
          />

          <div className="grid-2">
            <section className="panel">
              <h2>Commitments</h2>
              <dl className="kv">
                <dt>Paper commitment</dt>
                <dd><HashDisplay value={exam.paperCommitment} /></dd>
                <dt>Authority</dt>
                <dd><AddressLink address={exam.authority} /></dd>
                <dt>Threshold</dt>
                <dd>{exam.threshold} of {exam.custodians.length} custodians</dd>
                <dt>Release time</dt>
                <dd className="mono">{formatDateTime(exam.releaseTime)}</dd>
                <dt>Reveal time</dt>
                <dd className="mono">{formatDateTime(exam.revealTime)}</dd>
                <dt>Created in block</dt>
                <dd><BlockLink block={exam.createdBlock} /></dd>
              </dl>
            </section>
            <section className="panel stack">
              <ChainCountdown target={exam.releaseTime} now={chain.now} before="Release opens in" after="Release opened at" />
              <ChainCountdown target={exam.revealTime} now={chain.now} before="Fingerprint reveal opens in" after="Fingerprint reveal opened at" />
            </section>
          </div>

          <CustodiansPanel exam={exam} feed={feed} centreCount={centres.length} />
          <CentresTable exam={exam} centres={centres} />
          <AuthorityActions exam={exam} centres={centres} now={chain.now} />

          <section className="panel">
            <h2>Chain-of-custody timeline</h2>
            <p className="muted small">Every event below is read from MST Testnet and links to its transaction on MSTScan.</p>
            <CustodyTimelineView exam={exam} feed={feed} />
          </section>
        </>
      )}
    </main>
  );
}

function CustodiansPanel({ exam, feed, centreCount }: { exam: Exam; feed: CustodyFeed; centreCount: number }) {
  const releasedBy = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const e of feed.entries) {
      if (e.name !== "ShareReleased") continue;
      const who = String(e.args.custodian).toLowerCase();
      if (!m.has(who)) m.set(who, new Set());
      m.get(who)!.add(Number(e.args.centreId));
    }
    return m;
  }, [feed.entries]);

  return (
    <section className="panel">
      <h2>Custodians</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Address</th>
              <th>Pieces released</th>
            </tr>
          </thead>
          <tbody>
            {exam.custodians.map((c, i) => {
              const n = releasedBy.get(c.toLowerCase())?.size ?? 0;
              return (
                <tr key={c}>
                  <td>Custodian {i + 1}</td>
                  <td><AddressLink address={c} /></td>
                  <td>
                    {feed.loading && feed.entries.length === 0 ? "…" : `${n} of ${centreCount} centres`}{" "}
                    {n > 0 && n === centreCount && <StatusPill status="Released" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CentresTable({ exam, centres }: { exam: Exam; centres: Centre[] }) {
  return (
    <section className="panel">
      <h2>Centres</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Centre</th>
              <th>Status</th>
              <th>Approvals</th>
              <th>Variant commitment</th>
              <th>Fingerprint commitment</th>
              <th>Fingerprint</th>
              <th>Last evidence</th>
              <th>Sealed in</th>
            </tr>
          </thead>
          <tbody>
            {centres.map((c) => (
              <tr key={c.id}>
                <td>{centreLabel(c.id)}</td>
                <td><StatusPill status={c.status} /></td>
                <td className="mono">{c.approvals}/{exam.custodians.length}</td>
                <td><HashDisplay value={c.variantCommitment} /></td>
                <td><HashDisplay value={c.fingerprintCommitment} /></td>
                <td>{c.fingerprintRevealed ? <StatusPill status="Revealed" tone="info" /> : <span className="muted">sealed</span>}</td>
                <td>{/^0x0+$/.test(c.lastEvidenceHash) ? <span className="muted">none</span> : <HashDisplay value={c.lastEvidenceHash} />}</td>
                <td><BlockLink block={c.registeredBlock} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AuthorityActions({ exam, centres, now }: { exam: Exam; centres: Centre[]; now: number | undefined }) {
  const { address, isConnected } = useAccount();
  const isAuthority = !!address && address.toLowerCase() === exam.authority.toLowerCase();

  return (
    <section className="panel">
      <h2>Authority actions</h2>
      {!isAuthority && (
        <WarningBanner>
          {isConnected ? "The connected wallet is not this exam's authority. " : "No wallet connected. "}
          These actions are enabled only for the authority wallet <AddressLink address={exam.authority} />.
        </WarningBanner>
      )}
      <div className="grid-2">
        <RevokeAction exam={exam} centres={centres} enabled={isAuthority} />
        <RevealAction exam={exam} centres={centres} enabled={isAuthority} now={now} />
      </div>
    </section>
  );
}

function RevokeAction({ exam, centres, enabled }: { exam: Exam; centres: Centre[]; enabled: boolean }) {
  const tx = useTxFlow();
  const [centreId, setCentreId] = useState<number | "">("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const defaultReason = centreId === "" ? "" : `Leak traced to ${centreLabel(centreId)}`;
  const text = reason.trim() || defaultReason;

  async function revoke() {
    if (centreId === "") return;
    setConfirming(false);
    await tx.send({
      label: `Revoke ${centreLabel(centreId)}`,
      functionName: "revokeCentre",
      args: [exam.id, centreId, keccak256(toBytes(text))],
    });
  }

  return (
    <div className="stack">
      <h3>Revoke centre</h3>
      <p className="muted small">Marks the centre Compromised on-chain. Later key pieces for it are skipped by the contract.</p>
      <div className="row">
        <select value={centreId} onChange={(e) => { setCentreId(e.target.value === "" ? "" : Number(e.target.value)); setConfirming(false); }} disabled={!enabled}>
          <option value="">Choose centre…</option>
          {centres.map((c) => (
            <option key={c.id} value={c.id}>
              {centreLabel(c.id)} ({c.status})
            </option>
          ))}
        </select>
        <input placeholder={defaultReason || "Reason (hashed on-chain)"} value={reason} onChange={(e) => setReason(e.target.value)} disabled={!enabled} style={{ flex: 1, minWidth: "12rem" }} />
      </div>
      {!confirming ? (
        <button className="btn-danger" disabled={!enabled || centreId === "" || tx.busy} onClick={() => setConfirming(true)}>
          Revoke {centreId === "" ? "centre" : centreLabel(centreId)}
        </button>
      ) : (
        <div className="row">
          <button className="btn-danger" onClick={revoke}>Confirm: revoke {centreLabel(centreId as number)}</button>
          <button onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      )}
      {text && <p className="muted small">Reason hash = keccak256(&quot;{text}&quot;)</p>}
      <TxStatus state={tx.state} />
    </div>
  );
}

function RevealAction({ exam, centres, enabled, now }: { exam: Exam; centres: Centre[]; enabled: boolean; now: number | undefined }) {
  const tx = useTxFlow();
  const [file, setFile] = useState<{ name: string; data: RevealFile } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const open = now !== undefined && now >= exam.revealTime;
  const pending = file ? file.data.centres.filter((f) => centres.find((c) => c.id === f.centreId && !c.fingerprintRevealed)) : [];

  async function revealAll() {
    for (let i = 0; i < pending.length; i++) {
      const f = pending[i];
      setProgress(`Revealing ${i + 1} of ${pending.length}`);
      const r = await tx.send({
        label: `Reveal fingerprint for ${centreLabel(f.centreId)}`,
        functionName: "revealFingerprint",
        args: [exam.id, f.centreId, f.fingerprint, f.salt],
      });
      if (r.stage !== "confirmed") break;
    }
    setProgress(null);
  }

  return (
    <div className="stack">
      <h3>Reveal fingerprints</h3>
      <p className="muted small">
        After reveal time, publish each centre&apos;s fingerprint and salt. The contract checks them against the commitment made at sealing.
        One transaction per centre; <span className="mono">pnpm ops reveal</span> does the same from a script.
      </p>
      {!open && <p className="muted small">Available after the reveal time (chain time).</p>}
      <FileLoader
        label="Load reveal.secret.json"
        loadedName={file?.name}
        onClear={() => setFile(null)}
        onLoad={(json, name) => {
          const r = parseRevealFile(json);
          if (!r.ok) return r.error;
          if (r.value.examId !== exam.id) return `This file is for exam #${r.value.examId}, not #${exam.id}.`;
          setFile({ name, data: r.value });
          return null;
        }}
      />
      {file && <p className="small">{pending.length} centre(s) in this file are not yet revealed on-chain.</p>}
      <button className="btn-primary" disabled={!enabled || !open || !file || pending.length === 0 || tx.busy} onClick={revealAll}>
        Reveal {pending.length || ""} fingerprint{pending.length === 1 ? "" : "s"}
      </button>
      {progress && <p className="muted small">{progress}</p>}
      <TxStatus state={tx.state} />
    </div>
  );
}
