"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { hexToBytes, keccak256, type Hex } from "viem";
import { useExam, type Centre, type Exam } from "@/hooks/useExam";
import { publicClient } from "@/lib/client";
import { registry } from "@/lib/registry";
import { fetchCiphertext } from "@/lib/logs";
import { centreLabel } from "@/lib/format";
import { explainError } from "@/lib/errors";
import { parseCentreKeyFile, type CentreKeyFile } from "@/lib/secretFiles";
import { CORE_AVAILABLE, recoverVariant, renderVariantHtml, type VariantPaper } from "@/lib/core";
import { FileLoader } from "@/components/FileLoader";
import { ErrorBanner, WarningBanner } from "@/components/ErrorBanner";
import { HashDisplay } from "@/components/HashDisplay";
import { StatusPill } from "@/components/StatusPill";
import { BlockLink } from "@/components/TxLink";

export default function CentrePage() {
  // The centre key file lives in React state only: never persisted, never uploaded.
  const [file, setFile] = useState<{ name: string; data: CentreKeyFile } | null>(null);

  return (
    <main>
      <div className="muted small">EXAM CENTRE</div>
      <h1>Unlock the paper</h1>
      <p className="muted">
        The key for this centre&apos;s copy is rebuilt only here, in this browser, from pieces that custodians released on-chain.
      </p>
      <section className="panel">
        <h2>1 · Centre key file</h2>
        <FileLoader
          label="Load your centre key file (centre-N.centrekey.secret.json)"
          loadedName={file?.name}
          onClear={() => setFile(null)}
          onLoad={(json, name) => {
            const r = parseCentreKeyFile(json);
            if (!r.ok) return r.error;
            if (r.value.contract.toLowerCase() !== registry.address.toLowerCase())
              return `This file is for registry ${r.value.contract}, but this site uses ${registry.address}.`;
            setFile({ name, data: r.value });
            return null;
          }}
        />
      </section>
      {file && <CentreConsole key={`${file.data.examId}-${file.data.centreId}`} file={file.data} />}
    </main>
  );
}

function CentreConsole({ file }: { file: CentreKeyFile }) {
  const { data, error, refetch } = useExam(file.examId);
  const exam = data?.exam;
  const centre = data?.centres.find((c) => c.id === file.centreId);

  return (
    <>
      {error ? <ErrorBanner title={`Could not read exam #${file.examId}`} error={error} onRetry={() => refetch()} /> : null}
      {exam && !centre && <ErrorBanner message={`${centreLabel(file.centreId)} is not registered for exam #${file.examId}.`} />}
      {exam && centre && <CentreStatusPanel file={file} exam={exam} centre={centre} />}
    </>
  );
}

type Step = { label: string; state: "running" | "ok" | "bad" | "waiting"; detail?: React.ReactNode };

function CentreStatusPanel({ file, exam, centre }: { file: CentreKeyFile; exam: Exam; centre: Centre }) {
  const keyMatches = file.x25519PublicKey.toLowerCase() === centre.encPubKey.toLowerCase();
  const compromised = centre.status === "Compromised";
  const n = exam.custodians.length;
  const enough = centre.approvals >= exam.threshold;

  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [paper, setPaper] = useState<{ html: string; badPieces: number } | null>(null);

  function push(s: Step) {
    setSteps((prev) => [...prev, s]);
  }
  function settleLast(patch: Partial<Step>) {
    setSteps((prev) => prev.map((s, i) => (i === prev.length - 1 ? { ...s, ...patch } : s)));
  }

  async function unlock() {
    setBusy(true);
    setSteps([]);
    setPaper(null);
    try {
      push({ label: "Read released key pieces from the contract", state: "running" });
      const [, shares] = await publicClient.readContract({ ...registry, functionName: "getShares", args: [exam.id, centre.id] });
      const sealed = (shares as readonly Hex[]).filter((s) => s !== "0x");
      settleLast({ state: "ok", detail: `${sealed.length} sealed piece(s) on-chain, threshold ${exam.threshold}.` });

      push({ label: `Fetch encrypted copy (block ${centre.registeredBlock})`, state: "running" });
      const ciphertext = await fetchCiphertext(exam.id, centre.id, centre.registeredBlock);
      settleLast({ state: "ok", detail: <>{(ciphertext.length - 2) / 2} bytes from block <BlockLink block={centre.registeredBlock} /></> });

      push({ label: "Check variant commitment", state: "running" });
      const computed = keccak256(ciphertext);
      if (computed.toLowerCase() !== centre.variantCommitment.toLowerCase()) {
        settleLast({ state: "bad", detail: `keccak256(ciphertext) = ${computed} does not match the on-chain commitment. Refusing to decrypt.` });
        return;
      }
      settleLast({ state: "ok", detail: <>keccak256(ciphertext) matches the commitment computed on-chain at sealing: <HashDisplay value={computed} /></> });

      push({ label: "Open pieces and rebuild the key in this browser", state: "running" });
      if (!CORE_AVAILABLE) {
        settleLast({
          state: "waiting",
          detail: "Waiting on examseal-core (Sampurna): the decryption module is not merged into this build yet. Nothing was decrypted.",
        });
        return;
      }
      // TODO(examseal-core): this call becomes live once lib/core.ts re-exports from examseal-core.
      const result = await recoverVariant({
        sealedPieces: sealed.map((s) => hexToBytes(s)),
        centreSk: hexToBytes(file.x25519PrivateKey),
        centrePk: hexToBytes(file.x25519PublicKey),
        ciphertext: hexToBytes(ciphertext),
        examId: exam.id,
        centreId: centre.id,
        threshold: exam.threshold,
      });
      const bad = result.badPieceIndices.length;
      settleLast({
        state: "ok",
        detail: `Key rebuilt from ${result.usedPieceIndices.length} pieces.${bad ? ` ${bad} invalid piece${bad > 1 ? "s" : ""} ignored.` : ""}`,
      });

      const variant = JSON.parse(new TextDecoder().decode(result.plaintext)) as VariantPaper;
      setPaper({ html: renderVariantHtml(variant), badPieces: bad });
    } catch (e) {
      settleLast({ state: "bad", detail: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {compromised && (
        <div className="banner do-not-use" role="alert">
          DO NOT USE: {centreLabel(centre.id).toUpperCase()} HAS BEEN REVOKED
        </div>
      )}
      {!keyMatches && (
        <ErrorBanner
          message={`This key file does not match ${centreLabel(centre.id)}'s public key on-chain. Check you loaded the right centre's file for exam #${exam.id}.`}
        />
      )}

      <section className="panel">
        <h2>2 · Release status</h2>
        <div className="row" style={{ gap: "2rem" }}>
          <div>
            <div className="muted small">
              <Link href={`/exam/${exam.id}`}>EXAM #{exam.id.toString()}</Link> · {centreLabel(centre.id).toUpperCase()}
            </div>
            <div className="stat">
              {centre.approvals}/{n}
            </div>
            <div className="muted small">APPROVALS (need {exam.threshold})</div>
          </div>
          <StatusPill status={centre.status} />
          <div className="small">
            Public key on-chain <HashDisplay value={centre.encPubKey} />
            <br />
            {keyMatches ? <span className="check-ok">✓ matches your key file</span> : <span className="check-bad">✗ does not match your key file</span>}
          </div>
        </div>
        <div className="tile-bar" style={{ marginTop: "0.75rem", maxWidth: "24rem" }}>
          {Array.from({ length: n }, (_, i) => (
            <span key={i} className={`seg ${i < centre.approvals ? "seg-on" : ""} ${i === exam.threshold - 1 ? "seg-threshold" : ""}`} />
          ))}
        </div>
      </section>

      <section className="panel stack">
        <h2>3 · Unlock</h2>
        <button className="btn-primary btn-large" disabled={!enough || compromised || !keyMatches || busy} onClick={unlock}>
          {busy ? "Unlocking…" : "Unlock paper"}
        </button>
        {!enough && !compromised && (
          <p className="muted">
            Locked: {centre.approvals} of {exam.threshold} required pieces released. The paper cannot be opened until {exam.threshold} custodians
            release.
          </p>
        )}
        {compromised && <p className="check-bad">This centre was revoked. Its copy must not be used.</p>}

        {steps.length > 0 && (
          <ol className="stack" style={{ paddingLeft: "1.2rem" }}>
            {steps.map((s, i) => (
              <li key={i}>
                <strong>
                  {s.state === "ok" ? <span className="check-ok">✓ </span> : s.state === "bad" ? <span className="check-bad">✗ </span> : s.state === "waiting" ? "⧗ " : "… "}
                  {s.label}
                </strong>
                {s.detail && <div className="small muted">{s.detail}</div>}
              </li>
            ))}
          </ol>
        )}
        {steps.some((s) => s.state === "waiting") && (
          <WarningBanner>Decryption is not available in this build yet. Everything above it ran against the live chain.</WarningBanner>
        )}
      </section>

      {paper && <PaperView html={paper.html} />}
    </>
  );
}

function PaperView({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  return (
    <section className="panel stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Paper</h2>
        <button onClick={() => frame.current?.contentWindow?.print()}>Print</button>
      </div>
      <iframe ref={frame} className="paper-frame" title="Exam paper" srcDoc={html} sandbox="allow-modals allow-same-origin" />
    </section>
  );
}
